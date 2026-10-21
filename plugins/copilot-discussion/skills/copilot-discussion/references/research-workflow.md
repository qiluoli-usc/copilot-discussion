# Jev Native 公开研究运行

## 执行入口

已连接标准 MCP 的宿主优先使用 [MCP 研究流程](mcp-workflow.md)。本页是保留的本地脚本 API，不是 MCP 协议。先通过 `setup.mjs` 配置，或设置 `COPILOT_DISCUSSION_CONFIG` 指向已生成配置。

仅使用脚本时运行 `node <skill-dir>/scripts/research-server.mjs`。Codex exec 工具以 `tty: true` 启动并保留标准输入，取得 session_id；随后用 write_stdin 逐条写入 JSON 行，读取相同 id 的最终 ok 结果。其他宿主使用其普通持久子进程接口，不假定有同名工具。默认非交互 exec 会关闭 stdin 导致进程正常退出。工具每次短等待，脚本可持续采集同一个回答，不能把 collecting 事件当最终结果，也不要重复 ask。

```json
{"id":1,"command":"init","request":{"workspaceDir":"实际工作项目绝对路径","maxRounds":null}}
{"id":2,"command":"select","request":{"candidates":[],"selectedId":"实际候选ID","reason":"实际选择依据"}}
```

第二行的 candidates 要填入下文的实际候选对象，不能发送空示例。后续 command 为 start、ask、collect、watch、recover-draft、submit、evidence、finish、verify、pause、quit。ask 默认首段等待15秒，再自动分段 collect 至完成；watchMaxMs 默认600000，sliceMs 默认15000，可配置；continuous:false 保留旧的有界返回。watch 只采集，不发送或生成新问题。pause/quit 到达会取消当前持续采集，最多等待当前小段结束。它保留一个 Jev worker，无网络监听端口、不独立生成追问；结束、暂停、EOF 或 quit 时释放 worker，保留专用 Chrome 标签页。

若宿主提供完整普通 Node 进程环境，也可在持久 REPL 导入 `scripts/research-run.mjs` 使用下面的 API。当前 `mcp__node_repl` 不提供 process 环境，因此不直接在那里启动 worker；使用上述标准输入输出入口，不绕过宿主限制。

```javascript
var researchModule = await import('file:///<skill-dir>/scripts/research-run.mjs');
var research = await researchModule.ResearchRun.create({
  workspaceDir: '<workspace-absolute-path>',
  maxRounds: null,
  stopCriteria: ['主要争点经反方复核；剩余问题需新实验才能裁决']
});
nodeRepl.write({runFile: research.file});
```

替换实际绝对路径，不执行占位符。`maxRounds: null` 仅用于用户已要求不限制轮数；未指定时默认 8，固定轮数支持 1～30。单次浏览器等待仍最多 45 秒；REPL 工具超时可设置为 60000 毫秒。

**在搜索和选题前创建运行**，这样准备阶段进入总耗时。宿主不能保留标准输入或普通 Node 环境时，使用 `research-cli.mjs <command> <request.json>`；流程和文件格式相同，但每条命令会重新启动 worker，不宣传同等速度。

## 选题和开始

当前模型使用宿主搜索、实际打开免费原始资料，再调用 `research.select()`。脚本记录研究依据，不替模型搜索或判断来源是否真的免费；`readAt` 是主持提供的阅读记录，并非工具自动证明。

```javascript
nodeRepl.write(await research.select({
  candidates: [{
    id: 'candidate-1', question: '有范围的研究问题', why: '讨论价值',
    hypothesis: '可证伪假设', counterEvidence: '什么观察会推翻假设',
    firstQuestion: '包含必要背景、来源链接和具体争点的首问',
    sources: [{title: '实际读过的原始来源', url: 'https://...',
      versionDate: '实际版本日期', readAt: '实际阅读时的ISO时间',
      access: 'public-free', limits: '论文条件及外推局限'}]
  }],
  selectedId: 'candidate-1', reason: '当前模型的选择依据'
}));
nodeRepl.write(await research.start());
```

自主选题可比较约 3 个不同方向；用户已有主题时可只记录该主题。一次性保存候选和来源，随后只记录新增证据或纠正，避免每轮重写同一文献摘要。默认不使用付费服务。

## 持续追问

```javascript
nodeRepl.write(await research.ask({question: '当前模型决定的首问', waitMs: 45000}));
// 读取实际回答、按需要核验来源后，在下一次工具调用中：
nodeRepl.write(await research.ask({
  question: '对上一答具体主张的追问', basedOnRound: 1,
  analysis: '可公开的简要依据', expectedProgress: '这一问要解决的缺口',
  waitMs: 45000
}));
```

`basedOnRound` 必须是最新已完成轮次。每轮只生成当前问题，不预填问题队列。新运行默认 delta 风格，实际发送问题自动附加约450字的新增争点约定；requests 同时保存 intentQuestion 与完整 question。可在 init 设置 answerBudgetCharacters，必要时 ask 单轮 discussionStyle:'expanded'。目标长度只是提示，回答超出也完整采集；缩短回答不算浏览器加速。

服务器会自动续读已发送的 pending。普通 Node API 的 ask 仍有界返回，可 `await research.watch({maxMs:600000,sliceMs:15000})` 持续保存；支持 AbortSignal 和 onProgress。超出窗口仍保留 pending，可再 watch，绝不再 ask。抛错时读取 run.json 与本地 status；现场核验使用 control('status',{browser:true})。未发送草稿可 recover-draft，再 submit；发送标记已落盘的消息只能 collect。needs_attention 后先核验，必要时 resume；恢复原问题不需要新建请求文件。

证据纠正：

```javascript
nodeRepl.write(await research.evidence([{
  claim: '原来的具体主张', status: 'disputed',
  finding: '原文实际支持什么，以及仍未知什么', sources: ['https://...']
}]));
```

状态支持 `verified`、`disputed`、`inference`、`unverified`。不删除被纠正的原始回答。互相同意不等于证实事实；事实核验只在相关争点上进行，不在每轮重复检索全部来源。

## 收束与交付

```javascript
nodeRepl.write(await research.finish({
  summary: '主持写出的结论和证据边界', stopReason: '为什么此时满足停止条件',
  agreements: ['有证据支持的结论'], disagreements: ['争点、双方观点及是否解决'],
  openQuestions: ['需要实验或新资料裁决的问题'], limitations: ['未实际完成的验证']
}));
nodeRepl.write(await research.verify());
```

`finish` 生成 `report.md`、`timing.json/md`、`transcript/full-record.md`、`transcript/complete.json`、文件内容指纹及目录入口；自动核对每轮请求、响应和权威记录。无需为每次讨论编写报告脚本。

`Session` JSON 是发送状态的权威记录，`session.events.jsonl` 是追加的计时事件；`complete.json` 汇总两者。旧版内嵌计时仍可读取。网页表格和公式可能在采集文本中扁平化，记录保留原文本，不为美化改写回答。

异常后重新导入模块，再 `ResearchRun.open(实际run.json路径)`，读取状态、恢复原标签页并先处理 pending。`research.export()` 可在已完成运行上重建报告；保留原结束时间，不把事后导出算成新讨论耗时。`research.dispose()` 只释放 worker。不要关闭用户标签页或切换执行路径。

## 计时与速度口径

准备、发送前操作、提交至回答保存、轮间间隔、总结与导出分别统计。浏览器与 worker 计时是这些阶段内的分项，不能再次加到总耗时。events.jsonl 记录 watch 循环和起止，session.events.jsonl 记录实际动作回执。完成候选到保存可衡量完成判定后的复核落盘；首次候选并不保证等于真实生成结束。旧数据没测的项保持未知。提交到保存不是纯生成时间，首次观察到输出不是精确首 token 时间。

常见可改进项是重复启动、重复快照、每次轮询重写大文件，以及重复的人工归档操作。保留完成控件、无生成状态和连续两次相同文本的判定；生成中适度放慢轮询，完成候选出现后以短间隔确认。不得为了速度跳过来源核验、防重复发送或原答保存。
