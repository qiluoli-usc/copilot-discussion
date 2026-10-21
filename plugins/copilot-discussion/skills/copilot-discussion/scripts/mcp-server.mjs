import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettings } from './settings.mjs';
import { ResearchService, SERVICE_INSTRUCTIONS } from './research-service.mjs';
import { TOOLS, validateArguments } from './mcp-tools.mjs';

export const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_VERSION = '0.7.0';

// A local-only, dependency-free MCP stdio transport. stdout is exclusively
// JSON-RPC; the old research-server JSON-lines format is a separate endpoint.
export async function serve({ input = process.stdin, output = process.stdout, service } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let initialized = false, negotiated = false, closing = false;
  const requests = new Map();
  const write = value => { if (!output.destroyed) output.write(JSON.stringify(value) + '\n'); };
  const error = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  const accept = async line => {
    let message;
    try { message = JSON.parse(line); }
    catch { error(null, -32700, 'Parse error'); return; }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      error(message?.id ?? null, -32600, 'Invalid Request'); return;
    }
    const notification = !Object.hasOwn(message, 'id');
    if (notification) {
      if (message.method === 'notifications/initialized' && negotiated) initialized = true;
      if (message.method === 'notifications/cancelled') requests.get(message.params?.requestId)?.abort();
      return;
    }
    const { id, method, params = {} } = message;
    if (!['string', 'number'].includes(typeof id) || (typeof id === 'number' && !Number.isFinite(id))) { error(null, -32600, 'Invalid request id'); return; }
    if (requests.has(id)) { error(id, -32600, 'Duplicate in-flight request id'); return; }
    const controller = new AbortController();
    requests.set(id, controller);
    try {
      let result;
      if (method === 'initialize') {
        if (negotiated || typeof params.protocolVersion !== 'string') { error(id, -32602, 'Invalid initialization'); return; }
        negotiated = true;
        result = { protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: {} }, serverInfo: { name: 'copilot-discussion', version: SERVER_VERSION }, instructions: SERVICE_INSTRUCTIONS };
      } else if (!initialized) { error(id, -32002, 'Initialize and send notifications/initialized first'); return; }
      else if (method === 'ping') result = {};
      else if (method === 'tools/list') result = { tools: TOOLS };
      else if (method === 'tools/call') {
        const tool = TOOLS.find(item => item.name === params.name);
        if (!tool) { error(id, -32602, 'Unknown tool'); return; }
        try { validateArguments(params.arguments ?? {}, tool.inputSchema); }
        catch (caught) { error(id, -32602, caught.message); return; }
        try {
          const value = await service.call(tool.name, params.arguments ?? {}, { signal: controller.signal });
          result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
        } catch (caught) {
          result = { content: [{ type: 'text', text: JSON.stringify({ message: caught.message, retrySend: false }) }], isError: true };
        }
      } else { error(id, -32601, 'Method not found'); return; }
      if (controller.signal.aborted) error(id, -32800, 'Request cancelled; any submitted question remains durable. Inspect result; never resend.');
      else write({ jsonrpc: '2.0', id, result });
    } catch (caught) { error(id, -32603, caught.message); }
    finally { requests.delete(id); }
  };
  lines.on('line', line => { if (!closing && line.trim()) void accept(line); });
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    for (const controller of requests.values()) controller.abort();
    await service.dispose();
    lines.close();
    resolveClosed();
  };
  lines.on('close', () => { void shutdown(); });
  const terminate = () => { void shutdown(); input.destroy(); };
  process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
  await closed;
  process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', terminate);
}

export function serverOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--config', '--workspace'].includes(args[index]) || !args[index + 1]) throw new Error('用法：node mcp-server.mjs [--config 绝对配置路径] [--workspace 绝对工作区路径]');
    options[args[index] === '--config' ? 'configFile' : 'workspaceDir'] = args[index + 1];
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const settings = loadSettings(serverOptions(process.argv.slice(2)));
    await serve({ service: new ResearchService(settings) });
  } catch (caught) { process.stderr.write(caught.message + '\n'); process.exitCode = 1; }
}
