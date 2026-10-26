# 首次安装与环境修复

适用于Windows本机的所有宿主。宿主不需要预装Jev Skill；本包附带执行适配。当前推荐npm/npx入口，先确认Node20+和npm可用。用户已全局安装时直接运行 `copilot-discussion.cmd setup`；缺少时使用下面的固定发布包，不猜测尚未发布的npm仓库包名：

```powershell
npx.cmd --yes "https://github.com/qiluoli-usc/copilot-discussion/releases/download/v0.10.0-preview.1/copilot-discussion-0.10.0-preview.1.tgz" setup
```

安装器检测宿主并准备MCP与完整技能，QwenWork需一次界面导入、DSH需加载实际profile的overlay；以本机“开始使用.html”的逐宿主结果为准。按需补齐Jev、uv、托管Python，不要求Jev API Key。将末尾setup换成doctor、repair、update、uninstall可完成维护；全局安装可直接使用同名短命令。产品复制到固定用户数据目录，不能让MCP引用会被清理的npx缓存。卸载保留研究与共享依赖，人工修改项保留并报告；手动导入的连接先在宿主移除，再用uninstall --manual-disconnected完成。

Chrome远程调试、Allow、Microsoft登录及宿主信任提示仍由用户完成；不能把软件安装成功当作已获浏览器授权。运行doctor --browser前说明会尝试连接Chrome，但不发送研究问题。npx包本身不会在npm安装钩子或MCP握手中下载依赖。

若Node/npm尚不可用，可先按官方方式安装Node.js LTS并重开终端。宿主只有技能文件或需要旧入口时，以下自带脚本保留为备用；在线安装需要网络和本地脚本执行能力，组织策略或浏览器授权可能需要用户操作。

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
