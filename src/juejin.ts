/**
 * Juejin (稀土掘金) AI articles fetched via internal API.
 */

import { FETCH_TIMEOUT_MS } from "./rss-utils.ts";
import { createSourceStatus, type SourceStatus } from "./source-status.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JuejinArticle {
  id: string;
  title: string;
  url: string;
  brief: string;
  author: string;
  diggCount: number;
  viewCount: number;
  tags: string[];
  publishTime: string;
}

export interface JuejinData {
  articles: JuejinArticle[];
  fetchSuccess: boolean;
  status: SourceStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ARTICLES = 30;

/** AI category ID in Juejin. */
const AI_CATEGORY_ID = "6809637767543259144";

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface JuejinArticleInfo {
  article_id: string;
  article_info: {
    title: string;
    brief_content: string;
    digg_count: number;
    view_count: number;
    publish_time: number;
  };
  author_user_info: {
    user_name: string;
  };
  tags: Array<{ tag_name: string }>;
}

interface JuejinApiResponse {
  data: JuejinArticleInfo[];
  err_no: number;
  err_msg?: string;
}

function result(articles: JuejinArticle[], fetchedCount: number, error?: string): JuejinData {
  const status = createSourceStatus({
    id: "juejin",
    label: "掘金",
    fetchedCount,
    acceptedCount: articles.length,
    error,
  });
  return { articles, fetchSuccess: status.state !== "error", status };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchJuejinData(): Promise<JuejinData> {
  const seen = new Map<string, JuejinArticle>();

  try {
    const resp = await fetch("https://api.juejin.cn/recommend_api/v1/article/recommend_cate_feed", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 ai-topic-radar/1.0",
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: "https://juejin.cn/",
        Origin: "https://juejin.cn",
      },
      body: JSON.stringify({
        id_type: 2,
        sort_type: 7, // weekly hot
        cate_id: AI_CATEGORY_ID,
        cursor: "0",
        limit: 50,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.error(`  [juejin] API returned HTTP ${resp.status}`);
      return result([], 0, `HTTP ${resp.status}`);
    }

    const raw = (await resp.json()) as JuejinApiResponse;
    if (!raw || !Array.isArray(raw.data)) {
      console.error(`  [juejin] unexpected response shape`);
      return result([], 0, "unexpected response shape");
    }
    if (raw.err_no !== 0) {
      const error = raw.err_msg || `API err_no ${raw.err_no}`;
      console.error(`  [juejin] API error: ${error}`);
      return result([], 0, error);
    }

    for (const item of raw.data ?? []) {
      const id = item.article_id;
      if (!id || seen.has(id)) continue;

      const info = item.article_info;
      seen.set(id, {
        id,
        title: info.title,
        url: `https://juejin.cn/post/${id}`,
        brief: info.brief_content?.slice(0, 500) ?? "",
        author: item.author_user_info?.user_name ?? "掘金",
        diggCount: info.digg_count ?? 0,
        viewCount: info.view_count ?? 0,
        tags: (item.tags ?? []).map((t) => t.tag_name),
        publishTime: info.publish_time
          ? new Date(info.publish_time * 1000).toISOString()
          : new Date().toISOString(),
      });

      if (seen.size >= MAX_ARTICLES) break;
    }

    const articles = [...seen.values()].sort((a, b) => b.diggCount - a.diggCount).slice(0, MAX_ARTICLES);
    console.log(`  [juejin] ${articles.length} AI articles`);
    return result(articles, raw.data.length);
  } catch (err) {
    console.error(`  [juejin] fetch failed: ${err}`);
    return result([], 0, String(err));
  }
}
