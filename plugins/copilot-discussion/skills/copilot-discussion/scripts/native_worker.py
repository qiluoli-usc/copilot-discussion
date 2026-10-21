"""Owned, persistent Chrome tab using the installed Jev Native execution layer.

JSON-lines over stdio only. No model endpoint, API key, screenshots or recording.
Questions come verbatim from the current host Agent.
"""

import argparse
import json
import re
import sys
import uuid
import hashlib
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

HOSTS = {"copilot.cloud.microsoft", "m365.cloud.microsoft"}
NAMES = {
    "fill": r"^(Message Copilot|向 Copilot 发送消息|给 Copilot 发送消息|向 Copilot 提问)$",
    "click": r"^(Send|发送|发送消息|提交)$",
}
# Audited browser.py: for fill/click every StalePage is raised before the
# first Input.dispatch* call. Input failures use RuntimeError. A new runtime
# must be audited before enabling this narrow, pre-input retry again.
PRE_INPUT_STALE_SOURCES = {"9156f8b5c7dfa74c0548b0228e121183249ee8ac0922c5b59165fb2ad354373e"}


def allowed_url(value, fixture_origin=None):
    parsed = urlsplit(value)
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are forbidden")
    if fixture_origin and f"{parsed.scheme}://{parsed.netloc}" == fixture_origin:
        return value
    if parsed.scheme != "https" or parsed.hostname not in HOSTS or parsed.port:
        raise ValueError("Expected the Copilot HTTPS origin")
    if not re.fullmatch(r"/chat(?:/conversation/[\w-]+)?/?", parsed.path):
        raise ValueError("Expected a Copilot chat URL")
    return value


def select_action(page, kind, pattern=None):
    expression = re.compile(pattern or NAMES[kind], re.I)
    role = "textbox" if kind == "fill" else "button"
    candidates = [action for action in page["actions"] if action["kind"] == kind
                  and action.get("role") == role and expression.fullmatch(action.get("label", ""))]
    if len(candidates) != 1:
        raise ValueError("Expected exactly one observed control")
    return candidates[0]


def check_draft(action, expected):
    def normalize(value):
        return re.sub(r"\s+", " ", value.strip().rstrip("\u200b\u200c\ufeff").strip())
    if not isinstance(expected, str) or normalize(action.get("value", "")) != normalize(expected):
        raise ValueError("Draft changed before the native action")


class NativeWorker:
    def __init__(self, root, fixture_origin=None):
        if not (root / "jev_ultrafast" / "browser.py").is_file():
            raise ValueError("Jev Native runtime was not found")
        sys.path.insert(0, str(root))
        from browser_harness import recorder
        from browser_harness.admin import ensure_daemon
        from browser_harness.helpers import cdp
        from jev_ultrafast.browser import Browser, StalePage
        self.cdp, self.Browser = cdp, Browser
        self.stale_type = StalePage
        source = Path(sys.modules[Browser.__module__].__file__).resolve()
        self.provenance = {"module": Browser.__module__, "class": Browser.__name__,
                           "sourceFile": str(source), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                           "observation": "Browser.observe(screenshot=False)", "mutation": "Browser.act",
                           "decisionModel": False}
        ensure_daemon(wait=45)
        if not cdp("Browser.getVersion").get("product", "").startswith("Chrome/"):
            raise ValueError("Expected Google Chrome")
        auto_recording, _ = recorder.auto_recording_setting()
        if auto_recording or recorder.recording_dir() is not None:
            raise ValueError("Disable Browser Harness recording before this run")
        self.browser = None
        self.owner = None
        self.fixture_origin = fixture_origin

    def check_owner(self):
        if not self.browser or self.browser.evaluate("window.__copilotDiscussionOwner || null") != self.owner:
            raise ValueError("Owned tab identity changed; no action executed")

    def current_url(self):
        self.check_owner()
        return allowed_url(self.browser.evaluate("location.href"), self.fixture_origin)

    def attach(self, target, owner):
        if not isinstance(target, str) or not target or not isinstance(owner, str) or not owner:
            raise ValueError("Missing native tab binding")
        browser = self.Browser.__new__(self.Browser)
        browser.target = target
        browser.session = self.cdp("Target.attachToTarget", targetId=target, flatten=True)["sessionId"]
        browser.call("Emulation.setDeviceMetricsOverride", width=1120, height=780, deviceScaleFactor=1, mobile=False)
        browser.call("Emulation.setFocusEmulationEnabled", enabled=True)
        self.browser, self.owner = browser, owner
        self.check_owner()
        self.current_url()
        return {"target": target, "owner": owner}

    def before_action(self, page, action, operation, args):
        """Execution-only default; explicit benchmark subclasses may decide."""
        return None

    def dispatch(self, operation, args):
        if operation == "open":
            if self.browser:
                raise ValueError("A tab is already attached")
            url = allowed_url(args["url"], self.fixture_origin)
            self.browser = self.Browser(url)
            self.owner = str(uuid.uuid4())
            marker = "window.__copilotDiscussionOwner=" + json.dumps(self.owner)
            self.browser.call("Page.addScriptToEvaluateOnNewDocument", source=marker)
            self.browser.evaluate(marker)
            return {"target": self.browser.target, "owner": self.owner}
        if operation == "attach":
            return self.attach(args["target"], args["owner"])
        if operation == "url":
            return self.current_url()
        if operation == "read":
            url = self.current_url()
            # The reader is bundled code supplied by the Node adapter, never a
            # model-generated selector or code returned by a webpage.
            reader = args["reader"]
            if not isinstance(reader, str) or len(reader) > 20000:
                raise ValueError("Invalid bundled DOM reader")
            state = self.browser.evaluate("(" + reader + ")()")
            return {"url": url, "state": state}
        if operation in {"fill", "send"}:
            self.current_url()
            for attempt in range(3):
                try:
                    self.current_url()
                    page = self.browser.observe(screenshot=False)
                    allowed_url(page["url"], self.fixture_origin)
                    kind = "fill" if operation == "fill" else "click"
                    action = select_action(page, kind, args.get("pattern"))
                    text = args.get("text") if operation == "fill" else None
                    if operation == "fill" and (not isinstance(text, str) or not text.strip()):
                        raise ValueError("Missing exact moderator question")
                    if operation == "fill":
                        check_draft(action, "")
                    else:
                        field = select_action(page, "fill", args.get("composerPattern"))
                        check_draft(field, args.get("expectedText"))
                    decision = self.before_action(page, action, operation, args)
                    # Jev itself checks freshness, identity and occlusion.
                    self.browser.act(action, page, text=text)
                    break
                except self.stale_type:
                    if self.provenance["sourceSha256"] not in PRE_INPUT_STALE_SOURCES or attempt == 2:
                        raise
                    # Re-observe only after an audited pre-input rejection.
                    # Timeouts, RuntimeError and unknown versions never retry.
                    time.sleep(0.05 * (attempt + 1))
            return {"executed": True, "executorReceipt": {
                "id": str(uuid.uuid4()), "operation": operation,
                "method": "jev_ultrafast.browser.Browser.act", "observedWith": "Browser.observe(screenshot=False)",
                "kind": action["kind"], "role": action.get("role"), "label": action.get("label"),
                **({"decision": decision} if decision else {}),
                "target": self.browser.target, "preInputStaleRetries": attempt,
                "completedAt": datetime.now(timezone.utc).isoformat()}}
        if operation == "close":
            self.check_owner()
            self.browser.close()
            return {"closed": True}
        raise ValueError("Unsupported native operation")

    def release(self):
        if self.browser and self.browser.target:
            try:
                self.cdp("Target.detachFromTarget", sessionId=self.browser.session)
            except Exception:
                pass
        # The owned tab deliberately stays open across separate CLI invocations.


def main(worker_factory=None, add_arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", required=True)
    parser.add_argument("--fixture-origin")
    if add_arguments:
        add_arguments(parser)
    args = parser.parse_args()
    if args.fixture_origin:
        fixture = urlsplit(args.fixture_origin)
        if fixture.scheme != "http" or fixture.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("Only a local synthetic fixture is permitted")
    worker = None
    try:
        worker = worker_factory(args) if worker_factory else NativeWorker(Path(args.runtime_root).resolve(), args.fixture_origin)
        print(json.dumps({"ready": True, "protocol": 1, "engine": "jev-native-executor", "modelCalls": 0,
                          "provenance": worker.provenance}), flush=True)
        for line in sys.stdin:
            request = {}
            try:
                request = json.loads(line)
                result = worker.dispatch(request["operation"], request.get("args", {}))
                output = {"id": request["id"], "ok": True, "result": result}
            except Exception as error:
                # No stack trace, page body, request values or dependency error
                # bodies are included in errors. No mutation is retried.
                output = {"id": request.get("id") if isinstance(request, dict) else None,
                          "ok": False, "errorType": type(error).__name__,
                          "error": "Native operation failed; inspect the saved pending state before retrying."}
            if hasattr(worker, "decision_stats"):
                output["decisionStats"] = worker.decision_stats
            print(json.dumps(output, ensure_ascii=True), flush=True)
    except Exception as error:
        print(json.dumps({"ready": False, "errorType": type(error).__name__,
                          "error": "Jev Native startup failed; check Chrome, runtime path and recording state."}), flush=True)
        return 2
    finally:
        if worker:
            worker.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
