import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHostGuide, renderHostStepPicker } from './host-guide.mjs';
import { HOSTS } from '../skills/copilot-discussion/scripts/host-integration.mjs';
const escape = s => String(s ?? '').replace(/[&<>"']/gu,c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const packageUrl = version => `https://github.com/qiluoli-usc/copilot-discussion/releases/download/v${version}/copilot-discussion-${version}.tgz`;
export const command = (version, action) => `npx.cmd --yes "${packageUrl(version)}" ${action}`;

export async function makeGuide({ product, integration, output, workspace, version }) {
  const hostText = await fs.readFile(path.join(product.directory, 'guides/host-setup.md'),'utf8');
  const guide = parseHostGuide(hostText, { hosts: HOSTS });
  const selected = integration.results.find(h => h.status === 'needs-action')?.id || integration.results[0]?.id || 'auto';
  const hostPicker = renderHostStepPicker({ ...guide, commonHtml: '' }, selected);
  const link = (file,label) => `<a href="${escape(pathToFileURL(file).href)}">${escape(label)}</a>`;
  const labels = { configured:'已接入，请重开宿主', 'needs-action':'还需按步骤操作', 'not-detected':'未发现，请先安装并打开该宿主' };
  const statuses = integration.results.map(h => `<tr><td>${escape(h.label)}</td><td>${escape(labels[h.status] || h.status)}</td><td>${escape(h.message || '重新打开宿主后，发送下面的检查提示词。')}</td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copilot主题讨论：下一步怎么做</title>
<style>body{font:17px/1.8 'Microsoft YaHei',system-ui,sans-serif;max-width:1000px;margin:36px auto;padding:0 24px;color:#182635;background:#f5f7fb}section{background:white;border:1px solid #dce3ed;padding:24px;margin:20px 0;border-radius:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f7;padding:16px}textarea{width:100%;box-sizing:border-box;height:140px;font:14px/1.6 Consolas,monospace}td,th{border:1px solid #ccd7e4;padding:10px;text-align:left}table{border-collapse:collapse;width:100%}a{color:#1558b0}h1{font-size:28px}button{padding:8px 16px;cursor:pointer}select{font:inherit;padding:8px;max-width:100%}li{margin:10px 0}code{overflow-wrap:anywhere}blockquote{background:#eef4fc;padding:12px 18px;border-left:4px solid #3f70b5}[hidden]{display:none!important}</style></head><body>
<h1>程序已准备好，接下来完成连接</h1><p>版本 ${escape(version)}。不需要购买Jev API，也不需要另外安装Jev技能。</p>
<section><h2>第一步：重开你使用的Agent</h2><p>完全退出并重新打开下表中已接入的宿主。宿主就是你平时与AI聊天的软件。若出现工具信任提示，请阅读后确认。</p><table><tr><th>软件</th><th>当前状态</th><th>下一步</th></tr>${statuses || '<tr><td colspan="3">没有发现已安装宿主。先安装并打开你的Agent，再重新运行 setup。</td></tr>'}</table></section>
<section><h2>第二步：选择你的软件，照着步骤完成连接</h2><p>下面有七个宿主的完整说明，可以切换查看。QwenWork需要粘贴一次连接配置；DSH需要加载启动配置。</p>${hostPicker}<details><summary>需要手动导入时：打开本机连接文件与技能目录</summary>${['mcp.json','codex.toml','github-copilot.json','vscode-mcp.json','dsh.yaml'].map(name => '<p>'+link(path.join(output,name),name)+'<br>'+escape(path.join(output,name))+'</p>').join('')}<p>两个技能的完整目录：${escape(path.join(product.directory,'skills'))}。导入copilot-discussion和research-topics两个完整文件夹。</p></details></section>
<section id="browser"><h2>第三步：允许Chrome连接，并登录Copilot</h2><ol><li>打开Google Chrome，在地址栏输入 <strong>chrome://inspect/#remote-debugging</strong>，按回车。</li><li>开启远程调试。回到终端，复制并运行下面的浏览器检查命令。</li><li>Chrome出现Allow / 允许提示时，手动点击允许。</li><li>打开 <a href="https://copilot.cloud.microsoft/chat">Microsoft 365 Copilot</a>，完成账号登录。</li></ol><pre>${escape(command(version,'doctor --browser'))}</pre><p>此检查只连接浏览器，不会创建研究或发送问题。</p></section>
<section><h2>第四步：先检查，再开始研究</h2><p>回到你的Agent聊天框，先发送：</p><pre>请使用copilot-discussion和research-topics，先调用discussion_doctor检查插件环境。现在只检查，不开始讨论。告诉我是否可以使用。</pre><p>确认通过后，再发送：</p><pre>用Jev Native，从免费公开资料自主选择一个值得研究的主题，与Microsoft 365 Copilot持续讨论，不限制轮数，最后给我结论、分歧、完整问答和分阶段实际耗时。</pre><p>研究期间保持Agent任务运行。关闭任务会停止生成新问题；可以之后读取记录继续。</p></section>
<section><h2>以后怎样检查、更新或移除</h2>${['doctor','update','repair','uninstall'].map(action => '<pre>'+escape(command(version,action))+'</pre>').join('')}<p>uninstall保留研究记录和共享Jev依赖。如果发现你手动修改过连接或技能，会保留并说明。QwenWork、DSH等手动导入的连接，先在宿主移除，再运行uninstall --manual-disconnected。</p><p>研究文件夹：${escape(workspace)}<br>完整问答与计时位于该文件夹的 output/research-runs。${link(workspace,'打开研究文件夹')}</p><p>运行环境通过不等于宿主已经加载工具或账号已经登录。未知位置与冲突会提示处理；不会自动批准授权或修改系统安全策略。</p></section>
<script>document.querySelectorAll('pre').forEach(pre=>{const button=document.createElement('button');button.textContent='复制这段内容';button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(pre.textContent);button.textContent='已复制，回到软件粘贴';}catch{const range=document.createRange();range.selectNodeContents(pre);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);button.textContent='已选中，请按 Ctrl+C 复制';}});pre.before(button);});</script></body></html>`;
}
