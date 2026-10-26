// One checked Markdown source supplies the native EXE and the installed HTML.
export const escape = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(value) {
  const pattern = /`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/gu;
  let html = '', offset = 0;
  for (const match of value.matchAll(pattern)) {
    html += escape(value.slice(offset, match.index));
    html += match[1] ? `<code>${escape(match[1])}</code>` : match[2] ? `<a href="${escape(match[3])}">${escape(match[2])}</a>` : `<strong>${escape(match[4])}</strong>`;
    offset = match.index + match[0].length;
  }
  return html + escape(value.slice(offset));
}

// Deliberately limited to the constructs used in docs/host-setup.md. Raw HTML
// stays escaped; the packaged guide cannot load a remote script or iframe.
export function renderMarkdown(markdown) {
  let html = '', list = '', code = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = ''; } };
  for (const line of markdown.replace(/\r\n/gu, '\n').split('\n')) {
    if (/^```/u.test(line)) {
      closeList();
      if (code === null) code = [];
      else { html += `<pre><code>${escape(code.join('\n'))}</code></pre>`; code = null; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    const item = /^(?:\d+\. |[-*] )(.*)$/u.exec(line);
    if (item) {
      const kind = /^\d/u.test(line) ? 'ol' : 'ul';
      if (list !== kind) { closeList(); list = kind; html += kind === 'ol' ? `<ol start="${Number.parseInt(line, 10)}">` : '<ul>'; }
      html += `<li>${inline(item[1])}</li>`; continue;
    }
    closeList();
    if (!line.trim()) continue;
    const heading = /^(#{1,3}) (.+)$/u.exec(line);
    if (heading) html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    else if (line.startsWith('> ')) html += `<blockquote>${inline(line.slice(2))}</blockquote>`;
    else html += `<p>${inline(line)}</p>`;
  }
  closeList();
  if (code !== null) throw new Error('Host guide has an unclosed code block');
  return html;
}

export function plainText(markdown) {
  return markdown.replace(/\r\n/gu, '\n').replace(/^```[^\n]*\n/gmu, '').replace(/^#{1,6} /gmu, '')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/gu, '$1：$2').replace(/`([^`]+)`/gu, '$1').replace(/\*\*([^*]+)\*\*/gu, '$1').replace(/^> /gmu, '').trim();
}

export function parseHostGuide(markdown, catalog) {
  const normalized = markdown.replace(/\r\n/gu, '\n');
  const headings = [...normalized.matchAll(/^## (.+)$/gmu)];
  const sections = new Map();
  for (let i = 0; i < headings.length; i++) {
    const title = headings[i][1];
    if (sections.has(title)) throw new Error('Duplicate host guide heading: ' + title);
    sections.set(title, normalized.slice(headings[i].index, headings[i + 1]?.index).trim());
  }
  const common = sections.get('先找到本机配置与状态'), final = sections.get('所有宿主的最后检查');
  if (!common || !final || catalog.hosts.length !== 7) throw new Error('Host guide must include common steps and all seven hosts');
  const overview = normalized.slice(0, headings[0].index).trim() + '\n\n' + common;
  const hosts = catalog.hosts.map(spec => {
    const matches = [...sections].filter(([title]) => title === spec.label || title.startsWith(spec.label + '（'));
    if (matches.length !== 1) throw new Error('Missing or ambiguous host guide: ' + spec.id);
    const content = matches[0][1];
    if (!/^1\. /mu.test(content)) throw new Error('Missing numbered host steps: ' + spec.id);
    return { id: spec.id, label: spec.label, text: plainText(content), html: renderMarkdown(content) };
  });
  return { schemaVersion: 1, overviewText: plainText(overview), overviewHtml: renderMarkdown(overview), commonText: plainText(final), commonHtml: renderMarkdown(final), hosts };
}

export function renderHostStepPicker(data, selectedHost = 'auto') {
  const selected = data.hosts.some(item => item.id === selectedHost) ? selectedHost : 'auto';
  const pages = [{ id: 'auto', label: '自动检测 / 通用 MCP：安装总览', html: data.overviewHtml }, ...data.hosts];
  return `<section id="host-instructions"><h2>按宿主查看逐步操作</h2><p>切换这里的说明不会更改安装或宿主设置。所有步骤已随包保存，可离线阅读。</p>
<label for="host-steps-select">查看宿主：</label> <select id="host-steps-select" onchange="document.querySelectorAll('[data-host-steps]').forEach(p=>{p.hidden=p.dataset.hostSteps!==this.value})">${pages.map(page => `<option value="${escape(page.id)}"${page.id === selected ? ' selected' : ''}>${escape(page.label)}</option>`).join('')}</select>
${pages.map(page => `<article data-host-steps="${escape(page.id)}"${page.id !== selected ? ' hidden' : ''}>${page.html}</article>`).join('')}
${data.commonHtml}</section>`;
}

export function standaloneGuide(data, selectedHost) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copilot 主题讨论 · 七宿主安装说明</title>
<style>body{font:16px/1.8 'Microsoft YaHei',system-ui,sans-serif;max-width:1000px;margin:32px auto;padding:0 24px;background:#f5f7fb;color:#182635}section{background:#fff;padding:24px;border:1px solid #dce3ed;border-radius:12px}h1{font-size:28px}h2{font-size:22px}a{color:#1558b0;overflow-wrap:anywhere}select{max-width:100%;padding:8px;font:inherit}pre{padding:16px;background:#eef2f7;white-space:pre-wrap;overflow-wrap:anywhere}code{font-family:Consolas,monospace}li{margin:10px 0}blockquote{border-left:4px solid #3f70b5;padding:12px 18px;background:#eef4fc}[hidden]{display:none!important}</style></head><body><h1>七宿主安装与首次使用说明</h1>${renderHostStepPicker(data, selectedHost)}</body></html>`;
}
