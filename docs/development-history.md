> 本文为 v0.9.0 时期的历史记录；当前安装请使用 [npm/npx 安装说明](installation.md)。

# Copilot 主题讨论工作区

由当前 Agent 从免费公开资料选题、主持 Microsoft 365 Copilot 网页持续追问，自动保存完整原始问答、证据纠正、讨论结论及实际耗时。Jev Native 执行真实浏览器动作，当前宿主负责思考，无需额外 Jev 决策 API Key。

当前 v0.9.0 提供可双击的 Windows x64 离线安装程序、首次环境准备与复用、宿主检测、MCP增量合并和两个研究技能的自动接入。保留原有设置，改动前备份，可从向导撤销。支持范围与例外见 [自动接入](automatic-hosts.md)；GitHub Copilot可作为主持Agent，讨论对象仍是Microsoft 365 Copilot。

## 安装入口

推荐使用 `CopilotDiscussion-0.9.0-Setup-win-x64.exe`，下载见 [v0.9.0公开预览修订包](https://github.com/qiluoli-usc/copilot-discussion/releases/tag/v0.9.0-preview.3)。修订包内置七宿主逐步说明：安装前选主持宿主即可同步查看，自动检测模式下也能分别阅读，安装后的指南保留相同步骤；无需单独下载HTML。完整EXE含Node、uv、独立Python、Jev、15个锁定依赖和官方Chrome安装包，全新Windows x64无需预装Jev Native或Jev技能。默认自动检测宿主并增量配置；已有可用环境优先复用。修订标识 `host-guide.2`，产物位于 `output/releases/v090-host-guide-fix/`；原 `v090/` 与v0.8交付保留。

Codex、Claude Code、GitHub Copilot CLI、VS Code默认用户配置可自动接入；WorkBuddy使用已发现的配置/技能目录。QwenWork需一次界面MCP导入，DSH需按实际profile接入overlay，均明确报告待处理。安装包不含宿主客户端和账号，不代替宿主的信任提示、组织策略或登录。Chrome远程调试、Allow与Microsoft登录由用户完成。运行研究需要联网。

当前仍是未签名预览包；此前v0.8最终包已被本机Windows Smart App Control拦截。v0.9不改变Windows信任状态，不关闭策略；受控电脑需要受信任签名及目标策略下复验，不能保证直接启动。详见 [安装说明](installation.md)。

仍保留脚本入口供高级使用；已有Node、Python、Jev会复用，缺少时自动准备用户目录内的环境，无需先安装Jev技能：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Target all
```

默认依赖在 `%LOCALAPPDATA%\CopilotDiscussion`，配置在 `~/.copilot-discussion/`，各宿主模板和环境/计时记录在 `output/installations/<时间>/`。下载的Node/uv/Jev固定版本并校验SHA256，Python与依赖由uv锁定安装。安装器不接收密钥、不改全局PATH或其他Agent设置。缺少Chrome时尝试用户级winget安装；授权或策略阻碍会明确报告。Chrome Allow、远程调试开关及Microsoft登录由用户完成。按 [安装说明](installation.md) 导入宿主配置；运行环境仍限Windows本机。

## 使用

可以直接说：

> 用 Jev Native，从免费公开资料自主选题，与 Copilot 持续讨论，不限制轮数，最后给我结论、分歧、完整记录和实际耗时。

当前任务中的主持模型会实际阅读每轮回答后再决定下一问。没有后台独立模型；关闭任务后不会继续生成追问。普通任务未指定轮数默认最多 8 轮，固定轮数支持 1～30；明确不限轮数时设 `maxRounds: null`，按证据增量及研究目标收束。

运行使用Windows本机Chrome，安装器准备本地Node、Python、Jev和Browser Harness。首次Chrome Allow或Microsoft登录由用户完成。默认Native不使用CUA、Edge、截图、录像或额外模型API Key。

## 目录

```text
copilot-training/
├─ README.md
├─ install.ps1                       首次检测、复用、自动安装入口
├─ installer/                        图形向导源码、依赖锁、可复现打包脚本
├─ docs/                             兼容性核查、安装使用说明
├─ .agents/plugins/marketplace.json   Codex本地插件来源
├─ .claude-plugin/marketplace.json    Claude Code本地插件来源
├─ .codex/config.toml                本项目启用设置
├─ plugins/copilot-discussion/
│  ├─ plugin.json、mcp.json            Agent Plugins 1.0，当前 v0.9.0
│  ├─ .codex-plugin/plugin.json        Codex技能清单
│  ├─ .claude-plugin/plugin.json       Claude插件与安装配置
│  ├─ skills/copilot-discussion/       主持、执行、记录和计时
│  │  ├─ SKILL.md
│  │  ├─ references/                  MCP、脚本、Native与CUA流程
│  │  └─ scripts/                     MCP服务、bootstrap、下载锁、统一运行器、Jev执行器
│  ├─ skills/research-topics/          免费原始资料选题
│  └─ tests/                          离线保护测试与显式 Native 联调
├─ copilot/                           原 DeepSeek + Playwright 项目
└─ output/
   ├─ research-runs/<run-id>/         一次研究的全部交付
   ├─ installations/                 本机配置模板及跨宿主验证
   ├─ releases/v090-host-guide-fix/  修复GUI启动的v0.9.0 preview.3
   ├─ releases/v090-host-guide/      保留preview.2原交付与故障记录
   ├─ releases/v090/                 保留原v0.9.0预览包
   ├─ releases/v080/                 保留的上一版交付
   ├─ builds/installer/              可复现构建的中间文件
   ├─ performance/v040/、v050/、v070/  历史瓶颈分析与决策实验（含失败）
   ├─ copilot-discussion/              旧版会话记录
   ├─ native-validation/              早期 Native 联调
   └─ research-topics/                独立选题记录
```

原项目说明见 [copilot/README.md](../copilot/README.md)。旧研究记录保持原样，不为升级迁移或覆盖。

## 统一研究入口

标准入口见 [MCP工作流](../plugins/copilot-discussion/skills/copilot-discussion/references/mcp-workflow.md)。提供11个工具：doctor、init、select、start、ask、result、control、evidence、finish、verify、artifact，均以 `discussion_` 为前缀。先登记运行开始，再选题取证；来源与候选一次保存。每问自动保存请求和响应，追问须基于最新一轮并记录推进点。结束时自动校验并导出。

MCP的ask默认首段等待10秒后返回，后台持续采集；result单次最多等20秒，pending继续读取，不能重复发送。跨Agent接续使用相同工作区与runFile，先暂停并断开旧宿主，再读取完整记录和恢复；一个研究同时只由一个宿主控制。MCP后台不生成新问题。

## 保留的脚本入口

没有MCP时可使用 [脚本研究流程](../plugins/copilot-discussion/skills/copilot-discussion/references/research-workflow.md)。持久标准输入输出入口启动后保留可写stdin（Codex exec工具需 `tty: true`），逐条发送JSON行；它不是MCP协议：

```powershell
node .\plugins\copilot-discussion\skills\copilot-discussion\scripts\research-server.mjs
```

命令包括 `init`、`select`、`start`、`ask`、`collect`、`watch`、`recover-draft`、`submit`、`evidence`、`finish`、`verify`、`pause`、`quit`。每条消息包含 id、command、request；同一进程复用一个 Jev worker。ask 默认15秒首段等待后自动分段持续采集，默认10分钟窗口结束仍保留 pending，可继续 watch；pause/quit 会中止续读。宿主普通 Node 环境也可直接使用 `ResearchRun.watch()`；受限 REPL 使用标准输入输出入口。

每轮默认只讨论新增争点，回答目标约450字；必要推导可单轮 expanded，原答始终完整保存。未发送草稿失败时自动检查原页面、消息基线与输入框；只有空白或精确原草稿才恢复，额外填入最多两次。已经写入发送标记的消息只续读，不重发。每次成功输入与点击记录实际 Jev Browser.act 回执，启动记录导入模块的源码指纹。

兼容入口 `research-cli.mjs <command> <request.json>` 每条命令启动一次 worker；`native-cli.mjs` 保留旧版底层浏览器命令。恢复时 `open` 原 run.json，再检查状态与 pending；暂停保留网页，超时只 collect，不重发。

每次运行结构：

```text
<run-id>/
├─ run.json、topics.json、evidence.json
├─ requests/、responses/             每轮精确请求与实际响应
├─ transcript/
│  ├─ session.json、session.md       权威状态与可重建记录
│  ├─ session.events.jsonl           追加的浏览器/worker计时
│  └─ full-record.md、complete.json  完整导出
├─ events.jsonl                     命令状态与时间
└─ report.md、timing.json/md、manifest.json、README.md
```

`finish` 记录主持结论、分歧、证据不足和停止原因，核对每轮请求、响应、权威记录一致后导出。重新 export 保留原结束时间。复制记录时同时保留 JSONL；旧版内嵌计时仍兼容。

## 速度与验证

v0.9.0 host-guide.2（preview.3）修复宿主说明的.NET数组类型转换，新增真实WinForms回归。75项Node、11项Python通过；最终EXE的启动/七宿主切换自检、完整隔离离线试装及安装后管理器启动均通过。完整试装17.498秒，未改个人宿主配置或安全设置，未调用浏览器/模型。详见 [修复验证](../output/installations/v090-host-guide-fix/validation.md)。前一修订的编译和JavaScript测试未覆盖该GUI运行错误，保留原记录并更正于此。

v0.9.0 的 host-guide.1 修订包（preview.2）已内置七宿主步骤，安装前随宿主选择展示，安装后的指南也能切换查看。74项Node检查、最终PE内嵌资源检查与实际安装模板的MCP检查通过。隔离后端离线安装12.558秒，配置夹具接入2.593秒，重复0改动、回滚原字节一致；最终未签名EXE未启动。详见 [修订包验证](../output/installations/v090-host-guide/validation.md)。

v0.9.0增加宿主检测、MCP增量合并、两个完整技能的接入与回滚。69项Node、11项Python、两个技能格式检查通过。最终发布payload在新目录完成后端离线准备7.750秒；五类宿主配置夹具接入完整技能5.182秒，重复接入0改动，撤销后原字节一致。实际安装配置通过官方MCP SDK的11工具检查。未启动所有宿主客户端，最终未签名EXE未运行；时间不含EXE展开与用户授权。详见 [v0.9验证记录](../output/installations/v090/validation.md) 与 [自动接入范围](automatic-hosts.md)。

v0.8.0新增图形离线安装程序。59项Node、11项Python和两个Skill格式通过；候选EXE全新目录试装19.798秒，实际MCP和Native两轮合成通过。最终未签名EXE受到Windows Smart App Control拦截，加入签名构建与准确状态说明后未再尝试未签名启动，详见 [v0.8.0验证与限制](../output/installations/v080/validation.md)。

v0.7.0已在本机Codex启用，56项Node、11项Python测试通过。隔离首次安装96.489秒，复用并检查浏览器2.890秒；原生插件启动器通过官方MCP SDK验证。决策模型实验做了两次真实付费请求；第二次返回BLOCKED、置信度0.34，依用户条件停止，没有执行真实Copilot对照。当前不足以判断整体加速，保持默认执行模式，见 [实验记录](../output/performance/v070/decision-comparison.md) 和 [安装验证](../output/installations/v070/validation.md)。

历史v0.6.0通过51项Node、7项Python测试、两个Skill格式校验、官方MCP SDK互通及Agent Plugins清单schema校验。当次Native合成两轮约6.55秒，验证实际Jev执行与断线接续；未向Copilot发送新问题，不能作为完整讨论测速。其他客户端只核查接口并生成模板，详见 [v0.6.0验证记录](../output/installations/v060/validation.md)。

12 轮历史运行中，浏览器调用约占总耗时 1.91%；后续制造业6轮运行中约0.87%，另有未发送草稿故障恢复耗时约3分51秒。v0.4.0 已改进 worker 复用、计时追加写入与自动归档，v0.5.0 继续处理草稿恢复、自动续读和重复讨论。提交至保存仍含 Copilot、网络、页面与轮询，不能称纯生成耗时。不同问题、回答长度及主持工作不能推导整体加速倍数。Jev 决策模型主要选择机械控件动作，是否带来整体收益须做匹配实测，不能与主持追问模型混同。

历史分析及受控结果见 [v0.4.0 优化报告](../output/performance/v040/optimization.md)。新计时额外记录 worker 启动与复用；旧记录没有的数据保持未知。结合旧运行边界分析：

v0.5.0 制造业与AI完整实测9轮、无轮数上限，重跑耗时10分15.477秒；包含前置失败联调与修复的验证窗口为14分9.609秒。9轮均自动续读，共18条Jev执行回执；分阶段比较与局限见 [v0.5.0 优化报告](../output/performance/v050/optimization.md)，[完整讨论](../output/research-runs/2026-10-21T01-38-43-684Z_8f8a268f/report.md)。来源复用与回答长度等不同，不能由此推导受控加速倍数。

```powershell
node .\plugins\copilot-discussion\skills\copilot-discussion\scripts\metrics.mjs "会话.json" --run="run.json" --output="新的报告.json"
```

离线测试不向 Copilot 发消息：

```powershell
node --test .\plugins\copilot-discussion\tests\*.test.mjs
py -3.12 -m unittest discover -s .\plugins\copilot-discussion\tests -p 'test_*.py'
py -3.12 -m uv run --with mcp==2.3.0 python .\plugins\copilot-discussion\tests\mcp_sdk_smoke.py
```

`tests/native-live-smoke.mjs` 为显式本地合成网页验证；`tests/native-performance.mjs` 为同负载 IO 和合成控件对照，需要明确提供旧插件目录、源记录与新输出目录。合成测试不调用模型，不能当作 Copilot 整体测速。

## 本地插件

本工作区已提供Codex本地来源及项目启用配置。插件内容更新后重新安装该本地插件，并让宿主重新加载技能；当前聊天仍可直接读取工作区中的技能。注册来源：

```powershell
codex plugin marketplace add .
codex plugin add copilot-discussion@copilot-training-local
```

安装与缓存规则以 [OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins) 及本机 CLI 实际支持为准。只更新本插件，不改其他插件、账号或凭据设置。
