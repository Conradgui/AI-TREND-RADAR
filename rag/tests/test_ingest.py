"""Tests for ingestion pipeline — chunk_text and ChromaDB integration."""

import pytest
from rag.ingest import chunk_text


def test_chunk_text_empty():
    assert chunk_text("") == []
    assert chunk_text("   ") == []
    assert chunk_text(None) == []


def test_chunk_text_short():
    result = chunk_text("这是一个短文本内容")
    assert len(result) == 1
    assert result[0] == "这是一个短文本内容"


def test_chunk_text_sections():
    text = "# 标题\n这里是第一段内容\n\n## 章节\n这里是第二段内容"
    chunks = chunk_text(text)
    assert len(chunks) >= 2


def test_chunk_text_long_paragraph():
    text = "段" * 2000
    chunks = chunk_text(text, chunk_size=500)
    assert len(chunks) >= 3
    assert all(len(c) > 20 for c in chunks)


def test_chunk_text_overlap():
    text = "A" * 1500
    chunks = chunk_text(text, chunk_size=500, overlap=100)
    assert len(chunks) >= 2


def test_chunk_text_invalid_params():
    with pytest.raises(ValueError, match="chunk_size must be > overlap"):
        chunk_text("test", chunk_size=100, overlap=200)


def test_chunk_text_filters_short():
    text = "好\n\n## 标题\n\n这是一段足够长的内容用于测试分块功能是否会正确保留"
    chunks = chunk_text(text)
    # Very short chunks (< 20 chars) should be filtered
    assert all(len(c) > 20 for c in chunks)
