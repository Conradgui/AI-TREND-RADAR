# AI Trend Radar

面向 AI 内容运营和产品调研的热点选题监控工具。它会每天抓取公开 AI 信号（国内外共 15+ 数据源），生成一份中文"值得写、值得测、值得深挖"的选题池，并通过 HTML、Web UI、RSS、Telegram、飞书和 GitHub Actions 分发。

它不是一个简单的信息搬运脚本，而是把分散的 AI 行业信号转成可排序、可解释、可交付的选题决策流：先采集公开证据，再用评分框架判断优先级，最后沉淀成报告、结构化数据和自动化分发链路。

本项目基于 [`duanyytop/agents-radar`](https://github.com/duanyytop/agents-radar) 改造。

> **RAG 版本**：本项目还有一个 [AI-TREND-RADAR-RAG](https://github.com/Conradgui/AI-TREND-RADAR-RAG) 版本，基于 Neo4j 知识图谱 + ChromaDB 向量搜索构建了 Agentic RAG 系统，支持通过自然语言对话查询历史选题数据。

## 5 分钟理解

### 它解决什么问题？

每天 AI 信息源很多：新模型、新产品、开源项目、论文、Hacker News 讨论、大厂官网发布、国内外社区文章。AI Topic Radar 把这些公开信号聚合成一个可操作的内容选题池，帮助你判断：

- 今天哪些 AI 话题值得优先深挖？
- 哪些产品或开源项目值得进入选题池？
- 中英文社区对同一话题的讨论有何异同？
- 哪些数据源失败了，应该怎么修？

### 最终会产出什么？

| 文件 | 用途 |
| --- | --- |
| `digests/YYYY-MM-DD/ai-topic-radar.html` | 主报告，可双击打开 |
| `digests/YYYY-MM-DD/ai-topic-radar.md` | Markdown 版本 |
| `digests/YYYY-MM-DD/topic-pool.json` | 结构化选题池（分数、分类、动作、理由、证据） |
| `digests/YYYY-MM-DD/ai-china-tech.md` | 中文科技社区 AI 动态日报（36kr + InfoQ + Gitee + OSChina + 掘金） |
| `manifest.json` | 历史 Web UI 索引 |
| `feed.xml` | RSS 订阅源 |

### 适合谁？

- AI 内容运营：每天做热点日报、社群内容、选题池
- AI 产品研究：跟踪新产品、新模型和竞品动态
- 技术/开源观察者：追踪 GitHub、Hacker News、arXiv、国内外社区信号

## 最快跑通

```bash
# 1. 安装依赖
pnpm install --frozen-lockfile

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 LLM_PROVIDER 和对应 API_KEY

# 3. 运行
pnpm digest
```

成功后打开 `digests/YYYY-MM-DD/ai-topic-radar.html`。

查看历史看板：`pnpm serve` → http://localhost:8080

## 数据源（15+ 个）

### 国际数据源

| 来源 | 内容 | 配置 |
| --- | --- | --- |
| GitHub Trending | 每日热门开源仓库 | 无需 token |
| GitHub Search | `llm`、`ai-agent`、`rag` 等关键词 | 推荐 `GITHUB_TOKEN` |
| Hacker News | AI / LLM 社区讨论 | 无需 token |
| Product Hunt | AI 产品发布 | 需要 `PRODUCTHUNT_TOKEN` |
| arXiv | `cs.AI`、`cs.CL`、`cs.LG` 论文 | 无需 token |
| Hugging Face | 热门模型和下载/点赞信号 | 无需 token |
| OpenAI 官网 | 官方发布、产品更新 | 无需 token |
| Anthropic 官网 | Claude、模型、安全动态 | 无需 token |
| **Google DeepMind** | 研究博客、论文、产品发布 | 无需 token |
| Dev.to | 技术社区文章 | 无需 token |
| Lobsters | 技术社区讨论 | 无需 token |

### 国内数据源

| 来源 | 内容 | 访问方式 |
| --- | --- | --- |
| 36kr | AI 行业新闻 | RSS feed |
| InfoQ 中国 | 技术深度文章 | 内部 API |
| Gitee | 热门 AI 开源项目 | REST API v5 |
| 开源中国 | 技术资讯 | RSS feed |
| 稀土掘金 | 开发者技术文章 | 内部 API |

五个国内源合并为一份 `ai-china-tech.md` 报告（中英文版本），并同时纳入选题评分。

某个来源失败不会中断日报，主报告会在"数据源状态与修复提示"里说明原因。

## 功能模块总览

| 模块 | 能力 | 默认 |
| --- | --- | --- |
| 数据采集 | 15+ 国内外源（GitHub、HN、arXiv、HF、官网、36kr、掘金等） | 是 |
| LLM 摘要 | DeepSeek / Anthropic / OpenAI / OpenRouter / GitHub Copilot | 是 |
| 选题评分 | 商业影响 40、热度 30、新鲜度 20、可写性 10 | 是 |
| 内容分类 | 政策监管、模型突破、AI 产品、行业落地、标杆企业与商业格局 | 是 |
| 中文科技社区报告 | `ai-china-tech.md`（36kr + InfoQ + Gitee + OSChina + 掘金） | 是 |
| 源级报告 | `ai-web.md`、`ai-hn.md`、`ai-arxiv.md` 等 | 默认关闭 |
| 英文报告 | `*-en.md` | 默认关闭 |
| 历史 Web UI | `index.html` + `manifest.json` | 是 |
| RSS | `feed.xml` | 是 |
| Telegram / 飞书 | 通知推送 | 需 token |
| GitHub Actions | 每日 / 每周 / 每月自动运行 | 是 |

## 选题评分

```text
总分 = 商业影响（40）+ 热度（30）+ 新鲜度（20）+ 可写性（10）
```

| 分数 | 动作 |
| ---: | --- |
| 80+ | 深挖 |
| 65-79 | 入池 |
| 50-64 | 观察 |
| < 50 | 归档 |

五类分类：
- 政策监管、社会影响与 AI 安全
- 模型与技术突破
- AI 产品与用户入口
- 企业落地与行业应用
- 标杆企业动向、商业格局与投融资

## 三种使用方式

### 方式一：本地使用

```bash
pnpm digest
# 打开 digests/YYYY-MM-DD/ai-topic-radar.html
```

### 方式二：GitHub Actions 自动日报

1. 配置 `DEEPSEEK_API_KEY` 为仓库 Secret
2. 进入 `Actions -> Daily AI Topic Radar -> Run workflow`
3. 成功后仓库自动生成新的 digest 文件

### 方式三：GitHub Pages 公开分享

1. `Settings -> Pages` → Source 选择 `GitHub Actions`
2. 等待日报 workflow 成功后自动部署
3. 访问 https://conradgui.github.io/AI-TREND-RADAR

## 自动化

| Workflow | 时间 |
| --- | --- |
| Daily | 每天 08:00 CST |
| Weekly | 每周一 09:00 CST |
| Monthly | 每月 1 日 10:00 CST |

通知：Telegram / 飞书 / SMTP 邮箱。未配置 token 时自动跳过。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm digest` | 生成主报告 + manifest + RSS |
| `pnpm start` | 只生成日报文件 |
| `pnpm manifest` | 更新 manifest.json 和 feed.xml |
| `pnpm serve` | 本地查看历史 Web UI |
| `pnpm weekly` | 生成周报 |
| `pnpm monthly` | 生成月报 |
| `pnpm test` | 单元测试（224 个） |
| `pnpm typecheck` | TypeScript 类型检查 |

## 验证状态

- TypeScript typecheck: 通过
- ESLint: 通过
- 单元测试: 224/224 通过

## 作品集边界

本仓库只使用公开信息源和可复现代码，不包含公司内部资料、私有社群内容、API key 或未公开报告。它用于展示一个可公开复现的 AI 热点监控、选题评分、日报生成和自动分发工作流。

## License

MIT
