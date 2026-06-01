import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArxivData } from "../arxiv.ts";
import { fetchGiteeData } from "../gitee.ts";
import { fetchInfoqCnData } from "../infoq-cn.ts";
import { fetchJuejinData } from "../juejin.ts";

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
      status: { state: "error", detail: "HTTP 503" },
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
});
