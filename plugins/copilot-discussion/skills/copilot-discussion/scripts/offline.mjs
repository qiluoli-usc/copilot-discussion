import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { within, probeRuntime, runProgram } from './bootstrap.mjs';

export function bundlePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('离线包包含无效相对路径。');
  return within(root, path.join(root, ...relative.split('/')));
}

export async function verifyBundle(root, { platform = process.platform, arch = process.arch, onProgress = () => {} } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'bundle.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.platform !== platform || manifest.arch !== arch || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('离线安装包不支持此系统或架构；当前提供Windows x64。');
  const seen = new Set();
  for (const item of manifest.files) {
    const file = bundlePath(root, item.path);
    if (seen.has(item.path.toLowerCase()) || !/^[a-f0-9]{64}$/u.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error('离线包清单无效。');
    seen.add(item.path.toLowerCase());
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || createHash('sha256').update(await fs.readFile(file)).digest('hex') !== item.sha256) throw new Error(`离线包文件校验失败：${item.path}`);
  }
  for (const key of ['node', 'uv', 'python', 'requirements', 'browserSource', 'chrome']) {
    const relative = manifest.paths?.[key];
    bundlePath(root, relative);
    if (!seen.has(relative.toLowerCase())) throw new Error(`离线包缺少组件：${key}`);
  }
  onProgress({ stage: 'bundle', action: 'verified', at: new Date().toISOString() });
  return manifest;
}

// The interpreter in the payload is a clean, relocatable python-build-standalone
// distribution. A venv is CREATED on the destination PC, never copied from the
// builder. uv is forced offline, with only bundled wheels and locked hashes.
export async function prepareOfflineEnvironment(options, { run = runProgram } = {}) {
  const { bundleDir, manifest, dataDir, onProgress = () => {} } = options;
  if (!path.isAbsolute(dataDir) || !path.isAbsolute(bundleDir)) throw new Error('离线安装目录必须为绝对路径。');
  const events = [];
  const event = (stage, action) => { const value = { stage, action, at: new Date().toISOString() }; events.push(value); onProgress(value); };
  const managed = path.join(dataDir, 'runtimes', `jev-${manifest.jevCommit.slice(0, 12)}`);
  const candidates = [...new Set([options.runtimeRoot, managed].filter(Boolean))];
  for (const root of candidates) {
    const probe = await probeRuntime(root, root === options.runtimeRoot ? options.pythonExecutable : null, { run });
    if (probe) { event('runtime', 'reused'); return { ...probe, runtimeRoot: root, dataDir, reused: true, offline: true, events }; }
  }
  await fs.mkdir(dataDir, { recursive: true });
  const canonical = await fs.realpath(dataDir);
  const runtimeRoot = within(canonical, path.join(canonical, 'runtimes', `jev-${manifest.jevCommit.slice(0, 12)}`));
  const lockFile = path.join(canonical, 'install.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx'); } catch { throw new Error('已有安装任务或遗留安装锁；保留原环境，请确认原任务已结束。'); }
  try {
    const marker = path.join(runtimeRoot, '.copilot-offline.json');
    const existing = await fs.stat(runtimeRoot).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
    if (existing) {
      const owned = await fs.readFile(marker, 'utf8').then(JSON.parse).catch(() => null);
      if (owned?.jevCommit !== manifest.jevCommit || owned?.bundleVersion !== manifest.version) throw new Error('已有未知或不完整运行时；保留原目录，请选择新的安装目录。');
    } else {
      const source = path.dirname(path.dirname(bundlePath(bundleDir, manifest.paths.browserSource)));
      await fs.mkdir(path.dirname(runtimeRoot), { recursive: true });
      await fs.cp(source, runtimeRoot, { recursive: true, force: false, errorOnExist: true });
      await fs.writeFile(marker, JSON.stringify({ jevCommit: manifest.jevCommit, bundleVersion: manifest.version }) + '\n', { flag: 'wx' });
      event('runtime', 'copied');
    }
    const cleanEnv = { ...process.env, UV_OFFLINE: '1', UV_PYTHON_DOWNLOADS: 'never', UV_NO_CONFIG: '1', UV_NO_ENV_FILE: '1', UV_NO_PROGRESS: '1',
      UV_CACHE_DIR: path.join(canonical, 'offline-cache'), PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
    // The offline runtime does not inherit user Python modules/virtualenvs.
    for (const name of ['VIRTUAL_ENV', 'CONDA_PREFIX', 'PYTHONHOME', 'PYTHONPATH', 'UV_PROJECT_ENVIRONMENT', 'UV_PYTHON']) delete cleanEnv[name];
    const uv = bundlePath(bundleDir, manifest.paths.uv), python = bundlePath(bundleDir, manifest.paths.python);
    const venv = path.join(runtimeRoot, '.venv'), executable = path.join(venv, 'Scripts', 'python.exe');
    if (!await fs.stat(executable).then(s => s.isFile()).catch(() => false)) {
      event('python', 'creating');
      const made = await run(uv, ['venv', '--offline', '--no-config', '--no-project', '--python', python, venv], { env: cleanEnv });
      if (!made.ok) throw new Error(`离线Python环境创建失败（${made.code}）；未改动系统Python。`);
    }
    event('dependencies', 'installing-offline');
    const installed = await run(uv, ['pip', 'sync', '--offline', '--no-config', '--python', executable, '--no-index', '--find-links', path.join(bundleDir, 'wheels'), '--require-hashes', bundlePath(bundleDir, manifest.paths.requirements)], { env: cleanEnv });
    if (!installed.ok) throw new Error(`离线依赖安装失败（${installed.code}）；没有转为联网下载。`);
    const probe = await probeRuntime(runtimeRoot, executable, { run, env: cleanEnv });
    if (!probe) throw new Error('离线环境导入验证失败；请保留安装报告。');
    event('dependencies', 'verified');
    return { ...probe, runtimeRoot, dataDir: canonical, reused: false, offline: true, events };
  } finally { await lock.close(); await fs.unlink(lockFile).catch(() => {}); }
}
