# Copilot 主题讨论

让你正在使用的 AI 软件主持研究，通过 Jev Native 与 Microsoft 365 Copilot 网页持续讨论，保留完整问答、恢复状态和分阶段耗时。

当前版本：**0.10.0-preview.1**。适用于 Windows 10/11 x64、本地 Agent 和 Google Chrome。没有 Jev Native 或 Python 也可自动准备；默认无需 Jev API Key。首次需要安装 [Node.js LTS](https://nodejs.org/)。

## 第一次安装

在 Windows 开始菜单打开“终端”或“PowerShell”，复制下面整条命令，按回车：

```powershell
npx.cmd --yes "https://github.com/qiluoli-usc/copilot-discussion/releases/download/v0.10.0-preview.1/copilot-discussion-0.10.0-preview.1.tgz" setup
```

不用提前下载文件。等待完成后，用 Chrome 打开终端给出的 **开始使用.html**。按你使用的软件完成连接，再开启 Chrome 远程调试、批准 Allow 并登录 Microsoft 365 Copilot。

程序会检测并复用环境、补齐缺少的 Jev 依赖、准备连接和两个技能。Codex、Claude Code、GitHub Copilot CLI、VS Code 默认用户配置可自动写入；WorkBuddy 使用已发现的位置。QwenWork 需界面导入，DSH 需加载启动配置；它们的逐步说明均在包内。

- [从安装到第一次研究](guides/installation.md)
- [七个软件分别怎么操作](guides/host-setup.md)
- [自动接入范围和保留设置](guides/automatic-hosts.md)
- [兼容性与验证范围](guides/compatibility.md)

## 开始研究

在你的 AI 软件里先发送：

> 请使用 copilot-discussion 和 research-topics，先调用 discussion_doctor 检查插件环境。现在只检查，不开始讨论。告诉我是否可以使用。

检查通过并完成浏览器授权、登录后，再发送：

> 用 Jev Native，从免费公开资料自主选择一个值得研究的主题，与 Microsoft 365 Copilot 持续讨论，不限制轮数，最后给我结论、分歧、完整问答和分阶段实际耗时。

保持任务运行。研究保存在你选定的文件夹下 `output/research-runs/`，可以暂停后继续。

## 检查、更新、修复、移除

将安装命令最后的 `setup` 换成下面任意一个命令：

| 命令 | 作用 |
| --- | --- |
| `doctor` | 检查程序和 Jev 环境 |
| `doctor --browser` | 检查 Chrome 连接，首次手动批准 Allow |
| `hosts` | 查看发现了哪些 AI 软件 |
| `guide` | 找到本机使用说明 |
| `update` | 下载并校验 GitHub 上的新版本，保留研究 |
| `repair` | 补回缺失的程序、依赖和本插件连接 |
| `uninstall` | 移除本插件登记的连接和文件，保留研究、共享依赖及用户修改 |

也可以按入门说明全局安装，之后用较短的 `copilot-discussion.cmd doctor` 等命令。

此预览通过 GitHub 分发标准 npm 包；尚未发布到 npm 公共仓库，请使用上面的完整网址。源代码见 [GitHub](https://github.com/qiluoli-usc/copilot-discussion)。项目许可证待确定；第三方组件保留各自许可证。
