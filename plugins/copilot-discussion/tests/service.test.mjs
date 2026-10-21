import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchService } from '../skills/copilot-discussion/scripts/research-service.mjs';
import { NativeClient } from '../skills/copilot-discussion/scripts/native-client.mjs';
import { ResearchRun } from '../skills/copilot-discussion/scripts/research-run.mjs';

const ROOT = 'https://copilot.cloud.microsoft/chat';
const candidate = { id: 'one', question: '公开主题', why: '可证伪', hypothesis: '假设', counterEvidence: '反例', firstQuestion: '首问',
  sources: [{ url: 'https://example.com/primary', title: 'synthetic primary source', versionDate: '2026-10-21',
    readAt: '2026-10-21T00:00:00Z', access: 'public-free', limits: '仅测试，未实际浏览' }] };

async function fixture(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-service-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const state = { url: ROOT, entries: [], generating: false, composerText: '', composerVisible: true };
  const calls = { sends: 0, starts: 0, disposed: 0 };
  const clientFactory = () => new NativeClient({ launch: async () => {
    calls.starts++;
    const binding = { target: 'owned', owner: 'marker' };
    const transport = { binding: null,
      get tab() { return { id: binding.target, url: async () => state.url }; },
      open: async () => { transport.binding = binding; return transport.tab; },
      attach: async () => { transport.binding = binding; return transport.tab; },
      read: async () => ({ url: state.url, state: structuredClone(state) }),
      fill: async text => { state.composerText = text; },
      send: async () => { calls.sends++; state.entries.push({ role: 'user', text: state.composerText });
        state.composerText = ''; state.url = `${ROOT}/conversation/service`; },
      dispose: async () => { calls.disposed++; }, closeTab: async () => {} };
    return transport;
  } });
  const settings = { workspaceDir: workspace, native: {}, collection: { initialWaitMs: 0, sliceMs: 30, windowMs: 3000 } };
  const service = new ResearchService(settings, { clientFactory }); t.after(() => service.dispose());
  const { runFile } = await service.call('discussion_init', { maxRounds: null });
  return { service, runFile, workspace, settings, clientFactory, state, calls,
    reply: text => state.entries.push({ role: 'assistant', text, complete: true, citations: [] }),
    start: async () => { await service.call('discussion_select', { runFile, candidates: [candidate], selectedId: 'one', reason: '测试' });
      return service.call('discussion_start', { runFile }); } };
}

test('MCP短请求返回后继续采集，结果和完整归档保持一致，不排队发送下一问', async t => {
  const f = await fixture(t);
  assert.equal((await f.service.call('discussion_result', { runFile: f.runFile })).status, 'selecting');
  await f.start();
  const asked = await f.service.call('discussion_ask', { runFile: f.runFile, question: '第一问' });
  assert.equal(asked.status, 'pending'); assert.equal(asked.collecting, true);
  await assert.rejects(f.service.call('discussion_ask', { runFile: f.runFile, question: '不能排队' }), /不能排队/u);
  assert.equal((await f.service.call('discussion_control', { runFile: f.runFile, action: 'status' })).collecting, true);
  f.reply('后台保存的原始回答');
  const result = await f.service.call('discussion_result', { runFile: f.runFile, waitMs: 2000 });
  assert.equal(result.answer, '后台保存的原始回答'); assert.equal(f.calls.sends, 1);
  await f.service.call('discussion_finish', { runFile: f.runFile, summary: '测试总结', stopReason: '需要实验' });
  assert.equal((await f.service.call('discussion_verify', { runFile: f.runFile })).verified, true);
  const first = await f.service.call('discussion_artifact', { runFile: f.runFile, artifact: 'transcript', limit: 20 });
  assert.equal(first.content.length > 0, true); assert.equal(first.nextOffset, 20);
});

test('暂停取消后台续读，保留已提交问题；恢复后仍只发送一次', async t => {
  const f = await fixture(t); await f.start();
  await f.service.call('discussion_ask', { runFile: f.runFile, question: '等待中' });
  assert.equal((await f.service.call('discussion_control', { runFile: f.runFile, action: 'pause' })).status, 'paused');
  const paused = await f.service.call('discussion_result', { runFile: f.runFile, waitMs: 0 });
  assert.equal(paused.status, 'paused'); assert.equal(paused.collecting, false);
  f.reply('恢复后读取的回答');
  await f.service.call('discussion_control', { runFile: f.runFile, action: 'resume' });
  assert.equal((await f.service.call('discussion_result', { runFile: f.runFile, waitMs: 2000 })).answer, '恢复后读取的回答');
  assert.equal(f.calls.sends, 1);
});

test('宿主退出再重连原runFile，自动续读同一标签页而不再次提问', async t => {
  const f = await fixture(t); await f.start();
  await f.service.call('discussion_ask', { runFile: f.runFile, question: '跨Agent接续' });
  await f.service.dispose(); f.reply('原标签页上的迟到回答');
  const next = new ResearchService(f.settings, { clientFactory: f.clientFactory }); t.after(() => next.dispose());
  const result = await next.call('discussion_result', { runFile: f.runFile, waitMs: 2000 });
  assert.equal(result.answer, '原标签页上的迟到回答'); assert.equal(f.calls.sends, 1);
});

test('不能通过另一个工作区或目录链接读取其他研究', async t => {
  const f = await fixture(t);
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-other-')); t.after(() => fs.rm(other, { recursive: true, force: true }));
  const otherRun = await ResearchRun.create({ workspaceDir: other });
  await assert.rejects(f.service.call('discussion_control', { runFile: otherRun.file, action: 'status' }), /越出/u);
  const link = path.join(f.workspace, 'output', 'research-runs', 'linked');
  await fs.symlink(path.dirname(otherRun.file), link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.call('discussion_control', { runFile: path.join(link, 'run.json'), action: 'status' }), /越出/u);
});

test('并发重连共享同一运行锁和worker，不创建两个控制器', async t => {
  const f = await fixture(t);
  await f.service.dispose();
  let clients = 0;
  const next = new ResearchService(f.settings, { clientFactory: () => { clients++; return f.clientFactory(); } });
  t.after(() => next.dispose());
  const entries = await Promise.all(Array.from({ length: 8 }, () => next.entry(f.runFile)));
  assert.ok(entries.every(entry => entry === entries[0]));
  assert.equal(clients, 1);
  assert.equal((await next.call('discussion_control', { runFile: f.runFile, action: 'resume' })).status, 'selecting');
});
