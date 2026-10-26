# 在你的 AI 软件里启用插件

适用于 **v0.10.0-preview.1 命令行预览版**。先完成[安装步骤](installation.md)，再只看你使用的软件那一节。“宿主”就是你平时与 AI 聊天的软件；MCP 是它连接本插件工具的方式，技能则告诉它怎样主持研究。

安装程序不会代替你安装这七种 AI 软件，也不会提供它们的账号或订阅。当前执行环境为 Windows 10/11 x64 本机 Chrome，不适用于网页、云端、WSL 或远程容器中的 Agent。

## 先找到本机配置与状态

1. 在终端运行 `copilot-discussion.cmd setup` 后，找到输出中的“开始使用.html”完整路径。复制该路径，粘贴到文件资源管理器地址栏，按回车；也可以用 Chrome 打开它。
2. 查看你的软件所在行。“已接入”表示连接文件和技能已准备好，**还需要重开软件检查**；“还需操作”请照对应章节处理。没有你的软件时，先安装并正常打开一次它，然后重跑 `setup`。
3. 说明页面里提供这台电脑专用的连接文件。需要导入时点击 `mcp.json` 等链接，用记事本打开后，按 `Ctrl+A` 全选、`Ctrl+C` 复制。只操作本插件的条目，保留软件里其他连接。
4. 如需手动导入技能，使用说明页面写出的 `skills` 目录，分别导入 **copilot-discussion**、**research-topics** 两个完整文件夹。不要只复制里面的 `SKILL.md`。若软件只接受 ZIP，分别压缩各文件夹的内容，让 ZIP 最外层包含 `SKILL.md`。

只使用 npx、没有安装全局命令的用户：下文的 `copilot-discussion.cmd` 换成安装页里的完整 `npx.cmd --yes "…tgz"` 前缀即可。

服务器一般叫 **copilot-discussion**。若安装时保留了已有同名连接，会另取名称；以说明目录中 `host-integration.json` 的 `serverName` 为准。不要为同一研究同时启用两份连接。

## Codex

1. 完全退出 Codex，再打开，创建一个新的本地任务。安装程序已准备 MCP 和两个技能，无需再装一份原生插件。
2. 在新任务中粘贴本页最后的“检查提示词”。如果出现工具授权提示，阅读后确认。
3. CLI 用户也可在终端运行 `codex mcp list`；应能看到本插件名称。看到名称后仍需在任务里实际检查工具。
4. 没有工具时，先运行 `copilot-discussion.cmd doctor`，再看安装说明中的状态。默认连接在用户目录的 `.codex/config.toml`，技能在 `.agents/skills`。自定义配置或组织管理的环境，请使用其实际生效配置；不要用生成片段覆盖整份文件。

接口依据：[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[技能](https://learn.chatgpt.com/docs/build-skills)。

## Claude Code

1. 退出 Claude Code，再重新打开，在输入框输入 `/mcp`。
2. 找到本插件并按 Claude Code 的提示连接；在聊天框发送本页最后的检查提示词。
3. 默认连接自动写入用户目录的 `.claude.json`，技能在 `.claude/skills`。无需再导入第二份。
4. 如果你使用自定义 `CLAUDE_CONFIG_DIR`，安装程序会提示手动导入。打开本机 `mcp.json`，在实际 Claude Code 的用户 MCP 配置中添加其中的本插件服务器对象，保留其他内容；再重新打开。无法确认配置位置时，先使用 Claude Code 的 `/mcp` 管理入口核对。

接口依据：[Claude Code MCP](https://code.claude.com/docs/en/mcp)。

## WorkBuddy

1. 完全退出并重开 WorkBuddy，进入“设置”里的“配置MCP”，查看是否已有本插件。
2. 有本插件时，按界面提示启用或确认信任，再到聊天框发送检查提示词。
3. 没有本插件或安装报告提示冲突时，在“配置MCP”里添加本地 STDIO 连接，使用本机 `mcp.json` 中的本插件配置。不同版本界面可能不同；不要删除已有连接，也不要把整份用户配置替换成模板。
4. 安装程序会复用已发现的 `.workbuddy/.mcp.json` 或 `mcp.json`。两份同时存在时，会让你确认实际使用哪份。
5. 技能目录已发现时会自动放入两个技能；若报告“需要导入技能”，在 WorkBuddy 的技能管理中导入说明页给出的两个完整技能文件夹。导入后重开任务，再发送检查提示词。

接口依据：[WorkBuddy MCP 指南](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)、[技能规范](https://open.workbuddy.cn/docs/skill)。

## QwenWork（千问办公）

1. 打开 **Windows 桌面版** QwenWork，在“扩展 → 连接器”中选择“添加”，然后选择“粘贴JSON配置”。这一步需要在界面里完成，安装程序不会写内部数据库。
2. 从本机说明页面打开 `mcp.json`。用记事本全选并复制文件内容，粘贴到连接器导入框，按界面提示保存并启用。
3. 查看连接器是否列出了本插件；出现信任或工具权限提示时，阅读后确认。
4. 两个技能已准备到用户目录的 `.qwenworkcn/skills`。重开任务后查看技能列表；若当前版本要求界面导入，就从说明页给出的 `skills` 目录分别导入两个完整文件夹。
5. 在聊天框发送检查提示词。网页版或云任务不能直接连接本机 Chrome，请使用本地桌面任务。

升级后请用新说明页的配置编辑原连接，再重新连接；已有本插件时不要再新增一份。

接口依据：[QwenWork 连接器](https://docs.qwenwork.cn/features/connectors)、[技能](https://docs.qwenwork.cn/features/skills)。

## DSH（DeepSeek Harness）

1. 在本机说明页找到 `dsh.yaml` 的完整路径。这是启动配置的补充文件，需要在启动你使用的 DSH profile 时加载。
2. 在终端运行下面**其中一条**。把引号里的路径换成你这台电脑生成的文件路径；网页界面用第一条，终端界面用第二条：

```powershell
dsh web --patch "C:\这里换成你的实际目录\dsh.yaml"
dsh tui --patch "C:\这里换成你的实际目录\dsh.yaml"
```

3. 如果你使用自己命名的 profile，请按 `dsh --profile <名称> --patch <文件>` 加载。该 profile 需要支持官方 MCP client 和文件系统技能；文件复制到目录里并不代表已加载。
4. 两个技能已准备到 `$DSH_HOME/skills`，默认是用户目录 `.dsh/skills`。打开任务后检查技能和工具，然后发送检查提示词。
5. 本项目没有逐版本验证 DSH 桌面版的配置导入界面。桌面版无法加载补充配置时，请先使用上面的公开 CLI 方式；不要改写桌面程序的内部配置数据库。

升级后用新说明页中的 `dsh.yaml` 路径重新启动该 profile，避免继续使用旧版本。

接口依据：[DSH 启动参数](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md)、[MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[文件系统技能](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)。

## GitHub Copilot CLI

1. 退出并重新打开 Copilot CLI，在它的交互输入框输入 `/mcp list`。
2. 看到本插件后，输入 `/mcp show copilot-discussion` 查看工具。若报告中的服务器名称不同，使用实际名称。
3. 输入 `/skills list`，确认有 `copilot-discussion`、`research-topics`，再发送检查提示词。
4. 默认 MCP 配置位于用户目录 `.copilot/mcp-config.json`，技能在 `.copilot/skills`；设置了 `COPILOT_HOME` 时使用对应目录。若需手动处理，使用生成的 `github-copilot.json`；这里的本地类型为 `local`。

GitHub Copilot CLI 是主持研究的软件，Microsoft 365 Copilot 网页是讨论对象，两者需要各自的账号权限。

接口依据：[Copilot CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)、[技能](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)。

## VS Code GitHub Copilot

1. 确认 VS Code 的 GitHub Copilot 扩展已启用并登录。按 `Ctrl+Shift+P`，搜索并运行 `Developer: Reload Window`（重新加载窗口）。
2. 再按 `Ctrl+Shift+P`，运行 `MCP: List Servers`，找到本插件，按提示启动并确认信任。
3. 打开 Copilot Chat，切换到 Agent 模式，在工具列表里启用本插件的工具，然后发送检查提示词。
4. 自动配置适用于本机默认用户配置 `%APPDATA%/Code/User/mcp.json`。自定义或便携 profile 需要在命令面板运行 `MCP: Open User Configuration`，在实际文件的 `servers` 中添加 `vscode-mcp.json` 里的本插件对象；保留其他内容后重新加载。
5. 两个技能在用户目录 `.copilot/skills`。这里需要运行在 **Windows 本机** 的 MCP；远程 SSH、WSL、容器和云 coding agent 不能直接访问本机 Chrome。

接口依据：[VS Code MCP 配置](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)。

## 所有宿主的最后检查

先在你的 AI 软件聊天框发送：

> 请使用 copilot-discussion 和 research-topics，先调用 discussion_doctor 检查插件环境。现在只检查，不开始讨论。告诉我是否可以使用。

应能发现 11 个 `discussion_*` 工具。环境通过检查后，按照[安装页的浏览器步骤](installation.md)开启 Chrome 调试、手动批准 Allow 并登录 Microsoft 365 Copilot，然后发送：

> 用 Jev Native，从免费公开资料自主选择一个值得研究的主题，与 Microsoft 365 Copilot 持续讨论，不限制轮数，最后给我结论、分歧、完整问答和分阶段实际耗时。

研究期间保持任务运行；暂停后可以用原记录继续。同一份研究不要同时交给两个 Agent 控制。完整问答在研究文件夹下的 `output/research-runs/`。

找不到工具：先重开软件，再运行 `copilot-discussion.cmd doctor` 并查看“开始使用.html”中的宿主状态。`doctor` 检查通过、宿主工具加载成功、浏览器授权和账号登录是三个不同步骤。

七种配置格式和隔离安装可以验证；所有客户端的实际登录与加载仍需对应电脑确认。反馈问题时附 Windows 架构、软件名称和版本、失败步骤及脱敏错误文字即可，不上传账号配置、浏览器登录资料或备份。
