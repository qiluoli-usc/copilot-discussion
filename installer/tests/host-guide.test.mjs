import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHostGuide, renderHostStepPicker, renderMarkdown, plainText, standaloneGuide } from '../app/host-guide.mjs';
import { guide } from '../app/guide.mjs';

const markdown = await readFile(new URL('../../docs/host-setup.md', import.meta.url), 'utf8');
const catalog = JSON.parse(await readFile(new URL('../../plugins/copilot-discussion/skills/copilot-discussion/scripts/host-catalog.json', import.meta.url), 'utf8'));
const data = parseHostGuide(markdown, catalog);

test('every supported host gets its own numbered instructions and shared final checks', () => {
  assert.equal(data.hosts.length, 7);
  assert.deepEqual(data.hosts.map(item => item.id), catalog.hosts.map(item => item.id));
  const expected = { codex: 'codex mcp list', 'claude-code': '/mcp', workbuddy: '配置MCP', 'github-copilot': '/mcp list', vscode: 'MCP: List Servers', qwenwork: '粘贴JSON配置', dsh: 'dsh web --patch' };
  for (const host of data.hosts) {
    assert.match(host.text, /^.+\n\n1\. /u);
    assert.ok(host.text.includes(expected[host.id]), host.id);
    assert.ok(host.html.includes('<ol start="1">'), host.id);
  }
  assert.ok(data.commonText.includes('discussion_doctor'));
  assert.ok(data.commonText.includes('Allow'));
  assert.ok(data.hosts.find(item => item.id === 'dsh').html.includes('<ol start="3">'));
});

test('each selected host displays only its own instructions initially; overview covers auto and generic', () => {
  for (const host of ['auto', 'generic', ...data.hosts.map(item => item.id)]) {
    const html = renderHostStepPicker(data, host);
    const visible = [...html.matchAll(/<article data-host-steps="([^"]+)"([^>]*)>/gu)].filter(item => !item[2].includes('hidden'));
    assert.deepEqual(visible.map(item => item[1]), [host === 'generic' ? 'auto' : host]);
    assert.equal([...html.matchAll(/<option /gu)].length, 8);
    assert.ok(html.includes(`value="${host === 'generic' ? 'auto' : host}" selected`));
  }
});

test('guide rejects missing or duplicate host chapters rather than silently shipping incomplete steps', () => {
  assert.throws(() => parseHostGuide(markdown.replace('## Codex', '## Unsupported'), catalog), /Missing or ambiguous/u);
  assert.throws(() => parseHostGuide(markdown + '\n## Codex\n1. duplicate\n', catalog), /Duplicate/u);
  assert.throws(() => parseHostGuide(markdown.replace('## 所有宿主的最后检查', '## Missing'), catalog), /common steps/u);
});

test('limited Markdown renderer escapes raw HTML and retains URLs, quotes and multiline CLI examples', () => {
  const html = renderMarkdown('## Test\n1. `<input>`\n\n```powershell\nhello <world>\n```\n\n3. [Docs](https://example.com/?a=1&b=2)\n<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<code>&lt;input&gt;</code>'));
  assert.ok(html.includes('<ol start="3">'));
  assert.ok(html.includes('https://example.com/?a=1&amp;b=2'));
  assert.equal(plainText('## Guide\n1. `tool`\n[Docs](https://example.com/)'), 'Guide\n1. tool\nDocs：https://example.com/');
  assert.throws(() => renderMarkdown('```\nunclosed'), /unclosed/u);
});

test('standalone and installed guides include all seven chapters without depending on network or an external guide', () => {
  const standalone = standaloneGuide(data);
  assert.ok(!/<(?:script|iframe)\b/iu.test(standalone));
  const result = { hostIntegration: { results: [], elapsedMs: 0 }, skillStatus: { message: '<keep>' }, files: [], browser: { chrome: { status: 'installed' } }, productRoot: process.cwd(), profileFile: 'mcp.json', profileText: '<config>', serverObjectText: '{}', workspaceDir: process.cwd(), configFile: 'config.json', outputDir: process.cwd(), timing: { elapsedMs: 0 } };
  const installed = guide(result, 'qwenwork', data);
  for (const host of data.hosts) {
    assert.ok(standalone.includes(host.html));
    assert.ok(installed.includes(host.html));
  }
  assert.ok(installed.includes('value="qwenwork" selected'));
  assert.ok(installed.includes('&lt;keep&gt;'));
  assert.ok(installed.includes('&lt;config&gt;'));
  assert.ok(!standalone.includes('<script src='));
});
