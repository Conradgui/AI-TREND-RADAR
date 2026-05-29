"""Nexus-inspired composable retriever — the main retrieval interface for the agent.

Implements the "compile-once, serve-many" pattern: pre-compiled trend and entity
artifacts are preferred over raw retrieval when available.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TYPE_CHECKING

from rag.config import ARTIFACTS_CACHE_DIR
from rag.retriever.typed_queries import QueryType, TypedQuery, classify_query
from rag.retriever.hybrid_retriever import Citation, RetrievalResult

if TYPE_CHECKING:
    from rag.graph.graph_retriever import GraphRetriever
    from rag.retriever.hybrid_retriever import HybridRetriever

logger = logging.getLogger(__name__)


@dataclass
class Artifact:
    """A pre-compiled retrieval artifact (trend report, entity profile, etc.)."""

    artifact_type: str
    key: str
    data: dict[str, Any] = field(default_factory=dict)
    generated_at: str = ""
    citations: list[Citation] = field(default_factory=list)


@dataclass
class ComposedResponse:
    """Final response returned by the composable retriever.

    Attributes:
        answer: The assembled answer text.
        citations: Source citations with confidence scores.
        artifacts_used: Artifact keys that were served from cache.
        graph_context: Structured graph data, if any.
        retrieval_path: Which retrieval strategies were invoked.
    """

    answer: str = ""
    citations: list[Citation] = field(default_factory=list)
    artifacts_used: list[str] = field(default_factory=list)
    graph_context: dict[str, Any] = field(default_factory=dict)
    retrieval_path: list[str] = field(default_factory=list)


class ArtifactCache:
    """File-system cache for pre-compiled artifacts.

    Artifacts are stored as JSON files under ``ARTIFACTS_CACHE_DIR/<type>/<key>.json``.
    """

    def __init__(self, cache_dir: str = ARTIFACTS_CACHE_DIR) -> None:
        self._root = Path(cache_dir)
        self._root.mkdir(parents=True, exist_ok=True)

    def get(self, artifact_type: str, key: str) -> Artifact | None:
        """Load a cached artifact. Returns ``None`` on miss."""
        path = self._path(artifact_type, key)
        if not path.exists():
            return None
        try:
            import json

            data = json.loads(path.read_text(encoding="utf-8"))
            citations = [
                Citation(**c) for c in data.get("citations", [])
            ]
            return Artifact(
                artifact_type=artifact_type,
                key=key,
                data=data.get("data", {}),
                generated_at=data.get("generated_at", ""),
                citations=citations,
            )
        except Exception:
            logger.exception("Failed to load artifact %s/%s", artifact_type, key)
            return None

    def put(self, artifact: Artifact) -> None:
        """Persist an artifact to the cache."""
        import json
        from datetime import datetime, timezone

        path = self._path(artifact.artifact_type, artifact.key)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "artifact_type": artifact.artifact_type,
            "key": artifact.key,
            "data": artifact.data,
            "generated_at": artifact.generated_at or datetime.now(timezone.utc).isoformat(),
            "citations": [
                {
                    "source": c.source,
                    "title": c.title,
                    "url": c.url,
                    "date": c.date,
                    "confidence": c.confidence,
                }
                for c in artifact.citations
            ],
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _path(self, artifact_type: str, key: str) -> Path:
        safe_key = key.replace("/", "_").replace("\\", "_")
        return self._root / artifact_type / f"{safe_key}.json"


class ComposableRetriever:
    """Main retriever interface for the agent layer.

    Orchestrates hybrid retrieval and artifact caching.  The agent calls
    ``retrieve()`` for free-form queries or the specialised helpers for
    known shapes (trends, entities).

    Usage::

        retriever = ComposableRetriever(hybrid_retriever, graph_retriever)
        response = await retriever.retrieve("What are the top agentic RAG trends?")
        response = await retriever.retrieve_trend("agentic-rag", days=30)
    """

    def __init__(
        self,
        hybrid_retriever: HybridRetriever,
        graph_retriever: GraphRetriever,
        artifact_cache: ArtifactCache | None = None,
    ) -> None:
        self._hybrid = hybrid_retriever
        self._graph = graph_retriever
        self._cache = artifact_cache or ArtifactCache()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        query: str,
        output_shape: str | None = None,
    ) -> ComposedResponse:
        """Retrieve and compose a response for a free-text query.

        Args:
            query: Natural-language query.
            output_shape: Optional hint for the desired response shape
                (e.g. ``"trend"``, ``"entity"``, ``"comparison"``).

        Returns:
            A :class:`ComposedResponse` with answer, citations, and metadata.
        """
        typed = classify_query(query)

        # Override query type if the caller provides an explicit shape.
        if output_shape == "trend":
            typed.query_type = QueryType.TREND_ANALYSIS
        elif output_shape == "entity":
            typed.query_type = QueryType.ENTITY_LOOKUP
        elif output_shape == "comparison":
            typed.query_type = QueryType.CROSS_SOURCE

        result = await self._hybrid.retrieve_for_typed_query(typed)
        answer = self._compose_answer(result)

        return ComposedResponse(
            answer=answer,
            citations=result.citations,
            graph_context=result.graph_context,
            retrieval_path=[typed.query_type.value, "hybrid"],
        )

    async def retrieve_trend(self, topic_name: str, days: int = 30) -> ComposedResponse:
        """Return a trend artifact, preferring cached versions.

        Args:
            topic_name: Topic identifier (slug).
            days: Lookback window in days.

        Returns:
            A :class:`ComposedResponse` with trend data.
        """
        cache_key = f"{topic_name}_{days}d"
        path_parts = ["retrieve_trend", "compile-once-serve-many"]

        # 1. Check artifact cache (compile-once, serve-many).
        artifact = self._cache.get("trend", cache_key)
        if artifact:
            logger.info("Serving trend artifact from cache: %s", cache_key)
            return ComposedResponse(
                answer=self._format_trend_from_artifact(artifact),
                citations=artifact.citations,
                artifacts_used=[cache_key],
                retrieval_path=path_parts + ["artifact_cache"],
            )

        # 2. Fresh retrieval from graph + vector store.
        try:
            trend = await self._graph.get_topic_trend(topic_name, days=days)
            graph_ctx = {
                "trend": {
                    "topic_id": trend.topic_id,
                    "scores": trend.scores,
                    "direction": trend.direction,
                }
            }
            citations = [Citation(source="knowledge_graph", title=f"Trend: {topic_name}")]
        except Exception:
            logger.exception("Graph trend retrieval failed for '%s'", topic_name)
            graph_ctx = {}
            citations = []

        # Supplement with vector search for context.
        vs_result = await self._hybrid.retrieve(
            f"{topic_name} trend analysis last {days} days", k=5
        )
        citations.extend(vs_result.citations[:5])

        answer = self._format_trend(topic_name, graph_ctx, vs_result.passages)

        # 3. Cache the compiled artifact for future requests.
        new_artifact = Artifact(
            artifact_type="trend",
            key=cache_key,
            data={"topic": topic_name, "days": days, "graph_context": graph_ctx},
            citations=citations,
        )
        self._cache.put(new_artifact)
        logger.info("Compiled and cached trend artifact: %s", cache_key)

        return ComposedResponse(
            answer=answer,
            citations=citations,
            graph_context=graph_ctx,
            retrieval_path=path_parts + ["graph", "vector", "compiled"],
        )

    async def retrieve_entity(self, entity_name: str) -> ComposedResponse:
        """Return entity network and related artifacts.

        Args:
            entity_name: Entity identifier.

        Returns:
            A :class:`ComposedResponse` with entity profile data.
        """
        path_parts = ["retrieve_entity"]

        # 1. Check cache.
        artifact = self._cache.get("entity", entity_name)
        if artifact:
            logger.info("Serving entity artifact from cache: %s", entity_name)
            return ComposedResponse(
                answer=self._format_entity_from_artifact(artifact),
                citations=artifact.citations,
                artifacts_used=[entity_name],
                retrieval_path=path_parts + ["artifact_cache"],
            )

        # 2. Fresh retrieval.
        try:
            network = await self._graph.get_entity_network(entity_name, hops=2, limit=50)
            graph_ctx = {"entity": entity_name, "network": network}
            citations = [Citation(source="knowledge_graph", title=f"Entity: {entity_name}")]
        except Exception:
            logger.exception("Graph entity retrieval failed for '%s'", entity_name)
            network = []
            graph_ctx = {}
            citations = []

        # Supplement with vector search.
        vs_result = await self._hybrid.retrieve(entity_name, k=5)
        citations.extend(vs_result.citations[:5])

        answer = self._format_entity(entity_name, network, vs_result.passages)

        # 3. Cache.
        new_artifact = Artifact(
            artifact_type="entity",
            key=entity_name,
            data=graph_ctx,
            citations=citations,
        )
        self._cache.put(new_artifact)

        return ComposedResponse(
            answer=answer,
            citations=citations,
            graph_context=graph_ctx,
            retrieval_path=path_parts + ["graph", "vector", "compiled"],
        )

    # ------------------------------------------------------------------
    # Internal formatters
    # ------------------------------------------------------------------

    @staticmethod
    def _compose_answer(result: RetrievalResult) -> str:
        """Assemble a plain-text answer from retrieval passages."""
        if not result.passages:
            return "No relevant information found."
        return "\n\n".join(result.passages[:10])

    @staticmethod
    def _format_trend(topic: str, graph_ctx: dict, passages: list[str]) -> str:
        parts = [f"## Trend Analysis: {topic}\n"]
        trend_data = graph_ctx.get("trend", {})
        direction = trend_data.get("direction", "unknown")
        scores = trend_data.get("scores", [])
        parts.append(f"**Direction:** {direction}  ")
        parts.append(f"**Data points:** {len(scores)}\n")
        if passages:
            parts.append("### Supporting Evidence\n")
            for p in passages[:5]:
                parts.append(f"- {p[:200]}")
        return "\n".join(parts)

    @staticmethod
    def _format_trend_from_artifact(artifact: Artifact) -> str:
        data = artifact.data
        topic = data.get("topic", "unknown")
        days = data.get("days", 30)
        graph_ctx = data.get("graph_context", {})
        trend_data = graph_ctx.get("trend", {})
        direction = trend_data.get("direction", "unknown")
        scores = trend_data.get("scores", [])
        return (
            f"## Trend Analysis: {topic} (cached)\n\n"
            f"**Direction:** {direction}  \n"
            f"**Window:** {days} days  \n"
            f"**Data points:** {len(scores)}\n"
        )

    @staticmethod
    def _format_entity(name: str, network: list[dict], passages: list[str]) -> str:
        parts = [f"## Entity Profile: {name}\n"]
        if network:
            parts.append(f"**Connections:** {len(network)}\n")
            for node in network[:5]:
                node_name = node.get("name", node.get("id", ""))
                parts.append(f"- {node_name}")
        if passages:
            parts.append("\n### Related Content\n")
            for p in passages[:5]:
                parts.append(f"- {p[:200]}")
        return "\n".join(parts)

    @staticmethod
    def _format_entity_from_artifact(artifact: Artifact) -> str:
        name = artifact.data.get("entity", artifact.key)
        network = artifact.data.get("network", [])
        return (
            f"## Entity Profile: {name} (cached)\n\n"
            f"**Connections:** {len(network)}\n"
        )
