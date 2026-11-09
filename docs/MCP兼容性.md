# MCP 兼容性说明（DeepSeekHarness / Codex）

本文件说明同一套 `search_documents` 工具如何同时接入 DeepSeekHarness（DSH）和 Codex，以及两边环境、路径差异导致的典型故障与处理方式。

## 1. 两种宿主的注册方式不同

| 宿主 | 工具注册位置 | 是否需要项目内文件 | 生效时机 |
| --- | --- | --- | --- |
| DeepSeekHarness | 启动参数 `--patch` 指向的 YAML 条目（`@deepseek-ai/dsh-mcp-client`） | 需要，本地生成 `dsh.lab5.local.yml` | 启动会话时加载 |
| Codex | 宿主全局 `~/.codex/config.toml` 的 `[mcp_servers.lab5]` | 不需要，项目内只放生成片段 | 重启 Codex 后加载 |

两边的共同点：**Skill 是项目目录发现的，MCP 工具是配置注入的**。在 DSH 里看到 `lab5-search` Skill，并不代表 `mcp__lab5__search_documents` 已注册；在 Codex 里同理。项目根的 `AGENTS.md` 为 Codex 这类宿主提供与 Skill 等价的操作说明。

## 2. 环境依赖

| 依赖 | 要求 | 检查方式 |
| --- | --- | --- |
| Node.js | `>= 20`（项目实测 24.16.0 / 24.19.0） | `node --version`；`package.json` 的 `engines` 已声明 |
| npm | 随 Node 安装 | `npm.cmd --version` |
| 项目依赖 | `npm ci` 后存在 `@modelcontextprotocol/sdk`、`zod` | `npm run mcp:doctor` |
| 操作系统 | Windows / Linux / macOS；示例命令用 PowerShell | — |
| 环境变量 | **不需要任何密钥**；服务只读本地语料 | — |

DSH 会清洗子进程环境（删除 `DSH_*`、名称含 `KEY`/`TOKEN`/`SECRET`/`PASSWORD` 的变量），本服务不依赖这些变量，因此不受影响。Codex 侧同样无需 `env` 配置。

## 3. 一键生成与本机自检

```powershell
npm.cmd ci
npm.cmd run mcp:config          # 生成 dsh.lab5.local.yml（固定 node 绝对路径 + 项目绝对路径）
npm.cmd run mcp:config:codex    # 生成 codex.lab5.mcp.toml（合并进 ~/.codex/config.toml）
npm.cmd run mcp:doctor          # 真实启动 stdio 服务并握手、检索、验证错误分支
```

生成器写入的是 `process.execPath`，不是 `node`。这一步同时解决两类问题：

1. **宿主不继承终端 PATH**：DSH 桌面端、Codex 桌面端从图形界面启动时，`command: node` 可能找不到解释器，表现为 `spawn ENOENT` 或“工具不出现”。
2. **路径占位符未替换**：`dsh.lab5.example.yml` 里的 `D:/lab5/...` 只是模板；生成器直接写本机绝对路径。

### Codex 合并方式

```powershell
# 先备份，再追加；不要整体覆盖 config.toml
Copy-Item "$env:USERPROFILE\.codex\config.toml" "$env:USERPROFILE\.codex\config.toml.bak"
Get-Content .\codex.lab5.mcp.toml -Raw | Add-Content "$env:USERPROFILE\.codex\config.toml" -Encoding utf8
```

重启 Codex 后，检查 `mcp_servers.lab5` 已加载、`search_documents` 可调用。若已有同名表，先删除旧表再追加。

## 4. 路径与编码陷阱

| 陷阱 | 现象 | 处理 |
| --- | --- | --- |
| 硬编码 `D:/lab5/...` 未替换 | 服务器进程启动即退出，工具缺失 | 用 `npm run mcp:config` 生成，不再手工替换 |
| `command: node` 依赖 PATH | `spawn ENOENT`；终端能跑、桌面宿主不能 | 生成配置固定 `process.execPath` 绝对路径 |
| 中文 / 空格路径 | 某些代码用 `new URL(...).pathname` 得到 `%E5%AE...`，启动失败 | 用 `fileURLToPath()` 或 `path.join()`；生成器直接写原生路径 |
| Windows `.cmd` 垫片 | 直接 spawn `npm.cmd`/`npx.cmd` 可能失败 | 只 spawn `node.exe`；`npx` 只用于启动宿主本身 |
| 工作目录不确定 | 相对路径找不到 `js/`、`node_modules` | 配置带 `cwd`；服务内部用 `__dirname` 解析 |
| 重复注册同名服务 | 启动报重复 `mcp-lab5` | 只保留一条有效条目；删除旧 profile 里的重复项 |

## 5. 已验证的兼容基线

| 组合 | 结果 | 说明 |
| --- | --- | --- |
| DSH 自带 MCP 客户端 `@modelcontextprotocol/client` 2.2.0 ↔ 本项目服务（SDK 1.32.2） | 通过 | 初始化、`tools/list`、`tools/call`、错误分支与空结果均正常；客户端会在新版协议不可用时回退旧协议 |
| 项目 SDK 客户端 1.32.2 ↔ 本项目服务 | 通过 | `npm test` 中的 `stdio discovery, search and recovery` |
| 中文 + 空格路径（本仓库所在目录） | 通过 | 服务入口、语料与依赖均从该路径启动 |
| 非项目工作目录启动（`os.tmpdir()`） | 通过 | 证明不依赖宿主 cwd |

`npm run mcp:doctor` 默认用项目 SDK 客户端自检；若本机装有 DSH，可额外指定其客户端目录做宿主同源验证：

```powershell
$env:DSH_MCP_CLIENT_ROOT = 'F:\DSH\DSH Desktop Beta\resources\app\node_modules\@modelcontextprotocol\client'
npm.cmd run mcp:doctor
```

## 6. 故障对照表

| 现象 | 先查什么 | 处理 |
| --- | --- | --- |
| DSH 里工具列表没有 `mcp__lab5__search_documents` | 是否带 `--patch`；`dsh.lab5.local.yml` 的 `command`/`args` 是否存在 | 重新 `npm run mcp:config`，带 patch 重启 |
| Codex 里没有 `search_documents` | `~/.codex/config.toml` 是否有 `[mcp_servers.lab5]`；路径是否为本机路径 | 合并 `codex.lab5.mcp.toml`，重启 Codex |
| 启动即退出、无日志 | Node 是否为绝对路径；`npm ci` 是否完成 | 运行 `npm run mcp:doctor` 定位到具体检查项 |
| 终端正常、桌面宿主失败 | 宿主 PATH 与终端不同 | 使用生成器写绝对路径 |
| 检索结果为空或报错 | 查询语法、语料是否加载 | `node server/search-cli.cjs` 重放同一参数 |

## 7. 参考

- [DSH MCP 客户端配置说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)
- [MCP 官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Codex `[mcp_servers.*]` 配置键参考](https://github.com/grandamenium/cortextos/blob/6f9383809f7b87a15e9819f83f9a7f147b202883/community/skills/claude-to-codex-migration/references/mcp-toml-keys.md)
- [Windows 下 MCP 启动器指南](https://github.com/debugmcp/mcp-debugger/blob/a77c2f8ed399d773f902e7ee5da8f5fa6c577a5d/docs/archive/old-guides/windows-launcher-guide.md)
- [Electron 宿主中的 Node 回退设计](https://github.com/zai-org/zcode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/apps/zcode-cli/docs/design/v2/mcp-node-fallback.md)
