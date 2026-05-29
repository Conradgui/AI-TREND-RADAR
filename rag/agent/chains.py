"""Specialized chains for specific RAG workflows.

Each chain encapsulates a multi-step retrieval + generation pattern
for a particular use case.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from rag.agent.prompts import (
    CONTENT_GENERATOR_SYSTEM_PROMPT,
    QUERY_PARSING_PROMPT,
    TOPIC_ASSISTANT_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Data structures
# ------------------------------------------------------------------


@dataclass
class TypedQuery:
    """Structured query parsed from natural language."""

    query_type: str
    params: dict[str, Any] = field(default_factory=dict)
    language: str = "zh"


@dataclass
class ChainResult:
    """Result from a chain execution."""

    content: str
    query_type: str
    citations: list[dict[str, str]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


# ------------------------------------------------------------------
# Topic Analysis Chain
# ------------------------------------------------------------------


class TopicAnalysisChain:
    """Analyze a topic's trajectory, sources, and related entities.

    Uses the graph retriever to gather trend data, cross-source coverage,
    and entity relationships, then synthesises a structured analysis via LLM.

    Usage::

        chain = TopicAnalysisChain(retriever, llm)
        result = await chain.analyze("agentic-rag", days=30)
    """

    def __init__(self, retriever: Any, llm: BaseChatModel) -> None:
        self._retriever = retriever
        self._llm = llm

    async def analyze(self, topic_id: str, days: int = 30) -> ChainResult:
        """Run the full topic analysis pipeline.

        Args:
            topic_id: The topic to analyse.
            days: Number of days to look back for trend data.

        Returns:
            A :class:`ChainResult` with the analysis, citations, and metadata.
        """
        # 1. Gather data from graph
        trend = await self._retriever.get_topic_trend(topic_id, days=days)
        related = await self._retriever.get_related_topics(topic_id, limit=10)
        sources = await self._retriever.get_cross_source_coverage(topic_id)

        context = {
            "topic_id": trend.topic_id,
            "direction": trend.direction,
            "score_count": len(trend.scores),
            "latest_score": trend.scores[-1] if trend.scores else None,
            "related_topics": related[:5],
            "source_coverage": sources,
        }

        # 2. Generate analysis via LLM
        prompt = (
            f"请基于以下数据对话题 '{topic_id}' 进行综合分析，包括：\n"
            f"1. 趋势方向和变化原因\n"
            f"2. 跨源覆盖情况（哪些信息源关注度高）\n"
            f"3. 相关话题及关联性\n"
            f"4. 编辑建议（是否值得重点报道）\n\n"
            f"数据：\n{json.dumps(context, ensure_ascii=False, indent=2)}"
        )

        response = await self._llm.ainvoke([
            SystemMessage(content=TOPIC_ASSISTANT_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])

        citations = [
            {"type": "trend", "topic": topic_id, "days": str(days)},
            {"type": "source_coverage", "topic": topic_id},
            {"type": "related_topics", "topic": topic_id},
        ]

        return ChainResult(
            content=response.content,
            query_type="topic_analysis",
            citations=citations,
            metadata={"topic_id": topic_id, "days": days, "direction": trend.direction},
        )


# ------------------------------------------------------------------
# Content Generation Chain
# ------------------------------------------------------------------


class ContentGenerationChain:
    """Generate report drafts and editorial content from retrieved context.

    Uses the retriever to gather relevant context, then passes it to the
    LLM with a content-generation system prompt.

    Usage::

        chain = ContentGenerationChain(retriever, llm)
        result = await chain.generate("撰写一篇关于 Agentic RAG 的趋势周报", language="zh")
    """

    def __init__(self, retriever: Any, llm: BaseChatModel) -> None:
        self._retriever = retriever
        self._llm = llm

    async def generate(
        self,
        instruction: str,
        language: str = "zh",
        context_queries: list[str] | None = None,
    ) -> ChainResult:
        """Generate content based on instruction and retrieved context.

        Args:
            instruction: The user's content generation instruction.
            language: Output language (``"zh"`` or ``"en"``).
            context_queries: Optional list of queries to retrieve context.
                If ``None``, the instruction itself is used as the query.

        Returns:
            A :class:`ChainResult` with the generated content and citations.
        """
        # 1. Retrieve context
        queries = context_queries or [instruction]
        all_context: list[dict[str, Any]] = []
        citations: list[dict[str, str]] = []

        for q in queries:
            results = await self._retriever.search(q, limit=5)
            all_context.extend(results)
            for r in results:
                citations.append({
                    "type": "search_result",
                    "query": q,
                    "title": r.get("title", ""),
                    "date": r.get("date", ""),
                })

        # 2. Build generation prompt
        lang_label = "中文" if language == "zh" else "English"
        context_block = json.dumps(all_context[:15], ensure_ascii=False, indent=2)
        prompt = (
            f"请用{lang_label}完成以下内容生成任务。\n\n"
            f"用户指令：{instruction}\n\n"
            f"检索到的上下文数据：\n{context_block}\n\n"
            f"要求：\n"
            f"- 引用具体数据来源（报告名称、日期）\n"
            f"- 保持逻辑清晰、段落分明\n"
            f"- 如果上下文不足以完成指令，明确指出缺失的部分"
        )

        response = await self._llm.ainvoke([
            SystemMessage(content=CONTENT_GENERATOR_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])

        return ChainResult(
            content=response.content,
            query_type="content_generation",
            citations=citations,
            metadata={"language": language, "context_count": len(all_context)},
        )


# ------------------------------------------------------------------
# Query Router Chain
# ------------------------------------------------------------------


class QueryRouterChain:
    """Classify user intent and route to the appropriate chain or tool.

    Parses natural language into a :class:`TypedQuery` that downstream
    consumers (tools, chains) can act on.

    Usage::

        router = QueryRouterChain(llm)
        typed = await router.route("agentic rag 最近的趋势怎么样？")
        # typed.query_type == "topic_trend"
    """

    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    async def route(self, query: str) -> TypedQuery:
        """Parse a natural language query into a typed query.

        Args:
            query: The user's natural language query.

        Returns:
            A :class:`TypedQuery` with the inferred query type and parameters.
        """
        prompt = QUERY_PARSING_PROMPT.format(query=query)

        response = await self._llm.ainvoke([
            HumanMessage(content=prompt),
        ])

        raw = response.content.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = "\n".join(raw.splitlines()[1:])
            if raw.endswith("```"):
                raw = raw[: -len("```")]
            raw = raw.strip()

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Failed to parse TypedQuery JSON: %s", raw[:200])
            return TypedQuery(query_type="semantic_search", params={"query": query})

        return TypedQuery(
            query_type=data.get("query_type", "semantic_search"),
            params=data.get("params", {}),
            language=data.get("language", "zh"),
        )
