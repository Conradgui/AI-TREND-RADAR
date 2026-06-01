/**
 * Gitee popular AI projects fetched via REST API v5.
 */

import { createSourceStatus, type SourceStatus } from "./source-status.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GiteeProject {
  id: number;
  name: string;
  fullName: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  updatedAt: string;
  namespace: string;
}

export interface GiteeData {
  projects: GiteeProject[];
  fetchSuccess: boolean;
  status: SourceStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PROJECTS = 30;
const API_URL = "https://gitee.com/api/v5/search/repositories";
const SEARCH_KEYWORDS = ["ai", "llm", "大模型", "agent", "rag"];

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface GiteeApiProject {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  namespace: { path: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeError(err: unknown): string {
  return String(err).replace(/access_token=[^&\s]+/g, "access_token=REDACTED");
}

function result(projects: GiteeProject[], fetchedCount: number, error?: string): GiteeData {
  const status = createSourceStatus({
    id: "gitee",
    label: "Gitee",
    fetchedCount,
    acceptedCount: projects.length,
    error,
  });
  return { projects, fetchSuccess: status.state !== "error", status };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchGiteeData(): Promise<GiteeData> {
  const seen = new Map<number, GiteeProject>();
  let fetchedCount = 0;

  try {
    const token = process.env["GITEE_TOKEN"];
    const headers: Record<string, string> = {
      "User-Agent": "ai-topic-radar/1.0",
      Accept: "application/json",
    };

    for (const keyword of SEARCH_KEYWORDS) {
      const params = new URLSearchParams({
        q: keyword,
        sort: "stars_count",
        order: "desc",
        per_page: "100",
        page: "1",
      });
      if (token) params.set("access_token", token);

      const resp = await fetch(`${API_URL}?${params}`, { headers });

      if (!resp.ok) {
        console.error(`  [gitee] API returned HTTP ${resp.status}`);
        return result([], fetchedCount, `HTTP ${resp.status}`);
      }

      const raw = (await resp.json()) as GiteeApiProject[];
      if (!Array.isArray(raw)) {
        console.error(`  [gitee] unexpected response shape`);
        return result([], fetchedCount, "unexpected response shape");
      }
      fetchedCount += raw.length;

      for (const p of raw) {
        const desc = p.description ?? "";
        if (!seen.has(p.id)) {
          seen.set(p.id, {
            id: p.id,
            name: p.name,
            fullName: p.full_name,
            url: p.html_url,
            description: desc,
            language: p.language ?? "",
            stars: p.stargazers_count,
            forks: p.forks_count,
            updatedAt: p.updated_at,
            namespace: p.namespace.path,
          });
        }

        if (seen.size >= MAX_PROJECTS) break;
      }
    }

    const projects = [...seen.values()].sort((a, b) => b.stars - a.stars).slice(0, MAX_PROJECTS);
    console.log(`  [gitee] ${projects.length} AI projects (from ${fetchedCount} results)`);
    return result(projects, fetchedCount);
  } catch (err) {
    const safeMsg = safeError(err);
    console.error(`  [gitee] fetch failed: ${safeMsg}`);
    return result([], fetchedCount, safeMsg);
  }
}
