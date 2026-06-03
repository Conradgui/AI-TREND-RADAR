/**
 * OSChina (Open Source China) AI news fetched via RSS feed.
 */

import { extractTag, extractCdata, stripHtml, FETCH_TIMEOUT_MS } from "./rss-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OschinaNews {
  id: string;
  title: string;
  url: string;
  body: string;
  author: string;
  pubDate: string;
}

export interface OschinaData {
  news: OschinaNews[];
  fetchSuccess: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NEWS = 30;

/** AI-related keywords for filtering. */
const AI_KEYWORDS = [
  "AI",
  "人工智能",
  "大模型",
  "LLM",
  "GPT",
  "Claude",
  "机器学习",
  "深度学习",
  "AGI",
  "AIGC",
  "智能体",
  "Agent",
  "RAG",
  "向量数据库",
  "NLP",
  "自然语言处理",
  "Transformer",
  "多模态",
  "AI编程",
  "Copilot",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAiRelated(title: string, body: string): boolean {
  const text = `${title} ${body}`.toLowerCase();
  return AI_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchOschinaData(): Promise<OschinaData> {
  const articles: OschinaNews[] = [];

  try {
    const resp = await fetch("https://www.oschina.net/news/rss", {
      headers: {
        "User-Agent": "ai-topic-radar/1.0",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.error(`  [oschina] RSS returned HTTP ${resp.status}`);
      return { news: [], fetchSuccess: false };
    }

    const cl = resp.headers.get("content-length");
    if (cl && Number(cl) > 5 * 1024 * 1024) {
      console.error(`  [oschina] RSS response too large: ${cl} bytes`);
      return { news: [], fetchSuccess: false };
    }

    const xml = await resp.text();
    const itemBlocks = xml.split("<item>").slice(1);

    for (const block of itemBlocks) {
      const itemXml = "<item>" + block;
      const title = extractCdata(itemXml, "title");
      const link = extractTag(itemXml, "link");
      const description = extractCdata(itemXml, "description");
      const pubDate = extractTag(itemXml, "pubDate");
      const author = extractCdata(itemXml, "author") || extractCdata(itemXml, "dc:creator");
      const guid = extractTag(itemXml, "guid") || link;

      if (!title || !link) continue;
      if (!isAiRelated(title, description)) continue;

      articles.push({
        id: guid || link,
        title,
        url: link,
        body: stripHtml(description),
        author: author || "OSChina",
        pubDate: pubDate || new Date().toISOString(),
      });

      if (articles.length >= MAX_NEWS) break;
    }

    console.log(`  [oschina] ${articles.length} AI news articles`);
    return { news: articles, fetchSuccess: articles.length > 0 };
  } catch (err) {
    console.error(`  [oschina] fetch failed: ${err}`);
    return { news: [], fetchSuccess: false };
  }
}
