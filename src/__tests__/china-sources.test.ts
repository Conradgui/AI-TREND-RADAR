import { describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({
  kr36: vi.fn().mockRejectedValue(new Error("kr36 failed")),
  infoqCn: vi.fn().mockRejectedValue(new Error("infoq failed")),
  gitee: vi.fn().mockRejectedValue(new Error("gitee failed")),
  oschina: vi.fn().mockRejectedValue(new Error("oschina failed")),
  juejin: vi.fn().mockRejectedValue(new Error("juejin failed")),
}));

vi.mock("../kr36.ts", () => ({ fetchKr36Data: adapterMocks.kr36 }));
vi.mock("../infoq-cn.ts", () => ({ fetchInfoqCnData: adapterMocks.infoqCn }));
vi.mock("../gitee.ts", () => ({ fetchGiteeData: adapterMocks.gitee }));
vi.mock("../oschina.ts", () => ({ fetchOschinaData: adapterMocks.oschina }));
vi.mock("../juejin.ts", () => ({ fetchJuejinData: adapterMocks.juejin }));

import { fetchChinaSourcesData } from "../china-sources.ts";

describe("fetchChinaSourcesData", () => {
  it("returns structured error statuses when adapters reject", async () => {
    const result = await fetchChinaSourcesData();

    expect(Object.values(result).map(({ status }) => status.state)).toEqual([
      "error",
      "error",
      "error",
      "error",
      "error",
    ]);
  });
});
