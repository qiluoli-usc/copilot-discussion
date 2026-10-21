# 宿主兼容性与验证范围

核查日期：2026-10-21。这里的“宿主”指主持研究的 Agent；被操作的对话页面始终是 Microsoft 365 Copilot。GitHub Copilot 与 Microsoft 365 Copilot 是两个角色。

## 接口选择

公共执行核心是 Node 本地 stdio MCP，提供11个 `discussion_*` 工具；两个 Skill 提供选题、逐轮判断和交付流程。Native 仍由本机 Jev 驱动 Windows Chrome。各宿主读取同一配置和研究记录格式，不为每种宿主复制执行代码。

| 宿主 | 官方支持的接入形式 | 本项目提供 | 本机验证状态 |
| --- | --- | --- | --- |
| Codex 桌面 / CLI | 本地插件、Skills、MCP | `.codex-plugin/plugin.json`、本地目录、`codex.toml`、两个 Skill | 已有真实讨论；v0.7已启用并完成环境/协议回归 |
| Claude Code | `.claude-plugin` 插件、Skills、stdio MCP、插件用户配置 | 原生清单与安装配置表单，或通用 `mcp.json` | 已核实官方接口；未启动该客户端联调 |
| WorkBuddy | 本地 stdio MCP、Skill 导入；有独立连接器发布规范 | 通用 `mcp.json`、两个完整 Skill 目录 | 已核实官方接口；未启动该客户端联调，未提交连接器市场 |
| DSH / DeepSeek Harness | `@deepseek-ai/dsh-mcp-client`、文件系统 Skills | `dsh.yaml` overlay 片段、两个 Skill | 已核实官方仓库接口；未启动该客户端联调 |
| QwenWork 桌面 | 连接器支持本地 STDIO；个人 Skills | 通用 `mcp.json`、`~/.qwenworkcn/skills` 安装 | 已核实官方接口；未启动该客户端联调 |
| GitHub Copilot CLI | MCP、Agent Skills、Agent Plugins 1.0 本地插件 | 根 `plugin.json` / `mcp.json`、`github-copilot.json` | 已核实官方接口；未启动该客户端联调 |
| VS Code GitHub Copilot 本地 Agent | MCP、Agent Skills | `vscode-mcp.json`，项目或个人 Skills | 已核实官方接口；未启动该客户端联调 |

“官方支持接口”不等于已在所有客户端完成测试。公共MCP已用官方Python SDK核验直接Node及原生插件PowerShell启动入口；宿主版本、企业策略与工具权限仍可能影响加载。v0.7首次安装结果见 本机验证记录（见开发工作区对应记录，离线分发包不携带历史记录），历史协议验证见 v0.6记录（见开发工作区对应记录，离线分发包不携带历史记录）。

## 已核实的官方依据

- Codex：[插件结构](https://developers.openai.com/plugins/build/plugins)、[技能](https://developers.openai.com/plugins/build/skills)。本机 CLI 的 `codex mcp add --help` 验证了本地 stdio 注册；使用生成的绝对路径 TOML，不假设插件根目录环境变量。
- Claude Code：[插件清单、MCP 与 userConfig](https://code.claude.com/docs/en/plugins-reference)、[MCP 接入](https://code.claude.com/docs/en/mcp)。本包使用 `CLAUDE_PLUGIN_ROOT` 和 `user_config` 插值；默认位置无需配置密钥。
- WorkBuddy：[MCP 连接器规范](https://open.workbuddy.cn/docs/connector)、[Skill 规范](https://open.workbuddy.cn/docs/skill)。官方支持 stdio 和 MCP+Skill，并建议单工具请求控制在30秒内。本包采用有界返回和后台采集；连接器市场包需要额外元数据，本包未声称通过市场发布。
- DSH：[官方 MCP client 配置](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/mcp/mcp-client/README.md)、[官方文件系统 Skill 插件](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/skill/skill-filesystem/README.md)。DSH 在服务前探测 MCP，因此服务器 initialize/list 不启动浏览器。
- QwenWork：[桌面连接器](https://docs.qwenwork.cn/features/connectors)、[Skills](https://docs.qwenwork.cn/features/skills)。个人技能目录为 `~/.qwenworkcn/skills`；网页与云环境不直接获得本机 Chrome。
- GitHub Copilot：[CLI 添加 MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)、[Agent Skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills)、[CLI 插件参考](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)。根 `plugin.json` 采用 Agent Plugins 1.0，MCP 配置单独位于根 `mcp.json`。
- VS Code：[MCP 配置参考](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)。原生 `.vscode/mcp.json` 使用 `servers`，不能直接粘贴其他客户端的 `mcpServers` 外层。

## 运行位置与必要能力

宿主需要：本地 stdio 子进程、读取或导入 Skill、可用的公开网页搜索、持续执行工具的 Agent 模式。服务器只执行和采集，自动选题及追问由宿主完成。没有网页搜索时应说明证据获取受限，不能编造已读来源。

Jev Native 当前只在 Windows 主机运行，并连接该主机的 Chrome / Browser Harness。GitHub 云端 coding agent、网页聊天、WSL、容器、远程 SSH 的进程不能直接使用这套本机执行器；先确认 MCP 子进程实际运行在 Windows，而非只确认编辑器窗口在 Windows。此版本未实现远程代理、HTTP/SSE 或跨机器浏览器控制。

通用 `jev-browser-use` Skill 的宿主支持范围与本项目不同。本项目调用实际安装的 `jev_ultrafast.browser.Browser`，提供执行层适配；不调用其通用 Agent 决策循环。换宿主不要求导入 Codex 的 CUA 工具，也不需要安装 Codex 专属 Jev Skill。

## 凭据与配置

本版无需 Jev API Key、Scite 或额外主持模型密钥。当前宿主自身的账户/模型配置由宿主管理，Microsoft 登录及 Chrome Allow 由用户完成。安装器只接受工作区、Jev 路径、Python Launcher、本机 Chrome 地址及采集时间；API Key/Token 字段会被拒绝，不把密钥填入普通 MCP JSON。

v0.7提供显式付费决策实验入口，凭据由既有决策环境加载，不进入默认配置；失败试验没有取得足够的成功速度样本，未启用生产决策模式。没有远程决策调用也不代表Jev未执行：Native记录模块路径、SHA256与真实Browser.act回执。实验边界见 [决策对照说明](../plugins/copilot-discussion/skills/copilot-discussion/references/decision-benchmark.md)。

## 首次环境准备

所有本地宿主共用同一bootstrap：复用已有环境，缺少时自动安装用户目录中的Node、uv、托管Python与固定版本Jev/依赖，保留浏览器授权。可发现的环境限本包配置、显式路径/环境变量和管理目录；不扫描其他Agent私有目录。Windows x64已做隔离实际安装；arm64提供官方包分支，尚未在arm64电脑实测。Chrome已有环境已实测复用；缺失时的winget安装分支未通过卸载现有Chrome来实测。
