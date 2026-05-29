/**
 * AI Topic Radar MCP Server — Cloudflare Worker
 *
 * Exposes AI Topic Radar digest data as MCP tools so any MCP-compatible
 * client can query the latest AI topic reports.
 *
 * Also provides a /chat endpoint for the Web UI's AI Agent panel.
 *
 * Tools:
 *   list_reports  — list available dates and report types
 *   get_report    — fetch a specific report by date and type
 *   get_latest    — fetch the most recent report of a given type
 *   search        — keyword search across recent reports
 *
 * HTTP endpoints:
 *   GET  /        — health check
 *   POST /chat    — AI Agent conversation (RAG over digest data)
 */

const PAGES_URL = "https://conradgui.github.io/AI-TREND-RADAR";

const REPORT_LABELS: Record<string, string> = {
  "ai-topic-radar": "AI Topic Radar (ZH)",
  "ai-cli": "AI CLI Tools Digest (ZH)",
  "ai-cli-en": "AI CLI Tools Digest (EN)",
  "ai-agents": "AI Agents Ecosystem (ZH)",
  "ai-agents-en": "AI Agents Ecosystem (EN)",
  "ai-web": "Official AI Content (ZH)",
  "ai-web-en": "Official AI Content (EN)",
  "ai-trending": "GitHub AI Trends (ZH)",
  "ai-trending-en": "GitHub AI Trends (EN)",
  "ai-hn": "Hacker News AI Community (ZH)",
  "ai-hn-en": "Hacker News AI Community (EN)",
  "ai-weekly": "Weekly Rollup (ZH)",
  "ai-weekly-en": "Weekly Rollup (EN)",
  "ai-monthly": "Monthly Rollup (ZH)",
  "ai-monthly-en": "Monthly Rollup (EN)",
  "ai-china-tech": "China Tech Community AI (ZH)",
  "ai-china-tech-en": "China Tech Community AI (EN)",
};

interface ManifestDate {
  date: string;
  reports: string[];
}

interface Manifest {
  dates: ManifestDate[];
}

interface TopicPoolItem {
  topic: string;
  score: number;
  action: string;
  category: string;
  reason?: string;
  evidence?: string[];
  date?: string;
}

interface SearchIndexEntry {
  date: string;
  title: string;
  score: number;
  category: string;
  source: string;
}

interface SearchIndex {
  generated: string;
  topics: SearchIndexEntry[];
  excerpts: Record<string, Record<string, string>>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Citation {
  date: string;
  source: string;
  excerpt: string;
}

// ---------------------------------------------------------------------------
// Environment (Cloudflare Worker bindings)
// ---------------------------------------------------------------------------

interface Env {
  LLM_PROVIDER?: string;   // "anthropic" | "openai" | "deepseek"
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;   // custom base URL override
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(`${PAGES_URL}/manifest.json`, {
    cf: { cacheTtl: 300 },
  } as RequestInit);
  if (!res.ok) throw new Error(`Failed to fetch manifest: HTTP ${res.status}`);
  return res.json() as Promise<Manifest>;
}

async function fetchReport(date: string, type: string): Promise<string> {
  const res = await fetch(`${PAGES_URL}/digests/${date}/${type}.md`, {
    cf: { cacheTtl: 3600 },
  } as RequestInit);
  if (!res.ok) throw new Error(`Report not found: ${date}/${type} (HTTP ${res.status})`);
  return res.text();
}

async function fetchTopicPool(date: string): Promise<TopicPoolItem[] | null> {
  try {
    const res = await fetch(`${PAGES_URL}/digests/${date}/topic-pool.json`, {
      cf: { cacheTtl: 3600 },
    } as RequestInit);
    if (!res.ok) return null;
    const data = (await res.json()) as { topics?: TopicPoolItem[] };
    return data.topics ?? null;
  } catch {
    return null;
  }
}

async function fetchSearchIndex(): Promise<SearchIndex | null> {
  try {
    const res = await fetch(`${PAGES_URL}/digests/search-index.json`, {
      cf: { cacheTtl: 600 },
    } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as SearchIndex;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM calling
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
};

async function callLLM(
  env: Env,
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<string> {
  const provider = (env.LLM_PROVIDER || "anthropic").toLowerCase();
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY not configured in Worker environment");

  const model = env.LLM_MODEL || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;
  const baseUrl = env.LLM_BASE_URL || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.anthropic;

  if (provider === "anthropic") {
    return callAnthropic(apiKey, baseUrl, model, systemPrompt, messages);
  }
  // OpenAI-compatible (openai, deepseek, openrouter, etc.)
  return callOpenAICompatible(apiKey, baseUrl, model, systemPrompt, messages);
}

async function callAnthropic(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content?.[0]?.text ?? "";
}

async function callOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<string> {
  const allMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: allMessages, max_tokens: 2048 }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Chat: RAG search + context building
// ---------------------------------------------------------------------------

function extractKeywords(message: string): string[] {
  // Split on whitespace/punctuation, filter short tokens, lowercase
  const raw = message
    .toLowerCase()
    .replace(/[^\w一-鿿㐀-䶿\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  // Deduplicate
  return [...new Set(raw)];
}

function searchTopicsByKeywords(
  topics: TopicPoolItem[],
  keywords: string[],
): TopicPoolItem[] {
  return topics
    .map((t) => {
      const text = `${t.topic} ${t.category} ${t.reason || ""} ${(t.evidence || []).join(" ")}`.toLowerCase();
      let hits = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) hits++;
      }
      return { item: t, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.item.score - a.item.score)
    .slice(0, 8)
    .map((x) => x.item);
}

async function buildChatContext(
  message: string,
  history: ChatMessage[],
): Promise<{ context: string; citations: Citation[] }> {
  const keywords = extractKeywords(message);
  if (keywords.length === 0) {
    return { context: "", citations: [] };
  }

  // Try search-index.json first (fast, single fetch)
  const searchIndex = await fetchSearchIndex();

  let relevantTopics: TopicPoolItem[] = [];
  const citations: Citation[] = [];

  if (searchIndex && searchIndex.topics) {
    // Search across the pre-built index
    const matchedEntries = searchIndex.topics
      .map((t) => {
        const text = `${t.title} ${t.category} ${t.source}`.toLowerCase();
        let hits = 0;
        for (const kw of keywords) {
          if (text.includes(kw)) hits++;
        }
        return { entry: t, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.entry.score - a.entry.score)
      .slice(0, 10);

    // Group by date to fetch topic-pool.json for richer data
    const datesToFetch = [...new Set(matchedEntries.map((e) => e.entry.date))].slice(0, 3);

    const poolResults = await Promise.all(datesToFetch.map((d) => fetchTopicPool(d)));
    for (const pool of poolResults) {
      if (pool) {
        const matched = searchTopicsByKeywords(pool, keywords);
        relevantTopics.push(...matched);
      }
    }

    // Build citations from search-index excerpts
    for (const me of matchedEntries.slice(0, 5)) {
      const excerptData = searchIndex.excerpts?.[me.entry.date];
      if (excerptData) {
        for (const [source, text] of Object.entries(excerptData)) {
          // Find relevant lines
          const lines = text.split("\n").filter((l) => {
            const lower = l.toLowerCase();
            return keywords.some((kw) => lower.includes(kw));
          });
          if (lines.length > 0) {
            citations.push({
              date: me.entry.date,
              source,
              excerpt: lines[0].slice(0, 150),
            });
          }
        }
      }
    }
  } else {
    // Fallback: fetch topic-pool.json from recent days
    const manifest = await fetchManifest();
    const recentDates = manifest.dates.slice(0, 5);

    const poolResults = await Promise.all(recentDates.map((d) => fetchTopicPool(d.date)));
    for (let i = 0; i < poolResults.length; i++) {
      const pool = poolResults[i];
      if (pool) {
        const matched = searchTopicsByKeywords(pool, keywords);
        relevantTopics.push(...matched);
        for (const t of matched.slice(0, 3)) {
          citations.push({
            date: recentDates[i].date,
            source: "ai-topic-radar",
            excerpt: `${t.topic} (${t.score}分) — ${t.action}`,
          });
        }
      }
    }
  }

  // Deduplicate topics by name
  const seen = new Set<string>();
  relevantTopics = relevantTopics.filter((t) => {
    if (seen.has(t.topic)) return false;
    seen.add(t.topic);
    return true;
  });

  // Build context string
  if (relevantTopics.length === 0) {
    return { context: "", citations: [] };
  }

  const topicLines = relevantTopics
    .map((t) => {
      const parts = [`- 【${t.topic}】 分数:${t.score} 分类:${t.category} 建议:${t.action}`];
      if (t.reason) parts.push(`  原因: ${t.reason}`);
      if (t.evidence?.length) parts.push(`  证据: ${t.evidence.slice(0, 2).join("; ")}`);
      if (t.date) parts.push(`  日期: ${t.date}`);
      return parts.join("\n");
    })
    .join("\n");

  const context = `以下是与用户问题相关的最新AI选题数据（来自 AI Topic Radar 知识库）：\n\n${topicLines}`;

  // Deduplicate citations
  const citSeen = new Set<string>();
  const uniqueCitations = citations.filter((c) => {
    const key = `${c.date}:${c.source}`;
    if (citSeen.has(key)) return false;
    citSeen.add(key);
    return true;
  });

  return { context, citations: uniqueCitations.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Chat: system prompt
// ---------------------------------------------------------------------------

const CHAT_SYSTEM_PROMPT = `你是 AI Topic Radar 的智能助手，专注于 AI 领域的热点趋势分析和选题建议。

你的知识库来自 AI Topic Radar 每日生成的选题池（topic-pool.json）和各类 AI 数据源报告。

## 你的能力
1. 分析 AI 领域的热点趋势和话题走向
2. 基于选题池数据提供选题建议和深度分析
3. 比较不同数据源的信号强度
4. 回答关于 AI 工具、模型、框架的技术问题

## 回答规范
- 用中文回答（除非用户用英文提问）
- 引用具体的数据来源和日期
- 如果知识库中没有相关信息，坦诚告知而非编造
- 回答简洁有力，重点突出
- 适当使用 markdown 格式（标题、列表、加粗）

## 选题池数据格式
每个选题包含：topic（话题）、score（热度分数 0-100）、action（建议动作：深挖/跟进/观察）、category（分类）、reason（推荐原因）、evidence（证据列表）
`;

// ---------------------------------------------------------------------------
// Chat: main handler
// ---------------------------------------------------------------------------

async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      message: string;
      history?: ChatMessage[];
    };

    const { message, history = [] } = body;
    if (!message || typeof message !== "string") {
      return Response.json(
        { error: "message is required" },
        { status: 400, headers: CORS },
      );
    }

    // 1. RAG: search relevant context
    const { context, citations } = await buildChatContext(message, history);

    // 2. Build system prompt with context
    const systemPrompt = context
      ? `${CHAT_SYSTEM_PROMPT}\n\n${context}`
      : CHAT_SYSTEM_PROMPT;

    // 3. Build message history (keep last 10 turns to stay within token limits)
    const recentHistory = history.slice(-10);
    const messages: ChatMessage[] = [
      ...recentHistory,
      { role: "user", content: message },
    ];

    // 4. Call LLM
    const answer = await callLLM(env, systemPrompt, messages);

    return Response.json(
      { answer, citations },
      { headers: CORS },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: msg },
      { status: 500, headers: CORS },
    );
  }
}

// ---------------------------------------------------------------------------
// MCP tool handlers
// ---------------------------------------------------------------------------

async function toolListReports(args: Record<string, unknown>): Promise<string> {
  const days = Math.min(Number(args["days"] ?? 7), 30);
  const { dates } = await fetchManifest();
  const slice = dates.slice(0, days);

  const lines = slice.map(({ date, reports }) => {
    const labels = reports.map((r) => `${r} (${REPORT_LABELS[r] ?? r})`).join(", ");
    return `• ${date}: ${labels}`;
  });

  return `Available reports — last ${slice.length} day(s):\n\n${lines.join("\n")}`;
}

async function toolGetReport(args: Record<string, unknown>): Promise<string> {
  const date = String(args["date"] ?? "").trim();
  const type = String(args["type"] ?? "").trim();
  if (!date || !type) throw new Error("Both 'date' and 'type' are required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("'date' must be in YYYY-MM-DD format");
  return fetchReport(date, type);
}

async function toolGetLatest(args: Record<string, unknown>): Promise<string> {
  const type = String(args["type"] ?? "ai-topic-radar").trim();
  const { dates } = await fetchManifest();
  for (const { date, reports } of dates) {
    if (reports.includes(type)) {
      const content = await fetchReport(date, type);
      return `# ${date} — ${REPORT_LABELS[type] ?? type}\n\n${content}`;
    }
  }
  throw new Error(`No report found for type: ${type}`);
}

async function toolSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args["query"] ?? "").trim().toLowerCase();
  if (!query) throw new Error("'query' is required");
  const days = Math.min(Number(args["days"] ?? 7), 14);

  const { dates } = await fetchManifest();
  const slice = dates.slice(0, days);

  const results: string[] = [];

  await Promise.all(
    slice.map(async ({ date, reports }) => {
      const targets = reports.filter(
        (r) => !r.endsWith("-en") && !r.includes("weekly") && !r.includes("monthly"),
      );
      await Promise.all(
        targets.map(async (type) => {
          try {
            const content = await fetchReport(date, type);
            if (!content.toLowerCase().includes(query)) return;
            const excerpts = content
              .split("\n")
              .filter((l) => l.toLowerCase().includes(query))
              .slice(0, 3)
              .map((l) => `  > ${l.trim()}`)
              .join("\n");
            results.push(`📄 ${date} / ${type}:\n${excerpts}`);
          } catch {
            // skip unavailable reports
          }
        }),
      );
    }),
  );

  if (results.length === 0) return `No matches for "${query}" in the last ${days} day(s).`;
  return `Found "${query}" in ${results.length} report(s):\n\n${results.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC protocol
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_reports",
    description:
      "List available digest dates and report types from AI Topic Radar. Returns the last N days of available reports.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of recent days to list (default: 7, max: 30)" },
      },
    },
  },
  {
    name: "get_report",
    description: "Fetch the full content of a specific AI Topic Radar digest report.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        type: {
          type: "string",
          description:
            "Report type: ai-cli-en, ai-agents-en, ai-web-en, ai-trending-en, ai-hn-en, ai-weekly-en, ai-monthly-en (drop -en suffix for Chinese versions)",
        },
      },
      required: ["date", "type"],
    },
  },
  {
    name: "get_latest",
    description: "Fetch the most recent available report of a given type.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Report type (default: ai-topic-radar). Use list_reports to see all available types.",
        },
      },
    },
  },
  {
    name: "search",
    description: "Search for a keyword or phrase across recent AI Topic Radar digest reports.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or phrase to search for" },
        days: { type: "number", description: "Number of recent days to search (default: 7, max: 14)" },
      },
      required: ["query"],
    },
  },
];

interface JsonRpcRequest {
  jsonrpc: string;
  id: unknown;
  method: string;
  params?: unknown;
}

async function handleMcp(body: unknown): Promise<unknown> {
  const req = body as JsonRpcRequest;
  const id = req.id ?? null;

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "ai-topic-radar", version: "2.0.0" },
          },
        };

      case "notifications/initialized":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

      case "tools/call": {
        const { name, arguments: args = {} } = req.params as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        let text: string;
        switch (name) {
          case "list_reports":
            text = await toolListReports(args);
            break;
          case "get_report":
            text = await toolGetReport(args);
            break;
          case "get_latest":
            text = await toolGetLatest(args);
            break;
          case "search":
            text = await toolSearch(args);
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
      }

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
    };
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json(
        { name: "ai-topic-radar-mcp", status: "ok", tools: TOOLS.map((t) => t.name) },
        { headers: CORS },
      );
    }

    // Chat endpoint — AI Agent conversation
    if (request.method === "POST" && url.pathname === "/chat") {
      return handleChat(request, env);
    }

    // MCP JSON-RPC
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    try {
      const body = await request.json();
      const result = await handleMcp(body);
      return Response.json(result, { headers: CORS });
    } catch {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } },
        { status: 400, headers: CORS },
      );
    }
  },
};
