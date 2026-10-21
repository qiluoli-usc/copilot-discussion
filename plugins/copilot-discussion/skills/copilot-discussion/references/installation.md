# 首次安装与环境修复

适用于Windows本机的所有宿主。宿主不需要预装Jev Skill；本包附带所需执行适配。用户希望图形安装时，优先使用配套 `CopilotDiscussion-0.8.0-Setup-win-x64.exe`：双击、选择工作区和宿主、安装后打开使用指南。完整EXE附带独立Node/Python/uv、Jev、锁定wheels和Chrome原始安装包；在目标电脑新建虚拟环境并强制离线，不复制构建机环境。宿主MCP接入、Chrome远程调试、Allow及Microsoft登录仍由用户完成；不能把软件安装成功当作已获浏览器授权。

没有图形安装包时使用下面的脚本；在线自动安装需要网络和本地脚本执行能力，组织策略或浏览器授权可能需要用户操作。

当用户要求安装/修复环境时，通过宿主的终端工具调用本技能内脚本。已连接MCP先doctor；若Node缺失导致MCP都无法启动，直接使用PowerShell入口，不为此重复注册插件。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<本技能绝对路径>\scripts\bootstrap.ps1" -Workspace "<研究工作区绝对路径>" -Target all
```

替换实际路径。bootstrap先复用Node20+，缺少时下载校验过的独立Node；setup检测配置/环境变量中的Jev和已管理的运行时，能导入则直接复用。缺少时下载固定提交、校验SHA256，准备uv、托管Python3.12和锁定依赖。默认数据目录为LOCALAPPDATA/CopilotDiscussion；配置为用户目录/.copilot-discussion/config.json。不会在插件缓存/项目源码中安装大型运行时，不覆盖系统Python或改全局PATH。

已有Jev可加 `-RuntimeRoot "实际根目录"`。可用 `-DataDir`、`-Config`、`-Output` 指定绝对路径。`-NoInstall` 仅检查复用；`-Isolated` 在所选专用目录准备隔离环境；`-ForceManagedNode` 用于明确验证缺少Node的路径。常规安装不要反复用隔离开关。脚本的执行策略只作用于本次PowerShell进程，不修改系统策略，不能覆盖组织策略。

第一次检查前提示Chrome可能弹Allow。默认安装入口会检测Chrome，缺少时尝试winget的用户级Google.Chrome.EXE；没有winget或受策略限制时明确返回needs_action，不伪装成功。Browser Harness依赖随Jev安装，不要求安装额外Chrome扩展。用户需在chrome://inspect/#remote-debugging手动启用调试、批准Allow并完成Microsoft登录。`-SkipBrowserCheck` 可先完成软件安装；`-SkipChromeInstall` 跳过Chrome安装。

输出含configured、environment.reused、browser.ready、browser.chrome.status和实际模板文件路径。configured只表示软件配置完成；browser.ready不为true时不能开始发问。doctor不读取Microsoft登录，仍须在start后核对专用页面。

安装会生成各宿主MCP模板，按宿主支持的方式导入；不自动覆盖其他服务器配置。原生Claude/GitHub插件启动器会读取安装器保存的launcher.json，从而找到用户目录的Node。MCP初始化只读配置和发现工具，不在握手阶段安装软件或打开浏览器。

技能可通过宿主插件加载；若手动复制，用 `-InstallSkills -Target <具体宿主>`，WorkBuddy需显式 `-SkillsDir`。已有技能不覆盖，避免重复安装。切换宿主时先暂停并断开旧研究，再接续相同runFile。

失败后保留缓存、既有运行时和研究记录。下载失败可重跑；已有未知不完整目录或install.lock时停止并报告，不为抢占而删除原目录/未知锁。UV安装使用官方锁文件；未知Jev源码指纹不会自动获得旧版本的StalePage重试资格。
