import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeCommand } from '../skills/copilot-discussion/scripts/native-cli.mjs';

const ROOT = 'https://copilot.cloud.microsoft/chat';
const CHAT = `${ROOT}/conversation/owned-native-test`;

async function setup(t) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-native-test-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const state = { url: ROOT, entries: [], generating: false, composerText: '', composerVisible: true };
  const binding = { target: 'owned-native-tab', owner: 'random-ownership-token' };
  const calls = { opened: 0, attached: 0, clicked: 0, disposed: 0, closed: 0 };
  const launch = async () => { const transport = {
    binding: null,
    tab: { id: binding.target, url: async () => state.url },
    open: async () => { calls.opened++; transport.binding = binding; return { id: binding.target, url: async () => state.url }; },
    attach: async data => {
      assert.equal(data.target, binding.target); assert.equal(data.owner, binding.owner);
      calls.attached++; transport.binding = binding; return { id: binding.target, url: async () => state.url };
    },
    read: async () => ({ url: state.url, state: structuredClone(state) }),
    fill: async text => { state.composerText = text; },
    send: async () => {
      calls.clicked++;
      state.entries.push({ role: 'user', text: state.composerText },
        { role: 'assistant', text: `回应 ${calls.clicked}：${state.composerText}`, complete: true, citations: [] });
      state.composerText = ''; state.url = CHAT;
    },
    dispose: async () => { calls.disposed++; },
    closeTab: async () => { calls.closed++; }
  }; return transport; };
  return { outputDir, state, binding, calls, launch };
}

test('独立命令持续复用同一个 Native 标签页，逐轮提问和保存', async t => {
  const f = await setup(t);
  const started = await nativeCommand('start', { topic: 'Native 续聊测试', outputDir: f.outputDir, maxRounds: 2 }, f);
  assert.equal(started.status, 'ready');
  const sessionFile = started.sessionFile;
  const first = await nativeCommand('ask', { sessionFile, question: '第一问', waitMs: 1000 }, f);
  assert.equal(first.status, 'answered');
  const second = await nativeCommand('ask', { sessionFile, question: '根据第一答的第二问', waitMs: 1000 }, f);
  assert.equal(second.rounds, 2);
  assert.match(second.answer, /根据第一答/u);
  assert.equal(f.calls.opened, 1);
  assert.equal(f.calls.attached, 2);
  assert.equal(f.calls.closed, 0);
  assert.equal(f.calls.clicked, 2);
  assert.equal(f.calls.disposed, 3);
  assert.equal(second.remoteModelCalls, 0);
});

test('Native 命令退出不关闭标签页，只有显式 close 才关闭', async t => {
  const f = await setup(t);
  const { sessionFile } = await nativeCommand('start', { topic: '关闭行为', outputDir: f.outputDir }, f);
  await nativeCommand('status', { sessionFile }, f);
  assert.equal(f.calls.closed, 0);
  await nativeCommand('close', { sessionFile }, f);
  assert.equal(f.calls.closed, 1);
});

test('Native 暂停和完成操作只修改本地记录，不启动浏览器', async t => {
  const f = await setup(t);
  const { sessionFile } = await nativeCommand('start', { topic: '暂停行为', outputDir: f.outputDir }, f);
  const offline = { launch: async () => { throw new Error('不应启动浏览器'); } };
  assert.equal((await nativeCommand('pause', { sessionFile }, offline)).status, 'paused');
  assert.equal((await nativeCommand('resume', { sessionFile }, offline)).status, 'active');
  assert.equal((await nativeCommand('finish', { sessionFile, summary: '测试完成' }, offline)).status, 'completed');
});
