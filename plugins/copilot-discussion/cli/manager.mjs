import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setup } from '../skills/copilot-discussion/scripts/setup.mjs';
import { ensureEnvironment } from '../skills/copilot-discussion/scripts/bootstrap.mjs';
import { detectHosts, integrateHosts, inspectHostIntegrations, removeHostIntegrations, restoreHostIntegration } from '../skills/copilot-discussion/scripts/host-integration.mjs';
import { loadSettings, checkInstallation } from '../skills/copilot-discussion/scripts/settings.mjs';
import { atomic, read, locked, json, hash, installProduct, safePath, inside } from './storage.mjs';
import { extractPackage } from './archive.mjs';
import { makeGuide } from './welcome.mjs';
import { compareVersions } from './version.mjs';

export const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'qiluoli-usc/copilot-discussion';
export class Manager {
  constructor(options = {}, dependencies = {}) {
    this.home = dependencies.home || os.homedir(); this.env = dependencies.env || process.env;
    this.options = options; this.source = dependencies.source || SOURCE; this.emit = dependencies.emit || (() => {});
    this.dependencies = dependencies;
    this.prepare = dependencies.prepareEnvironment || ensureEnvironment; this.check = dependencies.checkInstallation || checkInstallation;
    this.fetch = dependencies.fetch || globalThis.fetch;
    this.data = path.resolve(options['data-dir'] || path.join(this.env.LOCALAPPDATA || path.join(this.home, 'AppData/Local'), 'CopilotDiscussion'));
    this.store = path.join(this.data, 'npm'); this.stateFile = path.join(this.store, 'active.json');
    this.config = path.resolve(options.config || path.join(this.home, '.copilot-discussion/config.json'));
  }
  async active() {
    const value = await read(this.stateFile); if (!value) return null;
    const state = JSON.parse(value);
    if (state.schemaVersion !== 1 || !inside(path.join(this.store, 'versions'), state.directory || '') || !path.isAbsolute(state.configFile || '')) throw new Error('安装登记无效，已停止。请保留 active.json 并查看使用说明。');
    await safePath(state.directory); return state;
  }
  async setup({ source = this.source, repair = false } = {}) {
    return locked(this.store, () => this.setupUnlocked({ source, repair }));
  }
  async setupUnlocked({ source, repair }) {
    if (process.platform !== 'win32') throw new Error('当前Jev执行层只支持Windows本机Chrome；请在Windows终端运行。');
    const started = Date.now(), previous = await this.active(), configFile = previous?.status === 'active' ? previous.configFile : this.config;
    const sourceVersion = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')).version;
    if (previous?.status === 'active' && compareVersions(sourceVersion, previous.version) < 0) throw new Error('这个安装命令比已安装版本旧，已停止以避免降级。请运行 update，或使用新版安装命令。');
    const originalConfig = await read(configFile), launcherFile = path.join(path.dirname(configFile), 'launcher.json'), originalLauncher = await read(launcherFile);
    const old = originalConfig ? JSON.parse(originalConfig.toString('utf8').replace(/^\uFEFF/u, '')) : {};
    const workspace = path.resolve(this.options.workspace || old.workspaceDir || (previous?.status === 'active' ? previous.workspace : null) || path.join(this.home, 'Documents/CopilotResearch'));
    if (old.workspaceDir && path.resolve(old.workspaceDir) !== workspace) throw new Error('现有研究目录与指定目录不同，已保留。请使用原目录，或用 --config 指定另一份配置。');
    const product = await installProduct(source, this.store, { repair, registered: previous });
    const output = path.join(this.store, 'reports', new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8));
    this.emit('正在检查Jev环境：已有可用环境会直接复用，缺失依赖会自动补齐。');
    const prepare = async opts => {
      try { return await this.prepare(opts); }
      catch (error) {
        if (!repair || this.options['no-install']) throw error;
        // Explicit repair may prepare a new owned runtime instead of deleting
        // an incomplete or externally managed environment.
        const recovery = path.join(this.data, 'repairs', randomUUID());
        this.emit('原环境未通过检查，正在新目录重建；原环境保留。');
        return this.prepare({ ...opts, runtimeRoot: undefined, pythonExecutable: undefined, dataDir: recovery, isolated: true });
      }
    };
    // Prepare into a private staging configuration. A failed environment setup
    // cannot overwrite the user's active configuration.
    const stagedConfig = path.join(output, 'prepared', 'config.json');
    if (originalConfig) await atomic(stagedConfig, originalConfig);
    const result = await setup({ workspace, config: stagedConfig, output, target: 'all', 'data-dir': this.data,
      'runtime-root': this.options['runtime-root'] || (previous?.status === 'active' ? previous.environment?.runtimeRoot : null), 'skip-chrome-install': !!this.options['skip-chrome-install'],
      'no-install': !!this.options['no-install'], replace: true,
      onProgress: item => this.emit(item.stage + '：' + item.action) }, { prepareEnvironment: prepare, ...(this.dependencies.runProgram ? { run: this.dependencies.runProgram } : {}) });
    const scripts = path.join(product.directory, 'skills/copilot-discussion/scripts');
    const server = { type: 'stdio', command: process.execPath, args: [path.join(scripts, 'mcp-server.mjs'), '--config', configFile] };
    // Override temporary npx/source paths produced by setup with the permanent
    // product path before any host configuration is written.
    const { profiles } = await import(pathToFileURL(path.join(scripts, 'setup.mjs')).href);
    const templates = profiles({ node: process.execPath, serverFile: server.args[0], configFile });
    const contents = { 'mcp.json': json(templates.mcp), 'codex.toml': templates.codex, 'github-copilot.json': json(templates.github), 'vscode-mcp.json': json(templates.vscode), 'dsh.yaml': templates.dsh };
    for (const [name, value] of Object.entries(contents)) await atomic(path.join(output, name), value);
    const target = this.options.host || previous?.host || 'auto';
    const configBytes = await read(stagedConfig), launcherBytes = await read(path.join(path.dirname(stagedConfig), 'launcher.json'));
    let integration, configCommitted = false, launcherCommitted = false;
    try {
    await atomic(configFile, configBytes, originalConfig ? hash(originalConfig) : null); configCommitted = true;
    await atomic(launcherFile, launcherBytes, originalLauncher ? hash(originalLauncher) : null); launcherCommitted = true;
    integration = await integrateHosts({ home: this.home, env: this.env, target: target === 'all' ? 'auto' : target, server,
      skillsRoot: path.join(product.directory, 'skills/copilot-discussion'), version: product.version, repairMissing: repair, onProgress: item => this.emit(item.action) });
    const guideFile = path.join(output, '开始使用.html');
    await atomic(guideFile, await makeGuide({ product, integration, output, workspace, configFile, version: product.version }));
    await atomic(path.join(output, 'host-integration.json'), json(integration));
    await atomic(path.join(output, 'INSTALL.md'), `# 这台电脑的使用说明\n\n请用Chrome打开同目录的“开始使用.html”。\n\n研究文件夹：${workspace}\n\n插件配置：${configFile}\n\nMCP程序：${server.args[0]}\n\n本机模板含绝对路径，请勿用于另一台电脑。\n`);
    const state = { schemaVersion: 1, status: 'active', ...product, configFile, workspace, host: target, dataDir: this.data,
      output, guideFile, node: process.execPath, server, installedAt: new Date().toISOString(),
      configHash: hash(await read(configFile)), launcherHash: hash(await read(launcherFile)),
      originalConfig: previous?.status === 'active' ? previous.originalConfig : originalConfig?.toString('base64') ?? null,
      originalLauncher: previous?.status === 'active' ? previous.originalLauncher : originalLauncher?.toString('base64') ?? null,
      manualConnections: [...new Map([...(previous?.status === 'active' ? previous.manualConnections || previous.integration.results.filter(h => h.mcp === 'manual-import') : []), ...integration.results.filter(h => h.mcp === 'manual-import')].map(h => [h.id, h])).values()],
      integration, elapsedMs: Date.now() - started, environment: { reused: result.environment.reused, runtimeRoot: result.environment.runtimeRoot },
      browser: result.browser, browserAuthorization: 'manual', decisionModel: false };
    await atomic(this.stateFile, json(state));
    return { ...state, environment: result.environment };
    } catch (error) {
      const notes = [];
      if (integration?.rollbackFile) {
        try { const rollback = await restoreHostIntegration({ journalFile: integration.rollbackFile, home: this.home, env: this.env }); if (rollback.status !== 'rolled-back') notes.push('有后续修改，宿主回滚记录：' + rollback.journalFile); }
        catch { notes.push('请核对宿主备份：' + integration.rollbackFile); }
      }
      for (const [file, committed, written, original] of [[configFile, configCommitted, configBytes, originalConfig], [launcherFile, launcherCommitted, launcherBytes, originalLauncher]]) {
        if (!committed) continue;
        const current = await read(file);
        if (!current || hash(current) !== hash(written)) { notes.push('保留后续修改：' + file); continue; }
        if (original) await atomic(file, original, hash(written)); else await fs.unlink(file);
      }
      throw new Error(error.message + (notes.length ? '\n' + notes.join('\n') : '；活动配置已恢复，研究记录保留。'));
    }
  }
  async doctor({ browser = false } = {}) {
    const state = await this.active();
    const configFile = state?.configFile || this.config;
    if (!await read(configFile)) return { installed: state?.status === 'active', version: state?.version || null, ready: false, configFile,
      environment: { ready: false, checks: { configuration: { ok: false, detail: '配置缺失。首次使用请运行setup；已安装时运行repair。' } } },
      productFiles: [], hosts: state?.integration?.results || [], hostFiles: { checked: false, issues: [] }, hostLoadingVerified: false, browser: { checked: false, ready: null, message: '请先准备本地环境。' }, guideFile: state?.guideFile };
    const settings = loadSettings({ configFile, env: this.env });
    const environment = await this.check(settings);
    const productFiles = [];
    if (state?.status === 'active') {
      const bytes = await read(path.join(state.directory, 'installed-files.json'));
      let manifest; try { manifest = bytes && JSON.parse(bytes); } catch { /* report damage below */ }
      if (manifest?.fingerprint === state.fingerprint && Array.isArray(manifest.files)) for (const item of manifest.files) {
        const file = path.resolve(state.directory, ...item.path.split('/'));
        if (!inside(state.directory, file)) throw new Error('产品登记包含越界路径。');
        const current = await read(file); if (!current || hash(current) !== item.sha256) productFiles.push(item.path);
      }
      else productFiles.push('installed-files.json');
    }
    let browserResult = { checked: false, ready: null, message: '尚未检查浏览器；首次研究仍需Allow和Microsoft登录。' };
    if (browser && environment.ready) {
      this.emit('现在连接Chrome。若出现Allow，请手动允许；不会发送问题或读取其他对话。');
      try { const { JevNativeTransport } = await import('../skills/copilot-discussion/scripts/jev-native.mjs'); const transport = await JevNativeTransport.launch({ ...settings.native, launcher: settings.native.pythonLauncher }); await transport.dispose(); browserResult = { checked: true, ready: true, message: 'Chrome连接成功；请在Copilot网页确认已登录。' }; }
      catch { browserResult = { checked: true, ready: false, message: '请在Chrome打开chrome://inspect/#remote-debugging，启用调试并允许连接，再重试。' }; }
    }
    const connections = state?.integration?.results || [];
    const hostFiles = await inspectHostIntegrations({ home: this.home, env: this.env });
    return { installed: state?.status === 'active', version: state?.version || null, environment, productFiles,
      ready: state?.status === 'active' && environment.ready && productFiles.length === 0 && hostFiles.issues.length === 0,
      hosts: connections, hostFiles, hostLoadingVerified: false, browser: browserResult, configFile, guideFile: state?.guideFile,
      next: connections.some(h => h.status === 'needs-action') ? '有宿主需要手动操作，请打开使用指南。' : '重新打开宿主，先让它检查插件，再开始研究。' };
  }
  async repair() {
    const state = await this.active();
    const sourceVersion = JSON.parse(await fs.readFile(path.join(this.source, 'package.json'), 'utf8')).version;
    if (state?.status === 'active' && state.version !== sourceVersion) throw new Error('请使用与已安装版本相同的安装命令运行 repair，或使用 update。这样可以避免意外降级。');
    return this.setup({ repair: true });
  }
  async update() {
    const current = await this.active(); if (!current || current.status !== 'active') throw new Error('尚未安装。请先运行 setup。');
    return locked(this.store, async () => {
      let source;
      if (this.options.from) source = path.resolve(this.options.from);
      else {
        this.emit('正在查询GitHub上的命令行预览版。');
        const response = await this.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) throw new Error('无法查询更新，请检查GitHub网络后重试。');
        const releases = await response.json();
        const eligible = releases.filter(r => !r.draft && /^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(r.tag_name) && (!this.options.to || r.tag_name === 'v' + this.options.to) && r.assets.some(a => a.name === `copilot-discussion-${r.tag_name.slice(1)}.tgz`));
        const release = eligible.sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
        if (!release) throw new Error('没有找到包含npm包的更新版本。');
        if (compareVersions(release.tag_name.slice(1), current.version) <= 0) {
          if (this.options.to && compareVersions(this.options.to, current.version) < 0) throw new Error('不自动降级到旧版本。现有研究和配置保留。');
          return { status: 'up-to-date', version: current.version, guideFile: current.guideFile };
        }
        const asset = release.assets.find(a => a.name === `copilot-discussion-${release.tag_name.slice(1)}.tgz`);
        if (!asset.browser_download_url.startsWith(`https://github.com/${REPO}/releases/download/`)) throw new Error('更新来源不匹配。');
        const sumsAsset = release.assets.find(a => a.name === 'SHA256SUMS.txt');
        if (!sumsAsset?.browser_download_url.startsWith(`https://github.com/${REPO}/releases/download/`)) throw new Error('更新包缺少校验文件。');
        const sumsResponse = await this.fetch(sumsAsset.browser_download_url, { signal: AbortSignal.timeout(30000) });
        if (!sumsResponse.ok) throw new Error('无法读取更新校验值。');
        const sums = await sumsResponse.text(), expected = sums.split(/\r?\n/u).find(s => s.endsWith('  ' + asset.name))?.slice(0,64);
        if (!/^[a-f0-9]{64}$/u.test(expected || '') || (asset.digest && asset.digest !== 'sha256:' + expected)) throw new Error('更新校验值不一致。');
        const download = await this.fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120000) });
        if (!download.ok) throw new Error('更新包下载失败。');
        const reader = download.body.getReader(), chunks = []; let total = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('更新包超过大小限制。'); } chunks.push(value); }
        const archive = Buffer.concat(chunks);
        if (hash(archive) !== expected) throw new Error('更新包SHA256不匹配，未安装。');
        source = path.join(this.store, 'staging', 'update-' + randomUUID()); await extractPackage(archive, source);
        const version = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')).version;
        if ('v' + version !== release.tag_name) throw new Error('更新包版本与发布标记不一致。');
      }
      // Run the verified new package's setup logic as well as its MCP code.
      const { Manager: UpdatedManager } = await import(pathToFileURL(path.join(source, 'cli/manager.mjs')).href);
      const updated = new UpdatedManager(this.options, { ...this.dependencies, home: this.home, env: this.env, source, emit: this.emit });
      return updated.setupUnlocked({ source, repair: false });
    });
  }
  async uninstall() {
    return locked(this.store, async () => {
      const state = await this.active();
      if (!state || state.status === 'uninstalled') return { status: 'uninstalled', recordsKept: true, message: '未发现活动的npm安装，研究记录保留。' };
      const manual = state.manualConnections || (state.integration.results || []).filter(h => h.mcp === 'manual-import');
      if (manual.length && !this.options['manual-disconnected']) return { status: 'needs-action', recordsKept: true, hosts: { preserved: manual.map(h => ({ host: h.label, reason: '请先在宿主移除手动导入的本插件连接，再运行 uninstall --manual-disconnected。DSH停止加载本插件的dsh.yaml。' })) }, guideFile: state.guideFile, message: '检测到需要手动导入连接的宿主。请先移除这些连接，再完成卸载；程序、配置和研究均保留。' };
      const manifestFile = path.join(state.directory, 'installed-files.json');
      let manifest; try { manifest = JSON.parse(await read(manifestFile)); } catch { /* preserve below */ }
      if (manifest?.fingerprint !== state.fingerprint || !Array.isArray(manifest.files) || manifest.files.some(item => !inside(state.directory,path.resolve(state.directory,...item.path.split('/'))) || !/^[a-f0-9]{64}$/u.test(item.sha256))) throw new Error('产品文件登记损坏。请先运行repair，再卸载；当前连接和研究保留。');
      const hosts = await removeHostIntegrations({ home: this.home, env: this.env });
      if (hosts.preserved.length) return { status: 'needs-action', recordsKept: true, hosts, guideFile: state.guideFile, message: '部分连接或技能被人工修改，已保留；程序和环境也保留，以免这些连接失效。' };
      const retained = [];
      for (const [file, expected, original] of [[state.configFile, state.configHash, state.originalConfig], [path.join(path.dirname(state.configFile),'launcher.json'), state.launcherHash, state.originalLauncher]]) {
        const current = await read(file);
        if (!current) continue;
        if (hash(current) !== expected) { retained.push(file); continue; }
        if (original === null) await fs.unlink(file); else await atomic(file, Buffer.from(original,'base64'), expected);
      }
      for (const item of manifest.files) {
        const file = path.resolve(state.directory,...item.path.split('/')); if (!inside(state.directory,file)) throw new Error('产品登记包含未知路径，已停止移除。');
        const current = await read(file); if (current && hash(current) === item.sha256) await fs.unlink(file); else if (current) retained.push(file);
      }
      await atomic(this.stateFile, json({ ...state, status:'uninstalled', uninstalledAt:new Date().toISOString(), retained }));
      return { status:'uninstalled', recordsKept:true, workspace:state.workspace, dependenciesKept:true, retained, hosts, message:'插件连接和本版本托管程序已移除。研究记录、共享Jev依赖、备份及用户修改均保留。' };
    });
  }
  async rollback() {
    const state = await this.active(); if (!state?.integration?.rollbackFile) throw new Error('没有可撤销的宿主接入记录。');
    return locked(this.store, () => restoreHostIntegration({ journalFile:state.integration.rollbackFile,home:this.home,env:this.env }));
  }
  async hosts() { return detectHosts({ home:this.home,env:this.env }); }
}
