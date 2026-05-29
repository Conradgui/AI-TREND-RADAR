/**
 * Unified wrapper for all Chinese data sources.
 * Calls each source in parallel with .catch() fallbacks.
 */

import { fetchKr36Data, type Kr36Data } from "./kr36.ts";
import { fetchInfoqCnData, type InfoqCnData } from "./infoq-cn.ts";
import { fetchGiteeData, type GiteeData } from "./gitee.ts";
import { fetchOschinaData, type OschinaData } from "./oschina.ts";
import { fetchJuejinData, type JuejinData } from "./juejin.ts";

export interface ChinaSourcesData {
  kr36: Kr36Data;
  infoqCn: InfoqCnData;
  gitee: GiteeData;
  oschina: OschinaData;
  juejin: JuejinData;
}

/** Check if any Chinese source has data. */
export function hasChinaSourcesData(data: ChinaSourcesData): boolean {
  return (
    data.kr36.fetchSuccess ||
    data.infoqCn.fetchSuccess ||
    data.gitee.fetchSuccess ||
    data.oschina.fetchSuccess ||
    data.juejin.fetchSuccess
  );
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
    fetchInfoqCnData().catch((): InfoqCnData => ({ articles: [], fetchSuccess: false })),
    fetchGiteeData().catch((): GiteeData => ({ projects: [], fetchSuccess: false })),
    fetchOschinaData().catch((): OschinaData => ({ news: [], fetchSuccess: false })),
    fetchJuejinData().catch((): JuejinData => ({ articles: [], fetchSuccess: false })),
  ]);

  return { kr36, infoqCn, gitee, oschina, juejin };
}
