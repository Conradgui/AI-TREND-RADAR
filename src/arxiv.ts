/**
 * ArXiv AI papers fetched via the ArXiv API (Atom feed).
 *
 * Strategy: query cs.AI + cs.CL + cs.LG categories for the newest papers,
 * sorted by submission date, filtered to last 48h.
 */

import { createSourceStatus, type SourceStatus } from "./source-status.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  url: string;
  pdfUrl: string;
}

export interface ArxivData {
  papers: ArxivPaper[];
  fetchSuccess: boolean;
  status: SourceStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARXIV_MAX_RESULTS = 50;
const API_URL = "https://export.arxiv.org/api/query";

/** ArXiv categories to search. */
const CATEGORIES = ["cs.AI", "cs.CL", "cs.LG"];

/** Delay before retrying a rate-limited request. */
const REQUEST_DELAY_MS = 3000;
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// XML helpers (lightweight, no dependency)
// ---------------------------------------------------------------------------

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1]!.trim() : "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1]!.trim());
  }
  return results;
}

function extractAttr(xml: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*/?>`, "g");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1]!);
  }
  return results;
}

function extractLinkHref(xml: string, rel: string): string {
  const re = new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]*)"[^>]*/?>`, "g");
  const m = re.exec(xml);
  return m ? m[1]! : "";
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function parseEntry(entryXml: string): ArxivPaper | null {
  const id = extractTag(entryXml, "id");
  if (!id) return null;

  const title = extractTag(entryXml, "title").replace(/\s+/g, " ");
  const summary = extractTag(entryXml, "summary").replace(/\s+/g, " ");
  const authors = extractAllTags(entryXml, "name");
  const published = extractTag(entryXml, "published");
  const updated = extractTag(entryXml, "updated");
  const categories = extractAttr(entryXml, "category", "term");

  const url = id; // ArXiv id IS the URL (e.g. http://arxiv.org/abs/...)
  const pdfUrl = extractLinkHref(entryXml, "related") || id.replace("/abs/", "/pdf/");

  return { id, title, summary, authors, published, updated, categories, url, pdfUrl };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(resp: Response, attempt: number): number {
  const retryAfter = resp.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return REQUEST_DELAY_MS * 2 ** attempt;
}

function isAtomFeed(xml: string): boolean {
  return /<feed[\s>]/.test(xml);
}

export async function fetchArxivData(): Promise<ArxivData> {
  const seen = new Map<string, ArxivPaper>();
  const params = new URLSearchParams({
    search_query: CATEGORIES.map((cat) => `cat:${cat}`).join(" OR "),
    sortBy: "submittedDate",
    sortOrder: "descending",
    max_results: String(ARXIV_MAX_RESULTS),
  });
  let xml = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${API_URL}?${params}`, {
        headers: { "User-Agent": "ai-topic-radar/1.0" },
      });

      if (!resp.ok) {
        const error = `HTTP ${resp.status}`;
        console.error(`  [arxiv] ${error}`);
        if (resp.status === 429 && attempt < MAX_ATTEMPTS - 1) {
          await sleep(retryDelayMs(resp, attempt));
          continue;
        }
        return {
          papers: [],
          fetchSuccess: false,
          status: createSourceStatus({
            id: "arxiv",
            label: "ArXiv",
            fetchedCount: 0,
            acceptedCount: 0,
            error,
          }),
        };
      }

      xml = await resp.text();
      if (!isAtomFeed(xml)) {
        const error = "unexpected Atom feed shape";
        console.error(`  [arxiv] ${error}`);
        return {
          papers: [],
          fetchSuccess: false,
          status: createSourceStatus({
            id: "arxiv",
            label: "ArXiv",
            fetchedCount: 0,
            acceptedCount: 0,
            error,
          }),
        };
      }
      break;
    } catch (err) {
      const error = String(err);
      console.error(`  [arxiv] fetch failed: ${error}`);
      return {
        papers: [],
        fetchSuccess: false,
        status: createSourceStatus({
          id: "arxiv",
          label: "ArXiv",
          fetchedCount: 0,
          acceptedCount: 0,
          error,
        }),
      };
    }
  }

  const entryBlocks = xml.split("<entry>").slice(1);
  for (const block of entryBlocks) {
    const paper = parseEntry("<entry>" + block);
    if (paper && !seen.has(paper.id)) {
      seen.set(paper.id, paper);
    }
  }
  console.log(`  [arxiv] ${entryBlocks.length} papers fetched`);

  // Filter to last 48h (ArXiv has a ~1-day publishing delay, so 24h would miss today's batch)
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const papers = [...seen.values()]
    .filter((p) => new Date(p.published).getTime() > cutoff)
    .sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime())
    .slice(0, ARXIV_MAX_RESULTS);

  console.log(`  [arxiv] ${papers.length} papers (from ${seen.size} unique)`);
  return {
    papers,
    fetchSuccess: true,
    status: createSourceStatus({
      id: "arxiv",
      label: "ArXiv",
      fetchedCount: entryBlocks.length,
      acceptedCount: papers.length,
    }),
  };
}
