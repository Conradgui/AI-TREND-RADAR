import { describe, expect, it } from "vitest";
import { createSourceStatus } from "../source-status.ts";

describe("createSourceStatus", () => {
  it("returns ok when accepted content exists", () => {
    expect(
      createSourceStatus({
        id: "infoq-cn",
        label: "InfoQ 中国",
        fetchedCount: 12,
        acceptedCount: 3,
      }),
    ).toEqual({
      id: "infoq-cn",
      label: "InfoQ 中国",
      state: "ok",
      fetchedCount: 12,
      acceptedCount: 3,
    });
  });

  it("returns empty when fetching succeeds without accepted content", () => {
    expect(
      createSourceStatus({
        id: "infoq-cn",
        label: "InfoQ 中国",
        fetchedCount: 12,
        acceptedCount: 0,
      }),
    ).toEqual({
      id: "infoq-cn",
      label: "InfoQ 中国",
      state: "empty",
      fetchedCount: 12,
      acceptedCount: 0,
    });
  });

  it("returns error when the adapter reports a failure", () => {
    expect(
      createSourceStatus({
        id: "gitee",
        label: "Gitee",
        fetchedCount: 0,
        acceptedCount: 0,
        error: "HTTP 404",
      }),
    ).toEqual({
      id: "gitee",
      label: "Gitee",
      state: "error",
      fetchedCount: 0,
      acceptedCount: 0,
      detail: "HTTP 404",
    });
  });

  it("returns skipped when an optional source is disabled", () => {
    expect(
      createSourceStatus({
        id: "product-hunt",
        label: "Product Hunt",
        fetchedCount: 0,
        acceptedCount: 0,
        skipped: "PRODUCTHUNT_TOKEN 未配置",
      }),
    ).toEqual({
      id: "product-hunt",
      label: "Product Hunt",
      state: "skipped",
      fetchedCount: 0,
      acceptedCount: 0,
      detail: "PRODUCTHUNT_TOKEN 未配置",
    });
  });
});
