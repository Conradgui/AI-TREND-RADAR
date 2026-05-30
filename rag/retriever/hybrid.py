"""Hybrid retriever combining Neo4j graph search with ChromaDB vector search.
Uses Reciprocal Rank Fusion (RRF) to merge results from both sources."""

from __future__ import annotations

from dataclasses import dataclass, field

from rag.graphrag.driver import Neo4jDriver
from rag.retriever.vector_store import VectorStore


@dataclass
class RetrievedChunk:
    text: str
    source: str  # "vector" or "graph"
    score: float
    metadata: dict = field(default_factory=dict)


class HybridRetriever:
    """Combines Neo4j graph traversal with ChromaDB vector similarity using RRF."""

    def __init__(self, vector_store: VectorStore, neo4j_driver: Neo4jDriver, rrf_k: int = 60):
        self.vector = vector_store
        self.neo4j = neo4j_driver
        self.rrf_k = rrf_k

    async def search(self, query: str, k: int = 5) -> list[RetrievedChunk]:
        """Hybrid search: vector + graph, merge via Reciprocal Rank Fusion."""
        vector_results = self._safe_vector_search(query, k)
        graph_results = await self._safe_graph_search(query, k)

        # Reciprocal Rank Fusion
        fused: dict[int, dict] = {}
        for rank, r in enumerate(vector_results):
            key = hash(r.text[:100])
            if key not in fused:
                fused[key] = {"chunk": r, "score": 0.0}
            fused[key]["score"] += 1.0 / (self.rrf_k + rank + 1)

        for rank, r in enumerate(graph_results):
            key = hash(r.text[:100])
            if key not in fused:
                fused[key] = {"chunk": r, "score": 0.0}
            fused[key]["score"] += 1.0 / (self.rrf_k + rank + 1)

        ranked = sorted(fused.values(), key=lambda x: x["score"], reverse=True)
        return [item["chunk"] for item in ranked[:k]]

    def _safe_vector_search(self, query: str, k: int) -> list[RetrievedChunk]:
        try:
            hits = self.vector.search(query, k=k)
            return [
                RetrievedChunk(
                    text=hit["text"],
                    source="vector",
                    score=1.0 - (hit["distance"] or 0),
                    metadata=hit["metadata"],
                )
                for hit in hits
            ]
        except Exception as e:
            print(f"[hybrid] vector search failed: {e}")
            return []

    async def _safe_graph_search(self, query: str, k: int) -> list[RetrievedChunk]:
        try:
            hits = await self.neo4j.execute_query(
                "CALL db.index.fulltext.queryNodes('entity_search', $query) "
                "YIELD node, score "
                "MATCH (node)-[:MENTIONS]->(t:Topic) "
                "RETURN t.name AS topic, t.category AS category, t.totalScore AS totalScore "
                "ORDER BY score DESC LIMIT $k",
                query=query,
                k=k,
            )
            return [
                RetrievedChunk(
                    text=f"话题: {h['topic']} | 分类: {h['category']} | 分数: {h['totalScore']}",
                    source="graph",
                    score=float(h.get("totalScore", 0)),
                    metadata=h,
                )
                for h in hits
            ]
        except Exception as e:
            print(f"[hybrid] graph search failed: {e}")
            return []
