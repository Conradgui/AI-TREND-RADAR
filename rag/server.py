"""FastAPI server — serves Chat UI and provides /chat, /config, /health endpoints."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from rag.config import (
    NEO4J_URI,
    NEO4J_USER,
    NEO4J_PASSWORD,
    CHROMA_DIR,
    RAG_HOST,
    RAG_PORT,
    is_configured,
    LLM_PROVIDER,
)
from rag.graphrag.driver import Neo4jDriver
from rag.graphrag.schema import init_schema
from rag.retriever.vector_store import VectorStore
from rag.retriever.hybrid import HybridRetriever
from rag.agent.agent import create_agent


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2000)
    history: list[dict] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    citations: list[dict] = Field(default_factory=list)


class ConfigRequest(BaseModel):
    provider: str
    api_key: str
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_password: str = "password"


neo4j_driver: Neo4jDriver | None = None
vector_store: VectorStore | None = None
agent = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global neo4j_driver, vector_store, agent

    vector_store = VectorStore(CHROMA_DIR)

    if is_configured():
        neo4j_driver = Neo4jDriver(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
        try:
            await neo4j_driver.connect()
            await init_schema(neo4j_driver)
            print("[server] Neo4j connected")
        except Exception as e:
            print(f"[server] Neo4j connection failed: {e}")
            neo4j_driver = None

        try:
            hybrid = HybridRetriever(vector_store, neo4j_driver) if neo4j_driver else None
            if hybrid:
                agent = create_agent(neo4j_driver, hybrid)
                print("[server] Agent initialized with 6 tools")
            else:
                print("[server] Neo4j unavailable, agent disabled")
        except Exception as e:
            print(f"[server] Agent creation failed: {e}")

    yield

    if neo4j_driver:
        await neo4j_driver.close()


app = FastAPI(title="AI Topic Radar RAG", version="0.2.0", lifespan=lifespan)

CHAT_HTML = Path(__file__).parent / "web" / "chat.html"


@app.get("/", response_class=__import__("fastapi.responses", fromlist=["HTMLResponse"]).HTMLResponse)
async def index():
    if not CHAT_HTML.exists():
        raise HTTPException(status_code=500, detail="Chat UI not found")
    return FileResponse(str(CHAT_HTML), media_type="text/html")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "configured": is_configured(),
        "neo4j_connected": neo4j_driver is not None,
        "chromadb_chunks": vector_store.count() if vector_store else 0,
        "provider": LLM_PROVIDER,
    }


@app.post("/config")
async def save_config(req: ConfigRequest):
    env_path = Path(__file__).parent.parent / ".env"
    try:
        lines = []
        if env_path.exists():
            lines = env_path.read_text(encoding="utf-8").splitlines()

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
    except Exception:
        return {"status": "error", "message": "Failed to save configuration"}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not agent:
        raise HTTPException(
            status_code=503,
            detail="Agent not initialized. Check Neo4j connection and API key configuration.",
        )

    try:
        history = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in req.history]
        messages = history + [{"role": "user", "content": req.message}]

        result = await agent.ainvoke({"messages": messages})

        ai_messages = [m for m in result["messages"] if m.type == "ai"]
        answer = ai_messages[-1].content if ai_messages else "No response generated."

        return ChatResponse(answer=answer, citations=[])
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal error occurred")


@app.post("/ingest")
async def trigger_ingest():
    from rag.ingest import run_ingestion

    try:
        count = await run_ingestion()
        return {"status": "ok", "dates_ingested": count}
    except Exception:
        return {"status": "error", "message": "Ingestion failed"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=RAG_HOST, port=RAG_PORT)
