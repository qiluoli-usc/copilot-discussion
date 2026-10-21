import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setup } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/setup.mjs';
import { verifyBundle, prepareOfflineEnvironment } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/offline.mjs';
import { integrateHosts } from '../../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/host-integration.mjs';
import { guide } from './guide.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const progress = item => process.stdout.write(JSON.stringify({ type: 'progress', ...item }) + '\n');

export async function install(request) {
  for (const key of ['workspace', 'dataDir', 'config', 'output']) if (typeof request[key] !== 'string' || !path.isAbsolute(request[key])) throw new Error(`安装参数${key}必须为绝对路径。`);
  if (request.installerStartedAt && Number.isFinite(Date.parse(request.installerStartedAt))) process.env.COPILOT_DISCUSSION_BOOTSTRAP_STARTED_AT = request.installerStartedAt;
  const manifest = await verifyBundle(packageRoot, { onProgress: progress });
  const result = await setup({ workspace: request.workspace, config: request.config, output: request.output, target: 'all',
    'data-dir': request.dataDir, replace: true, onProgress: progress, isolated: request.reuseEnvironment === false,
    'skip-chrome-install': !request.installChrome, 'chrome-offline-installer': request.installChrome ? path.join(packageRoot, ...manifest.paths.chrome.split('/')) : undefined,
    'check-browser': false }, { prepareEnvironment: options => prepareOfflineEnvironment({ ...options, bundleDir: packageRoot, manifest }) });
  const generic = JSON.parse(await fs.readFile(path.join(result.outputDir, 'mcp.json'), 'utf8'));
  const started = Date.now();
  result.hostIntegration = { status: 'skipped', results: [], changedFiles: 0, rollbackFile: null };
  if (request.autoConnectHosts === true && !['all', 'generic'].includes(request.host)) {
    try {
      result.hostIntegration = await integrateHosts({ target: request.host || 'auto', server: generic.mcpServers['copilot-discussion'],
        skillsRoot: path.join(packageRoot, 'product/plugins/copilot-discussion/skills/copilot-discussion'), version: manifest.version, onProgress: progress });
    } catch (error) {
      result.hostIntegration = { status: 'needs-action', results: [], changedFiles: null, rollbackFile: error.rollbackFile || null, message: error.message };
      progress({ stage: 'hosts', action: '自动接入未完成，运行环境已保留；请查看使用指南。', at: new Date().toISOString() });
    }
  }
  result.hostIntegration.elapsedMs = Date.now() - started;
  await fs.writeFile(path.join(result.outputDir, 'host-integration.json'), JSON.stringify(result.hostIntegration, null, 2) + '\n');
  result.clientSettingsModified = result.hostIntegration.changedFiles === null ? null : result.hostIntegration.changedFiles > 0;
  result.workspaceDir = request.workspace;
  result.skillStatus = { message: result.hostIntegration.message || (result.hostIntegration.status === 'ready-after-reload' ? '已自动接入发现的宿主，重新加载后可使用。' : result.hostIntegration.status === 'no-hosts' ? '未发现已配置的本地宿主；运行环境已安装，安装宿主后重新运行本向导。' : '宿主接入结果如下；待处理项不会被标记为成功。') };
  result.productRoot = path.join(packageRoot, 'product');
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
