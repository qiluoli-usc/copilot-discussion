import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderHostStepPicker } from './host-guide.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const status = { configured: '已写入', reused: '已复用', installed: '已准备', preserved: '已保留原设置', 'manual-import': '需在宿主导入一次', skipped: '已跳过', 'not-detected': '未发现', 'not-configured': '未配置', 'not-installed': '未安装' };

export function guide(result, host, hostGuide) {
  const integration = result.hostIntegration;
  const rows = integration.results.map(item => `<tr><td>${escape(item.label)}</td><td>${escape(status[item.mcp] || item.mcp)}</td><td>${escape(status[item.skills] || item.skills)}</td><td>${escape(item.message || '重新加载宿主后先调用 discussion_doctor。')}</td></tr>`).join('');
  const profiles = result.files.filter(file => /\.(json|toml|yaml)$/u.test(file) && !file.includes('environment'));
  const link = (file, label) => `<a href="${escape(pathToFileURL(file).href)}">${escape(label)}</a>`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Copilot 主题讨论 · 开始使用</title>
<style>body{font:16px/1.7 'Microsoft YaHei',sans-serif;max-width:1040px;margin:40px auto;padding:0 24px;color:#182635;background:#f5f7fb}h1{font-size:28px}section{background:white;padding:22px 28px;border:1px solid #dce3ed;border-radius:12px;margin:20px 0}a{color:#1558b0}pre{white-space:pre-wrap;word-break:break-all;background:#eef2f7;padding:16px}textarea{box-sizing:border-box;width:100%;height:180px;font:13px Consolas,monospace}button{padding:9px 18px;cursor:pointer}td,th{border:1px solid #dce3ed;padding:10px;text-align:left;vertical-align:top}table{width:100%;border-collapse:collapse}select{max-width:100%;padding:8px;font:inherit}li{margin:10px 0}[hidden]{display:none!important}</style>
<h1>Copilot 主题讨论已安装</h1><p>Jev Native 执行浏览器动作；所选宿主 Agent 负责免费资料检索、选题和持续追问。默认无需 Jev API Key。</p>
<section><h2>宿主自动接入结果</h2><p>${escape(result.skillStatus.message)}</p><p>本次选择：${escape(host)}；接入阶段耗时 ${(integration.elapsedMs / 1000).toFixed(3)} 秒。</p>
<table><thead><tr><th>宿主</th><th>MCP</th><th>两个技能</th><th>下一步</th></tr></thead><tbody>${rows || '<tr><td colspan="4">未选择自动接入或未发现宿主。安装宿主后重新运行配置向导，或使用下方模板。</td></tr>'}</tbody></table>
<p>重新加载或重启已接入的宿主即可读取新配置。保留其他服务器、技能、账号设置及权限；同名服务器使用独立名称。宿主自己的工具信任、组织策略及账号登录仍可能需要用户操作，不自动批准。</p>
${integration.rollbackFile ? '<p>需要撤销本次改动时，点击向导的“撤销接入”。只恢复仍与安装结果一致的文件，保留安装后的用户修改。运行环境和研究记录不受影响；备份仅存本机。</p>' : ''}</section>
${renderHostStepPicker(hostGuide, host)}
<section><h2>1. 完成 Chrome 授权和登录</h2><p>在 Google Chrome 地址栏打开 <strong>chrome://inspect/#remote-debugging</strong>，启用远程调试。点击向导“授权检查”，在 Chrome 弹窗中点击 <strong>Allow / 允许</strong>。打开 <a href="https://copilot.cloud.microsoft/chat">Microsoft 365 Copilot</a>，完成登录。</p><p>${escape(result.browser.chrome?.status === 'installed' ? '已找到 Google Chrome。' : 'Chrome 尚未就绪，请按向导提示完成安装。')}</p></section>
<section><h2>2. 在宿主中开始研究</h2><p>在上表已接入的宿主中发送：</p><pre>先调用 discussion_doctor 检查环境。就绪后，用 Jev Native，从免费公开资料自主选题，与 Microsoft 365 Copilot 持续讨论，不限制轮数，最后给我结论、分歧、完整问答和分阶段实际耗时。</pre><p>公开资料检索和讨论需要联网。持续追问依赖宿主任务保持执行，关闭主持任务后不会继续生成新问题。不要让两个宿主同时操作同一研究。</p></section>
<section><h2>需手动导入的宿主与备用配置</h2><p>已自动写入的宿主无需复制。QwenWork 的公开文档没有稳定的 MCP 文件注册接口，需在“扩展 → 连接器 → 添加 → 粘贴 JSON 配置”导入一次。DSH 的桌面与 CLI profiles 组合不同，需按实际 profile 使用 dsh.yaml；本向导不直接修改内部数据库或猜测配置位置。</p><p>WorkBuddy 未发现技能目录、配置冲突或格式错误时，按上表提示处理；两个技能的完整目录位于 ${escape(path.join(result.productRoot, 'plugins/copilot-discussion/skills'))}。保留现有设置，避免用整份模板覆盖原配置。</p>
${profiles.map(file => '<p>' + link(file, path.basename(file)) + '</p>').join('')}
<p>所选宿主配置：${escape(result.profileFile)}</p><textarea id="config" readonly>${escape(result.profileText)}</textarea><p><button onclick="const t=document.getElementById('config');t.select();document.execCommand('copy')">复制备用配置</button></p><p>只要求单个服务器对象的宿主使用：</p><textarea id="server" readonly>${escape(result.serverObjectText)}</textarea><p><button onclick="const t=document.getElementById('server');t.select();document.execCommand('copy')">复制单个服务器对象</button></p></section>
<section><h2>本机文件</h2><p>工作区：${escape(result.workspaceDir)}<br>插件配置：${escape(result.configFile)}<br>本次接入结果和报告：${escape(result.outputDir)}<br>环境准备耗时：${(result.timing.elapsedMs / 1000).toFixed(3)} 秒</p><p>完整问答、证据和计时写入工作区的 output/research-runs。备份可能包含原宿主配置，仅本机保存，请勿随发布包上传。</p><p>${link(path.join(result.productRoot, 'docs/installation.md'), '详细安装说明')} · ${link(path.resolve(result.productRoot, '../notices/THIRD-PARTY.html'), '第三方组件与许可')}</p></section></html>`;
}
