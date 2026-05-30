"""LangGraph ReAct agent for AI Topic Radar."""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from rag.config import LLM_PROVIDER, get_llm_api_key, ANTHROPIC_BASE_URL, DEEPSEEK_MODEL
from rag.agent.prompts import SYSTEM_PROMPT_ZH
from rag.agent.tools import create_tools


def create_agent(neo4j_driver, hybrid_retriever):
    """Create a LangGraph ReAct agent with 6 RAG tools."""
    tools = create_tools(neo4j_driver, hybrid_retriever)

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
    else:
        llm = ChatOpenAI(model="gpt-4o", api_key=api_key)

    agent = create_react_agent(
        model=llm,
        tools=tools,
        prompt=SYSTEM_PROMPT_ZH,
    )
    return agent
