# AI Topic Radar RAG

基于 [AI-TREND-RADAR](https://github.com/Conradgui/AI-TREND-RADAR) 日报数据构建的 **Agentic RAG + Graph RAG** 智能选题助手。

通过 Neo4j 知识图谱 + ChromaDB 向量搜索 + LangGraph Agent，你可以用自然语言对话查询历史选题数据、分析趋势、获取选题推荐。

## 它能做什么？

- **趋势分析**："最近 RAG 领域有什么新进展？"
- **话题查询**："OpenAI 最近发布了什么？"
- **选题推荐**："给我推荐几个值得深挖的选题"
- **对比分析**："中英文社区对大模型的讨论有什么不同？"
- **知识图谱**："LangChain 和哪些项目有关系？"

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
    ├── search            — 搜索任何内容（图+向量 RRF 融合）
    ├── topic_trend       — 话题趋势分析
    ├── entity_info       — 实体详情和关系网络
    ├── daily_overview    — 某日选题概览
    ├── source_coverage   — 跨数据源对比
    └── recommend         — 选题推荐
```

### 核心组件

| 组件 | 技术 | 职责 |
|------|------|------|
| 知识图谱 | Neo4j 5 | 话题、实体、来源的关系网络 |
| 向量库 | ChromaDB | 日报内容的语义嵌入和搜索 |
| Agent | LangGraph | ReAct 模式的智能对话代理 |
| 服务 | FastAPI | HTTP API + Chat UI |
| 容器 | Docker | Neo4j 数据库 |

### 知识图谱 Schema

```cypher
(:Topic {id, name, category, totalScore, mentionCount})
(:Entity {id, name, type})
(:Source {id, name, type})
(:Document {id, title, date, reportType, content})
(:DailyDigest {date, candidateCount})

(:Topic)-[:APPEARED_ON {score, action}]->(:DailyDigest)
(:Topic)-[:DISCOVERED_VIA]->(:Source)
(:Entity)-[:MENTIONS]->(:Topic)
(:Document)-[:PART_OF]->(:DailyDigest)
```

## 快速开始

### 前置条件

- Python 3.11+
- Node.js 22+（用于运行 AI-TREND-RADAR 数据管道）
- Docker（用于 Neo4j）

### 安装

```bash
# 1. 克隆本项目
git clone https://github.com/Conradgui/AI-TREND-RADAR-RAG.git
cd AI-TREND-RADAR-RAG

# 2. 配置 API Key（复用主项目的 .env）
cp .env.example .env
# 编辑 .env，填入以下内容：
#   LLM_PROVIDER=deepseek    # anthropic | openai | deepseek
#   DEEPSEEK_API_KEY=sk-xxx  # 对应 provider 的 key

# 3. 一键安装 + 启动 Neo4j
pnpm setup:rag
```

### 运行

```bash
# 生成日报数据
pnpm digest

# 摄取到 Neo4j + ChromaDB
python -m rag.ingest

# 启动 RAG 服务
python -m rag.server
# → http://localhost:8001
```

打开浏览器访问 http://localhost:8001：

1. **首次使用**：显示配置页面，填写 LLM Provider 和 API Key
2. **配置完成后**：进入 Chat 界面，开始对话

### 一键启动

```bash
# 生成数据 + 摄取 + 启动服务
pnpm digest:rag
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | Chat UI 页面 |
| `/chat` | POST | Agent 对话入口 |
| `/config` | POST | 保存 API 配置到 .env |
| `/health` | GET | 健康检查 |
| `/ingest` | POST | 触发数据摄取 |

### 对话 API

```bash
curl -X POST http://localhost:8001/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "最近有什么热门趋势？"}'
```

返回：

```json
{
  "answer": "根据最近的数据...",
  "citations": [{"date": "2026-05-28", "source": "ai-topic-radar", "excerpt": "..."}]
}
```

## 目录结构

```
rag/
├── __init__.py
├── config.py           # 配置（读取项目 .env）
├── server.py           # FastAPI 服务
├── ingest.py           # 数据摄取脚本
├── graphrag/           # Neo4j 知识图谱层
│   ├── driver.py       # Neo4j 连接管理
│   ├── schema.py       # 图 Schema 定义
│   └── builder.py      # 知识图谱构建器
├── retriever/          # 检索层
│   ├── vector_store.py # ChromaDB 向量库
│   └── hybrid.py       # 混合检索器
├── agent/              # Agent 层
│   ├── agent.py        # LangGraph ReAct Agent
│   ├── tools.py        # 6 个工具定义
│   └── prompts.py      # 系统提示词
├── web/                # Chat UI 前端
│   └── chat.html       # 对话界面
├── tests/              # 测试
├── requirements.txt
└── pyproject.toml
```

## 依赖

| 包 | 用途 |
|------|------|
| `neo4j` | Neo4j Python 驱动 |
| `langchain` | Agent 框架 |
| `langchain-openai` | OpenAI/DeepSeek LLM |
| `langchain-anthropic` | Anthropic LLM |
| `langgraph` | ReAct Agent |
| `chromadb` | 向量数据库 |
| `fastapi` | HTTP 服务 |
| `python-dotenv` | .env 配置读取 |

## 与主项目的关系

本项目是 AI-TREND-RADAR 的 **RAG 增强版**，两者的关系：

```
AI-TREND-RADAR（数据管道）          AI-TREND-RADAR-RAG（本项目）
├── 抓取 15+ 数据源                 ├── 读取 digest 数据
├── 生成日报/周报/月报              ├── 构建知识图谱
├── 输出到 digests/                 ├── 提供 Agent 对话
└── GitHub Pages 展示               └── 本地 http://localhost:8001
```

- **主项目**负责数据采集和报告生成
- **本项目**负责知识管理和智能查询
- 两者共享同一份 `.env` 配置

## 配置说明

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `LLM_PROVIDER` | `anthropic` | LLM 提供商：anthropic / openai / deepseek |
| `ANTHROPIC_API_KEY` | — | Anthropic API Key |
| `OPENAI_API_KEY` | — | OpenAI API Key |
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j 连接地址 |
| `NEO4J_USER` | `neo4j` | Neo4j 用户名 |
| `NEO4J_PASSWORD` | `password` | Neo4j 密码 |
| `RAG_PORT` | `8001` | RAG 服务端口 |

## License

MIT
