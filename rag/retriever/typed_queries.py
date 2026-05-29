"""KnowQL-inspired typed query system for structured retrieval routing."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class QueryType(Enum):
    """Canonical query types the retriever can route on."""

    TREND_ANALYSIS = "trend_analysis"
    TOPIC_SEARCH = "topic_search"
    ENTITY_LOOKUP = "entity_lookup"
    CROSS_SOURCE = "cross_source"
    TEMPORAL_COMPARISON = "temporal_comparison"
    RECOMMENDATION = "recommendation"


@dataclass
class TypedQuery:
    """Structured representation of a user's information need.

    Attributes:
        query_type: The classified query type.
        entities: Named entities mentioned in the query.
        topics: Topic keywords extracted from the query.
        time_range: Optional ``(start, end)`` ISO-date pair.
        sources: Optional source filter (e.g. ``["hn", "github"]``).
        language: Response language hint (``"zh"`` or ``"en"``).
        max_results: Maximum number of results to return.
        raw_text: Original natural-language query.
    """

    query_type: QueryType
    entities: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    time_range: tuple[str, str] | None = None
    sources: list[str] | None = None
    language: str = "zh"
    max_results: int = 10
    raw_text: str = ""

    def to_filter(self) -> dict[str, Any]:
        """Convert to a ChromaDB-compatible metadata filter dict."""
        filters: dict[str, Any] = {}
        if self.sources:
            filters["source"] = {"$in": self.sources}
        if self.time_range:
            start, end = self.time_range
            filters["date"] = {"$gte": start, "$lte": end}
        return filters


# ---------------------------------------------------------------------------
# Keyword-based classifier (no LLM required)
# ---------------------------------------------------------------------------

_KEYWORD_MAP: dict[QueryType, list[str]] = {
    QueryType.TREND_ANALYSIS: [
        "趋势", "走向", "trend", "trending", "direction",
        "变化", "上升", "下降", "热度", "流行",
    ],
    QueryType.TOPIC_SEARCH: [
        "什么是", "介绍", "what is", "explain", "关于",
        "主题", "topic", "搜索", "search", "详情",
    ],
    QueryType.ENTITY_LOOKUP: [
        "谁", "who", "哪个公司", "哪个项目", "which",
        "公司", "项目", "模型", "entity", "人",
    ],
    QueryType.CROSS_SOURCE: [
        "对比", "比较", "compare", "versus", "vs",
        "差异", "difference", "不同", "共同",
    ],
    QueryType.TEMPORAL_COMPARISON: [
        "之前", "之后", "before", "after", "变化",
        "时间", "time", "去年", "今年", "上个月",
        "一周", "一个月", "30天", "week", "month",
    ],
    QueryType.RECOMMENDATION: [
        "推荐", "recommend", "最好", "best", "top",
        "选择", "哪个好", "should I", "建议",
    ],
}


def classify_query(text: str) -> TypedQuery:
    """Classify a natural-language query using keyword heuristics.

    This is a fast, LLM-free path suitable for initial routing.

    Args:
        text: Raw user query.

    Returns:
        A :class:`TypedQuery` with ``query_type`` set based on keyword matching.
    """
    lower = text.lower()
    scores: dict[QueryType, int] = {}

    for qtype, keywords in _KEYWORD_MAP.items():
        score = sum(1 for kw in keywords if kw in lower)
        if score:
            scores[qtype] = score

    if scores:
        best = max(scores, key=scores.get)  # type: ignore[arg-type]
    else:
        best = QueryType.TOPIC_SEARCH  # default fallback

    logger.debug("Classified query as %s (scores=%s)", best.value, scores)
    return TypedQuery(query_type=best, raw_text=text)


# ---------------------------------------------------------------------------
# LLM-based parser (optional, higher accuracy)
# ---------------------------------------------------------------------------

async def parse_natural_query(text: str, llm: Any) -> TypedQuery:
    """Convert a natural-language query to a :class:`TypedQuery` via LLM.

    The LLM is prompted to output a JSON object matching the TypedQuery schema.

    Args:
        text: Raw user query.
        llm: An LLM client with an ``async ainvoke(prompt)`` method.

    Returns:
        A fully-populated :class:`TypedQuery`.
    """
    import json

    prompt = f"""Analyze the following user query and return a JSON object with these fields:
- query_type: one of {[t.value for t in QueryType]}
- entities: list of named entities mentioned
- topics: list of topic keywords
- time_range: null or [start_date, end_date] in ISO format
- sources: null or list of source names (github, hn, arxiv, etc.)
- language: "zh" if Chinese, "en" otherwise
- max_results: integer, default 10

Query: {text}

Return ONLY the JSON object, no extra text."""

    try:
        response = await llm.ainvoke(prompt)
        raw = response if isinstance(response, str) else str(response)
        # Strip markdown fences if present.
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        data = json.loads(raw)
        query_type = QueryType(data.get("query_type", "topic_search"))
        time_range = None
        if data.get("time_range") and isinstance(data["time_range"], list):
            time_range = tuple(data["time_range"])

        return TypedQuery(
            query_type=query_type,
            entities=data.get("entities", []),
            topics=data.get("topics", []),
            time_range=time_range,
            sources=data.get("sources"),
            language=data.get("language", "zh"),
            max_results=data.get("max_results", 10),
            raw_text=text,
        )
    except Exception:
        logger.exception("LLM query parsing failed, falling back to keyword classifier")
        return classify_query(text)
