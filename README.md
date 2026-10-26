# Copilot主题讨论

让你正在使用的AI助手，与Microsoft 365 Copilot网页持续讨论一个主题，并交付结论、分歧、完整问答和实际耗时。支持从免费公开资料自动选题，也可使用你给定的主题。

当前推荐 **0.10.0-preview.1 npm/npx预览版**。不必先下载EXE；已有Jev环境直接复用，缺少的Python、uv和Jev依赖会自动准备。默认无需Jev API Key。

## 第一次安装

需要Windows 10/11 x64、Google Chrome、可用的Microsoft 365 Copilot账号、一个已安装的AI助手，以及Node.js 20或更高版本。没有Node.js时，从[官网](https://nodejs.org/en/download)安装LTS版，再重新打开终端。

在PowerShell中复制整行并回车：

```powershell
npx.cmd --yes "https://github.com/qiluoli-usc/copilot-discussion/releases/download/v0.10.0-preview.1/copilot-discussion-0.10.0-preview.1.tgz" setup
```

等它结束后，打开终端显示的“开始使用.html”，按你的宿主完成连接、Chrome授权和Copilot登录。

**不熟悉命令行时，按[一步一步安装说明](docs/installation.md)操作。** 包括打开终端、准备Node.js、接入宿主、开始研究、更新、修复和卸载。当前包从GitHub获取，尚未发布npm公共仓库，请保留命令中的完整网址。

## 支持哪些AI助手

Codex、Claude Code、WorkBuddy、DSH、QwenWork、GitHub Copilot CLI、VS Code GitHub Copilot。安装器按可确认的位置接入MCP和两个技能，保留其他设置与人工修改；QwenWork仍需一次界面导入，DSH按实际启动配置加载。见[七宿主步骤](docs/host-setup.md)。

它们负责主持研究，讨论对象始终是Microsoft 365 Copilot网页。Chrome授权、Microsoft登录和宿主信任由用户完成。执行层支持Windows本机Chrome，其他系统、容器和云端Agent未适配。

## 安装后怎么说

先让AI助手检查：

> 请使用copilot-discussion和research-topics，先调用discussion_doctor检查环境。现在只检查，不开始讨论。

确认后再发：

> 用Jev Native，从免费公开资料自主选一个值得研究的主题，与Microsoft 365 Copilot持续讨论，不限制轮数。最后给我结论、分歧、完整问答和分阶段实际耗时。

保持宿主任务运行；关闭任务后插件不会自己思考下一问。暂停后可读取原记录继续。研究记录默认在用户文件夹的`Documents\CopilotResearch\output\research-runs`，维护和卸载会保留。

## 文件放在哪里

| 目录 | 内容 |
| --- | --- |
| `plugins/copilot-discussion/` | npm包、命令入口、两个技能、MCP服务与研究核心 |
| `docs/` | 给用户看的安装、七宿主步骤及开发说明 |
| `installer/` | 保留的EXE源码，命令行安装不依赖它 |
| `scripts/` | 维护者打包入口 |
| `output/releases/` | 各版本分发文件，旧版保留 |
| `output/installations/` | 隔离安装与维护验证记录 |
| `output/research-runs/` | 本工作区历史研究 |
| `copilot/` | 原项目，保持独立 |

开发接口见[开发说明](docs/development.md)，原EXE方式见[历史说明](docs/legacy-exe.md)。项目源码尚未指定开源许可证，第三方组件保留原许可。
