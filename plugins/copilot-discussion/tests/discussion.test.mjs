import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session, copilotUrl } from '../skills/copilot-discussion/scripts/session.mjs';
import { CopilotDiscussion } from '../skills/copilot-discussion/scripts/copilot.mjs';

const ROOT = 'https://copilot.cloud.microsoft/chat';
const CHAT = `${ROOT}/conversation/test-discussion`;
const user = text => ({ role: 'user', text });
const answer = (text, complete = true) => ({ role: 'assistant', text, complete, citations: [] });

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-discussion-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const session = await Session.create({ topic: '中文主题 / 边界', outputDir: dir, maxRounds: options.maxRounds || 3 });
  let clock = 0;
  const state = { url: ROOT, entries: [], generating: false, composerText: '', composerVisible: true };
  const calls = { fill: 0, click: 0 };
  let frames = [];
  const tab = { id: 'tab-1', url: async () => state.url, playwright: {
    evaluate: async () => {
      if (frames.length) Object.assign(state, structuredClone(frames.shift()));
      return structuredClone(state);
    },
    getByRole: (role) => ({
      fill: async value => {
        calls.fill++;
        if (options.decisionFails) { const error = new Error('paid decision blocked'); error.nativeErrorType = 'DecisionFailure'; throw error; }
        if (options.fillAlwaysFails || (options.fillFailsBefore && calls.fill === 1)) throw new Error('StalePage before fill');
        state.composerText = value;
        if (options.fillFailsAfter && calls.fill === 1) throw new Error('transport error after fill');
        if (options.foreignDraftOnFailure && calls.fill === 1) { state.composerText = '人工修改的草稿'; throw new Error('changed draft'); }
      },
      click: async () => {
        assert.equal(role, 'button'); calls.click++;
        const question = state.composerText;
        state.entries.push(user(question)); state.composerText = ''; state.url = CHAT;
        if (options.clickFails) throw new Error('click transport timed out after submission');
        if (!options.noReply) state.entries.push(answer(`回应：${question}`));
      }
    })
  } };
  const discussion = new CopilotDiscussion(tab, session, { browserId: 'chrome-test', pollMs: 1,
    sleep: async ms => { clock += Math.max(ms, 1); }, now: () => clock });
  await discussion.bindNew();
  return { session, discussion, state, calls, dir, frames: values => { frames = values; } };
}

test('保存真实轮次、中文内容和 Markdown；达到轮数后阻止发送', async t => {
  const { discussion, session, calls } = await fixture(t, { maxRounds: 1 });
  const result = await discussion.exchange('条件是什么？', { analysis: '检验必要条件', waitMs: 3 });
  assert.equal(result.status, 'answered');
  assert.equal(result.answer, '回应：条件是什么？');
  assert.equal(calls.click, 1);
  const saved = await session.read();
  assert.equal(saved.pending, null);
  assert.equal(saved.conversationUrl, CHAT);
  assert.equal(saved.items[0].analysis, '检验必要条件');
  assert.match(await fs.readFile(session.markdownFile, 'utf8'), /回应：条件是什么？/u);
  await assert.rejects(discussion.prepare('再问？'), /约定轮数/u);
  assert.equal(calls.fill, 1);
});

test('填入前瞬时失败自动恢复同一草稿，只发送一次并记录恢复次数', async t => {
  const { discussion, session, calls } = await fixture(t, { fillFailsBefore: true });
  const result = await discussion.exchange('仅发送一次的问题', { waitMs: 3 });
  assert.equal(result.status, 'answered'); assert.equal(calls.fill, 2); assert.equal(calls.click, 1);
  assert.equal((await session.read()).items[0].timing.draftRecoveryAttempts, 1);
});

test('付费决策失败不自动再次调用模型或发送，保留未发送草稿状态', async t => {
  const { discussion, session, calls } = await fixture(t, { decisionFails: true });
  await assert.rejects(discussion.exchange('公开测试问题'), /paid decision blocked/u);
  assert.equal(calls.fill, 1); assert.equal(calls.click, 0);
  const saved = await session.read(); assert.equal(saved.pending.stage, 'draft_failed');
  assert.equal(saved.pending.submittedAt, undefined);
});

test('填入实际成功但回执失败时识别相同草稿，不重复填入', async t => {
  const { discussion, calls } = await fixture(t, { fillFailsAfter: true });
  assert.equal((await discussion.exchange('草稿已存在', { waitMs: 3 })).status, 'answered');
  assert.equal(calls.fill, 1); assert.equal(calls.click, 1);
});

test('草稿失败后发现人工改动，保留原草稿且不发送', async t => {
  const { discussion, session, state, calls } = await fixture(t, { foreignDraftOnFailure: true });
  await assert.rejects(discussion.exchange('主持问题', { waitMs: 3 }), /不同草稿/u);
  assert.equal(calls.fill, 1); assert.equal(calls.click, 0);
  assert.equal(state.composerText, '人工修改的草稿');
  assert.equal((await session.read()).pending.stage, 'draft_failed');
});

test('持续填入失败有持久恢复上限，重开也不会无限重试', async t => {
  const { discussion, session, calls } = await fixture(t, { fillAlwaysFails: true });
  await assert.rejects(discussion.prepare('不能进入死循环'), /次数已用尽/u);
  assert.equal(calls.fill, 3); assert.equal(calls.click, 0);
  await discussion.rebind();
  await assert.rejects(discussion.recoverDraft(), /次数已用尽/u);
  assert.equal(calls.fill, 3); assert.equal((await session.read()).pending.submittedAt, undefined);
});

test('一旦写入发送标记，即使输入框为空也禁止草稿恢复', async t => {
  const { discussion, session, state, calls } = await fixture(t);
  await discussion.prepare('可能已经发出的消息'); await session.markSubmitted();
  state.composerText = '';
  await assert.rejects(discussion.recoverDraft(), /只能先 collect/u);
  await assert.rejects(session.draftFailed('不能降级'), /不能降级/u);
  assert.equal(calls.fill, 1); assert.equal(calls.click, 0);
});

test('准备日志后填入前中断，原空白草稿在submit时自动恢复', async t => {
  const { discussion, session, calls } = await fixture(t);
  await session.prepare('日志已写但尚未填入', '模拟重启', { userCount: 0, answerCount: 0 });
  await discussion.rebind(); await discussion.submit();
  assert.equal((await discussion.collect({ waitMs: 3 })).status, 'answered');
  assert.equal(calls.fill, 1); assert.equal(calls.click, 1);
  assert.equal((await session.read()).items[0].timing.draftRecoveryAttempts, 1);
});

test('发送实际成功但调用报错时只恢复读取，绝不再次点击', async t => {
  const { discussion, session, state, calls } = await fixture(t, { clickFails: true });
  await discussion.prepare('重要的问题？');
  await assert.rejects(discussion.submit(), /禁止自动重发/u);
  assert.equal((await session.read()).pending.stage, 'uncertain');
  await assert.rejects(discussion.submit(), /只能先 collect/u);
  await assert.rejects(discussion.prepare('其他问题？'), /尚未完成/u);
  state.entries.push(answer('已经收到，回答在这里。'));
  assert.equal((await discussion.collect({ waitMs: 3 })).status, 'answered');
  assert.equal(calls.click, 1);
});

test('超时不把上一答或部分流输出保存为本轮回答', async t => {
  const { discussion, session, state, calls } = await fixture(t);
  await discussion.exchange('第一问', { waitMs: 3 });
  await discussion.prepare('基于前文的第二问');
  await discussion.submit();
  state.entries.at(-1).text = '还在生成'; state.entries.at(-1).complete = false;
  assert.equal((await discussion.collect({ waitMs: 3 })).status, 'pending');
  assert.equal((await session.read()).items.length, 1);
  assert.equal(calls.click, 2);
  state.entries.at(-1).complete = true;
  state.generating = true;
  assert.equal((await discussion.collect({ waitMs: 3 })).status, 'pending');
  state.generating = false;
  assert.equal((await discussion.collect({ waitMs: 3 })).status, 'answered');
  assert.equal(calls.click, 2);
});

test('准备和提交分离，草稿改变后不发送', async t => {
  const { discussion, state, calls, session } = await fixture(t);
  await discussion.prepare('原始问题');
  state.composerText = '用户修改后的草稿';
  await assert.rejects(discussion.submit(), /草稿已改变/u);
  assert.equal(calls.click, 0);
  assert.equal((await session.read()).pending.stage, 'prepared');
});

test('Copilot 富文本草稿末尾的不可见标记不影响核验，正文变化仍会阻止发送', async t => {
  const { discussion, state, calls } = await fixture(t);
  await discussion.prepare('核验富文本草稿');
  state.composerText += '\u200B\u200C';
  await discussion.submit();
  assert.equal(calls.click, 1);
  assert.equal((await discussion.collect({ waitMs: 3 })).status, 'answered');
  await discussion.prepare('正文内的字符保持不变');
  state.composerText = '正文内的字符\u200C保持不变';
  await assert.rejects(discussion.submit(), /草稿已改变/u);
  assert.equal(calls.click, 1);
});

test('尊重人工草稿、暂停和完成状态', async t => {
  const { discussion, state, session, calls } = await fixture(t);
  state.composerText = '用户已有的输入';
  await assert.rejects(discussion.prepare('新问题'), /已有草稿/u);
  assert.equal(calls.fill, 0);
  state.composerText = '';
  await session.pause();
  await assert.rejects(discussion.prepare('新问题'), /未运行/u);
  await session.resume();
  await discussion.exchange('新问题', { waitMs: 3 });
  await session.finish('形成了可执行结论。');
  await assert.rejects(session.resume(), /已结束/u);
});

test('页面被切换到另一个聊天时拒绝发问', async t => {
  const { discussion, state, calls } = await fixture(t);
  await discussion.exchange('第一问', { waitMs: 3 });
  state.url = `${ROOT}/conversation/other`;
  await assert.rejects(discussion.prepare('第二问'), /另一个会话/u);
  assert.equal(calls.click, 1);
});

test('其他人追加问题后不把其回答归给待完成轮次', async t => {
  const { discussion, state, session } = await fixture(t, { noReply: true });
  await discussion.prepare('待完成的问题'); await discussion.submit();
  state.entries.push(user('人工插入的另一问'), answer('与本次无关的回答'));
  await assert.rejects(discussion.collect({ waitMs: 3 }), /出现其他提问/u);
  assert.equal((await session.read()).items.length, 0);
});

test('没有网页上的相同提问时，不接受稳定的旧回答', async t => {
  const { discussion, state, session } = await fixture(t, { noReply: true });
  await discussion.prepare('尚未确认的新问题'); await discussion.submit();
  state.entries = [user('另一个旧问题'), answer('旧答案')];
  assert.equal((await discussion.collect({ waitMs: 3 })).status, 'pending');
  assert.equal((await session.read()).items.length, 0);
});

test('重复问题与并发准备不会创建额外发送', async t => {
  const { discussion, session, calls } = await fixture(t);
  await discussion.exchange('同一个问题', { waitMs: 3 });
  await assert.rejects(discussion.prepare(' 同一个问题 '), /重复/u);
  const results = await Promise.allSettled([
    session.prepare('新问题一', '', {}), session.prepare('新问题二', '', {})
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(calls.click, 1);
});

test('REPL 丢失后重新绑定准确 URL 与最后提问，再继续读取', async t => {
  const { discussion, session, state } = await fixture(t, { noReply: true });
  await discussion.prepare('等待恢复的问题'); await discussion.submit();
  await discussion.collect({ waitMs: 0 });
  const reopened = await Session.open(session.file);
  const replacementTab = { ...discussion.tab, id: 'replacement' };
  const resumed = new CopilotDiscussion(replacementTab, reopened, { browserId: 'chrome-test' });
  await resumed.rebind();
  assert.equal((await reopened.read()).binding.tabId, 'replacement');
  state.entries = [user('其他提问')];
  await assert.rejects(resumed.rebind(), /最后提问/u);
});

test('续跑副本保留待完成轮次且不修改源文件', async t => {
  const { discussion, session, dir } = await fixture(t, { noReply: true });
  await discussion.prepare('不能丢失的未完成问题'); await discussion.submit();
  const source = await fs.readFile(session.file, 'utf8');
  const copy = await session.fork(dir);
  const saved = await copy.read();
  assert.notEqual(copy.file, session.file);
  assert.notEqual(saved.id, (await session.read()).id);
  assert.equal(saved.status, 'paused');
  assert.equal(saved.pending.question, '不能丢失的未完成问题');
  assert.equal(saved.sourceSession, session.file);
  assert.equal(await fs.readFile(session.file, 'utf8'), source);
});

test('准备草稿后 REPL 重置，能在原空白聊天恢复待发送状态', async t => {
  const { discussion, session } = await fixture(t);
  await discussion.prepare('已经准备但尚未发送的问题');
  const resumed = new CopilotDiscussion(discussion.tab, await Session.open(session.file), { browserId: 'chrome-test' });
  await resumed.rebind();
  await resumed.submit();
  assert.equal((await session.read()).pending.stage, 'submitted');
});

test('较早轮次的异步结果不能写进较新的待完成轮次', async t => {
  const { discussion, session } = await fixture(t);
  await discussion.prepare('第一轮');
  const oldId = (await session.read()).pending.id;
  await discussion.submit(); await discussion.collect({ waitMs: 3 });
  await discussion.prepare('下一轮');
  await assert.rejects(session.complete({ pendingId: oldId, answer: '第一轮的迟到结果', url: CHAT }), /过期结果/u);
  assert.equal((await session.read()).pending.question, '下一轮');
});

test('JSON 是权威副本，Markdown 缺失可重建；运行不遗留临时锁', async t => {
  const { discussion, session, dir } = await fixture(t);
  await discussion.exchange('完整保存', { waitMs: 3 });
  await fs.unlink(session.markdownFile);
  await session.exportMarkdown();
  assert.match(await fs.readFile(session.markdownFile, 'utf8'), /完整保存/u);
  assert.ok((await fs.readdir(dir)).every(file => /\.(json|md|jsonl)$/u.test(file)));
});

test('URL 校验拒绝外站、凭据和非聊天路径，并去除跟踪参数', () => {
  assert.equal(copilotUrl(`${CHAT}?tracking=1#fragment`, true), CHAT);
  for (const invalid of ['https://copilot.cloud.microsoft.evil.example/chat', 'http://copilot.cloud.microsoft/chat',
    'https://user:secret@copilot.cloud.microsoft/chat', 'https://copilot.cloud.microsoft/library/all',
    'https://copilot.cloud.microsoft:444/chat']) assert.throws(() => copilotUrl(invalid));
});

test('轮数限制与输出绝对路径在写入前校验', async t => {
  const { dir } = await fixture(t);
  await assert.rejects(Session.create({ topic: '测试', outputDir: dir, maxRounds: 31 }), /1 到 30/u);
  await assert.rejects(Session.create({ topic: '测试', outputDir: 'relative' }), /绝对路径/u);
});

test('阶段计时随问答持久化，计时写入失败不会触发重复点击', async t => {
  const { discussion, session, calls } = await fixture(t);
  await discussion.exchange('验证计时', { waitMs: 3 });
  const saved = await session.read();
  assert.ok(saved.items[0].timing.proposedAt);
  assert.ok(saved.items[0].timing.sendActionCompletedAt);
  assert.ok(saved.items[0].timing.firstObservedAt);
  assert.ok(saved.performance.events.some(event => event.operation === 'fill' && event.success));
  assert.ok(saved.performance.events.some(event => event.operation === 'click' && event.success));
  assert.ok(saved.performance.events.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0));
  session.recordTiming = async () => { throw new Error('模拟计时存储错误'); };
  await discussion.exchange('计时存储出错后仍安全发送', { waitMs: 3 });
  assert.equal(calls.click, 2);
  assert.ok(discussion.timingWarnings.length);
});

test('首问完成后才出现唯一会话 URL，原标签页可恢复读取且不重发', async t => {
  const { discussion, session, calls } = await fixture(t, { noReply: true });
  await discussion.prepare('首问的地址晚于发送更新'); await discussion.submit();
  await session.update(data => { delete data.pending.conversationUrl; });
  await discussion.rebind();
  assert.equal((await session.read()).pending.conversationUrl, CHAT);
  assert.equal(calls.click, 1);
});

test('首问的唯一地址尚未保存时，不能换一个标签页猜测恢复', async t => {
  const { discussion, session } = await fixture(t, { noReply: true });
  await discussion.prepare('必须保留原标签页'); await discussion.submit();
  await session.update(data => { delete data.pending.conversationUrl; });
  const other = new CopilotDiscussion({ ...discussion.tab, id: 'other-tab' }, session, { browserId: 'chrome-test' });
  await assert.rejects(other.rebind(), /会话地址/u);
});

test('用户明确不限制轮次时，null 可越过30轮且保留逐轮保护', async t => {
  const { dir } = await fixture(t);
  const session = await Session.create({ topic: '开放式讨论', maxRounds: null, outputDir: dir });
  await session.bind({ browserId: 'native', tabId: 'owned', url: CHAT });
  await session.update(data => { data.items = Array.from({ length: 31 }, (_, i) => ({
    index: i + 1, question: `已完成问题${i + 1}`, answer: '已记录回答' })); });
  await session.prepare('第32轮的新证据问题', '', {});
  const saved = await session.read();
  assert.equal(saved.maxRounds, null);
  assert.equal(saved.pending.index, 32);
  await assert.rejects(session.prepare('下一问', '', {}), /尚未完成/u);
});
