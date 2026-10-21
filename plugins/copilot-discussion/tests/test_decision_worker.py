import importlib.util
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace

SCRIPTS = Path(__file__).parents[1] / "skills/copilot-discussion/scripts"
sys.path.insert(0, str(SCRIPTS))
try:
    spec = importlib.util.spec_from_file_location("decision_worker", SCRIPTS / "decision_worker.py")
    decision = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(decision)
finally:
    sys.path.pop(0)


class DecisionGuardTests(unittest.TestCase):
    def page(self):
        return {"url": "https://copilot.cloud.microsoft/chat?tracking=omit", "title": "private sidebar", "text": "unrelated chat names",
                "actions": [{"id": "field", "node": 1, "kind": "fill", "role": "textbox", "label": "Message Copilot", "value": ""},
                            {"id": "send", "node": 2, "kind": "click", "role": "button", "label": "Send"},
                            {"id": "delete", "node": 3, "kind": "click", "role": "button", "label": "Delete private chat"}]}

    def test_only_owned_public_transcript_and_permitted_controls_enter_model_state(self):
        state = decision.scoped_state(self.page(), {"entries": [{"role": "user", "text": "public benchmark"}]})
        self.assertNotIn("private", str(state)); self.assertNotIn("tracking", state["url"])
        self.assertEqual([a["id"] for a in state["actions"]], ["field", "send"])
        self.assertIn("public benchmark", state["text"])

    def worker(self, result):
        worker = decision.DecisionWorker.__new__(decision.DecisionWorker)
        worker.fixture_origin = "http://127.0.0.1:8888"
        worker.reader = "function(){return {entries:[]}}"
        worker.browser = SimpleNamespace(evaluate=lambda _code: {"entries": []})
        worker.decision_stats = {"calls": 0, "httpRequests": 0, "latencyMs": 0, "failures": 0}
        worker.configured_model = "configured-model"
        worker.model = SimpleNamespace(choose=lambda *_args: result)
        return worker

    def test_blocked_response_is_recorded_and_never_replaced_by_a_guessed_action(self):
        worker = self.worker({"choice": "BLOCKED", "model": "configured-model", "operation": "BLOCKED", "confidence": 0.34, "target_confidence": None})
        with self.assertRaises(decision.DecisionFailure):
            worker.before_action(self.page(), self.page()["actions"][0], "fill", {"text": "public"})
        self.assertEqual(worker.decision_stats["calls"], 1)
        self.assertEqual(worker.decision_stats["lastDecision"]["operation"], "BLOCKED")

    def test_matching_model_and_control_are_required_and_budget_is_bounded(self):
        result = {"choice": "field", "operation": "TYPE_TEXT", "model": "configured-model", "confidence": 0.9,
                  "target_confidence": 0.9, "latency_ms": 1, "usage": {}}
        worker = self.worker(result)
        self.assertEqual(worker.before_action(self.page(), self.page()["actions"][0], "fill", {})["operation"], "TYPE_TEXT")
        worker.decision_stats["calls"] = 12
        with self.assertRaises(decision.DecisionFailure):
            worker.before_action(self.page(), self.page()["actions"][0], "fill", {})

    @unittest.skipUnless(sys.platform == "win32", "Windows archive extraction guard")
    def test_zip_traversal_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory(prefix="copilot-zip-guard-") as temporary:
            root = Path(temporary)
            archive = root / "test.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("../escape.txt", "should never be extracted")
            result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                                     str(SCRIPTS / "expand-archive.ps1"), "-Archive", str(archive), "-Destination", str(root / "extracted")],
                                    capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / "escape.txt").exists())


if __name__ == "__main__":
    unittest.main()
