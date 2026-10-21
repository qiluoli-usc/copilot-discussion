# MCP 持续研究流程

服务器为 `scripts/mcp-server.mjs`，标准本地 stdio / JSON-RPC 2.0。仅开放工具和服务器说明，不提供 HTTP/SSE、提示模板或资源接口。宿主负责启动进程和协议握手；不要把旧 `research-server.mjs` 的 JSON 行命令发送给 MCP 入口。

## 安装与边界

首次按 [自动安装](installation.md) 运行scripts/bootstrap.ps1，自动准备缺失环境；已有Node可用setup.mjs。配置绝对工作区、Jev、直接Python解释器和本机Chrome。默认配置是用户目录 `/.copilot-discussion/config.json`，可用服务器--config或COPILOT_DISCUSSION_CONFIG指向其他位置。安装程序生成各宿主配置，通用启动形式：

```text
<node绝对路径> <mcp-server.mjs绝对路径> --config <config.json绝对路径>
```

本版是 Windows 本机 Jev 执行器，无 Jev 决策 API 或密钥参数。工作区由安装配置决定，研究记录只允许在该工作区 `output/research-runs/` 下，不能通过 runFile 读取其他工作区。MCP 初始化及工具发现不会打开浏览器；`discussion_doctor` 也只检查安装前提。

## 工具顺序

1. `discussion_doctor {}`：检查 Windows、Node、Python/uv 和 Jev 文件。ready 不代表已验证 Chrome 登录。
2. `discussion_init`：**在搜索前**登记开始时间，例如 `{"maxRounds":null,"stopCriteria":["主要争点得到反方复核，剩余问题须依赖新实验"]}`。null 仅在用户明确不限轮数时使用；未指定默认8轮。保留返回的真实 `runFile`。
3. 用宿主网页搜索阅读免费原始资料，比较约3个方向；有指定主题可只登记该主题。
4. `discussion_select`：一次保存实际候选、来源与选择理由，见下方字段。
5. 提示可能出现 Chrome Allow，调用 `discussion_start {runFile}`，只创建一次专用 Microsoft 365 Copilot 新对话。需要登录/授权时等待用户完成，再 `discussion_control {runFile,action:"bind"}`；不要重复 start。
6. `discussion_ask {runFile,question}` 提交首问。返回 pending 后服务持续采集。用 `discussion_result {runFile,waitMs:10000}` 取得本轮完整原答；pending 继续 result，不能重发问题。
7. 实际阅读回答，必要时补查其新增主张，再 ask 一个新增争点。追问必须有最新 `basedOnRound`、简要可分享 `analysis` 和 `expectedProgress`。必要时用 `discussion_evidence` 追加核验或纠正。
8. 无 pending 且目标满足时 `discussion_finish`，提供总结、共识、分歧、未定问题、局限、停止原因。再 `discussion_verify`，给用户报告、完整记录和实际耗时链接。

### 候选字段

`discussion_select` 参数：

```json
{
  "runFile": "init返回的实际绝对路径",
  "selectedId": "candidate-1",
  "reason": "主持根据目标、证据可得性作出的判断",
  "candidates": [{
    "id": "candidate-1",
    "question": "有边界、可研究的问题",
    "why": "讨论价值",
    "hypothesis": "可证伪的假设",
    "counterEvidence": "什么证据会推翻假设",
    "firstQuestion": "包含必要来源链接、边界及产出的首问",
    "sources": [{
      "url": "实际阅读的原始来源URL",
      "title": "实际标题",
      "versionDate": "实际版本日期或未注明",
      "readAt": "实际阅读的ISO时间",
      "access": "public-free",
      "limits": "该来源的适用范围与局限"
    }]
  }]
}
```

示例字段须替换成实际资料，不能把占位符或未打开的搜索摘要当来源。服务负责记录，不替主持搜索，也不能证明主持确实阅读过。

### 后续问题与核验

```json
{"runFile":"实际路径","question":"对最新回答的一个具体反例追问","basedOnRound":1,"analysis":"可公开的简要依据","expectedProgress":"本轮要填补的证据缺口"}
```

`discussionStyle` 默认为 delta；单轮可选 expanded。原答永远完整保存。证据更新格式：

```json
{"runFile":"实际路径","updates":[{"claim":"原始具体主张","finding":"原文支持什么、仍未知什么","status":"disputed","sources":["实际来源URL"]}]}
```

状态可选 verified、disputed、inference、unverified；推导不能标成已验证。

## 采集、暂停及交接

`discussion_result` 单次等待0～20000毫秒；即使当前工具返回，服务进程仍可在默认10分钟窗口内采集原答。窗口到期且仍 pending，下一次 result 可启动下一段采集。工具请求取消只取消等待，不撤销持久化提交。关闭进程后采集停止；服务重连同一 runFile 时，已提交且 active 的 pending 可自动续读。

`discussion_control` 支持 status、pause、resume、bind、recover-draft、submit、close。默认 status 仅读本地；browser:true 才核验网页。pause 在当前有界操作结束后停止续读并保留状态。关闭标签页只通过明确的 close 操作执行。

needs_attention 时核对本地状态及原网页。未发送草稿可 recover-draft，再 submit；已存在 submittedAt 的消息只续读。不同草稿、丢失的标签页所有权或未知发送结果不能靠重发解决。

跨 Agent 时：原宿主 pause 并断开；新宿主使用相同工作区配置，读 report（如有）、transcript 和 topics，再检查 status、resume。result 会返回最近实际回答及其轮次，先确认待处理进度，避免重复争点。不能同时启动两个宿主修改同一 runFile；文件锁仅保护单次操作，不提供多主持仲裁。

## 完整交付与计时

finish 参数含 summary、stopReason，以及可选 agreements、disagreements、openQuestions、limitations 数组。停止可以因为问题得到充分澄清，也可以因为剩余争点必须用新实验裁决；不限轮数不意味着永不收束。

11个工具中的 `discussion_artifact` 可读取 report、transcript、timing、topics、evidence、manifest。按 Unicode 字符分页，默认24000、最多48000；nextOffset 非 null 时继续，不能把一页叫完整记录。若宿主有本地文件访问，直接向用户提供真实绝对路径。

每次研究保存 topics/evidence、逐轮 requests/responses、权威 session、追加计时日志、完整导出、report、timing 和 manifest。计时从 init 开始，含选题准备、发送前操作、提交到保存、轮间主持、总结和导出。服务短返回不会缩短 Copilot 生成时间；浏览器调用和 worker 时间是阶段内分项。离线或合成页面验证不能代替真实讨论测速。
