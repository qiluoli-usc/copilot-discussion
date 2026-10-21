import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { NativeClient } from './native-client.mjs';
import { Session, atomicWrite, renderMarkdown } from './session.mjs';
import { summarizeRun, runPerformanceMarkdown } from './metrics.mjs';

const stamp = () => new Date().toISOString();
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}不能为空。`);
  return value.trim();
};
const publicURL = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('研究来源应是无凭据的公开 HTTPS 链接。');
  return url.href;
};
const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
const json = data => JSON.stringify(data, null, 2) + '\n';
const bullet = values => values?.length ? values.map(value => `- ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n') : '未列出。';

export class ResearchRun {
  constructor(file, { client = new NativeClient() } = {}) {
    this.file = path.resolve(file);
    this.root = path.dirname(this.file);
    this.client = client;
  }

  static async create({ workspaceDir, outputDir, maxRounds = 8, stopCriteria = [], context = '',
    discussionStyle = 'delta', answerBudgetCharacters = 450 }, options) {
    if (!workspaceDir || !path.isAbsolute(workspaceDir)) throw new Error('workspaceDir 必须是工作项目绝对路径。');
    if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 30)) throw new Error('轮数应为1～30或null。');
    if (!['delta', 'expanded'].includes(discussionStyle)) throw new Error('discussionStyle 应为 delta 或 expanded。');
    if (!Number.isInteger(answerBudgetCharacters) || answerBudgetCharacters < 100 || answerBudgetCharacters > 5000) throw new Error('回答长度预算应为100～5000字。');
    const startedAt = stamp();
    const id = randomUUID();
    const root = path.resolve(outputDir || path.join(workspaceDir, 'output', 'research-runs', `${startedAt.replace(/[:.]/gu, '-')}_${id.slice(0, 8)}`));
    const workspace = path.resolve(workspaceDir);
    if (!root.startsWith(workspace + path.sep)) throw new Error('运行输出须在本工作项目内的独立目录。');
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, 'run.json');
    await fs.writeFile(file, json({ schemaVersion: 1, id, startedAt, status: 'selecting', maxRounds,
      context, stopCriteria, discussionStyle, answerBudgetCharacters, sessionFile: null, engine: 'jev-native-executor' }), { flag: 'wx' });
    for (const name of ['requests', 'responses', 'transcript']) await fs.mkdir(path.join(root, name));
    const run = new ResearchRun(file, options);
    await atomicWrite(run.resolve('README.md'), '# 研究运行\n\nrun.json 为运行状态，topics.json 为选题依据；requests/、responses/ 保存逐轮收发；transcript/ 保存原始会话与计时事件。结束时生成 report.md、timing.json、timing.md 和 manifest.json。\n');
    return run;
  }

  static async open(file, options) {
    const run = new ResearchRun(file, options);
    await run.read();
    return run;
  }

  resolve(relative) {
    const resolved = path.resolve(this.root, relative);
    if (!resolved.startsWith(this.root + path.sep)) throw new Error('路径越出本次运行目录。');
    return resolved;
  }

  async read() {
    const data = await readJSON(this.file);
    if (data.schemaVersion !== 1 || data.engine !== 'jev-native-executor' || !data.id) throw new Error('不是受支持的研究运行记录。');
    return data;
  }

  async save(data) { await atomicWrite(this.file, json(data)); }

  async exclusive(action) {
    let lock;
    try { lock = await fs.open(this.file + '.lock', 'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('本次研究正在执行其他操作，请勿并发发送。'); throw error; }
    try { return await action(); }
    finally { await lock.close(); await fs.unlink(this.file + '.lock'); }
  }

  async select({ candidates, selectedId, reason }) {
    return this.exclusive(async () => {
      const data = await this.read();
      if (data.sessionFile || data.status !== 'selecting') throw new Error('讨论开始后不能更换选题，需新建运行。');
      if (!Array.isArray(candidates) || !candidates.length) throw new Error('请提供根据已读公开资料形成的候选主题。');
      if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error('候选主题ID重复。');
      for (const candidate of candidates) {
        for (const field of ['id', 'question', 'why', 'hypothesis', 'counterEvidence', 'firstQuestion']) required(candidate[field], field);
        if (!candidate.sources?.length) throw new Error('每个候选至少需要一个已读免费原始来源。');
        for (const source of candidate.sources) {
          publicURL(source.url);
          required(source.title, '来源标题'); required(source.versionDate, '来源版本日期'); required(source.limits, '证据局限');
          if (!Number.isFinite(Date.parse(source.readAt)) || source.access !== 'public-free') throw new Error('记录来源实际阅读时间与public-free访问方式，付费来源不能混入。');
        }
      }
      const selected = candidates.find(candidate => candidate.id === selectedId);
      if (!selected) throw new Error('selectedId不在候选主题中。');
      await atomicWrite(this.resolve('topics.json'), json({ selectedId, reason: required(reason, '选择依据'), candidates, selectedAt: stamp() }));
      await atomicWrite(this.resolve('evidence.json'), json({ updates: [] }));
      Object.assign(data, { topic: selected.question, selectedId, status: 'ready', selectedAt: stamp() });
      await this.save(data);
      return { status: data.status, runFile: this.file, topic: data.topic, firstQuestion: selected.firstQuestion };
    });
  }

  async invoke(command, request, data) {
    const event = { id: randomUUID(), command, startedAt: stamp() };
    try {
      const result = await this.client.command(command, request);
      event.status = result.status;
      return result;
    } catch (error) {
      event.status = 'error'; event.message = error.message;
      if (error.sessionFile) data.sessionFile = path.relative(this.root, error.sessionFile);
      data.status = 'needs_attention';
      await this.save(data);
      throw error;
    } finally {
      event.finishedAt = stamp();
      await fs.appendFile(this.resolve('events.jsonl'), JSON.stringify(event) + '\n', 'utf8');
    }
  }

  async start(options = {}) {
    return this.exclusive(async () => {
      const data = await this.read();
      if (!data.selectedId) throw new Error('先完成选题与来源记录。');
      if (data.sessionFile) throw new Error('本次已创建会话，请bind、status或collect恢复，不要再次start。');
      const topics = await readJSON(this.resolve('topics.json'));
      const selected = topics.candidates.find(candidate => candidate.id === data.selectedId);
      const result = await this.invoke('start', { ...options, topic: data.topic,
        context: [data.context, selected.why, selected.hypothesis, ...selected.sources.map(source => `${source.title} ${source.url} (${source.versionDate})；局限：${source.limits}`)].join('\n'),
        maxRounds: data.maxRounds, outputDir: this.resolve('transcript'), fileName: 'session.json' }, data);
      data.sessionFile = path.relative(this.root, result.sessionFile);
      data.status = result.status === 'ready' ? 'active' : 'needs_attention';
      await this.save(data);
      return { ...result, runFile: this.file };
    });
  }

  async ask({ question, analysis = '', basedOnRound, expectedProgress, waitMs = 45000, discussionStyle }) {
    return this.exclusive(async () => {
      const data = await this.read();
      if (data.status !== 'active') throw new Error('研究未运行，先检查状态并恢复。');
      const sessionFile = this.resolve(data.sessionFile);
      const saved = await (await Session.open(sessionFile)).read({ includeTelemetry: false });
      if (saved.pending) throw new Error('上一轮尚未完成，只能检查或collect，禁止重发。');
      const previous = saved.items.at(-1);
      if (previous && (basedOnRound !== previous.index || !analysis.trim() || !expectedProgress?.trim())) throw new Error('追问须引用最新轮次，并记录简要依据与预期推进点。');
      if (saved.maxRounds !== null && saved.items.length >= saved.maxRounds) throw new Error('已达到约定轮数。');
      const intentQuestion = required(question, '问题');
      const style = discussionStyle || data.discussionStyle || 'expanded';
      if (!['delta', 'expanded'].includes(style)) throw new Error('discussionStyle 应为 delta 或 expanded。');
      const budget = data.answerBudgetCharacters || 450;
      const directive = `【本轮讨论约定】只处理本问新增争点，不重述已确认背景或整套方案。先给新增判断，再给必要证据、推导或反例，最后列仍未决项；目标约${budget}字，必要公式与直接来源链接可超出。证据不足请明确说明，不为凑新结论而猜测。`;
      const actualQuestion = style === 'delta' ? `${intentQuestion}\n\n${directive}` : intentQuestion;
      const normalized = actualQuestion.replace(/\s+/gu, ' ');
      if (saved.items.some(item => item.question.replace(/\s+/gu, ' ') === normalized)) throw new Error('问题与已完成轮次重复。');
      const index = saved.items.length + 1;
      const name = `round-${String(index).padStart(3, '0')}.json`;
      const request = { sessionFile, question: actualQuestion, intentQuestion, discussionStyle: style, answerBudgetCharacters: budget,
        analysis, basedOnRound: basedOnRound ?? null,
        expectedProgress: expectedProgress || '', requestedAt: stamp(), waitMs };
      await fs.writeFile(this.resolve(`requests/${name}`), json(request), { flag: 'wx' });
      let result;
      try { result = await this.invoke('ask', request, data); }
      catch (error) {
        const after = await (await Session.open(sessionFile)).read({ includeTelemetry: false });
        if (!after.pending) await fs.rename(this.resolve(`requests/${name}`), this.resolve(`requests/attempt-${randomUUID()}.json`));
        throw error;
      }
      await atomicWrite(this.resolve(`responses/${name}`), json(result));
      if (result.status === 'answered') { data.lastAnswerAt = stamp(); await this.save(data); }
      return { ...result, runFile: this.file, nextAction: result.status === 'answered' ? '评估证据增量后追问或finish' : 'collect' };
    });
  }

  async control(command, options = {}) {
    return this.exclusive(async () => {
      if (!['collect', 'submit', 'recover-draft', 'bind', 'status', 'pause', 'resume', 'close'].includes(command)) throw new Error('不支持的控制命令。');
      const data = await this.read();
      if (!data.sessionFile) return { status: data.status, runFile: this.file };
      const sessionFile = this.resolve(data.sessionFile);
      const saved = await (await Session.open(sessionFile)).read({ includeTelemetry: false });
      if (command === 'status' && options.browser !== true) return { status: data.status, pending: saved.pending?.stage || null, rounds: saved.items.length, runFile: this.file, sessionFile };
      if (data.status === 'completed' && !['status', 'close'].includes(command)) throw new Error('研究已完成，不能重新发送或续开。');
      const result = await this.invoke(command, { ...options, sessionFile }, data);
      if (['collect', 'submit', 'recover-draft'].includes(command) && saved.pending) {
        const name = `round-${String(saved.pending.index).padStart(3, '0')}.json`;
        await atomicWrite(this.resolve(`responses/${name}`), json(result));
      }
      if (command === 'pause') { data.status = 'paused'; await this.client.dispose(); }
      else if (command === 'resume' || (command === 'bind' && result.status === 'ready')) data.status = 'active';
      else if (result.status === 'answered') data.status = saved.status === 'paused' ? 'paused' : 'active';
      await this.save(data);
      if (data.status === 'completed') await this.exportUnlocked();
      return { ...result, runFile: this.file };
    });
  }

  async watch({ maxMs = 600000, sliceMs = 15000, signal, onProgress } = {}) {
    if (!Number.isFinite(maxMs) || maxMs < 0 || maxMs > 3600000 ||
        !Number.isFinite(sliceMs) || sliceMs < 1 || sliceMs > 45000) throw new Error('持续采集总窗口应为0～3600000毫秒，分段为1～45000毫秒。');
    const event = { command: 'watch', startedAt: stamp(), cycles: 0, status: 'pending' };
    const started = Date.now();
    let result = { status: 'pending', runFile: this.file, nextAction: 'collect' };
    try {
      while (!signal?.aborted && Date.now() - started < maxMs) {
        const data = await this.read();
        if (data.status === 'paused' || data.status === 'completed') {
          result = { status: data.status, runFile: this.file }; break;
        }
        const saved = await (await Session.open(this.resolve(data.sessionFile))).read({ includeTelemetry: false });
        if (!saved.pending) { result = { status: data.status, rounds: saved.items.length, runFile: this.file }; break; }
        if (!saved.pending.submittedAt) throw new Error('未发送的草稿应先 recover-draft/submit，持续采集不会发送消息。');
        const remaining = maxMs - (Date.now() - started);
        if (remaining <= 0) break;
        result = await this.control('collect', { waitMs: Math.min(sliceMs, remaining) });
        event.cycles++;
        if (result.status === 'answered') break;
        // Optional notifications must never invalidate a captured answer.
        try { await onProgress?.({ event: 'collecting', cycles: event.cycles, elapsedMs: Date.now() - started, round: saved.pending.index }); } catch {}
      }
      if (signal?.aborted && result.status === 'pending') result = { ...result, collectionStopped: true };
      event.status = result.status;
      return result;
    } catch (error) { event.status = 'error'; event.message = error.message; throw error; }
    finally { event.finishedAt = stamp(); await fs.appendFile(this.resolve('events.jsonl'), JSON.stringify(event) + '\n', 'utf8'); }
  }

  async evidence(updates) {
    return this.exclusive(async () => {
      if (!Array.isArray(updates) || !updates.length) throw new Error('请提供证据核验或纠正记录。');
      for (const entry of updates) {
        required(entry.claim, '待核验主张'); required(entry.finding, '核验结果');
        if (!['verified', 'disputed', 'inference', 'unverified'].includes(entry.status)) throw new Error('核验状态无效。');
        for (const url of entry.sources || []) publicURL(url);
      }
      const file = this.resolve('evidence.json');
      const evidence = await readJSON(file);
      evidence.updates.push(...updates.map(entry => ({ ...entry, recordedAt: stamp() })));
      await atomicWrite(file, json(evidence));
      return { recorded: updates.length, file };
    });
  }

  async finish({ summary, stopReason, agreements = [], disagreements = [], openQuestions = [], limitations = [] }) {
    return this.exclusive(async () => {
      const data = await this.read();
      required(summary, '主持总结'); required(stopReason, '结束依据');
      if (!data.sessionFile) throw new Error('没有已开始的讨论。');
      await this.invoke('finish', { sessionFile: this.resolve(data.sessionFile), summary }, data);
      Object.assign(data, { status: 'completed', conclusion: { summary, stopReason, agreements, disagreements, openQuestions, limitations } });
      await this.save(data);
      try { return await this.exportUnlocked(); }
      finally { await this.client.dispose(); }
    });
  }

  async export() {
    return this.exclusive(() => this.exportUnlocked());
  }

  async exportUnlocked() {
    const data = await this.read();
    if (data.status !== 'completed' || !data.conclusion) throw new Error('先完成主持总结，才能导出最终研究报告。');
    const session = await (await Session.open(this.resolve(data.sessionFile))).read();
    if (session.pending || session.status !== 'completed') throw new Error('存在未完成轮次。');
    const topics = await readJSON(this.resolve('topics.json'));
    const selected = topics.candidates.find(candidate => candidate.id === data.selectedId);
    for (const item of session.items) {
      const name = `round-${String(item.index).padStart(3, '0')}.json`;
      const request = await readJSON(this.resolve(`requests/${name}`));
      const response = await readJSON(this.resolve(`responses/${name}`));
      if (request.question !== item.question || response.answer !== item.answer || response.status !== 'answered') throw new Error(`第${item.index}轮收发记录不一致。`);
    }
    await atomicWrite(this.resolve('transcript/full-record.md'), renderMarkdown(session));
    await atomicWrite(this.resolve('transcript/complete.json'), json(session));
    data.completedAt ||= stamp();
    const timing = summarizeRun(session, { startedAt: data.startedAt, completedAt: data.completedAt });
    const c = data.conclusion;
    const report = [`# ${data.topic}`, '', c.summary, '',
      `实际完成 ${session.items.length} 轮；轮数上限：${data.maxRounds ?? '未设置'}。停止依据：${c.stopReason}`, '',
      '## 已形成的结论', '', bullet(c.agreements), '', '## 分歧与修正', '', bullet(c.disagreements), '',
      '## 仍需验证', '', bullet(c.openQuestions), '', '## 证据与结论的局限', '', bullet(c.limitations), '',
      '## 选题依据与免费原始资料', '', topics.reason, '',
      ...selected.sources.map(source => `- [${source.title}](${source.url})（${source.versionDate}）；局限：${source.limits}`), '',
      '核验与纠正保存在 [evidence.json](evidence.json)。Copilot 回答中的主张不自动视作已证实事实。', '',
      '## 实际耗时', '', runPerformanceMarkdown(timing), '',
      `[完整问答](transcript/full-record.md) · [完整机器记录](transcript/complete.json) · [Copilot 会话](${session.conversationUrl})`, ''
    ].join('\n');
    await atomicWrite(this.resolve('report.md'), report);
    await atomicWrite(this.resolve('timing.json'), json(timing));
    await atomicWrite(this.resolve('timing.md'), runPerformanceMarkdown(timing));
    await this.save(data);
    await atomicWrite(this.resolve('README.md'), '# 本次研究\n\n- [结论、分歧和来源](report.md)\n- [完整问答](transcript/full-record.md)\n- [计时与瓶颈](timing.md)\n- [候选主题](topics.json)\n- [资料核验与修正](evidence.json)\n\nrequests/、responses/ 为每轮收发；transcript/ 为原始会话、独立计时事件及完整导出。events.jsonl 记录运行命令状态。\n');
    const names = ['run.json', 'README.md', 'report.md', 'timing.json', 'timing.md', 'topics.json', 'evidence.json', 'events.jsonl'];
    for (const folder of ['requests', 'responses', 'transcript']) {
      for (const entry of await fs.readdir(this.resolve(folder), { withFileTypes: true })) if (entry.isFile()) names.push(`${folder}/${entry.name}`);
    }
    const files = [];
    for (const name of names) {
      const bytes = await fs.readFile(this.resolve(name));
      files.push({ file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await atomicWrite(this.resolve('manifest.json'), json({ note: '内容指纹用于一致性复核，不是外部防篡改证明。', files }));
    return { status: 'completed', rounds: session.items.length, runFile: this.file, reportFile: this.resolve('report.md'),
      transcriptFile: this.resolve('transcript/full-record.md'), timingFile: this.resolve('timing.json'), totalWallMs: timing.totalWallMs };
  }

  async verify() {
    const manifest = await readJSON(this.resolve('manifest.json'));
    for (const entry of manifest.files) {
      const bytes = await fs.readFile(this.resolve(entry.file));
      if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`文件已变化：${entry.file}`);
    }
    return { verified: true, files: manifest.files.length };
  }

  async dispose() { await this.client.dispose(); }
}
