import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_URL = 'https://copilot.cloud.microsoft/chat';
const HOSTS = new Set(['copilot.cloud.microsoft', 'm365.cloud.microsoft']);
const normalize = text => text.trim().replace(/[\u200B\u200C\uFEFF]+$/gu, '').trim().replace(/\s+/gu, ' ');
const now = () => new Date().toISOString();

export function copilotUrl(value, conversationOnly = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('仅支持 Microsoft 365 Copilot 的 HTTPS 页面。');
  }
  if (!/^\/chat(?:\/conversation\/[\w-]+)?\/?$/u.test(url.pathname)) {
    throw new Error('页面必须是 Copilot 聊天或会话地址。');
  }
  if (conversationOnly && !url.pathname.includes('/conversation/')) {
    throw new Error('尚未取得唯一 Copilot 会话地址。');
  }
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/u, '');
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}不能为空。`);
  return value.trim();
}

function validate(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.items) || !data.id || !data.topic) {
    throw new Error('不支持的会话记录格式；原 DeepSeek 结果请作为背景读取。');
  }
  if (data.maxRounds !== null && (!Number.isInteger(data.maxRounds) || data.maxRounds < 1 || data.maxRounds > 30)) {
    throw new Error('maxRounds 必须在 1 到 30 之间，或为 null（无预设轮数）。');
  }
  if (!['active', 'paused', 'completed'].includes(data.status)) throw new Error('会话状态无效。');
  if (data.binding) copilotUrl(data.binding.url);
  if (data.conversationUrl) copilotUrl(data.conversationUrl, true);
  return data;
}

export async function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function renderMarkdown(data) {
  const lines = [`# ${data.topic}`, '', `- 状态：${data.status}`, `- 轮数：${data.items.length}/${data.maxRounds ?? '无预设上限'}`,
    `- 创建时间：${data.createdAt}`, `- 会话：${data.conversationUrl || '尚未发送首问'}`, ''];
  if (data.context) lines.push('## 讨论背景', '', data.context, '');
  for (const item of data.items) {
    lines.push(`## 第 ${item.index} 轮`, '', `提交：${item.sentAt}；回答保存：${item.capturedAt}。`, '', '### 当前对话提问', '', item.question, '',
      '### Copilot 回答', '', item.answer, '');
    if (item.analysis) lines.push('### 当前对话的判断与追问依据', '', item.analysis, '');
    if (item.citations?.length) lines.push('### 回答中的链接', '', ...item.citations.map(c => `- ${c.label || c.url}：${c.url}`), '');
  }
  if (data.pending) lines.push('## 未完成的发送', '', `状态：${data.pending.stage}`, '', data.pending.question, '',
    '恢复时先检查网页，避免重复发送。', '');
  if (data.pauseReason) lines.push('## 暂停原因', '', data.pauseReason, '');
  if (data.summary) lines.push('## 当前对话总结', '', data.summary, '');
  return `${lines.join('\n')}\n`;
}

export class Session {
  constructor(file) { this.file = path.resolve(file); }

  static async create({ topic, context = '', maxRounds = 8, outputDir, fileName }) {
    requireText(topic, '主题');
    if (!outputDir || !path.isAbsolute(outputDir)) throw new Error('outputDir 必须是工作项目下的绝对路径。');
    if (typeof context !== 'string') throw new Error('context 必须是字符串。');
    const id = randomUUID();
    const slug = topic.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'discussion';
    const stamp = now();
    const data = validate({ schemaVersion: 1, id, topic: topic.trim(), context, maxRounds, status: 'active',
      createdAt: stamp, updatedAt: stamp, revision: 0, binding: null, conversationUrl: null, items: [], pending: null });
    await fs.mkdir(outputDir, { recursive: true });
    if (fileName && (path.basename(fileName) !== fileName || !/^[\p{L}\p{N}_.-]+\.json$/u.test(fileName))) throw new Error('fileName 必须是本目录内的 JSON 文件名。');
    const file = path.join(outputDir, fileName || `${stamp.replace(/[:.]/gu, '-')}_${slug}_${id.slice(0, 8)}.json`);
    data.performance = { events: [], journal: path.basename(file.replace(/\.json$/u, '.events.jsonl')) };
    await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    const session = new Session(file);
    await session.exportMarkdown();
    return session;
  }

  static async open(file) {
    const session = new Session(file);
    await session.read();
    return session;
  }

  async read({ includeTelemetry = true } = {}) {
    const data = validate(JSON.parse(await fs.readFile(this.file, 'utf8')));
    this.round = data.pending?.index || data.items.length + 1;
    if (includeTelemetry && data.performance?.journal) {
      if (data.performance.journal !== path.basename(this.timingFile)) throw new Error('计时日志位置无效。');
      let content = '';
      try { content = await fs.readFile(this.timingFile, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const events = [];
      const lines = content.split('\n');
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); }
        catch {
          // A crash can interrupt the last append. Never fabricate that event.
          if (index === lines.length - 1) data.performance.warning = '计时日志末行不完整；保留原文件，未计入该事件。';
          else throw new Error('计时日志中间存在损坏记录。');
        }
      }
      data.performance.events = [...(data.performance.events || []), ...events];
    }
    return data;
  }

  async update(mutator) {
    let lock;
    try { lock = await fs.open(`${this.file}.lock`, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('会话正在被另一个操作使用；请等待，不要并发发送。');
      throw error;
    }
    try {
      const data = await this.read({ includeTelemetry: false });
      await mutator(data);
      data.revision += 1;
      data.updatedAt = now();
      validate(data);
      await atomicWrite(this.file, `${JSON.stringify(data, null, 2)}\n`);
      // JSON is authoritative. A failed Markdown export never invalidates a saved answer.
      await atomicWrite(this.markdownFile, renderMarkdown(data)).catch(() => {});
      return data;
    } finally {
      await lock.close();
      await fs.unlink(`${this.file}.lock`);
    }
  }

  get markdownFile() { return this.file.replace(/\.json$/u, '.md'); }
  get timingFile() { return this.file.replace(/\.json$/u, '.events.jsonl'); }

  async exportMarkdown() {
    await atomicWrite(this.markdownFile, renderMarkdown(await this.read()));
    return this.markdownFile;
  }

  async bind({ browserId, tabId, url }) {
    return this.update(data => {
      if (!browserId || !tabId) throw new Error('必须提供实际观察到的 browserId 和 tabId。');
      const clean = copilotUrl(url);
      if (data.conversationUrl && clean !== data.conversationUrl) throw new Error('不能绑定到另一个 Copilot 会话。');
      data.binding = { browserId: String(browserId), tabId: String(tabId), url: clean };
    });
  }

  async prepare(question, analysis, baseline) {
    return this.update(data => {
      question = requireText(question, '提问');
      if (!data.binding) throw new Error('请先绑定新建或已核验的 Copilot 标签页。');
      if (data.status !== 'active') throw new Error('会话未运行；暂停后请显式恢复。');
      if (data.pending) throw new Error('上一轮尚未完成，请先 collect，不要重复发送。');
      if (data.maxRounds !== null && data.items.length >= data.maxRounds) throw new Error('已达到约定轮数。');
      if (data.items.some(item => normalize(item.question) === normalize(question))) throw new Error('提问与已完成轮次重复。');
      data.pending = { id: randomUUID(), index: data.items.length + 1, question, analysis: analysis || '',
        baseline, stage: 'prepared', preparedAt: now() };
    });
  }

  async markSubmitted() {
    return this.update(data => {
      if (!data.pending || data.pending.stage !== 'prepared') throw new Error('没有可提交的已准备问题。');
      // Commit before clicking Send. A transport timeout must never trigger an automatic resend.
      data.pending.stage = 'submitted';
      data.pending.submittedAt = now();
    });
  }

  async uncertain(reason) {
    return this.update(data => {
      if (data.pending) { data.pending.stage = 'uncertain'; data.pending.error = String(reason); }
    });
  }

  async draftFailed(reason) {
    return this.update(data => {
      if (!data.pending || data.pending.submittedAt) throw new Error('已尝试发送的消息不能降级为未发送草稿。');
      data.pending.stage = 'draft_failed';
      data.pending.error = String(reason);
    });
  }

  async complete({ pendingId, answer, url, citations = [] }) {
    return this.update(data => {
      if (!data.pending) throw new Error('没有待完成的轮次。');
      if (pendingId !== data.pending.id) throw new Error('回答所属轮次已改变，不能保存过期结果。');
      const clean = copilotUrl(url, true);
      if (data.conversationUrl && clean !== data.conversationUrl) throw new Error('回答来自另一个 Copilot 会话。');
      const { id, index, question, analysis, submittedAt, preparedAt } = data.pending;
      data.items.push({ id, index, question, analysis, answer: requireText(answer, '回答'),
        citations, sentAt: submittedAt || preparedAt, capturedAt: now(),
        timing: { preparedAt, proposedAt: data.pending.proposedAt || null,
          sendActionCompletedAt: data.pending.sendActionCompletedAt || null,
          firstObservedAt: data.pending.firstObservedAt || null,
          completionObservedAt: data.pending.completionObservedAt || null,
          draftRecoveryAttempts: data.pending.draftRecoveryAttempts || 0 } });
      data.pending = null;
      data.conversationUrl = clean;
      data.binding.url = clean;
    });
  }

  async recordTiming(event) {
    if (!Number.isFinite(event.durationMs) || event.durationMs < 0) throw new Error('计时数据无效。');
    const data = await this.read({ includeTelemetry: false });
    if (data.performance?.journal) {
      if (data.performance.journal !== path.basename(this.timingFile)) throw new Error('计时日志位置无效。');
      // Append one small event. Do not rewrite the growing answer transcript and
      // Markdown on every read-only polling operation.
      await fs.appendFile(this.timingFile, JSON.stringify({ id: randomUUID(), ...event, round: event.round ?? this.round }) + '\n', 'utf8');
      return;
    }
    return this.update(data => {
      data.performance ||= { events: [] };
      data.performance.events.push({ ...event, round: data.pending?.index || data.items.length + 1 });
    });
  }

  async pause(reason = '用户暂停') {
    return this.update(data => { if (data.status !== 'completed') { data.status = 'paused'; data.pauseReason = reason; } });
  }

  async resume() {
    return this.update(data => {
      if (data.status === 'completed') throw new Error('会话已结束；如需新讨论，请创建新记录。');
      data.status = 'active'; delete data.pauseReason;
    });
  }

  async finish(summary) {
    return this.update(data => {
      if (data.pending) throw new Error('存在未完成轮次；请先读取结果或保持暂停。');
      data.summary = requireText(summary, '总结'); data.status = 'completed'; data.completedAt ||= now();
    });
  }

  async fork(outputDir) {
    const original = await this.read();
    const copy = await Session.create({ ...original, outputDir });
    await copy.update(data => Object.assign(data, structuredClone(original), {
      id: data.id, createdAt: data.createdAt, sourceSession: this.file, revision: 0,
      performance: { ...original.performance, events: original.performance?.events || [], journal: path.basename(copy.timingFile) },
      status: original.status === 'completed' ? 'completed' : 'paused'
    }));
    return copy;
  }
}
