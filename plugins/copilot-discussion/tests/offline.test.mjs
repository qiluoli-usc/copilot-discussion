import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyBundle, bundlePath, prepareOfflineEnvironment } from '../skills/copilot-discussion/scripts/offline.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-offline-'));
  t.after(async () => { assert.ok((await fs.realpath(root)).startsWith(await fs.realpath(os.tmpdir()))); await fs.rm(root, { recursive: true, force: true }); });
  const bundleDir = path.join(root, '离线 包'), dataDir = path.join(root, '新机 依赖');
  const paths = { node: 'tools/node/node.exe', uv: 'tools/uv/uv.exe', python: 'tools/python/python.exe', requirements: 'requirements.txt', browserSource: 'jev/jev_ultrafast/browser.py', chrome: 'packages/chrome.exe' };
  const files = [];
  for (const relative of Object.values(paths)) {
    const file = path.join(bundleDir, relative); await fs.mkdir(path.dirname(file), { recursive: true });
    const data = Buffer.from(relative); await fs.writeFile(file, data);
    files.push({ path: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const manifest = { schemaVersion: 1, version: '0.8.0', platform: 'win32', arch: 'x64', jevCommit: '1231850a0bf1a0c0341fe408ef1668dbbfdfac46', paths, files };
  await fs.writeFile(path.join(bundleDir, 'bundle.json'), JSON.stringify(manifest));
  await fs.mkdir(path.join(bundleDir, 'wheels'));
  return { root, bundleDir, dataDir, manifest };
}

test('离线清单逐文件校验，拒绝损坏、越界路径、重复路径与不匹配架构', async t => {
  const f = await fixture(t);
  assert.equal((await verifyBundle(f.bundleDir, { platform: 'win32', arch: 'x64' })).version, '0.8.0');
  for (const relative of ['../escape', 'C:/escape', '/absolute', 'tools\\node.exe', 'a//b']) assert.throws(() => bundlePath(f.bundleDir, relative), /路径/u);
  await assert.rejects(verifyBundle(f.bundleDir, { platform: 'win32', arch: 'arm64' }), /架构/u);
  await fs.writeFile(path.join(f.bundleDir, f.manifest.paths.node), 'corrupt');
  await assert.rejects(verifyBundle(f.bundleDir, { platform: 'win32', arch: 'x64' }), /校验失败/u);
  f.manifest.files.push({ ...f.manifest.files[0] });
  await fs.writeFile(path.join(f.bundleDir, 'bundle.json'), JSON.stringify(f.manifest));
  await fs.writeFile(path.join(f.bundleDir, f.manifest.paths.node), f.manifest.paths.node);
  await assert.rejects(verifyBundle(f.bundleDir, { platform: 'win32', arch: 'x64' }), /无效/u);
});

test('新机创建自身venv，从锁定wheels强制离线安装，不调用系统Python或下载器', async t => {
  const f = await fixture(t), calls = [];
  const result = await prepareOfflineEnvironment(f, { run: async (command, args, options) => {
    calls.push({ command, args });
    if (args[0] === 'venv') {
      assert.equal(command, path.join(f.bundleDir, f.manifest.paths.uv));
      assert.ok(args.includes('--offline') && args.includes(path.join(f.bundleDir, f.manifest.paths.python)));
      const venv = args.at(-1); await fs.mkdir(path.join(venv, 'Scripts'), { recursive: true }); await fs.writeFile(path.join(venv, 'Scripts/python.exe'), 'fixture');
    }
    if (args[0] === 'pip') {
      assert.equal(options.env.UV_OFFLINE, '1'); assert.equal(options.env.UV_PYTHON_DOWNLOADS, 'never');
      assert.ok(args.includes('--offline') && args.includes('--no-index') && args.includes('--require-hashes'));
      assert.equal(options.env.PYTHONPATH, undefined);
      assert.equal(options.env.VIRTUAL_ENV, undefined);
    }
    return { ok: true, output: args.includes('-c') ? JSON.stringify({ pythonExecutable: command, browserHarness: '0.1.13', sourceSha256: 'fixture' }) : '' };
  } });
  assert.equal(result.offline, true); assert.equal(result.reused, false);
  assert.equal(calls.length, 3); assert.ok(result.pythonExecutable.startsWith(await fs.realpath(f.dataDir)));
  assert.equal(await fs.stat(path.join(f.dataDir, 'install.lock')).then(() => true).catch(() => false), false);
});

test('已有可用环境直接复用；未知不完整目录被保留；安装失败不转联网并释放锁', async t => {
  const f = await fixture(t), managed = path.join(f.dataDir, 'runtimes', 'jev-1231850a0bf1');
  await fs.mkdir(path.join(managed, 'jev_ultrafast'), { recursive: true }); await fs.writeFile(path.join(managed, 'jev_ultrafast/browser.py'), 'fixture');
  let calls = 0;
  const result = await prepareOfflineEnvironment(f, { run: async command => { calls++; return { ok: true, output: JSON.stringify({ pythonExecutable: command }) }; } });
  assert.equal(result.reused, true); assert.equal(calls, 1);
  await assert.rejects(prepareOfflineEnvironment(f, { run: async () => ({ ok: false, code: 'fixture' }) }), /未知或不完整/u);
  assert.equal(await fs.readFile(path.join(managed, 'jev_ultrafast/browser.py'), 'utf8'), 'fixture');
  await fs.writeFile(path.join(managed, '.copilot-offline.json'), JSON.stringify({ jevCommit: f.manifest.jevCommit, bundleVersion: '0.8.0' }));
  await assert.rejects(prepareOfflineEnvironment(f, { run: async () => ({ ok: false, code: 'fixture' }) }), /离线Python/u);
  assert.equal(await fs.stat(path.join(f.dataDir, 'install.lock')).then(() => true).catch(() => false), false);
});
