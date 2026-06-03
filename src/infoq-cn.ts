/**
 * InfoQ China AI articles fetched via internal API.
 */

import { FETCH_TIMEOUT_MS } from "./rss-utils.ts";
import { createSourceStatus, type SourceStatus } from "./source-status.ts";

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
  status: SourceStatus;
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
  title?: string;
  article_title?: string;
  url?: string;
  description?: string;
  article_summary?: string;
  author?: { name?: string; nickname?: string } | Array<{ name?: string; nickname?: string }> | null;
  publish_time: number;
  topics?: string[];
  topic?: Array<{ name?: string }>;
}

interface InfoqApiResponse {
  data: InfoqArticleItem[];
  code?: number;
  err_msg?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAiRelated(title: string, description: string, topics: string[]): boolean {
  const text = `${title} ${description} ${topics.join(" ")}`.toLowerCase();
  return AI_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

function result(articles: InfoqCnArticle[], fetchedCount: number, error?: string): InfoqCnData {
  const status = createSourceStatus({
    id: "infoq-cn",
    label: "InfoQ 中国",
    fetchedCount,
    acceptedCount: articles.length,
    error,
  });
  return { articles, fetchSuccess: status.state !== "error", status };
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
      return result([], 0, `HTTP ${resp.status}`);
    }

    const raw = (await resp.json()) as InfoqApiResponse;
    if (!raw || !Array.isArray(raw.data)) {
      console.error(`  [infoq-cn] unexpected response shape`);
      return result([], 0, "unexpected response shape");
    }
    if ((raw.code !== undefined && raw.code !== 0) || raw.err_msg) {
      const error = raw.err_msg || `API code ${raw.code}`;
      console.error(`  [infoq-cn] API error: ${error}`);
      return result([], raw.data.length, error);
    }

    for (const item of raw.data ?? []) {
      const title = item.article_title ?? item.title ?? "";
      const description = item.article_summary ?? item.description ?? "";
      const topics =
        item.topic?.map(({ name }) => name).filter((name): name is string => Boolean(name)) ??
        item.topics ??
        [];
      const author = Array.isArray(item.author) ? item.author[0] : item.author;

      if (!isAiRelated(title, description, topics)) continue;

      const url = item.url || `https://www.infoq.cn/article/${item.uuid}`;
      const id = String(item.id || item.uuid);

      if (!seen.has(id)) {
        seen.set(id, {
          id,
          title,
          url,
          summary: description.slice(0, 500),
          author: author?.nickname || author?.name || "InfoQ",
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
    return result(articles, raw.data.length);
  } catch (err) {
    console.error(`  [infoq-cn] fetch failed: ${err}`);
    return result([], 0, String(err));
  }
}
