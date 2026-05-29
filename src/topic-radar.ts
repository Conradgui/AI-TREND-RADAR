/**
 * AI Topic Radar: resume-oriented topic scoring and digest generation.
 *
 * This module keeps the upstream agents-radar data fetchers intact, then
 * normalizes successful source payloads into an editorial topic pool.
 */

import type { TrendingData } from "./trending.ts";
import type { HnData } from "./hn.ts";
import type { PhData } from "./ph.ts";
import type { ArxivData } from "./arxiv.ts";
import type { HfData } from "./hf.ts";
import type { WebFetchResult } from "./web.ts";
import type { ChinaSourcesData } from "./china-sources.ts";
import fs from "node:fs";
import path from "node:path";

export const TOPIC_CATEGORIES = [
  "政策监管、社会影响与 AI 安全",
  "模型与技术突破",
  "AI 产品与用户入口",
  "企业落地与行业应用",
  "标杆企业动向、商业格局与投融资",
] as const;

export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export type TopicAction = "深挖" | "入池" | "观察" | "归档";

interface RawTopic {
  title: string;
  url: string;
  source: string;
  sourceType: "github" | "community" | "product" | "research" | "model" | "official";
  summary: string;
  publishedAt?: string;
  heatSignals: number[];
  tags: string[];
}

export interface TopicScoreBreakdown {
  commercialImpact: number;
  heat: number;
  freshness: number;
  writability: number;
}

export interface TopicCandidate {
  title: string;
  summary: string;
  recommendedTopic: string;
  url: string;
  source: string;
  category: TopicCategory;
  score: number;
  action: TopicAction;
  angle: string;
  reason: string;
  evidence: string[];
  breakdown: TopicScoreBreakdown;
  tags: string[];
}

export interface TopicRadarInput {
  trendingData: TrendingData;
  hnData: HnData;
  phData: PhData;
  arxivData: ArxivData;
  hfData: HfData;
  webResults: WebFetchResult[];
  chinaSourcesData?: ChinaSourcesData;
  dateStr: string;
  utcStr: string;
  now?: Date;
}

export interface TopicRadarResult {
  generatedAt: string;
  date: string;
  candidates: TopicCandidate[];
  warnings: string[];
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function textOf(topic: RawTopic): string {
  return `${topic.title} ${topic.summary} ${topic.tags.join(" ")}`.toLowerCase();
}

function hasAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function classify(topic: RawTopic): TopicCategory {
  const text = textOf(topic);
  if (
    hasAny(text, [
      "regulation",
      "policy",
      "safety",
      "alignment",
      "privacy",
      "security",
      "copyright",
      "risk",
      "governance",
      "监管",
      "安全",
      "政策",
    ])
  ) {
    return "政策监管、社会影响与 AI 安全";
  }
  if (
    topic.sourceType === "research" ||
    topic.sourceType === "model" ||
    hasAny(text, ["model", "benchmark", "reasoning", "multimodal", "inference", "training", "模型", "论文"])
  ) {
    return "模型与技术突破";
  }
  if (
    hasAny(text, [
      "enterprise",
      "customer",
      "workflow",
      "industry",
      "healthcare",
      "finance",
      "education",
      "manufacturing",
      "企业",
      "行业",
      "落地",
    ])
  ) {
    return "企业落地与行业应用";
  }
  if (
    topic.sourceType === "official" ||
    hasAny(text, [
      "funding",
      "acquisition",
      "pricing",
      "revenue",
      "partnership",
      "launch",
      "openai",
      "anthropic",
      "google",
      "meta",
      "microsoft",
      "融资",
      "商业",
      "大厂",
    ])
  ) {
    return "标杆企业动向、商业格局与投融资";
  }
  return "AI 产品与用户入口";
}

function heatScore(topic: RawTopic): number {
  const strongestSignal = Math.max(0, ...topic.heatSignals);
  switch (topic.sourceType) {
    case "product":
      return clamp(strongestSignal / 8, 30);
    case "community":
      return clamp(strongestSignal / 12, 30);
    case "github":
      return clamp(strongestSignal / 15, 30);
    case "model":
      return clamp(strongestSignal / 20, 30);
    case "official":
      return 24;
    case "research":
      return 16;
  }
}

function freshnessScore(topic: RawTopic, now: Date): number {
  if (!topic.publishedAt) return 12;
  const time = new Date(topic.publishedAt).getTime();
  if (Number.isNaN(time)) return 12;
  const days = (now.getTime() - time) / (24 * 60 * 60 * 1000);
  if (days <= 1) return 20;
  if (days <= 2) return 16;
  if (days <= 7) return 10;
  return 5;
}

function commercialImpactScore(topic: RawTopic, category: TopicCategory): number {
  const text = textOf(topic);
  let score = 8;
  if (topic.sourceType === "official") score += 16;
  if (topic.sourceType === "product") score += 12;
  if (topic.sourceType === "community") score += 7;
  if (category === "标杆企业动向、商业格局与投融资") score += 9;
  if (category === "企业落地与行业应用") score += 7;
  if (category === "AI 产品与用户入口") score += 6;
  if (
    hasAny(text, [
      "pricing",
      "revenue",
      "enterprise",
      "launch",
      "partnership",
      "funding",
      "商业",
      "企业",
      "用户",
    ])
  )
    score += 7;
  if (hasAny(text, ["openai", "anthropic", "google", "meta", "microsoft", "nvidia", "apple"])) score += 5;
  return clamp(score, 40);
}

function writabilityScore(topic: RawTopic, category: TopicCategory): number {
  let score = 4;
  if (topic.summary.length >= 80) score += 2;
  if (topic.url) score += 1;
  if (topic.tags.length > 0) score += 1;
  if (category === "AI 产品与用户入口" || category === "标杆企业动向、商业格局与投融资") score += 2;
  return clamp(score, 10);
}

function decideAction(score: number): TopicAction {
  if (score >= 80) return "深挖";
  if (score >= 65) return "入池";
  if (score >= 50) return "观察";
  return "归档";
}

function angleFor(category: TopicCategory): string {
  switch (category) {
    case "政策监管、社会影响与 AI 安全":
      return "适合从政策变化、信任风险和安全治理角度切入";
    case "模型与技术突破":
      return "适合从模型能力变化、技术路线和产品化可能性角度切入";
    case "AI 产品与用户入口":
      return "适合从用户入口、使用场景和产品体验角度切入";
    case "企业落地与行业应用":
      return "适合从行业场景、落地成本和业务价值角度切入";
    case "标杆企业动向、商业格局与投融资":
      return "适合从大厂动作、商业化路径和竞争格局角度切入";
  }
}

function buildReason(topic: RawTopic, category: TopicCategory, score: number, evidence: string[]): string {
  const scoreBand = score >= 80 ? "值得优先深挖" : score >= 65 ? "适合进入今日选题池" : "适合作为观察项";
  const mainEvidence = evidence[0] ?? `${topic.source} 出现新信号`;
  return `${scoreBand}：${angleFor(category)}，${mainEvidence}。`;
}

function topicAngleLabel(category: TopicCategory): string {
  switch (category) {
    case "政策监管、社会影响与 AI 安全":
      return "政策变化、信任风险与安全治理";
    case "模型与技术突破":
      return "模型能力变化与技术路线";
    case "AI 产品与用户入口":
      return "用户入口、使用场景与产品体验";
    case "企业落地与行业应用":
      return "行业场景、落地成本与业务价值";
    case "标杆企业动向、商业格局与投融资":
      return "大厂动作、商业化路径与竞争格局";
  }
}

function buildRecommendedTopic(topic: RawTopic, category: TopicCategory): string {
  const title = topic.title.trim();
  const angle = topicAngleLabel(category);
  const hasCjk = /[\u3400-\u9fff]/.test(title);
  const editedTitle = hasCjk ? `${title}值得关注的三个信号` : `${title} 为什么值得关注？`;
  return `${editedTitle}（${angle}）`;
}

function evidenceFor(topic: RawTopic): string[] {
  const evidence = [`来源：${topic.source}`];
  if (topic.heatSignals.length > 0) evidence.push(`热度信号：${topic.heatSignals.join(" / ")}`);
  if (topic.publishedAt) evidence.push(`发布时间：${topic.publishedAt.slice(0, 10)}`);
  if (topic.tags.length > 0) evidence.push(`关键词：${topic.tags.slice(0, 5).join(", ")}`);
  return evidence;
}

function scoreTopic(topic: RawTopic, now: Date): TopicCandidate {
  const category = classify(topic);
  const breakdown: TopicScoreBreakdown = {
    commercialImpact: commercialImpactScore(topic, category),
    heat: heatScore(topic),
    freshness: freshnessScore(topic, now),
    writability: writabilityScore(topic, category),
  };
  const score = breakdown.commercialImpact + breakdown.heat + breakdown.freshness + breakdown.writability;
  const evidence = evidenceFor(topic);
  return {
    title: topic.title,
    summary: topic.summary,
    recommendedTopic: buildRecommendedTopic(topic, category),
    url: topic.url,
    source: topic.source,
    category,
    score,
    action: decideAction(score),
    angle: angleFor(category),
    reason: buildReason(topic, category, score, evidence),
    evidence,
    breakdown,
    tags: topic.tags,
  };
}

function collectRawTopics(input: TopicRadarInput): RawTopic[] {
  const topics: RawTopic[] = [];

  for (const repo of input.trendingData.trendingRepos) {
    topics.push({
      title: repo.fullName,
      url: repo.url,
      source: "GitHub Trending",
      sourceType: "github",
      summary: repo.description,
      heatSignals: [repo.todayStars, repo.totalStars],
      tags: [repo.language].filter(Boolean),
    });
  }
  for (const repo of input.trendingData.searchRepos) {
    topics.push({
      title: repo.fullName,
      url: repo.url,
      source: `GitHub Search:${repo.searchQuery}`,
      sourceType: "github",
      summary: repo.description ?? "",
      publishedAt: repo.pushedAt,
      heatSignals: [repo.stargazersCount],
      tags: [repo.language ?? "", repo.searchQuery].filter(Boolean),
    });
  }
  for (const story of input.hnData.stories) {
    topics.push({
      title: story.title,
      url: story.url,
      source: "Hacker News",
      sourceType: "community",
      summary: `HN discussion by ${story.author}`,
      publishedAt: story.createdAt,
      heatSignals: [story.points, story.comments],
      tags: ["community", "discussion"],
    });
  }
  for (const product of input.phData.products) {
    topics.push({
      title: product.name,
      url: product.website || product.url,
      source: "Product Hunt",
      sourceType: "product",
      summary: product.tagline,
      publishedAt: product.createdAt,
      heatSignals: [product.votesCount, product.commentsCount],
      tags: product.topics,
    });
  }
  for (const paper of input.arxivData.papers) {
    topics.push({
      title: paper.title,
      url: paper.url,
      source: "ArXiv",
      sourceType: "research",
      summary: paper.summary,
      publishedAt: paper.published,
      heatSignals: [],
      tags: paper.categories,
    });
  }
  for (const model of input.hfData.models) {
    topics.push({
      title: model.id,
      url: model.url,
      source: "Hugging Face",
      sourceType: "model",
      summary: `${model.pipelineTag} model by ${model.author}`,
      publishedAt: model.lastModified,
      heatSignals: [model.likes, model.downloads],
      tags: [model.pipelineTag, ...model.tags].filter(Boolean),
    });
  }
  for (const result of input.webResults) {
    for (const item of result.newItems) {
      topics.push({
        title: item.title,
        url: item.url,
        source: result.siteName,
        sourceType: "official",
        summary: item.content,
        publishedAt: item.lastmod,
        heatSignals: [],
        tags: [item.site, item.category],
      });
    }
  }

  // Chinese data sources
  if (input.chinaSourcesData) {
    const cn = input.chinaSourcesData;
    for (const article of cn.kr36.articles) {
      topics.push({
        title: article.title,
        url: article.url,
        source: "36kr",
        sourceType: "community",
        summary: article.summary,
        publishedAt: article.publishedAt,
        heatSignals: [],
        tags: ["36kr", "中国AI"],
      });
    }
    for (const article of cn.infoqCn.articles) {
      topics.push({
        title: article.title,
        url: article.url,
        source: "InfoQ 中国",
        sourceType: "community",
        summary: article.summary,
        publishedAt: article.publishTime,
        heatSignals: [],
        tags: ["infoq-cn", ...article.topics],
      });
    }
    for (const project of cn.gitee.projects) {
      topics.push({
        title: project.fullName,
        url: project.url,
        source: "Gitee",
        sourceType: "github",
        summary: project.description,
        publishedAt: project.updatedAt,
        heatSignals: [project.stars, project.forks],
        tags: ["gitee", project.language].filter(Boolean),
      });
    }
    for (const news of cn.oschina.news) {
      topics.push({
        title: news.title,
        url: news.url,
        source: "开源中国",
        sourceType: "community",
        summary: news.body,
        publishedAt: news.pubDate,
        heatSignals: [],
        tags: ["oschina", "中国AI"],
      });
    }
    for (const article of cn.juejin.articles) {
      topics.push({
        title: article.title,
        url: article.url,
        source: "掘金",
        sourceType: "community",
        summary: article.brief,
        publishedAt: article.publishTime,
        heatSignals: [article.diggCount, article.viewCount],
        tags: ["juejin", ...article.tags],
      });
    }
  }

  return topics;
}

function collectWarnings(input: TopicRadarInput): string[] {
  const warnings: string[] = [];
  if (!input.trendingData.trendingFetchSuccess) {
    warnings.push(
      "GitHub Trending HTML 获取失败；可检查 GitHub 页面结构或网络环境，GitHub Search 结果仍可使用。",
    );
  }
  if (!input.hnData.fetchSuccess) warnings.push("Hacker News 获取失败；可检查 hn.algolia.com 是否可访问。");
  if (!input.phData.fetchSuccess) {
    const hint = process.env["PRODUCTHUNT_TOKEN"]
      ? "Product Hunt 无可用数据；可检查 GraphQL API 响应和 AI topic 过滤条件。"
      : "Product Hunt 已跳过；配置 PRODUCTHUNT_TOKEN 后可启用产品榜单信号。";
    warnings.push(hint);
  }
  if (!input.arxivData.fetchSuccess) warnings.push("ArXiv 获取失败；可检查 export.arxiv.org 网络或重试。");
  if (!input.hfData.fetchSuccess)
    warnings.push("Hugging Face 获取失败；可检查 huggingface.co API 是否可访问。");
  if (!input.webResults.some((result) => result.newItems.length > 0)) {
    warnings.push("官方内容源今日没有检测到新内容；首次运行后这是正常情况。");
  }
  if (input.chinaSourcesData) {
    const cn = input.chinaSourcesData;
    if (!cn.kr36.fetchSuccess) warnings.push("36kr 获取失败；可检查网络或 RSS 源是否可用。");
    if (!cn.infoqCn.fetchSuccess) warnings.push("InfoQ 中国获取失败；可检查 infoq.cn API 是否可用。");
    if (!cn.gitee.fetchSuccess) warnings.push("Gitee 获取失败；可检查 gitee.com API 是否可访问。");
    if (!cn.oschina.fetchSuccess) warnings.push("开源中国获取失败；可检查 oschina.net RSS 是否可用。");
    if (!cn.juejin.fetchSuccess) warnings.push("掘金获取失败；可检查 juejin.com API 是否可用。");
  }
  return warnings;
}

export function buildTopicRadar(input: TopicRadarInput): TopicRadarResult {
  const now = input.now ?? new Date();
  const candidates = collectRawTopics(input)
    .map((topic) => scoreTopic(topic, now))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  return {
    generatedAt: input.utcStr,
    date: input.dateStr,
    candidates,
    warnings: collectWarnings(input),
  };
}

function tableRows(candidates: TopicCandidate[]): string {
  if (candidates.length === 0) return "_暂无条目。_\n";
  const cell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    "| 分数 | 动作 | 题目 | 摘要 | 分类 | 推荐选题 | 推荐理由 | 证据 |",
    "| ---: | --- | --- | --- | --- | --- | --- | --- |",
    ...candidates.map((item) => {
      const evidence = item.evidence.map(cell).join("<br>");
      return `| ${item.score} | ${item.action} | [${cell(item.title)}](${item.url}) | ${cell(item.summary)} | ${item.category} | ${cell(item.recommendedTopic)} | ${cell(item.reason)} | ${evidence} |`;
    }),
  ].join("\n");
}

export function buildTopicRadarMarkdown(result: TopicRadarResult): string {
  const deepDive = result.candidates.filter((item) => item.action === "深挖").slice(0, 10);
  const pool = result.candidates.filter((item) => item.action === "入池").slice(0, 15);
  const watch = result.candidates.filter((item) => item.action === "观察").slice(0, 15);

  const categorySections = TOPIC_CATEGORIES.map((category) => {
    const items = result.candidates.filter((item) => item.category === category).slice(0, 5);
    return `### ${category}\n\n${tableRows(items)}\n`;
  }).join("\n");

  const warningSection =
    result.warnings.length === 0
      ? "暂无失败或跳过的数据源。\n"
      : result.warnings.map((warning) => `- ${warning}`).join("\n") + "\n";

  return [
    `# AI 热点选题池 ${result.date}`,
    "",
    `> 生成时间: ${result.generatedAt} UTC | 目标: 每日发现值得写、值得测、值得深挖的 AI 选题`,
    "",
    "## 今日 Top 深挖选题",
    "",
    tableRows(deepDive),
    "",
    "## 入池选题",
    "",
    tableRows(pool),
    "",
    "## 按五类选题分类摘要",
    "",
    categorySections,
    "## 观察项",
    "",
    tableRows(watch),
    "",
    "## 数据源状态与修复提示",
    "",
    warningSection,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderTopicCards(candidates: TopicCandidate[]): string {
  if (candidates.length === 0) {
    return `<p class="empty">暂无条目。</p>`;
  }

  return candidates
    .map((item) => {
      const evidence = item.evidence.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
      const tags = item.tags.length
        ? `<div class="tags">${item.tags
            .slice(0, 6)
            .map((tag) => `<span>${escapeHtml(tag)}</span>`)
            .join("")}</div>`
        : "";
      return `
        <article class="topic-card">
          <div class="topic-head">
            <div>
              <a class="topic-title" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
              <div class="meta">${escapeHtml(item.source)} · ${escapeHtml(item.category)}</div>
            </div>
            <div class="score">
              <strong>${item.score}</strong>
              <span>${escapeHtml(item.action)}</span>
            </div>
          </div>
          <p class="summary">${escapeHtml(item.summary)}</p>
          <p class="recommended"><strong>推荐选题：</strong>${escapeHtml(item.recommendedTopic)}</p>
          <p>${escapeHtml(item.reason)}</p>
          ${tags}
          <details>
            <summary>关键证据</summary>
            <ul>${evidence}</ul>
          </details>
        </article>
      `;
    })
    .join("\n");
}

export function buildTopicRadarHtml(result: TopicRadarResult): string {
  const deepDive = result.candidates.filter((item) => item.action === "深挖").slice(0, 10);
  const pool = result.candidates.filter((item) => item.action === "入池").slice(0, 15);
  const watch = result.candidates.filter((item) => item.action === "观察").slice(0, 15);
  const warnings =
    result.warnings.length === 0
      ? `<p class="empty">暂无失败或跳过的数据源。</p>`
      : `<ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`;

  const categorySections = TOPIC_CATEGORIES.map((category) => {
    const items = result.candidates.filter((item) => item.category === category).slice(0, 5);
    return `
      <section>
        <h3>${escapeHtml(category)}</h3>
        ${renderTopicCards(items)}
      </section>
    `;
  }).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 热点选题池 ${escapeHtml(result.date)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #172033;
      --muted: #667085;
      --line: #d8dee9;
      --accent: #2563eb;
      --accent-soft: #e8f0ff;
      --green: #0f8a5f;
      --shadow: 0 16px 40px rgba(17, 24, 39, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 20px 64px;
    }
    header {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 28px;
      margin-bottom: 24px;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 { font-size: 32px; line-height: 1.2; margin-bottom: 12px; }
    h2 { font-size: 24px; margin: 32px 0 16px; }
    h3 { font-size: 18px; margin: 24px 0 12px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .summary {
      color: var(--muted);
      margin-bottom: 0;
    }
    .quick-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .quick-links a, .quick-links span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 12px;
      background: #fff;
      color: var(--text);
      font-size: 14px;
    }
    .topic-grid {
      display: grid;
      gap: 14px;
    }
    .topic-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      box-shadow: 0 8px 24px rgba(17, 24, 39, 0.05);
    }
    .topic-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: start;
    }
    .topic-title {
      display: inline-block;
      font-weight: 700;
      font-size: 17px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      margin-top: 4px;
    }
    .score {
      min-width: 72px;
      border-radius: 8px;
      background: var(--accent-soft);
      color: var(--accent);
      text-align: center;
      padding: 8px 10px;
    }
    .score strong {
      display: block;
      font-size: 24px;
      line-height: 1;
    }
    .score span {
      display: block;
      margin-top: 4px;
      font-size: 13px;
      color: var(--text);
    }
    .summary {
      color: #344054;
      font-weight: 500;
    }
    .recommended {
      background: #f8fafc;
      border-left: 3px solid var(--accent);
      border-radius: 6px;
      padding: 8px 10px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 12px 0;
    }
    .tags span {
      background: #eef2f7;
      border-radius: 999px;
      color: #475467;
      font-size: 12px;
      padding: 3px 8px;
    }
    details {
      border-top: 1px solid var(--line);
      margin-top: 12px;
      padding-top: 10px;
    }
    summary {
      cursor: pointer;
      color: var(--green);
      font-weight: 600;
    }
    ul { padding-left: 20px; }
    .empty {
      color: var(--muted);
      background: var(--panel);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .category-stack {
      display: grid;
      gap: 10px;
    }
    footer {
      color: var(--muted);
      font-size: 13px;
      margin-top: 36px;
    }
    @media (max-width: 640px) {
      main { padding: 24px 12px 48px; }
      header { padding: 20px; }
      h1 { font-size: 26px; }
      .topic-head { grid-template-columns: 1fr; }
      .score { width: 84px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>AI 热点选题池 ${escapeHtml(result.date)}</h1>
      <p class="summary">面向 AI 内容运营和产品调研的每日选题监控报告。默认入口为本 HTML 文件，可直接双击查看，也可通过 GitHub Pages 分享。</p>
      <div class="quick-links">
        <span>生成时间：${escapeHtml(result.generatedAt)} UTC</span>
        <a href="./ai-topic-radar.md">Markdown</a>
        <a href="./topic-pool.json">JSON 选题池</a>
      </div>
    </header>

    <section id="top">
      <h2>今日 Top 深挖选题</h2>
      <div class="topic-grid">${renderTopicCards(deepDive)}</div>
    </section>

    <section id="pool">
      <h2>入池选题</h2>
      <div class="topic-grid">${renderTopicCards(pool)}</div>
    </section>

    <section id="categories">
      <h2>按五类选题分类摘要</h2>
      <div class="category-stack">${categorySections}</div>
    </section>

    <section id="watch">
      <h2>观察项</h2>
      <div class="topic-grid">${renderTopicCards(watch)}</div>
    </section>

    <section id="status">
      <h2>数据源状态与修复提示</h2>
      ${warnings}
    </section>

    <footer>AI Topic Radar · 单文件报告 · 不包含私有资料或 API key</footer>
  </main>
</body>
</html>
`;
}

export function saveTopicRadar(result: TopicRadarResult): {
  htmlPath: string;
  markdownPath: string;
  jsonPath: string;
} {
  const dir = path.join("digests", result.date);
  fs.mkdirSync(dir, { recursive: true });

  const htmlPath = path.join(dir, "ai-topic-radar.html");
  const markdownPath = path.join(dir, "ai-topic-radar.md");
  const jsonPath = path.join(dir, "topic-pool.json");
  fs.writeFileSync(htmlPath, buildTopicRadarHtml(result), "utf-8");
  fs.writeFileSync(markdownPath, buildTopicRadarMarkdown(result), "utf-8");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n", "utf-8");
  return { htmlPath, markdownPath, jsonPath };
}
