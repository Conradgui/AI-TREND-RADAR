"""Tests for retrieval layer."""

from rag.retriever.vector_store import VectorStore
from rag.retriever.hybrid import RetrievedChunk


def test_vector_store_init(tmp_path):
    store = VectorStore(str(tmp_path / "chroma"))
    assert store.count() == 0


def test_vector_store_add_and_search(tmp_path):
    store = VectorStore(str(tmp_path / "chroma"))
    store.add_chunks(
        chunks=["AI trends in 2026", "Graph RAG is important"],
        metadatas=[{"date": "2026-05-28"}, {"date": "2026-05-28"}],
        ids=["c1", "c2"],
    )
    assert store.count() == 2
    results = store.search("AI trends", k=1)
    assert len(results) == 1
    assert "AI trends" in results[0]["text"]


def test_retrieved_chunk():
    chunk = RetrievedChunk(text="test", source="vector", score=0.9)
    assert chunk.source == "vector"
    assert chunk.score == 0.9
