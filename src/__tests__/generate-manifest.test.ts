import fs from "node:fs";
import { afterEach, describe, it, expect, vi } from "vitest";
import { toRfc822, escapeXml, getReportFiles, generateSearchIndex } from "../generate-manifest.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// toRfc822
// ---------------------------------------------------------------------------

describe("toRfc822", () => {
  it("formats a known date correctly", () => {
    // 2026-03-09 is a Monday
    const date = new Date(Date.UTC(2026, 2, 9, 14, 30, 0));
    const result = toRfc822(date);
    expect(result).toBe("Mon, 09 Mar 2026 14:30:00 +0000");
  });

  it("pads single-digit day and hours", () => {
    const date = new Date(Date.UTC(2026, 0, 5, 3, 7, 9));
    const result = toRfc822(date);
    expect(result).toBe("Mon, 05 Jan 2026 03:07:09 +0000");
  });

  it("handles midnight correctly", () => {
    const date = new Date(Date.UTC(2026, 5, 15, 0, 0, 0));
    const result = toRfc822(date);
    expect(result).toContain("00:00:00 +0000");
  });

  it("handles end of year", () => {
    const date = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));
    const result = toRfc822(date);
    expect(result).toContain("Dec 2026");
    expect(result).toContain("23:59:59");
  });
});

// ---------------------------------------------------------------------------
// escapeXml
// ---------------------------------------------------------------------------

describe("escapeXml", () => {
  it("escapes ampersand", () => {
    expect(escapeXml("A & B")).toBe("A &amp; B");
  });

  it("escapes angle brackets", () => {
    expect(escapeXml("<tag>")).toBe("&lt;tag&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("handles multiple escapes in one string", () => {
    expect(escapeXml('A & B < C > D "E"')).toBe("A &amp; B &lt; C &gt; D &quot;E&quot;");
  });

  it("returns unchanged string if no special chars", () => {
    expect(escapeXml("plain text")).toBe("plain text");
  });

  it("handles empty string", () => {
    expect(escapeXml("")).toBe("");
  });
});

describe("getReportFiles", () => {
  it("defaults to the main report and Chinese rollups", () => {
    expect(getReportFiles(["zh"], false)).toEqual(["ai-topic-radar", "ai-weekly", "ai-monthly"]);
  });

  it("includes source reports only when explicitly enabled", () => {
    expect(getReportFiles(["zh"], true)).toContain("ai-web");
    expect(getReportFiles(["zh"], false)).not.toContain("ai-web");
  });

  it("includes English reports only when requested", () => {
    const reports = getReportFiles(["zh", "en"], true);
    expect(reports).toContain("ai-cli-en");
    expect(reports).toContain("ai-weekly-en");
  });
});

describe("generateSearchIndex", () => {
  it("indexes topic-pool candidates and legacy topics", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((file) => String(file).endsWith("topic-pool.json"));
    vi.spyOn(fs, "readFileSync").mockImplementation((file) => {
      const text = String(file);
      if (text.includes("2026-06-01")) {
        return JSON.stringify({
          candidates: [
            { title: "New candidate", score: 88, category: "AI 产品与用户入口", source: "Dev.to" },
          ],
        });
      }
      return JSON.stringify({
        topics: [{ topic: "Legacy topic", score: 70, category: "模型与技术突破", evidence: ["来源：ArXiv"] }],
      });
    });
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    generateSearchIndex([
      { date: "2026-06-01", reports: ["ai-topic-radar"] },
      { date: "2026-05-31", reports: ["ai-topic-radar"] },
    ]);

    const [, content] = writeSpy.mock.calls.find(([file]) => String(file).endsWith("search-index.json"))!;
    const index = JSON.parse(String(content));
    expect(index.topics).toEqual([
      expect.objectContaining({ title: "New candidate", source: "Dev.to" }),
      expect.objectContaining({ title: "Legacy topic", source: "来源：ArXiv" }),
    ]);
  });
});
