import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseHostGuide } from '../app/host-guide.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));

test('the real .NET installer starts, detects PATH hosts and switches all seven embedded instructions', { skip: process.platform !== 'win32' }, async () => {
  const outputRoot = path.join(project, 'output/installations/gui-regression');
  await fs.mkdir(outputRoot, { recursive: true });
  const out = await fs.mkdtemp(path.join(outputRoot, 'native-'));
  const catalogFile = path.join(project, 'plugins/copilot-discussion/skills/copilot-discussion/scripts/host-catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const data = parseHostGuide(await fs.readFile(path.join(project, 'docs/host-setup.md'), 'utf8'), catalog);
  const guideFile = path.join(out, 'host-guide.json'), buildInfo = path.join(out, 'BuildInfo.cs'), exe = path.join(out, 'GuiSmoke.exe');
  await fs.writeFile(guideFile, JSON.stringify(data));
  await fs.writeFile(buildInfo, 'internal static class BuildInfo { internal const string Version="0.9.0"; internal const string Revision="regression"; internal const string InstallationId="0.9.0-regression"; internal const string PayloadSha256=""; }\n');
  const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const references = ['System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions', 'System.IO.Compression', 'System.IO.Compression.FileSystem'].map(name => '/reference:' + name + '.dll');
  const compiled = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/main:GuiSmoke', '/utf8output', '/codepage:65001', ...references, '/resource:' + catalogFile + ',hosts.json', '/resource:' + guideFile + ',host-guide.json', '/out:' + exe, path.join(project, 'installer/src/Setup.cs'), path.join(project, 'installer/tests/GuiSmoke.cs'), buildInfo], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.ifError(compiled.error);
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const commandFixture = path.join(out, 'commands');
  await fs.mkdir(commandFixture);
  await fs.writeFile(path.join(commandFixture, 'code.cmd'), '@rem Detection only; this file must not be executed.\r\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  env.PATH = commandFixture;
  const ran = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 30000, env });
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ compileExit: compiled.status, exitCode: ran.status, stdout: ran.stdout, stderr: ran.stderr }, null, 2) + '\n');
  assert.ifError(ran.error);
  assert.equal(ran.status, 0, 'Real WinForms initialization failed:\n' + ran.stderr);
  const report = JSON.parse(ran.stdout.trim());
  assert.equal(report.passed, true);
  assert.equal(report.hostCount, 9);
  assert.deepEqual(report.checkedGuides, ['codex', 'claude-code', 'workbuddy', 'dsh', 'qwenwork', 'github-copilot', 'vscode']);
});
