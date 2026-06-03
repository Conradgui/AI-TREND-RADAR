import { describe, expect, it } from "vitest";
import { buildTopicRadar, buildTopicRadarHtml, buildTopicRadarMarkdown } from "../topic-radar.ts";
import type { TopicRadarInput } from "../topic-radar.ts";

function baseInput(): TopicRadarInput {
  return {
    dateStr: "2026-05-20",
    utcStr: "2026-05-20 02:00",
    now: new Date("2026-05-20T02:00:00Z"),
    trendingData: {
      trendingRepos: [],
      searchRepos: [],
      trendingFetchSuccess: true,
    },
    hnData: {
      stories: [],
      fetchSuccess: true,
    },
    phData: {
      products: [],
      fetchSuccess: true,
    },
    arxivData: {
      papers: [],
      fetchSuccess: true,
    },
    hfData: {
      models: [],
      fetchSuccess: true,
    },
    webResults: [
      {
        site: "openai",
        siteName: "OpenAI",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
      },
    ],
  };
}

describe("buildTopicRadar", () => {
  it("scores high-impact product signals as deep-dive topics", () => {
    const input = baseInput();
    input.phData.products = [
      {
        id: "p1",
        name: "Workflow AI Copilot",
        tagline: "Enterprise AI workflow launch for customer support and revenue teams",
        url: "https://www.producthunt.com/posts/workflow-ai-copilot",
        website: "https://example.com",
        votesCount: 360,
        commentsCount: 80,
        createdAt: "2026-05-20T00:30:00Z",
        topics: ["artificial-intelligence", "enterprise", "workflow"],
      },
    ];

    const result = buildTopicRadar(input);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      title: "Workflow AI Copilot",
      source: "Product Hunt",
      action: "深挖",
      category: "企业落地与行业应用",
    });
    expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(80);
    expect(result.candidates[0]!.evidence.join(" ")).toContain("Product Hunt");
  });

  it("keeps source warnings without blocking topic pool generation", () => {
    const input = baseInput();
    input.trendingData.trendingFetchSuccess = false;
    input.hnData.fetchSuccess = false;
    input.phData.fetchSuccess = false;

    const result = buildTopicRadar(input);

    expect(result.candidates).toEqual([]);
    expect(result.warnings.join("\n")).toContain("GitHub Trending");
    expect(result.warnings.join("\n")).toContain("Hacker News");
    expect(result.warnings.join("\n")).toContain("Product Hunt");
  });

  it("renders a decision-first markdown report", () => {
    const input = baseInput();
    input.webResults[0]!.newItems = [
      {
        url: "https://openai.com/index/new-model",
        title: "New multimodal model launch",
        lastmod: "2026-05-20",
        content: "OpenAI launches a new multimodal model with product availability and enterprise pricing.",
        site: "openai",
        category: "product",
      },
    ];

    const markdown = buildTopicRadarMarkdown(buildTopicRadar(input));

    expect(markdown).toContain("## 今日 Top 深挖选题");
    expect(markdown).toContain("## 入池选题");
    expect(markdown).toContain("## 按五类选题分类摘要");
    expect(markdown).toContain("## 数据源状态与修复提示");
    expect(markdown).toContain("| 分数 | 动作 | 题目 | 摘要 | 分类 | 推荐选题 | 推荐理由 | 证据 |");
    expect(markdown).toContain("New multimodal model launch");
    expect(markdown).toContain(
      "OpenAI launches a new multimodal model with product availability and enterprise pricing.",
    );
    expect(markdown).toContain("New multimodal model launch 为什么值得关注？（");
  });

  it("renders a self-contained html report", () => {
    const input = baseInput();
    input.webResults[0]!.newItems = [
      {
        url: "https://openai.com/index/new-model",
        title: "New multimodal model launch",
        lastmod: "2026-05-20",
        content: "OpenAI launches a new multimodal model with product availability and enterprise pricing.",
        site: "openai",
        category: "product",
      },
    ];

    const html = buildTopicRadarHtml(buildTopicRadar(input));

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("AI 热点选题池 2026-05-20");
    expect(html).toContain("今日 Top 深挖选题");
    expect(html).toContain("New multimodal model launch");
    expect(html).toContain("topic-pool.json");
    expect(html).not.toContain("https://cdn.");
  });
});
