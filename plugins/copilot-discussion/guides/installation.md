# 第一次使用：从安装到开始讨论

这个插件让你正在使用的AI助手，与Microsoft 365 Copilot网页持续讨论一个主题。它会保存完整问答、结论、分歧和实际耗时。

你需要Windows 10/11 x64电脑、Google Chrome、能登录的Microsoft 365 Copilot账号，以及一个AI助手：Codex、Claude Code、WorkBuddy、DSH、QwenWork、GitHub Copilot CLI或VS Code GitHub Copilot。本文把这些AI助手叫作“宿主”。

本页适用于**0.10.0-preview.1命令行预览版**。不必下载Setup.exe、不必另外安装Jev技能，也不需要购买Jev API。安装过程会联网下载缺少的依赖。当前npm包由GitHub分发，尚未发布npm公共仓库；请完整复制下面的GitHub地址，不能省略成同名npm包。

## 第一步：打开终端，检查Node.js

1. 在Windows开始菜单搜索“终端”或“PowerShell”，点击打开。一般不需要“以管理员身份运行”。
2. 复制下面第一行，粘贴到终端，按回车；完成后再运行第二行。

```powershell
node --version
```

```powershell
npm.cmd --version
```

第一条显示`v20`或更高版本，第二条显示一个版本号，就可以继续。如果提示“无法识别”，请从[Node.js官网](https://nodejs.org/en/download)安装LTS版，保留默认选项。安装后关闭终端，再打开一次，重新执行上面两条命令。

这里只需安装Node.js。Python、uv和Jev会由插件检测；已有可用环境会复用，缺少时自动准备。Node.js本身不会由npm安装自己。

## 第二步：安装命令

将下面整行复制到终端并按回车，不要拆成几段：

```powershell
npm.cmd install --global "https://github.com/qiluoli-usc/copilot-discussion/releases/download/v0.10.0-preview.1/copilot-discussion-0.10.0-preview.1.tgz"
```

等待命令结束、终端重新出现可输入的位置。这个步骤安装命令工具；下一条setup负责配置你的AI助手。

接着执行：

```powershell
copilot-discussion.cmd setup
```

它会准备Jev环境，自动发现你已安装并打开过的宿主，保留原设置后接入插件。结束时会显示每个宿主的状态，以及“开始使用.html”的完整文件位置。

首次下载可能需要几分钟。终端显示下载或准备依赖时，请等待这条命令结束，不要再开一份安装。

默认研究文件保存在用户文件夹的`Documents\CopilotResearch`。想换位置时，在首次setup使用：

```powershell
copilot-discussion.cmd setup --workspace "D:\我的研究"
```

已有配置时沿用原研究目录，避免误切换到另一个文件夹。

### 不想全局安装，或提示权限不足

可以跳过上面的全局安装，直接用npx完成同一件事：

```powershell
npx.cmd --yes "https://github.com/qiluoli-usc/copilot-discussion/releases/download/v0.10.0-preview.1/copilot-discussion-0.10.0-preview.1.tgz" setup
```

不要求先下载文件。插件会将运行程序另存到固定目录，清理npx缓存不会让已配置的宿主失效。后续维护也可重复使用这条命令，把末尾的`setup`换成`doctor`、`repair`、`update`或`uninstall`。

## 第三步：打开本机说明，连接你的宿主

1. 找到终端结尾显示的“开始使用.html”路径。打开资源管理器，将该路径粘贴到地址栏并回车；也可以用Chrome打开这个HTML文件。
2. 在说明表格找到你使用的AI助手。
3. 显示“连接和技能已准备”时，完全退出并重新打开AI助手。若要求信任新工具，阅读提示后确认。
4. 显示“还需操作”时，按[你的宿主的具体步骤](host-setup.md)完成。QwenWork需要粘贴一次连接配置，DSH需要加载启动配置；安装器不会把它们假装成已自动加载。

没发现宿主时，先安装它、打开一次并完成它自己的登录，再运行setup。只想接入一个宿主时，例如：

```powershell
copilot-discussion.cmd setup --host claude-code
```

查看七宿主名称与检测结果：

```powershell
copilot-discussion.cmd hosts
```

## 第四步：允许Chrome连接，并登录Copilot

1. 打开Google Chrome。
2. 在地址栏输入`chrome://inspect/#remote-debugging`并回车，启用远程调试。
3. 回到终端，运行：

```powershell
copilot-discussion.cmd doctor --browser
```

4. 如果Chrome弹出“Allow / 允许”，手动点击允许。终端应显示浏览器连接成功。
5. 打开[Microsoft 365 Copilot](https://copilot.cloud.microsoft/chat)，完成Microsoft账号登录。账号权限由你的账号或组织决定。

检查不会向Copilot发送问题。Chrome授权、Microsoft登录和宿主工具信任需要你本人完成。

## 第五步：在你的AI助手里开始

先在AI助手的聊天框粘贴：

> 请使用copilot-discussion和research-topics，先调用discussion_doctor检查插件环境。现在只检查，不开始讨论。告诉我是否可以使用。

如果能找到工具，并确认环境通过，再发送：

> 用Jev Native，从免费公开资料自主选择一个值得研究的主题，与Microsoft 365 Copilot持续讨论，不限制轮数。每轮根据实际回答追问新增争点。最后给我结论、分歧、完整问答和分阶段实际耗时。

也可以给主题，例如“制造业视觉质检中，AI何时值得替代人工复检”。研究期间让宿主任务继续运行；关闭任务后不会独立生成下一问。要暂停时说“暂停这次讨论，保留记录”。恢复时让它读取原记录继续，不要让两个宿主同时操作同一研究。

完整问答和计时位于研究文件夹的`output\research-runs`。安装、更新、卸载均不删除这些研究记录。

## 以后常用的四个命令

| 想做什么 | 复制这条命令 | 会发生什么 |
| --- | --- | --- |
| 看环境是否正常 | `copilot-discussion.cmd doctor` | 检查程序、Python和Jev，不打开研究 |
| 更新插件 | `copilot-discussion.cmd update` | 查询GitHub命令行版本，校验后安装，保留记录与已有设置 |
| 修复缺少的文件 | `copilot-discussion.cmd repair` | 补齐托管文件与依赖，保留人工修改过的宿主配置 |
| 停用并移除插件 | `copilot-discussion.cmd uninstall` | 移除登记的连接和当前版程序，保留研究、备份和共享Jev环境 |

维护前先暂停研究并退出相关任务，更新后重开宿主。若卸载提示文件被人工修改，请按提示核对；程序会保留它及所需环境，不强行删除。

QwenWork等手动导入连接的宿主，更新后按新说明页编辑原连接；DSH使用新生成的启动配置。旧版本会保留，但旧连接不会自动切到新程序。

QwenWork、DSH或其他手动导入过连接的宿主：先在其界面删除本插件连接；DSH改为不加载本插件的 `dsh.yaml`。完成后再运行 `copilot-discussion.cmd uninstall --manual-disconnected`。这个参数表示你已完成手动断开，避免移除程序后仍留有失效连接。

`update`更新的是固定目录里的插件。即使全局npm命令仍是旧版，维护操作也会转交给已安装版本执行。研究文件夹、共享依赖和旧版本备份不会因更新或卸载而清空。

如果用npm全局安装了命令，完成插件卸载后还可移除全局命令：

```powershell
npm.cmd uninstall --global copilot-discussion
```

这条npm命令本身不撤销宿主连接，所以先运行插件uninstall。

## 遇到问题时

| 现象 | 先这样处理 |
| --- | --- |
| 找不到`copilot-discussion.cmd` | 重开终端；仍找不到时，使用上面的完整npx命令，把末尾换成要执行的操作 |
| 下载失败或网络超时 | 确认可访问GitHub和Python依赖来源后重试；已校验缓存会尽量复用 |
| 环境通过，但宿主没有工具 | 重开宿主，按接入步骤确认工具已加载；环境通过不代表宿主已读新配置 |
| Chrome无法连接 | 确认是Google Chrome，启用调试并批准Allow，再运行`doctor --browser` |
| 安全策略阻止程序或脚本 | 保留系统或组织策略，记录被阻止的文件；npm分发不自动取得系统信任 |
| 配置或技能被保留 | 其中可能有人工修改，插件未覆盖，按本机说明核对位置 |

反馈请附Windows版本、宿主名称和版本、执行的命令与已脱敏错误文字。不要上传账号配置、浏览器资料、登录状态或宿主备份。

当前执行层仍限Windows本机Chrome。macOS、Linux、ARM64、WSL、容器、远程SSH及云端Agent未获得本版完整运行验证；换成npm不会自动增加这些平台的浏览器能力。
