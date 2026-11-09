# AGENTS.md — 实验 5 检索项目约定

本文件给 Codex 等读取 `AGENTS.md` 的宿主提供与 `.agents/skills/lab5-search/SKILL.md` 等价的操作说明。

## 检索工具

- 服务入口：`server/mcp-server.cjs`（MCP stdio）。
- 工具名：`search_documents`。DSH 中显示为 `mcp__lab5__search_documents`；Codex 中按宿主规则命名（通常为 `lab5` 服务器下的 `search_documents`）。
- 参数：`query`（1–300 字符）、`model`（`boolean` / `vector` / `bm25`）、`topK`（1–20）。
- 只读工具，不需要密钥；语料是 60 篇中文示例文档。

## 查询策略

1. 用户给出 AND / OR / NOT / 括号构成的检索式时，原样保留，选 `boolean`。
2. 自然语言里的硬条件（必须包含、必须排除）转成布尔式，例如“找物联网资料，排除智能家居” → `物联网 NOT 智能家居`。条件有歧义先澄清。
3. 普通主题查询提取关键词，默认 `bm25`；用户明确要 TF-IDF 时用 `vector`。
4. 答复列出实际检索式、模型、命中文档 ID 与标题；以工具返回片段为依据。无命中时保留硬条件，可建议放宽可选词。工具不可用或报错时如实说明。

## 开发约定

- 网页与 Node 共用 `js/` 下的同一套检索核心，不要在 `server/` 里复制算法。
- 改检索逻辑后运行 `npm.cmd test`；改 MCP 配置或路径后运行 `npm.cmd run mcp:doctor`。
- MCP 配置由 `npm.cmd run mcp:config`（DSH）与 `npm.cmd run mcp:config:codex`（Codex）生成，不要手写裸 `node` 命令。
- 保持 `IR.searchBoolean` 的返回值语义与排序规则；性能修改不得改变完整结果。
