"""CLI entry point: python -m rag.ingest — ingests digest data into Neo4j + ChromaDB."""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from rag.config import DIGESTS_DIR, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from rag.graphrag.driver import Neo4jDriver
from rag.graphrag.schema import init_schema
from rag.graphrag.builder import KnowledgeGraphBuilder

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _find_digest_dates() -> list[str]:
    digests = Path(DIGESTS_DIR)
    if not digests.exists():
        return []
    return sorted(d.name for d in digests.iterdir() if d.is_dir() and DATE_PATTERN.match(d.name))


def _load_topic_pool(date_dir: Path) -> dict | None:
    pool_path = date_dir / "topic-pool.json"
    if not pool_path.exists():
        return None
    try:
        return json.loads(pool_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_reports(date_dir: Path) -> dict[str, str]:
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
