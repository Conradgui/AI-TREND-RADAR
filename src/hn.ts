/**
 * Hacker News AI stories fetched via the Algolia HN Search API.
 */

import { createSourceStatus, type SourceStatus } from "./source-status.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HnStory {
  id: string;
  title: string;
  url: string; // external URL, or HN discussion link if no external URL
  hnUrl: string; // always the HN discussion link
  points: number;
  comments: number;
  author: string;
  createdAt: string;
}

export interface HnData {
  stories: HnStory[];
  fetchSuccess: boolean;
  status: SourceStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HN_TOP_STORIES = 30;

/** Queries run in parallel; results are deduped by story ID. */
const QUERIES = ["AI", "LLM", "Claude", "OpenAI", "Anthropic", "machine learning"];

// ---------------------------------------------------------------------------
// Algolia API types
// ---------------------------------------------------------------------------

interface AlgoliaHit {
  objectID: string;
  title: string;
  url?: string;
  points: number;
  num_comments: number;
  author: string;
  created_at: string;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

function result(stories: HnStory[], fetchedCount: number, errors: string[] = []): HnData {
  const status = createSourceStatus({
    id: "hn",
    label: "Hacker News",
    fetchedCount,
    acceptedCount: stories.length,
    error: errors.length > 0 ? `partial failure: ${errors.join("; ")}` : undefined,
  });
  return { stories, fetchSuccess: status.state !== "error", status };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchHnData(): Promise<HnData> {
  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const seen = new Map<string, HnStory>();
  const errors: string[] = [];
  let fetchedCount = 0;

  try {
    await Promise.all(
      QUERIES.map(async (q) => {
        try {
          const url =
            `https://hn.algolia.com/api/v1/search_by_date` +
            `?tags=story` +
            `&query=${encodeURIComponent(q)}` +
            `&numericFilters=created_at_i>${since}` +
            `&hitsPerPage=30`;
          const resp = await fetch(url, {
            headers: { "User-Agent": "ai-topic-radar/1.0" },
          });
          if (!resp.ok) {
            console.error(`  [hn] "${q}": HTTP ${resp.status}`);
            errors.push(`"${q}": HTTP ${resp.status}`);
            return;
          }
          const data = (await resp.json()) as AlgoliaResponse;
          if (!data || !Array.isArray(data.hits)) {
            console.error(`  [hn] "${q}": unexpected response shape`);
            errors.push(`"${q}": unexpected response shape`);
            return;
          }
          fetchedCount += data.hits.length;
          for (const hit of data.hits) {
            if (!seen.has(hit.objectID)) {
              const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
              seen.set(hit.objectID, {
                id: hit.objectID,
                title: hit.title,
                url: hit.url ?? hnUrl,
                hnUrl,
                points: hit.points ?? 0,
                comments: hit.num_comments ?? 0,
                author: hit.author,
                createdAt: hit.created_at,
              });
            }
          }
        } catch (err) {
          console.error(`  [hn] "${q}": ${err}`);
          errors.push(`"${q}": ${err}`);
        }
      }),
    );

    const stories = [...seen.values()].sort((a, b) => b.points - a.points).slice(0, HN_TOP_STORIES);

    console.log(`  [hn] ${stories.length} stories (from ${seen.size} unique)`);
    return result(stories, fetchedCount, errors);
  } catch (err) {
    console.error(`  [hn] fetch failed: ${err}`);
    return result([], fetchedCount, [String(err)]);
  }
}
