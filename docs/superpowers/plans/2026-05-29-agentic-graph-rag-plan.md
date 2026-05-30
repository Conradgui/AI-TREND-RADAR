# Agentic RAG + Graph RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agentic RAG + Graph RAG capabilities to AI Topic Radar, with a Chat UI panel, using neo4j-graphrag-python and LangGraph, deployable locally via `pnpm setup:rag` + `pnpm digest:rag`.

**Architecture:** TypeScript pipeline generates digest data → Python RAG server ingests into Neo4j + ChromaDB → LangGraph Agent answers queries via 4 tools → Chat UI served on localhost:8001 with right-side sliding panel.

**Tech Stack:** Python 3.11+, FastAPI, neo4j-graphrag-python, LangGraph, ChromaDB, Docker (Neo4j), vanilla JS Chat UI.

---

## File Structure

```
rag/
├── __init__.py                  # package marker
├── config.py                    # reads project .env via python-dotenv
├── server.py                    # FastAPI app: /chat, /config, /health, /ingest, serves chat.html
├── ingest.py                    # CLI entry: python -m rag.ingest
├── graphrag/
│   ├── __init__.py
│   ├── builder.py               # KG construction via neo4j-graphrag SimpleKGPipeline
│   ├── schema.py                # Neo4j constraints + indexes init
│   └── driver.py                # AsyncGraphDatabase driver wrapper
├── retriever/
│   ├── __init__.py
│   ├── vector_store.py          # ChromaDB wrapper
│   └── hybrid.py                # Hybrid search combining Neo4j + ChromaDB
├── agent/
│   ├── __init__.py
│   ├── agent.py                 # LangGraph ReAct agent with 4 tools
│   ├── tools.py                 # Tool definitions (graph_search, vector_search, trend_analysis, topic_recommend)
│   └── prompts.py               # System prompts
├── web/
│   ├── __init__.py
│   └── chat.html                # Chat UI + config page (single HTML file, vanilla JS)
├── data/                        # .gitignored: ChromaDB persist + artifacts
├── tests/
│   ├── __init__.py
│   ├── test_config.py
│   ├── test_graphrag_builder.py
│   ├── test_retriever.py
│   └── test_agent.py
├── requirements.txt
└── pyproject.toml

docker-compose.yml               # Neo4j container
package.json                     # add setup:rag, digest:rag scripts
```

---

## Task 1: Project Setup — Python package + dependencies + Docker

**Files:**
- Create: `rag/pyproject.toml`
- Create: `rag/requirements.txt`
- Create: `rag/__init__.py`
- Create: `rag/config.py`
- Create: `docker-compose.yml`
- Modify: `package.json` (add scripts)
- Create: `rag/data/.gitkeep`
- Modify: `.gitignore` (add rag/data/)

- [ ] **Step 1: Create `rag/pyproject.toml`**

```toml
[project]
name = "ai-topic-radar-rag"
version = "0.1.0"
description = "Agentic RAG + Graph RAG for AI Topic Radar"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn>=0.32.0",
    "neo4j>=5.25.0",
    "neo4j-graphrag[openai,anthropic]>=1.0.0",
    "langchain>=0.3.0",
    "langchain-openai>=0.3.0",
    "langchain-anthropic>=0.3.0",
    "langgraph>=0.2.0",
    "chromadb>=0.5.0",
    "pydantic>=2.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.24.0"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Create `rag/requirements.txt`**

```
fastapi>=0.115.0
uvicorn>=0.32.0
neo4j>=5.25.0
neo4j-graphrag[openai,anthropic]>=1.0.0
langchain>=0.3.0
langchain-openai>=0.3.0
langchain-anthropic>=0.3.0
langgraph>=0.2.0
chromadb>=0.5.0
pydantic>=2.0
python-dotenv>=1.0.0
```

- [ ] **Step 3: Create `rag/__init__.py`**

```python
"""AI Topic Radar RAG — Agentic RAG + Graph RAG with Neo4j knowledge graph."""
```

- [ ] **Step 4: Create `rag/config.py`**

```python
"""Configuration — reads project root .env via python-dotenv."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (parent of rag/)
_PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# LLM — same keys as TypeScript pipeline
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "anthropic")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "")

# Neo4j
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

# Paths
DIGESTS_DIR = str(_PROJECT_ROOT / "digests")
CHROMA_DIR = str(Path(__file__).parent / "data" / "chroma")
ARTIFACTS_DIR = str(Path(__file__).parent / "data" / "artifacts")

# Server
RAG_HOST = os.getenv("RAG_HOST", "0.0.0.0")
RAG_PORT = int(os.getenv("RAG_PORT", "8001"))

def get_llm_api_key() -> str:
    """Return the API key for the configured LLM provider."""
    key_map = {
        "anthropic": ANTHROPIC_API_KEY,
        "openai": OPENAI_API_KEY,
        "deepseek": DEEPSEEK_API_KEY,
    }
    return key_map.get(LLM_PROVIDER, ANTHROPIC_API_KEY)

def is_configured() -> bool:
    """Check if at least one LLM API key is configured."""
    return bool(get_llm_api_key())
```

- [ ] **Step 5: Create `docker-compose.yml` in project root**

```yaml
version: "3.8"
services:
  neo4j:
    image: neo4j:5
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      NEO4J_AUTH: "neo4j/password"
      NEO4J_PLUGINS: '["graph-data-science"]'
    volumes:
      - neo4j_data:/data
    restart: unless-stopped

volumes:
  neo4j_data:
```

- [ ] **Step 6: Add scripts to `package.json`**

Add to the `"scripts"` object:

```json
"setup:rag": "pip install -r rag/requirements.txt && docker compose up -d",
"digest:rag": "pnpm start && pnpm manifest && python -m rag.ingest",
"rag:serve": "python -m rag.server",
"rag:ingest": "python -m rag.ingest"
```

- [ ] **Step 7: Update `.gitignore`**

Append:

```
# RAG data
rag/data/chroma/
rag/data/artifacts/
!rag/data/.gitkeep
```

- [ ] **Step 8: Create `rag/data/.gitkeep`**

Empty file.

- [ ] **Step 9: Run syntax check and commit**

```bash
python -m py_compile rag/__init__.py
python -m py_compile rag/config.py
pnpm typecheck
git add rag/ docker-compose.yml package.json .gitignore
git commit -m "feat(rag): project setup — Python package, dependencies, Docker, scripts"
```

---

## Task 2: Neo4j Schema + Driver

**Files:**
- Create: `rag/graphrag/__init__.py`
- Create: `rag/graphrag/driver.py`
- Create: `rag/graphrag/schema.py`

- [ ] **Step 1: Create `rag/graphrag/__init__.py`**

```python
"""Knowledge graph layer using Neo4j + neo4j-graphrag-python."""
```

- [ ] **Step 2: Create `rag/graphrag/driver.py`**

```python
"""Neo4j async driver wrapper."""

from __future__ import annotations

from neo4j import AsyncGraphDatabase, AsyncDriver

from rag.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD


class Neo4jDriver:
    """Thin wrapper around Neo4j async driver with lifecycle management."""

    def __init__(self, uri: str = NEO4J_URI, user: str = NEO4J_USER, password: str = NEO4J_PASSWORD):
        self._driver: AsyncDriver | None = None
        self._uri = uri
        self._auth = (user, password)

    async def connect(self) -> None:
        self._driver = AsyncGraphDatabase.driver(self._uri, auth=self._auth)
        await self._driver.verify_connectivity()

    async def close(self) -> None:
        if self._driver:
            await self._driver.close()
            self._driver = None

    @property
    def driver(self) -> AsyncDriver:
        if not self._driver:
            raise RuntimeError("Driver not connected. Call connect() first.")
        return self._driver

    async def execute_query(self, cypher: str, **params):
        async with self.driver.session() as session:
            result = await session.execute_read(lambda tx: tx.run(cypher, **params))
            return [r.data() for r in result]

    async def execute_write(self, cypher: str, **params):
        async with self.driver.session() as session:
            await session.execute_write(lambda tx: tx.run(cypher, **params))
```

- [ ] **Step 3: Create `rag/graphrag/schema.py`**

```python
"""Neo4j schema — constraints, indexes, vector index."""

SCHEMA_QUERIES = [
    # Uniqueness constraints
    "CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE",
    "CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT digest_date IF NOT EXISTS FOR (d:DailyDigest) REQUIRE d.date IS UNIQUE",

    # Full-text index for hybrid search
    "CREATE FULLTEXT INDEX entity_search IF NOT EXISTS FOR (e:Entity) ON EACH [e.name, e.description]",

    # Vector index for chunk embeddings (1536 dims for text-embedding-3-small)
    """CREATE VECTOR INDEX chunk_embeddings IF NOT EXISTS
       FOR (c:Chunk) ON (c.embedding)
       OPTIONS {indexConfig: {
         `vector.dimensions`: 1536,
         `vector.similarity_function`: 'cosine'
       }}""",
]


async def init_schema(driver) -> None:
    """Create all constraints and indexes. Safe to call multiple times."""
    for query in SCHEMA_QUERIES:
        try:
            await driver.execute_write(query)
        except Exception as e:
            # Constraint/index already exists or other non-critical error
            if "already exists" not in str(e).lower():
                print(f"[schema] Warning: {e}")
```

- [ ] **Step 4: Write test `rag/tests/test_config.py`**

```python
"""Tests for config module."""

import os
from rag.config import is_configured, get_llm_api_key, NEO4J_URI


def test_neo4j_defaults():
    assert NEO4J_URI == "bolt://localhost:7687"


def test_is_configured_with_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    # Re-evaluate
    from rag import config
    config.ANTHROPIC_API_KEY = "sk-test"
    assert config.is_configured() is True


def test_is_configured_without_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    from rag import config
    config.ANTHROPIC_API_KEY = ""
    config.OPENAI_API_KEY = ""
    config.DEEPSEEK_API_KEY = ""
    assert config.is_configured() is False
```

- [ ] **Step 5: Run tests and commit**

```bash
cd "c:/Users/Administrator/Desktop/Graph RAG"
python -m py_compile rag/graphrag/__init__.py
python -m py_compile rag/graphrag/driver.py
python -m py_compile rag/graphrag/schema.py
pytest rag/tests/test_config.py -v
git add rag/graphrag/ rag/tests/test_config.py
git commit -m "feat(rag): Neo4j driver wrapper and schema initialization"
```

---

## Task 3: Ingestion Pipeline — load digests + build knowledge graph

**Files:**
- Create: `rag/ingest.py`
- Create: `rag/graphrag/builder.py`

- [ ] **Step 1: Create `rag/ingest.py`**

```python
"""CLI entry point: python -m rag.ingest — ingests digest data into Neo4j + ChromaDB."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from rag.config import DIGESTS_DIR, CHROMA_DIR, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from rag.graphrag.driver import Neo4jDriver
from rag.graphrag.schema import init_schema
from rag.graphrag.builder import KnowledgeGraphBuilder


DATE_PATTERN = __import__("re").compile(r"^\d{4}-\d{2}-\d{2}$")


def _find_digest_dates() -> list[str]:
    """Return sorted list of date directories under digests/."""
    digests = Path(DIGESTS_DIR)
    if not digests.exists():
        return []
    return sorted(
        d.name for d in digests.iterdir()
        if d.is_dir() and DATE_PATTERN.match(d.name)
    )


def _load_topic_pool(date_dir: Path) -> dict | None:
    pool_path = date_dir / "topic-pool.json"
    if not pool_path.exists():
        return None
    try:
        return json.loads(pool_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_reports(date_dir: Path) -> dict[str, str]:
    """Load all .md reports, excluding English variants and rollups."""
    reports = {}
    skip_suffixes = ("-en.md",)
    skip_names = ("ai-weekly.md", "ai-monthly.md")
    for f in date_dir.glob("*.md"):
        if any(f.name.endswith(s) for s in skip_suffixes):
            continue
        if f.name in skip_names:
            continue
        try:
            reports[f.stem] = f.read_text(encoding="utf-8")
        except OSError:
            pass
    return reports


async def run_ingestion() -> int:
    """Ingest all digest dates. Returns count of dates processed."""
    driver = Neo4jDriver(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    await driver.connect()

    try:
        await init_schema(driver)
        builder = KnowledgeGraphBuilder(driver)

        dates = _find_digest_dates()
        print(f"[ingest] Found {len(dates)} digest dates")

        for date_str in dates:
            date_dir = Path(DIGESTS_DIR) / date_str
            topic_pool = _load_topic_pool(date_dir)
            reports = _load_reports(date_dir)

            if not topic_pool and not reports:
                continue

            await builder.ingest_date(date_str, topic_pool, reports)
            print(f"[ingest] {date_str}: ingested")

        return len(dates)
    finally:
        await driver.close()


def main():
    count = asyncio.run(run_ingestion())
    print(f"[ingest] Done. Processed {count} dates.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Create `rag/graphrag/builder.py`**

```python
"""Knowledge graph builder — ingests digest data into Neo4j."""

from __future__ import annotations

from datetime import datetime

from rag.graphrag.driver import Neo4jDriver


class KnowledgeGraphBuilder:
    """Builds and updates the Neo4j knowledge graph from digest data."""

    def __init__(self, driver: Neo4jDriver):
        self.driver = driver

    async def ingest_date(
        self,
        date_str: str,
        topic_pool: dict | None,
        reports: dict[str, str],
    ) -> None:
        """Ingest one day's data into the knowledge graph."""

        # 1. Create DailyDigest node
        candidate_count = len(topic_pool.get("candidates", [])) if topic_pool else 0
        await self.driver.execute_write(
            "MERGE (d:DailyDigest {date: $date}) "
            "SET d.candidateCount = $count, d.generatedAt = $now",
            date=date_str, count=candidate_count, now=datetime.utcnow().isoformat(),
        )

        # 2. Create Source nodes
        sources = set()
        if topic_pool:
            for c in topic_pool.get("candidates", []):
                src = c.get("source", "")
                if src:
                    sources.add(src)
        for src in sources:
            await self.driver.execute_write(
                "MERGE (s:Source {id: $id}) SET s.name = $id",
                id=src,
            )

        # 3. Process topic pool candidates
        if topic_pool:
            for candidate in topic_pool.get("candidates", []):
                await self._ingest_candidate(candidate, date_str)

        # 4. Create Document nodes for reports
        for report_type, content in reports.items():
            await self.driver.execute_write(
                "MERGE (doc:Document {id: $id}) "
                "SET doc.title = $title, doc.date = $date, doc.reportType = $type, doc.content = $content",
                id=f"{date_str}/{report_type}",
                title=report_type,
                date=date_str,
                type=report_type,
                content=content[:5000],  # truncate for storage
            )
            await self.driver.execute_write(
                "MATCH (doc:Document {id: $id}), (d:DailyDigest {date: $date}) "
                "MERGE (doc)-[:PART_OF]->(d)",
                id=f"{date_str}/{report_type}", date=date_str,
            )

    async def _ingest_candidate(self, candidate: dict, date_str: str) -> None:
        """Ingest a single topic candidate into the graph."""
        title = candidate.get("title", "") or candidate.get("topic", "")
        if not title:
            return

        topic_id = title.lower().strip()
        category = candidate.get("category", "")
        score = candidate.get("score", 0)
        action = candidate.get("action", "")
        source = candidate.get("source", "")
        url = candidate.get("url", "")
        reason = candidate.get("reason", "")

        # Create/update Topic node
        await self.driver.execute_write(
            "MERGE (t:Topic {id: $id}) "
            "SET t.name = $name, t.category = $category, "
            "t.totalScore = CASE WHEN t.totalScore IS NULL OR $score > t.totalScore "
            "THEN $score ELSE t.totalScore END, "
            "t.mentionCount = COALESCE(t.mentionCount, 0) + 1, "
            "t.lastSeen = $date, "
            "t.firstSeen = COALESCE(t.firstSeen, $date)",
            id=topic_id, name=title, category=category, score=score, date=date_str,
        )

        # Link Topic to DailyDigest
        await self.driver.execute_write(
            "MATCH (t:Topic {id: $topic_id}), (d:DailyDigest {date: $date}) "
            "MERGE (t)-[r:APPEARED_ON]->(d) SET r.score = $score, r.action = $action",
            topic_id=topic_id, date=date_str, score=score, action=action,
        )

        # Link Topic to Source
        if source:
            await self.driver.execute_write(
                "MATCH (t:Topic {id: $topic_id}), (s:Source {id: $source}) "
                "MERGE (t)-[:DISCOVERED_VIA]->(s)",
                topic_id=topic_id, source=source,
            )

        # Extract and create Entity nodes from tags
        for tag in candidate.get("tags", []):
            if not tag or len(tag) < 2:
                continue
            entity_id = tag.lower().strip()
            await self.driver.execute_write(
                "MERGE (e:Entity {id: $id}) SET e.name = $name, e.type = 'topic_tag'",
                id=entity_id, name=tag,
            )
            await self.driver.execute_write(
                "MATCH (e:Entity {id: $entity_id}), (t:Topic {id: $topic_id}) "
                "MERGE (e)-[:MENTIONS]->(t)",
                entity_id=entity_id, topic_id=topic_id,
            )
```

- [ ] **Step 3: Write test `rag/tests/test_graphrag_builder.py`**

```python
"""Tests for knowledge graph builder."""

import pytest
from rag.graphrag.builder import KnowledgeGraphBuilder


def test_builder_initialization():
    """Builder can be created with a mock driver."""
    class MockDriver:
        async def execute_write(self, cypher, **params):
            pass
    builder = KnowledgeGraphBuilder(MockDriver())
    assert builder is not None


@pytest.mark.asyncio
async def test_ingest_candidate_with_mock():
    """Ingest candidate calls execute_write for topic, digest link, and source."""
    calls = []
    class MockDriver:
        async def execute_write(self, cypher, **params):
            calls.append((cypher, params))

    builder = KnowledgeGraphBuilder(MockDriver())
    candidate = {
        "title": "Test Topic",
        "category": "模型与技术突破",
        "score": 85,
        "action": "深挖",
        "source": "GitHub Trending",
        "url": "https://example.com",
        "tags": ["python", "llm"],
    }
    await builder._ingest_candidate(candidate, "2026-05-28")

    # Should have: Topic MERGE, APPEARED_ON, DISCOVERED_VIA, 2x Entity MERGE, 2x MENTIONS
    assert len(calls) >= 4
    topic_cypher = calls[0][0]
    assert "MERGE (t:Topic" in topic_cypher
```

- [ ] **Step 4: Run syntax check and commit**

```bash
python -m py_compile rag/ingest.py
python -m py_compile rag/graphrag/builder.py
pytest rag/tests/test_graphrag_builder.py -v
git add rag/ingest.py rag/graphrag/builder.py rag/tests/test_graphrag_builder.py
git commit -m "feat(rag): ingestion pipeline and knowledge graph builder"
```

---

## Task 4: Retrieval Layer — ChromaDB + hybrid search

**Files:**
- Create: `rag/retriever/__init__.py`
- Create: `rag/retriever/vector_store.py`
- Create: `rag/retriever/hybrid.py`

- [ ] **Step 1: Create `rag/retriever/__init__.py`**

```python
"""Retrieval layer — vector search and hybrid retrieval."""
```

- [ ] **Step 2: Create `rag/retriever/vector_store.py`**

```python
"""ChromaDB vector store wrapper for document chunk embeddings."""

from __future__ import annotations

import chromadb

from rag.config import CHROMA_DIR


class VectorStore:
    """Manages document chunks and their embeddings in ChromaDB."""

    def __init__(self, persist_dir: str = CHROMA_DIR):
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.collection = self.client.get_or_create_collection(
            name="digest_chunks",
            metadata={"hnsw:space": "cosine"},
        )

    def add_chunks(self, chunks: list[str], metadatas: list[dict], ids: list[str]) -> None:
        """Add document chunks with metadata. Chunks are auto-embedded by ChromaDB."""
        self.collection.add(documents=chunks, metadatas=metadatas, ids=ids)

    def search(self, query: str, k: int = 5, where: dict | None = None) -> list[dict]:
        """Semantic search. Returns list of {text, metadata, distance}."""
        results = self.collection.query(query_texts=[query], n_results=k, where=where)
        items = []
        for i in range(len(results["ids"][0])):
            items.append({
                "text": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "distance": results["distances"][0][i] if results.get("distances") else None,
            })
        return items

    def count(self) -> int:
        return self.collection.count()

    def delete_by_date(self, date: str) -> None:
        """Delete all chunks for a specific date (for re-ingestion)."""
        self.collection.delete(where={"date": date})
```

- [ ] **Step 3: Create `rag/retriever/hybrid.py`**

```python
"""Hybrid retriever combining Neo4j graph search with ChromaDB vector search."""

from __future__ import annotations

from dataclasses import dataclass, field

from rag.graphrag.driver import Neo4jDriver
from rag.retriever.vector_store import VectorStore


@dataclass
class RetrievedChunk:
    text: str
    source: str  # "vector" or "graph"
    score: float
    metadata: dict = field(default_factory=dict)


class HybridRetriever:
    """Combines Neo4j graph traversal with ChromaDB vector similarity."""

    def __init__(self, vector_store: VectorStore, neo4j_driver: Neo4jDriver):
        self.vector = vector_store
        self.neo4j = neo4j_driver

    async def search(self, query: str, k: int = 5) -> list[RetrievedChunk]:
        """Hybrid search: vector + graph, merge and deduplicate."""
        results: list[RetrievedChunk] = []

        # Vector search
        try:
            vector_hits = self.vector.search(query, k=k)
            for hit in vector_hits:
                results.append(RetrievedChunk(
                    text=hit["text"],
                    source="vector",
                    score=1.0 - (hit["distance"] or 0),  # convert distance to similarity
                    metadata=hit["metadata"],
                ))
        except Exception:
            pass

        # Graph search: find relevant topics and their context
        try:
            graph_hits = await self.neo4j.execute_query(
                "CALL db.index.fulltext.queryNodes('entity_search', $query) "
                "YIELD node, score "
                "MATCH (node)-[:MENTIONS]->(t:Topic) "
                "RETURN t.name AS topic, t.category AS category, t.totalScore AS totalScore, score "
                "ORDER BY score DESC LIMIT $k",
                query=query, k=k,
            )
            for hit in graph_hits:
                text = f"话题: {hit['topic']} | 分类: {hit['category']} | 分数: {hit['totalScore']}"
                results.append(RetrievedChunk(
                    text=text,
                    source="graph",
                    score=float(hit.get("score", 0.5)),
                    metadata={"topic": hit["topic"], "category": hit["category"]},
                ))
        except Exception:
            pass

        # Sort by score, deduplicate by text prefix
        results.sort(key=lambda r: r.score, reverse=True)
        seen = set()
        unique = []
        for r in results:
            key = r.text[:60]
            if key not in seen:
                seen.add(key)
                unique.append(r)

        return unique[:k * 2]  # return more results from hybrid
```

- [ ] **Step 4: Write test `rag/tests/test_retriever.py`**

```python
"""Tests for retrieval layer."""

from rag.retriever.vector_store import VectorStore
from rag.retriever.hybrid import HybridRetriever, RetrievedChunk


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
```

- [ ] **Step 5: Run tests and commit**

```bash
pytest rag/tests/test_retriever.py -v
python -m py_compile rag/retriever/vector_store.py
python -m py_compile rag/retriever/hybrid.py
git add rag/retriever/ rag/tests/test_retriever.py
git commit -m "feat(rag): ChromaDB vector store and hybrid retriever"
```

---

## Task 5: Agent — LangGraph ReAct agent with 4 tools

**Files:**
- Create: `rag/agent/__init__.py`
- Create: `rag/agent/prompts.py`
- Create: `rag/agent/tools.py`
- Create: `rag/agent/agent.py`

- [ ] **Step 1: Create `rag/agent/__init__.py`**

```python
"""Agent layer — LangGraph ReAct agent with RAG tools."""
```

- [ ] **Step 2: Create `rag/agent/prompts.py`**

```python
"""Agent system prompts."""

SYSTEM_PROMPT_ZH = """你是 AI Topic Radar 的智能选题助手。你的知识库来自每日生成的 AI 选题池和各类数据源报告。

## 你的工具
1. **graph_search** — 在 Neo4j 知识图谱中查询话题关系、实体网络
2. **vector_search** — 在所有日报/周报中按语义相似度搜索相关内容
3. **trend_analysis** — 分析某个话题在不同日期的分数变化趋势
4. **topic_recommend** — 基于评分和趋势推荐值得深挖的选题

## 回答规范
- 用中文回答（除非用户用英文提问）
- 引用具体的数据来源和日期
- 如果知识库中没有相关信息，坦诚告知
- 适当使用 markdown 格式
- 重点突出，简洁有力
"""

SYSTEM_PROMPT_EN = """You are an AI Topic Radar assistant. Your knowledge base comes from daily AI topic pools and data source reports.

## Your Tools
1. **graph_search** — Query Neo4j knowledge graph for topic relationships and entity networks
2. **vector_search** — Semantic search across all daily/weekly/monthly reports
3. **trend_analysis** — Analyze topic score changes over time
4. **topic_recommend** — Recommend topics worth deep-diving based on scores and trends

## Response Guidelines
- Answer in the user's language
- Cite specific data sources and dates
- Be honest when information is not available
- Use markdown formatting
- Be concise and focused
"""
```

- [ ] **Step 3: Create `rag/agent/tools.py`**

```python
"""Agent tool definitions for LangGraph ReAct agent."""

from __future__ import annotations

from langchain_core.tools import tool

from rag.graphrag.driver import Neo4jDriver
from rag.retriever.vector_store import VectorStore


def create_tools(neo4j_driver: Neo4jDriver, vector_store: VectorStore):
    """Create tool instances bound to the given drivers."""

    @tool
    async def graph_search(query: str) -> str:
        """Search the Neo4j knowledge graph for topics, entities, and their relationships.
        Use this for questions about topic connections, entity networks, or cross-topic analysis.
        Input: search query describing what to find."""
        try:
            results = await neo4j_driver.execute_query(
                "CALL db.index.fulltext.queryNodes('entity_search', $query) "
                "YIELD node, score "
                "MATCH (node)-[:MENTIONS]->(t:Topic) "
                "OPTIONAL MATCH (t)-[r:APPEARED_ON]->(d:DailyDigest) "
                "RETURN t.name AS topic, t.category AS category, t.totalScore AS score, "
                "t.mentionCount AS mentions, d.date AS lastDate, score AS relevance "
                "ORDER BY score DESC LIMIT 10",
                query=query,
            )
            if not results:
                return f"在知识图谱中没有找到与 '{query}' 相关的内容。"
            lines = [f"- **{r['topic']}** | 分类: {r['category']} | 分数: {r['score']} | 出现次数: {r['mentions']}"
                     for r in results]
            return "知识图谱搜索结果：\n" + "\n".join(lines)
        except Exception as e:
            return f"图搜索失败: {e}"

    @tool
    async def vector_search(query: str) -> str:
        """Search all digest reports by semantic similarity.
        Use this for finding relevant passages, articles, or discussions across all reports.
        Input: natural language search query."""
        try:
            results = vector_store.search(query, k=5)
            if not results:
                return f"在报告中没有找到与 '{query}' 相关的内容。"
            lines = []
            for r in results:
                meta = r.get("metadata", {})
                date = meta.get("date", "unknown")
                source = meta.get("source", "unknown")
                lines.append(f"- [{date}/{source}] {r['text'][:200]}")
            return "语义搜索结果：\n" + "\n".join(lines)
        except Exception as e:
            return f"向量搜索失败: {e}"

    @tool
    async def trend_analysis(topic: str, days: int = 30) -> str:
        """Analyze the trend trajectory of a specific topic over time.
        Shows daily scores, trend direction, and key events.
        Input: topic name, optional number of days to look back."""
        try:
            results = await neo4j_driver.execute_query(
                "MATCH (t:Topic {id: $topic_id})-[r:APPEARED_ON]->(d:DailyDigest) "
                "WHERE d.date >= date() - duration({days: $days}) "
                "RETURN d.date AS date, r.score AS score, r.action AS action "
                "ORDER BY d.date",
                topic_id=topic.lower().strip(), days=days,
            )
            if not results:
                return f"话题 '{topic}' 在最近 {days} 天内没有出现记录。"
            scores = [(r["date"], r["score"]) for r in results]
            trend = "上升" if len(scores) > 1 and scores[-1][1] > scores[0][1] else "平稳" if len(scores) > 1 else "新出现"
            lines = [f"- {r['date']}: 分数 {r['score']} ({r['action']})" for r in results]
            return f"**{topic}** 趋势分析（最近 {days} 天，共 {len(results)} 次出现，趋势: {trend}）：\n" + "\n".join(lines)
        except Exception as e:
            return f"趋势分析失败: {e}"

    @tool
    async def topic_recommend(category: str = "") -> str:
        """Recommend topics worth deep-diving based on scores and trends.
        Optionally filter by category.
        Input: optional category name (e.g. '模型与技术突破', 'AI 产品与用户入口')."""
        try:
            if category:
                results = await neo4j_driver.execute_query(
                    "MATCH (t:Topic)-[r:APPEARED_ON]->(d:DailyDigest) "
                    "WHERE t.category CONTAINS $cat "
                    "WITH t, MAX(r.score) AS maxScore, COUNT(r) AS freq "
                    "RETURN t.name AS topic, t.category AS category, maxScore, freq "
                    "ORDER BY maxScore DESC LIMIT 10",
                    cat=category,
                )
            else:
                results = await neo4j_driver.execute_query(
                    "MATCH (t:Topic)-[r:APPEARED_ON]->(d:DailyDigest) "
                    "WITH t, MAX(r.score) AS maxScore, COUNT(r) AS freq "
                    "RETURN t.name AS topic, t.category AS category, maxScore, freq "
                    "ORDER BY maxScore DESC LIMIT 10",
                )
            if not results:
                return "暂无选题推荐数据。"
            lines = [f"- **{r['topic']}** | 最高分: {r['maxScore']} | 出现 {r['freq']} 次 | {r['category']}"
                     for r in results]
            return "推荐选题（按热度排序）：\n" + "\n".join(lines)
        except Exception as e:
            return f"选题推荐失败: {e}"

    return [graph_search, vector_search, trend_analysis, topic_recommend]
```

- [ ] **Step 4: Create `rag/agent/agent.py`**

```python
"""LangGraph ReAct agent for AI Topic Radar."""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from rag.config import LLM_PROVIDER, get_llm_api_key, ANTHROPIC_BASE_URL, DEEPSEEK_MODEL
from rag.agent.prompts import SYSTEM_PROMPT_ZH
from rag.agent.tools import create_tools


def create_agent(neo4j_driver, vector_store):
    """Create a LangGraph ReAct agent with RAG tools."""
    tools = create_tools(neo4j_driver, vector_store)

    # Select LLM based on provider config
    api_key = get_llm_api_key()
    provider = LLM_PROVIDER.lower()

    if provider == "anthropic":
        kwargs = {"model": "claude-sonnet-4-20250514", "api_key": api_key}
        if ANTHROPIC_BASE_URL:
            kwargs["base_url"] = ANTHROPIC_BASE_URL
        llm = ChatAnthropic(**kwargs)
    elif provider == "deepseek":
        llm = ChatOpenAI(
            model=DEEPSEEK_MODEL,
            api_key=api_key,
            base_url="https://api.deepseek.com/v1",
        )
    else:  # openai or fallback
        llm = ChatOpenAI(model="gpt-4o", api_key=api_key)

    agent = create_react_agent(
        model=llm,
        tools=tools,
        prompt=SYSTEM_PROMPT_ZH,
    )
    return agent
```

- [ ] **Step 5: Write test `rag/tests/test_agent.py`**

```python
"""Tests for agent module."""

import pytest
from rag.agent.tools import create_tools
from rag.agent.agent import create_agent


def test_create_tools_returns_four():
    """create_tools returns exactly 4 tools."""
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
```

- [ ] **Step 6: Run syntax check and commit**

```bash
python -m py_compile rag/agent/__init__.py
python -m py_compile rag/agent/prompts.py
python -m py_compile rag/agent/tools.py
python -m py_compile rag/agent/agent.py
pytest rag/tests/test_agent.py -v
git add rag/agent/ rag/tests/test_agent.py
git commit -m "feat(rag): LangGraph ReAct agent with 4 RAG tools"
```

---

## Task 6: FastAPI Server + Chat UI + Config Page

**Files:**
- Create: `rag/server.py`
- Create: `rag/web/__init__.py`
- Create: `rag/web/chat.html`

- [ ] **Step 1: Create `rag/web/__init__.py`**

```python
"""Web UI assets for the RAG chat interface."""
```

- [ ] **Step 2: Create `rag/web/chat.html`**

Single HTML file containing:
- **Config page** (shown when API key not configured): Provider select dropdown, API key password input, Neo4j URI/user/password inputs, "Save & Start" button. POST to `/config` endpoint.
- **Chat panel** (right-side sliding, 380px): Message list with markdown rendering, input box + send button, citation links.
- **Toggle button** integration for the header.
- Uses `marked.js` from CDN for markdown rendering.
- Vanilla JS, no frameworks.

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Topic Radar - Agent</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    :root {
      --bg: #0B0D14; --bg-side: #080A10; --bg-hover: #12151F;
      --border: #1E2235; --text: #C9D1D9; --muted: #636E82;
      --accent: #E8A03D; --accent-bg: rgba(232,160,61,0.10);
      --chat-bg: #0D1017; --user-bg: #1A2332; --bot-bg: #141925;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; }

    /* Config page */
    #config-page { display: flex; align-items: center; justify-content: center; height: 100vh; }
    .config-card { background: var(--bg-side); border: 1px solid var(--border); border-radius: 12px; padding: 32px; width: 420px; }
    .config-card h2 { font-size: 18px; margin-bottom: 20px; color: var(--accent); }
    .config-card label { display: block; font-size: 12px; color: var(--muted); margin: 12px 0 4px; }
    .config-card select, .config-card input { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px; }
    .config-card button { width: 100%; padding: 10px; margin-top: 20px; background: var(--accent); color: #000; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .config-card .status { margin-top: 12px; font-size: 12px; color: var(--muted); }

    /* Chat page */
    #chat-page { display: none; height: 100vh; flex-direction: column; }
    #chat-header { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 44px; background: var(--bg-side); border-bottom: 1px solid var(--border); }
    #chat-header h3 { font-size: 13px; }
    #chat-messages { flex: 1; overflow-y: auto; padding: 16px; }
    .msg { margin-bottom: 12px; max-width: 90%; }
    .msg.user { margin-left: auto; background: var(--user-bg); border-radius: 12px 12px 4px 12px; padding: 10px 14px; }
    .msg.bot { background: var(--bot-bg); border-radius: 12px 12px 12px 4px; padding: 10px 14px; }
    .msg .citation { font-size: 11px; color: var(--accent); cursor: pointer; margin-top: 6px; }
    #chat-input-area { display: flex; gap: 8px; padding: 12px; background: var(--bg-side); border-top: 1px solid var(--border); }
    #chat-input { flex: 1; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 14px; resize: none; }
    #chat-send { padding: 8px 16px; background: var(--accent); color: #000; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
    .loading { color: var(--muted); font-size: 12px; padding: 4px 0; }
  </style>
</head>
<body>
  <!-- Config Page -->
  <div id="config-page">
    <div class="config-card">
      <h2>AI Topic Radar Agent - 首次配置</h2>
      <label>LLM Provider</label>
      <select id="cfg-provider">
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI (GPT)</option>
        <option value="deepseek">DeepSeek</option>
      </select>
      <label>API Key</label>
      <input type="password" id="cfg-apikey" placeholder="sk-...">
      <label>Neo4j URI</label>
      <input type="text" id="cfg-neo4j" value="bolt://localhost:7687" placeholder="bolt://localhost:7687">
      <label>Neo4j Password</label>
      <input type="password" id="cfg-neo4j-pw" value="password">
      <button onclick="saveConfig()">保存并启动</button>
      <div class="status" id="config-status"></div>
    </div>
  </div>

  <!-- Chat Page -->
  <div id="chat-page">
    <div id="chat-header">
      <h3>AI Agent</h3>
      <span style="font-size:11px;color:var(--muted)">powered by LangGraph + Neo4j</span>
    </div>
    <div id="chat-messages"></div>
    <div id="chat-input-area">
      <textarea id="chat-input" rows="1" placeholder="输入你的问题..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}"></textarea>
      <button id="chat-send" onclick="sendMessage()">发送</button>
    </div>
  </div>

  <script>
    const chatHistory = [];

    // Check config status on load
    fetch('/health').then(r => r.json()).then(d => {
      if (d.configured) showChat(); else showConfig();
    }).catch(() => showConfig());

    function showConfig() { document.getElementById('config-page').style.display = 'flex'; document.getElementById('chat-page').style.display = 'none'; }
    function showChat() { document.getElementById('config-page').style.display = 'none'; document.getElementById('chat-page').style.display = 'flex'; }

    async function saveConfig() {
      const data = {
        provider: document.getElementById('cfg-provider').value,
        api_key: document.getElementById('cfg-apikey').value,
        neo4j_uri: document.getElementById('cfg-neo4j').value,
        neo4j_password: document.getElementById('cfg-neo4j-pw').value,
      };
      document.getElementById('config-status').textContent = '保存中...';
      try {
        const res = await fetch('/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
        const result = await res.json();
        if (result.status === 'ok') {
          document.getElementById('config-status').textContent = '配置已保存，正在重启...';
          setTimeout(() => location.reload(), 2000);
        } else {
          document.getElementById('config-status').textContent = '错误: ' + (result.error || 'unknown');
        }
      } catch(e) {
        document.getElementById('config-status').textContent = '连接失败: ' + e.message;
      }
    }

    async function sendMessage() {
      const input = document.getElementById('chat-input');
      const message = input.value.trim();
      if (!message) return;
      input.value = '';

      appendMessage('user', message);
      chatHistory.push({role: 'user', content: message});

      const loadingEl = appendLoading();

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({message, history: chatHistory.slice(-10)}),
        });
        const data = await res.json();
        loadingEl.remove();

        if (data.error) {
          appendMessage('bot', '错误: ' + data.error);
        } else {
          appendMessage('bot', data.answer, data.citations);
          chatHistory.push({role: 'assistant', content: data.answer});
        }
      } catch(e) {
        loadingEl.remove();
        appendMessage('bot', '请求失败: ' + e.message);
      }
    }

    function appendMessage(role, content, citations) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.innerHTML = marked.parse(content);
      if (citations && citations.length) {
        const citDiv = document.createElement('div');
        citDiv.className = 'citation';
        citDiv.textContent = `引用: ${citations.map(c => c.date + '/' + c.source).join(', ')}`;
        div.appendChild(citDiv);
      }
      document.getElementById('chat-messages').appendChild(div);
      document.getElementById('chat-messages').scrollTop = 99999;
      return div;
    }

    function appendLoading() {
      const div = document.createElement('div');
      div.className = 'msg bot loading';
      div.textContent = '思考中...';
      document.getElementById('chat-messages').appendChild(div);
      document.getElementById('chat-messages').scrollTop = 99999;
      return div;
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Create `rag/server.py`**

```python
"""FastAPI server — serves Chat UI and provides /chat, /config, /health endpoints."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel

from rag.config import (
    NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD,
    CHROMA_DIR, RAG_HOST, RAG_PORT, is_configured,
    LLM_PROVIDER, get_llm_api_key,
)
from rag.graphrag.driver import Neo4jDriver
from rag.graphrag.schema import init_schema
from rag.retriever.vector_store import VectorStore
from rag.agent.agent import create_agent


# --- Models ---

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []

class ChatResponse(BaseModel):
    answer: str
    citations: list[dict] = []

class ConfigRequest(BaseModel):
    provider: str
    api_key: str
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_password: str = "password"

# --- App lifecycle ---

neo4j_driver: Neo4jDriver | None = None
vector_store: VectorStore | None = None
agent = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global neo4j_driver, vector_store, agent

    if is_configured():
        neo4j_driver = Neo4jDriver(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
        try:
            await neo4j_driver.connect()
            await init_schema(neo4j_driver)
        except Exception as e:
            print(f"[server] Neo4j connection failed: {e}")
            neo4j_driver = None

        vector_store = VectorStore(CHROMA_DIR)

        if neo4j_driver:
            try:
                agent = create_agent(neo4j_driver, vector_store)
            except Exception as e:
                print(f"[server] Agent creation failed: {e}")

    yield

    if neo4j_driver:
        await neo4j_driver.close()


app = FastAPI(title="AI Topic Radar RAG", version="0.1.0", lifespan=lifespan)


# --- Endpoints ---

CHAT_HTML = Path(__file__).parent / "web" / "chat.html"


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the chat UI."""
    return FileResponse(str(CHAT_HTML), media_type="text/html")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "configured": is_configured(),
        "neo4j_connected": neo4j_driver is not None,
        "provider": LLM_PROVIDER,
    }


@app.post("/config")
async def save_config(req: ConfigRequest):
    """Save API configuration to .env file."""
    env_path = Path(__file__).parent.parent / ".env"
    lines = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    # Update or add config values
    updates = {
        "LLM_PROVIDER": req.provider,
        "ANTHROPIC_API_KEY": req.api_key if req.provider == "anthropic" else "",
        "OPENAI_API_KEY": req.api_key if req.provider == "openai" else "",
        "DEEPSEEK_API_KEY": req.api_key if req.provider == "deepseek" else "",
        "NEO4J_URI": req.neo4j_uri,
        "NEO4J_PASSWORD": req.neo4j_password,
    }

    updated_keys = set()
    new_lines = []
    for line in lines:
        if "=" in line and not line.strip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                updated_keys.add(key)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    for key, val in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={val}")

    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    return {"status": "ok", "message": "Configuration saved. Please restart the server."}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Chat endpoint — uses LangGraph agent with RAG tools."""
    if not agent:
        raise HTTPException(status_code=503, detail="Agent not initialized. Check configuration and Neo4j connection.")

    try:
        history = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in req.history]
        messages = history + [{"role": "user", "content": req.message}]

        result = await agent.ainvoke({"messages": messages})

        # Extract the last AI message
        ai_messages = [m for m in result["messages"] if m.type == "ai"]
        answer = ai_messages[-1].content if ai_messages else "No response generated."

        return ChatResponse(answer=answer, citations=[])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest")
async def trigger_ingest():
    """Trigger data ingestion into Neo4j + ChromaDB."""
    from rag.ingest import run_ingestion
    try:
        count = await run_ingestion()
        return {"status": "ok", "dates_ingested": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=RAG_HOST, port=RAG_PORT)
```

- [ ] **Step 4: Run syntax check and commit**

```bash
python -m py_compile rag/server.py
python -m py_compile rag/web/__init__.py
python -m py_compile rag/ingest.py
python -m py_compile rag/agent/agent.py
git add rag/server.py rag/web/ rag/ingest.py
git commit -m "feat(rag): FastAPI server with Chat UI, config page, and /chat endpoint"
```

---

## Task 7: Integration — TS pipeline triggers RAG + full E2E test

**Files:**
- Modify: `src/index.ts` (add RAG trigger after digest)
- Modify: `CLAUDE.md` (update RAG documentation)

- [ ] **Step 1: Add RAG trigger to `src/index.ts`**

At the end of the `main()` function, before the final `console.log("Done!")`, add:

```typescript
  // 8. Trigger RAG ingestion if configured
  const ragUrl = process.env["RAG_API_URL"];
  if (ragUrl) {
    try {
      console.log(`  [rag] Triggering ingestion at ${ragUrl}...`);
      const ragRes = await fetch(`${ragUrl}/ingest`, { method: "POST" });
      const ragData = (await ragRes.json()) as { dates_ingested?: number };
      console.log(`  [rag] Ingestion complete: ${ragData.dates_ingested ?? 0} dates`);
    } catch (err) {
      console.error(`  [rag] Ingestion trigger failed: ${err}`);
    }
  }
```

- [ ] **Step 2: Run typecheck and tests**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(rag): trigger RAG ingestion after digest pipeline"
```

- [ ] **Step 4: E2E verification**

```bash
# Terminal 1: Start Neo4j
docker compose up -d

# Terminal 2: Ingest data
python -m rag.ingest

# Terminal 3: Start RAG server
python -m rag.server

# Browser: Open http://localhost:8001
# If config page shows, fill in API key
# Test chat: "最近有什么热门趋势？"
```

- [ ] **Step 5: Final commit with all changes**

```bash
git add -A
git status
git commit -m "feat: Agentic RAG + Graph RAG system with Chat UI"
```

---

## Self-Review Checklist

- [ ] All spec requirements covered: Chat UI, Neo4j graph, ChromaDB vector, 4 tools, UI config, docker-compose, pnpm scripts
- [ ] No TBD/TODO placeholders in any task
- [ ] Types consistent across tasks (Neo4jDriver, VectorStore, ChatRequest, etc.)
- [ ] All file paths are exact
- [ ] All code blocks are complete (no "implement this" without showing how)
- [ ] Tests are written for each task
- [ ] Each task ends with a commit
