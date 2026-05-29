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
