import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseHostGuide, standaloneGuide } from './app/host-guide.mjs';
import { LOCK, runProgram, downloadVerified } from '../plugins/copilot-discussion/skills/copilot-discussion/scripts/bootstrap.mjs';

const installer = path.dirname(fileURLToPath(import.meta.url)), project = path.dirname(installer);
const version = JSON.parse(await fs.readFile(path.join(project, 'plugins/copilot-discussion/package.json'), 'utf8')).version;
const { buildRevision } = JSON.parse(await fs.readFile(path.join(installer, 'release.json'), 'utf8'));
if (!/^[a-z0-9][a-z0-9.-]{0,48}$/u.test(buildRevision)) throw new Error('Invalid installer build revision');
const installationId = version + '-' + buildRevision;
const hostGuide = parseHostGuide(await fs.readFile(path.join(project, 'docs/host-setup.md'), 'utf8'), JSON.parse(await fs.readFile(path.join(project, 'plugins/copilot-discussion/skills/copilot-discussion/scripts/host-catalog.json'), 'utf8')));
for (const relative of ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'plugins/copilot-discussion', relative), 'utf8'));
  if (manifest.version !== version) throw new Error('Plugin versions must agree before packaging: ' + relative);
}
const args = process.argv.slice(2), options = {};
const pathOptions = ['--seed-downloads', '--python', '--output', '--prepared-wheels', '--sign-tool'];
for (let i = 0; i < args.length; i += 2) { if (![...pathOptions, '--certificate-thumbprint', '--timestamp-url'].includes(args[i]) || !args[i + 1]) throw new Error('Unknown build option'); options[args[i].slice(2)] = pathOptions.includes(args[i]) ? path.resolve(args[i + 1]) : args[i + 1]; }
if (Boolean(options['sign-tool']) !== Boolean(options['certificate-thumbprint']) || (options['certificate-thumbprint'] && !/^[a-f0-9]{40}$/iu.test(options['certificate-thumbprint']))) throw new Error('Signing requires an explicit SignTool path and certificate thumbprint; no PFX/password is accepted.');
if (options['timestamp-url'] && (!options['sign-tool'] || !/^https:\/\//u.test(options['timestamp-url']))) throw new Error('Timestamp URL must be HTTPS and requires explicit signing configuration.');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows x64 installer on Windows x64.');
const release = options.output || path.join(project, 'output/releases', 'v' + version.replaceAll('.', '') + '-' + buildRevision);
const downloadDir = path.join(project, 'output/builds/installer', 'assets-v' + version.replaceAll('.', ''), 'downloads');
const build = path.join(project, 'output/builds/installer', version + '-' + new Date().toISOString().replace(/[:.]/gu, '-'));
const payload = path.join(build, 'payload');
await fs.mkdir(payload, { recursive: true }); await fs.mkdir(downloadDir, { recursive: true }); await fs.mkdir(release, { recursive: true });
const lock = JSON.parse(await fs.readFile(path.join(installer, 'assets.lock.json'), 'utf8'));
const hash = async file => { const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex'); };
const vendorRoot = path.join(project, 'plugins/copilot-discussion/skills/copilot-discussion/scripts/vendor');
const vendorLock = JSON.parse(await fs.readFile(path.join(vendorRoot, 'lock.json'), 'utf8'));
for (const item of vendorLock.files) {
  if (!/^(jsonc-parser|smol-toml)\/[A-Za-z0-9_./-]+$/u.test(item.path) || item.path.split('/').includes('..') || await hash(path.join(vendorRoot, item.path)) !== item.sha256) throw new Error('Vendored parser checksum mismatch');
}
const log = message => console.log(new Date().toISOString() + ' ' + message);
const run = async (command, argv) => { const result = await runProgram(command, argv, { timeoutMs: 900000, env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', UV_NO_ENV_FILE: '1' } }); if (!result.ok) throw new Error(`Build step failed (${result.code}): ${path.basename(command)} ${argv[0]}`); return result.output; };
const py = options.python || 'py';
const python = argv => run(py, [...(options.python ? [] : ['-3.12']), ...argv]);
async function asset(name, value, seedName) {
  const file = path.join(downloadDir, name);
  if (!await fs.stat(file).then(() => true).catch(() => false) && options['seed-downloads']) {
    const seed = path.join(options['seed-downloads'], seedName || name);
    if (await fs.stat(seed).then(() => true).catch(() => false) && await hash(seed) === value.sha256) await fs.copyFile(seed, file);
  }
  if (!await fs.stat(file).then(() => true).catch(() => false)) {
    if (name === 'chrome.exe') {
      const downloaded = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'plugins/copilot-discussion/skills/copilot-discussion/scripts/download.ps1'), '-Url', value.url, '-Destination', file], { timeoutMs: 600000 });
      if (!downloaded.ok) throw new Error('Chrome official download failed.');
    } else await downloadVerified(value, file);
  }
  if (await hash(file) !== value.sha256) throw new Error('Release asset hash mismatch: ' + name);
  log(name + ' verified'); return file;
}
const extract = (archive, destination) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'plugins/copilot-discussion/skills/copilot-discussion/scripts/expand-archive.ps1'), '-Archive', archive, '-Destination', destination]);
const sourceFilter = source => !['__pycache__', '.venv', 'node_modules', '.git', 'output'].includes(path.basename(source)) && !/^\.env(?:\.|$)/u.test(path.basename(source));
log('Preparing pinned runtimes');
const nodeZip = await asset(`node-${LOCK.node.version}-x64.zip`, LOCK.node.x64);
const uvZip = await asset(`uv-${LOCK.uv.version}-x64.zip`, LOCK.uv.x64);
const jevZip = await asset(`jev-${LOCK.jev.commit}.zip`, LOCK.jev);
const pythonTar = await asset('python.tar.gz', lock.python);
const chromeExe = await asset('chrome.exe', lock.chrome);
await extract(nodeZip, path.join(build, 'node-source'));
await fs.mkdir(path.join(payload, 'tools/node'), { recursive: true });
for (const file of ['node.exe', 'LICENSE', 'README.md']) await fs.copyFile(path.join(build, 'node-source', LOCK.node.x64.folder, file), path.join(payload, 'tools/node', file));
await extract(uvZip, path.join(payload, 'tools/uv'));
await python([path.join(installer, 'pack.py'), 'python', pythonTar, path.join(payload, 'tools')]);
await extract(jevZip, path.join(build, 'jev-source'));
await fs.cp(path.join(build, 'jev-source', LOCK.jev.folder), path.join(payload, 'jev'), { recursive: true, filter: sourceFilter });
await fs.mkdir(path.join(payload, 'packages'), { recursive: true }); await fs.copyFile(chromeExe, path.join(payload, 'packages/GoogleChrome-x64.exe'));
log('Preparing locked offline wheels');
const requirements = path.join(payload, 'requirements-win-x64.txt'), uv = path.join(payload, 'tools/uv/uv.exe');
await run(uv, ['export', '--project', path.join(payload, 'jev'), '--no-dev', '--locked', '--no-emit-project', '--no-header', '--no-annotate', '--output-file', requirements]);
const wheels = path.join(payload, 'wheels'); await fs.mkdir(wheels);
if (options['prepared-wheels']) await fs.cp(options['prepared-wheels'], wheels, { recursive: true });
// pip validates all selected wheels against uv.lock hashes; no source builds.
await python(['-m', 'pip', 'download', '--disable-pip-version-check', '--index-url', 'https://pypi.org/simple', '--require-hashes', '--only-binary=:all:', '--python-version', '3.12', '--platform', 'win_amd64', '--implementation', 'cp', '--abi', 'cp312', '--dest', wheels, '-r', requirements]);
log('Copying product sources and notices');
for (const entry of ['plugins', 'docs', 'installer', '.agents', '.claude-plugin', 'README.md', 'install.ps1']) await fs.cp(path.join(project, entry), path.join(payload, 'product', entry), { recursive: true, filter: sourceFilter });
await fs.copyFile(path.join(installer, 'templates/PRODUCT-README.md.in'), path.join(payload, 'product/README.md'));
const compatibilityFile = path.join(payload, 'product/docs/compatibility.md');
const compatibilityText = await fs.readFile(compatibilityFile, 'utf8');
await fs.writeFile(compatibilityFile, compatibilityText.replace(/\[([^\]]+)\]\(\.\.\/output\/[^)]+\)/gu, '$1（见开发工作区对应记录，离线分发包不携带历史记录）'));
await fs.cp(path.join(installer, 'app'), path.join(payload, 'installer/app'), { recursive: true });
const hostGuideFile = path.join(build, 'host-guide.json');
await fs.writeFile(hostGuideFile, JSON.stringify(hostGuide, null, 2) + '\n');
await fs.copyFile(hostGuideFile, path.join(payload, 'installer/app/host-guide.json'));
await fs.writeFile(path.join(payload, 'product/docs/HOST-SETUP.html'), standaloneGuide(hostGuide));
await python([path.join(installer, 'pack.py'), 'licenses', wheels, path.join(payload, 'notices/wheels')]);
await fs.mkdir(path.join(payload, 'notices'), { recursive: true });
for (const entry of [
  ['uv-LICENSE-APACHE', `https://raw.githubusercontent.com/astral-sh/uv/${LOCK.uv.version}/LICENSE-APACHE`],
  ['uv-LICENSE-MIT', `https://raw.githubusercontent.com/astral-sh/uv/${LOCK.uv.version}/LICENSE-MIT`],
  ['Chrome-terms.html', 'https://www.google.com/chrome/terms/']
]) {
  const file = path.join(payload, 'notices', entry[0]);
  const result = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'plugins/copilot-discussion/skills/copilot-discussion/scripts/download.ps1'), '-Url', entry[1], '-Destination', file], { timeoutMs: 60000 });
  if (!result.ok) throw new Error('Cannot collect third-party notice: ' + entry[0]);
}
const components = [
  { name: 'Node.js', version: LOCK.node.version, url: LOCK.node.x64.url, sha256: LOCK.node.x64.sha256, license: '../tools/node/LICENSE' },
  { name: 'uv', version: LOCK.uv.version, url: LOCK.uv.x64.url, sha256: LOCK.uv.x64.sha256, license: 'uv-LICENSE-MIT' },
  { name: 'Python (Astral python-build-standalone)', ...lock.python, license: '../tools/python/LICENSE.txt' },
  { name: 'Jev Ultrafast', version: LOCK.jev.commit, url: LOCK.jev.url, sha256: LOCK.jev.sha256, license: '../jev/LICENSE' },
  { name: 'Google Chrome (official unmodified installer)', ...lock.chrome, license: 'Chrome-terms.html' },
  ...vendorLock.packages.map(item => ({ ...item, license: '../product/plugins/copilot-discussion/skills/copilot-discussion/scripts/vendor/' + item.name + '/' + (item.name === 'jsonc-parser' ? 'LICENSE.md' : 'LICENSE') }))
];
await fs.writeFile(path.join(payload, 'notices/components.json'), JSON.stringify(components, null, 2) + '\n');
await fs.writeFile(path.join(payload, 'notices/THIRD-PARTY.html'), `<!doctype html><meta charset="utf-8"><title>第三方组件</title><style>body{font:16px/1.8 sans-serif;max-width:900px;margin:40px auto}a{color:#1558b0}code{word-break:break-all}</style><h1>第三方组件及原始许可</h1><p>软件原包未经修改；遵循各自原许可。宿主客户端、账号与订阅由用户配置。本产品不附带密钥、登录状态、浏览器资料或研究记录。</p>${components.map(c => `<h2>${c.name} ${c.version}</h2><p><a href="${c.url}">原始来源</a> · <a href="${c.license}">许可 / 条款</a></p><code>SHA256 ${c.sha256}</code>`).join('')}<h2>Python 依赖</h2><p>15 个 Windows/Python 3.12 wheels 来自 PyPI，版本及允许哈希来自 Jev uv.lock。完整 wheel 和原许可位于 wheels 与 notices/wheels，安装后许可仍保存在 site-packages。</p>`);
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const generated = path.join(build, 'BuildInfo.cs');
const compile = async (output, digest, withPayload) => {
  await fs.writeFile(generated, `internal static class BuildInfo { internal const string Version = "${version}"; internal const string Revision = "${buildRevision}"; internal const string InstallationId = "${installationId}"; internal const string PayloadSha256 = "${digest}"; }\n`);
  await run(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', '/codepage:65001', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll', '/win32manifest:' + path.join(installer, 'src/app.manifest'), '/resource:' + path.join(project, 'plugins/copilot-discussion/skills/copilot-discussion/scripts/host-catalog.json') + ',hosts.json', '/resource:' + hostGuideFile + ',host-guide.json', '/out:' + output, ...(withPayload ? ['/resource:' + path.join(build, 'payload.zip') + ',payload.zip'] : []), path.join(installer, 'src/Setup.cs'), generated]);
};
const sign = async file => {
  if (!options['sign-tool']) return;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(installer, 'sign.ps1'), '-File', file, '-SignTool', options['sign-tool'], '-CertificateThumbprint', options['certificate-thumbprint'], ...(options['timestamp-url'] ? ['-TimestampUrl', options['timestamp-url']] : [])]);
};
const manager = path.join(payload, 'CopilotDiscussion.exe');
await compile(manager, '', false);
await sign(manager);
async function entries(root, relative = '') {
  const files = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Release cannot contain symlinks');
    if (entry.isDirectory()) files.push(...await entries(root, name));
    else if (entry.isFile()) files.push({ path: name, bytes: (await fs.stat(path.join(root, name))).size, sha256: await hash(path.join(root, name)) });
  }
  return files;
}
const manifest = { schemaVersion: 1, version, buildRevision, installationId, platform: 'win32', arch: 'x64', jevCommit: LOCK.jev.commit,
  paths: { node: 'tools/node/node.exe', uv: 'tools/uv/uv.exe', python: 'tools/python/python.exe', browserSource: 'jev/jev_ultrafast/browser.py', requirements: 'requirements-win-x64.txt', chrome: 'packages/GoogleChrome-x64.exe' },
  components, files: await entries(payload) };
await fs.writeFile(path.join(payload, 'bundle.json'), JSON.stringify(manifest, null, 2) + '\n');
log('Compressing offline payload');
const packed = JSON.parse(await python([path.join(installer, 'pack.py'), 'zip', payload, path.join(build, 'payload.zip')]));
const exe = path.join(release, `CopilotDiscussion-${version}-Setup-win-x64.exe`);
await compile(exe, packed.sha256, true);
await sign(exe);
log('Building importable plugin source package');
const sourceZip = path.join(release, `CopilotDiscussion-${version}-Plugin.zip`);
await python([path.join(installer, 'pack.py'), 'zip', path.join(payload, 'product'), sourceZip]);
const artifacts = [exe, sourceZip];
const sums = await Promise.all(artifacts.map(async file => `${await hash(file)}  ${path.basename(file)}`));
await fs.writeFile(path.join(release, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
await fs.copyFile(path.join(payload, 'product/docs/HOST-SETUP.html'), path.join(release, 'HOST-SETUP.html'));
await fs.writeFile(path.join(release, 'build.json'), JSON.stringify({ version, buildRevision, installationId, builtAt: new Date().toISOString(), buildDirectory: build, platform: 'win32-x64', signing: options['sign-tool'] ? 'verified-authenticode' : 'unsigned', payload: packed, componentFiles: manifest.files.length,
  artifacts: await Promise.all(artifacts.map(async file => ({ file, bytes: (await fs.stat(file)).size, sha256: await hash(file) }))) }, null, 2) + '\n');
log('Release ready: ' + exe);
