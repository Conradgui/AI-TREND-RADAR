"""Tests for agent module."""

from rag.agent.tools import create_tools


def test_create_tools_returns_four():
    class MockDriver:
        async def execute_query(self, cypher, **params):
            return []
    class MockVS:
        def search(self, query, k=5):
            return []
    tools = create_tools(MockDriver(), MockVS())
    assert len(tools) == 4
    names = [t.name for t in tools]
    assert "graph_search" in names
    assert "vector_search" in names
    assert "trend_analysis" in names
    assert "topic_recommend" in names
