// Explicit live, paid experiment. Never included in node --test.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { JevNativeTransport } from '../skills/copilot-discussion/scripts/jev-native.mjs';
import { NativeClient } from '../skills/copilot-discussion/scripts/native-client.mjs';
import { Session } from '../skills/copilot-discussion/scripts/session.mjs';
import { summarizePerformance } from '../skills/copilot-discussion/scripts/metrics.mjs';

const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (['--allow-paid', '--allow-authenticated-state'].includes(flag)) options[flag.slice(2)] = true;
  else if (['--scope', '--output', '--model'].includes(flag) && process.argv[index + 1]) options[flag.slice(2)] = process.argv[++index];
  else throw new Error('Unknown benchmark option');
}
if (!options['allow-paid'] || !options.model || !path.isAbsolute(options.output || '') || !['synthetic', 'copilot'].includes(options.scope)) throw new Error('Explicit --allow-paid, --model, --scope and absolute --output required.');
if (options.scope === 'copilot' && !options['allow-authenticated-state']) throw new Error('Authenticated-state disclosure requires prior user authorization.');
await fs.mkdir(options.output, { recursive: true });
const output = await fs.realpath(options.output);
const resultFile = path.join(output, 'benchmark.json');
if (await fs.stat(resultFile).then(() => true).catch(() => false)) throw new Error('Output already contains an experiment; refusing to overwrite or retry a paid run.');
const questions = [
  '这是公开假设条件下的制造业与AI控制实验，不涉及真实企业数据。某工厂考虑先试点视觉质检或设备预测性维护；现有缺陷图片较多但标签一致性未知，设备故障很少且停机代价较高。请选择优先试点，给出选择条件、一个因果效果指标与一个停止标准。不要编造统计数字，不检索网页，回答控制在250字内。',
  '对上一答作反方复核：指出一个足以推翻优先试点选择的反例，给出最小验证实验和能够改变决策的观测结果。只讨论新增争点，不复述背景，不编造统计数字，不检索网页，回答控制在250字内。'
];
const order = ['A', 'B', 'B', 'A'];
const report = { startedAt: new Date().toISOString(), scope: options.scope, order, questions, samples: [],
  model: options.model, provider: 'openrouter', screenshots: false, recording: false, textModelCalls: 0,
  boundaries: ['A为现有确定性控件选择，B额外使用实际Jev模型选择相同允许控件；两者使用相同Native执行器。',
    '只改变机械动作选择；主持选题/推理不在本控制实验中改变。真实测试每次新建专用对话，使用完全相同的两轮问题。',
    '每种模式仅两个样本，ABBA缓解顺序影响；回答内容与Copilot服务延迟仍有波动，不能推导普遍因果加速。',
    'elapsedMs从worker启动到最终回答落盘，不含清理；submitToCapture含网页/网络/生成/采集，不是纯模型时间。',
    '决策时间是fill/send内子项，不能重复相加；首次环境检查和源码开发不属于测试耗时。'] };
const persist = () => fs.writeFile(resultFile, JSON.stringify(report, null, 2) + '\n');
const emit = event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
let server, origin;
if (options.scope === 'synthetic') {
  const html = await fs.readFile(new URL('./fixtures/copilot.html', import.meta.url));
  server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}

try {
  for (const [index, mode] of order.entries()) {
    const sample = { index: index + 1, mode, status: 'running', startedAt: new Date().toISOString(), rounds: [] };
    report.samples.push(sample); await persist(); emit({ sample: sample.index, mode, stage: 'starting' });
    const directory = path.join(output, `sample-${sample.index}-${mode}`);
    await fs.mkdir(directory);
    let transport, client;
    const started = performance.now();
    const launch = async args => {
      const at = performance.now();
      transport = await JevNativeTransport.launch({ ...args, ...(origin ? { fixtureOrigin: origin } : {}),
        ...(mode === 'B' ? { workerFile: fileURLToPath(new URL('../skills/copilot-discussion/scripts/decision_worker.py', import.meta.url)),
          decision: { model: options.model, allowAuthenticatedState: !!options['allow-authenticated-state'] } } : {}) });
      sample.workerStartupMs = performance.now() - at;
      sample.provenance = transport.readyInfo.provenance;
      assert.equal(!!sample.provenance.decisionModel, mode === 'B');
      return transport;
    };
    try {
      if (origin) {
        await launch({}); await transport.open(origin);
        await transport.read();
        const transcript = [];
        for (const [round, question] of questions.entries()) {
          const at = performance.now(), fillAt = performance.now();
          const fill = await transport.fill(question, /^Message Copilot$/);
          const fillMs = performance.now() - fillAt, sendAt = performance.now();
          const send = await transport.send(/^Send$/, question);
          const sendMs = performance.now() - sendAt;
          const one = await transport.read();
          await new Promise(resolve => setTimeout(resolve, 150));
          const two = await transport.read();
          assert.equal(two.state.entries.length, (round + 1) * 2);
          assert.equal(two.state.entries.at(-1).text, `模拟回答 ${round + 1}：${question}`);
          assert.equal(one.state.entries.at(-1).text, two.state.entries.at(-1).text);
          sample.rounds.push({ round: round + 1, elapsedMs: performance.now() - at, fillMs, sendMs,
            receipts: [fill.executorReceipt, send.executorReceipt] });
          transcript.push({ question, answer: two.state.entries.at(-1).text });
        }
        await fs.writeFile(path.join(directory, 'transcript.json'), JSON.stringify(transcript, null, 2));
      } else {
        client = new NativeClient({ launch });
        const opened = await client.command('start', { topic: '制造业与AI / Jev动作决策对照实验', context: '固定公开假设，同题两轮基准，不进行私人资料检索。',
          maxRounds: 2, outputDir: directory });
        sample.sessionFile = opened.sessionFile;
        if (opened.status !== 'ready') throw new Error('Chrome或Microsoft登录未就绪；保留专用标签页，不重复start。');
        for (const [round, question] of questions.entries()) {
          const at = performance.now();
          let answer = await client.command('ask', { sessionFile: opened.sessionFile, question, waitMs: 10000,
            analysis: '预先固定的同题基准；保持A/B工作负载一致。' });
          const deadline = performance.now() + 180000;
          while (answer.status === 'pending' && performance.now() < deadline) {
            emit({ sample: sample.index, mode, round: round + 1, stage: 'collecting' });
            answer = await client.command('collect', { sessionFile: opened.sessionFile, waitMs: 10000 });
          }
          if (answer.status !== 'answered') throw new Error('回答未完成；保留pending，只允许续读，禁止重发。');
          sample.rounds.push({ round: round + 1, elapsedMs: performance.now() - at });
          emit({ sample: sample.index, mode, round: round + 1, stage: 'captured' });
        }
        const session = await Session.open(opened.sessionFile);
        await session.update(data => {
          data.benchmark = { mode, scope: report.scope, model: mode === 'B' ? options.model : null };
          data.native.modelCalls = transport.decisionStats?.calls || 0;
        });
        await session.finish('预先声明的两轮控制实验完成；本记录用于计时，不把模型共识当作实证事实。');
        const data = await session.read();
        assert.equal(data.items.length, 2); assert.equal(data.pending, null);
        sample.metrics = summarizePerformance(data);
        await fs.writeFile(path.join(directory, 'complete.json'), JSON.stringify(data, null, 2));
      }
      sample.elapsedMs = performance.now() - started;
      sample.decision = transport.decisionStats || { calls: 0, httpRequests: 0, latencyMs: 0, failures: 0 };
      if (mode === 'B') assert.ok(sample.decision.calls >= 4 && sample.decision.failures === 0);
      sample.status = 'verified';
      emit({ sample: sample.index, mode, stage: 'verified', elapsedMs: sample.elapsedMs, decision: sample.decision });
      await transport.closeTab();
    } catch (error) {
      sample.status = 'failed'; sample.error = error.message; sample.elapsedMs = performance.now() - started;
      sample.decision = transport?.decisionStats || null;
      await persist(); throw error; // No automatic retry of a failed paid run.
    } finally { if (client) await client.dispose(); else if (transport) await transport.dispose(); }
    await persist();
  }
  const median = values => { const sorted = [...values].sort((a,b) => a-b); return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2; };
  report.summary = Object.fromEntries(['A', 'B'].map(mode => {
    const samples = report.samples.filter(sample => sample.mode === mode && sample.status === 'verified');
    const actions = samples.map(sample => sample.metrics ? (sample.metrics.browser.fill?.totalMs || 0) + (sample.metrics.browser.click?.totalMs || 0) : sample.rounds.reduce((sum,r) => sum + r.fillMs + r.sendMs,0));
    return [mode, { samples: samples.length, medianElapsedMs: median(samples.map(s => s.elapsedMs)), medianActionMs: median(actions),
      decisionCalls: samples.reduce((sum,s) => sum+s.decision.calls,0), httpRequests: samples.reduce((sum,s) => sum+s.decision.httpRequests,0),
      decisionMs: samples.reduce((sum,s) => sum+s.decision.latencyMs,0) }];
  }));
  report.changePercent = (report.summary.B.medianElapsedMs / report.summary.A.medianElapsedMs - 1) * 100;
  report.verified = true;
} catch (error) { report.verified = false; report.error = error.message; process.exitCode = 1; }
finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  report.completedAt = new Date().toISOString(); await persist();
  emit({ stage: 'finished', verified: report.verified, summary: report.summary || null, changePercent: report.changePercent ?? null, error: report.error || null, file: resultFile });
}
