"""Explicit experimental Jev decision adapter; never used by default research.

Credentials are provided by the caller's configured uv --env-file environment.
Jev's own model/provider module owns authentication, requests and validation.
Only this owned benchmark conversation and its permitted controls are exposed.
"""
import re
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from native_worker import NativeWorker, main, select_action


class DecisionFailure(RuntimeError):
    pass


def scoped_state(page, transcript):
    actions = []
    for kind in ("fill", "click"):
        try:
            actions.append(select_action(page, kind))
        except ValueError:
            if kind == "fill":
                raise
    parsed = urlsplit(page["url"])
    return {"url": urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")),
            "title": "Public manufacturing AI benchmark conversation",
            "text": "\n".join(f"{item['role']}: {item['text']}" for item in transcript.get("entries", [])),
            "actions": actions}


class DecisionWorker(NativeWorker):
    def __init__(self, args):
        super().__init__(Path(args.runtime_root).resolve(), args.fixture_origin)
        from jev_ultrafast import model
        from jev_ultrafast.providers import decision_provider
        provider = decision_provider()
        if provider.name != "openrouter" or provider.model != args.decision_model:
            raise ValueError("Expected the explicitly configured OpenRouter Jev adapter")
        self.model, self.configured_model = model, args.decision_model
        self.allow_authenticated = args.allow_authenticated_state
        self.reader = None
        self.decision_stats = {"calls": 0, "httpRequests": 0, "latencyMs": 0, "failures": 0}
        model.CLIENT.event_hooks.setdefault("request", []).append(self.count_request)
        self.provenance = {**self.provenance, "decisionModel": True, "provider": provider.name, "model": provider.model,
                           "scope": "owned-public-benchmark-conversation-and-allowlisted-controls"}

    def count_request(self, _request):
        self.decision_stats["httpRequests"] += 1

    def dispatch(self, operation, args):
        if operation == "read":
            self.reader = args.get("reader")
        return super().dispatch(operation, args)

    def before_action(self, page, action, operation, args):
        if not self.fixture_origin and not self.allow_authenticated:
            raise DecisionFailure("Authenticated-state disclosure needs explicit authorization")
        if not self.reader or self.decision_stats["calls"] >= 12:
            raise DecisionFailure("Missing transcript reader or bounded decision budget reached")
        transcript = self.browser.evaluate("(" + self.reader + ")()")
        state = scoped_state(page, transcript)
        goal = ("Choose TYPE_TEXT for the unique empty Message Copilot textbox. The host supplies the exact approved text; do not generate text."
                if operation == "fill" else
                "The host has already verified the exact approved public benchmark draft. Choose CLICK on Send once to submit it. Do not edit text, navigate, or declare DONE.")
        self.decision_stats["calls"] += 1
        started = time.perf_counter()
        try:
            result = self.model.choose(state, goal, [])
            self.decision_stats["lastDecision"] = {"model": result.get("model"), "operation": result.get("operation"),
                "matchesExpectedControl": result.get("choice") == action["id"],
                "confidence": result.get("confidence"), "targetConfidence": result.get("target_confidence"),
                "matchesConfiguredModel": result.get("model") == self.configured_model}
            if (result["choice"] != action["id"] or result["model"] != self.configured_model or
                    result.get("confidence", 0) < 0.55 or result.get("target_confidence", 0) < 0.55):
                raise DecisionFailure("Decision did not select the permitted exact operation")
            return {"provider": "openrouter", "model": result["model"], "latencyMs": result["latency_ms"],
                    "operation": result["operation"], "confidence": result["confidence"],
                    "usage": {key: value for key, value in result.get("usage", {}).items()
                              if key in {"prompt_tokens", "completion_tokens", "total_tokens", "cost", "input_tokens", "output_tokens"}
                              and type(value) in (int, float)}}
        except Exception as error:
            self.decision_stats["failures"] += 1
            # Never expose provider error bodies or retry a failed paid run.
            code = re.search(r"HTTP (\d{3})", str(error))
            self.decision_stats["lastError"] = f"HTTP {code[1]}" if code else type(error).__name__
            raise DecisionFailure("Jev decision failed; inspect benchmark log before authorizing another paid run") from None
        finally:
            self.decision_stats["latencyMs"] += round((time.perf_counter() - started) * 1000, 3)


def arguments(parser):
    parser.add_argument("--decision-model", required=True)
    parser.add_argument("--allow-authenticated-state", action="store_true")


if __name__ == "__main__":
    raise SystemExit(main(worker_factory=DecisionWorker, add_arguments=arguments))
