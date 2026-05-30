"""CLI entry point: python -m rag.ingest — ingests digest data into Neo4j + ChromaDB."""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from rag.config import DIGESTS_DIR, CHROMA_DIR, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from rag.graphrag.driver import Neo4jDriver
from rag.graphrag.schema import init_schema
from rag.graphrag.builder import KnowledgeGraphBuilder
from rag.retriever.vector_store import VectorStore

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _find_digest_dates() -> list[str]:
    """Return sorted list of YYYY-MM-DD directory names under digests/."""
    digests = Path(DIGESTS_DIR)
    if not digests.exists():
        return []
    return sorted(d.name for d in digests.iterdir() if d.is_dir() and DATE_PATTERN.match(d.name))


def _load_topic_pool(date_dir: Path) -> dict | None:
    """Load and parse topic-pool.json from a digest date directory."""
    pool_path = date_dir / "topic-pool.json"
    if not pool_path.exists():
        return None
    try:
        return json.loads(pool_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_reports(date_dir: Path) -> dict[str, str]:
    """Load all .md reports (excluding English variants and rollups)."""
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


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Split text into chunks by ## headers, then paragraphs, then characters with overlap."""
    if not text or not text.strip():
        return []
    if chunk_size <= overlap:
        raise ValueError("chunk_size must be > overlap")

    chunks: list[str] = []
    # 1. Split by ## headers
    sections = re.split(r"\n(?=##\s)", text)
    for section in sections:
        section = section.strip()
        if not section:
            continue
        if len(section) <= chunk_size:
            chunks.append(section)
        else:
            # 2. Split by paragraphs
            paragraphs = section.split("\n\n")
            current = ""
            for para in paragraphs:
                if len(current) + len(para) + 2 <= chunk_size:
                    current = f"{current}\n\n{para}" if current else para
                else:
                    if current:
                        chunks.append(current.strip())
                    # 3. Oversized paragraph: split by character with overlap
                    while len(para) > chunk_size:
                        chunks.append(para[:chunk_size].strip())
                        para = para[chunk_size - overlap :]
                    current = para
            if current:
                chunks.append(current.strip())

    return [c for c in chunks if len(c) > 20]


async def run_ingestion() -> int:
    driver = Neo4jDriver(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    await driver.connect()
    vector_store = VectorStore(CHROMA_DIR)

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

            # Neo4j knowledge graph
            await builder.ingest_date(date_str, topic_pool, reports)

            # ChromaDB vector store
            chunk_count = 0
            for report_type, content in reports.items():
                chunks = chunk_text(content)
                if not chunks:
                    continue
                ids = [f"{date_str}/{report_type}/{i}" for i in range(len(chunks))]
                metadatas = [{"date": date_str, "source": report_type} for _ in chunks]
                try:
                    vector_store.add_chunks(chunks, metadatas, ids)
                    chunk_count += len(chunks)
                except Exception as e:
                    print(f"  [ingest] ChromaDB write failed for {date_str}/{report_type}: {e}")

            print(f"[ingest] {date_str}: ingested ({chunk_count} chunks → ChromaDB)")

        print(f"[ingest] ChromaDB total: {vector_store.count()} chunks")
        return len(dates)
    finally:
        await driver.close()


def main():
    count = asyncio.run(run_ingestion())
    print(f"[ingest] Done. Processed {count} dates.")


if __name__ == "__main__":
    main()
