# 实验 5 信息检索系统

网页和 DeepSeekHarness（DSH）、Codex 共用一套检索算法。网页可加载中文示例、PubMed 或上传 CSV。两个宿主都通过项目 Skill 与本地 stdio MCP 调用同一个检索核心，检索 60 篇中文示例文档。模型凭据由演示者在各自宿主中配置。

- [从零开始测试复现](从零开始测试复现.md)涵盖安装、网页测试、DSH Web 配置和两条验收请求。
- [项目成果](项目成果.md)适合用作汇报素材。
- [评测记录](evaluation/results.md)收录中文基线、DSH 调用和 PubMed 规模结果。
- [MCP 兼容性说明](docs/MCP兼容性.md)说明 DSH 与 Codex 的注册差异、环境依赖和故障对照。

如需建立 Git 仓库，以本目录为仓库根。`.agents/` 中的项目 Skill 需要随源码提交。PubMed 文献元数据沿用课程提供的 CSV，`js/pubmed.js` 是其预打包版本。

## 在 DeepSeekHarness 中运行

从本目录执行以下 PowerShell 命令。已测试 Node 24.16.0 / 24.19.0，依赖版本由锁文件固定。需要 Node.js 20 及以上（`package.json` 的 `engines` 已声明）。

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run mcp:config
npm.cmd run mcp:doctor
npx.cmd --yes @deepseek-ai/dsh@0.2.1-rc.1 --profile web --patch ./dsh.lab5.local.yml
```

`mcp:config` 用本机 Node 的**绝对路径**和项目**绝对路径**生成 `dsh.lab5.local.yml`，避免桌面宿主从图形界面启动时找不到 `node`。`mcp:doctor` 会真实拉起 stdio 服务、列出工具、执行一次布尔检索和一次错误请求；全部通过再去启动宿主。

随后在浏览器打开终端打印的本地 URL，在 Settings → Models 配置模型，选择本项目目录新建会话。等待工具 `mcp__lab5__search_documents` 出现，再发送下面的请求。配置细节与两个宿主的差异见 [MCP 兼容性说明](docs/MCP兼容性.md)。

> 项目 Skill 通过项目目录发现，MCP 服务由启动时的 patch 注册。看到 `lab5-search` Skill 不代表工具已连接；`dsh.lab5.local.yml` 是按本机路径生成的本地配置，被 Git 忽略。换机器或换解压路径后重新生成，并把它传给 `--patch`。

可独立重放工具请求，PowerShell 下通过管道传 JSON，避免参数引号被 shell 改写。

```powershell
'{"query":"物联网 NOT 智能家居","model":"boolean","topK":5}' | node server/search-cli.cjs
```

预期包含文档 ID `37`，排除 `38`。第二条演示可输入“我想了解怎么防范黑客入侵”，查看 DSH 实际提取的词和 BM25 命中文档。记录 Skill 加载、工具实参和结果。接口详情与当前证据见[评测记录](evaluation/results.md)。

## 接入 Codex

Codex 的 MCP 配置在宿主全局 `~/.codex/config.toml`，不在项目目录内。先生成片段：

```powershell
npm.cmd run mcp:config:codex
```

再把 `codex.lab5.mcp.toml` 合并进 `%USERPROFILE%\.codex\config.toml`（先备份，已有同名表先删除），重启 Codex。片段同样固定 Node 绝对路径、服务路径与工作目录。完整对照见 [MCP 兼容性说明](docs/MCP兼容性.md)。

网页端是纯前端 HTML + JavaScript，**前端无需任何第三方运行库**，双击 `index.html` 即可运行（无需服务器）。Node 侧仅 MCP 服务使用官方 `@modelcontextprotocol/sdk` 与 `zod`，版本由锁文件固定。
数据集为 CSV 文件，可在页面上传任意 CSV；内置两个数据集：示例中文 60 篇、PubMed 文献集（约 5800 篇，即 `csv-Formularie-set.csv`）。

## 文件结构

```
实验5提交版/
├── index.html            网页入口（双击运行）
├── css/style.css         页面样式（明/暗双主题）
├── js/
│   ├── utils.js          CSV 解析 / 高亮 / 摘要 / 格式化
│   ├── porter.js         Porter 英文词干化
│   ├── tokenizer.js      中英文分词（中文单字+相邻二元组）
│   ├── index.js          倒排索引构建 + 布尔模型检索（表达式解析器）
│   ├── models.js         向量空间模型（TF-IDF+余弦）、概率模型（BM25）
│   ├── evaluation.js     评测指标（P@k/R@k/F1/AP/MAP/P-R 曲线）+ 图表绘制
│   ├── data.js           示例中文数据集（60 篇）+ 标准评测集（10 查询）
│   ├── pubmed.js         PubMed 数据集（由 build-pubmed.js 自动生成，约 2MB）
│   └── main.js           页面交互逻辑
├── dataset.csv           示例数据集源文件（与 data.js 内容一致，供“上传 CSV”演示）
├── csv-Formularie-set.csv 原始 PubMed 数据集（实验提供）
├── server/
│   ├── search-core.cjs   Node 侧检索核心（vm 加载 js/，与网页共用同一套代码）
│   ├── search-cli.cjs    JSON 请求的命令行入口
│   └── mcp-server.cjs    MCP stdio 服务，暴露 search_documents
├── scripts/
│   ├── mcp-config.cjs    生成 DSH patch / Codex 配置（固定 Node 与项目绝对路径）
│   └── mcp-doctor.cjs    MCP 环境自检：依赖、路径、启动、检索、错误分支
├── AGENTS.md             Codex 等宿主的项目说明（与 Skill 等价）
├── docs/MCP兼容性.md      两个宿主的注册差异、环境依赖、故障对照
├── dsh.lab5.example.yml  DSH patch 模板（local 由脚本生成并被忽略）
└── test/
    ├── smoke.js          冒烟测试：node test/smoke.js 全部通过 ✓
    ├── search-core.test.cjs  检索核心断言（含布尔评分调用次数回归）
    ├── mcp.test.cjs      MCP stdio 真实握手测试
    └── build-pubmed.js   把 PubMed CSV 打包进 js/pubmed.js
```

## 运行方式

- **网页**：双击 `index.html`（或浏览器打开）。进入“性能评测”标签页 → 点“运行标准评测（10 条查询）”。
- **自测**：`node test/smoke.js`（需 Node.js）。第 6 节比较 PubMed 前 2,000 篇和全量 5,820 篇，输出建索引耗时、查询耗时及 Top‑5。可用 `node test/build-pubmed.js` 重新生成 PubMed 数据包。
- **换数据集**：页面顶部“上传 CSV 文件…”或“加载 PubMed 文献数据集”。CSV 表头支持两种约定：
  - 通用：`id,title,content,category`（content 缺失时自动用其他列拼接）
  - PubMed：`PMID,Title,Authors,Journal/Book,Publication Year,...`（自动识别）

## 三种模型原理与实现

| 模型 | 文档表示 | 检索方式 | 特点 |
|---|---|---|---|
| **布尔模型** | 词项集合 | 倒排索引 + AND/OR/NOT 集合运算 | 精确匹配、无排序；本系统按匹配词频排序仅供评测 |
| **向量空间模型** | TF-IDF 权重向量（L2 归一） | 余弦相似度排序 | 支持部分匹配与连续相关性 |
| **概率模型 BM25** | 统计模型 | `RSV=Σ IDF·f·(k1+1)/(f+k1(1−b+b·dl/avgdl))` | 词频饱和 + 长度归一，k1/b 页面上可调 |

中文分词：连续汉字串切为“单字 + 相邻二元组”，重叠二元组倒排记录求交 ≈ 短语匹配，无需外部词典。
英文处理：小写化 → 停用词过滤 → Porter 词干化。

## 评测方法与实测结果

评测集：10 条中文查询 + 人工相关性标注（共 60 篇文档、10 个主题类）。
指标：P@10、R@10、F1@10、AP/MAP（截断 50）、11 点插值 P-R 曲线、逐查询明细。
布尔模型结果按匹配词频排序后参与 P@k/MAP 评测（为三种模型可比）。

**标准评测实测结果（`node test/smoke.js` 输出）：**

| 指标 | 布尔模型 | 向量空间模型 | 概率模型 BM25 |
|---|---|---|---|
| P@10 | 0.140 | 0.630 | **0.640** |
| R@10 | 0.215 | 0.983 | **1.000** |
| F1@10 | 0.169 | 0.766 | **0.779** |
| MAP | 0.215 | 0.955 | **0.980** |

**结论**：BM25 综合最优（MAP 0.98，查全率 1.0）；向量模型次之（MAP 0.955，对长查询略欠）；布尔模型因严格 AND 语义与无排序能力，查全率/查准率均低（MAP 0.215）——这正是布尔模型“精确但召回差、不能排序”缺点的定量体现。

## 常见问题

- **打开页面是空白/报错**：请用现代浏览器（Chrome/Edge/Firefox 较新版本）直接打开 `index.html`。
- **布尔查询报“查询语法错误”**：运算符必须大写 `AND`/`OR`/`NOT`，括号须成对；两个词之间空格默认按 AND 处理。
- **PubMed 首次加载慢**：约 5,800 篇文档建索引需要数秒（界面会显示进度），之后的单次查询在毫秒级；若选布尔模式且查询词覆盖面很大，单次排序仍可能到几百毫秒，见[评测记录](evaluation/results.md)。
- **想换自己的 CSV**：表头带 `title`/`content` 列即可，其他列会显示在结果元信息中。
- **DSH / Codex 里工具不出现**：先运行 `npm.cmd run mcp:doctor`；宿主与路径差异见 [MCP 兼容性说明](docs/MCP兼容性.md)。
