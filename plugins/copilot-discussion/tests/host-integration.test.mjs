import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { detectHosts, integrateHosts, restoreHostIntegration, mergeJsonConfig, mergeTomlConfig } from '../skills/copilot-discussion/scripts/host-integration.mjs';
const require = createRequire(import.meta.url);
const jc = require('../skills/copilot-discussion/scripts/vendor/jsonc-parser/lib/umd/main.js');
const toml = require('../skills/copilot-discussion/scripts/vendor/smol-toml/dist/index.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-hosts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, '中文 用户'), env = { APPDATA: path.join(home, 'AppData/Roaming'), PATH: '' };
  const skillsRoot = path.join(root, 'source/copilot-discussion');
  for (const name of ['copilot-discussion', 'research-topics']) {
    await fs.mkdir(path.join(path.dirname(skillsRoot), name), { recursive: true });
    await fs.writeFile(path.join(path.dirname(skillsRoot), name, 'SKILL.md'), '---\nname: ' + name + '\n---\nOriginal skill\n');
  }
  await fs.mkdir(home, { recursive: true });
  const server = { type: 'stdio', command: process.execPath, args: [path.join(root, '安装目录/mcp-server.mjs'), '--config', path.join(root, 'config.json')] };
  return { root, home, env, server, skillsRoot };
}
const write = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };

test('JSONC保留注释、CRLF、BOM和其他服务器，升级保留用户增加的非启动设置', () => {
  const original = '\uFEFF{\r\n  // 我的服务器\r\n  "servers": {"other": {"command":"keep",},},\r\n  "inputs": [],\r\n}\r\n';
  const a = mergeJsonConfig(original, { type: 'stdio', command: 'one', args: ['a'] }, { format: 'jsonc', key: 'servers' });
  assert.ok(a.text.startsWith('\uFEFF')); assert.ok(a.text.includes('// 我的服务器\r\n'));
  // Add a host option without changing this product's controlled launch fields.
  const noBom = a.text.slice(1);
  const edited = '\uFEFF' + jc.applyEdits(noBom, jc.modify(noBom, ['servers', a.owned.name, 'timeout'], 100, {}));
  const b = mergeJsonConfig(edited, { type: 'stdio', command: 'two', args: ['b'] }, { format: 'jsonc', key: 'servers', owned: a.owned });
  const parsed = jc.parse(b.text.slice(1));
  assert.equal(parsed.servers.other.command, 'keep'); assert.equal(parsed.servers[a.owned.name].timeout, 100);
  assert.equal(parsed.servers[a.owned.name].command, 'two'); assert.ok(b.text.includes('// 我的服务器'));
});

test('同名项不覆盖，重复键、无效JSON和用户改动不被静默重写', () => {
  const a = mergeJsonConfig('{"mcpServers":{"copilot-discussion":{"command":"user"}}}', { command: 'app', args: [] });
  assert.equal(a.owned.name, 'copilot-discussion-native'); assert.equal(JSON.parse(a.text).mcpServers['copilot-discussion'].command, 'user');
  for (const input of ['{"mcpServers":{},"mcpServers":{}}', '{"mcpServers":[]}', '{ broken private-value }', '[]']) assert.throws(() => mergeJsonConfig(input, { command: 'x' }));
  const changed = JSON.parse(a.text); changed.mcpServers[a.owned.name].command = 'custom';
  assert.throws(() => mergeJsonConfig(JSON.stringify(changed), { command: 'new' }, { owned: a.owned }), /手动修改/u);
});

test('TOML仅修改登记块，保留原文和其他表；用户修改块或内联表冲突时停止', () => {
  const original = '# 用户设置\r\nmodel = "host-model"\r\n[mcp_servers.existing]\r\ncommand = "keep"\r\n';
  const a = mergeTomlConfig(original, { command: 'C:\\中文 path\\node.exe', args: ['C:\\研究\\server.mjs'] });
  assert.ok(a.text.startsWith(original)); assert.equal(toml.parse(a.text).mcp_servers.existing.command, 'keep');
  const b = mergeTomlConfig(a.text, { command: 'new', args: [] }, { owned: a.owned });
  assert.ok(b.text.startsWith(original)); assert.equal(toml.parse(b.text).mcp_servers[a.owned.name].command, 'new');
  assert.throws(() => mergeTomlConfig(a.text.replace('tool_timeout_sec = 60', 'tool_timeout_sec = 99'), { command: 'x', args: [] }, { owned: a.owned }), /修改/u);
  assert.throws(() => mergeTomlConfig('mcp_servers = {}\n', { command: 'x', args: [] }), /冲突/u);
});

test('自动发现五类配置、写入正确格式与技能，二次执行零改动，完整回滚原字节', async t => {
  const f = await fixture(t);
  const originals = new Map([
    [path.join(f.home, '.codex/config.toml'), '# 原设置\nmodel = "test"\n'],
    [path.join(f.home, '.claude.json'), '{"projects":{"keep":{}},"mcpServers":{"user":{"command":"keep"}}}\n'],
    [path.join(f.home, '.workbuddy/.mcp.json'), '{"mcpServers":{"user":{"command":"keep"}}}\n'],
    [path.join(f.home, '.copilot/mcp-config.json'), '{"mcpServers":{},"other":true}\n'],
    [path.join(f.env.APPDATA, 'Code/User/mcp.json'), '{\n// VS Code注释\n"servers":{},"inputs":[]}\n']
  ]);
  for (const [file, text] of originals) await write(file, text);
  await fs.mkdir(path.join(f.home, '.workbuddy/skills'), { recursive: true });
  const first = await integrateHosts(f);
  assert.equal(first.status, 'ready-after-reload'); assert.equal(first.results.length, 5);
  assert.ok(first.rollbackFile);
  const cli = JSON.parse(await fs.readFile(path.join(f.home, '.copilot/mcp-config.json'), 'utf8'));
  assert.equal(cli.mcpServers['copilot-discussion'].type, 'local');
  const vscode = jc.parse(await fs.readFile(path.join(f.env.APPDATA, 'Code/User/mcp.json'), 'utf8'));
  assert.ok(vscode.servers['copilot-discussion']); assert.equal(vscode.mcpServers, undefined);
  const again = await integrateHosts(f); assert.equal(again.changedFiles, 0);
  const result = await restoreHostIntegration({ ...f, journalFile: first.rollbackFile });
  assert.equal(result.status, 'rolled-back');
  for (const [file, text] of originals) assert.equal(await fs.readFile(file, 'utf8'), text);
  await assert.rejects(fs.access(path.join(f.home, '.agents/skills/copilot-discussion/SKILL.md')));
});

test('升级只更新自有文件并保留用户额外文件；回滚不会覆盖安装后的改动', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.home, '.codex'), { recursive: true });
  await integrateHosts(f);
  const userFile = path.join(f.home, '.agents/skills/copilot-discussion/my-notes.txt'); await write(userFile, '保留');
  await fs.writeFile(path.join(f.skillsRoot, 'SKILL.md'), 'New skill');
  const second = await integrateHosts({ ...f, server: { ...f.server, command: path.join(f.root, 'new-node.exe') }, version: '0.9.1' });
  assert.equal(second.status, 'ready-after-reload'); assert.equal(await fs.readFile(userFile, 'utf8'), '保留');
  const configFile = path.join(f.home, '.codex/config.toml'); await fs.appendFile(configFile, '\n# 安装后的用户修改\n');
  const result = await restoreHostIntegration({ ...f, journalFile: second.rollbackFile });
  assert.equal(result.status, 'rollback-needs-action'); assert.ok((await fs.readFile(configFile, 'utf8')).includes('安装后的用户修改'));
});

test('技能发生用户修改时整个宿主预检不提交，登记不被污染', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.home, '.codex'), { recursive: true });
  await integrateHosts(f);
  const stateFile = path.join(f.home, '.copilot-discussion/host-integrations/state.json');
  const stateBefore = await fs.readFile(stateFile, 'utf8'), configBefore = await fs.readFile(path.join(f.home, '.codex/config.toml'), 'utf8');
  await fs.writeFile(path.join(f.home, '.agents/skills/research-topics/SKILL.md'), '用户定制');
  const result = await integrateHosts({ ...f, server: { ...f.server, command: path.join(f.root, 'new-node.exe') } });
  assert.equal(result.changedFiles, 0); assert.equal(result.status, 'needs-action');
  assert.equal(await fs.readFile(stateFile, 'utf8'), stateBefore);
  assert.equal(await fs.readFile(path.join(f.home, '.codex/config.toml'), 'utf8'), configBefore);
});

test('无宿主、只共享Copilot技能、QwenWork和DSH不会被标记为已配置MCP', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.home, '.copilot/skills'), { recursive: true });
  const detected = await detectHosts({ ...f, pathDirs: [] }); assert.equal(detected.find(h => h.id === 'github-copilot').detected, false);
  assert.equal((await integrateHosts(f)).status, 'no-hosts');
  for (const name of ['.qwenworkcn', '.dsh']) await fs.mkdir(path.join(f.home, name), { recursive: true });
  const result = await integrateHosts(f); assert.equal(result.status, 'needs-action');
  assert.ok(result.results.every(r => r.mcp === 'manual-import' && r.skills === 'installed'));
  assert.equal(await fs.readFile(path.join(f.home, '.qwenworkcn/skills/research-topics/SKILL.md'), 'utf8'), '---\nname: research-topics\n---\nOriginal skill\n');
});

test('配置错误不泄露原文，不影响其他可用宿主', async t => {
  const f = await fixture(t); await write(path.join(f.home, '.claude.json'), '{ "private-token-not-to-log": broken }');
  await fs.mkdir(path.join(f.home, '.codex'), { recursive: true });
  const result = await integrateHosts(f);
  assert.equal(result.results.find(r => r.id === 'claude-code').status, 'needs-action');
  assert.equal(result.results.find(r => r.id === 'codex').status, 'configured');
  assert.ok(!JSON.stringify(result).includes('private-token-not-to-log'));
});

test('并发写入触发回滚，保留并发修改；伪造回滚路径被拒绝', async t => {
  const f = await fixture(t); const file = path.join(f.home, '.codex/config.toml'); await write(file, '# initial\n');
  await assert.rejects(integrateHosts({ ...f, beforeCommit: () => fs.writeFile(file, '# concurrent\n') }), /发生变化/u);
  assert.equal(await fs.readFile(file, 'utf8'), '# concurrent\n');
  await assert.rejects(restoreHostIntegration({ ...f, journalFile: path.join(f.root, 'untrusted/journal.json') }), /备份目录/u);
});

test('未安装目标和符号链接不会被写入', async t => {
  const f = await fixture(t);
  assert.equal((await integrateHosts({ ...f, target: 'claude-code' })).results[0].status, 'not-detected');
  const external = path.join(f.root, 'external'); await fs.mkdir(external);
  await fs.symlink(external, path.join(f.home, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await integrateHosts({ ...f, target: 'codex' });
  assert.equal(result.results[0].status, 'needs-action');
  assert.deepEqual(await fs.readdir(external), []);
});
