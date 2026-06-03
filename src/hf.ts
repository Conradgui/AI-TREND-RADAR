/**
 * Hugging Face trending models fetched via the HF Hub API.
 *
 * Strategy: fetch trending models sorted by weekly likes from the
 * HF Hub API, returning a mapped subset of fields.
 */

import { createSourceStatus, type SourceStatus } from "./source-status.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HfModel {
  id: string; // e.g. "meta-llama/Llama-3.1-8B"
  author: string;
  likes: number;
  downloads: number;
  tags: string[];
  pipelineTag: string;
  lastModified: string;
  url: string;
}

export interface HfData {
  models: HfModel[];
  fetchSuccess: boolean;
  status: SourceStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HF_FETCH_LIMIT = 30;
const API_URL = "https://huggingface.co/api/models";

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface HfApiModel {
  _id: string;
  id: string;
  author?: string;
  likes: number;
  downloads: number;
  tags?: string[];
  pipeline_tag?: string;
  lastModified?: string;
}

function result(models: HfModel[], fetchedCount: number, error?: string): HfData {
  const status = createSourceStatus({
    id: "hf",
    label: "Hugging Face",
    fetchedCount,
    acceptedCount: models.length,
    error,
  });
  return { models, fetchSuccess: status.state !== "error", status };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchHfData(): Promise<HfData> {
  try {
    // Fetch trending models (sorted by likes, recently modified)
    const params = new URLSearchParams({
      sort: "likes7d",
      direction: "-1",
      limit: String(HF_FETCH_LIMIT),
      full: "false",
    });

    const resp = await fetch(`${API_URL}?${params}`, {
      headers: { "User-Agent": "ai-topic-radar/1.0" },
    });

    if (!resp.ok) {
      console.error(`  [hf] HTTP ${resp.status}`);
      return result([], 0, `HTTP ${resp.status}`);
    }

    const raw = (await resp.json()) as HfApiModel[];
    if (!Array.isArray(raw)) {
      console.error(`  [hf] unexpected response shape`);
      return result([], 0, "unexpected response shape");
    }

    const models: HfModel[] = raw.map((m) => ({
      id: m.id,
      author: m.author ?? m.id.split("/")[0] ?? "unknown",
      likes: m.likes,
      downloads: m.downloads,
      tags: m.tags ?? [],
      pipelineTag: m.pipeline_tag ?? "",
      lastModified: m.lastModified ?? "",
      url: `https://huggingface.co/${m.id}`,
    }));

    console.log(`  [hf] ${models.length} trending models`);
    return result(models, raw.length);
  } catch (err) {
    console.error(`  [hf] fetch failed: ${err}`);
    return result([], 0, String(err));
  }
}
