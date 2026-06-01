import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChinaSourcesData } from "../china-sources.ts";

const { callLlmMock } = vi.hoisted(() => ({
  callLlmMock: vi.fn(),
}));

vi.mock("../report.ts", () => ({
  callLlm: callLlmMock,
  saveFile: vi.fn(),
  LLM_TOKENS_WEB: 4096,
}));

vi.mock("../github.ts", () => ({
  createGitHubIssue: vi.fn(),
}));

import { hasChinaSourcesData } from "../china-sources.ts";
import { saveArxivReport, saveChinaTechReport } from "../report-savers.ts";

function emptyChinaSources(): ChinaSourcesData {
  return {
    kr36: { articles: [], fetchSuccess: false },
    infoqCn: {
      articles: [],
      fetchSuccess: true,
      status: {
        id: "infoq-cn",
        label: "InfoQ 中国",
        state: "empty",
        fetchedCount: 0,
        acceptedCount: 0,
      },
    },
    gitee: {
      projects: [],
      fetchSuccess: true,
      status: {
        id: "gitee",
        label: "Gitee",
        state: "empty",
        fetchedCount: 0,
        acceptedCount: 0,
      },
    },
    oschina: { news: [], fetchSuccess: false },
    juejin: {
      articles: [],
      fetchSuccess: true,
      status: {
        id: "juejin",
        label: "掘金",
        state: "empty",
        fetchedCount: 0,
        acceptedCount: 0,
      },
    },
  };
}

beforeEach(() => {
  callLlmMock.mockReset();
});

describe("saveArxivReport", () => {
  it("skips LLM generation when a successful fetch contains no papers", async () => {
    await saveArxivReport(
      {
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
      "2026-06-01 00:00",
      "2026-06-01",
      "",
      "",
    );

    expect(callLlmMock).not.toHaveBeenCalled();
  });
});

describe("China sources empty results", () => {
  it("does not treat successful empty fetches as China source content", () => {
    expect(hasChinaSourcesData(emptyChinaSources())).toBe(false);
  });

  it("skips China tech LLM generation when all sources contain no entries", async () => {
    await saveChinaTechReport(emptyChinaSources(), "2026-06-01 00:00", "2026-06-01", "", "");

    expect(callLlmMock).not.toHaveBeenCalled();
  });
});
