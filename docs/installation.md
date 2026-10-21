# 安装与使用

本包 v0.9.0 提供 Windows 图形离线安装程序、自动环境准备、标准本地 MCP 和两个 Skill，并提供 Codex、Claude Code、GitHub Copilot CLI 的插件清单。WorkBuddy、DSH、QwenWork、VS Code 使用各自支持的 MCP/Skill 接入。实际验证范围与官方依据见 [兼容性说明](compatibility.md)。

## 图形安装（无需命令行）

1. 把 `CopilotDiscussion-0.9.0-Setup-win-x64.exe` 复制到目标 Windows 10 / 11 x64 电脑，双击运行。无需预装 Node、Python、uv、Git 或 Jev 技能；系统需具备 Windows 自带的 .NET Framework 4.8 和 Windows PowerShell 5.1。
2. 选择专用安装目录和研究工作区，主持宿主默认“自动检测并接入已安装宿主”。选中具体宿主时，下方“宿主安装说明”立即显示对应步骤；也可用“查看步骤”单独浏览七个宿主，不改变安装目标。说明内置EXE，可在安装前离线阅读。保留自动合并MCP与两个技能选项，点击“开始安装”。已有可用Jev环境复用，新机从随包文件离线补齐。
3. 缺少 Chrome 时可安装随包的 Google 官方原始安装包，已有浏览器直接复用。Chrome 遵循其原始条款；企业策略可能需要管理员协助。向导不会绕过策略。
4. 完成后点击“使用指南”，逐宿主查看MCP、技能、耗时和待处理状态。指南默认显示本次宿主的详细步骤，内置下拉框也可切换其他宿主。已自动接入的宿主无需复制配置，重新加载即可。QwenWork需一次界面MCP导入，DSH需按profile接入overlay；冲突、未知位置、定制技能保留原样并提示。详见 [逐宿主步骤](host-setup.md) 与 [自动接入与回滚](automatic-hosts.md)。
5. 在 Chrome 打开 `chrome://inspect/#remote-debugging`，启用远程调试；点击向导“授权检查”，批准 Chrome 的 Allow。打开 Microsoft 365 Copilot，由你完成登录。
6. 在已连接的宿主中调用 `discussion_doctor`，然后开始研究。宿主客户端、账号、订阅和工具权限由宿主提供；必要的宿主信任确认不会被静默接受。向导“撤销接入”按校验恢复本次改动，保留后续用户修改和研究工作区。

完整 EXE 是离线安装包，包含 Node 24.22.0、uv 0.13.4、Python 3.12.15（独立可迁移发行版）、固定提交 Jev、15 个锁定 Windows 依赖和 Chrome 155.0.8059.85 官方安装包。包中不包含本机配置、密钥、浏览器资料、登录状态或历史研究。Python 虚拟环境会在目标电脑新建，使用随包 wheels 和哈希锁强制离线安装，不借用构建机缓存；不会自动转为联网下载。

安装目录结构：

```text
CopilotDiscussion/
├─ versions/0.9.0-host-guide.1/
│  ├─ CopilotDiscussion.exe          后续配置与授权检查界面
│  ├─ product/                      完整插件、技能、文档、构建源码
│  ├─ tools/{node,uv,python}/        独立运行时及原许可
│  ├─ jev/、wheels/、packages/       固定来源和离线依赖
│  └─ bundle.json、notices/          文件校验、来源和第三方许可
├─ data/runtimes/                    目标电脑新建的 Jev 虚拟环境
├─ profiles/<时间>/                  MCP配置、开始使用.html、安装报告
└─ setup-state.json                  最近一次安装状态与阶段耗时
```

用户配置仍在 `~/.copilot-discussion/`，研究保存在所选工作区 `output/research-runs/`。在另一电脑运行安装程序重新生成路径，不能直接复制旧 MCP 模板。单独的 `CopilotDiscussion-0.9.0-Plugin.zip` 用于支持本地插件/技能导入的宿主；它不包含大型运行时。宿主说明修订包位于 `output/releases/v090-host-guide/`，GitHub标记为 `v0.9.0-preview.2`；原预览包仍保留在 `v0.9.0-preview`。修订包使用独立产品目录，已有运行环境可复用，避免继续读取旧版说明。生成的开始菜单入口可重开向导和使用指南。宿主接入登记与备份仅保存在本机 `~/.copilot-discussion/host-integrations/`。

当前交付为未签名测试包。普通环境可能显示未知发布者；启用 Smart App Control 或企业代码完整性策略的电脑可能直接阻止启动。此前v0.8最终包已经遇到 `VerifiedAndReputableDesktop` 策略拦截；v0.9不改变信任状态，不能保证换一台电脑即可运行。正式分发应使用受信任签名渠道对安装程序和管理器签名，并在目标策略下复验；不要求关闭安全策略或安装自签名根证书。签名构建步骤见下方构建说明及 [Microsoft 官方要求](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)。SHA256用于文件完整性，不能替代签名。Google 原始安装包签名保持不变。

软件离线安装不代表研究可离线进行：免费资料检索、宿主服务和 Copilot 网页仍需联网。其他宿主只核查官方接口，实际客户端是否支持界面导入以其当前版本为准。

打包源码与复现方法见 [installer/README.md](../installer/README.md)。

## 1. 首次安装：自动检测、复用与补齐

在本项目根目录执行；不要求预装Node、Python、uv或Jev技能：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Target all
```

工作区默认是当前目录；可加 `-Workspace 'D:\research-workspace'`。只拿到插件目录时，直接调用其中 `skills/copilot-discussion/scripts/bootstrap.ps1`，参数相同。宿主需要能执行Windows本地脚本及访问下载来源；云端、WSL、容器里的进程不能直接控制这台Windows的Chrome。

安装按以下顺序执行：

1. 复用可用的Node20+；缺少时下载SHA256校验的独立Node，不改全局PATH。
2. 从本插件配置、显式RuntimeRoot、JEV_ULTRAFAST_ROOT或管理目录寻找Jev，导入和依赖检查通过就复用。不会扫描整块磁盘或读取其他Agent的凭据。
3. 缺少环境时，准备独立uv、托管Python3.12、固定提交的Jev及锁文件中的运行依赖；不需要Git、管理员权限或系统Python Launcher。
4. 检测Chrome；缺少时尝试winget的用户级Google.Chrome.EXE安装。winget缺失、权限/组织策略阻止时返回needs_action及手动步骤，不把未就绪浏览器当作通过。
5. 生成本机配置和各宿主MCP模板，检查Chrome连接。用户手动启用远程调试、批准Allow并登录Microsoft。

默认依赖目录为 `%LOCALAPPDATA%\CopilotDiscussion`，包含tools、python、runtimes、cache/downloads；配置位于 `~/.copilot-discussion/`，研究与安装产物仍在工作区output。配置保存直接Python解释器路径，运行时不再强制依赖py.exe或uv模块。下载过程使用Windows代理和证书配置；不会关闭证书校验或修改系统执行策略。命令中的ExecutionPolicy只作用于本次PowerShell进程，组织策略仍可能阻止脚本。

Chrome使用 [Browser Harness官方连接流程](https://github.com/browser-use/browser-harness/blob/main/install.md)：在 `chrome://inspect/#remote-debugging` 启用远程调试，随后批准Chrome Allow。本流程不需要另装Chrome扩展；Browser Harness随Jev依赖安装，录像保持关闭，Microsoft登录由用户完成。

安装输出区分configured、environment.reused、browser.chrome.status和browser.ready。configured成功不代表Chrome授权或登录完成。默认研究不调用Jev远程决策模型，也不需要Jev API Key；实验入口见 [决策对照说明](../plugins/copilot-discussion/skills/copilot-discussion/references/decision-benchmark.md)。

### 宿主没有安装 Jev Skill 时

本包不依赖宿主预先安装 `jev-browser-use` 或 `jev-ultrafast-native` Skill；MCP服务器直接调用本机 Jev Python 运行时。Skill是给Agent阅读的操作说明，运行时才提供实际浏览器能力，仅复制Skill不能补齐运行环境。

- 同一Windows用户、同一台机器切换到其他宿主：可复用已有Jev runtime、Browser Harness和配置；接入本包的MCP及两个Skill即可。运行MCP的用户或环境不同时，应重新指定可访问的路径。
- 全新机器没有Jev runtime：执行上面的install.ps1，自动准备运行环境。仍保留Chrome调试授权与Microsoft登录步骤。
- 安装后先调用discussion_doctor核对本地依赖，再用Native合成测试检查Chrome动作。doctor通过不等于浏览器权限和登录已完成。

默认是“Jev Native执行模式”：Jev执行真实观测、输入和点击，研究选题、分析回答和下一问由宿主Agent决定。填入、提交、等待和采集封装到工具内部。决策模型仅有显式付费实验入口，不自动用于正常研究，不能通过往普通配置填API Key来开启。

## 2. 高级安装与本机配置

已有Node时也可直接运行setup；它同样自动检查和补齐Jev。显式runtime-root用于复用特定环境，省略时自动发现或安装到管理目录：

```powershell
$DiscussionPlugin = (Resolve-Path '.\plugins\copilot-discussion').Path
$DiscussionWorkspace = (Get-Location).Path
node "$DiscussionPlugin\skills\copilot-discussion\scripts\setup.mjs" `
  --workspace "$DiscussionWorkspace" `
  --target all
```

安装器创建用户目录 `~/.copilot-discussion/config.json`，将各宿主模板、本机说明、环境检测与阶段时间写入 `output/installations/<时间>/`。同一环境的旧配置可自动补入已验证的解释器路径；其他不同配置不覆盖，更新时显式 `--replace`，或选择新的 `--config`。不会自动合并/覆盖其他Agent全局设置。`launcher.json`仅记录本机Node路径，供原生插件启动器发现，不存密钥。

常用选项：`-NoInstall`仅检查复用，`-RuntimeRoot`指定已有/新的绝对目录，`-DataDir`改变依赖目录，`-SkipBrowserCheck`先完成软件安装，`-SkipChromeInstall`跳过Chrome安装，`-Config`/`-Output`指定配置和模板目录。`-Isolated -ForceManagedNode`用于明确验证全新安装路径，常规安装无需使用。Node入口使用 `--runtime-root`、`--data-dir`、`--no-install` 等参数，显式 `--check-browser` 才连接Chrome；ForceManagedNode仅PowerShell入口支持。`--configure-only`只生成配置、不保证依赖可用。

配置内容示例，路径需替换；Windows JSON 反斜杠须双写：

```json
{
  "schemaVersion": 1,
  "workspaceDir": "D:\\research-workspace",
  "native": {
    "runtimeRoot": "C:\\tools\\jev-ultrafast",
    "pythonExecutable": "C:\\tools\\jev-ultrafast\\.venv\\Scripts\\python.exe",
    "pythonLauncher": "py",
    "cdpUrl": "http://127.0.0.1:9222"
  },
  "collection": { "initialWaitMs": 10000, "sliceMs": 10000, "windowMs": 600000 }
}
```

`pythonExecutable`由安装器检测保存，优先直接启动解释器。`pythonLauncher`仅用于兼容旧配置，其参数对应py/py.exe，可用 `--python-launcher` 填绝对路径。CDP仅接受 `http://127.0.0.1:<端口>`。配置不保存API Key/Token，安装器也不接收这些参数。

配置选择优先级：服务器 `--config`、环境变量 `COPILOT_DISCUSSION_CONFIG`、默认用户配置。工作区优先级：服务器 `--workspace`、`COPILOT_DISCUSSION_WORKSPACE`、配置文件。`JEV_ULTRAFAST_ROOT`、`JEV_PYTHON_EXECUTABLE`、`JEV_PYTHON_LAUNCHER`、`JEV_CDP_URL`可覆盖非秘密字段。常规安装使用生成的显式配置即可。

## 3. 接入宿主

**完整EXE用户先看 [七个宿主的逐步操作指南](host-setup.md)。** 每节都列出自动接入后如何重新加载、确认服务器/技能、调用doctor，以及需手动导入时应使用哪个本机模板。QwenWork、DSH及自定义profile的额外步骤单独说明。下面保留手动备用和高级插件路线；向导已自动接入成功时，无需重复注册。

以下只选择正在使用的宿主。所有生成模板都使用 Node、服务器及配置的绝对路径；移动/更新插件位置后重新生成，避免模板仍指向旧目录。保留源目录，不把其他机器的模板原封不动复制过来。

### Codex

本工作区已经提供本地来源，CLI 注册/更新：

```powershell
codex plugin marketplace add .
codex plugin add copilot-discussion@copilot-training-local
```

刷新插件或重开任务使技能重载。若要标准 MCP 工具，将生成的 `codex.toml` 片段合入自己的 Codex 配置；或使用 CLI 支持的 `codex mcp add copilot-discussion -- <Node绝对路径> <服务器绝对路径> --config <配置绝对路径>`。不覆盖其他服务器。只使用技能时也可走保留的持久脚本入口。

### Claude Code

原生插件可在 Claude Code 内用 `/plugin marketplace add <本项目绝对根目录>`，再 `/plugin install copilot-discussion@copilot-training-local`。临时加载可用 `claude --plugin-dir <plugins/copilot-discussion绝对目录>`。

插件启用配置提供 `config_file`（安装配置绝对路径，空值使用默认位置）、`node_command`（默认 node，可填 node.exe 绝对路径）。服务器脚本使用 `CLAUDE_PLUGIN_ROOT` 跟随插件位置。

若该客户端版本不支持清单的用户配置，使用标准 MCP：将生成 `mcp.json` 中 `mcpServers.copilot-discussion` 的**单个服务器对象**导入 `claude mcp add-json copilot-discussion '<JSON对象>'`，并安装两个 Skill。不要将整个 mcpServers 外层当服务器对象传给该命令。

### WorkBuddy

在支持自定义本地 MCP 的设置中导入生成的 `mcp.json`，确认 STDIO、command、args 均来自本机模板。通过 Skill 导入功能导入源包 `skills/copilot-discussion` 和 `skills/research-topics` 两个完整目录，保留辅助文件。

若使用脚本复制技能，显式给出 WorkBuddy 当前版本实际使用的 `--skills-dir`，本安装器不猜该目录。这里提供的是本地 MCP+Skill，不是已上架 WorkBuddy 市场的连接器。

### DSH（DeepSeek Harness）

在自己的 overlay 中加入生成 `dsh.yaml` 的一个条目，插件名为 `@deepseek-ai/dsh-mcp-client`。该文件是 overlay 片段，不是 DSH 原生插件包。按照官方文档启用文件系统 Skill 能力，将技能置于 `~/.dsh/skills` 或项目 `.dsh/skills`，也可显式指定 customSkillDirs。

DSH 会探测并重启 MCP 进程；本服务器初始化不启动 Chrome，不创建研究。不要在探测时发送测试问题。

### QwenWork 桌面

在“扩展 → 连接器 → 添加”中粘贴生成 `mcp.json`，选择本地 STDIO；命令及参数使用本机绝对路径。按客户端提示重开任务。

通过技能导入功能导入两个完整技能目录，或复制到 `~/.qwenworkcn/skills`。本机 Native 功能适用于 Windows 桌面连接器；QwenWork 云端网页任务不能直接访问本机 Chrome。

### GitHub Copilot CLI

原生插件路线：`copilot plugin install <plugins/copilot-discussion绝对目录>`。本包根 `plugin.json` 与 `mcp.json` 采用 Agent Plugins 1.0；首次执行bootstrap后，启动器可复用PATH的Node或安装器记录的Node路径，并使用默认配置或 `COPILOT_DISCUSSION_CONFIG`。MCP握手期间不自动安装依赖。

独立 MCP 路线：把生成 `github-copilot.json` 的条目合入 `~/.copilot/mcp-config.json`（使用 COPILOT_HOME 时按实际位置），保留其他服务器；也可用 `copilot mcp add copilot-discussion -- <Node> <服务器> --config <配置>`。模板含 `tools:["*"]`，仍遵守客户端实际工具权限。

Skills 可放项目 `.github/skills`，或个人 `~/.copilot/skills`。安装两个完整目录；启用 Agent 模式并允许所需工具，主持讨论对象为 Microsoft 365 Copilot 网页。

### VS Code GitHub Copilot

将生成 `vscode-mcp.json` 的 `servers` 对象合入本地 Windows 项目 `.vscode/mcp.json`，启动并信任该服务器。在 Agent 模式加载两个 Skill，项目目录可用 `.github/skills`。

确认 MCP 子进程运行在 Windows 本机。WSL、容器、Remote SSH 或云端 coding agent 不能直接使用此 Windows Chrome，当前版本未实现跨机器桥接。

### 可选：脚本安装 Skills

将 `--target all` 改为具体宿主，再加 `--install-skills`：codex、claude-code、dsh、qwenwork、github-copilot、vscode 都有已核实的个人技能目录。也可用 `--skills-dir <绝对目录>` 指定项目目录。workbuddy/generic/all 必须显式提供 skills-dir。

本节的命令行 `setup.mjs --install-skills` 只复制到不存在的技能目录，已有目录会保留；它与图形安装器的所有权登记/增量合并流程不同。图形安装器的结果见 [自动接入与回滚](automatic-hosts.md)。已自动接入或通过原生插件加载时，无需再复制一套技能或重复注册。

## 4. 验证与开始讨论

检查本地前提，不打开 Chrome：

```powershell
node "$DiscussionPlugin\skills\copilot-discussion\scripts\setup.mjs" --check
```

使用自定义配置时加 `--config <实际路径>`。连接 MCP 后应能发现11个 `discussion_*` 工具，先调用 `discussion_doctor`；ready 表示本地依赖通过，浏览器授权/登录仍需启动时检查。可对 Agent 说：

> 用 copilot-discussion，从免费公开资料自主选一个值得深入研究的问题，与 Microsoft 365 Copilot 持续讨论，不限制轮数。先登记开始时间，再检索；每轮阅读实际回答后只追问新增争点，最后给我结论、分歧、完整记录和分阶段实际耗时。

宿主按照技能依次 init → 搜索/选题 → select → start → ask/result → evidence → finish/verify。公开资料检索、选题与下一问由当前宿主完成；MCP 后台只持续采集。关闭 Agent 后不会独立生成问题。

跨 Agent 接续：原宿主 pause 并断开；新宿主配置相同工作区，读取 `run.json`、topics 和完整问答，检查 status，再 resume 同一 runFile。已有 pending 只读不重发。不要同时使用两个宿主控制同一研究。

## 5. 文件与计时

研究集中在 `output/research-runs/<run-id>/`：候选、来源与证据纠正、逐轮精确 requests/responses、权威 session、追加计时日志、完整问答、report、timing、manifest。安装模板集中在 `output/installations/`；源代码、宿主清单、说明与测试分别放在 plugins、隐藏清单目录、docs、tests。原 `copilot/` 和已有研究记录保持原样。

`maxRounds:null` 表示无预设轮数上限；单次工具请求和采集窗口仍有界。MCP 默认先等10秒，后续后台以10秒窗口采集；result 单次最多20秒。底层浏览器启动和动作仍可能受 Chrome/网络影响，不能保证每次工具调用都在固定秒数内结束。

计时从 init 开始，覆盖选题准备、发送前、提交至保存、轮间主持与总结导出。Jev动作和 worker 启动是阶段内子项，不能重复相加。提交至保存包含网页/网络/采集等待；不能称纯模型生成耗时。不同题目运行不能直接推导整体加速倍数。

## 6. 测试与排查

```powershell
node --test .\plugins\copilot-discussion\tests\*.test.mjs
py -3.12 -m unittest discover -s .\plugins\copilot-discussion\tests -p 'test_*.py'
py -3.12 -m uv run --with mcp==2.3.0 python .\plugins\copilot-discussion\tests\mcp_sdk_smoke.py
```

上面是离线/协议测试，不操作 Copilot。SDK 测试可用 `--node <绝对node.exe>`。`tests/native-live-smoke.mjs` 是显式本地 Chrome 合成验证，需先配置 Native，不调用 Copilot 或模型：

```powershell
node .\plugins\copilot-discussion\tests\native-live-smoke.mjs
```

- 找不到 Node/Python：用安装器记录的绝对程序路径；Python 参数对应 py.exe，不是任意 python.exe。
- 工具列表为空：确认启动的是 mcp-server.mjs；旧 research-server.mjs 的 JSON 行协议不能当 MCP。
- 路径移动：重新生成配置；插件缓存和工作区输出不应混放。
- Chrome Allow/登录：由用户完成后 bind 原专用标签页；不重复 start。
- pending/工具超时：先 result/status，已提交消息不重发；未发送草稿才可 recover-draft/submit。
- lock或并发控制：先停止另一宿主、确认原进程状态；不要为抢占而删除未知锁或重发问题。
- runtime升级：重新 doctor/合成验证；未知源码指纹不会启用基于旧版本审计的 StalePage 重试。

所有接入路径与核查来源见 [兼容性说明](compatibility.md)，工具字段及恢复步骤见 [MCP 工作流](../plugins/copilot-discussion/skills/copilot-discussion/references/mcp-workflow.md)。
