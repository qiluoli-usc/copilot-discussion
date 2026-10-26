import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { Manager, SOURCE } from '../cli/manager.mjs';
import { parseArgs, main } from '../cli/main.mjs';
import { packageEntries, inside, hash } from '../cli/storage.mjs';
import { extractPackage } from '../cli/archive.mjs';
import { compareVersions } from '../cli/version.mjs';
import { removeHostIntegrations, restoreHostIntegration } from '../skills/copilot-discussion/scripts/host-integration.mjs';

const write = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); };
const get = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function fixture(t, { seven = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-npm-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('copilot-npm-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const home = path.join(root, 'user'), data = path.join(root, 'data'), workspace = path.join(root, '研究 文件夹'), runtime = path.join(root, 'runtime');
  const env = { APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), PATH: '' };
  await write(path.join(home, '.codex/config.toml'), '# original\nmodel = "fixture"\n');
  if (seven) {
    for (const file of ['.claude.json', '.workbuddy/mcp.json', '.copilot/mcp-config.json']) await write(path.join(home, file), '{"mcpServers":{"existing":{"command":"keep"}},"userSetting":true}\n');
    await fs.mkdir(path.join(home, '.workbuddy/skills'), { recursive: true });
    for (const folder of ['.qwenworkcn', '.dsh']) await fs.mkdir(path.join(home, folder), { recursive: true });
    await write(path.join(env.APPDATA, 'Code/User/mcp.json'), '// user comment\r\n{"servers":{"existing":{"command":"keep"}},"userSetting":true}\r\n');
  }
  await write(path.join(runtime, 'jev_ultrafast/browser.py'), '# fixture only; never executed\n');
  const dependencies = { home, env, prepareEnvironment: async () => ({ runtimeRoot: runtime, pythonExecutable: process.execPath, reused: true, events: [] }),
    runProgram: async () => ({ ok: true, output: JSON.stringify({ status: 'installed' }) }), checkInstallation: async () => ({ ready: true }) };
  const options = { 'data-dir': data, workspace, 'skip-chrome-install': true };
  const manager = new Manager(options, dependencies);
  return { root, home, env, data, workspace, runtime, options, dependencies, manager };
}
async function copySource(destination) {
  for (const item of await packageEntries(SOURCE)) await write(path.join(destination, ...item.path.split('/')), item.bytes);
  return destination;
}
function tar(entries) {
  const blocks = [];
  for (const { name, bytes = Buffer.alloc(0), type = '0' } of entries) {
    const header = Buffer.alloc(512), content = Buffer.from(bytes);
    header.write(name); header.write('0000644\0',100); header.write('0000000\0',108); header.write('0000000\0',116);
    header.write(content.length.toString(8).padStart(11,'0')+'\0',124); header.write('00000000000\0',136); header.fill(32,148,156); header.write(type,156); header.write('ustar\0',257);
    let sum = 0; for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    blocks.push(header, content, Buffer.alloc((512-content.length%512)%512));
  }
  return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}

test('npm安装接入七类宿主，固定目录独立于npx缓存，重复安装不产生重复连接', async t => {
  const f = await fixture(t), source = await copySource(path.join(f.root, 'npx-cache'));
  const manager = new Manager(f.options, { ...f.dependencies, source });
  const first = await manager.setup();
  assert.equal(first.integration.results.length, 7);
  assert.equal(first.integration.results.filter(h => h.status === 'configured').length, 5);
  assert.deepEqual(first.integration.results.filter(h => h.mcp === 'manual-import').map(h => h.id).sort(), ['dsh','qwenwork']);
  assert.ok(inside(path.join(f.data,'npm/versions'), first.server.args[0]));
  assert.ok(!first.server.args[0].includes('npx-cache'));
  assert.equal((await get(path.join(f.home,'.copilot/mcp-config.json'))).mcpServers['copilot-discussion'].type, 'local');
  assert.equal((await get(path.join(f.home,'.claude.json'))).mcpServers.existing.command,'keep');
  const vscode = await fs.readFile(path.join(f.env.APPDATA,'Code/User/mcp.json'),'utf8'); assert.match(vscode,/user comment/u);
  assert.match(await fs.readFile(first.guideFile,'utf8'),/七个宿主/u);
  assert.ok(inside(f.root, source)); await fs.rm(source,{recursive:true,force:true});
  await fs.access(first.server.args[0]);
  const second = await f.manager.setup(); assert.equal(second.directory,first.directory); assert.equal(second.integration.changedFiles,0);
  await fs.access(path.join(f.home,'.qwenworkcn/skills/research-topics/SKILL.md'));
  const doctor = await f.manager.doctor(); assert.equal(doctor.ready,true); assert.equal(doctor.hostLoadingVerified,false); assert.equal(doctor.browser.checked,false);
  const targeted = new Manager({...f.options,host:'codex'},f.dependencies);
  const selected = await targeted.setup(); assert.equal(selected.integration.results.length,1); assert.equal(selected.manualConnections.length,2);
  assert.equal((await targeted.uninstall()).status,'needs-action');
});

test('repair补回缺失程序和连接，普通setup尊重删除，用户改动的连接不被覆盖', async t => {
  const f = await fixture(t, { seven:false }), state = await f.manager.setup();
  const missing = path.join(state.directory, 'skills/research-topics/SKILL.md'); await fs.unlink(missing);
  assert.deepEqual((await f.manager.doctor()).productFiles, ['skills/research-topics/SKILL.md']);
  await write(path.join(f.home,'.codex/config.toml'),'# user removed plugin\nmodel = "fixture"\n');
  const ordinary = await f.manager.setup(); assert.equal(ordinary.integration.results[0].status,'needs-action');
  const repaired = await f.manager.repair(); assert.equal(repaired.integration.results[0].status,'configured'); await fs.access(missing);
  await fs.unlink(path.join(state.directory,'installed-files.json'));
  assert.deepEqual((await f.manager.doctor()).productFiles,['installed-files.json']);
  await f.manager.repair(); assert.equal((await f.manager.doctor()).ready,true);
  const config = path.join(f.home,'.codex/config.toml'), changed = (await fs.readFile(config,'utf8')).replace('tool_timeout_sec = 60','tool_timeout_sec = 99'); await fs.writeFile(config,changed);
  const protectedRepair = await f.manager.repair(); assert.equal(protectedRepair.integration.results[0].status,'needs-action'); assert.equal(await fs.readFile(config,'utf8'),changed);
});

test('校验通过的GitHub更新可安装，旧全局CLI的repair自动转交给新版本', async t => {
  const f = await fixture(t, { seven:false }); await f.manager.setup();
  const source = await copySource(path.join(f.root,'download-source')), meta = await get(path.join(source,'package.json')); meta.version='0.10.0-preview.2'; await write(path.join(source,'package.json'),JSON.stringify(meta));
  const archive = tar((await packageEntries(source)).map(item=>({name:'package/'+item.path,bytes:item.bytes})));
  const prefix='https://github.com/qiluoli-usc/copilot-discussion/releases/download/v'+meta.version+'/',name=`copilot-discussion-${meta.version}.tgz`;
  const releases=[{tag_name:'v'+meta.version,assets:[{name,browser_download_url:prefix+name,digest:'sha256:'+hash(archive)},{name:'SHA256SUMS.txt',browser_download_url:prefix+'SHA256SUMS.txt'}]}];
  const fetch = async url => url.includes('api.github.com') ? {ok:true,json:async()=>releases} : url.endsWith('SHA256SUMS.txt') ? {ok:true,text:async()=>hash(archive)+'  '+name} : new Response(archive);
  const upgraded=await new Manager(f.options,{...f.dependencies,fetch}).update(); assert.equal(upgraded.version,meta.version);
  let stdout='',stderr='';await main(['repair','--data-dir',f.data,'--config',upgraded.configFile,'--json'],{...f.dependencies,stdout:{write:text=>stdout+=text},stderr:{write:text=>stderr+=text}});
  assert.equal(JSON.parse(stdout).version,meta.version); assert.ok(!stderr.includes('操作未完成'));
});

test('环境准备失败和宿主写入失败均保留原配置，释放维护锁', async t => {
  const f = await fixture(t, { seven:false }), state = await f.manager.setup();
  const before = await fs.readFile(state.configFile);
  const broken = new Manager(f.options,{...f.dependencies,prepareEnvironment:async()=>{throw new Error('fixture offline');}});
  await assert.rejects(broken.setup(),/offline/u); assert.deepEqual(await fs.readFile(state.configFile),before);
  const hostLock = path.join(f.home,'.copilot-discussion/host-integrations/integration.lock'); await write(hostLock,'another writer');
  await assert.rejects(f.manager.setup(),/宿主接入任务/u); assert.deepEqual(await fs.readFile(state.configFile),before);
  await fs.unlink(hostLock);
  assert.equal((await f.manager.setup()).version,state.version);
});

test('显式repair在新目录重建损坏环境，保留原运行时，不删除未知内容', async t => {
  const f = await fixture(t, { seven:false }); await f.manager.setup(); const calls = [];
  const repair = new Manager(f.options,{ ...f.dependencies,prepareEnvironment:async options=>{calls.push(options); if(!options.isolated) throw new Error('fixture damaged runtime'); return { runtimeRoot:f.runtime,pythonExecutable:process.execPath,reused:false,events:[] };} });
  await repair.repair(); assert.equal(calls.length,2); assert.equal(calls[1].runtimeRoot,undefined); assert.equal(calls[1].isolated,true); assert.ok(inside(path.join(f.data,'repairs'),calls[1].dataDir));
  await fs.access(path.join(f.runtime,'jev_ultrafast/browser.py'));
});

test('本地升级运行新版本安装逻辑、更新固定路径并保留研究，旧setup拒绝降级', async t => {
  const f = await fixture(t, { seven:false }), before = await f.manager.setup();
  const record = path.join(f.workspace,'output/research-runs/user-record.json'); await write(record,'{"keep":true}');
  const source = await copySource(path.join(f.root,'next-package')), meta = await get(path.join(source,'package.json')); meta.version='0.10.0-preview.2'; await write(path.join(source,'package.json'),JSON.stringify(meta));
  const manager = new Manager({...f.options,from:source},f.dependencies), updated = await manager.update();
  assert.equal(updated.version,meta.version); assert.notEqual(updated.directory,before.directory); await fs.access(before.server.args[0]);
  assert.equal((await get(record)).keep,true); assert.match(await fs.readFile(path.join(f.home,'.codex/config.toml'),'utf8'),/0\.10\.0-preview\.2/u);
  await assert.rejects(f.manager.setup(),/避免降级/u);
});

test('GitHub更新校验失败不安装，版本排序不把preview.10降级到preview.2', async t => {
  const f = await fixture(t, { seven:false }), current = await f.manager.setup();
  const newer = '0.10.0-preview.10', name = `copilot-discussion-${newer}.tgz`, prefix = `https://github.com/qiluoli-usc/copilot-discussion/releases/download/v${newer}/`;
  const archive = tar([{ name:'package/package.json',bytes:JSON.stringify({name:'copilot-discussion',version:newer}) }]);
  const releases = [{ tag_name:'v'+newer,assets:[{name,browser_download_url:prefix+name},{name:'SHA256SUMS.txt',browser_download_url:prefix+'SHA256SUMS.txt'}] }];
  const mockFetch = async url => url.includes('api.github.com') ? {ok:true,json:async()=>releases} : url.endsWith('SHA256SUMS.txt') ? {ok:true,text:async()=>'0'.repeat(64)+'  '+name} : new Response(archive);
  await assert.rejects(new Manager(f.options,{...f.dependencies,fetch:mockFetch}).update(),/SHA256不匹配/u);
  assert.equal((await f.manager.active()).directory,current.directory);
  assert.ok(compareVersions(newer,'0.10.0-preview.2')>0); assert.ok(compareVersions('0.10.0','0.10.0-preview.99')>0);
  releases[0].tag_name='v0.9.0'; releases[0].assets=[{name:'copilot-discussion-0.9.0.tgz'}];
  assert.equal((await new Manager(f.options,{...f.dependencies,fetch:mockFetch}).update()).status,'up-to-date');
});

test('卸载仅移除自有连接与技能，保留其他服务器、用户额外文件和研究', async t => {
  const f = await fixture(t), before = await f.manager.setup();
  const extra = path.join(f.home,'.agents/skills/copilot-discussion/user-note.txt'); await write(extra,'keep');
  const record = path.join(f.workspace,'output/research-runs/keep.md'); await write(record,'keep research');
  assert.equal((await f.manager.uninstall()).status,'needs-action');
  const result = await new Manager({...f.options,'manual-disconnected':true},f.dependencies).uninstall();
  assert.equal(result.status,'uninstalled'); assert.equal(result.hosts.preserved.length,0);
  assert.equal((await get(path.join(f.home,'.claude.json'))).mcpServers.existing.command,'keep');
  assert.equal((await get(path.join(f.home,'.claude.json'))).mcpServers['copilot-discussion'],undefined);
  const codex = await fs.readFile(path.join(f.home,'.codex/config.toml'),'utf8'); assert.match(codex,/# original/u); assert.ok(!codex.includes('managed MCP'));
  assert.equal(await fs.readFile(extra,'utf8'),'keep'); assert.equal(await fs.readFile(record,'utf8'),'keep research');
  await assert.rejects(fs.access(before.server.args[0]),{code:'ENOENT'}); await fs.access(path.join(f.runtime,'jev_ultrafast/browser.py'));
  assert.equal((await f.manager.uninstall()).status,'uninstalled');
});

test('卸载保留被修改的技能和所需程序，删除操作也可按日志回滚', async t => {
  const f = await fixture(t, { seven:false }), state = await f.manager.setup();
  const skill = path.join(f.home,'.agents/skills/copilot-discussion/SKILL.md'), original = await fs.readFile(skill); await fs.writeFile(skill,Buffer.concat([original,Buffer.from('\nuser edit\n')]));
  const result = await f.manager.uninstall(); assert.equal(result.status,'needs-action'); await fs.access(state.server.args[0]); assert.match(await fs.readFile(skill,'utf8'),/user edit/u);
  assert.equal(result.hosts.changedFiles,0);
  await fs.access(path.join(f.home,'.agents/skills/copilot-discussion/scripts/mcp-server.mjs'));
  // After the user's change is resolved, removal can commit as one transaction.
  await fs.writeFile(skill,original); await f.manager.repair();
  const removed = await removeHostIntegrations({home:f.home,env:f.env}); assert.equal(removed.preserved.length,0);
  await assert.rejects(fs.access(skill),{code:'ENOENT'});
  const restored = await restoreHostIntegration({journalFile:removed.journalFile,home:f.home,env:f.env}); assert.equal(restored.status,'rolled-back'); assert.deepEqual(await fs.readFile(skill),original);
});

test('更新解包拒绝路径穿越、链接和重复路径，合法包可读取', async t => {
  const f = await fixture(t, { seven:false });
  const pkg = {name:'copilot-discussion',version:'0.10.0-preview.1'};
  const valid = tar([{name:'package/package.json',bytes:JSON.stringify(pkg)}]); await extractPackage(valid,path.join(f.root,'valid'));
  assert.deepEqual(await get(path.join(f.root,'valid/package.json')),pkg);
  for (const [index, entries] of [
    [{name:'package/../../outside',bytes:'bad'}], [{name:'package/link',type:'2'}],
    [{name:'package/package.json',bytes:'{}'},{name:'package/PACKAGE.JSON',bytes:'{}'}]
  ].entries()) await assert.rejects(extractPackage(tar(entries),path.join(f.root,'bad-'+index)),/越界|未知|重复/u);
  await assert.rejects(fs.access(path.join(f.root,'outside')),{code:'ENOENT'});
});

test('命令参数拒绝密钥和误用；维护锁不被抢占', async t => {
  assert.equal(parseArgs(['setup','--host','vscode']).options.host,'vscode');
  assert.throws(()=>parseArgs(['setup','--jev-api-key','fixture']),/参数不正确/u);
  assert.throws(()=>parseArgs(['setup','--to','1.0.0']),/仅用于/u);
  const f = await fixture(t, { seven:false }), file = path.join(f.data,'npm/maintenance.lock'); await write(file,'another process');
  await assert.rejects(f.manager.setup(),/已有安装或维护/u); assert.equal(await fs.readFile(file,'utf8'),'another process');
});

test('实际子进程MCP启动只输出JSON-RPC，不安装或启动浏览器', async t => {
  const f = await fixture(t, { seven:false }), state = await f.manager.setup();
  const child = spawn(process.execPath,[state.server.args[0],'--config',state.configFile],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr=''; child.stdout.on('data',c=>stdout+=c); child.stderr.on('data',c=>stderr+=c);
  const exited = new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'npm-test',version:'1'}}})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');
  assert.equal(await exited,0); assert.equal(stderr,''); const replies = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length,2); assert.equal(replies.find(r=>r.id===2).result.tools.length,11);
  assert.equal(replies.find(r=>r.id===1).result.serverInfo.version,state.version);
});
