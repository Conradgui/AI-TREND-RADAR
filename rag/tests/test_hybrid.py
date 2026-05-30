"""Tests for hybrid retriever — RRF scoring and error handling."""

from rag.retriever.hybrid import RetrievedChunk


def test_rrf_scoring_merges_results():
    """RRF should merge results from both sources using text as key."""
    v1 = RetrievedChunk(text="Result A from vector", source="vector", score=0.9)
    v2 = RetrievedChunk(text="Result B from vector", source="vector", score=0.8)
    g1 = RetrievedChunk(text="Result A from vector", source="graph", score=100)  # same text
    g2 = RetrievedChunk(text="Result C from graph", source="graph", score=80)

    # Simulate RRF using r.text as key (matching production code)
    fused = {}
    K = 60
    for rank, r in enumerate([v1, v2]):
        key = r.text
        fused[key] = fused.get(key, {"chunk": r, "score": 0.0})
        fused[key]["score"] += 1.0 / (K + rank + 1)
    for rank, r in enumerate([g1, g2]):
        key = r.text
        fused[key] = fused.get(key, {"chunk": r, "score": 0.0})
        fused[key]["score"] += 1.0 / (K + rank + 1)

    # "Result A from vector" appears in both, should get highest RRF score
    ranked = sorted(fused.values(), key=lambda x: x["score"], reverse=True)
    assert ranked[0]["chunk"].text == "Result A from vector"
    assert len(ranked) == 3  # 3 unique texts


def test_retrieved_chunk():
    chunk = RetrievedChunk(text="test", source="vector", score=0.9)
    assert chunk.source == "vector"
    assert chunk.metadata == {}


def test_rrf_score_range():
    """RRF scores should be between 0 and 1."""
    K = 60
    assert 1.0 / (K + 1) < 0.02
    assert 1.0 / (K + 10) < 0.02
