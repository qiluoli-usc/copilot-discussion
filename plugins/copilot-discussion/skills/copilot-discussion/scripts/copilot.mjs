import { copilotUrl } from './session.mjs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

// Copilot's rich editor appends invisible sentinel characters after fill().
// Ignore that suffix only; preserve meaningful joiners inside the message.
const normalize = value => value.trim().replace(/[\u200B\u200C\uFEFF]+$/gu, '').trim().replace(/\s+/gu, ' ');
const COMPOSER = /^(Message Copilot|向 Copilot 发送消息|给 Copilot 发送消息|向 Copilot 提问)$/iu;
const SEND = /^(Send|发送|发送消息|提交)$/iu;

// This function runs through the host's read-only DOM evaluator. It never uses
// fetch, hidden app state, page scripts, cookies, storage, or browser internals.
export function readVisibleConversation() {
  const visible = element => !!element.getClientRects().length &&
    getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
  function text(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || !visible(node)) return '';
    if (node.matches('button,[role="toolbar"],h5,h6,[aria-hidden="true"]')) return '';
    const content = Array.from(node.childNodes).map(text).join('');
    return /^(P|DIV|LI|UL|OL|PRE|BLOCKQUOTE|H[1-4]|TR)$/u.test(node.tagName) ? `\n${content}\n` : content;
  }
  const entries = Array.from(document.querySelectorAll('[role="article"]')).filter(visible).map(element => {
    const label = `${element.getAttribute('aria-labelledby') || ''} ${element.querySelector('h5,h6,[role="heading"]')?.textContent || ''}`;
    const role = /copilot-message|Copilot said|Copilot 说|Copilot 已说/iu.test(label) ? 'assistant' :
      /user-message|You said|你说|您说/iu.test(label) ? 'user' : 'unknown';
    const buttons = Array.from(element.querySelectorAll('button')).map(button => button.getAttribute('aria-label') || button.innerText);
    return { role, text: text(element).replace(/\n{3,}/gu, '\n\n').trim(),
      complete: buttons.some(label => /^(Copy Response|Copy response|复制响应|复制回答|复制回复)$/iu.test(label)),
      citations: Array.from(element.querySelectorAll('a[href]')).filter(visible).map(link => ({
        label: link.innerText.trim(), url: link.href
      })).filter(link => /^https?:\/\//u.test(link.url)) };
  });
  const buttons = Array.from(document.querySelectorAll('button')).filter(visible).map(button => button.getAttribute('aria-label') || button.innerText);
  const editor = document.getElementById('m365-chat-editor-target-element');
  return { entries, generating: buttons.some(label => /stop generating|stop responding|停止生成|停止响应|停止回答/iu.test(label)),
    composerText: editor && visible(editor) ? (editor.innerText || editor.value || '') : '',
    composerVisible: !!editor && visible(editor) };
}

export class CopilotDiscussion {
  constructor(tab, session, { browserId, composerName = COMPOSER, sendName = SEND, sleep,
    now = Date.now, pollMs = 1500, activePollMs = pollMs, completionPollMs = Math.min(pollMs, 200), transport = null } = {}) {
    if (!tab?.id || (!transport && !tab?.playwright?.evaluate)) throw new Error('需要已连接的浏览器标签页。');
    this.tab = tab;
    this.transport = transport;
    this.session = session;
    this.browserId = String(browserId || '');
    this.composerName = composerName;
    this.sendName = sendName;
    this.sleep = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = now;
    this.pollMs = pollMs;
    this.activePollMs = activePollMs;
    this.completionPollMs = completionPollMs;
    this.timingWarnings = [];
  }

  async measured(operation, scope, action) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let success = false, receipt;
    try { const result = await action(); success = true; receipt = result?.executorReceipt; return result; }
    finally {
      const event = { operation, scope, startedAt, durationMs: performance.now() - started, success };
      if (receipt) event.executorReceipt = receipt;
      // Optional telemetry must never turn an already successful click into a retry.
      await this.session.recordTiming(event).catch(error => this.timingWarnings.push(error.message));
    }
  }

  async snapshot(scope = 'inspect') {
    const { url, state } = await this.measured('snapshot', scope, async () => this.transport ?
      this.transport.read() : ({
      url: copilotUrl(await this.tab.url()), state: await this.tab.playwright.evaluate(readVisibleConversation)
    }));
    const cleanUrl = copilotUrl(url);
    if (state.entries.some(entry => entry.role === 'unknown')) {
      throw new Error('发现无法识别作者的消息；请读取新 DOM 快照并调整适配，不要把整页当作回答。');
    }
    return { ...state, url: cleanUrl };
  }

  assertBinding(data, snapshot) {
    if (!data.binding || data.binding.tabId !== String(this.tab.id) || data.binding.browserId !== this.browserId) {
      throw new Error('标签页与会话记录未绑定；恢复时先核验会话地址再 bind。');
    }
    const expected = data.conversationUrl || data.pending?.conversationUrl ||
      (data.binding.url.includes('/conversation/') ? data.binding.url : null);
    if (expected && snapshot.url !== expected) throw new Error('网页已切换到另一个会话，停止自动操作。');
  }

  async bindNew() {
    const snapshot = await this.snapshot('bind');
    if (snapshot.entries.length || snapshot.url.includes('/conversation/')) {
      throw new Error('需要一个空的新对话；请在专用标签页中新建聊天。');
    }
    if (!snapshot.composerVisible) throw new Error('输入框不可见，请完成登录或等待页面加载。');
    return this.session.bind({ browserId: this.browserId, tabId: this.tab.id, url: snapshot.url });
  }

  async rebind() {
    const data = await this.session.read({ includeTelemetry: false });
    const snapshot = await this.snapshot('rebind');
    const expected = data.conversationUrl || data.pending?.conversationUrl || data.binding?.url;
    const firstUrlTransition = data.pending && !data.conversationUrl && !data.pending.conversationUrl &&
      data.binding && !data.binding.url.includes('/conversation/') && snapshot.url.includes('/conversation/') &&
      new URL(data.binding.url).origin === new URL(snapshot.url).origin &&
      data.binding.tabId === String(this.tab.id) && data.binding.browserId === this.browserId;
    if (!expected || (expected !== snapshot.url && !firstUrlTransition)) throw new Error('恢复失败：会话地址与保存记录不一致。');
    const preparedDraft = data.pending && !data.pending.submittedAt &&
      ['prepared', 'draft_failed', 'uncertain'].includes(data.pending.stage);
    const anchor = preparedDraft ? data.items.at(-1)?.question : data.pending?.question || data.items.at(-1)?.question;
    if (anchor && !snapshot.entries.some(entry => entry.role === 'user' && normalize(entry.text) === normalize(anchor))) {
      throw new Error('恢复失败：页面中没有本次讨论的最后提问；请核对网页。');
    }
    if (preparedDraft && !anchor && snapshot.entries.length) throw new Error('恢复失败：空白会话中出现其他消息。');
    if (firstUrlTransition) {
      const lastUser = snapshot.entries.filter(entry => entry.role === 'user').at(-1);
      if (normalize(lastUser?.text || '') !== normalize(data.pending.question)) throw new Error('恢复失败：首问之后出现其他提问。');
      await this.session.update(record => {
        if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
        record.pending.conversationUrl = snapshot.url;
      });
    }
    return this.session.bind({ browserId: this.browserId, tabId: this.tab.id, url: snapshot.url });
  }

  async prepare(question, { analysis = '' } = {}) {
    const proposedAt = new Date().toISOString();
    const data = await this.session.read({ includeTelemetry: false });
    if (data.pending) throw new Error('上一轮尚未完成，请先 collect，不要重复发送。');
    if (data.status !== 'active') throw new Error('会话未运行；暂停后请显式恢复。');
    const before = await this.snapshot('prepare');
    this.assertBinding(data, before);
    if (before.generating) throw new Error('网页正在生成回答，先 collect。');
    if (normalize(before.composerText)) throw new Error('输入框中已有草稿；已停止，避免覆盖。');
    const previous = data.items.at(-1);
    const lastUser = before.entries.filter(entry => entry.role === 'user').at(-1);
    if ((previous && normalize(lastUser?.text || '') !== normalize(previous.question)) || (!previous && before.entries.length)) {
      throw new Error('网页消息与保存记录不一致，可能有人工插入的新问题；已停止。');
    }
    if (!before.composerVisible) throw new Error('Copilot 输入框不可见，请查看新 DOM 快照。');
    await this.session.prepare(question, analysis, {
      userCount: before.entries.filter(entry => entry.role === 'user').length,
      answerCount: before.entries.filter(entry => entry.role === 'assistant').length
    });
    await this.session.update(record => { record.pending.proposedAt = proposedAt; });
    try {
      await this.measured('fill', 'prepare', () => this.transport ?
        this.transport.fill(question.trim(), this.composerName) :
        this.tab.playwright.getByRole('textbox', { name: this.composerName }).fill(question.trim(), { timeoutMs: 10000 }));
    } catch (error) {
      await this.session.draftFailed(error.message);
      if (error.nativeErrorType === 'DecisionFailure') throw error;
      // Only the fill phase is recoverable. A fresh page proof, not the error
      // name, establishes whether refilling is safe. Never retry Send here.
      return this.recoverDraft();
    }
    return { status: 'prepared', message: '下一步 submit；同一问题不要再次 prepare。', file: this.session.file };
  }

  async recoverDraft({ maxAttempts = 2 } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 2) throw new Error('草稿恢复最多尝试两次。');
    for (;;) {
      const data = await this.session.read({ includeTelemetry: false });
      const pending = data.pending;
      if (data.status !== 'active' || !pending || pending.submittedAt ||
          !['prepared', 'draft_failed', 'uncertain'].includes(pending.stage)) {
        throw new Error('仅可恢复尚未尝试发送的草稿；已提交或发送不确定的消息只能先 collect。');
      }
      const snapshot = await this.snapshot('draft-recovery');
      this.assertBinding(data, snapshot);
      const users = snapshot.entries.filter(entry => entry.role === 'user');
      const answers = snapshot.entries.filter(entry => entry.role === 'assistant');
      const previous = data.items.at(-1);
      if (snapshot.generating || !snapshot.composerVisible ||
          users.length !== pending.baseline?.userCount || answers.length !== pending.baseline?.answerCount ||
          users.some(entry => normalize(entry.text) === normalize(pending.question)) ||
          (previous ? normalize(users.at(-1)?.text || '') !== normalize(previous.question) : snapshot.entries.length)) {
        throw new Error('草稿恢复核验失败：消息、生成状态或输入框已改变，保留记录并停止。');
      }
      const draft = normalize(snapshot.composerText);
      if (draft === normalize(pending.question)) {
        await this.session.update(record => {
          if (record.pending?.id !== pending.id || record.pending.submittedAt) throw new Error('待完成轮次已改变。');
          record.pending.stage = 'prepared';
          record.pending.draftRecoveredAt = new Date().toISOString();
          delete record.pending.error;
        });
        return { status: 'prepared', recoveredDraft: true, file: this.session.file };
      }
      if (draft) throw new Error('输入框存在不同草稿，停止恢复以免覆盖。');
      if ((pending.draftRecoveryAttempts || 0) >= maxAttempts) throw new Error('草稿自动恢复次数已用尽；未尝试发送，保留待完成记录。');
      await this.session.update(record => {
        if (record.pending?.id !== pending.id || record.pending.submittedAt) throw new Error('待完成轮次已改变。');
        record.pending.draftRecoveryAttempts = (record.pending.draftRecoveryAttempts || 0) + 1;
      });
      try {
        await this.measured('fill', 'draft-recovery', () => this.transport ?
          this.transport.fill(pending.question, this.composerName) :
          this.tab.playwright.getByRole('textbox', { name: this.composerName }).fill(pending.question, { timeoutMs: 10000 }));
      } catch (error) {
        await this.session.draftFailed(error.message);
        if (error.nativeErrorType === 'DecisionFailure') throw error;
      }
      // Even a failed fill may have executed. Inspect again before any retry.
    }
  }

  async submit() {
    let data = await this.session.read({ includeTelemetry: false });
    if (data.pending && !data.pending.submittedAt && data.pending.stage !== 'prepared') {
      await this.recoverDraft();
      data = await this.session.read({ includeTelemetry: false });
    }
    if (data.status !== 'active') throw new Error('会话已暂停或结束，不能发送。');
    if (data.pending?.stage !== 'prepared') throw new Error('没有可提交的草稿；已提交或不确定的消息只能先 collect。');
    let snapshot = await this.snapshot('submit');
    this.assertBinding(data, snapshot);
    if (!data.pending.submittedAt && !snapshot.generating && !normalize(snapshot.composerText)) {
      // A crash can occur after the journal is prepared but before fill runs.
      // The same fresh proof and persistent limit apply to this empty draft.
      await this.recoverDraft();
      data = await this.session.read({ includeTelemetry: false });
      snapshot = await this.snapshot('submit');
      this.assertBinding(data, snapshot);
    }
    if (snapshot.generating || normalize(snapshot.composerText) !== normalize(data.pending.question)) {
      throw new Error('草稿已改变或页面正在生成回答，请核对网页。');
    }
    await this.session.markSubmitted();
    try {
      await this.measured('click', 'submit', () =>
        this.transport ? this.transport.send(this.sendName, data.pending.question, this.composerName) :
          this.tab.playwright.getByRole('button', { name: this.sendName }).click({ timeoutMs: 10000 }));
      await this.session.update(record => {
        if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
        record.pending.sendActionCompletedAt = new Date().toISOString();
      });
      const url = copilotUrl(await this.tab.url());
      if (url.includes('/conversation/')) {
        await this.session.update(record => {
          if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
          record.pending.conversationUrl = url;
        });
      }
    } catch (error) {
      await this.session.uncertain(error.message);
      throw new Error(`本轮发送状态不确定；先读取网页并 collect，禁止自动重发。${error.message}`);
    }
    return { status: 'submitted', message: '下一步 collect 读取本轮回答。', file: this.session.file };
  }

  async exchange(question, { analysis = '', waitMs = 45000 } = {}) {
    await this.prepare(question, { analysis });
    await this.submit();
    return this.collect({ waitMs });
  }

  async collect({ waitMs = 45000 } = {}) {
    if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 45000) throw new Error('单次等待须为 0 到 45000 毫秒。');
    const started = this.now();
    let lastText = '';
    let stable = 0;
    let completionObservedAt = null;
    do {
      const data = await this.session.read({ includeTelemetry: false });
      if (!data.pending) return { status: data.status, rounds: data.items.length, last: data.items.at(-1) || null, file: this.session.file };
      const snapshot = await this.snapshot('collect');
      this.assertBinding(data, snapshot);
      const question = normalize(data.pending.question);
      const matches = snapshot.entries.map((entry, index) => entry.role === 'user' && normalize(entry.text) === question ? index : -1).filter(index => index >= 0);
      if (matches.length > 1) throw new Error('发现重复的待完成提问，需核对网页，不能自动选择回答。');
      if (matches.length === 1) {
        const after = snapshot.entries.slice(matches[0] + 1);
        if (after.some(entry => entry.role === 'user')) throw new Error('待完成问题之后出现其他提问，已停止自动读取。');
        if (snapshot.url.includes('/conversation/') && !data.pending.conversationUrl) {
          await this.session.update(record => {
            if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
            record.pending.conversationUrl = snapshot.url;
          });
        }
        const replies = after.filter(entry => entry.role === 'assistant');
        if (replies.length > 1) throw new Error('同一提问后出现多个回答，需核对网页。');
        const reply = replies[0];
        if (reply?.text) {
          if (!data.pending.firstObservedAt) {
            await this.session.update(record => {
              if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
              record.pending.firstObservedAt ||= new Date().toISOString();
            });
          }
          stable = reply.text === lastText ? stable + 1 : 0;
          if (!stable) completionObservedAt = null;
          lastText = reply.text;
          if (reply.complete && !snapshot.generating) {
            const digest = createHash('sha256').update(reply.text).digest('hex');
            const candidate = data.pending.completionCandidate;
            if (candidate?.digest === digest) {
              completionObservedAt = candidate.observedAt;
              stable = Math.max(stable, 1);
            } else {
              completionObservedAt = new Date().toISOString();
              await this.session.update(record => {
                if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
                record.pending.completionCandidate = { digest, observedAt: completionObservedAt };
              });
            }
          } else {
            completionObservedAt = null;
            if (data.pending.completionCandidate) await this.session.update(record => {
              if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
              delete record.pending.completionCandidate;
            });
          }
          // A stable string alone can be a stalled stream. Also require the
          // completed response's Copy button and absence of Stop generating.
          if (reply.complete && !snapshot.generating && stable >= 1) {
            await this.session.update(record => {
              if (record.pending?.id !== data.pending.id) throw new Error('待完成轮次已改变。');
              record.pending.completionObservedAt = completionObservedAt;
            });
            const saved = await this.session.complete({ pendingId: data.pending.id,
              answer: reply.text, citations: reply.citations, url: snapshot.url });
            return { status: 'answered', rounds: saved.items.length,
              remaining: saved.maxRounds === null ? null : saved.maxRounds - saved.items.length,
              answer: reply.text, citations: reply.citations, url: saved.conversationUrl, file: this.session.file };
          }
        }
      }
      if (this.now() - started >= waitMs) break;
      const tail = snapshot.entries.at(-1);
      const interval = tail?.role === 'assistant' && tail.complete && !snapshot.generating ?
        this.completionPollMs : snapshot.generating ? this.activePollMs : this.pollMs;
      await this.sleep(Math.min(interval, Math.max(0, waitMs - (this.now() - started))));
    } while (this.now() - started < waitMs);
    return { status: 'pending', message: '继续 collect 等待结果，不要再次 exchange。', file: this.session.file };
  }
}
