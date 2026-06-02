import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTopicRadar,
  buildTopicRadarHtml,
  buildTopicRadarMarkdown,
  saveTopicRadar,
} from "../topic-radar.ts";
import type { TopicRadarInput } from "../topic-radar.ts";
import type { SourceStatus } from "../source-status.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function status(id: string, state: SourceStatus["state"] = "empty"): SourceStatus {
  return { id, label: id, state, fetchedCount: 0, acceptedCount: 0 };
}

function baseInput(): TopicRadarInput {
  return {
    dateStr: "2026-05-20",
    utcStr: "2026-05-20 02:00",
    now: new Date("2026-05-20T02:00:00Z"),
    trendingData: {
      trendingRepos: [],
      searchRepos: [],
      trendingFetchSuccess: true,
      status: status("github-trending"),
    },
    hnData: {
      stories: [],
      fetchSuccess: true,
      status: status("hn"),
    },
    phData: {
      products: [],
      fetchSuccess: true,
      status: status("product-hunt"),
    },
    arxivData: {
      papers: [],
      fetchSuccess: true,
      status: {
        id: "arxiv",
        label: "ArXiv",
        state: "empty",
        fetchedCount: 0,
        acceptedCount: 0,
      },
    },
    hfData: {
      models: [],
      fetchSuccess: true,
      status: status("hf"),
    },
    webResults: [
      {
        site: "openai",
        siteName: "OpenAI",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
        status: status("web-openai"),
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
    input.trendingData.status = status("github-trending", "error");
    input.hnData.fetchSuccess = false;
    input.hnData.status = status("hn", "error");
    input.phData.fetchSuccess = false;
    input.phData.status = { ...status("product-hunt", "skipped"), label: "Product Hunt" };

    const result = buildTopicRadar(input);

    expect(result.candidates).toEqual([]);
    expect(result.warnings.join("\n")).toContain("GitHub Trending");
    expect(result.warnings.join("\n")).toContain("Hacker News");
    expect(result.notices.join("\n")).toContain("Product Hunt");
  });

  it("renders an empty notice instead of an error warning for a successful empty source", () => {
    const input = baseInput();
    Object.assign(input.arxivData, {
      fetchSuccess: true,
      status: {
        id: "arxiv",
        label: "ArXiv",
        state: "empty",
        fetchedCount: 0,
        acceptedCount: 0,
      },
    });

    const result = buildTopicRadar(input);
    const notices = result.notices.join("\n");
    const warnings = result.warnings.join("\n");

    expect(notices).toContain("ArXiv 暂无");
    expect(warnings).not.toContain("ArXiv 暂无");
    expect(warnings).not.toContain("ArXiv 获取失败");
  });

  it("renders an error warning when the source status reports an error", () => {
    const input = baseInput();
    Object.assign(input.arxivData, {
      fetchSuccess: true,
      status: {
        id: "arxiv",
        label: "ArXiv",
        state: "error",
        fetchedCount: 0,
        acceptedCount: 0,
        detail: "HTTP 429",
      },
    });

    const result = buildTopicRadar(input);

    expect(result.notices.join("\n")).not.toContain("ArXiv 获取失败");
    expect(result.warnings.join("\n")).toContain("ArXiv 获取失败");
    expect(buildTopicRadarMarkdown(result)).toContain("ArXiv 获取失败");
    expect(buildTopicRadarHtml(result)).toContain("ArXiv 获取失败");
  });

  it("preserves structured statuses from adapters", () => {
    const input = baseInput();
    Object.assign(input.trendingData, { status: status("github-trending") });
    Object.assign(input.hnData, { status: status("hn") });
    Object.assign(input.phData, { status: status("product-hunt", "skipped") });
    Object.assign(input.hfData, { status: status("hf") });
    input.webResults = [
      {
        site: "anthropic",
        siteName: "Anthropic",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
        status: status("web-anthropic"),
      },
      {
        site: "openai",
        siteName: "OpenAI",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
        status: status("web-openai"),
      },
      {
        site: "deepmind",
        siteName: "DeepMind",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
        status: status("web-deepmind"),
      },
    ];
    input.chinaSourcesData = {
      kr36: { articles: [], fetchSuccess: true, status: status("kr36") },
      infoqCn: {
        articles: [],
        fetchSuccess: true,
        status: {
          id: "infoq-cn",
          label: "InfoQ 中国",
          state: "empty",
          fetchedCount: 12,
          acceptedCount: 0,
        },
      },
      gitee: {
        projects: [],
        fetchSuccess: false,
        status: {
          id: "gitee",
          label: "Gitee",
          state: "error",
          fetchedCount: 0,
          acceptedCount: 0,
          detail: "HTTP 503",
        },
      },
      oschina: { news: [], fetchSuccess: true, status: status("oschina") },
      juejin: {
        articles: [],
        fetchSuccess: true,
        status: {
          id: "juejin",
          label: "掘金",
          state: "empty",
          fetchedCount: 20,
          acceptedCount: 0,
        },
      },
    };

    expect(buildTopicRadar(input).sourceStatuses).toEqual([
      input.trendingData.status,
      input.hnData.status,
      input.phData.status,
      input.arxivData.status,
      input.hfData.status,
      input.webResults[0]!.status,
      input.webResults[1]!.status,
      input.webResults[2]!.status,
      input.chinaSourcesData.kr36.status,
      input.chinaSourcesData.infoqCn.status,
      input.chinaSourcesData.gitee.status,
      input.chinaSourcesData.oschina.status,
      input.chinaSourcesData.juejin.status,
    ]);
  });

  it("shows official source errors as warnings without an all-clear notice", () => {
    const input = baseInput();
    input.webResults = [
      {
        site: "anthropic",
        siteName: "Anthropic",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
        status: status("web-anthropic"),
      },
      {
        site: "openai",
        siteName: "OpenAI",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
        status: status("web-openai", "error"),
      },
      {
        site: "deepmind",
        siteName: "DeepMind",
        isFirstRun: false,
        newItems: [],
        totalDiscovered: 0,
        status: status("web-deepmind"),
      },
    ];

    const result = buildTopicRadar(input);

    expect(result.warnings.join("\n")).toContain("OpenAI");
    expect(result.notices.join("\n")).not.toContain("官方内容源今日没有检测到新内容");
  });

  it("saves structured source statuses in topic-pool JSON", () => {
    const input = baseInput();
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockReturnValue(undefined);
    vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined);

    const result = buildTopicRadar(input);
    saveTopicRadar(result);

    const jsonCall = writeSpy.mock.calls.find(([file]) => String(file).endsWith("topic-pool.json"));
    expect(jsonCall).toBeDefined();
    expect(JSON.parse(String(jsonCall![1])).sourceStatuses).toEqual(result.sourceStatuses);
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
    expect(markdown).toContain("## 数据源普通状态提示");
    expect(markdown).toContain("## 数据源修复提示");
    expect(markdown).toContain("ArXiv 暂无");
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
    expect(html).toContain("数据源普通状态提示");
    expect(html).toContain("数据源修复提示");
    expect(html).toContain("ArXiv 暂无");
    expect(html).toContain("New multimodal model launch");
    expect(html).toContain("topic-pool.json");
    expect(html).not.toContain("https://cdn.");
  });
});
