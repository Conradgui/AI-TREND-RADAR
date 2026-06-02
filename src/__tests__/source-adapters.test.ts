import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArxivData } from "../arxiv.ts";
import { fetchGiteeData } from "../gitee.ts";
import { fetchHfData } from "../hf.ts";
import { fetchHnData } from "../hn.ts";
import { fetchInfoqCnData } from "../infoq-cn.ts";
import { fetchJuejinData } from "../juejin.ts";
import { fetchKr36Data } from "../kr36.ts";
import { fetchOschinaData } from "../oschina.ts";
import { fetchPhData } from "../ph.ts";
import { fetchTrendingData } from "../trending.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("source adapters", () => {
  it("maps the current InfoQ recommendation response fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          code: 0,
          data: [
            {
              id: 1,
              uuid: "infoq-1",
              article_title: "大模型应用进入企业工作流",
              article_summary: "企业开始把大模型能力接入真实业务流程。",
              publish_time: 1_800_000_000,
              author: [{ nickname: "Alice" }],
              topic: [{ name: "AI" }],
            },
          ],
          error: {},
        }),
      ),
    );

    const result = await fetchInfoqCnData();

    expect(result.fetchSuccess).toBe(true);
    expect(result.articles).toEqual([
      expect.objectContaining({
        title: "大模型应用进入企业工作流",
        summary: "企业开始把大模型能力接入真实业务流程。",
        author: "Alice",
        topics: ["AI"],
      }),
    ]);
  });

  it("keeps mapping legacy InfoQ recommendation response fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: [
            {
              id: 2,
              uuid: "infoq-legacy",
              title: "LLM 工程落地复盘",
              description: "团队总结大模型应用上线经验。",
              url: "https://www.infoq.cn/article/infoq-legacy",
              publish_time: 1_800_000_000,
              author: { name: "Legacy Author" },
              topics: ["LLM"],
            },
          ],
        }),
      ),
    );

    await expect(fetchInfoqCnData()).resolves.toMatchObject({
      fetchSuccess: true,
      articles: [
        {
          id: "2",
          title: "LLM 工程落地复盘",
          summary: "团队总结大模型应用上线经验。",
          author: "Legacy Author",
          topics: ["LLM"],
        },
      ],
    });
  });

  it("accepts Juejin responses whose err_msg is success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          err_no: 0,
          err_msg: "success",
          data: [
            {
              article_id: "juejin-1",
              article_info: {
                title: "AI Agent 工程实践",
                brief_content: "如何构建稳定的 AI Agent。",
                digg_count: 12,
                view_count: 340,
                publish_time: 1_800_000_000,
              },
              author_user_info: { user_name: "Bob" },
              tags: [{ tag_name: "AI" }],
            },
          ],
        }),
      ),
    );

    const result = await fetchJuejinData();

    expect(result.fetchSuccess).toBe(true);
    expect(result.articles).toEqual([
      expect.objectContaining({
        id: "juejin-1",
        title: "AI Agent 工程实践",
      }),
    ]);
  });

  it("uses the Gitee repository search endpoint", async () => {
    vi.stubEnv("GITEE_TOKEN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json([])));
    vi.stubGlobal("fetch", fetchMock);

    await fetchGiteeData();

    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path === "/api/v5/search/repositories")).toBe(true);
  });

  it("queries Gitee with multiple AI keywords and deduplicates repositories", async () => {
    vi.stubEnv("GITEE_TOKEN", "");
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json([
          {
            id: 1,
            name: "agent-platform",
            full_name: "example/agent-platform",
            html_url: "https://gitee.com/example/agent-platform",
            description: "AI agent platform",
            language: "TypeScript",
            stargazers_count: 12,
            forks_count: 3,
            updated_at: "2026-05-31T00:00:00Z",
            namespace: { path: "example" },
          },
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGiteeData();

    const queries = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("q"));
    expect(queries).toEqual(["ai", "llm", "大模型", "agent", "rag"]);
    expect(result.projects).toHaveLength(1);
    expect(result.fetchSuccess).toBe(true);
    expect(result.status.state).toBe("ok");
  });

  it("sorts Gitee projects globally after querying every keyword", async () => {
    vi.stubEnv("GITEE_TOKEN", "");
    const lowStarProjects = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      name: `low-${index + 1}`,
      full_name: `example/low-${index + 1}`,
      html_url: `https://gitee.com/example/low-${index + 1}`,
      description: "AI project",
      language: "TypeScript",
      stargazers_count: 30 - index,
      forks_count: 0,
      updated_at: "2026-05-31T00:00:00Z",
      namespace: { path: "example" },
    }));
    const highStarProject = {
      id: 31,
      name: "high-star",
      full_name: "example/high-star",
      html_url: "https://gitee.com/example/high-star",
      description: "LLM project",
      language: "TypeScript",
      stargazers_count: 1000,
      forks_count: 10,
      updated_at: "2026-05-31T00:00:00Z",
      namespace: { path: "example" },
    };
    const fetchMock = vi.fn().mockImplementation((url) => {
      const query = new URL(String(url)).searchParams.get("q");
      return Promise.resolve(
        Response.json(query === "ai" ? lowStarProjects : query === "llm" ? [highStarProject] : []),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGiteeData();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.projects).toHaveLength(30);
    expect(result.projects[0]!.id).toBe(31);
  });

  it("keeps successful Gitee projects when later keywords fail", async () => {
    const token = "gitee-secret-token";
    vi.stubEnv("GITEE_TOKEN", token);
    const project = (id: number, stars: number) => ({
      id,
      name: `project-${id}`,
      full_name: `example/project-${id}`,
      html_url: `https://gitee.com/example/project-${id}`,
      description: "AI project",
      language: "TypeScript",
      stargazers_count: stars,
      forks_count: 0,
      updated_at: "2026-05-31T00:00:00Z",
      namespace: { path: "example" },
    });
    const fetchMock = vi.fn().mockImplementation((url) => {
      const query = new URL(String(url)).searchParams.get("q");
      if (query === "ai") return Promise.resolve(Response.json([project(1, 10)]));
      if (query === "llm") return Promise.resolve(new Response("", { status: 503 }));
      if (query === "大模型") return Promise.resolve(Response.json([project(2, 20)]));
      if (query === "agent") return Promise.resolve(Response.json({ unexpected: true }));
      return Promise.reject(new Error(`failed ${String(url)}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGiteeData();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.projects.map(({ id }) => id)).toEqual([2, 1]);
    expect(result.fetchSuccess).toBe(false);
    expect(result.status).toMatchObject({
      state: "error",
      acceptedCount: 2,
    });
    expect(result.status.detail).toContain("partial failure");
    expect(result.status.detail).not.toContain(token);
  });

  it("distinguishes an empty Gitee search from an HTTP error", async () => {
    vi.stubEnv("GITEE_TOKEN", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(Response.json([]))),
    );

    await expect(fetchGiteeData()).resolves.toMatchObject({
      projects: [],
      fetchSuccess: true,
      status: { state: "empty" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await expect(fetchGiteeData()).resolves.toMatchObject({
      projects: [],
      fetchSuccess: false,
      status: { state: "error" },
    });
  });

  it("redacts the Gitee token from fetch failure logs", async () => {
    const token = "gitee-secret-token";
    vi.stubEnv("GITEE_TOKEN", token);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`request failed: https://gitee.com/api?access_token=${token}`)),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await fetchGiteeData();

    expect(errorSpy.mock.calls.flat().join("\n")).not.toContain(token);
    errorSpy.mockRestore();
  });

  it("queries ArXiv categories in one request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchArxivData();
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const query = new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get("search_query");
    expect(query).toContain("cat:cs.AI");
    expect(query).toContain("cat:cs.CL");
    expect(query).toContain("cat:cs.LG");
  });

  it("retries ArXiv 429 responses before reporting an error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchArxivData();
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toMatchObject({
      papers: [],
      fetchSuccess: false,
      status: { state: "error", detail: "HTTP 429" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("backs off ArXiv 429 retries by 3s then 6s when Retry-After is absent", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchArxivData();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("prefers a valid ArXiv Retry-After delay", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "7" } }))
      .mockResolvedValueOnce(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchArxivData();
    await vi.advanceTimersByTimeAsync(6_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    await resultPromise;
  });

  it("reports an empty ArXiv feed as a successful empty fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
          { status: 200 },
        ),
      ),
    );

    await expect(fetchArxivData()).resolves.toMatchObject({
      papers: [],
      fetchSuccess: true,
      status: { state: "empty" },
    });
  });

  it("rejects Juejin responses when err_no is non-zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          err_no: 403,
          err_msg: "",
          data: [
            {
              article_id: "juejin-1",
              article_info: {
                title: "AI Agent 工程实践",
                brief_content: "如何构建稳定的 AI Agent。",
                digg_count: 12,
                view_count: 340,
                publish_time: 1_800_000_000,
              },
              author_user_info: { user_name: "Bob" },
              tags: [{ tag_name: "AI" }],
            },
          ],
        }),
      ),
    );

    await expect(fetchJuejinData()).resolves.toMatchObject({
      articles: [],
      fetchSuccess: false,
      status: { state: "error" },
    });
  });

  it("reports malformed Juejin responses as errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(null)));

    await expect(fetchJuejinData()).resolves.toMatchObject({
      articles: [],
      fetchSuccess: false,
      status: { state: "error", detail: "unexpected response shape" },
    });
  });

  it("reports successful empty legacy adapters as empty", async () => {
    vi.stubEnv("PRODUCTHUNT_TOKEN", "configured");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        const value = String(url);
        if (value.includes("hn.algolia.com")) return Promise.resolve(Response.json({ hits: [] }));
        if (value.includes("producthunt.com"))
          return Promise.resolve(Response.json({ data: { posts: { edges: [] } } }));
        if (value.includes("huggingface.co")) return Promise.resolve(Response.json([]));
        if (value.includes("36kr.com")) return Promise.resolve(new Response("<rss></rss>", { status: 200 }));
        if (value.includes("oschina.net"))
          return Promise.resolve(new Response("<rss></rss>", { status: 200 }));
        throw new Error(`Unexpected URL: ${value}`);
      }),
    );

    await expect(fetchHnData()).resolves.toMatchObject({ fetchSuccess: true, status: { state: "empty" } });
    await expect(fetchPhData()).resolves.toMatchObject({ fetchSuccess: true, status: { state: "empty" } });
    await expect(fetchHfData()).resolves.toMatchObject({ fetchSuccess: true, status: { state: "empty" } });
    await expect(fetchKr36Data()).resolves.toMatchObject({ fetchSuccess: true, status: { state: "empty" } });
    await expect(fetchOschinaData()).resolves.toMatchObject({
      fetchSuccess: true,
      status: { state: "empty" },
    });
  });

  it("reports Product Hunt without a token as skipped", async () => {
    vi.stubEnv("PRODUCTHUNT_TOKEN", "");

    await expect(fetchPhData()).resolves.toMatchObject({
      fetchSuccess: false,
      status: { state: "skipped" },
    });
  });

  it("reports GitHub Trending HTML parse failures with a structured status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        const value = String(url);
        if (value.includes("github.com/trending"))
          return Promise.resolve(new Response("<html></html>", { status: 200 }));
        return Promise.resolve(Response.json({ items: [] }));
      }),
    );

    await expect(fetchTrendingData()).resolves.toMatchObject({
      trendingFetchSuccess: false,
      status: { id: "github-trending", state: "error" },
    });
  });
});
