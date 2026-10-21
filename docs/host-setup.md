# 各宿主首次使用步骤（v0.9.0 预览版）

适用于已用完整 `CopilotDiscussion-0.9.0-Setup-win-x64.exe` 安装的 Windows 10/11 x64 用户。没有预装 Jev Native、Jev技能、Node 或 Python 也可由完整 EXE 准备。安装包不包含 Agent 客户端、账号或订阅。默认无需 Jev API Key。

公开测试下载：[v0.9.0-preview.3 宿主说明修订包](https://github.com/qiluoli-usc/copilot-discussion/releases/tag/v0.9.0-preview.3)。本说明更新于2026-10-21。修订包的完整EXE和后续配置向导均内置七宿主步骤；只下载EXE即可离线阅读，无需另外下载HTML。原版 `v0.9.0-preview` 保留原校验值。

## 先找到本机配置与状态

1. 安装前先选择“主持宿主”，下方“宿主安装说明”会立即显示对应步骤。自动检测或通用模式先显示安装总览，也可在“查看步骤”里分别查看七宿主说明；查看说明不会更改安装目标。准备好后保留自动合并MCP/安装技能选项，点击“开始安装”。如果宿主首次安装后还没启动过，先正常打开并完成宿主自己的登录，再重新运行配置向导。
2. 完成后点“使用指南”，看对应宿主那一行的 MCP、两个技能及下一步。显示“已写入/已复用/已准备”的项目无需重复导入；显示需导入、保留或冲突的项目按下文处理。
3. 点向导“打开目录”，会打开本次生成的配置目录，里面有 `mcp.json`、`codex.toml`、`github-copilot.json`、`vscode-mcp.json`、`dsh.yaml`、`host-integration.json` 和 `开始使用.html`。这些模板包含本机绝对路径，不能直接复制另一台电脑的模板。
4. 本修订包安装在 `versions/0.9.0-host-guide.2/`，两个技能位于其 `product/plugins/copilot-discussion/skills/` 下，目录名分别是 `copilot-discussion`、`research-topics`。手动导入时保留完整目录及辅助文件；若宿主只接受ZIP，分别将各技能目录的内容打包，使ZIP根级有 `SKILL.md`。安装后的“使用指南”也内置全部步骤，并默认选中本次宿主。

服务器通常名为 `copilot-discussion`。遇到已有同名项时，向导会保留原项并使用独立名称，后续查找请以 `host-integration.json` 的 `serverName` 为准。不要删除其他服务器、覆盖整份用户设置，或同时启用两份指向同一研究的连接。

## Codex

1. 自动接入成功后，重新启动Codex并打开一个新的本地任务，以便读取MCP和技能。只需选择这条自动MCP路线，无需再安装一份原生插件。
2. MCP写在 `$CODEX_HOME/config.toml`（默认 `~/.codex/config.toml`）的 `mcp_servers` 中；两个技能放在 `~/.agents/skills/`。需要排查时只核对本插件的条目和路径。
3. 在新任务发送文末的环境检查提示词。CLI用户还可运行 `codex mcp list` 查看服务器是否存在；服务器存在不等于浏览器授权已完成。
4. 若向导保留了冲突项，在实际使用的Codex配置中合并本次 `codex.toml` 的独立表块，保留其他配置。自定义配置层和组织管理项以当前客户端为准，再重新加载。

接口依据：[OpenAI Docs MCP配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[技能目录](https://learn.chatgpt.com/docs/build-skills)。

## Claude Code

1. 自动接入成功后退出并重新打开Claude Code。该路线将服务器放在 `~/.claude.json` 的用户级 `mcpServers`，技能放在 `~/.claude/skills/`。
2. 在Claude Code输入 `/mcp`，确认向导报告的服务器名和连接状态；必要的工具信任提示由你确认。再发送文末环境检查提示词。
3. 自定义 `CLAUDE_CONFIG_DIR` 或冲突被保留时，使用Claude Code自己的MCP配置功能导入本次 `mcp.json` 中该服务器的单个对象。CLI备用方式是 `claude mcp add-json --scope user copilot-discussion '<单个服务器JSON>'`；替换示例内容，不把整个 `mcpServers` 外层传入。
4. 若技能未自动安装，用宿主的技能方式导入两个完整目录，再重开任务。自动MCP成功时不必另外安装同名插件。

接口依据：[Claude Code MCP用户作用域与JSON导入](https://code.claude.com/docs/en/mcp)。

## WorkBuddy

1. 自动接入成功后重启WorkBuddy，在其MCP服务器管理中确认对应服务器已启用，再发送文末检查提示词。
2. 如需手动处理，打开“插件 → MCP服务器 → 配置MCP”（不同版本入口名称可能变化），把本次 `mcp.json` 的该服务器项合并进去，类型为本地STDIO，命令和参数保留生成的本机路径。
3. 安装器优先复用已发现的 `~/.workbuddy/.mcp.json`；没有它时使用官方说明的 `~/.workbuddy/mcp.json`。两份同时存在会提示确认；请从WorkBuddy自身的配置入口确定生效位置，不随意删除其中一份。
4. 在技能管理中确认两个研究技能。若向导未发现技能目录或保留了定制技能，使用本地导入功能导入上面两个完整技能目录，然后重开任务。

接口依据：[WorkBuddy MCP配置](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)。`.mcp.json`与skills目录另有本机目录元数据观察，未逐一实测不同版本客户端加载。

## QwenWork（千问办公）

1. 这里仍需一次界面MCP导入：打开桌面客户端的“扩展 → 连接器 → 添加 → 粘贴JSON配置”。
2. 打开向导生成的 `mcp.json`，复制完整JSON并导入；检查本地STDIO、Node命令和参数均来自当前电脑。若已有同名服务器，保留原项，为本次连接选择不同名称，避免直接覆盖。
3. 在“已安装”的连接器中启用本次服务器，按客户端提示处理信任并重新打开任务。
4. 在“扩展 → 技能”确认两个技能；它们会自动准备到 `~/.qwenworkcn/skills/`。若目录未被当前版本读取或已有定制技能被保留，使用本地技能导入功能加载两个完整目录。
5. 发送文末的环境检查提示词。需使用Windows本地桌面STDIO能力，QwenWork网页或云任务不能直接控制本机Chrome。

接口依据：[QwenWork连接器](https://docs.qwenwork.cn/features/connectors)、[技能](https://docs.qwenwork.cn/features/skills)。安装器不修改未公开的内部数据库。

## DSH（DeepSeek Harness）

1. 查看向导生成的 `dsh.yaml`，它是带 `insert` 外层的Cordis overlay。原有profile继续保留；不能仅把文件复制到某个目录就当作已经加载。
2. CLI用户可在启动目标profile时指定这份文件。下面任选实际使用的一种，并将示例路径换成本次生成文件的完整路径：

```powershell
dsh web --patch "C:\path\to\dsh.yaml"
dsh tui --patch "C:\path\to\dsh.yaml"
```

3. 其他自定义profile按官方 `dsh --profile <名称> --patch <文件>` 方式加载；profile需要具备官方MCP client和文件系统技能能力，缺少时按匹配DSH版本的官方说明启用。
4. 技能会准备到 `$DSH_HOME/skills`（默认 `~/.dsh/skills`）。重新打开任务后检查工具清单，再发送文末检查提示词。
5. DSH桌面profile由桌面程序管理，不用CLI强行改写其内部profile。本项目没有逐版本核实桌面导入界面，因此此处不承诺桌面版全自动接入；没有可用overlay入口时，先使用上述已公开的CLI流程。

接口依据：[DSH CLI/profile与patch说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md)、[MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[文件系统技能](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)。

## GitHub Copilot CLI

1. 重新打开Copilot CLI。在交互输入框输入 `/mcp list`，再用 `/mcp show <向导中的服务器名>` 查看工具。这里的GitHub Copilot是主持Agent，目标网页仍是Microsoft 365 Copilot。
2. 输入 `/skills list`，确认 `copilot-discussion` 和 `research-topics` 两个技能，再发送文末检查提示词。
3. 自动配置写入 `$COPILOT_HOME/mcp-config.json`，默认 `~/.copilot/mcp-config.json`，两个技能在同一Copilot根目录的 `skills/`。
4. 需要手动处理时，合并本次 `github-copilot.json` 的对应服务器对象；本地类型为 `local`。保留其他服务器、现有工具权限和账号设置，然后重启CLI。

接口依据：[Copilot CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)、[技能管理](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)。

## VS Code GitHub Copilot

1. 确认GitHub Copilot已启用并完成宿主自己的登录。按 `Ctrl+Shift+P` 执行 `Developer: Reload Window`，然后执行 `MCP: List Servers` 查看对应服务器，按提示启动并确认信任。
2. 打开Copilot Chat，选择Agent模式，启用本插件所需工具，发送文末检查提示词，并要求使用两个研究技能。
3. 安装器配置的是本地默认用户 `%APPDATA%/Code/User/mcp.json`，顶层为 `servers`；个人技能在 `~/.copilot/skills/`。
4. 自定义profile或其他本地配置位置：用命令面板的 `MCP: Open User Configuration` 打开实际生效文件，将本次 `vscode-mcp.json` 的服务器项合并到 `servers`，保留其他内容；再重新加载。
5. MCP子进程必须运行在Windows本机。Remote SSH、WSL、容器和云coding agent不是这个安装器的目标环境，不能只因VS Code窗口在Windows上就当作可以控制本机Chrome。

接口依据：[VS Code MCP配置与命令](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)。

## 所有宿主的最后检查

先在Agent中发送：

> 使用copilot-discussion和research-topics。先调用discussion_doctor检查安装环境，告诉我是否就绪；本次只检查，不创建Copilot讨论。

应能发现11个 `discussion_*` 工具。`doctor.ready`仅代表本地依赖通过；Chrome远程调试、Allow和Microsoft登录仍需在首次浏览器连接时完成。按向导“授权检查”提示操作后，再发送：

> 用Jev Native，从免费公开资料自主选题，与Microsoft 365 Copilot持续讨论，不限制轮数，最后给我结论、分歧、完整问答和分阶段实际耗时。

没有工具时先检查对应宿主是否加载了正确配置；不要重复安装一套插件来叠加连接。发生冲突可回到向导查看状态；“撤销接入”仅按校验恢复本次改动，保留后续人工修改、运行环境和研究工作区。完整问答位于所选工作区 `output/research-runs/`。

当前EXE未签名，Windows安全策略可能阻止启动；公开下载不会改变签名状态，请保留系统策略。安装器及MCP协议在隔离环境验证，不等于所有宿主客户端已逐一实测。测试反馈请附Windows架构、宿主版本、失败阶段及已脱敏的错误文字，不上传账号配置、浏览器登录资料或宿主备份。
