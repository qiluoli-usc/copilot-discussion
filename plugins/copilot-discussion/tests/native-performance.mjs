// Explicit local benchmark. No Copilot/model calls, screenshots or recordings.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { Session } from '../skills/copilot-discussion/scripts/session.mjs';
import { JevNativeTransport } from '../skills/copilot-discussion/scripts/jev-native.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => { const index = value.indexOf('='); return [value.slice(2, index), value.slice(index + 1)]; }));
if (!args.output || !args.baselineRoot || !args.sourceSession) throw new Error('需要 --output=绝对目录 --baselineRoot=旧插件目录 --sourceSession=实际记录.json');
const output = path.resolve(args.output);
await fs.mkdir(output, { recursive: true });
const old = await import(pathToFileURL(path.join(args.baselineRoot, 'skills/copilot-discussion/scripts/session.mjs')).href);
const original = JSON.parse(await fs.readFile(args.sourceSession, 'utf8'));
const io = [];
for (const [mode, Type] of [['embedded-v030', old.Session], ['journal-v040', Session]]) {
  const folder = path.join(output, mode);
  await fs.mkdir(folder);
  const file = path.join(folder, 'session.json');
  const state = structuredClone(original);
  state.maxRounds = 30;
  state.performance = { events: [], ...(mode === 'journal-v040' ? { journal: 'session.events.jsonl' } : {}) };
  await fs.writeFile(file, JSON.stringify(state));
  const session = await Type.open(file);
  const started = performance.now();
  for (let index = 0; index < 250; index++) await session.recordTiming({ operation: 'snapshot', scope: 'benchmark', startedAt: new Date().toISOString(), durationMs: 30, success: true });
  const durationMs = performance.now() - started;
  const saved = await session.read();
  assert.equal(saved.performance.events.length, 250);
  assert.deepEqual(saved.items, original.items);
  io.push({ mode, events: 250, originalRounds: original.items.length, durationMs, verified: true });
}

const html = await fs.readFile(new URL('./fixtures/copilot.html', import.meta.url));
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const samples = [];
try {
  for (const mode of ['per-command', 'persistent', 'persistent', 'per-command']) {
    const started = performance.now();
    let worker, binding;
    const startups = [];
    try {
      for (let round = 1; round <= 3; round++) {
        if (!worker) {
          const launchAt = performance.now();
          worker = await JevNativeTransport.launch({ fixtureOrigin: origin });
          startups.push(performance.now() - launchAt);
          if (binding) await worker.attach(binding);
          else { await worker.open(origin); binding = worker.binding; }
        }
        const question = `第${round}轮：同题合成控件性能测试`;
        await worker.fill(question, /^Message Copilot$/);
        await worker.send(/^Send$/, question);
        const one = await worker.read();
        await new Promise(resolve => setTimeout(resolve, 150));
        const two = await worker.read();
        assert.equal(two.state.entries.filter(entry => entry.role === 'user').length, round);
        assert.equal(two.state.entries.at(-1).text, `模拟回答 ${round}：${question}`);
        assert.equal(one.state.entries.at(-1).text, two.state.entries.at(-1).text);
        assert.equal(two.state.entries.at(-1).complete, true);
        if (round === 3) { await worker.closeTab(); binding = null; }
        if (mode === 'per-command') { await worker.dispose(); worker = null; }
      }
    } finally {
      if (worker) { if (binding) await worker.closeTab().catch(() => {}); await worker.dispose(); }
    }
    samples.push({ mode, rounds: 3, durationMs: performance.now() - started, workerStarts: startups.length, startupMs: startups.reduce((a, b) => a + b, 0), verified: true });
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const report = { scope: '本地合成网页与同一真实记录负载的执行开销，不含Copilot生成或主持思考；不能当端到端讨论加速倍数', completedAt: new Date().toISOString(), io, samples, modelCalls: 0, verified: true };
await fs.writeFile(path.join(output, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
