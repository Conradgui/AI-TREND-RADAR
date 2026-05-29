"""Hybrid retriever combining Neo4j graph search with ChromaDB vector search."""

from __future__ import annotations

from dataclasses import dataclass, field

from rag.graphrag.driver import Neo4jDriver
from rag.retriever.vector_store import VectorStore


@dataclass
class RetrievedChunk:
    text: str
    source: str
    score: float
    metadata: dict = field(default_factory=dict)


class HybridRetriever:
    def __init__(self, vector_store: VectorStore, neo4j_driver: Neo4jDriver):
        self.vector = vector_store
        self.neo4j = neo4j_driver

    async def search(self, query: str, k: int = 5) -> list[RetrievedChunk]:
        results: list[RetrievedChunk] = []

        try:
            vector_hits = self.vector.search(query, k=k)
            for hit in vector_hits:
                results.append(RetrievedChunk(
                    text=hit["text"],
                    source="vector",
                    score=1.0 - (hit["distance"] or 0),
                    metadata=hit["metadata"],
                ))
        except Exception:
            pass

        try:
            graph_hits = await self.neo4j.execute_query(
                "CALL db.index.fulltext.queryNodes('entity_search', $query) "
                "YIELD node, score "
                "MATCH (node)-[:MENTIONS]->(t:Topic) "
                "RETURN t.name AS topic, t.category AS category, t.totalScore AS totalScore, score "
                "ORDER BY score DESC LIMIT $k",
                query=query, k=k,
            )
            for hit in graph_hits:
                text = f"话题: {hit['topic']} | 分类: {hit['category']} | 分数: {hit['totalScore']}"
                results.append(RetrievedChunk(
                    text=text,
                    source="graph",
                    score=float(hit.get("score", 0.5)),
                    metadata={"topic": hit["topic"], "category": hit["category"]},
                ))
        except Exception:
            pass

        results.sort(key=lambda r: r.score, reverse=True)
        seen = set()
        unique = []
        for r in results:
            key = r.text[:60]
            if key not in seen:
                seen.add(key)
                unique.append(r)

        return unique[:k * 2]
