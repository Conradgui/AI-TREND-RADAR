import fs from "fs";
import path from "path";
import { marked } from "marked";
import { REPORT_LABELS } from "./i18n.ts";
import { getReportLangs, shouldSaveSourceReports } from "./options.ts";

const DIGESTS_DIR = "digests";
const MANIFEST_PATH = "manifest.json";
const FEED_PATH = "feed.xml";
const SEARCH_INDEX_PATH = path.join(DIGESTS_DIR, "search-index.json");
const SITE_URL = "https://conradgui.github.io/AI-TREND-RADAR";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_REPORT_BASES = [
  "ai-cli",
  "ai-agents",
  "ai-web",
  "ai-trending",
  "ai-hn",
  "ai-ph",
  "ai-arxiv",
  "ai-hf",
  "ai-community",
  "ai-china-tech",
] as const;
const ROLLUP_REPORT_BASES = ["ai-weekly", "ai-monthly"] as const;

export function getReportFiles(
  langs = getReportLangs(),
  includeSourceReports = shouldSaveSourceReports(),
): string[] {
  const reports = ["ai-topic-radar"];
  const addLocalized = (base: string): void => {
    if (langs.includes("zh")) reports.push(base);
    if (langs.includes("en")) reports.push(`${base}-en`);
  };

  if (includeSourceReports) {
    for (const base of SOURCE_REPORT_BASES) addLocalized(base);
  }
  for (const base of ROLLUP_REPORT_BASES) addLocalized(base);

  return reports;
}

const MAX_FEED_ITEMS = 30;

interface DateEntry {
  date: string;
  reports: string[];
}

interface Manifest {
  generated: string;
  dates: DateEntry[];
}

interface ReportContent {
  summary: string;
  fullHtml: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toRfc822(date: Date): string {
  return (
    `${DAYS[date.getUTCDay()]}, ${String(date.getUTCDate()).padStart(2, "0")} ` +
    `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")} +0000`
  );
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function getReportContent(date: string, report: string): Promise<ReportContent> {
  const filePath = path.join(DIGESTS_DIR, date, `${report}.md`);

  try {
    const markdown = fs.readFileSync(filePath, "utf-8");
    const html = await marked.parse(markdown, { async: false });

    // Extract summary text from original HTML (before CDATA escape)
    const textOnly = html
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const summary = textOnly.length > 500 ? textOnly.slice(0, 500) + "..." : textOnly;

    // Escape CDATA end marker to prevent injection
    const safeHtml = html.replace(/]]>/g, "]]]]><![CDATA[");

    return {
      summary: escapeXml(summary), // Plain text, XML-escaped, no CDATA
      fullHtml: `<![CDATA[${safeHtml}]]>`, // HTML in CDATA, no escaping needed
    };
  } catch {
    // Fallback to title-only content on any error
    const label = REPORT_LABELS[report] ?? report;
    const title = `${label} ${date}`;
    return {
      summary: escapeXml(title),
      fullHtml: `<![CDATA[${escapeXml(title)}]]>`,
    };
  }
}

async function main(): Promise<void> {
  const reportFiles = getReportFiles();
  const entries = fs
    .readdirSync(DIGESTS_DIR)
    .filter((name) => DATE_RE.test(name) && fs.statSync(path.join(DIGESTS_DIR, name)).isDirectory())
    .sort()
    .reverse()
    .map((date) => {
      const reports = reportFiles.filter((r) => fs.existsSync(path.join(DIGESTS_DIR, date, `${r}.md`)));
      return { date, reports };
    })
    .filter((e) => e.reports.length > 0);

  const manifest: Manifest = {
    generated: new Date().toISOString(),
    dates: entries,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest.json updated: ${entries.length} dates`);

  // ── RSS Feed ──────────────────────────────────────────────────────────────────

  const feedItems: Array<{ date: string; report: string }> = [];
  outer: for (const entry of entries) {
    for (const report of entry.reports) {
      feedItems.push({ date: entry.date, report });
      if (feedItems.length >= MAX_FEED_ITEMS) break outer;
    }
  }

  const buildDate = toRfc822(new Date());

  const itemXmlChunks: string[] = [];
  for (const { date, report } of feedItems) {
    const label = REPORT_LABELS[report] ?? report;
    const title = `${label} ${date}`;
    const link =
      report === "ai-topic-radar"
        ? `${SITE_URL}/digests/${date}/ai-topic-radar.html`
        : `${SITE_URL}/#${date}/${report}`;
    const parts = date.split("-").map(Number);
    const pubDate = toRfc822(new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!)));
    const content = await getReportContent(date, report);
    itemXmlChunks.push(
      [
        "    <item>",
        `      <title>${escapeXml(title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${pubDate}</pubDate>`,
        `      <description>${content.summary}</description>`,
        `      <content:encoded>${content.fullHtml}</content:encoded>`,
        "    </item>",
      ].join("\n"),
    );
  }
  const itemsXml = itemXmlChunks.join("\n");

  const feedXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n` +
    `  <channel>\n` +
    `    <title>AI Topic Radar</title>\n` +
    `    <link>${SITE_URL}</link>\n` +
    `    <description>AI 热点选题监控 · Daily AI topic radar</description>\n` +
    `    <language>zh-CN</language>\n` +
    `    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>\n` +
    `    <lastBuildDate>${buildDate}</lastBuildDate>\n` +
    itemsXml +
    `\n  </channel>\n` +
    `</rss>\n`;

  fs.writeFileSync(FEED_PATH, feedXml);
  console.log(`feed.xml updated: ${feedItems.length} items`);

  // ── Search Index (for AI Agent chat) ──
  generateSearchIndex(entries);
}

function generateSearchIndex(entries: DateEntry[]): void {
  interface SearchTopic {
    date: string;
    title: string;
    score: number;
    category: string;
    source: string;
  }

  const topics: SearchTopic[] = [];
  const excerpts: Record<string, Record<string, string>> = {};

  for (const { date, reports } of entries) {
    const dateDir = path.join(DIGESTS_DIR, date);

    // Load topic-pool.json if available
    const poolPath = path.join(dateDir, "topic-pool.json");
    if (fs.existsSync(poolPath)) {
      try {
        const pool = JSON.parse(fs.readFileSync(poolPath, "utf-8"));
        if (Array.isArray(pool.topics)) {
          for (const t of pool.topics) {
            topics.push({
              date,
              title: t.topic ?? t.title ?? "",
              score: t.score ?? 0,
              category: t.category ?? "",
              source: (t.evidence?.[0] ?? "").slice(0, 80),
            });
          }
        }
      } catch {
        // skip corrupt pool files
      }
    }

    // Load report excerpts (first 600 chars of each report)
    excerpts[date] = {};
    for (const report of reports) {
      // Only index primary (non-English) reports to keep size down
      if (report.endsWith("-en")) continue;
      const reportPath = path.join(dateDir, `${report}.md`);
      if (fs.existsSync(reportPath)) {
        try {
          const content = fs.readFileSync(reportPath, "utf-8");
          excerpts[date][report] = content.slice(0, 600);
        } catch {
          // skip unreadable reports
        }
      }
    }
  }

  // Sort topics by score descending
  topics.sort((a, b) => b.score - a.score);

  const searchIndex = {
    generated: new Date().toISOString(),
    topics,
    excerpts,
  };

  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(searchIndex, null, 2) + "\n");
  console.log(`search-index.json updated: ${topics.length} topics across ${entries.length} dates`);
}

// Run only when executed directly (not imported for testing)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("generate-manifest.ts") || process.argv[1].endsWith("generate-manifest.js"));
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
