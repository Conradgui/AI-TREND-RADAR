/**
 * AI Topic Radar: daily AI source digest and editorial topic pool.
 *
 * Env vars:
 *   LLM_PROVIDER        - "anthropic" | "openai" | "github-copilot" | "openrouter" | "deepseek" (default: anthropic)
 *   GITHUB_TOKEN        - GitHub token for higher rate limits and issue creation (optional locally)
 *   DIGEST_REPO         - owner/repo where digest issues are posted (optional)
 *
 * Provider-specific env vars — see src/providers/ for full list.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  type GitHubItem,
  type RepoFetch,
  fetchRecentItems,
  fetchRecentReleases,
  fetchSkillsData,
  createGitHubIssue,
} from "./github.ts";
import {
  type RepoDigest,
  buildCliPrompt,
  buildPeerPrompt,
  buildComparisonPrompt,
  buildPeersComparisonPrompt,
  buildSkillsPrompt,
} from "./prompts.ts";
import { buildTrendingPrompt, buildHighlightsPrompt, type ReportHighlights } from "./prompts-data.ts";
import { callLlm, saveFile, autoGenFooter, LLM_TOKENS_TRENDING } from "./report.ts";
import { buildCliReportContent, buildOpenclawReportContent } from "./report-builders.ts";
import {
  saveWebReport,
  saveTrendingReport,
  saveHnReport,
  savePhReport,
  saveArxivReport,
  saveHfReport,
  saveCommunityReport,
  saveChinaTechReport,
} from "./report-savers.ts";
import { loadWebState, saveWebState, fetchSiteContent, type WebFetchResult, type WebState } from "./web.ts";
import { fetchTrendingData, type TrendingData } from "./trending.ts";
import { fetchHnData, type HnData } from "./hn.ts";
import { fetchPhData, type PhData } from "./ph.ts";
import { fetchArxivData, type ArxivData } from "./arxiv.ts";
import { fetchHfData, type HfData } from "./hf.ts";
import { fetchDevtoData, type DevtoData } from "./devto.ts";
import { fetchLobstersData, type LobstersData } from "./lobsters.ts";
import { fetchChinaSourcesData, type ChinaSourcesData } from "./china-sources.ts";
import { loadConfig } from "./config.ts";
import { toCstDateStr, toUtcStr } from "./date.ts";
import { type Lang, MSG, ISSUE_LABELS, CLI_ISSUE_TITLE, OPENCLAW_ISSUE_TITLE } from "./i18n.ts";
import { buildTopicRadar, saveTopicRadar } from "./topic-radar.ts";
import { getReportLangs, shouldSaveSourceReports } from "./options.ts";

// ---------------------------------------------------------------------------
// Repo config — loaded from config.yml, falls back to built-in defaults
// ---------------------------------------------------------------------------

const {
  cliRepos: CLI_REPOS,
  skillsRepo: CLAUDE_SKILLS_REPO,
  openclaw: OPENCLAW,
  openclawPeers: OPENCLAW_PEERS,
} = loadConfig();

// ---------------------------------------------------------------------------
// Phase 1: Fetch
// ---------------------------------------------------------------------------

async function fetchAllData(
  since: Date,
  webState: WebState,
): Promise<{
  fetched: RepoFetch[];
  skillsData: { prs: GitHubItem[]; issues: GitHubItem[] };
  webResults: WebFetchResult[];
  trendingData: TrendingData;
  hnData: HnData;
  phData: PhData;
  arxivData: ArxivData;
  hfData: HfData;
  devtoData: DevtoData;
  lobstersData: LobstersData;
  chinaSourcesData: ChinaSourcesData;
}> {
  const allConfigs = [...CLI_REPOS, OPENCLAW, ...OPENCLAW_PEERS];
  console.log(
    `  Tracking: ${allConfigs.map((r) => r.id).join(", ")}, claude-code-skills, web, hn, ph, arxiv, hf, devto, lobsters`,
  );

  const [
    fetched,
    skillsData,
    webResults,
    trendingData,
    hnData,
    phData,
    arxivData,
    hfData,
    devtoData,
    lobstersData,
    chinaSourcesData,
  ] = await Promise.all([
    Promise.all(
      allConfigs.map(async (cfg) => {
        try {
          const [issuesRaw, prs, releases] = await Promise.all([
            fetchRecentItems(cfg, "issues", since),
            fetchRecentItems(cfg, "pulls", since),
            fetchRecentReleases(cfg.repo, since),
          ]);
          const issues = issuesRaw.filter((i) => !i.pull_request);
          console.log(
            `  [${cfg.id}] issues: ${issues.length}, prs: ${prs.length}, releases: ${releases.length}`,
          );
          return { cfg, issues, prs, releases };
        } catch (err) {
          console.error(`  [${cfg.id}] fetch failed: ${err}`);
          return { cfg, issues: [], prs: [], releases: [] };
        }
      }),
    ),
    fetchSkillsData(CLAUDE_SKILLS_REPO)
      .then((d) => {
        console.log(`  [claude-code-skills] prs: ${d.prs.length}, issues: ${d.issues.length}`);
        return d;
      })
      .catch((err) => {
        console.error(`  [claude-code-skills] fetch failed: ${err}`);
        return { prs: [] as GitHubItem[], issues: [] as GitHubItem[] };
      }),
    Promise.all([
      fetchSiteContent("anthropic", webState).catch((err): WebFetchResult => {
        console.error(`  [web/anthropic] fetch failed: ${err}`);
        return {
          site: "anthropic",
          siteName: "Anthropic (Claude)",
          isFirstRun: false,
          newItems: [],
          totalDiscovered: 0,
        };
      }),
      fetchSiteContent("openai", webState).catch((err): WebFetchResult => {
        console.error(`  [web/openai] fetch failed: ${err}`);
        return { site: "openai", siteName: "OpenAI", isFirstRun: false, newItems: [], totalDiscovered: 0 };
      }),
      fetchSiteContent("deepmind", webState).catch((err): WebFetchResult => {
        console.error(`  [web/deepmind] fetch failed: ${err}`);
        return { site: "deepmind", siteName: "Google DeepMind", isFirstRun: false, newItems: [], totalDiscovered: 0 };
      }),
    ]),
    fetchTrendingData().catch(
      (): TrendingData => ({
        trendingRepos: [],
        searchRepos: [],
        trendingFetchSuccess: false,
      }),
    ),
    fetchHnData().catch((): HnData => ({ stories: [], fetchSuccess: false })),
    fetchPhData().catch((): PhData => ({ products: [], fetchSuccess: false })),
    fetchArxivData().catch((): ArxivData => ({ papers: [], fetchSuccess: false })),
    fetchHfData().catch((): HfData => ({ models: [], fetchSuccess: false })),
    fetchDevtoData().catch((): DevtoData => ({ articles: [], fetchSuccess: false })),
    fetchLobstersData().catch((): LobstersData => ({ stories: [], fetchSuccess: false })),
    fetchChinaSourcesData().catch(
      (): ChinaSourcesData => ({
        kr36: { articles: [], fetchSuccess: false },
        infoqCn: { articles: [], fetchSuccess: false },
        gitee: { projects: [], fetchSuccess: false },
        oschina: { news: [], fetchSuccess: false },
        juejin: { articles: [], fetchSuccess: false },
      }),
    ),
  ]);

  return {
    fetched,
    skillsData,
    webResults,
    trendingData,
    hnData,
    phData,
    arxivData,
    hfData,
    devtoData,
    lobstersData,
    chinaSourcesData,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: LLM summaries
// ---------------------------------------------------------------------------

/** Call LLM with logging and error fallback. */
async function summarize(id: string, prompt: string, failMsg: string, maxTokens?: number): Promise<string> {
  console.log(`  [${id}] Calling LLM for summary...`);
  try {
    return await callLlm(prompt, maxTokens);
  } catch (err) {
    console.error(`  [${id}] LLM call failed: ${err}`);
    return failMsg;
  }
}

/** Summarize a repo's activity, returning a RepoDigest. Skips LLM if no data. */
async function summarizeRepo(
  { cfg, issues, prs, releases }: RepoFetch,
  prompt: string,
  noActivityMsg: string,
  failMsg: string,
): Promise<RepoDigest> {
  if (!issues.length && !prs.length && !releases.length) {
    console.log(`  [${cfg.id}] No activity, skipping LLM call`);
    return { config: cfg, issues, prs, releases, summary: noActivityMsg };
  }
  const summary = await summarize(cfg.id, prompt, failMsg);
  return { config: cfg, issues, prs, releases, summary };
}

async function generateSummaries(
  fetchedCli: RepoFetch[],
  fetchedOpenclaw: RepoFetch,
  skillsData: { prs: GitHubItem[]; issues: GitHubItem[] },
  fetchedPeers: RepoFetch[],
  trendingData: TrendingData,
  dateStr: string,
  lang: Lang = "zh",
): Promise<{
  cliDigests: RepoDigest[];
  openclawSummary: string;
  skillsSummary: string;
  peerDigests: RepoDigest[];
  trendingSummary: string;
}> {
  const noActivity = MSG.noActivity[lang];
  const fail = MSG.summaryFailed[lang];

  const [cliDigests, openclawSummary, skillsSummary, peerDigests, trendingSummary] = await Promise.all([
    Promise.all(
      fetchedCli.map((f) =>
        summarizeRepo(f, buildCliPrompt(f.cfg, f.issues, f.prs, f.releases, dateStr, lang), noActivity, fail),
      ),
    ),
    summarizeRepo(
      fetchedOpenclaw,
      buildPeerPrompt(
        fetchedOpenclaw.cfg,
        fetchedOpenclaw.issues,
        fetchedOpenclaw.prs,
        fetchedOpenclaw.releases,
        dateStr,
        50,
        30,
        lang,
      ),
      noActivity,
      fail,
    ).then((d) => d.summary),
    summarize(
      "claude-code-skills",
      buildSkillsPrompt(skillsData.prs, skillsData.issues, dateStr, lang),
      MSG.skillsFailed[lang],
    ),
    Promise.all(
      fetchedPeers.map((f) =>
        summarizeRepo(
          f,
          buildPeerPrompt(f.cfg, f.issues, f.prs, f.releases, dateStr, undefined, undefined, lang),
          noActivity,
          fail,
        ),
      ),
    ),
    (async () => {
      const hasData = trendingData.trendingRepos.length > 0 || trendingData.searchRepos.length > 0;
      if (!hasData) {
        return MSG.trendingNoData[lang];
      }
      return summarize(
        "trending",
        buildTrendingPrompt(trendingData, dateStr, lang),
        MSG.trendingFailed[lang],
        LLM_TOKENS_TRENDING,
      );
    })(),
  ]);

  return { cliDigests, openclawSummary, skillsSummary, peerDigests, trendingSummary };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dateStr = toCstDateStr(now);
  const utcStr = toUtcStr(now);
  const digestRepo = process.env["DIGEST_REPO"] ?? "";
  const reportLangs = getReportLangs();
  const saveSourceReports = shouldSaveSourceReports();

  const providerName = process.env["LLM_PROVIDER"] ?? "anthropic";
  console.log(`[${now.toISOString()}] Starting digest | provider: ${providerName}`);
  console.log(
    `  Report langs: ${reportLangs.join(", ")} | source reports: ${saveSourceReports ? "enabled" : "disabled"}`,
  );
  if (!process.env["GITHUB_TOKEN"]) {
    console.log("  [github] GITHUB_TOKEN not set — using unauthenticated GitHub API with lower rate limits.");
  }

  // 1. Fetch all data in parallel
  const webState = loadWebState();
  const {
    fetched,
    skillsData,
    webResults,
    trendingData,
    hnData,
    phData,
    arxivData,
    hfData,
    devtoData,
    lobstersData,
    chinaSourcesData,
  } = await fetchAllData(since, webState);

  const peerIds = new Set(OPENCLAW_PEERS.map((p) => p.id));
  const fetchedCli = fetched.filter((f) => f.cfg.id !== OPENCLAW.id && !peerIds.has(f.cfg.id));
  const fetchedOpenclaw = fetched.find((f) => f.cfg.id === OPENCLAW.id)!;
  const fetchedPeers = fetched.filter((f) => peerIds.has(f.cfg.id));

  const cliContent: Partial<Record<Lang, string>> = {};
  const openclawContent: Partial<Record<Lang, string>> = {};

  if (saveSourceReports) {
    type Summaries = Awaited<ReturnType<typeof generateSummaries>>;
    const summariesByLang: Partial<Record<Lang, Summaries>> = {};
    const comparisonByLang: Partial<Record<Lang, string>> = {};
    const peersComparisonByLang: Partial<Record<Lang, string>> = {};

    console.log(`  Generating source summaries for: ${reportLangs.join(", ")}`);
    await Promise.all(
      reportLangs.map(async (lang) => {
        summariesByLang[lang] = await generateSummaries(
          fetchedCli,
          fetchedOpenclaw,
          skillsData,
          fetchedPeers,
          trendingData,
          dateStr,
          lang,
        );
      }),
    );

    console.log(`  Calling LLM for comparative analyses: ${reportLangs.join(", ")}`);
    await Promise.all(
      reportLangs.map(async (lang) => {
        const summaries = summariesByLang[lang]!;
        const openclawDigest: RepoDigest = {
          config: OPENCLAW,
          issues: fetchedOpenclaw.issues,
          prs: fetchedOpenclaw.prs,
          releases: fetchedOpenclaw.releases,
          summary: summaries.openclawSummary,
        };
        const [comparison, peersComparison] = await Promise.all([
          callLlm(buildComparisonPrompt(summaries.cliDigests, dateStr, lang)),
          callLlm(buildPeersComparisonPrompt(openclawDigest, summaries.peerDigests, dateStr, lang)),
        ]);
        comparisonByLang[lang] = comparison;
        peersComparisonByLang[lang] = peersComparison;
      }),
    );

    for (const lang of reportLangs) {
      const s = summariesByLang[lang]!;
      const ft = autoGenFooter(lang);
      const suffix = lang === "en" ? "-en" : "";

      cliContent[lang] = buildCliReportContent(
        s.cliDigests,
        s.skillsSummary,
        comparisonByLang[lang]!,
        utcStr,
        dateStr,
        ft,
        CLAUDE_SKILLS_REPO,
        lang,
      );
      openclawContent[lang] = buildOpenclawReportContent(
        fetchedOpenclaw,
        s.peerDigests,
        s.openclawSummary,
        peersComparisonByLang[lang]!,
        utcStr,
        dateStr,
        ft,
        OPENCLAW,
        OPENCLAW_PEERS,
        lang,
      );

      console.log(`  Saved ${saveFile(cliContent[lang]!, dateStr, `ai-cli${suffix}.md`)}`);
      console.log(`  Saved ${saveFile(openclawContent[lang]!, dateStr, `ai-agents${suffix}.md`)}`);
    }

    for (const lang of reportLangs) {
      await saveWebReport(webResults, webState, utcStr, dateStr, digestRepo, autoGenFooter(lang), lang);
    }

    await Promise.all(
      reportLangs.flatMap((lang) => {
        const s = summariesByLang[lang]!;
        const ft = autoGenFooter(lang);
        return [
          saveTrendingReport(trendingData, s.trendingSummary, utcStr, dateStr, digestRepo, ft, lang),
          saveHnReport(hnData, utcStr, dateStr, digestRepo, ft, lang),
          savePhReport(phData, utcStr, dateStr, digestRepo, ft, lang),
          saveArxivReport(arxivData, utcStr, dateStr, digestRepo, ft, lang),
          saveHfReport(hfData, utcStr, dateStr, digestRepo, ft, lang),
          saveCommunityReport(devtoData, lobstersData, utcStr, dateStr, digestRepo, ft, lang),
          saveChinaTechReport(chinaSourcesData, utcStr, dateStr, digestRepo, ft, lang),
        ];
      }),
    );
  } else {
    saveWebState(webState);
    console.log("  [web] State saved.");
  }

  // 5. Build the editorial topic pool from all public source signals.
  const topicRadar = buildTopicRadar({
    trendingData,
    hnData,
    phData,
    arxivData,
    hfData,
    webResults,
    chinaSourcesData,
    dateStr,
    utcStr,
    now,
  });
  const { htmlPath, markdownPath, jsonPath } = saveTopicRadar(topicRadar);
  console.log(`  Saved ${htmlPath}`);
  console.log(`  Saved ${markdownPath}`);
  console.log(`  Saved ${jsonPath}`);

  // 6. Generate highlights for Telegram notification
  const readReport = (name: string): string | undefined => {
    const p = path.join("digests", dateStr, name);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : undefined;
  };

  const zhReports: Record<string, string> = {
    "ai-topic-radar": topicRadar.candidates
      .slice(0, 10)
      .map((item) => `${item.score} ${item.action} ${item.title}: ${item.reason}`)
      .join("\n"),
  };
  const enReports: Record<string, string> = {};
  if (cliContent.zh) zhReports["ai-cli"] = cliContent.zh;
  if (openclawContent.zh) zhReports["ai-agents"] = openclawContent.zh;
  if (cliContent.en) enReports["ai-cli"] = cliContent.en;
  if (openclawContent.en) enReports["ai-agents"] = openclawContent.en;

  if (saveSourceReports) {
    for (const [id, zhFile, enFile] of [
      ["ai-trending", "ai-trending.md", "ai-trending-en.md"],
      ["ai-web", "ai-web.md", "ai-web-en.md"],
      ["ai-hn", "ai-hn.md", "ai-hn-en.md"],
      ["ai-ph", "ai-ph.md", "ai-ph-en.md"],
      ["ai-arxiv", "ai-arxiv.md", "ai-arxiv-en.md"],
      ["ai-hf", "ai-hf.md", "ai-hf-en.md"],
      ["ai-community", "ai-community.md", "ai-community-en.md"],
      ["ai-china-tech", "ai-china-tech.md", "ai-china-tech-en.md"],
    ] as const) {
      const zh = readReport(zhFile);
      const en = readReport(enFile);
      if (zh) zhReports[id] = zh;
      if (en) enReports[id] = en;
    }
  }

  console.log("  Generating highlights for Telegram...");
  const highlights: Record<Lang, ReportHighlights> = { zh: {}, en: {} };
  try {
    const zhRaw = await callLlm(buildHighlightsPrompt(zhReports, "zh"), 2048);
    highlights.zh = JSON.parse(
      zhRaw
        .replace(/```json?\n?/g, "")
        .replace(/```/g, "")
        .trim(),
    );
    if (reportLangs.includes("en")) {
      const enRaw = await callLlm(buildHighlightsPrompt(enReports, "en"), 2048);
      highlights.en = JSON.parse(
        enRaw
          .replace(/```json?\n?/g, "")
          .replace(/```/g, "")
          .trim(),
      );
    }
  } catch (err) {
    console.error(`  [highlights] Generation failed: ${err}`);
  }

  const highlightsPath = saveFile(JSON.stringify(highlights, null, 2), dateStr, "highlights.json");
  console.log(`  Saved ${highlightsPath}`);

  // 7. Create GitHub issues for source reports only when source reports are enabled.
  if (digestRepo && saveSourceReports) {
    for (const lang of reportLangs) {
      if (!cliContent[lang] || !openclawContent[lang]) continue;
      const cliUrl = await createGitHubIssue(
        CLI_ISSUE_TITLE(dateStr, lang),
        cliContent[lang],
        ISSUE_LABELS.cli[lang],
      );
      console.log(`  Created CLI issue (${lang}): ${cliUrl}`);

      const ocUrl = await createGitHubIssue(
        OPENCLAW_ISSUE_TITLE(dateStr, lang),
        openclawContent[lang],
        ISSUE_LABELS.openclaw[lang],
      );
      console.log(`  Created OpenClaw issue (${lang}): ${ocUrl}`);
    }
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
