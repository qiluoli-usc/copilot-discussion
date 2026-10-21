import { readFileSync, existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export const defaultConfigFile = () => path.join(os.homedir(), '.copilot-discussion', 'config.json');
const keys = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('配置字段无效。本地执行配置不接收 API Key、Token 或其他凭据。');
  }
};
const absolute = (value, name) => {
  if (value != null && (typeof value !== 'string' || !path.isAbsolute(value))) throw new Error(`${name} 必须是绝对路径。`);
};

export function validateSettings(data) {
  keys(data, ['schemaVersion', 'workspaceDir', 'native', 'collection']);
  if (data.schemaVersion !== 1) throw new Error('不支持的配置版本。');
  absolute(data.workspaceDir, 'workspaceDir');
  keys(data.native || {}, ['runtimeRoot', 'pythonLauncher', 'pythonExecutable', 'cdpUrl']);
  absolute(data.native?.runtimeRoot, 'runtimeRoot');
  absolute(data.native?.pythonExecutable, 'pythonExecutable');
  const pythonLauncher = data.native?.pythonLauncher || 'py';
  if (typeof pythonLauncher !== 'string' || !pythonLauncher.trim()) throw new Error('pythonLauncher 无效。');
  const cdpUrl = data.native?.cdpUrl || 'http://127.0.0.1:9222';
  const url = new URL(cdpUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      !url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('cdpUrl 仅支持 http://127.0.0.1:<端口>。');
  keys(data.collection || {}, ['initialWaitMs', 'sliceMs', 'windowMs']);
  const collection = { initialWaitMs: 10000, sliceMs: 10000, windowMs: 600000, ...data.collection };
  for (const [key, limit] of [['initialWaitMs', 15000], ['sliceMs', 15000], ['windowMs', 3600000]]) {
    if (!Number.isInteger(collection[key]) || collection[key] < (key === 'initialWaitMs' ? 0 : 1) || collection[key] > limit) throw new Error(`collection.${key} 超出允许范围。`);
  }
  return { schemaVersion: 1, workspaceDir: data.workspaceDir || null,
    native: { runtimeRoot: data.native?.runtimeRoot || null, pythonLauncher, pythonExecutable: data.native?.pythonExecutable || null, cdpUrl: url.origin }, collection };
}

export function loadSettings({ configFile, workspaceDir, env = process.env } = {}) {
  const file = configFile || env.COPILOT_DISCUSSION_CONFIG || defaultConfigFile();
  absolute(file, 'configFile');
  let data = { schemaVersion: 1 };
  if (existsSync(file)) {
    try { data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')); }
    catch { throw new Error('配置文件不是有效 JSON；请运行 setup.mjs，勿将凭据写入该文件。'); }
  } else if (configFile || env.COPILOT_DISCUSSION_CONFIG) throw new Error('指定的配置文件不存在，请先运行 setup.mjs。');
  // Validate saved fields before merging environment overrides, including keys
  // this execution-only package deliberately does not accept.
  validateSettings(data);
  const value = validateSettings({ ...data, workspaceDir: workspaceDir || env.COPILOT_DISCUSSION_WORKSPACE || data.workspaceDir,
    native: { ...data.native,
      ...(env.JEV_ULTRAFAST_ROOT ? { runtimeRoot: env.JEV_ULTRAFAST_ROOT } : {}),
      ...(env.JEV_PYTHON_LAUNCHER ? { pythonLauncher: env.JEV_PYTHON_LAUNCHER } : {}),
      ...(env.JEV_PYTHON_EXECUTABLE ? { pythonExecutable: env.JEV_PYTHON_EXECUTABLE } : {}),
      ...(env.JEV_CDP_URL ? { cdpUrl: env.JEV_CDP_URL } : {}) } });
  return { ...value, configFile: file, configExists: existsSync(file) };
}

export async function processCheck(command, args) {
  return new Promise(resolve => {
    let finished = false, output = '';
    const finish = (ok, detail) => { if (!finished) { finished = true; clearTimeout(timer); resolve({ ok, detail }); } };
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
    const timer = setTimeout(() => { child.kill(); finish(false, '检查超时'); }, 10000);
    child.stdout.on('data', chunk => { if (output.length < 1000) output += chunk.toString(); });
    child.on('error', () => finish(false, '程序不存在或无法启动'));
    child.on('close', code => finish(code === 0, code === 0 ? output.trim().slice(0, 300) : '版本或模块检查失败'));
  });
}

export async function checkInstallation(settings, { checkPython = true } = {}) {
  const checks = { windows: { ok: process.platform === 'win32', detail: 'Jev Native 当前支持 Windows 本机 Chrome；MCP 协议本身可移植。' },
    node: { ok: Number(process.versions.node.split('.')[0]) >= 20, detail: process.version },
    workspace: { ok: false }, runtime: { ok: false } };
  for (const [name, folder] of [['workspace', settings.workspaceDir], ['runtime', settings.native.runtimeRoot]]) {
    if (folder) checks[name].ok = await fs.stat(folder).then(stat => stat.isDirectory()).catch(() => false);
  }
  if (checks.runtime.ok) checks.runtime.ok = await fs.stat(path.join(settings.native.runtimeRoot, 'jev_ultrafast', 'browser.py')).then(stat => stat.isFile()).catch(() => false);
  if (checkPython) checks.pythonAndDependencies = settings.native.pythonExecutable ?
    await processCheck(settings.native.pythonExecutable, ['-c', 'import sys; sys.path.insert(0,sys.argv[1]); from jev_ultrafast.browser import Browser,StalePage; import browser_harness,httpx; assert sys.version_info >= (3,12); print(sys.version.split()[0])', settings.native.runtimeRoot || '']) :
    await processCheck(settings.native.pythonLauncher, ['-3.12', '-c', 'import sys,uv; print(sys.version.split()[0])']);
  return { ready: Object.values(checks).every(check => check.ok), checks, configFile: settings.configFile,
    configExists: settings.configExists, mode: 'jev-native-executor', decisionModel: false,
    apiKeyRequired: false, browserChecked: false,
    next: 'ready 仅表示本地前提通过；Chrome Allow、登录和原生浏览器检查需另行完成。' };
}
