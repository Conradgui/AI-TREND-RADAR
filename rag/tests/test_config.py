"""Tests for config and graphrag modules."""

import pytest
from rag.config import NEO4J_URI, is_configured


def test_neo4j_defaults():
    assert NEO4J_URI == "bolt://localhost:7687"


def test_is_configured_reflects_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    from rag import config
    old = config.ANTHROPIC_API_KEY
    config.ANTHROPIC_API_KEY = "sk-test"
    assert config.is_configured() is True
    config.ANTHROPIC_API_KEY = old


def test_schema_queries_not_empty():
    from rag.graphrag.schema import SCHEMA_QUERIES
    assert len(SCHEMA_QUERIES) >= 5
    assert any("Topic" in q for q in SCHEMA_QUERIES)


def test_driver_class_exists():
    from rag.graphrag.driver import Neo4jDriver
    d = Neo4jDriver()
    assert d._uri == "bolt://localhost:7687"
