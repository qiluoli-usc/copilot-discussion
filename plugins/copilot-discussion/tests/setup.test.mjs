import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSettings, loadSettings } from '../skills/copilot-discussion/scripts/settings.mjs';
import { setup as realSetup, profiles, installSkills, parseSetupArgs } from '../skills/copilot-discussion/scripts/setup.mjs';
const setup = options => realSetup({ ...options, 'configure-only': true });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, '中文 工作区'), runtime = path.join(root, 'Jev runtime');
  await fs.mkdir(path.join(runtime, 'jev_ultrafast'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'jev_ultrafast', 'browser.py'), '# synthetic, not executed');
  const config = path.join(root, 'private', 'config.json'), output = path.join(root, 'profiles');
  return { root, workspace, runtime, config, output };
}

test('安装生成可用绝对路径和各宿主正确格式，可重复执行且拒绝覆盖不同配置', async t => {
  const f = await fixture(t);
  const options = { workspace: f.workspace, 'runtime-root': f.runtime, config: f.config, output: f.output, target: 'all' };
  const result = await setup(options);
  assert.equal(result.apiKeyRequired, false); assert.equal(result.clientSettingsModified, false);
  const installed = loadSettings({ configFile: f.config, env: {} });
  assert.equal(installed.workspaceDir, f.workspace); assert.equal(installed.native.runtimeRoot, f.runtime);
  const mcp = JSON.parse(await fs.readFile(path.join(f.output, 'mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers['copilot-discussion'].command, process.execPath);
  assert.deepEqual(mcp.mcpServers['copilot-discussion'].args.slice(-2), ['--config', f.config]);
  await fs.access(mcp.mcpServers['copilot-discussion'].args[0]);
  const github = JSON.parse(await fs.readFile(path.join(f.output, 'github-copilot.json'), 'utf8'));
  const vscode = JSON.parse(await fs.readFile(path.join(f.output, 'vscode-mcp.json'), 'utf8'));
  assert.deepEqual(github.mcpServers['copilot-discussion'].tools, ['*']);
  assert.ok(vscode.servers); assert.equal(vscode.mcpServers, undefined);
  assert.match(await fs.readFile(path.join(f.output, 'dsh.yaml'), 'utf8'), /@deepseek-ai\/dsh-mcp-client/u);
  await setup(options);
  const original = await fs.readFile(f.config, 'utf8');
  await assert.rejects(setup({ ...options, workspace: path.join(f.root, 'other') }), /已有不同配置/u);
  assert.equal(await fs.readFile(f.config, 'utf8'), original);
});

test('配置不接收凭据或远程Chrome，环境覆盖仅覆盖指定的非秘密字段', async t => {
  const f = await fixture(t); await setup({ workspace: f.workspace, 'runtime-root': f.runtime, config: f.config, output: f.output });
  const loaded = loadSettings({ configFile: f.config, env: { JEV_CDP_URL: 'http://127.0.0.1:9333', TYPESAFE_API_KEY: 'test-not-a-real-key' } });
  assert.equal(loaded.native.cdpUrl, 'http://127.0.0.1:9333');
  assert.ok(!JSON.stringify(loaded).includes('test-not-a-real-key'));
  assert.throws(() => validateSettings({ schemaVersion: 1, apiKey: 'test' }), /不接收/u);
  for (const cdpUrl of ['http://evil.example:9222', 'http://u:p@127.0.0.1:9222', 'https://127.0.0.1:9222', 'http://127.0.0.1:9222/private']) {
    assert.throws(() => validateSettings({ schemaVersion: 1, native: { cdpUrl } }));
  }
  assert.throws(() => parseSetupArgs(['--jev-api-key', 'secret-not-echoed']), /不接受API Key/u);
  assert.throws(() => profiles({ configFile: 'relative.json' }), /绝对路径/u);
});

test('可将两个完整技能装入新目录，保留辅助代码，已有技能不被覆盖', async t => {
  const f = await fixture(t); const destination = path.join(f.root, 'Agent skills');
  const installed = await installSkills({ target: 'qwenwork', skillsDir: destination });
  assert.equal(installed.length, 2);
  await fs.access(path.join(destination, 'copilot-discussion', 'scripts', 'mcp-server.mjs'));
  await fs.access(path.join(destination, 'research-topics', 'SKILL.md'));
  const marker = path.join(destination, 'research-topics', 'user-file.txt'); await fs.writeFile(marker, 'keep');
  await assert.rejects(installSkills({ target: 'qwenwork', skillsDir: destination }), /已存在/u);
  assert.equal(await fs.readFile(marker, 'utf8'), 'keep');
  await assert.rejects(installSkills({ target: 'workbuddy' }), /显式指定/u);
});
