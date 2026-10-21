# Jev Native 持续会话适配

本插件复用已安装 `jev-ultrafast` 的 `Browser.observe()` 与 `Browser.act()`，由当前宿主 Agent 提供精确问题并分析回答。执行器从真实观测的控件中选择输入框和发送按钮，执行前由 Jev 校验页面新鲜度、节点身份与遮挡。适配器保留专用标签页，各条命令以所有权标记重新接入。

这条路径没有远程 Jev 决策模型调用，不读取模型凭据，不生成截图或录像。Copilot 仍通过已登录 Chrome 接收用户授权的讨论内容。通用 Jev Agent 的远程决策和文本辅助模型没有参与此适配器。doctor/start 保存真实导入模块的源码路径、SHA256；成功 fill/send 后保存带实际方法、控件角色和时间的 Browser.act 回执。它们是本地执行审计记录，不能视为外部证明。

执行器只对已逐段核验的 Jev browser.py 指纹启用“输入前 StalePage”恢复：该版本 fill/click 的 StalePage 均发生在首个 Input.dispatch 之前，重新观察、重新核对原草稿后最多重试两次，回执记录 preInputStaleRetries。RuntimeError、传输超时或未知源码版本绝不这样重试；不得只看错误名称推定没有发送。升级 Jev 后须重新审计源码才能加入指纹。已向主持返回的不确定发送仍只 collect。

## 前提与检查

- Windows；Node20+和Python3.12依赖可由 [自带bootstrap](installation.md) 自动准备。优先使用已验证的pythonExecutable；旧配置仍兼容py/uv启动。
- 已安装 Jev Ultrafast 与其 Browser Harness 依赖；使用已配置的 Chrome 连接 `127.0.0.1:9222`。
- 首次运行 `scripts/bootstrap.ps1` 自动检测/安装并配置工作区、Jev和解释器；已有Node也可运行setup.mjs。默认读用户目录 `/.copilot-discussion/config.json`，可用COPILOT_DISCUSSION_CONFIG指定配置，或JEV_ULTRAFAST_ROOT/JEV_PYTHON_EXECUTABLE覆盖对应路径。不要复制其他机器的runtime或凭据到本项目。
- 连接前提示用户 Chrome 可能显示 Allow；登录和浏览器授权由用户完成。适配器发现录像活动时停止，不修改用户录像配置。
- Native 路径中不要使用 CUA、Edge、Playwright 或另外建立 CDP 驱动。原有 CUA 路径是独立选择，不在 Native 失败后擅自切换。

命令格式：

```powershell
node <skill-dir>/scripts/native-cli.mjs <command> <request.json>
```

把占位符替换为实际绝对路径。使用宿主提供的 Node 可执行文件即可；无需为 Node 模块运行 npm install。JSON 文件直接写入精确问题，避免 shell 拼接引号、反引号或特殊字符。

`doctor` 请求只需 `{}` 或包含 `runtimeRoot`，检查实际 Chrome 和运行时，不创建会话、不调用模型。检查通过才开始讨论。

## 开始与持续追问

完整研究任务优先使用 [MCP 研究流程](mcp-workflow.md)；没有 MCP 时用 [脚本研究流程](research-workflow.md) 和 `ResearchRun`。MCP 服务和持久 Node 的 `NativeClient` 会保留同一个 worker；本页的 `native-cli.mjs` 是逐命令的底层兼容入口，每条命令仍启动并释放 worker。

创建 `start` 请求：

```json
{
  "topic": "从当前对话确定的主题",
  "context": "本次讨论所需的背景与目标",
  "maxRounds": 8,
  "outputDir": "工作项目内的绝对输出目录",
  "url": "https://copilot.cloud.microsoft/chat"
}
```

`start` 返回 `sessionFile`、`markdownFile` 和 `ready`。保存返回的路径，不要从示例中猜文件名。若返回 `needs_attention`，保留专用标签页，请用户完成登录或核对页面，再以 `{ "sessionFile": "实际路径" }` 运行 `bind`。不要重新 start 来重复创建聊天。

用户明确要求不限制轮数时，设置 `"maxRounds": null`，按研究目标是否满足、证据是否仍有增量决定何时结束，不另设隐含总轮数。单次工具等待仍须有界，暂停和防重复发送机制继续保留。

每轮由当前模型先决定一个问题，再写 `ask` 请求：

```json
{
  "sessionFile": "start 返回的实际 JSON 绝对路径",
  "question": "根据上轮实际回答形成的精确追问",
  "analysis": "可分享的简要判断与追问依据",
  "waitMs": 45000
}
```

`ask` 在一次命令中完成准备、提交一次和等待回答。Native 浏览器调用较快，允许这样组合；宿主 shell 在十秒左右返回运行标识时继续读取该进程结果，不要再启动另一次 ask。每次调用保持有界等待与用户进展更新。

- `answered`：读取实际回答，继续生成下一问。
- `pending`：同一请求文件改运行 `collect`。它只读回答，不发送消息。
- 进程或传输异常：先运行 `status`，检查磁盘 pending 和网页；禁止自动重发 ask。
- 填入失败自动标记 `draft_failed` 并核验恢复；`recover-draft` 可在原标签页恢复尚未尝试发送的草稿，`submit` 也会先处理这类状态。仅接受消息计数与基线一致、无生成、无待发问题、输入框为空或精确原问题；不同草稿一律保留。额外填入最多两次，重开不会重置上限。
- `prepared` 草稿尚未提交且网页核验一致时，可运行 `submit` 接续。带 `submittedAt` 的 `submitted/uncertain` 只可 collect；不因错误类型或空输入框猜测重发。

首问之后平台可能延迟更新唯一会话地址。适配器只允许在同一原标签页、同一来源且最后提问一致时接受这次地址变化；之后固定唯一会话 URL。找不到原标签页或所有权标记改变时停止，不接管其他用户标签页。

CLI 命令退出会释放工作进程，专用浏览器标签页继续保留。持久客户端在轮间保留 worker，暂停或结束后显式释放。两者都只有显式 `close` 才关闭专用标签页。

## 暂停与结束

- `pause` / `resume` 请求包含 `sessionFile`，只修改本地状态。
- `finish` 请求包含 `sessionFile` 和当前模型写出的 `summary`，要求无 pending；返回记录路径。
- `status` 返回本次会话的消息与状态，供当前模型核验，不导出侧栏历史。
- 使用 `metrics.mjs` 生成速度报告；`--run=<run.json>` 可结合运行边界分析历史瓶颈。新会话的事件保存为同目录 `.events.jsonl`，读取 `Session.read()` 或 `transcript/complete.json` 可获取完整计时；不要只搬走状态 JSON。旧版内嵌计时仍兼容。

离线验证：Node 测试加 `python -m unittest discover -s <plugin-dir>/tests -p test_native_worker.py`。显式运行 `tests/native-live-smoke.mjs` 可用合成的本地网页验证中文输入、两轮收发及工作进程重启后复用同一标签页；不会调用模型或访问 Copilot。
