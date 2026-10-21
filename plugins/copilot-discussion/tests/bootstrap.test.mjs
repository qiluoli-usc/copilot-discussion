import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureEnvironment, downloadVerified, LOCK, within } from '../skills/copilot-discussion/scripts/bootstrap.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-bootstrap-'));
  t.after(async () => { assert.ok((await fs.realpath(root)).startsWith(await fs.realpath(os.tmpdir()))); await fs.rm(root, { recursive: true, force: true }); });
  return { root, dataDir: path.join(root, '用户 依赖'), runtimeRoot: path.join(root, '已有Jev') };
}

test('已有可用Jev直接复用，不调用下载器或uv，不依赖宿主Jev技能', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.runtimeRoot, 'jev_ultrafast'), { recursive: true });
  await fs.writeFile(path.join(f.runtimeRoot, 'jev_ultrafast', 'browser.py'), '# fixture');
  const calls = [];
  const result = await ensureEnvironment(f, { platform: 'win32', run: async (command,args,options) => {
    assert.equal(options.env.PYTHONUTF8, '1');
    calls.push({command,args}); return { ok: true, output: JSON.stringify({pythonExecutable:path.join(f.root,'python.exe'),browserHarness:'fixture',sourceSha256:'fixture'}) };
  }, download: async () => assert.fail('must reuse') });
  assert.equal(result.reused, true); assert.equal(calls.length, 1);
  assert.equal(await fs.stat(f.dataDir).then(()=>true).catch(()=>false), false);
});

test('缺少uv/Python/Jev时自动准备隔离环境，锁定依赖，之后复用且不重复安装', async t => {
  const f = await fixture(t); const calls = [], downloads = []; let installed = false;
  const run = async (command,args,options) => {
    calls.push({command,args,env:options?.env});
    if (args.includes('-c')) return installed ? {ok:true,output:JSON.stringify({pythonExecutable:command,browserHarness:'fixture',sourceSha256:'fixture'})} : {ok:false};
    if (command === 'powershell.exe') {
      const dest = args[args.indexOf('-Destination')+1]; await fs.mkdir(dest,{recursive:true});
      if (dest.includes('uv-')) await fs.writeFile(path.join(dest,'uv.exe'),'fixture');
      else { const module=path.join(dest,LOCK.jev.folder,'jev_ultrafast'); await fs.mkdir(module,{recursive:true}); await fs.writeFile(path.join(module,'browser.py'),'fixture'); }
      return {ok:true};
    }
    if (args.includes('sync')) {
      assert.ok(args.includes('--locked') && args.includes('--no-dev'));
      assert.equal(options.env.UV_PYTHON_PREFERENCE,'only-managed');
      const runtime=args[args.indexOf('--project')+1]; await fs.mkdir(path.join(runtime,'.venv','Scripts'),{recursive:true});
      await fs.writeFile(path.join(runtime,'.venv','Scripts','python.exe'),'fixture'); installed=true; return {ok:true};
    }
    return {ok:true};
  };
  const deps={platform:'win32',arch:'x64',env:{},run,download:async(asset,dest)=>{ downloads.push(asset.url); await fs.mkdir(path.dirname(dest),{recursive:true}); await fs.writeFile(dest,'fixture'); }};
  const result=await ensureEnvironment({dataDir:f.dataDir,isolated:true},deps);
  assert.equal(result.reused,false); assert.equal(downloads.length,2); assert.ok(path.isAbsolute(result.pythonExecutable));
  assert.equal(await fs.stat(path.join(f.dataDir,'install.lock')).then(()=>true).catch(()=>false),false);
  const before=calls.length;
  assert.equal((await ensureEnvironment({dataDir:f.dataDir},deps)).reused,true);
  assert.equal(calls.length,before+1); assert.equal(downloads.length,2);
});

test('no-install、非Windows和未知已有目录保留原内容，下载失败释放自己的锁', async t => {
  const f=await fixture(t);
  await assert.rejects(ensureEnvironment({dataDir:f.dataDir,noInstall:true},{platform:'win32',env:{}}),/未安装/u);
  await assert.rejects(ensureEnvironment(f,{platform:'linux'}),/Windows/u);
  assert.throws(()=>within(f.root,path.join(f.root,'..','escape')),/安装路径/u);
  const uvRoot=path.join(f.dataDir,'tools',`uv-${LOCK.uv.version}-x64`); await fs.mkdir(uvRoot,{recursive:true}); await fs.writeFile(path.join(uvRoot,'uv.exe'),'fixture');
  await fs.mkdir(f.runtimeRoot); await fs.writeFile(path.join(f.runtimeRoot,'keep.txt'),'keep');
  await assert.rejects(ensureEnvironment({...f,isolated:true},{platform:'win32',arch:'x64',env:{},run:async()=>({ok:true})}),/不完整/u);
  assert.equal(await fs.readFile(path.join(f.runtimeRoot,'keep.txt'),'utf8'),'keep');
  assert.equal(await fs.stat(path.join(f.dataDir,'install.lock')).then(()=>true).catch(()=>false),false);
});

test('下载校验失败不安装，缓存校验后复用，不执行未知文件', async t => {
  const f=await fixture(t), data=Buffer.from('verified fixture');
  const asset={url:'https://example.com/fixture.zip',sha256:createHash('sha256').update(data).digest('hex')};
  const destination=path.join(f.root,'fixture.zip'); let requests=0;
  const fetcher=async()=>{requests++;return new Response(data)};
  assert.equal((await downloadVerified(asset,destination,{fetcher})).reused,false);
  assert.equal((await downloadVerified(asset,destination,{fetcher})).reused,true); assert.equal(requests,1);
  const wrong=path.join(f.root,'wrong.zip');
  await assert.rejects(downloadVerified({...asset,sha256:'0'.repeat(64)},wrong,{fetcher}),/不匹配/u);
  assert.equal(await fs.stat(wrong).then(()=>true).catch(()=>false),false);
  assert.ok(!(await fs.readdir(f.root)).some(name=>name.endsWith('.partial')));
});
