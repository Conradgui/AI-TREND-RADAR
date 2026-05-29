"""Hybrid retrieval combining vector similarity search with graph context."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING

from rag.retriever.typed_queries import QueryType, TypedQuery

if TYPE_CHECKING:
    from rag.graph.graph_retriever import GraphRetriever
    from rag.retriever.vector_store import VectorStore

logger = logging.getLogger(__name__)


@dataclass
class Citation:
    """A citation linking an answer passage to its source."""

    source: str
    title: str = ""
    url: str = ""
    date: str = ""
    confidence: float = 0.0


@dataclass
class RetrievalResult:
    """Aggregated result from hybrid retrieval.

    Attributes:
        passages: List of relevant text passages.
        graph_context: Structured data from the knowledge graph.
        citations: Source citations for the passages.
        query_type: The query type that guided retrieval.
    """

    passages: list[str] = field(default_factory=list)
    graph_context: dict[str, Any] = field(default_factory=dict)
    citations: list[Citation] = field(default_factory=list)
    query_type: QueryType | None = None


class HybridRetriever:
    """Combines semantic vector search with knowledge graph retrieval.

    Usage::

        retriever = HybridRetriever(vector_store, graph_retriever)
        result = await retriever.retrieve("agentic RAG trends", k=10)
    """

    def __init__(self, vector_store: VectorStore, graph_retriever: GraphRetriever) -> None:
        self._vs = vector_store
        self._gr = graph_retriever

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        query: str,
        k: int = 10,
        filter: dict[str, Any] | None = None,
    ) -> RetrievalResult:
        """Run vector search + graph context and merge results.

        Args:
            query: Free-text query.
            k: Target number of passages.
            filter: Optional metadata filter for vector search.

        Returns:
            A :class:`RetrievalResult` with merged, deduplicated content.
        """
        # --- Vector search ---
        vs_results = self._vs.search(query, k=k, filter=filter)
        passages: list[str] = []
        citations: list[Citation] = []

        for doc, meta, dist, doc_id in zip(
            vs_results.get("documents", []),
            vs_results.get("metadatas", []),
            vs_results.get("distances", []),
            vs_results.get("ids", []),
        ):
            passages.append(doc)
            confidence = max(0.0, 1.0 - (dist or 0.0))
            citations.append(
                Citation(
                    source=meta.get("source", "vector_store") if meta else "vector_store",
                    title=meta.get("title", "") if meta else "",
                    url=meta.get("url", "") if meta else "",
                    date=meta.get("date", "") if meta else "",
                    confidence=round(confidence, 3),
                )
            )

        # --- Graph context ---
        graph_context: dict[str, Any] = {}
        try:
            topics = await self._gr.search_topics(query, limit=k)
            graph_context["topics"] = topics

            # Enrich with related topics for the top match.
            if topics:
                top_topic = topics[0]
                topic_id = top_topic.get("id", "")
                if topic_id:
                    related = await self._gr.get_related_topics(topic_id, limit=5)
                    graph_context["related_topics"] = related
        except Exception:
            logger.exception("Graph retrieval failed — returning vector-only results")

        return RetrievalResult(
            passages=passages,
            graph_context=graph_context,
            citations=citations,
        )

    async def retrieve_for_typed_query(self, typed_query: TypedQuery) -> RetrievalResult:
        """Route retrieval to specialised paths based on query type.

        Args:
            typed_query: A structured :class:`TypedQuery`.

        Returns:
            A :class:`RetrievalResult` tailored to the query type.
        """
        qtype = typed_query.query_type
        meta_filter = typed_query.to_filter() or None
        k = typed_query.max_results

        if qtype == QueryType.TREND_ANALYSIS:
            return await self._retrieve_trend(typed_query, k)
        elif qtype == QueryType.ENTITY_LOOKUP:
            return await self._retrieve_entity(typed_query, k)
        elif qtype == QueryType.CROSS_SOURCE:
            return await self._retrieve_cross_source(typed_query, k, meta_filter)
        elif qtype == QueryType.TEMPORAL_COMPARISON:
            return await self._retrieve_temporal(typed_query, k, meta_filter)
        else:
            # TOPIC_SEARCH, RECOMMENDATION, or fallback
            return await self.retrieve(typed_query.raw_text, k=k, filter=meta_filter)

    # ------------------------------------------------------------------
    # Specialised retrieval paths
    # ------------------------------------------------------------------

    async def _retrieve_trend(self, tq: TypedQuery, k: int) -> RetrievalResult:
        """Retrieve trend data for the first identified topic."""
        graph_context: dict[str, Any] = {}
        passages: list[str] = []
        citations: list[Citation] = []

        for topic in tq.topics[:3]:
            try:
                trend = await self._gr.get_topic_trend(topic, days=30)
                graph_context[f"trend:{topic}"] = {
                    "scores": trend.scores,
                    "direction": trend.direction,
                }
                if trend.scores:
                    passages.append(
                        f"Trend for '{topic}': direction={trend.direction}, "
                        f"{len(trend.scores)} data points."
                    )
                    citations.append(Citation(source="knowledge_graph", title=f"Topic trend: {topic}"))
            except Exception:
                logger.debug("No trend data for topic '%s'", topic)

        # Supplement with vector search.
        vs = await self.retrieve(tq.raw_text, k=k)
        passages.extend(vs.passages[: k // 2])
        citations.extend(vs.citations[: k // 2])

        return RetrievalResult(
            passages=passages,
            graph_context=graph_context,
            citations=citations,
            query_type=QueryType.TREND_ANALYSIS,
        )

    async def _retrieve_entity(self, tq: TypedQuery, k: int) -> RetrievalResult:
        """Retrieve entity network and related information."""
        graph_context: dict[str, Any] = {}
        passages: list[str] = []
        citations: list[Citation] = []

        for entity in tq.entities[:3]:
            try:
                network = await self._gr.get_entity_network(entity, hops=2, limit=k)
                graph_context[f"network:{entity}"] = network
                if network:
                    names = [n.get("name", n.get("id", "")) for n in network[:5]]
                    passages.append(
                        f"Entity '{entity}' is connected to: {', '.join(names)} "
                        f"({len(network)} total connections)."
                    )
                    citations.append(Citation(source="knowledge_graph", title=f"Entity network: {entity}"))
            except Exception:
                logger.debug("No network data for entity '%s'", entity)

        vs = await self.retrieve(tq.raw_text, k=k)
        passages.extend(vs.passages[: k // 2])
        citations.extend(vs.citations[: k // 2])

        return RetrievalResult(
            passages=passages,
            graph_context=graph_context,
            citations=citations,
            query_type=QueryType.ENTITY_LOOKUP,
        )

    async def _retrieve_cross_source(
        self,
        tq: TypedQuery,
        k: int,
        meta_filter: dict[str, Any] | None,
    ) -> RetrievalResult:
        """Retrieve with emphasis on cross-source coverage."""
        result = await self.retrieve(tq.raw_text, k=k, filter=meta_filter)

        # Enrich graph context with cross-source coverage for matched topics.
        for topic in tq.topics[:3]:
            try:
                coverage = await self._gr.get_cross_source_coverage(topic)
                result.graph_context[f"coverage:{topic}"] = coverage
            except Exception:
                logger.debug("No cross-source coverage for '%s'", topic)

        result.query_type = QueryType.CROSS_SOURCE
        return result

    async def _retrieve_temporal(
        self,
        tq: TypedQuery,
        k: int,
        meta_filter: dict[str, Any] | None,
    ) -> RetrievalResult:
        """Retrieve with time-range filtering."""
        result = await self.retrieve(tq.raw_text, k=k, filter=meta_filter)

        # If a time range is specified, also pull daily digests from graph.
        if tq.time_range:
            start, end = tq.time_range
            try:
                # Just fetch the start date digest as a reference.
                digest = await self._gr.get_daily_digest(start)
                result.graph_context[f"digest:{start}"] = digest
            except Exception:
                logger.debug("No digest found for date %s", start)

        result.query_type = QueryType.TEMPORAL_COMPARISON
        return result
