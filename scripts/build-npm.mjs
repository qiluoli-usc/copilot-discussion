import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hash, inside } from '../plugins/copilot-discussion/cli/storage.mjs';
import { extractPackage } from '../plugins/copilot-discussion/cli/archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = path.join(root, 'plugins/copilot-discussion');
const args = process.argv.slice(2), options = {};
for (let i=0;i<args.length;i++) {
  if (!['--npm-cli','--output'].includes(args[i]) || !args[i+1]) throw new Error('参数：--npm-cli <npm-cli.js> --output <发布目录>');
  options[args[i].slice(2)] = args[++i];
}
const version = JSON.parse(await fs.readFile(path.join(product,'package.json'),'utf8')).version;
const output = path.resolve(options.output || path.join(root,'output/releases/v0100-npm'));
if (!inside(path.join(root,'output/releases'),output)) throw new Error('发布目录必须位于本项目output/releases下。');
const npmCli = options['npm-cli'] || process.env.NPM_CLI_JS || path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
await fs.access(npmCli);
const build = path.join(root,'output/builds/npm',randomUUID()); await fs.mkdir(build,{recursive:true}); await fs.mkdir(output,{recursive:true});
async function run(command, values, cwd=root) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,values,{cwd,windowsHide:true,env:{...process.env,npm_config_cache:path.join(root,'output/builds/npm/cache')},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(new Error(stderr || '打包命令失败：'+code)));
  });
}
// Documentation and its small renderer share one source with the legacy GUI.
for (const file of ['installation.md','host-setup.md','automatic-hosts.md','compatibility.md']) {
  let text=await fs.readFile(path.join(root,'docs',file),'utf8');
  text=text.replace(/\]\(legacy-exe\.md\)/gu,'](https://github.com/qiluoli-usc/copilot-discussion/blob/main/docs/legacy-exe.md)');
  text=text.replace(/\]\(\.\.\/plugins\/copilot-discussion\/([^)]*)\)/gu,'](../$1)');
  text=text.replace(/\[([^\]]+)\]\(\.\.\/output\/[^)]+\)/gu,'$1（历史本机记录，不随包分发）');
  await fs.mkdir(path.join(product,'guides'),{recursive:true});await fs.writeFile(path.join(product,'guides',file),text);
}
await fs.copyFile(path.join(root,'installer/app/host-guide.mjs'),path.join(product,'cli/host-guide.mjs'));
await run(process.execPath,[path.join(product,'cli/pack-check.mjs')]);
const packed=JSON.parse(await run(process.execPath,[npmCli,'pack','--json','--ignore-scripts','--pack-destination',build],product))[0];
const archive=await fs.readFile(path.join(build,packed.filename));
const extracted=path.join(build,'extracted');await extractPackage(archive,extracted);
for (const item of packed.files) {
  if (!/^(?:package\.json|README\.md|plugin\.json|mcp\.json|(?:bin|cli|skills|guides|\.codex-plugin|\.claude-plugin)\/)/u.test(item.path) || /(?:^|\/)(?:output|node_modules|__pycache__|\.venv|\.env)(?:\/|\.|$)/u.test(item.path)) throw new Error('npm包出现未知文件：'+item.path);
}
// The archive itself, not only the source tree, must retain vendor checksums.
const vendor=path.join(extracted,'skills/copilot-discussion/scripts/vendor'),lock=JSON.parse(await fs.readFile(path.join(vendor,'lock.json'),'utf8'));
for(const item of lock.files) if(hash(await fs.readFile(path.join(vendor,...item.path.split('/'))))!==item.sha256) throw new Error('npm包中的第三方字节校验失败');
await fs.copyFile(path.join(build,packed.filename),path.join(output,packed.filename));
const zipName=`CopilotDiscussion-${version}-Source.zip`;
await run('py',['-3.12',path.join(root,'scripts/source-archive.py'),root,path.join(build,zipName)]);
await fs.copyFile(path.join(build,zipName),path.join(output,zipName));
const command=`npx.cmd --yes "https://github.com/qiluoli-usc/copilot-discussion/releases/download/v${version}/${packed.filename}" setup`;
await fs.writeFile(path.join(output,'INSTALL-FIRST.txt'),`Copilot主题讨论 ${version}\r\n\r\n1. 使用Windows 10/11 x64，先从 https://nodejs.org/ 安装Node.js LTS，重开终端。\r\n2. 在终端粘贴下面整行，按回车，不需要先下载本页任何文件：\r\n\r\n${command}\r\n\r\n3. 等待完成，用Chrome打开终端给出的“开始使用.html”，选择你的AI软件照做。\r\n4. 开启Chrome远程调试，手动Allow并登录Microsoft 365 Copilot；按说明发检查提示词，再开始研究。\r\n\r\n详细步骤：https://github.com/qiluoli-usc/copilot-discussion/blob/main/docs/installation.md\r\n七个软件：https://github.com/qiluoli-usc/copilot-discussion/blob/main/docs/host-setup.md\r\n\r\n没有Jev Native或Python也能按需准备。默认无需Jev API Key。QwenWork需一次界面导入，DSH需加载启动配置。\r\n检查、修复、更新、卸载：将命令最后的setup换成doctor、repair、update、uninstall。维护前暂停研究。\r\n此包通过GitHub分发，尚未发布到npm公共仓库，请保留完整网址。\r\n`,'utf8');
await fs.copyFile(path.join(root,'docs/installation.md'),path.join(output,'安装使用说明.md'));
await fs.copyFile(path.join(root,'docs/host-setup.md'),path.join(output,'七个宿主操作步骤.md'));
const names=[packed.filename,zipName,'INSTALL-FIRST.txt','安装使用说明.md','七个宿主操作步骤.md'];
await fs.writeFile(path.join(output,'SHA256SUMS.txt'),(await Promise.all(names.map(async name=>hash(await fs.readFile(path.join(output,name)))+'  '+name))).join('\n')+'\n');
await fs.writeFile(path.join(build,'build.json'),JSON.stringify({version,packed:{name:packed.filename,bytes:archive.length,sha256:hash(archive),files:packed.files.length,integrity:packed.integrity},vendorFilesVerified:lock.files.length,assets:names},null,2)+'\n');
process.stdout.write(JSON.stringify({version,output,build,packageFile:packed.filename,bytes:archive.length,files:packed.files.length,vendorFilesVerified:lock.files.length},null,2)+'\n');
