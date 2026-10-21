import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from './session.mjs';

const elapsed = (start, end) => {
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const sumKnown = values => values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;

export function summarizePerformance(data, { excludeTurns = [] } = {}) {
  if (!Array.isArray(data.items)) throw new Error('记录中没有 items。');
  const rounds = data.items.map((item, index) => ({
    round: item.index,
    excluded: excludeTurns.includes(item.index),
    instrumented: !!item.timing?.proposedAt,
    submitToCaptureMs: elapsed(item.sentAt, item.capturedAt),
    cycleMs: elapsed(item.timing?.proposedAt, item.capturedAt),
    gapBeforeRoundMs: index ? elapsed(data.items[index - 1].capturedAt, item.timing?.proposedAt) : null,
    firstObservedAfterClickMs: elapsed(item.timing?.sendActionCompletedAt, item.timing?.firstObservedAt),
    completionObservedToCaptureMs: elapsed(item.timing?.completionObservedAt, item.capturedAt),
    draftRecoveryAttempts: item.timing?.draftRecoveryAttempts ?? null,
    answerCharacters: Array.from(item.answer || '').length
  }));
  const selected = rounds.filter(round => !round.excluded);
  const values = selected.map(round => round.submitToCaptureMs).filter(value => value !== null);
  const events = data.performance?.events || [];
  const browser = {}, runtime = {};
  for (const event of events) {
    if (!Number.isFinite(event.durationMs) || event.durationMs < 0) continue;
    const groups = event.scope === 'runtime' ? runtime : browser;
    const group = groups[event.operation] ||= { calls: 0, failures: 0, totalMs: 0 };
    group.calls++; group.failures += event.success ? 0 : 1; group.totalMs += event.durationMs;
    group.meanMs = group.totalMs / group.calls;
  }
  return { topic: data.topic, rounds, samples: values.length, meanSubmitToCaptureMs: mean(values),
    minSubmitToCaptureMs: values.length ? Math.min(...values) : null,
    maxSubmitToCaptureMs: values.length ? Math.max(...values) : null,
    meanCycleMs: mean(selected.map(round => round.cycleMs).filter(value => value !== null)),
    browser, runtime, notes: [
      '提交到保存包含点击、生成、轮询、工具响应和调用间隔，不是 Copilot 纯生成时间。',
      'cycleMs 从 prepare() 接收问题到保存回答，不含 CLI 启动；gapBeforeRoundMs 是轮间间隔，不等于纯模型思考时间。',
      'firstObservedAfterClickMs 是首次观察到回答的延迟，不是精确首 token 延迟。',
      '旧记录没有阶段计时；手工补录轮次须显式排除。少量联调样本不能代表长期性能。'
    ] };
}

export function summarizeRun(data, { startedAt, completedAt } = {}) {
  const performance = summarizePerformance(data);
  const first = data.items[0], last = data.items.at(-1);
  const firstAt = first?.timing?.proposedAt;
  const submitted = sumKnown(performance.rounds.map(round => round.submitToCaptureMs));
  const cycles = sumKnown(performance.rounds.map(round => round.cycleMs));
  const gaps = sumKnown(performance.rounds.slice(1).map(round => round.gapBeforeRoundMs));
  const totalWallMs = elapsed(startedAt, completedAt);
  const phases = {
    preparationMs: elapsed(startedAt, firstAt),
    discussionWallMs: elapsed(firstAt, last?.capturedAt),
    synthesisAndArtifactMs: elapsed(last?.capturedAt, completedAt),
    submitToCaptureSumMs: submitted,
    prepareToSubmitSumMs: cycles !== null && submitted !== null ? cycles - submitted : null,
    betweenRoundsSumMs: gaps
  };
  const browserOperationSumMs = Object.values(performance.browser).reduce((sum, group) => sum + group.totalMs, 0);
  const startup = performance.runtime['worker-start'];
  const receipts = (data.performance?.events || []).filter(event => event.executorReceipt);
  return { schemaVersion: 1, topic: data.topic, runStartedAt: startedAt || null, completedAt: completedAt || null,
    totalWallMs, roundCount: data.items.length, phases, browserOperationSumMs,
    browserSharePercent: totalWallMs > 0 ? browserOperationSumMs / totalWallMs * 100 : null,
    workerStartupMs: startup?.totalMs ?? null, workerStarts: startup?.calls ?? null,
    workerReuses: performance.runtime['worker-reuse']?.calls ?? null,
    nativeExecution: { provenance: data.native?.provenance || null, actionReceipts: receipts.length,
      fillReceipts: receipts.filter(event => event.executorReceipt.operation === 'fill').length,
      sendReceipts: receipts.filter(event => event.executorReceipt.operation === 'send').length,
      decisionModelCalls: data.native?.modelCalls ?? null },
    timingWarning: data.performance?.warning || null,
    ...performance };
}

export function runPerformanceMarkdown(report) {
  const seconds = value => Number.isFinite(value) ? `${(value / 1000).toFixed(2)} 秒` : '未记录';
  return ['# 运行耗时与瓶颈', '',
    `主题：${report.topic}`, '',
    `计时起点：${report.runStartedAt || '未记录'}；报告生成：${report.completedAt || '未记录'}。`, '',
    `总耗时：${seconds(report.totalWallMs)}；实际轮数：${report.roundCount}。`, '',
    '| 阶段（互不重复） | 耗时 |', '|---|---:|',
    `| 首问前的选题、取证和连接准备 | ${seconds(report.phases.preparationMs)} |`,
    `| 讨论中的准备至发送 | ${seconds(report.phases.prepareToSubmitSumMs)} |`,
    `| 提交至回答保存合计 | ${seconds(report.phases.submitToCaptureSumMs)} |`,
    `| 轮间分析、核验和调度间隔 | ${seconds(report.phases.betweenRoundsSumMs)} |`,
    `| 末答后总结与交付整理 | ${seconds(report.phases.synthesisAndArtifactMs)} |`, '',
    `浏览器调用累计 ${seconds(report.browserOperationSumMs)}${report.browserSharePercent === null ? '' : `，占总耗时 ${report.browserSharePercent.toFixed(2)}%`}；它包含在上述阶段内，不能重复相加。`, '',
    `worker 启动：${report.workerStarts ?? '未记录'} 次，累计 ${seconds(report.workerStartupMs)}；复用：${report.workerReuses ?? '未记录'} 次。历史记录没有该项时保持未知。`, '',
    `Jev Browser.act 成功回执：${report.nativeExecution?.actionReceipts ?? '未记录'}；决策模型调用：${report.nativeExecution?.decisionModelCalls ?? '未记录'}。回执与运行时源码指纹见原始 JSON/JSONL，不是独立外部证明。`, '',
    '提交至保存包含网络、Copilot 流式输出、页面更新、轮询与落盘，无法拆成纯生成时间。轮间间隔也不等于纯主持思考。记录的阶段只反映本次运行，不代表同题对照加速结论。', '',
    performanceMarkdown(report), report.timingWarning || '', ''
  ].join('\n');
}

export function performanceMarkdown(report) {
  const seconds = value => value === null ? '未记录' : `${(value / 1000).toFixed(2)} 秒`;
  return [`# 讨论速度量化：${report.topic}`, '',
    '| 轮次 | 提交到保存 | 本轮完整耗时 | 完成候选到保存 | 回答字数 | 是否计入统计 |', '|---|---:|---:|---:|---:|---|',
    ...report.rounds.map(round => `| ${round.round} | ${seconds(round.submitToCaptureMs)} | ${seconds(round.cycleMs)} | ${seconds(round.completionObservedToCaptureMs ?? null)} | ${round.answerCharacters} | ${round.excluded ? '排除' : '计入'} |`), '',
    `有效样本：${report.samples}；平均提交到保存：${seconds(report.meanSubmitToCaptureMs)}。`, '',
    '## 浏览器调用', '', '| 操作 | 次数 | 平均耗时 | 失败数 |', '|---|---:|---:|---:|',
    ...Object.entries(report.browser).map(([name, value]) => `| ${name} | ${value.calls} | ${seconds(value.meanMs)} | ${value.failures} |`), '',
    ...report.notes.map(note => `- ${note}`), ''
  ].join('\n');
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [file, ...options] = process.argv.slice(2);
  if (!file) { console.error('用法：node metrics.mjs <会话.json> [--exclude-turn=1] [--output=报告.json]'); process.exitCode = 1; }
  else {
    const excludeTurns = options.filter(value => value.startsWith('--exclude-turn=')).map(value => Number(value.split('=')[1]));
    const output = options.find(value => value.startsWith('--output='))?.slice('--output='.length);
    const data = await (await Session.open(file)).read();
    const runFile = options.find(value => value.startsWith('--run='))?.slice('--run='.length);
    const run = runFile ? JSON.parse(await fs.readFile(runFile, 'utf8')) : null;
    const report = run ? summarizeRun(data, { startedAt: run.runStartedAt || run.startedAt, completedAt: run.completedAt }) : summarizePerformance(data, { excludeTurns });
    if (output) {
      await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
      await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
      await fs.writeFile(output.replace(/\.json$/u, '') + '.md', run ? runPerformanceMarkdown(report) : performanceMarkdown(report), { flag: 'wx' });
    }
    console.log(JSON.stringify(report, null, 2));
  }
}
