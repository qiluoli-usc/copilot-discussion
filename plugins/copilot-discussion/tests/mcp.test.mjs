import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve } from '../skills/copilot-discussion/scripts/mcp-server.mjs';

function fixture(t) {
  const input = new PassThrough(), output = new PassThrough();
  let sequence = 0, buffer = '';
  const pending = new Map(), replies = [], calls = [];
  const service = { dispose: async () => {}, call: async (name, args, { signal }) => {
    calls.push(name);
    if (name === 'discussion_result') await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { status: 'ok', mode: 'jev-native-executor', decisionModel: false };
  } };
  output.on('data', chunk => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      const response = JSON.parse(line); replies.push(response);
      pending.get(response.id)?.(response); pending.delete(response.id);
    }
  });
  const serving = serve({ input, output, service });
  t.after(async () => { input.end(); await serving; output.end(); });
  const send = message => input.write(JSON.stringify(message) + '\n');
  const rpc = (method, params = {}) => {
    const id = ++sequence;
    const promise = new Promise(resolve => pending.set(id, resolve)); send({ jsonrpc: '2.0', id, method, params });
    return { id, promise };
  };
  const initialize = async () => {
    const result = await rpc('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } }).promise;
    send({ jsonrpc: '2.0', method: 'notifications/initialized' }); return result;
  };
  return { input, send, rpc, initialize, calls, replies };
}

test('标准MCP握手、协议回退、工具发现和参数错误，不输出自定义ready行', async t => {
  const f = fixture(t);
  assert.equal((await f.rpc('tools/list').promise).error.code, -32002);
  const initialized = await f.initialize(); assert.equal(initialized.result.protocolVersion, '2025-06-18');
  const listed = await f.rpc('tools/list').promise;
  assert.equal(listed.result.tools.length, 11); assert.ok(listed.result.tools.some(tool => tool.name === 'discussion_ask'));
  const doctor = await f.rpc('tools/call', { name: 'discussion_doctor', arguments: {} }).promise;
  assert.equal(doctor.result.structuredContent.decisionModel, false);
  assert.equal((await f.rpc('tools/call', { name: 'discussion_ask', arguments: { question: '缺runFile' } }).promise).error.code, -32602);
  assert.equal((await f.rpc('tools/call', { name: 'unknown', arguments: {} }).promise).error.code, -32602);
  assert.deepEqual(f.calls, ['discussion_doctor']); assert.ok(f.replies.every(reply => reply.jsonrpc === '2.0'));
});

test('工具等待期间仍能ping与取消；取消不会调用发送工具', async t => {
  const f = fixture(t); await f.initialize();
  const waiting = f.rpc('tools/call', { name: 'discussion_result', arguments: { runFile: 'valid-looking/run.json' } });
  assert.deepEqual((await f.rpc('ping').promise).result, {});
  f.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: waiting.id } });
  assert.equal((await waiting.promise).error.code, -32800);
  assert.deepEqual(f.calls, ['discussion_result']);
});
