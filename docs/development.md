# 开发与发布

版本0.10.0-preview.1。npm包在`plugins/copilot-discussion`，只有一个可执行入口`bin/copilot-discussion.mjs`。没有postinstall，安装命令阶段不静默改宿主。显式setup调用已有环境准备核心，再用固定目录程序生成配置。

## 职责

- `cli/storage.mjs`：版本化产品复制、哈希登记、维护锁、原子写入。
- `cli/manager.mjs`：setup、doctor、update、repair、uninstall。产品在`%LOCALAPPDATA%/CopilotDiscussion/npm/versions`，活动登记在同目录`active.json`，宿主启动路径不引用npx缓存。
- `cli/archive.mjs`：有界更新解压，拒绝越界路径、重复路径与链接。
- `cli/welcome.mjs`：本机HTML步骤和后续命令。
- `cli/host-guide.mjs`：从既有安装器同步的小型指南渲染器；打包时同步，运行时不依赖installer目录。
- `skills/copilot-discussion/scripts/host-integration.mjs`：七宿主检测、增量配置、受保护修复、移除和回滚；QwenWork、DSH保留人工加载步骤。
- 原核心的11个MCP工具保持自动选题、草稿恢复、连续采集、追问、完整记录及计时。握手期间不安装依赖，stdout仅使用JSON-RPC。

## 维护边界

升级获取同一GitHub仓库的已发布npm包，校验SHA256后安装到新版本目录；旧版目录保留，避免破坏未重启的宿主。repair补回缺失托管文件，保留人工改动过的宿主字段或技能。未知外部Jev目录不删除，必要时在新目录重建依赖。

卸载只移除仍与登记一致的技能文件和连接，保留其他服务器、研究目录、共享运行环境与备份。人工修改的连接保留，程序也保留。维护前应暂停研究，不会自动迁走运行中的会话。

所有命令支持`--json`供Agent读取，`--data-dir`与`--config`用于独立环境。`update --from <本地已解压包>`供离线管理和受控验证，`update --to <版本>`指定GitHub目标版本。

更新会执行经过SHA256验证的新包中的安装逻辑；旧全局CLI会把维护命令交给活动版本，避免repair意外降级。doctor同时核对产品文件、Jev导入和登记的宿主文件；不把磁盘配置就绪当作客户端实际加载。手动导入的连接先从宿主移除，再运行 `uninstall --manual-disconnected`。

## 验证与分发

```powershell
node --test plugins/copilot-discussion/tests/*.test.mjs
py -3.12 -m unittest discover -s plugins/copilot-discussion/tests -p 'test_*.py'
```

维护者使用`scripts/build-npm.mjs`生成tgz、源码ZIP、校验值与安装说明，产物均在`output/releases/v0100-npm`。npm包只携带运行入口、完整技能、用户指南和第三方许可，不包含研究、个人配置、浏览器资料、venv或缓存。

构建需要Node、npm与Python3.12。若npm不在当前Node目录，可指定 `node scripts/build-npm.mjs --npm-cli "完整路径/npm-cli.js"`。真实安装验证用 `scripts/validate-npm.mjs --npm-cli <文件> --package <tgz文件>`，自动使用隔离用户、npm prefix与数据目录。可用 `--runtime-root <已有Jev>`验证复用；`--managed-python`验证没有预装Python时的托管安装；`--seed <下载目录>`只复用SHA256匹配的uv/Jev压缩包。结果在`output/installations/v0100-npm/<UUID>/validation.json`，保留失败记录与实际阶段耗时。可选 `--sdk-uv <uv.exe>`还验证官方MCP SDK和技能结构；技能检查需要构建机已安装skill-creator。

若本地tgz需要npx运行，使用 `npx.cmd --yes --package="完整路径/包.tgz" copilot-discussion help`。普通用户使用安装页的HTTPS网址形式即可。

标签`v0.10.0-preview.1`与全部清单/MCP版本一致。首次通过GitHub tgz URL分发。npm公共仓库发布需要另行确认账户与名称权限，不假定GitHub登录等于npm授权。

历史开发数据见[历史记录](development-history.md)，EXE使用见[旧说明](legacy-exe.md)。历史测试与路径不替代新版本验收。
