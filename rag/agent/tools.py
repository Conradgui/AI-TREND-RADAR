"""Agent tool definitions for LangGraph ReAct agent."""

from __future__ import annotations

from langchain_core.tools import tool

from rag.graphrag.driver import Neo4jDriver
from rag.retriever.vector_store import VectorStore


def create_tools(neo4j_driver: Neo4jDriver, vector_store: VectorStore):
    """Create tool instances bound to the given drivers."""

    @tool
    async def graph_search(query: str) -> str:
        """Search the Neo4j knowledge graph for topics, entities, and their relationships.
        Input: search query describing what to find."""
        try:
            results = await neo4j_driver.execute_query(
                "CALL db.index.fulltext.queryNodes('entity_search', $query) "
                "YIELD node, score "
                "MATCH (node)-[:MENTIONS]->(t:Topic) "
                "OPTIONAL MATCH (t)-[r:APPEARED_ON]->(d:DailyDigest) "
                "RETURN t.name AS topic, t.category AS category, t.totalScore AS score, "
                "t.mentionCount AS mentions, d.date AS lastDate, score AS relevance "
                "ORDER BY score DESC LIMIT 10",
                query=query,
            )
            if not results:
                return f"在知识图谱中没有找到与 '{query}' 相关的内容。"
            lines = [f"- **{r['topic']}** | 分类: {r['category']} | 分数: {r['score']} | 出现次数: {r['mentions']}"
                     for r in results]
            return "知识图谱搜索结果：\n" + "\n".join(lines)
        except Exception as e:
            return f"图搜索失败: {e}"

    @tool
    async def vector_search(query: str) -> str:
        """Search all digest reports by semantic similarity.
        Input: natural language search query."""
        try:
            results = vector_store.search(query, k=5)
            if not results:
                return f"在报告中没有找到与 '{query}' 相关的内容。"
            lines = []
            for r in results:
                meta = r.get("metadata", {})
                date = meta.get("date", "unknown")
                source = meta.get("source", "unknown")
                lines.append(f"- [{date}/{source}] {r['text'][:200]}")
            return "语义搜索结果：\n" + "\n".join(lines)
        except Exception as e:
            return f"向量搜索失败: {e}"

    @tool
    async def trend_analysis(topic: str, days: int = 30) -> str:
        """Analyze the trend trajectory of a specific topic over time.
        Input: topic name, optional number of days to look back."""
        try:
            results = await neo4j_driver.execute_query(
                "MATCH (t:Topic {id: $topic_id})-[r:APPEARED_ON]->(d:DailyDigest) "
                "WHERE d.date >= date() - duration({days: $days}) "
                "RETURN d.date AS date, r.score AS score, r.action AS action "
                "ORDER BY d.date",
                topic_id=topic.lower().strip(), days=days,
            )
            if not results:
                return f"话题 '{topic}' 在最近 {days} 天内没有出现记录。"
            scores = [(r["date"], r["score"]) for r in results]
            trend = "上升" if len(scores) > 1 and scores[-1][1] > scores[0][1] else "平稳" if len(scores) > 1 else "新出现"
            lines = [f"- {r['date']}: 分数 {r['score']} ({r['action']})" for r in results]
            return f"**{topic}** 趋势分析（最近 {days} 天，共 {len(results)} 次出现，趋势: {trend}）：\n" + "\n".join(lines)
        except Exception as e:
            return f"趋势分析失败: {e}"

    @tool
    async def topic_recommend(category: str = "") -> str:
        """Recommend topics worth deep-diving based on scores and trends.
        Input: optional category name."""
        try:
            if category:
                results = await neo4j_driver.execute_query(
                    "MATCH (t:Topic)-[r:APPEARED_ON]->(d:DailyDigest) "
                    "WHERE t.category CONTAINS $cat "
                    "WITH t, MAX(r.score) AS maxScore, COUNT(r) AS freq "
                    "RETURN t.name AS topic, t.category AS category, maxScore, freq "
                    "ORDER BY maxScore DESC LIMIT 10",
                    cat=category,
                )
            else:
                results = await neo4j_driver.execute_query(
                    "MATCH (t:Topic)-[r:APPEARED_ON]->(d:DailyDigest) "
                    "WITH t, MAX(r.score) AS maxScore, COUNT(r) AS freq "
                    "RETURN t.name AS topic, t.category AS category, maxScore, freq "
                    "ORDER BY maxScore DESC LIMIT 10",
                )
            if not results:
                return "暂无选题推荐数据。"
            lines = [f"- **{r['topic']}** | 最高分: {r['maxScore']} | 出现 {r['freq']} 次 | {r['category']}"
                     for r in results]
            return "推荐选题（按热度排序）：\n" + "\n".join(lines)
        except Exception as e:
            return f"选题推荐失败: {e}"

    return [graph_search, vector_search, trend_analysis, topic_recommend]
