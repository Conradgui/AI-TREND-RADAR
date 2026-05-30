"""Tests for agent tools — creation and basic validation."""

import re
from rag.agent.tools import create_tools


def test_create_tools_returns_six():
    class MockDriver:
        async def execute_query(self, cypher, **params):
            return []

    class MockRetriever:
        async def search(self, query, k=5):
            return []

    tools = create_tools(MockDriver(), MockRetriever())
    assert len(tools) == 6
    names = [t.name for t in tools]
    assert "search" in names
    assert "topic_trend" in names
    assert "entity_info" in names
    assert "daily_overview" in names
    assert "source_coverage" in names
    assert "recommend" in names


def test_date_regex():
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", "2026-05-28")
    assert not re.match(r"^\d{4}-\d{2}-\d{2}$", "2026-5-8")
    assert not re.match(r"^\d{4}-\d{2}-\d{2}$", "not-a-date")
