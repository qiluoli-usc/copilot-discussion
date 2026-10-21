# 宿主自动接入（v0.9.0）

逐宿主操作、检查命令与手动导入步骤见 [首次使用步骤](host-setup.md)，包括Codex、Claude Code、WorkBuddy、QwenWork、DSH、GitHub Copilot CLI和VS Code。

完整Windows x64 Setup默认选择“自动检测并接入已安装宿主”。检测只查看已知用户配置目录与PATH启动入口，不扫描磁盘、会话或凭据。安装器准备运行环境后，用这台电脑的绝对路径合并MCP并安装两个完整技能目录。其他设置、账号与权限保留；没有预装Jev Native、Node、Python或Jev技能也可用完整EXE准备。

## 可自动写入的范围

| 宿主 | MCP位置与格式 | 技能位置 | 适用边界 |
| --- | --- | --- | --- |
| Codex | `$CODEX_HOME/config.toml`，默认`~/.codex/config.toml`；`mcp_servers` | `~/.agents/skills` | 追加或更新已登记的独立表块，保留其他TOML原文；重新加载宿主 |
| Claude Code | `~/.claude.json`的用户级`mcpServers` | `~/.claude/skills` | 自定义`CLAUDE_CONFIG_DIR`不猜测文件位置，报告需导入 |
| WorkBuddy | 优先复用已存在的`~/.workbuddy/.mcp.json`；否则使用官方文档的`mcp.json` | 已发现的`~/.workbuddy/skills` | 两份MCP配置同时存在则保留并提示；技能目录未发现则导入产品中的两个技能 |
| GitHub Copilot CLI | `$COPILOT_HOME/mcp-config.json`，默认`~/.copilot/mcp-config.json`；`mcpServers`、`type: local` | 同一Copilot根目录的`skills` | 共享技能目录本身不证明CLI已安装 |
| VS Code GitHub Copilot | `%APPDATA%/Code/User/mcp.json`，`servers` | `~/.copilot/skills` | 本地默认用户profile；自定义/便携/远程profile需在对应环境配置，Copilot扩展、账号与Agent能力由宿主提供 |
| QwenWork | **需一次界面导入**本机`mcp.json` | 自动准备`~/.qwenworkcn/skills` | 官方公开文档未提供稳定文件注册接口，不写内部数据库 |
| DSH | **需按实际profile接入**生成的`dsh.yaml` overlay | 自动准备`$DSH_HOME/skills`，默认`~/.dsh/skills` | 桌面与CLI profiles组合不同，不用一个猜测路径宣称已生效 |

检测到配置目录仅是可接入证据，不等于客户端仍安装、账号有效或工具可用。首次安装但尚未启动、没有配置目录且未加入PATH的宿主可能未被发现；先正常启动该宿主，再从开始菜单重开“配置与检查”。未发现的宿主不被自动创建整套配置；仍生成备用模板。

## 保留设置、升级与撤销

JSON/JSONC使用Microsoft jsonc-parser的文本编辑接口，保留注释、其他服务器及顶层设置；拒绝重复键、格式错误或错误容器类型。TOML由随包解析器验证，只追加本插件独立表块，不重排整份文件。原本存在同名MCP且不属于安装器时，保留原项并使用`copilot-discussion-native`等独立名称。

自动接入登记在`~/.copilot-discussion/host-integrations/state.json`。再次安装仅更新已登记且未被人工改写的启动字段和技能文件；其他技能、用户额外文件、工具权限与账号设置保留。发现启动项、托管技能文件被修改或移除时，保留用户选择并报告待处理，不覆盖、恢复或伪报成功。同名技能与源文件相同时可复用，不接管原文件所有权。

改动前的字节副本与SHA256、目标路径、本次操作日志保存在同目录的`backups/<时间UUID>/`。备份可能包含原宿主配置，仅本机保留，不进入产品ZIP或GitHub。写入前重新核对原文件；并发修改触发停止与校验回滚。安装向导的“撤销接入”只恢复仍与本次安装结果一致的文件，之后的用户修改保留。撤销保留运行环境和研究工作区；留下空目录不会影响使用。

本次接入状态、逐宿主结果、耗时与回滚报告位置写入安装目录`profiles/<时间>/host-integration.json`和使用指南。已写入配置表示磁盘配置准备完成，不能代替宿主重新加载后的实际工具验证。

## 首次使用

已自动接入的宿主无需复制MCP。重新加载或重启宿主，按其提示完成原有工具信任确认。Chrome开启远程调试、批准Allow、登录Microsoft 365 Copilot，然后由宿主调用`discussion_doctor`，再开始公开研究。安装器不自动接受宿主信任、不取消企业策略，也不修改宿主模型或账户配置。因此不能保证每种宿主都只剩浏览器授权和登录两个动作。

完整EXE包含可迁移Python原发行版和锁定wheels，在目标电脑重新创建venv；不复制构建机虚拟环境。此Native执行器仍限Windows 10/11 x64本机Chrome。macOS、Linux、ARM64、WSL、容器、网页或云Agent不能直接运行这个EXE；本版没有跨机器代理。

## 接口来源（2026-10-21核查）

- [OpenAI Docs MCP配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[技能目录](https://learn.chatgpt.com/docs/build-skills)。
- [Claude Code MCP用户作用域](https://code.claude.com/docs/en/mcp)。
- [WorkBuddy MCP配置位置](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)。现有`.mcp.json`及skills路径另在本机目录元数据中观察到；未读取账号或会话。
- [GitHub Copilot CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)、[VS Code MCP](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)。
- [QwenWork连接器](https://docs.qwenwork.cn/features/connectors)、[技能](https://docs.qwenwork.cn/features/skills)。
- [DSH CLI profiles](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md)、[文件系统技能](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)。
