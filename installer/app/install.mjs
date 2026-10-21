import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setup, installSkills } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/setup.mjs';
import { verifyBundle, prepareOfflineEnvironment } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/offline.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const progress = item => process.stdout.write(JSON.stringify({ type: 'progress', ...item }) + '\n');
const escape = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function guide(result, host) {
  const profiles = result.files.filter(file => /\.(json|toml|yaml)$/u.test(file) && !file.includes('environment'));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Copilot 主题讨论 · 安装完成</title>
<style>body{font:16px/1.7 'Microsoft YaHei',sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#182635;background:#f5f7fb}h1{font-size:28px}section{background:white;padding:22px 28px;border:1px solid #dce3ed;border-radius:12px;margin:20px 0}a{color:#1558b0}pre{white-space:pre-wrap;word-break:break-all;background:#eef2f7;padding:16px}textarea{width:100%;height:180px;font:13px Consolas,monospace}button{padding:9px 18px;cursor:pointer}small{color:#56677b}</style>
<h1>Copilot 主题讨论已安装</h1><p>Jev Native 执行浏览器动作；当前宿主负责免费资料检索、选题和持续追问。默认无需 Jev API Key。</p>
<section><h2>1. 完成 Chrome 授权</h2><p>在 Google Chrome 地址栏打开 <strong>chrome://inspect/#remote-debugging</strong>，启用远程调试。首次工具连接时点击 Chrome 的 <strong>Allow / 允许</strong>。然后打开 <a href="https://copilot.cloud.microsoft/chat">Microsoft 365 Copilot</a>，由你完成登录。</p><p>${escape(result.browser.chrome?.status === 'installed' ? '已找到 Google Chrome。' : 'Chrome 尚未就绪，可在安装向导中启用随包 Chrome 安装，或手动安装后再检查。')}</p></section>
<section><h2>2. 接入你的 Agent</h2><p>本次选择：<strong>${escape(host)}</strong>。下面的配置已使用这台电脑的实际路径。无需在命令行安装运行时。</p><ul>
<li>WorkBuddy / QwenWork：设置 → MCP / 连接器 → 自定义 MCP，粘贴下面的通用配置；若要求单个服务器对象，使用 <code>mcpServers.copilot-discussion</code> 的内容。</li>
<li>GitHub Copilot CLI：在客户端的 MCP 配置中合并 <code>github-copilot.json</code>；支持插件的客户端也可导入安装目录内的 <code>product/plugins/copilot-discussion</code>。</li>
<li>VS Code GitHub Copilot：在 MCP 配置编辑器中合并 <code>vscode-mcp.json</code> 的 <code>servers</code> 对象。</li>
<li>Codex：在本地设置的 MCP 配置中合并 <code>codex.toml</code>；插件导入使用产品目录中的本地插件来源。</li>
<li>Claude Code：使用本地插件来源 <code>product</code>，或其 MCP 配置功能导入通用服务器对象。</li>
<li>DSH：将 <code>dsh.yaml</code> 项合入自己的 overlay。</li></ul>
<p>保留原有 MCP 服务器设置。宿主的具体界面以其当前版本为准；账号、客户端和订阅由宿主提供。</p><p>${escape(result.skillStatus.message)}</p>
${profiles.map(file => `<p><a href="${escape(pathToFileURL(file).href)}">${escape(path.basename(file))}</a></p>`).join('')}
<p>所选宿主配置（${escape(result.profileFile)}）：</p><textarea id="config" readonly>${escape(result.profileText)}</textarea><p><button onclick="const t=document.getElementById('config');t.select();try{document.execCommand('copy')}catch(e){}">选择并复制此配置</button></p><p>如果界面只要求单个服务器对象，复制下面这一段：</p><textarea id="server" readonly>${escape(result.serverObjectText)}</textarea><p><button onclick="const t=document.getElementById('server');t.select();try{document.execCommand('copy')}catch(e){}">复制单个服务器对象</button></p></section>
<section><h2>3. 开始研究</h2><p>启用同包的 <code>copilot-discussion</code> 和 <code>research-topics</code> 两个技能，然后对宿主说：</p><pre>用 Jev Native，从免费公开资料自主选题，与 Copilot 持续讨论，不限制轮数，最后给我结论、分歧、完整问答和分阶段实际耗时。</pre><p>先运行 <code>discussion_doctor</code> 检查，再开始研究。每轮基于最新回答追问；后台持续采集，关闭主持任务后不会继续生成新问题。</p></section>
<section><h2>本机文件</h2><p>工作区：${escape(result.workspaceDir)}<br>配置：${escape(result.configFile)}<br>接入模板：${escape(result.outputDir)}<br>安装至配置完成耗时：${(result.timing.elapsedMs / 1000).toFixed(3)} 秒</p><p>完整问答、证据和计时会写入工作区的 <code>output/research-runs</code>。软件可离线安装，公开资料检索与 Copilot 对话需要联网。</p><p><a href="${escape(pathToFileURL(path.join(packageRoot, 'product/docs/installation.md')).href)}">详细安装说明</a> · <a href="${escape(pathToFileURL(path.join(packageRoot, 'notices/THIRD-PARTY.html')).href)}">第三方组件与许可</a></p></section></html>`;
}

export async function install(request) {
  for (const key of ['workspace', 'dataDir', 'config', 'output']) if (typeof request[key] !== 'string' || !path.isAbsolute(request[key])) throw new Error(`安装参数${key}必须为绝对路径。`);
  if (request.installerStartedAt && Number.isFinite(Date.parse(request.installerStartedAt))) process.env.COPILOT_DISCUSSION_BOOTSTRAP_STARTED_AT = request.installerStartedAt;
  const manifest = await verifyBundle(packageRoot, { onProgress: progress });
  const result = await setup({ workspace: request.workspace, config: request.config, output: request.output, target: 'all',
    'data-dir': request.dataDir, replace: true, onProgress: progress, isolated: request.reuseEnvironment === false,
    'skip-chrome-install': !request.installChrome, 'chrome-offline-installer': request.installChrome ? path.join(packageRoot, ...manifest.paths.chrome.split('/')) : undefined,
    'check-browser': false }, { prepareEnvironment: options => prepareOfflineEnvironment({ ...options, bundleDir: packageRoot, manifest }) });
  let skillStatus = { installed: [], message: '研究技能保存在产品目录的 plugins/copilot-discussion/skills；可在宿主界面中导入两个技能文件夹。' };
  if (request.installSkills && !['all', 'generic'].includes(request.host)) {
    const defaults = { codex: '.agents', 'claude-code': '.claude', dsh: '.dsh', qwenwork: '.qwenworkcn', 'github-copilot': '.copilot', vscode: '.copilot' };
    const destination = request.skillsDir || (defaults[request.host] ? path.join(os.homedir(), defaults[request.host], 'skills') : null);
    if (!destination || !path.isAbsolute(destination)) throw new Error('此宿主安装技能需要选择实际技能目录。');
    const occupied = await Promise.all(['copilot-discussion', 'research-topics'].map(name => fs.stat(path.join(destination, name)).then(() => true).catch(() => false)));
    if (occupied.some(Boolean)) skillStatus.message = '目标已有研究技能，保留原目录。请在宿主中更新或导入本次安装的产品目录。';
    else { skillStatus.installed = await installSkills({ target: request.host, skillsDir: destination }); skillStatus.message = '已安装两个研究技能；重新加载宿主后生效。'; }
  }
  result.workspaceDir = request.workspace; result.skillStatus = skillStatus;
  const generic = JSON.parse(await fs.readFile(path.join(result.outputDir, 'mcp.json'), 'utf8'));
  const profileFiles = { codex: 'codex.toml', dsh: 'dsh.yaml', 'github-copilot': 'github-copilot.json', vscode: 'vscode-mcp.json' };
  result.profileFile = profileFiles[request.host] || 'mcp.json';
  result.profileText = await fs.readFile(path.join(result.outputDir, result.profileFile), 'utf8');
  result.serverObjectText = JSON.stringify(generic.mcpServers['copilot-discussion'], null, 2);
  const guideFile = path.join(result.outputDir, '开始使用.html');
  await fs.writeFile(guideFile, guide(result, request.host));
  await fs.writeFile(path.join(request.output, 'installer-result.json'), JSON.stringify({ ...result, guideFile, productRoot: path.join(packageRoot, 'product'), offline: true }, null, 2) + '\n');
  return { ...result, guideFile, productRoot: path.join(packageRoot, 'product'), offline: true };
}

try {
  const request = JSON.parse((await fs.readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/u, ''));
  const result = await install(request);
  process.stdout.write(JSON.stringify({ type: 'complete', result }) + '\n');
} catch (error) { process.stdout.write(JSON.stringify({ type: 'error', message: error.message }) + '\n'); process.exitCode = 1; }
