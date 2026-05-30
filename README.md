# AI Trend Radar RAG

在 [AI Trend Radar](https://github.com/Conradgui/AI-TREND-RADAR) 每日数据管道的基础上，构建 **Agentic RAG + Graph RAG** 智能选题助手。

---

AI Trend Radar 面向 AI 内容运营和产品调研，每天抓取公开 AI 信号（国内外共 15+ 数据源），生成一份中文"值得写、值得测、值得深挖"的选题池，并通过 HTML、Web UI、RSS、Telegram、飞书和 GitHub Actions 分发。它不是一个简单的信息搬运脚本，而是把分散的 AI 行业信号转成可排序、可解释、可交付的选题决策流：先采集公开证据，再用评分框架判断优先级，最后沉淀成报告、结构化数据和自动化分发链路。

**RAG 版本在此基础上增加了智能对话能力**——通过 Neo4j 知识图谱构建选题实体之间的关系网络，通过 ChromaDB 向量搜索实现跨报告的语义检索，再由 LangGraph ReAct Agent 编排多个检索工具，让用户可以用自然语言直接查询历史选题数据、分析趋势、获取选题推荐。

## 它能做什么？

| 能力 | 示例问题 |
|------|----------|
| 趋势分析 | "最近 RAG 领域有什么新进展？" |
| 话题查询 | "OpenAI 最近发布了什么？" |
| 选题推荐 | "给我推荐几个值得深挖的选题" |
| 跨源对比 | "中英文社区对大模型的讨论有什么不同？" |
| 关系图谱 | "LangChain 和哪些项目有关系？" |

## 架构

```
AI-TREND-RADAR（数据管道）
    pnpm digest → digests/YYYY-MM-DD/*.md + topic-pool.json
        ↓
AI-TREND-RADAR-RAG（本项目）
    python -m rag.ingest → Neo4j 知识图谱 + ChromaDB 向量库
    python -m rag.server  → http://localhost:8001（Chat UI + API）
        ↓
LangGraph ReAct Agent（6 个工具）
    ├── search            — 搜索任何内容（自动混合图+向量 RRF 融合）
    ├── topic_trend       — 话题趋势分析（分数变化、热度走向）
    ├── entity_info       — 实体详情和关系网络
    ├── daily_overview    — 某日选题概览
    ├── source_coverage   — 跨数据源对比分析
    └── recommend         — 选题推荐（基于评分和趋势）
```

### 核心设计思路

**Agentic RAG（智能检索增强生成）**：不是简单的"检索 + 回答"，而是让 Agent 自主决定何时检索、用哪个工具检索、如何综合多次检索结果。当用户问"最近有什么趋势"时，Agent 会先用 `recommend` 获取热门选题，再用 `topic_trend` 分析变化，最后综合生成回答。

**Graph RAG（图谱检索增强生成）**：通过 Neo4j 知识图谱把分散的选题数据组织成结构化的关系网络。话题通过 `APPEARED_ON` 关系连接到日期，通过 `DISCOVERED_VIA` 连接到数据源，实体通过 `MENTIONS` 连接到话题。这让 Agent 不仅能搜索内容，还能查询关系——"谁和谁有关"、"某个话题在哪些源出现过"。

## 快速开始

### 前置条件

- Python 3.11+
- Docker（用于 Neo4j）
- 一个 LLM API Key（DeepSeek / OpenAI / Anthropic 均可）

### 安装与运行

```bash
# 1. 克隆项目
git clone https://github.com/Conradgui/AI-TREND-RADAR-RAG.git
cd AI-TREND-RADAR-RAG

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，设置 LLM_PROVIDER 和对应的 API_KEY

# 2b.（可选）配置 Gitee Token 以获取 Gitee 热门项目数据
# 前往 https://gitee.com/profile/personal_access_tokens 创建只读 Token
# 在 .env 中取消注释并填入：GITEE_TOKEN=your_token
# 如需在 GitHub Actions 中使用，还需在仓库 Settings → Secrets 中添加 GITEE_TOKEN

# 3. 安装依赖 + 启动 Neo4j
pnpm setup:rag

# 4. 生成数据 + 摄取 + 启动服务
pnpm digest
python -m rag.ingest
python -m rag.server

# 5. 打开浏览器
# http://localhost:8001
```

首次打开会显示配置页面，填写 LLM Provider 和 API Key 后进入 Chat 界面。

## 技术栈

| 层 | 技术 | 用途 |
|---|------|------|
| 知识图谱 | Neo4j 5 | 话题、实体、来源的关系网络 |
| 向量库 | ChromaDB | 日报内容的语义嵌入和搜索 |
| Agent 框架 | LangGraph | ReAct 模式的智能对话代理 |
| LLM | LangChain | Anthropic / OpenAI / DeepSeek 封装 |
| 后端 | FastAPI | HTTP API 服务 |
| 前端 | 原生 HTML/JS | 对话界面（marked.js 渲染 Markdown） |
| 数据管道 | TypeScript (原有) | 15+ 数据源采集 + 日报生成 |
| 容器 | Docker | Neo4j 数据库 |

## 知识图谱 Schema

```cypher
-- 节点
(:Topic {id, name, category, totalScore, mentionCount, firstSeen, lastSeen})
(:Entity {id, name, type})
(:Source {id, name, type: "international"|"chinese"|"official"})
(:Document {id, title, date, reportType, content})
(:DailyDigest {date, candidateCount, generatedAt})

-- 关系
(:Topic)-[:APPEARED_ON {score, action}]->(:DailyDigest)
(:Topic)-[:DISCOVERED_VIA]->(:Source)
(:Entity)-[:MENTIONS]->(:Topic)
(:Document)-[:PART_OF]->(:DailyDigest)

-- 索引
CREATE CONSTRAINT topic_id FOR (t:Topic) REQUIRE t.id IS UNIQUE
CREATE FULLTEXT INDEX entity_search FOR (e:Entity) ON EACH [e.name, e.description]
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | Chat UI 页面 |
| `/chat` | POST | Agent 对话入口 |
| `/config` | POST | 保存 API 配置 |
| `/health` | GET | 健康检查 |
| `/ingest` | POST | 触发数据摄取 |

## 目录结构

```
rag/
├── config.py           # 配置（读取项目 .env）
├── server.py           # FastAPI 服务入口
├── ingest.py           # 数据摄取脚本
├── graphrag/           # Neo4j 知识图谱层
│   ├── driver.py       # 连接管理
│   ├── schema.py       # Schema 定义
│   └── builder.py      # 图谱构建器
├── retriever/          # 检索层
│   ├── vector_store.py # ChromaDB 向量库
│   └── hybrid.py       # 混合检索器
├── agent/              # Agent 层
│   ├── agent.py        # LangGraph ReAct Agent
│   ├── tools.py        # 6 个工具定义
│   └── prompts.py      # 系统提示词
├── web/                # Chat UI
│   └── chat.html       # 对话界面 + 配置页面
└── tests/              # 测试
```

## 与 AI Trend Radar 的关系

```
AI-TREND-RADAR（数据管道）          AI-TREND-RADAR-RAG（本项目）
├── 抓取 15+ 数据源                 ├── 读取 digest 数据
├── 生成日报/周报/月报              ├── 构建知识图谱 + 向量索引
├── 输出到 digests/                 ├── 提供 Agent 对话
├── GitHub Pages 展示               └── 本地 http://localhost:8001
└── 评分框架（商业影响/热度/新鲜度）
```

两个项目共享同一份 `.env` 配置和 `digests/` 数据目录。

## 架构参考

本项目的知识图谱设计参考了 **Pinecone Nexus** 的"知识引擎"理念——将分散的数据预编译为结构化的知识制品，让 Agent 查询时直接获取已组织好的知识，而非每次从原始文档中检索。当前实现已完成基础的图谱构建和混合检索层，后续将持续迭代预编译知识制品和声明式查询等高级特性。

## License

MIT
