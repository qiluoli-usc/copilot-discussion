import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const jc = require('./vendor/jsonc-parser/lib/umd/main.js');
const toml = require('./vendor/smol-toml/dist/index.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
export const HOSTS = JSON.parse(await fs.readFile(path.join(here, 'host-catalog.json'), 'utf8')).hosts;
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const inside = (root, file) => { const r = path.relative(root, file); return r && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
const exists = file => fs.stat(file).then(() => true).catch(e => { if (e.code === 'ENOENT') return false; throw e; });
class IntegrationError extends Error {}
const safeMessage = error => error instanceof IntegrationError ? error.message : `文件操作未完成（${/^[A-Z_]+$/u.test(error.code || '') ? error.code : 'IO_ERROR'}）；保留原设置，请查看本机报告。`;

// Never follow a symlink/junction into another user's configuration or directory.
async function safePath(file) {
  if (!path.isAbsolute(file)) throw new IntegrationError('宿主配置路径必须为绝对路径。');
  let cursor = path.resolve(file);
  for (;;) {
    const stat = await fs.lstat(cursor).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (stat?.isSymbolicLink()) throw new IntegrationError('配置路径包含符号链接或目录联接，未自动改写。');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
async function read(file) {
  await safePath(file);
  const stat = await fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new IntegrationError('配置不是普通文件或超过大小限制，未自动改写。');
  return fs.readFile(file);
}
async function atomic(file, value, previous) {
  await safePath(file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
    const current = await read(file);
    if ((current == null ? null : digest(current)) !== previous) throw new IntegrationError('宿主设置在安装期间发生变化，已停止该次写入。');
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

export function hostPaths(spec, { home = os.homedir(), env = process.env } = {}) {
  const override = spec.homeEnv && env[spec.homeEnv];
  if (override && !path.isAbsolute(override)) throw new IntegrationError('宿主的自定义配置目录不是绝对路径。');
  const root = spec.appData ? path.join(env.APPDATA || path.join(home, 'AppData/Roaming'), spec.appData) : override || path.join(home, spec.home);
  return { root, configFile: spec.configHome ? path.join(home, spec.configHome) : spec.config ? path.join(root, spec.config) : null,
    skillsDir: spec.skillsHome ? path.join(home, spec.skillsHome) : path.join(root, spec.skills),
    customClaude: spec.id === 'claude-code' && override && path.resolve(override) !== path.resolve(home, '.claude') };
}
export async function detectHosts({ home = os.homedir(), env = process.env, pathDirs = (env.PATH || env.Path || '').split(path.delimiter) } = {}) {
  return Promise.all(HOSTS.map(async spec => {
    try {
      const locations = hostPaths(spec, { home, env });
      const evidence = [];
      if (await exists(locations.root)) evidence.push('发现用户配置目录');
      if (locations.configFile && await exists(locations.configFile)) evidence.push('发现宿主配置文件');
      for (const name of spec.commands) {
        const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
        let found = false;
        for (const dir of pathDirs.filter(Boolean)) {
          if (!path.isAbsolute(dir)) continue;
          for (const ext of extensions) if (await exists(path.join(dir, name + ext))) { found = true; break; }
          if (found) break;
        }
        if (found) evidence.push('发现 PATH 启动入口');
      }
      // A shared skills folder alone does not prove that Copilot CLI is installed.
      if (spec.id === 'github-copilot' && evidence.length === 1 && evidence[0] === '发现用户配置目录' && !await exists(path.join(locations.root, 'config.json'))) evidence.length = 0;
      return { id: spec.id, label: spec.label, detected: evidence.length > 0, evidence, ...locations, automaticMcp: spec.format !== 'manual' && !locations.customClaude };
    } catch (error) { return { id: spec.id, label: spec.label, detected: false, evidence: [], automaticMcp: false, message: safeMessage(error) }; }
  }));
}

function jsonDocument(text, comments) {
  const clean = text.replace(/^\uFEFF/u, '');
  const errors = [];
  const tree = jc.parseTree(clean, errors, { allowTrailingComma: comments, disallowComments: !comments });
  const check = node => {
    if (node?.type === 'object') {
      const keys = new Set();
      for (const child of node.children || []) {
        const key = child.children[0].value;
        if (keys.has(key)) throw new IntegrationError('宿主 JSON 含重复键，未自动改写。');
        keys.add(key); check(child.children[1]);
      }
    } else for (const child of node?.children || []) check(child);
  };
  check(tree);
  if (errors.length || tree?.type !== 'object') throw new IntegrationError('宿主 JSON/JSONC 语法或顶层结构无效，未自动改写。');
  return { clean, value: jc.getNodeValue(tree), bom: text.startsWith('\uFEFF') ? '\uFEFF' : '' };
}
const chooseName = servers => {
  for (const name of ['copilot-discussion', 'copilot-discussion-native', ...Array.from({ length: 98 }, (_, i) => 'copilot-discussion-native-' + (i + 2))]) if (!Object.hasOwn(servers, name)) return name;
  throw new IntegrationError('同名 MCP 太多，未自动创建重复连接。');
};
export function mergeJsonConfig(text, server, { format = 'json', key = 'mcpServers', owned } = {}) {
  const doc = jsonDocument(text || '{}\n', format === 'jsonc');
  if (doc.value[key] != null && !object(doc.value[key])) throw new IntegrationError('宿主 MCP 容器不是对象，未自动改写。');
  const servers = doc.value[key] || {};
  let name = owned?.name;
  if (name && Object.hasOwn(servers, name)) {
    if (!object(servers[name]) || !Object.entries(owned.controlled).every(([k, v]) => equal(servers[name][k], v))) throw new IntegrationError('本插件的 MCP 启动项已被手动修改，保留现状。');
  } else if (name) throw new IntegrationError('之前安装的 MCP 已被移除，保留用户选择，不自动恢复。');
  else name = chooseName(servers);
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: doc.clean.includes('\r\n') ? '\r\n' : '\n' };
  let changed = doc.clean;
  if (!Object.hasOwn(servers, name)) changed = jc.applyEdits(changed, jc.modify(changed, [key, name], server, { formattingOptions }));
  else for (const [k, v] of Object.entries(server)) if (!equal(servers[name][k], v)) changed = jc.applyEdits(changed, jc.modify(changed, [key, name, k], v, { formattingOptions }));
  jsonDocument(changed, format === 'jsonc');
  return { text: doc.bom + changed, owned: { name, controlled: server }, collision: name !== 'copilot-discussion' };
}

const begin = '# >>> CopilotDiscussion managed MCP';
const end = '# <<< CopilotDiscussion managed MCP';
export function mergeTomlConfig(text, server, { owned } = {}) {
  let parsed;
  try { parsed = toml.parse(text.replace(/^\uFEFF/u, '')); } catch { throw new IntegrationError('宿主 TOML 语法无效，未自动改写。'); }
  if (parsed.mcp_servers != null && !object(parsed.mcp_servers)) throw new IntegrationError('TOML 的 mcp_servers 不是表，未自动改写。');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let name, oldBlock;
  if (owned) {
    name = owned.name;
    const start = text.indexOf(begin), finish = text.indexOf(end);
    oldBlock = start < 0 || finish < start ? null : text.slice(start, finish + end.length);
    if (!oldBlock || text.indexOf(begin, start + begin.length) >= 0 || digest(oldBlock) !== owned.blockSha256) throw new IntegrationError('本插件的 TOML 配置块已被修改或移除，保留现状。');
  } else {
    if (text.includes(begin) || text.includes(end)) throw new IntegrationError('存在未登记的本插件 TOML 块，保留现状。');
    name = chooseName(parsed.mcp_servers || {});
  }
  const block = [begin, '[mcp_servers.' + name + ']', 'command = ' + JSON.stringify(server.command), 'args = ' + JSON.stringify(server.args), 'tool_timeout_sec = 60', end].join(eol);
  const changed = oldBlock ? text.replace(oldBlock, block) : text + (text.endsWith('\n') || !text ? '' : eol) + eol + block + eol;
  try { toml.parse(changed.replace(/^\uFEFF/u, '')); } catch { throw new IntegrationError('追加 MCP 会与原 TOML 表结构冲突，未自动改写。'); }
  return { text: changed, owned: { name, blockSha256: digest(block) }, collision: name !== 'copilot-discussion' };
}

async function skillPlan(source, destination, previous = {}) {
  const files = [];
  const walk = async (folder, relative = '') => {
    await safePath(folder);
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (['__pycache__', '.venv', 'node_modules', '.git'].includes(entry.name) || /^\.env(?:\.|$)/u.test(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new IntegrationError('技能源包含符号链接，未自动安装。');
      const rel = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), rel);
      else if (entry.isFile()) files.push({ relative: rel, value: await fs.readFile(path.join(folder, entry.name)) });
    }
  };
  await walk(source);
  const changes = [], managed = { ...previous };
  for (const item of files) {
    const file = path.join(destination, ...item.relative.split('/')), before = await read(file);
    if (!before && previous[item.relative]) throw new IntegrationError('之前安装的技能文件已被移除，保留用户选择，不自动恢复。');
    if (before && digest(before) !== digest(item.value) && (!previous[item.relative] || digest(before) !== previous[item.relative])) throw new IntegrationError('同名研究技能包含用户修改，保留原技能；可从产品目录查看新版。');
    if (!before || digest(before) !== digest(item.value)) changes.push({ file, before, after: item.value });
    // Identical, pre-existing user files are reused without taking ownership.
    if (!before || previous[item.relative]) managed[item.relative] = digest(item.value);
  }
  return { changes, managed };
}

function stateRoot(home) { return path.join(home, '.copilot-discussion', 'host-integrations'); }
export async function integrateHosts({ home = os.homedir(), env = process.env, target = 'auto', server, skillsRoot = path.dirname(here), version = '0.9.0', installSkills = true, detectedHosts, onProgress = () => {}, beforeCommit } = {}) {
  if (!object(server) || !path.isAbsolute(server.command) || !Array.isArray(server.args) || !path.isAbsolute(server.args[0])) throw new IntegrationError('自动接入需要已安装的本机绝对路径服务器。');
  if (!['auto', ...HOSTS.map(h => h.id)].includes(target)) throw new IntegrationError('未知宿主。');
  const base = stateRoot(home), stateFile = path.join(base, 'state.json');
  await safePath(stateFile); await fs.mkdir(base, { recursive: true });
  const lockFile = path.join(base, 'integration.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx', 0o600); } catch { throw new IntegrationError('已有宿主接入任务或遗留锁；未改写宿主设置。'); }
  try {
    const originalState = await read(stateFile);
    let state;
    try { state = originalState ? JSON.parse(originalState) : { schemaVersion: 1, configs: {}, skills: {} }; } catch { throw new IntegrationError('自动接入登记文件损坏，保留宿主设置。'); }
    if (state.schemaVersion !== 1 || !object(state.configs) || !object(state.skills)) throw new IntegrationError('自动接入登记格式不支持，保留宿主设置。');
    const hosts = detectedHosts || await detectHosts({ home, env });
    const selected = hosts.filter(h => target === 'auto' ? h.detected : h.id === target);
    const results = [], changes = [], queued = new Set();
    for (const host of selected) {
      const spec = HOSTS.find(s => s.id === host.id);
      const hostState = structuredClone(state);
      const item = { id: host.id, label: host.label, detected: host.detected, mcp: 'not-configured', skills: 'not-installed', message: '', source: spec.source };
      if (!host.detected) { results.push({ ...item, status: 'not-detected', message: '未发现此宿主，已准备本机模板；安装宿主后重新运行配置。' }); continue; }
      const localChanges = [];
      try {
        if (spec.format === 'manual' || host.customClaude) {
          item.mcp = 'manual-import'; item.message = spec.reason || '宿主使用自定义 Claude 配置根目录，需按实际客户端导入生成配置。';
        } else {
          let configFile = host.configFile;
          if (spec.existingConfig) {
            const alternative = path.join(host.root, spec.existingConfig);
            if (await exists(alternative)) {
              if (await exists(configFile)) throw new IntegrationError('发现两个不同位置的 MCP 配置，未猜测生效位置，请在宿主确认。');
              configFile = alternative;
            }
          }
          const before = await read(configFile), text = before?.toString('utf8') || '';
          const own = state.configs[configFile];
          const payload = host.id === 'github-copilot' ? { ...server, type: 'local', tools: ['*'] } : server;
          const merged = spec.format === 'toml' ? mergeTomlConfig(text, payload, { owned: own }) : mergeJsonConfig(text, payload, { owned: own, format: spec.format, key: host.id === 'vscode' ? 'servers' : 'mcpServers' });
          if (text !== merged.text) localChanges.push({ file: configFile, before, after: Buffer.from(merged.text) });
          state.configs[configFile] = merged.owned;
          item.mcp = text === merged.text ? 'reused' : 'configured'; item.configFile = configFile; item.serverName = merged.owned.name;
          if (merged.collision) item.message = '已保留原同名服务器，并使用独立名称接入本插件。';
        }
        if (installSkills && (!spec.skillsRequireExisting || await exists(host.skillsDir))) {
          for (const name of ['copilot-discussion', 'research-topics']) {
            const dest = path.join(host.skillsDir, name);
            if (queued.has(dest)) continue;
            const plan = await skillPlan(path.join(path.dirname(skillsRoot), name), dest, state.skills[dest]);
            localChanges.push(...plan.changes); state.skills[dest] = plan.managed;
          }
          item.skills = 'installed'; item.skillsDir = host.skillsDir;
        } else if (installSkills) { item.skills = 'manual-import'; item.message += ' 未发现该版本的技能目录，请在宿主导入产品目录中的两个技能。'; }
        else item.skills = 'skipped';
        changes.push(...localChanges);
        for (const name of ['copilot-discussion', 'research-topics']) if (item.skillsDir) queued.add(path.join(item.skillsDir, name));
        item.status = item.mcp === 'manual-import' || item.skills === 'manual-import' ? 'needs-action' : 'configured';
      } catch (error) {
        // A failed host preflight must not commit either its MCP or skill edits.
        state = hostState;
        item.mcp = 'preserved'; item.skills = 'preserved'; item.status = 'needs-action'; item.message = safeMessage(error);
      }
      results.push(item);
      onProgress({ stage: 'hosts', action: host.label + '：' + (item.status === 'configured' ? 'MCP与技能已准备' : item.message), at: new Date().toISOString() });
    }
    const stateAfter = Buffer.from(json(state));
    if ((!originalState && changes.length) || (originalState && !originalState.equals(stateAfter))) changes.push({ file: stateFile, before: originalState, after: stateAfter, role: 'state' });
    if (!changes.length) return { status: selected.length ? results.every(r => r.status === 'configured') ? 'ready-after-reload' : 'needs-action' : 'no-hosts', changedFiles: 0, results, detectedHosts: hosts, rollbackFile: null, version };
    const transaction = path.join(base, 'backups', new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID());
    await fs.mkdir(transaction, { recursive: true, mode: 0o700 });
    const journalFile = path.join(transaction, 'journal.json');
    const journal = { schemaVersion: 1, version, phase: 'applying', createdAt: new Date().toISOString(), entries: [] };
    let journalHash = null;
    const saveJournal = async () => { const value = Buffer.from(json(journal)); await atomic(journalFile, value, journalHash); journalHash = digest(value); };
    await saveJournal();
    try {
      await beforeCommit?.();
      for (const change of changes) {
        const beforeHash = change.before == null ? null : digest(change.before), afterHash = digest(change.after);
        if (beforeHash === afterHash) continue;
        const backup = change.before == null ? null : String(journal.entries.length).padStart(5, '0') + '.bin';
        if (backup) await fs.writeFile(path.join(transaction, backup), change.before, { flag: 'wx', mode: 0o600 });
        journal.entries.push({ file: change.file, before: beforeHash, after: afterHash, backup, role: change.role || 'host' });
        await saveJournal();
        await atomic(change.file, change.after, beforeHash);
      }
      journal.phase = 'committed'; await saveJournal();
    } catch (error) {
      journal.phase = 'failed'; await saveJournal();
      const rollback = await restoreHostIntegration({ journalFile, home, env });
      const failure = new IntegrationError(safeMessage(error) + ' 已尝试按校验值回滚；报告：' + rollback.journalFile);
      failure.rollbackFile = rollback.journalFile;
      throw failure;
    }
    return { status: results.every(r => r.status === 'configured') ? 'ready-after-reload' : 'needs-action', changedFiles: journal.entries.length, results, detectedHosts: hosts, rollbackFile: journalFile, version,
      next: '重新加载或重启宿主后使用。宿主自身的工具信任、组织策略及账号登录仍由宿主管理，不自动批准。' };
  } finally { await lock.close(); await fs.unlink(lockFile).catch(() => {}); }
}

export async function restoreHostIntegration({ journalFile, home = os.homedir(), env = process.env } = {}) {
  const base = stateRoot(home);
  if (!path.isAbsolute(journalFile || '') || !inside(path.join(base, 'backups'), journalFile) || path.basename(journalFile) !== 'journal.json') throw new IntegrationError('回滚报告不在本插件的备份目录中。');
  const journal = JSON.parse(await read(journalFile));
  if (journal.schemaVersion !== 1 || !Array.isArray(journal.entries)) throw new IntegrationError('回滚报告格式无效。');
  const roots = HOSTS.map(spec => ({ spec, ...hostPaths(spec, { home, env }) }));
  const allowed = file => file === path.join(base, 'state.json') || roots.some(h => file === h.configFile || (h.spec.existingConfig && file === path.join(h.root, h.spec.existingConfig)) || inside(h.skillsDir, file));
  const results = [];
  const restore = async entry => {
    if (!path.isAbsolute(entry.file || '') || !allowed(entry.file) || !/^[a-f0-9]{64}$/u.test(entry.after) || (entry.before !== null && !/^[a-f0-9]{64}$/u.test(entry.before))) throw new IntegrationError('回滚报告包含未知目标。');
    const current = await read(entry.file), currentHash = current == null ? null : digest(current);
    if (currentHash === entry.before) return { file: entry.file, status: 'already-restored' };
    if (currentHash !== entry.after) return { file: entry.file, status: 'preserved-user-change' };
    if (entry.before === null) { await fs.unlink(entry.file); return { file: entry.file, status: 'restored' }; }
    if (!/^\d{5}\.bin$/u.test(entry.backup || '')) throw new IntegrationError('回滚备份文件名无效。');
    const backup = await read(path.join(path.dirname(journalFile), entry.backup));
    if (!backup || digest(backup) !== entry.before) throw new IntegrationError('回滚备份校验失败。');
    await atomic(entry.file, backup, currentHash);
    return { file: entry.file, status: 'restored' };
  };
  for (const entry of [...journal.entries].reverse().filter(e => e.role !== 'state')) results.push(await restore(entry));
  if (!results.some(r => r.status === 'preserved-user-change')) for (const entry of journal.entries.filter(e => e.role === 'state')) results.push(await restore(entry));
  journal.phase = results.some(r => r.status === 'preserved-user-change') ? 'rollback-needs-action' : 'rolled-back';
  journal.rollback = { at: new Date().toISOString(), results };
  await fs.writeFile(journalFile, json(journal), { mode: 0o600 });
  return { journalFile, status: journal.phase, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] !== 'detect') throw new IntegrationError('此入口仅支持 detect；安装与回滚由图形安装器调用。');
    process.stdout.write(json(await detectHosts()));
  } catch (error) { process.stderr.write(safeMessage(error) + '\n'); process.exitCode = 1; }
}
