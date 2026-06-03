/**
 * InfoQ China AI articles fetched via internal API.
 */

import { FETCH_TIMEOUT_MS } from "./rss-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InfoqCnArticle {
  id: string;
  title: string;
  url: string;
  summary: string;
  author: string;
  publishTime: string;
  topics: string[];
}

export interface InfoqCnData {
  articles: InfoqCnArticle[];
  fetchSuccess: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ARTICLES = 30;

/** AI-related topic UUIDs and keywords for filtering. */
const AI_KEYWORDS = [
  "AI",
  "人工智能",
  "大模型",
  "LLM",
  "GPT",
  "机器学习",
  "深度学习",
  "AIGC",
  "智能体",
  "Agent",
  "RAG",
  "向量数据库",
  "NLP",
  "自然语言处理",
];

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface InfoqArticleItem {
  id: number;
  uuid: string;
  title: string;
  url: string;
  description: string;
  author: { name: string; nickname: string } | null;
  publish_time: number;
  topics: string[];
}

interface InfoqApiResponse {
  data: InfoqArticleItem[];
  err_msg?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAiRelated(title: string, description: string, topics: string[]): boolean {
  const text = `${title} ${description} ${topics.join(" ")}`.toLowerCase();
  return AI_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchInfoqCnData(): Promise<InfoqCnData> {
  const seen = new Map<string, InfoqCnArticle>();

  try {
    // Try the recommendation API
    const resp = await fetch("https://www.infoq.cn/public/v1/my/recommond", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 ai-topic-radar/1.0",
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: "https://www.infoq.cn",
        Origin: "https://www.infoq.cn",
      },
      body: JSON.stringify({ size: 50, type: 1 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.error(`  [infoq-cn] API returned HTTP ${resp.status}`);
      return { articles: [], fetchSuccess: false };
    }

    const raw = (await resp.json()) as InfoqApiResponse;
    if (!raw || !Array.isArray(raw.data)) {
      console.error(`  [infoq-cn] unexpected response shape`);
      return { articles: [], fetchSuccess: false };
    }
    if (raw.err_msg) {
      console.error(`  [infoq-cn] API error: ${raw.err_msg}`);
      return { articles: [], fetchSuccess: false };
    }

    for (const item of raw.data ?? []) {
      const title = item.title;
      const description = item.description ?? "";
      const topics = item.topics ?? [];

      if (!isAiRelated(title, description, topics)) continue;

      const url = item.url || `https://www.infoq.cn/article/${item.uuid}`;
      const id = String(item.id || item.uuid);

      if (!seen.has(id)) {
        seen.set(id, {
          id,
          title,
          url,
          summary: description.slice(0, 500),
          author: item.author?.nickname || item.author?.name || "InfoQ",
          publishTime: item.publish_time
            ? new Date(item.publish_time * 1000).toISOString()
            : new Date().toISOString(),
          topics,
        });
      }

      if (seen.size >= MAX_ARTICLES) break;
    }

    const articles = [...seen.values()].slice(0, MAX_ARTICLES);
    console.log(`  [infoq-cn] ${articles.length} AI articles (from ${seen.size} unique)`);
    return { articles, fetchSuccess: articles.length > 0 };
  } catch (err) {
    console.error(`  [infoq-cn] fetch failed: ${err}`);
    return { articles: [], fetchSuccess: false };
  }
}
