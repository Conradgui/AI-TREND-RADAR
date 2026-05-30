"""Agent tool definitions — 6 tools organized by user intent."""

from __future__ import annotations

import re

from langchain_core.tools import tool

from rag.graphrag.driver import Neo4jDriver
from rag.retriever.hybrid import HybridRetriever


def create_tools(neo4j_driver: Neo4jDriver, hybrid_retriever: HybridRetriever) -> list:
    """Create 6 agent tools bound to the given drivers."""

    @tool
    async def search(query: str) -> str:
        """搜索所有日报和选题数据。适用于查找话题、项目、技术、产品等任何内容。
        输入: 自然语言搜索查询。"""
        results = await hybrid_retriever.search(query, k=5)
        if not results:
            # Cold start check
            try:
                count = hybrid_retriever.vector.count()
                if count == 0:
                    return (
                        "知识库为空，无法搜索。请先运行 `python -m rag.ingest` 导入数据。\n"
                        "或者试试 daily_overview 工具查看某天的选题（需要 Neo4j 连接）。"
                    )
            except Exception:
                pass
            return (
                f"没有找到与 '{query}' 相关的内容。\n"
                "建议：换一个关键词，或使用 topic_trend / recommend 工具。"
            )
        lines = []
        for i, r in enumerate(results, 1):
            meta = r.metadata
            date = meta.get("date", "")
            source = meta.get("source", r.source)
            lines.append(f"{i}. [{date}/{source}] {r.text[:200]}")
        return "搜索结果：\n" + "\n".join(lines)

    @tool
    async def topic_trend(topic: str, days: int = 30) -> str:
        """分析某个话题在不同日期的热度变化趋势。
        输入: 话题名称，可选天数（默认 30 天）。"""
        try:
            results = await neo4j_driver.execute_query(
                "MATCH (t:Topic)-[r:APPEARED_ON]->(d:DailyDigest) "
                "WHERE toLower(t.name) CONTAINS toLower($topic) "
                "AND d.date >= date() - duration({days: $days}) "
                "RETURN t.name AS name, d.date AS date, r.score AS score, r.action AS action "
                "ORDER BY d.date",
                topic=topic,
                days=days,
            )
            if not results:
                return f"话题 '{topic}' 在最近 {days} 天没有出现。"
            scores = [(r["date"], r["score"]) for r in results]
            direction = (
                "上升 ↑"
                if len(scores) > 1 and scores[-1][1] > scores[0][1]
                else "平稳 →"
                if len(scores) > 1
                else "新出现"
            )
            lines = [f"- {r['date']}: {r['score']}分 ({r['action']})" for r in results]
            return f"**{results[0]['name']}** 趋势（{len(results)} 天，{direction}）：\n" + "\n".join(lines)
        except Exception as e:
            return f"趋势分析失败: {e}"

    @tool
    async def entity_info(entity: str) -> str:
        """查询某个实体（公司/项目/人物/产品）的详细信息和关系网络。
        输入: 实体名称。"""
        try:
            results = await neo4j_driver.execute_query(
                "MATCH (e:Entity) WHERE toLower(e.name) CONTAINS toLower($entity) "
                "OPTIONAL MATCH (e)-[:MENTIONS]->(t:Topic) "
                "OPTIONAL MATCH (e2:Entity)-[:MENTIONS]->(t) WHERE e2 <> e "
                "RETURN e.name AS name, e.type AS type, "
                "collect(DISTINCT t.name)[..5] AS topics, "
                "collect(DISTINCT e2.name)[..5] AS related_entities",
                entity=entity,
            )
            if not results:
                return f"没有找到实体 '{entity}'。"
            r = results[0]
            return (
                f"**{r['name']}**（类型: {r['type']}）\n"
                f"- 相关话题: {', '.join(r['topics']) or '无'}\n"
                f"- 关联实体: {', '.join(r['related_entities']) or '无'}"
            )
        except Exception as e:
            return f"实体查询失败: {e}"

    @tool
    async def daily_overview(date: str) -> str:
        """获取某一天的选题概览，包括热门话题和分数。
        输入: 日期（YYYY-MM-DD 格式）。"""
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            return "日期格式错误，请使用 YYYY-MM-DD 格式。"
        try:
            results = await neo4j_driver.execute_query(
                "MATCH (d:DailyDigest {date: $date})<-[:APPEARED_ON]-(t:Topic) "
                "RETURN t.name AS topic, t.category AS category, t.totalScore AS score "
                "ORDER BY t.totalScore DESC LIMIT 10",
                date=date,
            )
            if not results:
                return f"{date} 没有选题数据。"
            lines = [f"- **{r['topic']}** | {r['score']}分 | {r['category']}" for r in results]
            return f"**{date}** 选题概览（Top {len(results)}）：\n" + "\n".join(lines)
        except Exception as e:
            return f"日期查询失败: {e}"

    @tool
    async def source_coverage(topic: str) -> str:
        """对比某个话题在不同数据源中的覆盖情况。
        输入: 话题名称。"""
        try:
            results = await neo4j_driver.execute_query(
                "MATCH (t:Topic)-[:DISCOVERED_VIA]->(s:Source) "
                "WHERE toLower(t.name) CONTAINS toLower($topic) "
                "RETURN t.name AS name, collect(s.name) AS sources, t.totalScore AS score",
                topic=topic,
            )
            if not results:
                return f"话题 '{topic}' 没有数据源覆盖信息。"
            r = results[0]
            return f"**{r['name']}** 被以下数据源覆盖：{', '.join(r['sources'])}（总分: {r['score']}）"
        except Exception as e:
            return f"跨源查询失败: {e}"

    @tool
    async def recommend(category: str = "") -> str:
        """推荐值得深挖的选题，基于评分和趋势。
        输入: 可选分类过滤（如'模型与技术突破'、'AI 产品与用户入口'）。"""
        try:
            if category:
                results = await neo4j_driver.execute_query(
                    "MATCH (t:Topic) WHERE t.category CONTAINS $cat "
                    "RETURN t.name AS topic, t.category AS category, "
                    "t.totalScore AS score, t.mentionCount AS mentions "
                    "ORDER BY t.totalScore DESC LIMIT 5",
                    cat=category,
                )
            else:
                results = await neo4j_driver.execute_query(
                    "MATCH (t:Topic) "
                    "RETURN t.name AS topic, t.category AS category, "
                    "t.totalScore AS score, t.mentionCount AS mentions "
                    "ORDER BY t.totalScore DESC LIMIT 5"
                )
            if not results:
                return "暂无推荐选题。"
            lines = [
                f"- **{r['topic']}** | {r['score']}分 | 出现{r['mentions']}次 | {r['category']}"
                for r in results
            ]
            return "推荐选题：\n" + "\n".join(lines)
        except Exception as e:
            return f"推荐失败: {e}"

    return [search, topic_trend, entity_info, daily_overview, source_coverage, recommend]
