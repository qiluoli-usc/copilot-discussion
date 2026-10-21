import importlib.util
import unittest
from pathlib import Path

SOURCE = Path(__file__).parents[1] / "skills/copilot-discussion/scripts/native_worker.py"
SPEC = importlib.util.spec_from_file_location("native_worker", SOURCE)
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class NativeWorkerTests(unittest.TestCase):
    def test_only_the_observed_unique_matching_control_can_be_used(self):
        field = {"id": "e1", "node": 8, "kind": "fill", "role": "textbox", "label": "Message Copilot"}
        self.assertEqual(native.select_action({"actions": [field]}, "fill"), field)
        with self.assertRaises(ValueError):
            native.select_action({"actions": [field, dict(field, node=9)]}, "fill")
        with self.assertRaises(ValueError):
            native.select_action({"actions": [dict(field, role="button")]}, "fill")

    def test_live_actions_are_limited_to_copilot_origins(self):
        for value in ["https://evil.example/chat", "https://copilot.cloud.microsoft/library/all",
                      "https://name:secret@copilot.cloud.microsoft/chat", "http://copilot.cloud.microsoft/chat"]:
            with self.assertRaises(ValueError):
                native.allowed_url(value)
        native.allowed_url("https://copilot.cloud.microsoft/chat/conversation/a-b")
        native.allowed_url("http://127.0.0.1:8888/fixture", "http://127.0.0.1:8888")

    def test_foreign_tab_identity_prevents_reading_and_closing(self):
        worker = native.NativeWorker.__new__(native.NativeWorker)
        worker.owner = "owned"
        worker.browser = type("Browser", (), {"evaluate": lambda _self, _code: "other"})()
        with self.assertRaises(ValueError):
            worker.check_owner()

    def test_changed_draft_prevents_native_send(self):
        with self.assertRaises(ValueError):
            native.check_draft({"value": "人工修改后的内容"}, "原问题")
        with self.assertRaises(ValueError):
            native.check_draft({"value": "不能覆盖的用户草稿"}, "")

    def test_rich_editor_suffix_does_not_change_the_verified_question(self):
        native.check_draft({"value": "本轮问题\u200b\u200c"}, "本轮问题")

    def make_action_worker(self, error, source_hash=None, changed_draft=False):
        class StalePage(ValueError):
            pass

        class Browser:
            target = "owned-test-target"
            calls = 0

            def observe(self, screenshot=False):
                self_test.assertFalse(screenshot)
                return {"url": "https://copilot.cloud.microsoft/chat", "actions": [
                    {"id": "field", "kind": "fill", "role": "textbox", "label": "Message Copilot",
                     "value": "人工草稿" if changed_draft and self.calls else "原问题"},
                    {"id": "send", "kind": "click", "role": "button", "label": "Send"}]}

            def act(self, action, page, text=None):
                self.calls += 1
                if self.calls == 1:
                    raise StalePage("pre-input") if error == "stale" else RuntimeError("input may have executed")

        self_test = self
        worker = native.NativeWorker.__new__(native.NativeWorker)
        worker.current_url = lambda: "https://copilot.cloud.microsoft/chat"
        worker.fixture_origin = None
        worker.stale_type = StalePage
        worker.provenance = {"sourceSha256": source_hash or next(iter(native.PRE_INPUT_STALE_SOURCES))}
        worker.browser = Browser()
        return worker

    def test_audited_pre_input_staleness_reobserves_and_checks_draft_again(self):
        worker = self.make_action_worker("stale")
        result = worker.dispatch("send", {"expectedText": "原问题"})
        self.assertEqual(result["executorReceipt"]["preInputStaleRetries"], 1)
        self.assertEqual(worker.browser.calls, 2)
        worker = self.make_action_worker("stale", changed_draft=True)
        with self.assertRaises(ValueError):
            worker.dispatch("send", {"expectedText": "原问题"})
        self.assertEqual(worker.browser.calls, 1)

    def test_unknown_runtime_or_possible_input_failure_never_retries(self):
        for error, source_hash in [("stale", "unknown"), ("input", None)]:
            worker = self.make_action_worker(error, source_hash)
            with self.assertRaises((ValueError, RuntimeError)):
                worker.dispatch("send", {"expectedText": "原问题"})
            self.assertEqual(worker.browser.calls, 1)


if __name__ == "__main__":
    unittest.main()
