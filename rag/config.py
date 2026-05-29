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
