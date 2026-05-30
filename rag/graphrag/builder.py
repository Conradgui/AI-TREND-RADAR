"""Knowledge graph builder — ingests digest data into Neo4j."""

from __future__ import annotations

from datetime import datetime

from rag.graphrag.driver import Neo4jDriver


def _infer_entity_type(tag: str) -> str:
    """Infer entity type from tag content. Returns company/technology/project/topic_tag."""
    tag_lower = tag.lower().strip()

    # 1. Exact match for company names (highest priority)
    companies = {
        "openai", "anthropic", "google", "meta", "microsoft", "nvidia",
        "apple", "deepseek", "baidu", "alibaba", "tencent", "百度", "阿里", "腾讯", "字节",
    }
    if tag_lower in companies:
        return "company"

    # 2. Contains technology keywords (including Chinese)
    tech_patterns = [
        "ai", "gpt", "llm", "rag", "agent", "transformer",
        "embedding", "vector", "multimodal", "大模型", "人工智能", "机器学习", "深度学习",
    ]
    if any(t in tag_lower for t in tech_patterns):
        return "technology"

    # 3. Contains project name
    projects = {"langchain", "llamaindex", "chromadb", "neo4j", "ollama", "vllm", "pytorch", "tensorflow"}
    if any(p in tag_lower for p in projects):
        return "project"

    return "topic_tag"


class KnowledgeGraphBuilder:
    """Builds and updates the Neo4j knowledge graph from digest data."""

    def __init__(self, driver: Neo4jDriver):
        self.driver = driver

    async def ingest_date(
        self,
        date_str: str,
        topic_pool: dict | None,
        reports: dict[str, str],
    ) -> None:
        """Ingest one day's data into the knowledge graph."""
        candidate_count = len(topic_pool.get("candidates", [])) if topic_pool else 0
        await self.driver.execute_write(
            "MERGE (d:DailyDigest {date: $date}) "
            "SET d.candidateCount = $count, d.generatedAt = $now",
            date=date_str, count=candidate_count, now=datetime.now(datetime.timezone.utc).isoformat(),
        )

        sources = set()
        if topic_pool:
            for c in topic_pool.get("candidates", []):
                src = c.get("source", "")
                if src:
                    sources.add(src)
        for src in sources:
            await self.driver.execute_write(
                "MERGE (s:Source {id: $id}) SET s.name = $id",
                id=src,
            )

        if topic_pool:
            for candidate in topic_pool.get("candidates", []):
                await self._ingest_candidate(candidate, date_str)

        for report_type, content in reports.items():
            await self.driver.execute_write(
                "MERGE (doc:Document {id: $id}) "
                "SET doc.title = $title, doc.date = $date, doc.reportType = $type, doc.content = $content",
                id=f"{date_str}/{report_type}",
                title=report_type,
                date=date_str,
                type=report_type,
                content=content[:50000] if len(content) > 50000 else content,
            )
            await self.driver.execute_write(
                "MATCH (doc:Document {id: $id}), (d:DailyDigest {date: $date}) "
                "MERGE (doc)-[:PART_OF]->(d)",
                id=f"{date_str}/{report_type}", date=date_str,
            )

    async def _ingest_candidate(self, candidate: dict, date_str: str) -> None:
        """Ingest a single topic candidate into the graph."""
        title = candidate.get("title", "") or candidate.get("topic", "")
        if not title:
            return

        topic_id = title.lower().strip()
        category = candidate.get("category", "")
        score = candidate.get("score", 0)
        action = candidate.get("action", "")
        source = candidate.get("source", "")

        await self.driver.execute_write(
            "MERGE (t:Topic {id: $id}) "
            "SET t.name = $name, t.category = $category, "
            "t.totalScore = CASE WHEN t.totalScore IS NULL OR $score > t.totalScore "
            "THEN $score ELSE t.totalScore END, "
            "t.mentionCount = COALESCE(t.mentionCount, 0) + 1, "
            "t.lastSeen = $date, "
            "t.firstSeen = COALESCE(t.firstSeen, $date)",
            id=topic_id, name=title, category=category, score=score, date=date_str,
        )

        await self.driver.execute_write(
            "MATCH (t:Topic {id: $topic_id}), (d:DailyDigest {date: $date}) "
            "MERGE (t)-[r:APPEARED_ON]->(d) SET r.score = $score, r.action = $action",
            topic_id=topic_id, date=date_str, score=score, action=action,
        )

        if source:
            await self.driver.execute_write(
                "MATCH (t:Topic {id: $topic_id}), (s:Source {id: $source}) "
                "MERGE (t)-[:DISCOVERED_VIA]->(s)",
                topic_id=topic_id, source=source,
            )

        for tag in candidate.get("tags", []):
            if not tag or len(tag) < 2:
                continue
            entity_id = tag.lower().strip()
            await self.driver.execute_write(
                "MERGE (e:Entity {id: $id}) SET e.name = $name, e.type = $entity_type",
                id=entity_id, name=tag, entity_type=_infer_entity_type(tag),
            )
            await self.driver.execute_write(
                "MATCH (e:Entity {id: $entity_id}), (t:Topic {id: $topic_id}) "
                "MERGE (e)-[:MENTIONS]->(t)",
                entity_id=entity_id, topic_id=topic_id,
            )
