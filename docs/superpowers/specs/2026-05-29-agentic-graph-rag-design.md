# Agentic RAG + Graph RAG 系统设计文档

## Context

AI Topic Radar 项目目前是一个数据采集+日报生成工具。用户希望将其升级为一个更完整的 AI 选题平台，增加 Agentic RAG + Graph RAG 能力，让用户可以通过自然语言对话查询历史选题数据、分析趋势、获取选题推荐。

方案参考 Pinecone Nexus 的"预编译知识制品"（compile-once, serve-many）理念，使用 Neo4j 官方 `neo4j-graphrag-python` 包构建知识图谱，LangGraph 构建 Agent。

## 用户需求

1. 在现有 Web UI 上添加 Agent 对话面板（右侧滑出）
2. Agent 的 API key 复用项目现有的 `.env` 配置
3. RAG 系统作为独立本地版本，用户 clone 后本地部署
4. 部署流程简化为两步：`pnpm setup:rag` + `pnpm digest`

## 技术方案选择

- **方案 A（已确认）**：使用 `neo4j-graphrag-python` 官方包 + LangGraph Agent
- **方案 C（已确认）**：Docker 管 Neo4j，RAG Server 本地 Python 跑，pnpm 命令驱动

## 架构设计

### 整体架构

```
pnpm digest (现有 TS 管道，不变)
    ↓ 生成 digests/YYYY-MM-DD/*.md + topic-pool.json
    ↓ 自动触发 Python 摄取
python -m rag.server (Python RAG 服务, http://localhost:8001)
    ├── 摄取层：neo4j-graphrag SimpleKGPipeline
    │   └── LLM 实体抽取 → Neo4j 知识图谱 + 向量索引
    ├── 存储层
    │   ├── Neo4j（知识图谱 + 向量索引 + 全文索引）
    │   └── ChromaDB（文档向量存储）
    ├── 检索层：HybridRetriever（向量 + BM25 + 图）
    ├── Agent 层：LangGraph ReAct Agent
    │   ├── graph_search 工具
    │   ├── vector_search 工具
    │   ├── trend_analysis 工具
    │   └── topic_recommend 工具
    └── Web UI：右侧滑出 Chat 面板
```

### 目录结构

```
AI-TREND-RADAR/
├── src/                    # 现有 TS 管道（不变）
├── digests/                # 日报数据（共享：TS 生成，Python 读取）
├── rag/                    # 新增 RAG 系统
│   ├── __init__.py
│   ├── server.py           # FastAPI 服务入口
│   ├── ingest.py           # 摄取脚本入口
│   ├── config.py           # 配置（读取项目 .env）
│   ├── ingestion/          # 数据摄取层
│   │   ├── __init__.py
│   │   ├── pipeline.py     # 摄取编排器
│   │   ├── topic_pool_loader.py
│   │   ├── report_loader.py
│   │   └── kg_builder.py   # Neo4j GraphRAG 构建器
│   ├── graph/              # 图数据库层
│   │   ├── __init__.py
│   │   ├── driver.py       # Neo4j 连接管理
│   │   ├── schema.py       # 图 schema 定义
│   │   └── queries.py      # Cypher 查询模板
│   ├── retriever/          # 检索层
│   │   ├── __init__.py
│   │   ├── vector_store.py # ChromaDB 封装
│   │   ├── hybrid.py       # 混合检索器
│   │   └── typed_queries.py
│   ├── agent/              # Agent 层
│   │   ├── __init__.py
│   │   ├── agent.py        # LangGraph ReAct Agent
│   │   ├── tools.py        # 4 个工具定义
│   │   └── prompts.py      # Agent 系统提示词
│   ├── web/                # Chat UI 前端
│   │   ├── __init__.py
│   │   └── chat.html       # Chat 面板 HTML/JS
│   ├── data/               # 持久化数据
│   │   ├── chroma/         # ChromaDB 存储
│   │   └── artifacts/      # 预编译制品缓存
│   ├── tests/
│   ├── requirements.txt
│   └── pyproject.toml
├── docker-compose.yml      # Neo4j 容器
├── .env                    # 共用 API 配置
└── package.json            # 增加 setup:rag 命令
```

### 知识图谱 Schema

**节点类型：**

```cypher
(:Topic {id, name, category, totalScore, mentionCount, firstSeen, lastSeen})
(:Entity {id, name, type: "company|person|project|product", description})
(:Source {id, name, type: "international|chinese|official"})
(:Document {id, title, date, reportType, content})
(:Chunk {id, text, index, embedding})
(:DailyDigest {date, candidateCount, generatedAt})
```

**关系类型：**

```cypher
(:Document)-[:HAS_CHUNK]->(:Chunk)
(:Chunk)-[:MENTIONS]->(:Entity)
(:Chunk)-[:MENTIONS]->(:Topic)
(:Topic)-[:APPEARED_ON {score}]->(:DailyDigest)
(:Topic)-[:RELATED_TO {weight}]->(:Topic)
(:Entity)-[:RELATES_TO {confidence, source}]->(:Entity)
(:Document)-[:PUBLISHED_BY]->(:Source)
```

**索引：**

```cypher
CREATE CONSTRAINT topic_id FOR (t:Topic) REQUIRE t.id IS UNIQUE
CREATE CONSTRAINT entity_id FOR (e:Entity) REQUIRE e.id IS UNIQUE
CREATE FULLTEXT INDEX entity_search FOR (e:Entity) ON EACH [e.name, e.description]
CREATE VECTOR INDEX chunk_embeddings FOR (c:Chunk) ON (c.embedding)
```

### Agent 工具系统

| 工具 | 输入 | 功能 |
|------|------|------|
| `graph_search` | 查询描述 | Neo4j 知识图谱查询：话题关系、实体网络 |
| `vector_search` | 查询文本 | ChromaDB 语义搜索：在所有报告中按语义查找 |
| `trend_analysis` | 话题名 + 天数 | 话题趋势：分数变化、热度走向 |
| `topic_recommend` | 可选分类 | 选题推荐：基于评分和趋势推荐 |

### Chat UI 设计

**位置：** 右侧滑出面板，宽度 380px，覆盖在内容区上
**触发：** Header "🤖 Agent" 按钮
**交互：** 输入框 + 发送按钮，消息列表支持 markdown 渲染，引用可点击跳转

### 部署流程

```bash
# 1. 克隆 + 配置
git clone https://github.com/Conradgui/AI-TREND-RADAR.git
cd AI-TREND-RADAR
cp .env.example .env  # 填入 LLM_PROVIDER 和 API_KEY

# 2. 安装依赖 + 启动 Neo4j
pnpm setup:rag

# 3. 运行管道 + 自动摄取 + 启动服务
pnpm digest:rag
```

其中：
- `pnpm setup:rag` = `pip install -r rag/requirements.txt && docker-compose up -d`
- `pnpm digest:rag` = `pnpm start && pnpm manifest && python -m rag.ingest && python -m rag.server`

### API key 复用机制

`rag/config.py` 使用 `python-dotenv` 读取项目根目录的 `.env` 文件，复用以下变量：
- `LLM_PROVIDER` — 选择 LLM 提供商
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` — API 密钥
- `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` — Neo4j 连接信息

### UI 配置 API Key

首次启动时自动检测 `.env` 是否已配置 API key：
- **已配置**：直接进入 Chat 界面
- **未配置**：显示配置页面（Provider 下拉选择 + API Key 密码输入框 + Neo4j 连接信息）

配置页面流程：
1. 用户选择 LLM Provider（anthropic / openai / deepseek）
2. 输入对应的 API Key（密码框，隐藏内容）
3. 输入 Neo4j 连接信息（默认 `bolt://localhost:7687`，`neo4j/password`）
4. 点击"保存并启动"
5. 后端接收配置 → 写入 `.env` 文件 → 重启服务

安全措施：
- Key 通过 HTTPS POST 发送到后端，不经过浏览器 localStorage
- 后端 API 不暴露 GET 端点返回 key 内容
- UI 使用 `type="password"` 输入框
- `.env` 已在 `.gitignore` 中

### 摄取流程

1. 读取 `digests/` 下所有日期目录
2. 解析每个日期的 `topic-pool.json`（结构化数据）
3. 解析每个日期的 `.md` 报告（非英文、非汇总报告）
4. 使用 `neo4j-graphrag` 的 `SimpleKGPipeline` 从文本中抽取实体和关系
5. 将实体和关系写入 Neo4j
6. 将文档 chunk 嵌入并存储到 ChromaDB
7. 构建预编译制品（话题趋势、实体关系图）缓存到 `rag/data/artifacts/`

### 查询流程

1. 用户在 Chat 面板输入问题
2. FastAPI `/chat` 端点接收请求
3. LangGraph ReAct Agent 分析用户意图
4. Agent 自动选择合适的工具（graph_search / vector_search / trend_analysis / topic_recommend）
5. 工具执行查询，返回结果
6. Agent 综合工具结果，调用 LLM 生成回答
7. 返回 `{answer, citations}` 给浏览器

## 关键依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `neo4j` | >=5.25.0 | Neo4j Python 驱动 |
| `neo4j-graphrag` | latest | Neo4j 官方 GraphRAG 包（含 SimpleKGPipeline、HybridRetriever） |
| `langchain` | >=0.3.0 | Agent 框架 |
| `langchain-openai` | >=0.3.0 | OpenAI/DeepSeek LLM 封装 |
| `langchain-anthropic` | >=0.3.0 | Anthropic LLM 封装 |
| `langgraph` | >=0.2.0 | ReAct Agent 实现 |
| `chromadb` | >=0.5.0 | 向量数据库 |
| `fastapi` | >=0.115.0 | HTTP 服务 |
| `uvicorn` | >=0.32.0 | ASGI 服务器 |
| `python-dotenv` | >=1.0.0 | .env 文件读取 |

## 验证方案

```bash
# 1. 启动服务
pnpm setup:rag
pnpm digest:rag

# 2. 打开浏览器测试
# http://localhost:8001 → 点击 Agent 按钮 → 输入 "最近有什么热门趋势？"

# 3. 验证 Neo4j 数据
# http://localhost:7474 → 登录 neo4j/password → 查询 MATCH (n) RETURN count(n)

# 4. 验证 API
curl -X POST http://localhost:8001/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"最近 RAG 领域有什么新进展？"}'
```
