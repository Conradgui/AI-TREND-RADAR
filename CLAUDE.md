# CLAUDE.md

## Project overview

AI Topic Radar is a daily AI topic discovery workflow for public-source monitoring, Chinese editorial topic scoring, and Markdown/JSON topic-pool output. A GitHub Actions cron job runs at 00:00 UTC (08:00 CST), gathers public AI signals, and produces digest files under `digests/YYYY-MM-DD/`.

## Commands

```bash
pnpm start          # run the full digest locally
pnpm test           # vitest (unit tests)
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint
pnpm lint:fix       # ESLint --fix
pnpm format         # Prettier --write src
pnpm format:check   # Prettier --check src
```

Required env vars for local runs:

```bash
export GITHUB_TOKEN=ghp_xxxxx
export DIGEST_REPO=owner/repo   # omit to skip GitHub issue creation

# LLM provider (default: anthropic)
export LLM_PROVIDER=deepseek    # anthropic | openai | github-copilot | openrouter | deepseek
export DEEPSEEK_API_KEY=sk-xxxxx
export DEEPSEEK_MODEL=deepseek-chat

# Anthropic (default)
export ANTHROPIC_API_KEY=sk-ant-xxxxx
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/  # omit for Anthropic

# OpenAI
# export OPENAI_API_KEY=sk-xxxxx

# GitHub Copilot — uses GITHUB_TOKEN

# OpenRouter
# export OPENROUTER_API_KEY=sk-or-xxxxx
```

## Architecture

The pipeline runs in four sequential phases, each implemented as a named async function in `src/index.ts`:

1. **`fetchAllData`** — all network I/O in parallel: GitHub API (issues/PRs/releases), Claude Code Skills, Anthropic/OpenAI sitemaps, GitHub Trending HTML + Search API, Hacker News Algolia API, Product Hunt, arXiv, Hugging Face, Dev.to, and Lobsters.
2. **`generateSummaries`** — per-repo LLM calls, all in parallel, rate-limited to 5 concurrent requests by a queue in `src/report.ts`.
3. **Comparisons** — two LLM calls: cross-tool CLI comparison and OpenClaw cross-ecosystem comparison.
4. **Save phase** — `buildCliReportContent` / `buildOpenclawReportContent` (in `src/report-builders.ts`) build Markdown strings; `saveWebReport` / `saveTrendingReport` / `saveHnReport` (in `src/report-savers.ts`) call LLM + write file + create GitHub Issue; `buildTopicRadar` / `saveTopicRadar` (in `src/topic-radar.ts`) generate the Chinese editorial topic pool and JSON state.

## Source files

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Orchestration: repo config, phase functions, `main()` |
| `src/i18n.ts` | Centralized bilingual strings: `Lang` type, report titles, issue labels, footer text, `REPORT_LABELS`, `NOTIFY_LABELS` |
| `src/github.ts` | GitHub API helpers: `fetchRecentItems`, `fetchRecentReleases`, `fetchSkillsData`, `createGitHubIssue`; shared `RepoFetch` type |
| `src/prompts.ts` | LLM prompt builders for repo reports: `buildCliPrompt`, `buildPeerPrompt`, `buildComparisonPrompt`, `buildPeersComparisonPrompt`, `buildSkillsPrompt` |
| `src/prompts-data.ts` | LLM prompt builders for data-source reports: `buildTrendingPrompt`, `buildWebReportPrompt`, `buildHnPrompt`, `buildWeeklyPrompt`, `buildMonthlyPrompt` |
| `src/report.ts` | `callLlm` (with concurrency limiter), `saveFile`, `autoGenFooter` (uses i18n), LLM token budget constants |
| `src/report-builders.ts` | `buildCliReportContent`, `buildOpenclawReportContent` — assemble final Markdown strings for CLI and OpenClaw reports |
| `src/report-savers.ts` | `saveWebReport`, `saveTrendingReport`, `saveHnReport` — LLM call + file save + optional GitHub issue |
| `src/date.ts` | Date and timing utilities: `toCstDateStr`, `toUtcStr`, `sleep` |
| `src/rollup.ts` | Weekly and monthly rollup report generator |
| `src/providers/types.ts` | `LlmProvider` interface, `ProviderName` type, `VALID_PROVIDER_NAMES` |
| `src/providers/openai-compatible.ts` | `OpenAICompatibleProvider` — shared base class for OpenAI-compatible providers |
| `src/providers/anthropic.ts` | `AnthropicProvider` — Anthropic SDK wrapper |
| `src/providers/openai.ts` | `OpenAIProvider` — extends `OpenAICompatibleProvider` |
| `src/providers/github-copilot.ts` | `GitHubCopilotProvider` — extends `OpenAICompatibleProvider` |
| `src/providers/openrouter.ts` | `OpenRouterProvider` — extends `OpenAICompatibleProvider` |
| `src/providers/index.ts` | `createProvider` factory + barrel re-exports |
| `src/web.ts` | Sitemap-based web content fetching; state persisted to `digests/web-state.json` |
| `src/trending.ts` | GitHub Trending HTML scraper + Search API topic queries |
| `src/hn.ts` | Hacker News top AI stories via Algolia HN Search API |
| `src/generate-manifest.ts` | Generates `manifest.json` (sidebar data for Web UI) and `feed.xml` (RSS 2.0 feed) |
| `src/topic-radar.ts` | Normalizes source data into an editorial topic pool, scores topics, and writes `ai-topic-radar.md` / `topic-pool.json` |
| `src/kr36.ts` | 36kr AI news articles fetched via RSS feed |
| `src/infoq-cn.ts` | InfoQ China AI articles fetched via internal API |
| `src/gitee.ts` | Gitee popular AI projects fetched via REST API v5 |
| `src/oschina.ts` | OSChina AI news fetched via RSS feed |
| `src/juejin.ts` | Juejin (稀土掘金) AI articles fetched via internal API |
| `src/china-sources.ts` | Unified wrapper for all Chinese data sources |
| `src/rss-utils.ts` | Shared RSS/XML parsing utilities |

## Report outputs

Files written to `digests/YYYY-MM-DD/`:

| File | Label | Notes |
|------|-------|-------|
| `ai-cli.md` | `digest` | Always generated |
| `ai-topic-radar.md` | `AI 热点选题池` | Decision-first topic pool for daily editorial use |
| `topic-pool.json` | structured state | Topic score, action, category, reason, evidence, and generation date |
| `ai-agents.md` | `openclaw` | Always generated |
| `ai-web.md` | `web` | Skipped if no new sitemap content (Anthropic + OpenAI + DeepMind) |
| `ai-trending.md` | `trending` | Skipped if both data sources fail |
| `ai-hn.md` | `hn` | Skipped if Algolia fetch fails |
| `ai-ph.md` | `ph` | Skipped if Product Hunt token not set |
| `ai-arxiv.md` | `arxiv` | ArXiv AI research papers |
| `ai-hf.md` | `hf` | Hugging Face trending models |
| `ai-community.md` | `community` | Dev.to + Lobsters combined |
| `ai-china-tech.md` | `china-tech` | 36kr + InfoQ + Gitee + OSChina + Juejin combined |

## Tracked sources

- **CLI_REPOS** (9): claude-code, codex, gemini-cli, copilot-cli, kimi-cli, opencode, pi, qwen-code, deepseek-tui
- **OPENCLAW** + **OPENCLAW_PEERS** (13): openclaw/openclaw + 12 peer projects (sorted by stars)
- **CLAUDE_SKILLS_REPO**: anthropics/skills — no date filter, sorted by popularity
- **Web**: anthropic.com + openai.com + deepmind.google via sitemap, state in `digests/web-state.json`
- **Trending**: github.com/trending (HTML) + GitHub Search API (6 AI topics, 7-day window)
- **HN**: Algolia HN Search API — 6 parallel queries, top-30 AI stories by points, last 24h
- **Chinese sources**: 36kr (RSS), InfoQ China (API), Gitee (REST API), OSChina (RSS), Juejin (API) — combined into `ai-china-tech.md`

## Key conventions

- All bilingual strings (titles, labels, footers, messages) are centralized in `src/i18n.ts`. Use the `Lang` type (`"zh" | "en"`) and `Record<Lang, string>` maps. Do not add inline bilingual ternaries elsewhere.
- LLM prompt builders are split across two files: `src/prompts.ts` (repo-level prompts) and `src/prompts-data.ts` (data-source and rollup prompts). Each report type has its own builder function.
- `callLlm(prompt, maxTokens?)` defaults to 4096 tokens. Web report uses 8192, trending uses 6144. HN report uses the default 4096.
- On 429 rate-limit errors `callLlm` retries up to 3 times with exponential backoff (5 s / 10 s / 20 s); the concurrency slot is released during the wait.
- The concurrency limiter (`LLM_CONCURRENCY = 5`) prevents 429s when many parallel LLM calls fire. Do not bypass it by calling SDK clients directly.
- LLM provider is selected via `LLM_PROVIDER` env var (default: `anthropic`). Valid values: `anthropic`, `openai`, `github-copilot`, `openrouter`, `deepseek`.
- Provider implementations live in `src/providers/`. Each file implements the `LlmProvider` interface. The factory in `src/providers/index.ts` validates the provider name and logs only the provider name — never API keys or endpoint URLs.
- GitHub issue label colors are defined in `LABEL_COLORS` in `src/github.ts`. Add new labels there.
- `sampleNote(total, sampled)` in `src/prompts.ts` formats the "(共 N 条，展示前 M 条)" note. Reuse it — do not inline the same string format.
- Web state (`digests/web-state.json`) is committed to git on every run. It is the source of truth for which URLs have been seen.

## Web UI & RSS Feed

- Web UI: `index.html` reads `manifest.json` to build the sidebar, then fetches `digests/YYYY-MM-DD/report.md` on demand.
- RSS Feed: `feed.xml` at the repo root. Generated by `src/generate-manifest.ts` in the same `pnpm manifest` step. Contains the latest 30 items (newest first) across all report types. Item links use hash routing: `https://conradgui.github.io/AI-TREND-RADAR/#YYYY-MM-DD/report`.
- Both `manifest.json` and `feed.xml` are committed together in the "Commit manifest and feed" GHA step.
- The `REPORT_LABELS` map in `src/i18n.ts` must be kept in sync with the `LABELS` object in `index.html` when adding new report types.

## Adding a new report type

1. Create a data fetcher (or add to an existing one).
2. Add a `buildXxxPrompt` function in `src/prompts-data.ts` (for data-source prompts) or `src/prompts.ts` (for repo-level prompts).
3. Add bilingual strings (titles, labels, issue title function) to `src/i18n.ts`.
4. Add a `saveXxxReport` function in `src/report-savers.ts`.
5. Wire into `fetchAllData`, `generateSummaries`, and the save phase in `src/index.ts`.
6. Add a label color entry in `LABEL_COLORS` in `src/github.ts`.
7. Add the report ID and label to `REPORT_LABELS` in `src/i18n.ts` and `LABELS` in `index.html`.
8. Add the report file name to `REPORT_FILES` in `src/generate-manifest.ts`.
9. Update both README files and this file.

## RAG System (AI-TREND-RADAR-RAG)

The project has a companion [AI-TREND-RADAR-RAG](https://github.com/Conradgui/AI-TREND-RADAR-RAG) repository with a full Agentic RAG + Graph RAG system. It reads the digest data produced by this pipeline and provides intelligent query capabilities.

### RAG Architecture

```
pnpm digest (this repo) → digests/YYYY-MM-DD/*.md + topic-pool.json
        ↓
python -m rag.ingest → Neo4j knowledge graph + ChromaDB vector store
        ↓
python -m rag.server → http://localhost:8001 (Chat UI + API)
        ↓
LangGraph ReAct Agent with 6 tools:
  ├── search (hybrid vector + graph RRF)
  ├── topic_trend (Neo4j time series)
  ├── entity_info (entity + relationships)
  ├── daily_overview (daily topic summary)
  ├── source_coverage (cross-source comparison)
  └── recommend (scored recommendations)
```

### Setup

```bash
# In the RAG repo
cp .env.example .env  # reuse same LLM_PROVIDER + API_KEY
pnpm setup:rag        # pip install + docker neo4j
pnpm digest           # generate data
python -m rag.server  # http://localhost:8001
```

### Key files (in RAG repo)

| File | Role |
|------|------|
| `rag/server.py` | FastAPI: /chat, /config, /health, /ingest |
| `rag/ingest.py` | CLI: ingests digests into Neo4j + ChromaDB |
| `rag/graphrag/builder.py` | Knowledge graph construction |
| `rag/agent/agent.py` | LangGraph ReAct agent |
| `rag/agent/tools.py` | 4 tool definitions |
| `rag/web/chat.html` | Chat UI + config page |
| `docker-compose.yml` | Neo4j 5 container |

### Lightweight Chat (MCP Worker)

For GitHub Pages deployment, the MCP Worker at `mcp/src/index.ts` provides a simpler `/chat` endpoint that does keyword-based RAG over the published digest data. Set `LLM_API_KEY` and `LLM_PROVIDER` as Cloudflare Worker secrets.
