// Real, isolated package installation. Does not connect a browser or call models.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { hash, inside } from '../plugins/copilot-discussion/cli/storage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),options={};
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){if(args[i]==='--managed-python'){options['managed-python']=true;continue;}if(!['--npm-cli','--package','--runtime-root','--seed','--sdk-uv'].includes(args[i])||!args[i+1])throw new Error('需要--npm-cli、--package，可选--runtime-root、--seed、--managed-python、--sdk-uv');options[args[i].slice(2)]=args[++i];}
const npm=path.resolve(options['npm-cli']),nodeFolder=path.resolve(path.dirname(npm),'../../..');
const archive=path.resolve(options.package),base=path.join(root,'output/installations/v0100-npm',randomUUID()),home=path.join(base,'user'),data=path.join(base,'data'),workspace=path.join(base,'研究 文件夹'),prefix=path.join(base,'global');
assert.ok(inside(path.join(root,'output/installations'),base));await fs.mkdir(base,{recursive:true});
const env={...process.env};
for(const key of Object.keys(env))if(/^(?:CODEX_HOME|CLAUDE_CONFIG_DIR|COPILOT_HOME|DSH_HOME|COPILOT_DISCUSSION_CONFIG|COPILOT_DISCUSSION_WORKSPACE|JEV_.+)$/iu.test(key))delete env[key];
Object.assign(env,{USERPROFILE:home,APPDATA:path.join(home,'AppData/Roaming'),LOCALAPPDATA:path.join(home,'AppData/Local'),PATH:nodeFolder+path.delimiter+(process.env.PATH||process.env.Path||''),npm_config_cache:path.join(base,'npm-cache'),PYTHONDONTWRITEBYTECODE:'1'});
env.PYTHONUTF8='1';
if(options['managed-python'])env.UV_PYTHON_PREFERENCE='only-managed';
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);};
for(const file of ['.claude.json','.workbuddy/mcp.json','.copilot/mcp-config.json'])await write(path.join(home,file),'{"mcpServers":{"existing":{"command":"keep"}},"setting":"keep"}\n');
await write(path.join(home,'.codex/config.toml'),'# keep comment\nmodel="keep"\n');
await write(path.join(env.APPDATA,'Code/User/mcp.json'),'// keep comment\n{"servers":{"existing":{"command":"keep"}}}\n');
for(const folder of ['.workbuddy/skills','.qwenworkcn','.dsh'])await fs.mkdir(path.join(home,folder),{recursive:true});
const stages=[];
async function run(name,command,values,{progress=false}={}) {
  const started=Date.now();process.stderr.write(name+'…\n');
  return new Promise((resolve,reject)=>{
    const child=spawn(command,values,{cwd:base,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill();reject(new Error(name+'超时'));},720000);
    child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>{stderr+=c;if(progress)process.stderr.write(c);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);stages.push({name,elapsedMs:Date.now()-started,exitCode:code});code===0?resolve(stdout):reject(new Error(name+'失败：'+stderr.slice(-2000)));});
  });
}
try {
  assert.equal((await run('独立用户目录',process.execPath,['-e','process.stdout.write(require("node:os").homedir())'])).toLowerCase(),home.toLowerCase());
  await run('npm全局安装到隔离prefix',process.execPath,[npm,'install','--global','--prefix',prefix,archive,'--ignore-scripts','--no-audit','--no-fund']);
  const bin=path.join(prefix,'node_modules/copilot-discussion/bin/copilot-discussion.mjs');await fs.access(path.join(prefix,'copilot-discussion.cmd'));
  env.COPILOT_TEST_SHIM=path.join(prefix,'copilot-discussion.cmd');
  assert.match(await run('实际.cmd入口', 'powershell.exe',['-NoProfile','-NonInteractive','-Command','& $env:COPILOT_TEST_SHIM version']),/0\.10\.0-preview\.1/u);
  const npx=path.join(path.dirname(npm),'npx-cli.js');
  // Exercise the same URL form documented for users. An absolute local .tgz
  // can be mistaken for an executable by npm's Windows local-bin shortcut.
  const bytes=await fs.readFile(archive), server=createServer((request,response)=>{if(request.url!=='/package.tgz'){response.writeHead(404);response.end();return;}response.writeHead(200,{'Content-Type':'application/octet-stream'});response.end(bytes);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{assert.match(await run('npx网址包入口',process.execPath,[npx,'--yes',`http://127.0.0.1:${server.address().port}/package.tgz`,'help']),/第一次使用/u);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const lock=JSON.parse(await fs.readFile(path.join(root,'plugins/copilot-discussion/skills/copilot-discussion/scripts/runtime-lock.json'),'utf8'));
  if(options.seed){
    for(const [asset,name]of[[lock.jev,`jev-${lock.jev.commit}.zip`],[lock.uv.x64,`uv-${lock.uv.version}-x64.zip`]]){
      const bytes=await fs.readFile(path.join(path.resolve(options.seed),name));assert.equal(hash(bytes),asset.sha256);await write(path.join(data,'downloads',name),bytes);
    }
  }
  const common=['--data-dir',data,'--config',path.join(home,'.copilot-discussion/config.json')];
  const setupArgs=['setup',...common,'--workspace',workspace,'--skip-chrome-install','--json',...(options['runtime-root']?['--runtime-root',path.resolve(options['runtime-root'])]:[])];
  const setup=JSON.parse(await run(options['runtime-root']?'复用真实Jev环境':'全新Jev及依赖准备',process.execPath,[bin,...setupArgs],{progress:true}));
  assert.equal(setup.integration.results.length,7);assert.equal(setup.integration.results.filter(h=>h.status==='configured').length,5);
  assert.equal(setup.environment.reused,!!options['runtime-root']);assert.ok(inside(path.join(data,'npm/versions'),setup.directory));
  const doctor=JSON.parse(await run('实际Python及Jev导入检查',process.execPath,[bin,'doctor',...common,'--json']));assert.equal(doctor.ready,true);assert.equal(doctor.hostLoadingVerified,false);
  const repeated=JSON.parse(await run('重复安装复用检查',process.execPath,[bin,...setupArgs]));assert.equal(repeated.directory,setup.directory);assert.equal(repeated.integration.changedFiles,0);assert.equal(repeated.environment.reused,true);
  const damaged=path.join(setup.directory,'skills/research-topics/SKILL.md');await fs.unlink(damaged);
  const repaired=JSON.parse(await run('实际缺失文件修复',process.execPath,[bin,'repair',...common,'--skip-chrome-install','--json']));await fs.access(damaged);assert.equal(repaired.version,setup.version);
  let sdk=null;
  if(options['sdk-uv']){
    env.UV_CACHE_DIR=path.join(base,'sdk-cache');
    const uv=path.resolve(options['sdk-uv']),interpreter=setup.environment.pythonExecutable;
    sdk=JSON.parse(await run('官方MCP SDK握手与11个工具验证',uv,['run','--no-project','--python',interpreter,'--with','mcp==2.3.0','python',path.join(root,'plugins/copilot-discussion/tests/mcp_sdk_smoke.py'),'--profile',path.join(repaired.output,'mcp.json')]));assert.equal(sdk.verified,true);assert.equal(sdk.toolCount,11);
    for(const skill of ['copilot-discussion','research-topics'])await run('技能结构检查：'+skill,uv,['run','--no-project','--python',interpreter,'--with','pyyaml','python',path.join(process.env.USERPROFILE,'.codex/skills/.system/skill-creator/scripts/quick_validate.py'),path.join(prefix,'node_modules/copilot-discussion/skills',skill)]);
  }
  const record=path.join(workspace,'output/research-runs/preservation-marker.txt');await write(record,'keep research');
  const extra=path.join(home,'.agents/skills/copilot-discussion/user-note.txt');await write(extra,'keep user file');
  const removed=JSON.parse(await run('隔离卸载',process.execPath,[bin,'uninstall',...common,'--manual-disconnected','--json']));assert.equal(removed.status,'uninstalled');
  assert.equal(await fs.readFile(record,'utf8'),'keep research');assert.equal(await fs.readFile(extra,'utf8'),'keep user file');assert.match(await fs.readFile(path.join(home,'.codex/config.toml'),'utf8'),/keep comment/u);
  assert.equal(JSON.parse(await fs.readFile(path.join(home,'.claude.json'),'utf8')).mcpServers.existing.command,'keep');await fs.access(path.join(setup.environment.runtimeRoot,'jev_ultrafast/browser.py'));
  const summary={status:'passed',version:setup.version,packageSha256:hash(await fs.readFile(archive)),mode:options['runtime-root']?'existing-runtime':'new-runtime',seededDownloads:!!options.seed,managedPythonRequested:!!options['managed-python'],base,stages,setupElapsedMs:setup.elapsedMs,sdk,sevenHostFormats:true,actualHostClientsTested:false,browserOpened:false,modelCalls:0,recordsPreserved:true,userEditsPreserved:true,environment:setup.environment,guideFile:setup.guideFile};
  await write(path.join(base,'validation.json'),JSON.stringify(summary,null,2)+'\n');process.stdout.write(JSON.stringify(summary,null,2)+'\n');
}catch(error){await write(path.join(base,'validation.json'),JSON.stringify({status:'failed',base,stages,error:error.message},null,2)+'\n');throw error;}
