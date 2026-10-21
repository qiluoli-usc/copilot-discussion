import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));
export const LOCK = JSON.parse(await fs.readFile(path.join(scripts, 'runtime-lock.json'), 'utf8'));
export const defaultDataDir = (env = process.env) => path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CopilotDiscussion');
export const within = (root, file) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('安装路径必须位于专用数据目录内。');
  return path.resolve(file);
};
export const exists = file => fs.stat(file).then(stat => stat.isFile()).catch(() => false);

// No shell, raw stderr, environment dump or command-line echo. Subprocess
// diagnostics may contain proxy credentials; reports retain only bounded codes.
export async function runProgram(command, args, { env = process.env, timeoutMs = 600000 } = {}) {
  return new Promise(resolve => {
    let output = '', settled = false;
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const done = (ok, code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok, code, output: ok ? output.trim() : '' }); } };
    const timer = setTimeout(() => { child.kill(); done(false, 'timeout'); }, timeoutMs);
    child.stdout.on('data', chunk => { if (output.length < 16000) output += chunk.toString(); });
    child.stderr.on('data', () => {});
    child.on('error', () => done(false, 'unavailable'));
    child.on('close', code => done(code === 0, code));
  });
}

export async function downloadVerified(asset, destination, { fetcher } = {}) {
  if (!/^https:\/\//u.test(asset.url) || !/^[a-f0-9]{64}$/u.test(asset.sha256)) throw new Error('下载来源或校验值无效。');
  if (await exists(destination)) {
    if (createHash('sha256').update(await fs.readFile(destination)).digest('hex') === asset.sha256) return { reused: true };
    throw new Error('已有下载文件校验失败；保留现场，请使用新数据目录。');
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.partial`;
  if (!fetcher && process.platform === 'win32') {
    try {
      // Windows PowerShell respects OS proxy/certificate configuration, unlike
      // an unconfigured Node fetch. No certificate checks are bypassed.
      const result = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'download.ps1'), '-Url', asset.url, '-Destination', temporary], { timeoutMs: 200000 });
      if (!result.ok) throw new Error('安装包下载失败；请检查网络或Windows代理后重新运行。');
      if ((await fs.stat(temporary)).size > 150 * 1024 * 1024 || createHash('sha256').update(await fs.readFile(temporary)).digest('hex') !== asset.sha256) throw new Error('下载文件SHA256或大小不匹配，未执行安装包。');
      await fs.rename(temporary, destination);
      return { reused: false };
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  fetcher ||= fetch;
  const response = await fetcher(asset.url, { signal: AbortSignal.timeout(180000), redirect: 'follow' });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）；可重新运行安装。`);
  const handle = await fs.open(temporary, 'wx');
  const digest = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 150 * 1024 * 1024) throw new Error('安装包超过允许大小。');
      digest.update(chunk); await handle.write(chunk);
    }
    await handle.close();
    if (digest.digest('hex') !== asset.sha256) throw new Error('下载文件SHA256不匹配，未执行安装包。');
    await fs.rename(temporary, destination);
  } finally { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
  return { reused: false, bytes: size };
}

const PROBE = `import sys,json,importlib.metadata,hashlib,pathlib
sys.path.insert(0,sys.argv[1])
from jev_ultrafast.browser import Browser,StalePage
import browser_harness,httpx
p=pathlib.Path(sys.modules[Browser.__module__].__file__)
assert sys.version_info >= (3,12)
print(json.dumps({'pythonExecutable':sys.executable,'browserHarness':importlib.metadata.version('browser-harness'),'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest()}))`;

export async function probeRuntime(runtimeRoot, pythonExecutable, { run = runProgram, env } = {}) {
  if (!runtimeRoot || !await exists(path.join(runtimeRoot, 'jev_ultrafast', 'browser.py'))) return null;
  const python = pythonExecutable || path.join(runtimeRoot, '.venv', 'Scripts', 'python.exe');
  const result = await run(python, ['-c', PROBE, runtimeRoot], { env: { ...(env || process.env), PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }, timeoutMs: 20000 });
  if (!result.ok) return null;
  try { const value = JSON.parse(result.output); return path.isAbsolute(value.pythonExecutable) ? value : null; } catch { return null; }
}

export async function ensureEnvironment(options = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') throw new Error('Jev Native自动安装当前支持Windows；此宿主必须在Windows本机运行。');
  const run = deps.run || runProgram, download = deps.download || downloadVerified;
  const env = deps.env || process.env, onProgress = options.onProgress || (() => {});
  const dataDir = options.dataDir || defaultDataDir(env);
  if (!path.isAbsolute(dataDir)) throw new Error('data-dir 必须为绝对路径。');
  const events = [];
  const event = (stage, action) => { const item = { stage, action, at: new Date().toISOString() }; events.push(item); onProgress(item); };
  // Reuse before creating directories, downloading or invoking uv sync.
  const requested = options.runtimeRoot || env.JEV_ULTRAFAST_ROOT;
  if (requested && !path.isAbsolute(requested)) throw new Error('runtimeRoot 必须为绝对路径。');
  const managed = path.join(dataDir, 'runtimes', `jev-${LOCK.jev.commit.slice(0, 12)}`);
  let runtimeRoot = requested || managed;
  const candidates = [...new Set([requested, options.isolated ? null : managed].filter(Boolean))];
  for (const root of candidates) {
    const probe = await probeRuntime(root, options.pythonExecutable, { run, env });
    if (probe) { event('runtime', 'reused'); return { runtimeRoot: root, ...probe, dataDir, reused: true, events }; }
  }
  if (options.noInstall) throw new Error('现有Jev运行时或依赖不完整；未安装任何内容。去掉 --no-install 可自动补齐。');
  await fs.mkdir(dataDir, { recursive: true });
  const canonicalData = await fs.realpath(dataDir);
  const lockFile = path.join(canonicalData, 'install.lock');
  let installationLock;
  try { installationLock = await fs.open(lockFile, 'wx'); }
  catch { throw new Error('该数据目录已有安装任务或遗留锁；确认原进程结束后使用新的数据目录。'); }
  try {
  const cache = within(canonicalData, path.join(canonicalData, 'downloads'));
  const processEnv = { ...env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', UV_NO_PROGRESS: '1', UV_NO_ENV_FILE: '1',
    ...(options.isolated ? { UV_PYTHON_PREFERENCE: 'only-managed' } : {}),
    UV_CACHE_DIR: path.join(canonicalData, 'cache'), UV_PYTHON_INSTALL_DIR: path.join(canonicalData, 'python') };
  let uv;
  if (!options.isolated) {
    for (const candidate of [{ command: 'uv', args: [] }, { command: options.pythonLauncher || 'py', args: ['-3.12', '-m', 'uv'] }]) {
      if ((await run(candidate.command, [...candidate.args, '--version'], { env: processEnv, timeoutMs: 10000 })).ok) { uv = candidate; event('uv', 'reused'); break; }
    }
  }
  if (!uv) {
    const arch = deps.arch || process.arch, asset = LOCK.uv[arch];
    if (!asset) throw new Error('自动安装只提供Windows x64/arm64包。');
    const folder = within(canonicalData, path.join(canonicalData, 'tools', `uv-${LOCK.uv.version}-${arch}`));
    const executable = path.join(folder, 'uv.exe');
    if (!await exists(executable)) {
      event('uv', 'downloading');
      const zip = path.join(cache, `uv-${LOCK.uv.version}-${arch}.zip`);
      await download(asset, zip);
      await fs.mkdir(path.dirname(folder), { recursive: true });
      const extracted = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'expand-archive.ps1'), '-Archive', zip, '-Destination', folder], { env: processEnv });
      if (!extracted.ok) throw new Error('uv解压失败；保留缓存，请检查安装目录权限。');
    }
    if (!(await run(executable, ['--version'], { env: processEnv })).ok) throw new Error('uv安装验证失败。');
    uv = { command: executable, args: [] }; event('uv', 'managed');
  }
  const uvRun = args => run(uv.command, [...uv.args, ...args], { env: processEnv });
  if (!requested) runtimeRoot = within(canonicalData, path.join(canonicalData, 'runtimes', `jev-${LOCK.jev.commit.slice(0, 12)}`));
  if (!await exists(path.join(runtimeRoot, 'jev_ultrafast', 'browser.py'))) {
    // Never replace a pre-existing, unknown folder, including explicit roots.
    if (await fs.stat(runtimeRoot).then(() => true).catch(() => false)) throw new Error('目标运行时目录已存在但不完整；保留原目录，请指定新的空路径。');
    event('runtime', 'downloading');
    const zip = path.join(cache, `jev-${LOCK.jev.commit}.zip`);
    await download(LOCK.jev, zip);
    const staging = within(canonicalData, path.join(canonicalData, 'staging', randomUUID()));
    await fs.mkdir(path.dirname(staging), { recursive: true });
    const extracted = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'expand-archive.ps1'), '-Archive', zip, '-Destination', staging], { env: processEnv });
    if (!extracted.ok) throw new Error('Jev解压失败，未改写已有运行时。');
    await fs.mkdir(path.dirname(runtimeRoot), { recursive: true });
    // The verified source directory is owned staging; target is either inside
    // canonicalData or the exact explicit absolute runtimeRoot requested.
    const from = within(staging, path.join(staging, LOCK.jev.folder));
    if (!path.isAbsolute(runtimeRoot)) throw new Error('runtimeRoot 必须是绝对路径。');
    await fs.rename(from, runtimeRoot);
    await fs.rmdir(staging); event('runtime', 'installed');
  }
  event('python', 'resolving');
  // uv reuses an available compatible Python; if absent it downloads managed
  // Python into our user data directory, never replacing system Python.
  const sync = await uvRun(['sync', '--project', runtimeRoot, '--python', '3.12', '--no-dev', '--locked']);
  if (!sync.ok) throw new Error(`Jev依赖安装未完成（${sync.code}）；保留环境和缓存，可重新运行。`);
  const probe = await probeRuntime(runtimeRoot, null, { run, env: processEnv });
  if (!probe) throw new Error('依赖已同步，但Jev导入验证失败；保留环境，请检查网络/系统版本。');
  event('dependencies', 'verified');
  return { runtimeRoot, ...probe, dataDir: canonicalData, reused: false, events };
  } finally { await installationLock.close(); await fs.unlink(lockFile).catch(() => {}); }
}
