// Explicit opt-in, synthetic local browser test. No model or Copilot requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { JevNativeTransport } from '../skills/copilot-discussion/scripts/jev-native.mjs';

const html = await fs.readFile(new URL('./fixtures/copilot.html', import.meta.url));
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let first, second;
let binding;
const started = performance.now();
try {
  first = await JevNativeTransport.launch({ fixtureOrigin: origin });
  assert.equal(first.readyInfo.provenance.module, 'jev_ultrafast.browser');
  assert.equal(first.readyInfo.provenance.decisionModel, false);
  assert.match(first.readyInfo.provenance.sourceSha256, /^[a-f0-9]{64}$/u);
  await first.open(origin);
  binding = first.binding;
  const initial = await first.read();
  assert.equal(initial.state.entries.length, 0);
  const fill = await first.fill('第一轮：中文输入与精确发送', /^Message Copilot$/);
  assert.equal(fill.executorReceipt.method, 'jev_ultrafast.browser.Browser.act');
  assert.equal(fill.executorReceipt.kind, 'fill');
  assert.equal((await first.read()).state.composerText, '第一轮：中文输入与精确发送');
  const send = await first.send(/^Send$/, '第一轮：中文输入与精确发送');
  assert.equal(send.executorReceipt.kind, 'click');
  assert.equal(send.executorReceipt.target, binding.target);
  assert.equal((await first.read()).state.entries.at(-1).text, '模拟回答 1：第一轮：中文输入与精确发送');
  await first.dispose(); first = null;
  second = await JevNativeTransport.launch({ fixtureOrigin: origin });
  await second.attach(binding);
  assert.equal((await second.read()).state.entries.length, 2);
  await second.fill('第二轮：根据第一答继续追问', /^Message Copilot$/);
  await assert.rejects(second.send(/^Send$/, '这不是当前草稿'), /Native operation failed/u);
  assert.equal((await second.read()).state.entries.length, 2);
  await second.send(/^Send$/, '第二轮：根据第一答继续追问');
  const final = await second.read();
  assert.equal(final.state.entries.length, 4);
  assert.equal(final.state.entries.at(-1).text, '模拟回答 2：第二轮：根据第一答继续追问');
  await second.closeTab(); binding = null;
  console.log(JSON.stringify({ verified: true, scope: 'synthetic-local-native', turns: 2,
    sameTabAfterWorkerRestart: true, modelCalls: 0, elapsedMs: performance.now() - started }, null, 2));
} finally {
  if (binding && second) await second.closeTab().catch(() => {});
  if (binding && first) await first.closeTab().catch(() => {});
  if (first) await first.dispose(); if (second) await second.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
