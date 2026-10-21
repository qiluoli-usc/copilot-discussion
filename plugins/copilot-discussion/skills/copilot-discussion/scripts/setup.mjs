import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { defaultConfigFile, loadSettings, validateSettings, checkInstallation } from './settings.mjs';
import { ensureEnvironment, runProgram } from './bootstrap.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const targets = ['all', 'generic', 'codex', 'claude-code', 'workbuddy', 'dsh', 'qwenwork', 'github-copilot', 'vscode'];
const json = value => JSON.stringify(value, null, 2) + '\n';

export function parseSetupArgs(args) {
  const valueFlags = ['--workspace', '--runtime-root', '--python-launcher', '--cdp-url', '--config', '--output', '--target', '--skills-dir', '--data-dir', '--chrome-offline-installer'];
  const flags = new Set(['--replace', '--install-skills', '--check', '--help', '--no-install', '--isolated', '--configure-only', '--check-browser', '--skip-chrome-install']);
  const parsed = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flags.has(flag)) parsed[flag.slice(2)] = true;
    else if (valueFlags.includes(flag) && args[index + 1] && !args[index + 1].startsWith('--')) parsed[flag.slice(2)] = args[++index];
    else throw new Error('未知安装参数或缺少参数值；不接受API Key参数，使用 --help 查看配置项。');
  }
  if (parsed.target && !targets.includes(parsed.target)) throw new Error('不支持的target；使用 --help 查看宿主列表。');
  return parsed;
}

export function profiles({ node = process.execPath, serverFile = path.join(scriptDir, 'mcp-server.mjs'), configFile }) {
  if (![node, serverFile, configFile].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('启动程序、脚本和配置必须使用绝对路径。');
  const server = { type: 'stdio', command: node, args: [serverFile, '--config', configFile] };
  return {
    mcp: { mcpServers: { 'copilot-discussion': server } },
    github: { mcpServers: { 'copilot-discussion': { ...server, type: 'local', tools: ['*'] } } },
    vscode: { servers: { 'copilot-discussion': server } },
    codex: `[mcp_servers.copilot-discussion]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify(server.args)}\ntool_timeout_sec = 60\n`,
    dsh: `- id: copilot-discussion-mcp\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: copilot-discussion\n    transport: stdio\n    command: ${JSON.stringify(node)}\n    args: ${JSON.stringify(server.args)}\n    toolCallTimeoutMs: 60000\n`
  };
}

async function writeOnceOrSame(file, text, replace) {
  let original;
  try { original = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (original === text) return;
  if (original != null && !replace) throw new Error('目标已有不同配置；保留原文件。确认更新时加 --replace，或选择新的输出目录。');
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (original == null) await fs.writeFile(file, text, { flag: 'wx', mode: 0o600 });
  else {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}

export async function installSkills({ target, skillsDir, sourceRoot = path.dirname(scriptDir) }) {
  const defaults = { codex: '.agents', 'claude-code': '.claude', dsh: '.dsh', qwenwork: '.qwenworkcn', 'github-copilot': '.copilot', vscode: '.copilot' };
  if (!skillsDir && !defaults[target]) throw new Error('此目标请显式指定 --skills-dir；不猜测WorkBuddy目录，也不一次改写多个Agent。');
  const destination = skillsDir || path.join(os.homedir(), defaults[target], 'skills');
  if (!path.isAbsolute(destination)) throw new Error('skills-dir 必须是绝对路径。');
  const sourceParent = path.dirname(sourceRoot);
  const entries = ['copilot-discussion', 'research-topics'];
  // Preflight both targets before copying either. Never overwrite user skills.
  for (const name of entries) {
    const source = path.join(sourceParent, name), targetFolder = path.join(destination, name);
    const relative = path.relative(source, targetFolder);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('不能把技能复制到自身或自身子目录。');
    await fs.access(path.join(source, 'SKILL.md'));
    if (await fs.stat(targetFolder).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('目标技能已存在；请使用宿主更新功能或选择新目录，不覆盖已有技能。');
  }
  await fs.mkdir(destination, { recursive: true });
  for (const name of entries) await fs.cp(path.join(sourceParent, name), path.join(destination, name), {
    recursive: true, force: false, errorOnExist: true,
    filter: source => !source.split(path.sep).some(part => ['__pycache__', 'node_modules', '.venv'].includes(part))
  });
  return entries.map(name => path.join(destination, name));
}

export async function setup(options, { prepareEnvironment = ensureEnvironment } = {}) {
  const startedAt = Number.isFinite(Date.parse(process.env.COPILOT_DISCUSSION_BOOTSTRAP_STARTED_AT)) ? process.env.COPILOT_DISCUSSION_BOOTSTRAP_STARTED_AT : new Date().toISOString();
  const configFile = options.config || defaultConfigFile();
  if (!path.isAbsolute(configFile)) throw new Error('config 必须是绝对路径。');
  if (options.check) return checkInstallation(loadSettings({ configFile }));
  const old = await fs.readFile(configFile, 'utf8').then(value => JSON.parse(value.replace(/^\uFEFF/u, ''))).catch(error => {
    if (error.code === 'ENOENT') return { schemaVersion: 1 };
    throw new Error('原配置无法读取或解析；保留原文件，请选新配置路径。');
  });
  validateSettings(old);
  const workspaceDir = options.workspace || old.workspaceDir;
  if (!workspaceDir || !path.isAbsolute(workspaceDir)) throw new Error('首次安装需要 --workspace 绝对路径。');
  const requestedRuntime = options['runtime-root'] || (options.isolated ? null : old.native?.runtimeRoot || process.env.JEV_ULTRAFAST_ROOT);
  if (requestedRuntime && !path.isAbsolute(requestedRuntime)) throw new Error('runtime-root 必须为绝对路径。');
  // Refuse an unintended configuration rewrite before downloading anything.
  if (old.workspaceDir && old.workspaceDir !== workspaceDir && !options.replace) throw new Error('目标已有不同配置；保留原文件。确认更新时加 --replace。');
  const environment = options['configure-only'] ? { runtimeRoot: requestedRuntime, pythonExecutable: old.native?.pythonExecutable || null, events: [], configuredOnly: true } :
    await prepareEnvironment({ runtimeRoot: requestedRuntime, pythonExecutable: options.isolated ? null : old.native?.pythonExecutable,
      pythonLauncher: options['python-launcher'] || old.native?.pythonLauncher || process.env.JEV_PYTHON_LAUNCHER,
      dataDir: options['data-dir'], isolated: options.isolated, noInstall: options['no-install'], onProgress: options.onProgress });
  const value = validateSettings({ ...old,
    workspaceDir,
    native: { ...old.native, runtimeRoot: environment.runtimeRoot, pythonExecutable: environment.pythonExecutable,
      pythonLauncher: options['python-launcher'] || old.native?.pythonLauncher || process.env.JEV_PYTHON_LAUNCHER || 'py',
      cdpUrl: options['cdp-url'] || old.native?.cdpUrl || 'http://127.0.0.1:9222' } });
  if (!value.native.runtimeRoot) throw new Error('configure-only需要已有runtime-root；常规安装会自动准备运行时。');
  await fs.access(path.join(value.native.runtimeRoot, 'jev_ultrafast', 'browser.py'));
  await fs.mkdir(value.workspaceDir, { recursive: true });
  const outputDir = options.output || path.join(value.workspaceDir, 'output', 'installations', new Date().toISOString().replace(/[:.]/gu, '-'));
  if (!path.isAbsolute(outputDir)) throw new Error('output 必须是绝对路径。');
  const target = options.target || 'all';
  const generated = profiles({ configFile });
  // Adding a successfully probed interpreter is an automatic migration of the
  // same environment; unrelated configuration changes still require --replace.
  const equivalentOld = validateSettings(old);
  const migration = old.workspaceDir && equivalentOld.workspaceDir === value.workspaceDir &&
    equivalentOld.native.runtimeRoot === value.native.runtimeRoot && equivalentOld.native.pythonLauncher === value.native.pythonLauncher &&
    equivalentOld.native.cdpUrl === value.native.cdpUrl && JSON.stringify(equivalentOld.collection) === JSON.stringify(value.collection) &&
    (!equivalentOld.native.pythonExecutable || equivalentOld.native.pythonExecutable === value.native.pythonExecutable);
  await writeOnceOrSame(configFile, json(value), options.replace || migration);
  const files = [['mcp.json', json(generated.mcp)]];
  if (target === 'all' || target === 'codex') files.push(['codex.toml', generated.codex]);
  if (target === 'all' || target === 'dsh') files.push(['dsh.yaml', generated.dsh]);
  if (target === 'all' || target === 'github-copilot') files.push(['github-copilot.json', json(generated.github)]);
  if (target === 'all' || target === 'vscode') files.push(['vscode-mcp.json', json(generated.vscode)]);
  files.push(['INSTALL.md', `# 本机安装信息

配置：${configFile}
工作区：${value.workspaceDir}
Jev：${value.native.runtimeRoot}
模式：jev-native-executor；无需Jev API Key。
Python：${value.native.pythonExecutable || value.native.pythonLauncher}
运行时：安装器检测并按需复用/补齐；本次详情见environment记录。

- WorkBuddy / QwenWork桌面：在自定义MCP中导入mcp.json。
- Claude Code：用claude mcp add-json导入mcpServers内的单个服务器对象；或加载源包的.claude-plugin插件。
- Codex：合并codex.toml片段；不要覆盖原配置。
- DSH：将dsh.yaml作为一个mcp-client配置项合入自己的overlay；不是DSH原生插件清单。
- GitHub Copilot CLI：合并github-copilot.json到用户MCP配置；也可安装源包的Agent Plugins插件。
- VS Code GitHub Copilot：合并vscode-mcp.json的servers对象到本地Windows的.vscode/mcp.json。
- 可选Skill安装：setup.mjs --install-skills --target <宿主>，或按宿主UI导入源包skills中的两个目录。

Node：${process.execPath}
服务器：${path.join(scriptDir, 'mcp-server.mjs')}
检查：使用上述Node启动同目录setup.mjs --check --config "${configFile}"。

工具连接后先discussion_doctor；首次Chrome Allow与Microsoft登录由用户完成。宿主负责免费公开资料检索、选题及逐轮理解，服务只执行、采集和留档。仅支持Windows本地Native；云端/网页沙箱不能直接访问本机Chrome。
同一个runFile仅由一个宿主控制。接续前暂停并断开原连接，新宿主读取完整记录、恢复同一runFile，不另建会话。
`]);
  for (const [name, content] of files) await writeOnceOrSame(path.join(outputDir, name), content, options.replace);
  let browser = { checked: false, ready: null, next: '首次运行需在Chrome启用远程调试并点击Allow；Microsoft登录由用户完成。' };
  if (!options['configure-only']) {
    const chrome = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptDir, 'chrome-setup.ps1'), ...(options['no-install'] || options['skip-chrome-install'] ? ['-NoInstall'] : []), ...(options['chrome-offline-installer'] ? ['-OfflineInstaller', options['chrome-offline-installer']] : [])], { timeoutMs: 240000 });
    try { browser.chrome = JSON.parse(chrome.output); } catch { browser.chrome = { status: 'needs_action', reason: '无法检测或自动安装Chrome，请手动安装Google Chrome。' }; }
    if (options['check-browser'] && browser.chrome.status === 'installed') {
      options.onProgress?.({ stage: 'browser', action: 'Chrome可能显示Allow；请手动授权，不关闭已有标签页。', at: new Date().toISOString() });
      try {
        const { JevNativeTransport } = await import('./jev-native.mjs');
        const transport = await JevNativeTransport.launch({ runtimeRoot: value.native.runtimeRoot, pythonExecutable: value.native.pythonExecutable,
          launcher: value.native.pythonLauncher, cdpUrl: value.native.cdpUrl });
        browser = { ...browser, checked: true, ready: true, provenance: transport.readyInfo.provenance };
        await transport.dispose();
      } catch { browser = { ...browser, checked: true, ready: false, next: 'Chrome未就绪：打开chrome://inspect/#remote-debugging，启用远程调试并批准Allow；然后重新检查。' }; }
    }
  }
  const environmentFile = path.join(outputDir, await fs.stat(path.join(outputDir, 'environment.json')).then(() => true).catch(() => false) ? `environment-${Date.now()}.json` : 'environment.json');
  const timing = { startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(startedAt),
    nodeAction: process.env.COPILOT_DISCUSSION_BOOTSTRAP_NODE_ACTION || 'existing-process', nodeVersion: process.version };
  await writeOnceOrSame(environmentFile, json({ environment, browser, timing }), false);
  await writeOnceOrSame(path.join(path.dirname(configFile), 'launcher.json'), json({ schemaVersion: 1, nodeExecutable: process.execPath }), true);
  const skills = options['install-skills'] ? await installSkills({ target, skillsDir: options['skills-dir'] }) : [];
  return { configured: true, configFile, outputDir, files: [...files.map(([name]) => path.join(outputDir, name)), environmentFile], skills,
    mode: 'jev-native-executor', apiKeyRequired: false, decisionModel: false, clientSettingsModified: false, environment, browser, timing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseSetupArgs(process.argv.slice(2));
    if (options.help) console.log(`node setup.mjs --workspace <绝对工作区> [--runtime-root <已有或新Jev目录>] [--data-dir <用户依赖目录>] [--config <绝对JSON路径>] [--python-launcher <py或py.exe路径>] [--cdp-url http://127.0.0.1:9222] [--target ${targets.join('|')}] [--output <绝对目录>] [--install-skills --skills-dir <绝对目录>] [--replace] [--no-install] [--isolated] [--configure-only] [--check-browser] [--skip-chrome-install]\nnode setup.mjs --check [--config <绝对JSON路径>]\n默认检测、复用或安装用户目录中的Jev与依赖；不接收、不保存API Key。`);
    else console.log(json(await setup({ ...options, onProgress: item => process.stderr.write(JSON.stringify(item) + '\n') })));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
