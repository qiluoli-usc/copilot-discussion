"""Official Python MCP SDK handshake and tool interop; no browser/model calls.

py -3.12 -m uv run --with mcp==2.3.0 python tests/mcp_sdk_smoke.py --node <node.exe>
"""
import argparse
import asyncio
import json
import shutil
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(node, launcher=None, profile=None):
    server = Path(__file__).parents[1] / "skills/copilot-discussion/scripts/mcp-server.mjs"
    with tempfile.TemporaryDirectory(prefix="copilot-mcp-sdk-") as temporary:
        root = Path(temporary)
        workspace = root / "workspace"
        workspace.mkdir()
        runtime = root / "synthetic-runtime"
        (runtime / "jev_ultrafast").mkdir(parents=True)
        (runtime / "jev_ultrafast/browser.py").write_text("# SDK fixture, never imported\n", encoding="utf-8")
        config = root / "config.json"
        config.write_text(json.dumps({"schemaVersion": 1, "workspaceDir": str(workspace),
                                     "native": {"runtimeRoot": str(runtime)}}), encoding="utf-8")
        if launcher:
            node_path = str(Path(node).resolve()) if Path(node).is_absolute() else shutil.which(node)
            assert node_path, "Supply --node with the installed Node absolute path"
            (root / "launcher.json").write_text(json.dumps({"schemaVersion": 1, "nodeExecutable": node_path}), encoding="utf-8")
        parameters = StdioServerParameters(command="powershell.exe", args=["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcher,
                                            "-NodeCommand", "copilot-discussion-no-such-node"],
                                           env={"COPILOT_DISCUSSION_CONFIG": str(config)}) if launcher else StdioServerParameters(command=node, args=[str(server), "--config", str(config)])
        if profile:
            data = json.loads(Path(profile).read_text(encoding="utf-8-sig"))
            spec = data.get("mcpServers", data.get("servers", {}))["copilot-discussion"]
            parameters = StdioServerParameters(command=spec["command"], args=spec["args"])
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as session:
                initialized = await session.initialize()
                assert initialized.server_info.name == "copilot-discussion"
                tools = await session.list_tools()
                assert len(tools.tools) == 11
                doctor = await session.call_tool("discussion_doctor", {})
                assert not doctor.is_error
                details = json.loads(doctor.content[0].text)
                assert details["apiKeyRequired"] is False
                if profile:
                    assert details["ready"] is True, "Installed profile must pass the real interpreter/dependency probe"
                created = await session.call_tool("discussion_init", {"maxRounds": None})
                assert not created.is_error
                run_file = json.loads(created.content[0].text)["runFile"]
                assert Path(run_file).is_file()
                status = await session.call_tool("discussion_control", {"runFile": run_file, "action": "status"})
                assert json.loads(status.content[0].text)["status"] == "selecting"
                refused = await session.call_tool("discussion_ask", {"runFile": run_file, "question": "must not launch a browser"})
                assert refused.is_error
                assert json.loads(refused.content[0].text)["retrySend"] is False
        print(json.dumps({"verified": True, "officialSdk": "mcp==2.3.0", "toolCount": 11,
                          "protocol": initialized.protocol_version, "browserCalls": 0, "modelCalls": 0,
                          "launcherNodeSource": "installed-profile" if profile else "installer-record-with-no-valid-node-command" if launcher else "direct"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", default="node", help="Node executable (default: node from PATH)")
    parser.add_argument("--launcher", help="Optional PowerShell MCP launcher to verify native plugin transport")
    parser.add_argument("--profile", help="Generated MCP JSON profile from an isolated real installation")
    parsed = parser.parse_args()
    asyncio.run(main(parsed.node, parsed.launcher, parsed.profile))
