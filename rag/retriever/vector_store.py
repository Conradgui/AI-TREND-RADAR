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
        if not results.get("ids") or not results["ids"][0]:
            return []
        items = []
        for i in range(len(results["ids"][0])):
            items.append(
                {
                    "text": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "distance": results["distances"][0][i] if results.get("distances") else None,
                }
            )
        return items

    def count(self) -> int:
        """Return total number of chunks in the collection."""
        return self.collection.count()

    def delete_by_date(self, date: str) -> None:
        """Delete all chunks for a specific date (for re-ingestion)."""
        self.collection.delete(where={"date": date})
