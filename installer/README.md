# Windows 图形安装程序

最终用户双击发布的 `CopilotDiscussion-0.9.0-Setup-win-x64.exe`，使用步骤见 [安装指南](../docs/installation.md)。本目录仅保存源码与依赖锁，大文件和构建中间产物放在项目 output 中。

## 构建

构建机需要 Windows x64、Node 20+、Python 3.12（含 pip）、.NET Framework 4.x 的 csc.exe、PowerShell 5.1；目标电脑只需 Windows 10 / 11 x64 自带的 .NET Framework 4.8 / PowerShell 5.1。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\build.ps1
```

构建从插件 runtime-lock.json 和本目录 assets.lock.json 下载固定来源并验证 SHA256；Python 哈希来自 Astral 官方 GitHub Release digest，Chrome 哈希来自 Microsoft winget-pkgs，签名保持 Google 原样。wheels 由 Jev uv.lock 导出，pip 按哈希仅下载 Windows/Python 3.12 二进制包。原始许可证随包保留。

## 受信任签名与发布

此前v0.8未签名包在本机最终启动验证中受到 Smart App Control 的 `VerifiedAndReputableDesktop` 策略阻止。早期候选包的安装成功不能保证最终包或另一电脑获准运行。正式分发需要受信任签名及目标机验证，参见 [Microsoft 签名要求](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)。不通过改名、关闭策略、自签名根或不同启动方式规避拦截。

有现成受信任代码签名证书时，构建机可传 `-SignTool <Windows SDK signtool.exe绝对路径> -CertificateThumbprint <明确的40位指纹>`，可选 `-TimestampUrl <受信任RFC3161 HTTPS端点>`。签名对象依次为内置管理器和最终Setup，管理器签名后才生成文件清单与内嵌ZIP，最终签名后才计算发布SHA256。私钥由证书提供程序管理，不接收PFX、密码，不遍历或导出证书。`build.json.signing`区分unsigned与verified-authenticode。只有签名和目标机实际检查通过后才能称可在受控电脑直接运行；第三方二进制仍遵循各自的签名及目标策略。

可传 `-SeedDownloads <已有下载目录>` 与 `-PreparedWheels <wheel目录>` 加速本机复现；缓存依然校验，不从已有 .venv 复制依赖。构建输出位于 `output/releases/v090/`，中间目录位于 `output/builds/installer/`。重新构建不覆盖同名插件ZIP；选择新 `-Output` 目录保留原始交付。

## 实现与验证

- `src/Setup.cs`：WinForms向导、宿主检测、自解压、包校验、开始菜单、授权检查与撤销接入。完整安装程序内嵌离线ZIP；轻量管理器复用已安装内容。
- `app/install.mjs`：与插件共用setup，准备离线环境并调用统一宿主适配器；`guide.mjs`生成结果指南，`hosts.mjs`执行按哈希保护的回滚。
- 插件 `scripts/host-integration.mjs` 与 `host-catalog.json`：检测已知路径/PATH、增量合并JSON/JSONC/TOML、按宿主安装技能、维护所有权与备份，不接受账号或密钥。
- `scripts/vendor/`：已验证npm SHA512的Microsoft jsonc-parser与smol-toml原始发行文件和许可证；仅安装接入使用，不需npm安装。
- 插件 `scripts/offline.mjs`：验证每个文件，目标机新建venv，uv强制 `--offline --no-index --require-hashes`。所有执行路径来自校验后的相对清单。
- `pack.py`：只在构建机处理Python归档、wheel许可和ZIP；不会成为目标电脑的先决条件。
- `--self-test <报告文件>`：开发验证界面构造、宿主选项、参数和路径防护；不安装软件、不打开浏览器。
- `--smoke-install <请求JSON>`：开发验证使用同一安装引擎，指定独立安装目录、配置和工作区；不应使用个人默认配置跑测试。

安装器不在MCP握手期间下载或安装，不调用Jev付费决策模型，不读取登录或凭据。Chromium浏览器授权不会被静默接受。解压失败保留现场；已有未知目录或运行时不被删除或接管。未实现自动卸载；停用宿主连接后可移除专用安装目录，研究工作区独立保留。
