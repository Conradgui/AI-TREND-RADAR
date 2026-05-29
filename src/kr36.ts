/**
 * 36kr AI news articles fetched via RSS feed / HTML scraping.
 */

import { extractTag, extractCdata, stripHtml, FETCH_TIMEOUT_MS } from "./rss-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Kr36Article {
  id: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  author: string;
}

export interface Kr36Data {
  articles: Kr36Article[];
  fetchSuccess: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ARTICLES = 30;

/** AI-related keywords for client-side filtering. */
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
  "自然语言处理",
  "NLP",
  "计算机视觉",
  "AIGC",
  "智能体",
  "Agent",
  "Transformer",
  "扩散模型",
  "多模态",
  "RAG",
  "向量",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAiRelated(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return AI_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Fetch via RSS
// ---------------------------------------------------------------------------

export async function fetchKr36Data(): Promise<Kr36Data> {
  const articles: Kr36Article[] = [];

  try {
    const resp = await fetch("https://36kr.com/feed", {
      headers: {
        "User-Agent": "ai-topic-radar/1.0",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (resp.ok) {
      const cl = resp.headers.get("content-length");
      if (cl && Number(cl) > 5 * 1024 * 1024) {
        console.error(`  [kr36] RSS response too large: ${cl} bytes`);
        return { articles: [], fetchSuccess: false };
      }

      const xml = await resp.text();
      const itemBlocks = xml.split("<item>").slice(1);

      for (const block of itemBlocks) {
        const itemXml = "<item>" + block;
        const title = extractCdata(itemXml, "title");
        const link = extractTag(itemXml, "link");
        const description = extractCdata(itemXml, "description");
        const pubDate = extractTag(itemXml, "pubDate");
        const author = extractCdata(itemXml, "dc:creator") || extractCdata(itemXml, "author");
        const guid = extractTag(itemXml, "guid") || link;

        if (!title || !link) continue;
        if (!isAiRelated(title, description)) continue;

        articles.push({
          id: guid || link,
          title,
          url: link,
          summary: stripHtml(description),
          publishedAt: pubDate || new Date().toISOString(),
          author: author || "36kr",
        });

        if (articles.length >= MAX_ARTICLES) break;
      }

      console.log(`  [kr36] ${articles.length} AI articles from RSS`);
      return { articles, fetchSuccess: articles.length > 0 };
    }

    console.log(`  [kr36] RSS returned ${resp.status}, no fallback available`);
  } catch (err) {
    console.error(`  [kr36] RSS fetch failed: ${err}`);
  }

  return { articles: [], fetchSuccess: false };
}
