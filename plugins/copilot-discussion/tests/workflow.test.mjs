import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeClient } from '../skills/copilot-discussion/scripts/native-client.mjs';
import { ResearchRun } from '../skills/copilot-discussion/scripts/research-run.mjs';
import { Session } from '../skills/copilot-discussion/scripts/session.mjs';
import { summarizeRun } from '../skills/copilot-discussion/scripts/metrics.mjs';

const ROOT = 'https://copilot.cloud.microsoft/chat';
const candidate = { id: 'public', question: '可证伪的研究问题', why: '存在对照和反例', hypothesis: '待检验假设', counterEvidence: '可推翻的观察', firstQuestion: '请评估原始证据', sources: [
  { url: 'https://arxiv.org/abs/2502.09977', title: '公开原始论文', versionDate: '2025-03-05', readAt: new Date().toISOString(), access: 'public-free', limits: '特定模型和任务' }
] };

async function fixture(t) {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-workflow-'));
  t.after(() => fs.rm(workspaceDir, { recursive: true, force: true }));
  const state = { url: ROOT, entries: [], generating: false, composerText: '', composerVisible: true };
  const calls = { starts: 0, sends: 0, disposes: 0, attaches: 0 };
  let noReply = false;
  const client = new NativeClient({ launch: async () => {
    calls.starts++;
    const binding = { target: 'one-tab', owner: 'one-owner' };
    const transport = { binding: null,
      get tab() { return { id: binding.target, url: async () => state.url }; },
      open: async () => { transport.binding = binding; return transport.tab; },
      attach: async () => { calls.attaches++; transport.binding = binding; return transport.tab; },
      read: async () => ({ url: state.url, state: structuredClone(state) }),
      fill: async text => { state.composerText = text; },
      send: async () => {
        calls.sends++; state.entries.push({ role: 'user', text: state.composerText });
        if (!noReply) state.entries.push({ role: 'assistant', text: `实际回应${calls.sends}`, complete: true, citations: [] });
        state.composerText = ''; state.url = `${ROOT}/conversation/workflow`;
      },
      dispose: async () => { calls.disposes++; }, closeTab: async () => {}
    };
    return transport;
  } });
  const run = await ResearchRun.create({ workspaceDir, maxRounds: null }, { client });
  t.after(() => run.dispose());
  await run.select({ candidates: [candidate], selectedId: 'public', reason: '原始资料免费且可核验' });
  return { run, client, calls, state, workspaceDir, setNoReply: value => { noReply = value; } };
}

test('完整研究流程复用一个worker，自动归档，重建报告保留原结束时间', async t => {
  const { run, calls } = await fixture(t);
  await run.start();
  await run.ask({ question: '第一问', waitMs: 1000 });
  await assert.rejects(run.ask({ question: '过期的追问', basedOnRound: 0 }), /最新轮次/u);
  await run.ask({ question: '据第一答反驳', basedOnRound: 1, analysis: '检查证据遗漏', expectedProgress: '得到反例', waitMs: 1000 });
  const done = await run.finish({ summary: '主持形成的结论', stopReason: '剩余问题需实验', agreements: ['有条件结论'], disagreements: ['初始争点已纠正'], openQuestions: ['实际效应待测'] });
  assert.equal(done.rounds, 2); assert.equal(calls.starts, 1); assert.equal(calls.sends, 2); assert.equal(calls.disposes, 1);
  const timing = JSON.parse(await fs.readFile(run.resolve('timing.json'), 'utf8'));
  assert.equal(timing.workerStarts, 1); assert.equal(timing.workerReuses, 2);
  assert.equal((await run.verify()).verified, true);
  assert.equal((await run.control('status')).rounds, 2);
  assert.equal((await run.verify()).verified, true);
  const originalEnd = (await run.read()).completedAt;
  await run.export(); assert.equal((await run.read()).completedAt, originalEnd);
  const transcript = await fs.readFile(done.transcriptFile, 'utf8');
  assert.match(transcript, /实际回应1/u); assert.match(transcript, /实际回应2/u);
  const response = JSON.parse(await fs.readFile(run.resolve('responses/round-002.json'), 'utf8'));
  response.answer = '被改过的回答';
  await fs.writeFile(run.resolve('responses/round-002.json'), JSON.stringify(response));
  await assert.rejects(run.export(), /收发记录不一致/u);
});

test('超时只collect且保留原请求，重开运行不重发问题', async t => {
  const f = await fixture(t);
  await f.run.start(); f.setNoReply(true);
  assert.equal((await f.run.ask({ question: '等待中的问题', waitMs: 0 })).status, 'pending');
  await assert.rejects(f.run.ask({ question: '再发一次' }), /禁止重发/u);
  f.state.entries.push({ role: 'assistant', text: '迟到的完整回答', complete: true, citations: [] });
  const reopened = await ResearchRun.open(f.run.file, { client: f.client });
  const result = await reopened.control('collect', { waitMs: 1000 });
  assert.equal(result.answer, '迟到的完整回答'); assert.equal(f.calls.sends, 1);
  await assert.rejects(reopened.start(), /不要再次start/u);
});

test('超过首个等待窗口后自动持续采集，完整保存而不再发送', async t => {
  const f = await fixture(t); await f.run.start(); f.setNoReply(true);
  assert.equal((await f.run.ask({ question: '持续等待的问题', waitMs: 0 })).status, 'pending');
  const timer = setTimeout(() => f.state.entries.push({ role: 'assistant', text: '迟到且必须完整保留的回答', complete: true, citations: [] }), 120);
  t.after(() => clearTimeout(timer));
  const result = await f.run.watch({ maxMs: 2000, sliceMs: 50 });
  assert.equal(result.status, 'answered'); assert.equal(f.calls.sends, 1);
  const response = JSON.parse(await fs.readFile(f.run.resolve('responses/round-001.json'), 'utf8'));
  assert.equal(response.answer, '迟到且必须完整保留的回答');
  const events = (await fs.readFile(f.run.resolve('events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(events.find(event => event.command === 'watch').cycles > 1);
});

test('持续采集可以取消并保留 pending，恢复采集不重发', async t => {
  const f = await fixture(t); await f.run.start(); f.setNoReply(true);
  await f.run.ask({ question: '可取消的等待', waitMs: 0 });
  const controller = new AbortController();
  const stopped = await f.run.watch({ maxMs: 2000, sliceMs: 20, signal: controller.signal, onProgress: () => controller.abort() });
  assert.equal(stopped.collectionStopped, true); assert.equal(f.calls.sends, 1);
  assert.equal((await f.run.control('status')).pending, 'submitted');
  f.state.entries.push({ role: 'assistant', text: '取消等待后生成的回答', complete: true, citations: [] });
  assert.equal((await f.run.watch({ maxMs: 1000, sliceMs: 200 })).answer, '取消等待后生成的回答');
  assert.equal(f.calls.sends, 1);
});

test('新增争点约定真实发送并原样归档，超预算回答不截断，可单轮展开', async t => {
  const f = await fixture(t); await f.run.start();
  await f.run.ask({ question: '请核对漏检上界', waitMs: 1000 });
  const first = JSON.parse(await fs.readFile(f.run.resolve('requests/round-001.json'), 'utf8'));
  assert.equal(first.intentQuestion, '请核对漏检上界');
  assert.match(first.question, /只处理本问新增争点/u);
  assert.equal(f.state.entries[0].text, first.question);
  f.setNoReply(true);
  await f.run.ask({ question: '展开必要的推导', discussionStyle: 'expanded', basedOnRound: 1, analysis: '上界推导缺失', expectedProgress: '得到完整公式', waitMs: 0 });
  const longAnswer = '完整证据'.repeat(600);
  f.state.entries.push({ role: 'assistant', text: longAnswer, complete: true, citations: [] });
  assert.equal((await f.run.watch({ maxMs: 1000, sliceMs: 300 })).answer, longAnswer);
  const second = JSON.parse(await fs.readFile(f.run.resolve('requests/round-002.json'), 'utf8'));
  assert.equal(second.question, '展开必要的推导');
});

test('计时事件追加不重写权威状态，读出后兼容旧指标；残缺末行明确标记', async t => {
  const f = await fixture(t); await f.run.start();
  const ledger = await f.run.read();
  const session = await Session.open(f.run.resolve(ledger.sessionFile));
  const before = await fs.readFile(session.file, 'utf8');
  await session.recordTiming({ operation: 'snapshot', scope: 'test', durationMs: 25, success: true });
  assert.equal(await fs.readFile(session.file, 'utf8'), before);
  assert.ok((await session.read()).performance.events.some(event => event.durationMs === 25));
  await fs.appendFile(session.timingFile, '{"incomplete":');
  assert.match((await session.read()).performance.warning, /末行不完整/u);
});

test('拒绝未读或付费候选、重复ID，以及项目外输出', async t => {
  const f = await fixture(t);
  const other = await ResearchRun.create({ workspaceDir: f.workspaceDir });
  t.after(() => other.dispose());
  await assert.rejects(other.select({ candidates: [{ ...candidate, sources: [{ ...candidate.sources[0], access: 'paid' }] }], selectedId: 'public', reason: '选择' }), /public-free/u);
  await assert.rejects(other.select({ candidates: [candidate, candidate], selectedId: 'public', reason: '选择' }), /ID重复/u);
  await assert.rejects(ResearchRun.create({ workspaceDir: f.workspaceDir, outputDir: path.dirname(f.workspaceDir) }), /工作项目/u);
});

test('历史运行阶段计时守恒，旧记录启动耗时保持未知', () => {
  const record = { topic: '样本', items: [
    { index: 1, sentAt: '2026-10-20T00:00:12Z', capturedAt: '2026-10-20T00:00:20Z', timing: { proposedAt: '2026-10-20T00:00:10Z' } },
    { index: 2, sentAt: '2026-10-20T00:00:25Z', capturedAt: '2026-10-20T00:00:30Z', timing: { proposedAt: '2026-10-20T00:00:24Z' } }
  ] };
  const report = summarizeRun(record, { startedAt: '2026-10-20T00:00:00Z', completedAt: '2026-10-20T00:00:40Z' });
  const p = report.phases;
  assert.equal(p.preparationMs + p.prepareToSubmitSumMs + p.submitToCaptureSumMs + p.betweenRoundsSumMs + p.synthesisAndArtifactMs, report.totalWallMs);
  assert.equal(report.workerStartupMs, null);
});
