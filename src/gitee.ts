/**
 * Gitee popular AI projects fetched via REST API v5.
 */

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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PROJECTS = 30;
const API_URL = "https://gitee.com/api/v5/projects";

/** AI-related keywords for filtering project names/descriptions. */
const AI_KEYWORDS = [
  "ai",
  "人工智能",
  "大模型",
  "llm",
  "gpt",
  "chatgpt",
  "机器学习",
  "深度学习",
  "deep-learning",
  "machine-learning",
  "aigc",
  "rag",
  "agent",
  "langchain",
  "transformer",
  "diffusion",
  "nlp",
  "自然语言处理",
  "computer-vision",
  "计算机视觉",
  "向量",
  "vector",
  "embedding",
  "神经网络",
  "neural",
  "pytorch",
  "tensorflow",
];

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

function isAiRelated(name: string, description: string): boolean {
  const text = `${name} ${description}`.toLowerCase();
  return AI_KEYWORDS.some((kw) => text.includes(kw));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchGiteeData(): Promise<GiteeData> {
  const seen = new Map<number, GiteeProject>();

  try {
    const token = process.env["GITEE_TOKEN"];
    const params = new URLSearchParams({
      sort: "stars",
      per_page: "100",
      order: "desc",
      page: "1",
    });
    if (token) params.set("access_token", token);

    const headers: Record<string, string> = {
      "User-Agent": "ai-topic-radar/1.0",
      Accept: "application/json",
    };

    const resp = await fetch(`${API_URL}?${params}`, { headers });

    if (!resp.ok) {
      console.error(`  [gitee] API returned HTTP ${resp.status}`);
      return { projects: [], fetchSuccess: false };
    }

    const raw = (await resp.json()) as GiteeApiProject[];
    if (!Array.isArray(raw)) {
      console.error(`  [gitee] unexpected response shape`);
      return { projects: [], fetchSuccess: false };
    }

    for (const p of raw) {
      const desc = p.description ?? "";
      if (!isAiRelated(p.name, desc)) continue;

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

    const projects = [...seen.values()].sort((a, b) => b.stars - a.stars).slice(0, MAX_PROJECTS);
    console.log(`  [gitee] ${projects.length} AI projects (from ${raw.length} total)`);
    return { projects, fetchSuccess: projects.length > 0 };
  } catch (err) {
    const safeMsg = String(err).replace(/access_token=[^&\s]+/g, "access_token=REDACTED");
    console.error(`  [gitee] fetch failed: ${safeMsg}`);
    return { projects: [], fetchSuccess: false };
  }
}
