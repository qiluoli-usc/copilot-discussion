# Copilot 主题讨论 v0.8.0

Jev Native 操作 Microsoft 365 Copilot 网页，当前 Agent 从免费公开资料选题、逐轮追问并交付完整记录和实际耗时。保留未发送草稿恢复、后台持续采集和仅推进新增争点。

## 首次安装

在 Windows 10 / 11 x64 双击配套 `CopilotDiscussion-0.8.0-Setup-win-x64.exe`，选择工作区与宿主；安装完成后打开“使用指南”。完整 EXE 包含 Node、uv、Python、Jev、锁定依赖和 Google 原始 Chrome 安装包，可带到另一电脑离线安装。Chrome Allow、Microsoft 登录及宿主 MCP 接入按界面完成。

当前为未签名测试包，本机最终启动验证受到 Windows Smart App Control 拦截。受控电脑需要先完成受信任代码签名与目标机验证；不能保证直接启动，不需要关闭安全策略。详见安装说明中的签名限制。

安装程序及校验值见 [v0.8.0-preview 预览发布](https://github.com/qiluoli-usc/copilot-discussion/releases/tag/v0.8.0-preview)。GitHub托管不改变Windows签名或信任状态。

单独 Plugin.zip 提供插件和技能源码，运行时使用完整安装程序准备。宿主客户端、账号与订阅由用户配置。默认执行模式无需额外 Jev API Key。

## 文件入口

- [安装使用](docs/installation.md)：图形安装、宿主接入、恢复与研究提示词。
- [宿主兼容性](docs/compatibility.md)：Codex、Claude Code、WorkBuddy、DSH、QwenWork、GitHub Copilot / VS Code 的接口及实测范围。
- [主技能](plugins/copilot-discussion/skills/copilot-discussion/SKILL.md) 与 [自动选题技能](plugins/copilot-discussion/skills/research-topics/SKILL.md)。导入时保留完整技能目录。
- [安装程序源码与构建](installer/README.md)。大型运行时由构建脚本准备，不写进源码目录。

软件安装后从开始菜单“Copilot 主题讨论”打开配置和使用指南。完整问答、证据和阶段计时保存在所选工作区 `output/research-runs/`，不保存在插件缓存内。切换宿主时先暂停原研究，再恢复同一 runFile。

## 开始研究

在宿主连接 MCP、加载两个技能后，可以说：

> 用 Jev Native，从免费公开资料自主选题，与 Copilot 持续讨论，不限制轮数，最后给我结论、分歧、完整问答和分阶段实际耗时。

资料检索和 Copilot 讨论需要联网；关闭主持任务后不会继续生成新问题。完整安装包不携带构建机的密钥、登录资料、配置或历史研究。

## 验证与许可状态

现有安装环境通过本地依赖检查。v0.8.0验证包含59项Node测试、11项Python测试、两个Skill格式、实际配置的官方MCP SDK互通，以及已试装候选环境的两轮Jev Native合成测试。候选EXE新目录试装19.798秒；最终未签名包受Smart App Control拦截，未完成另一电脑验证。

当前为私有研发仓库，尚未指定项目开源许可证。第三方组件依其各自原许可使用。构建产物和个人研究记录保存在本机output，安装包通过Releases分发。
