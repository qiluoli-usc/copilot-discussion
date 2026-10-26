import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Manager, SOURCE } from './manager.mjs';
import { HOSTS } from '../skills/copilot-discussion/scripts/host-integration.mjs';
import { command } from './welcome.mjs';

export function parseArgs(args) {
  const input = [...args], action = !input.length || input[0].startsWith('--') ? 'help' : input.shift();
  if (!['setup','doctor','repair','update','uninstall','hosts','guide','mcp','help','version'].includes(action)) throw new Error('没有这个命令。运行 help 查看可用命令。');
  const options = {}, values = ['workspace','data-dir','config','host','runtime-root','to','from'];
  for (let i=0;i<input.length;i++) {
    const key=input[i].replace(/^--/u,'');
    if (input[i] === '--version') return { action:'version',options:{} };
    if (input[i] === '--help') return { action:'help',options:{} };
    if (['json','browser','skip-chrome-install','no-install','manual-disconnected'].includes(key) && input[i].startsWith('--')) options[key]=true;
    else if (values.includes(key) && input[i].startsWith('--') && input[i+1] && !input[i+1].startsWith('--')) options[key]=input[++i];
    else throw new Error('参数不正确：'+input[i]+'。运行 help 查看示例；不要输入API Key或账号密码。');
  }
  if (options.host && !['auto','all',...HOSTS.map(h=>h.id)].includes(options.host)) throw new Error('宿主名称不正确。运行 hosts 查看可选名称。');
  if ((options.to || options.from) && action!=='update') throw new Error('--to 和 --from 仅用于 update。');
  if (options['manual-disconnected'] && action!=='uninstall') throw new Error('--manual-disconnected 仅在卸载且已移除手动导入的连接后使用。');
  if (options.to && !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(options.to)) throw new Error('--to 后面应是完整版本号。');
  return { action,options };
}

export async function main(args, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout, stderr = dependencies.stderr || process.stderr;
  try {
    const {action,options}=parseArgs(args), version=JSON.parse(await fs.readFile(path.join(SOURCE,'package.json'),'utf8')).version;
    const manager=new Manager(options,{ ...dependencies,emit:message=>stderr.write(message+'\n') });
    if(action==='help') { stdout.write(`Copilot主题讨论 ${version}\n\n第一次使用：setup\n检查环境：doctor\n检查Chrome授权：doctor --browser\n修复缺失程序和依赖：repair\n更新到最新命令行版：update\n移除插件接入（保留研究）：uninstall\n查看宿主检测：hosts\n重新打开说明的文件位置：guide\n启动MCP服务：mcp\n\nsetup --host auto 自动检测已安装宿主；也可指定：${HOSTS.map(h=>h.id).join('、')}\nsetup --workspace "D:\\我的研究" 指定研究保存位置。\n所有命令可加 --json 供Agent读取。维护命令可加 --data-dir、--config 指定已安装位置。\n\n完整入门说明：https://github.com/qiluoli-usc/copilot-discussion/blob/main/docs/installation.md\n`); return; }
    if(action==='version') { stdout.write(version+'\n'); return; }
    // A globally installed CLI may precede the active product after update.
    // Forward maintenance to the installed version, so repair cannot downgrade.
    if (['repair','doctor','update','uninstall','hosts','guide'].includes(action)) {
      const state = await manager.active();
      if (state?.status === 'active' && state.version !== version) {
        const file = path.join(state.directory, 'cli/main.mjs');
        if (!await fs.stat(file).then(s => s.isFile()).catch(() => false)) throw new Error('当前版本的维护程序缺失。请用 GitHub 上相同版本的 npx 安装命令执行 repair。');
        const { main: installedMain } = await import(pathToFileURL(file).href);
        return installedMain(args, dependencies);
      }
    }
    if(action==='mcp') {
      const state=await manager.active(); if(!state || state.status!=='active') throw new Error('请先运行 setup。MCP启动不会下载依赖。');
      const {serve}=await import(pathToFileURL(path.join(state.directory,'skills/copilot-discussion/scripts/mcp-server.mjs')).href);
      const {ResearchService}=await import(pathToFileURL(path.join(state.directory,'skills/copilot-discussion/scripts/research-service.mjs')).href);
      const {loadSettings}=await import(pathToFileURL(path.join(state.directory,'skills/copilot-discussion/scripts/settings.mjs')).href);
      await serve({service:new ResearchService(loadSettings({configFile:state.configFile}))}); return;
    }
    let result;
    if(action==='setup') result=await manager.setup();
    if(action==='repair') result=await manager.repair();
    if(action==='update') result=await manager.update();
    if(action==='doctor') result=await manager.doctor({browser:!!options.browser});
    if(action==='uninstall') result=await manager.uninstall();
    if(action==='hosts') result=await manager.hosts();
    if(action==='guide') { const state=await manager.active(); if(!state) throw new Error('尚未安装，请先运行 setup。'); result={guideFile:state.guideFile,output:state.output}; }
    if(options.json) stdout.write(JSON.stringify(result,null,2)+'\n');
    else if(action==='hosts') for(const host of result) stdout.write(`${host.detected?'已发现':'未发现'} ${host.label}（${host.id}）${host.automaticMcp?'':'：需要按说明完成导入'}\n`);
    else if(action==='doctor') {
      stdout.write(`插件：${result.installed?'已安装':'尚未安装，请运行 setup'}\n运行环境：${result.environment.ready?'通过':'需要处理，首次运行 setup；已安装时运行 repair'}\n程序文件：${result.productFiles.length?'有缺失或改动，运行 repair':result.installed?'检查通过':'尚未准备'}\n宿主托管文件：${result.hostFiles.issues.length?'有缺失或改动，请查看使用说明':'未发现缺失或改动'}\n浏览器：${result.browser.message}\n`);
      for (const issue of result.hostFiles.issues.slice(0,10)) stdout.write(`${issue.status}：${issue.file}\n`);
      stdout.write('宿主加载：请在Agent里发送检查提示词确认；此命令不会假定连接已加载。\n');
      if(result.guideFile) stdout.write('使用说明：'+result.guideFile+'\n');
      if(!result.ready || result.browser.ready===false) process.exitCode=2;
    } else if(action==='uninstall') { stdout.write(result.message+'\n'); if(result.status==='needs-action') stdout.write(JSON.stringify(result.hosts.preserved,null,2)+'\n'); }
    else if(action==='guide') stdout.write('用Chrome打开这个文件：\n'+result.guideFile+'\n');
    else if(result.status==='up-to-date') stdout.write('已是当前可用的命令行版本：'+result.version+'\n');
    else {
      stdout.write(`准备完成，版本 ${result.version}，耗时 ${(result.elapsedMs/1000).toFixed(3)} 秒。\nJev环境：${result.environment.reused?'复用已有环境':'已准备'}\n`);
      for(const host of result.integration.results) stdout.write(`${host.label}：${host.status==='configured'?'连接和技能已准备，请重新打开宿主':host.message}\n`);
      if(!result.integration.results.length) stdout.write('没有发现已配置的Agent。请先安装并打开你的Agent，再重新运行 setup。\n');
      stdout.write(`\n下一步：\n1. 在Chrome打开下面的使用说明，按你的Agent完成接入。\n${result.guideFile}\n2. 开启Chrome远程调试，运行下面命令并手动批准Allow：\n${command(result.version,'doctor --browser')}\n3. 登录Microsoft 365 Copilot，重开Agent，再发送说明中的检查提示词和研究提示词。\n\n研究文件夹：${result.workspace}\n`);
    }
    if(action==='doctor' && (!result.ready || result.browser.ready===false)) process.exitCode=2;
  } catch(error) { stderr.write('操作未完成：'+error.message+'\n'); process.exitCode=1; }
}
