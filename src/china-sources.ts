/**
 * Unified wrapper for all Chinese data sources.
 * Calls each source in parallel with .catch() fallbacks.
 */

import { fetchKr36Data, type Kr36Data } from "./kr36.ts";
import { fetchInfoqCnData, type InfoqCnData } from "./infoq-cn.ts";
import { fetchGiteeData, type GiteeData } from "./gitee.ts";
import { fetchOschinaData, type OschinaData } from "./oschina.ts";
import { fetchJuejinData, type JuejinData } from "./juejin.ts";
import { createSourceStatus } from "./source-status.ts";

export interface ChinaSourcesData {
  kr36: Kr36Data;
  infoqCn: InfoqCnData;
  gitee: GiteeData;
  oschina: OschinaData;
  juejin: JuejinData;
}

/** Check if any Chinese source has data. */
export function hasChinaSourcesData(data: ChinaSourcesData): boolean {
  return countChinaSourcesItems(data) > 0;
}

/** Total items across all Chinese sources. */
export function countChinaSourcesItems(data: ChinaSourcesData): number {
  return (
    data.kr36.articles.length +
    data.infoqCn.articles.length +
    data.gitee.projects.length +
    data.oschina.news.length +
    data.juejin.articles.length
  );
}

export async function fetchChinaSourcesData(): Promise<ChinaSourcesData> {
  const [kr36, infoqCn, gitee, oschina, juejin] = await Promise.all([
    fetchKr36Data().catch((): Kr36Data => ({ articles: [], fetchSuccess: false })),
    fetchInfoqCnData().catch(
      (): InfoqCnData => ({
        articles: [],
        fetchSuccess: false,
        status: createSourceStatus({
          id: "infoq-cn",
          label: "InfoQ 中国",
          fetchedCount: 0,
          acceptedCount: 0,
          error: "fetch failed",
        }),
      }),
    ),
    fetchGiteeData().catch(
      (): GiteeData => ({
        projects: [],
        fetchSuccess: false,
        status: createSourceStatus({
          id: "gitee",
          label: "Gitee",
          fetchedCount: 0,
          acceptedCount: 0,
          error: "fetch failed",
        }),
      }),
    ),
    fetchOschinaData().catch((): OschinaData => ({ news: [], fetchSuccess: false })),
    fetchJuejinData().catch(
      (): JuejinData => ({
        articles: [],
        fetchSuccess: false,
        status: createSourceStatus({
          id: "juejin",
          label: "掘金",
          fetchedCount: 0,
          acceptedCount: 0,
          error: "fetch failed",
        }),
      }),
    ),
  ]);

  return { kr36, infoqCn, gitee, oschina, juejin };
}
