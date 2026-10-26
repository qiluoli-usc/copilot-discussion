import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const inside = (root, target) => { const rel = path.relative(root, target); return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
export async function safePath(file) {
  if (!path.isAbsolute(file)) throw new Error('请使用完整文件路径。');
  for (let cursor = path.resolve(file);;) {
    const stat = await fs.lstat(cursor).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (stat?.isSymbolicLink()) throw new Error('路径经过链接或目录联接，已停止，保留原文件。');
    const parent = path.dirname(cursor); if (parent === cursor) return;
    cursor = parent;
  }
}
export async function read(file) {
  await safePath(file);
  return fs.readFile(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
}
export async function atomic(file, value, expected) {
  await safePath(file); await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, value, { flag: 'wx', mode: 0o600 });
    if (expected !== undefined) { const current = await read(file); if ((current === null ? null : hash(current)) !== expected) throw new Error('文件在操作期间发生变化，已保留，请重试。'); }
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export async function locked(folder, action) {
  const file = path.join(folder, 'maintenance.lock'); await safePath(file); await fs.mkdir(folder, { recursive: true });
  let handle;
  try { handle = await fs.open(file, 'wx', 0o600); } catch { throw new Error('已有安装或维护任务在运行。请等它结束后重试；异常退出时先确认进程结束，再移除 maintenance.lock。'); }
  try { return await action(); } finally { await handle.close(); await fs.unlink(file); }
}
export async function packageEntries(root) {
  const results = [];
  const walk = async (folder, relative = '') => {
    await safePath(folder);
    for (const item of (await fs.readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git', '__pycache__', '.venv'].includes(item.name) || /^\.env(?:\.|$)/u.test(item.name) || item.name.endsWith('.pyc')) continue;
      const rel = relative ? relative + '/' + item.name : item.name, source = path.join(folder, item.name);
      if (item.isSymbolicLink()) throw new Error('安装包包含文件链接，未执行。');
      if (item.isDirectory()) await walk(source, rel);
      else if (item.isFile()) results.push({ path: rel, bytes: await fs.readFile(source) });
    }
  };
  for (const name of ['package.json', 'README.md', 'bin', 'cli', 'skills', 'guides', '.codex-plugin', '.claude-plugin', 'plugin.json', 'mcp.json']) {
    const item = path.join(root, name), stat = await fs.lstat(item).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!stat) throw new Error('安装包缺少 ' + name + '，请重新获取完整包。');
    if (stat.isSymbolicLink()) throw new Error('安装包包含目录链接。');
    if (stat.isDirectory()) await walk(item, name); else results.push({ path: name, bytes: await fs.readFile(item) });
  }
  return results.sort((a,b) => a.path.localeCompare(b.path));
}
export async function installProduct(source, store, { repair = false, registered } = {}) {
  const entries = await packageEntries(source), meta = JSON.parse(entries.find(e => e.path === 'package.json').bytes);
  if (meta.name !== 'copilot-discussion' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(meta.version)) throw new Error('不是受支持的Copilot讨论安装包。');
  const fingerprint = hash(entries.map(e => e.path + '\0' + hash(e.bytes)).join('\n'));
  const directory = path.join(store, 'versions', meta.version + '-' + fingerprint.slice(0, 12));
  await safePath(directory);
  const manifest = { version: meta.version, fingerprint, files: entries.map(e => ({ path: e.path, sha256: hash(e.bytes) })) };
  const previous = await read(path.join(directory, 'installed-files.json'));
  const knownRepair = repair && registered?.status === 'active' && registered.directory === directory && registered.fingerprint === fingerprint;
  if (previous || knownRepair) {
    let valid = false; try { valid = JSON.parse(previous).fingerprint === fingerprint; } catch { /* explicitly repair a known manifest only */ }
    if (!valid && !knownRepair) throw new Error('已安装产品登记不一致，已保留。请使用同一版本运行repair。');
    for (const item of entries) { const current = await read(path.join(directory, ...item.path.split('/'))); if (!current || hash(current) !== hash(item.bytes)) await atomic(path.join(directory, ...item.path.split('/')), item.bytes, current ? hash(current) : null); }
    if (!valid) await atomic(path.join(directory,'installed-files.json'),json(manifest),previous ? hash(previous) : null);
    return { directory, version: meta.version, fingerprint, repaired: true };
  }
  if (await fs.stat(directory).then(() => true).catch(() => false)) throw new Error('目标产品目录已存在但未登记，已保留。');
  const staging = path.join(store, 'staging', randomUUID()); await safePath(staging); await fs.mkdir(staging, { recursive: true });
  for (const item of entries) { const file = path.join(staging, ...item.path.split('/')); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, item.bytes, { flag: 'wx' }); }
  await fs.writeFile(path.join(staging, 'installed-files.json'), json(manifest));
  await fs.mkdir(path.dirname(directory), { recursive: true }); await fs.rename(staging, directory);
  return { directory, version: meta.version, fingerprint, repaired: false };
}
