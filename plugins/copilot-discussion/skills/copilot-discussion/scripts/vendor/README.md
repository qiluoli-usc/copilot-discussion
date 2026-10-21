# 随包配置解析器

仅安装与回滚时使用。运行研究 MCP 不依赖 npm 安装。这里保留 npm 原始发行文件和许可证，不运行第三方安装脚本。

| 包 | 固定版本 | 原始发行包 | npm SHA512 integrity |
| --- | --- | --- | --- |
| Microsoft jsonc-parser（MIT） | 3.3.1 | https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz | `sha512-HUgH65KyejrUFPvHFPbqOY0rsFip3Bo5wb4ngvdi1EpCYWUQDC5V+Y7mZws+DLkr4M//zQJoanu1SP+87Dv1oQ==` |
| smol-toml（BSD-3-Clause） | 1.9.1 | https://registry.npmjs.org/smol-toml/-/smol-toml-1.9.1.tgz | `sha512-j7WyPdf0CJoutMzMoPLF/bVXHtKZIT9Rb4eGeEbWw8X2t5oirjPgpL+OpaENZrILYaXqYwnVH+qgUwVbl+pUJQ==` |

两份原始归档于2026-10-21下载，并在提取前验证上述 SHA512。JSONC 使用官方文本编辑接口保留注释和其他节点；TOML 解析只用于验证，安装器只追加或更新自己登记的独立表块，不重排整份用户配置。
