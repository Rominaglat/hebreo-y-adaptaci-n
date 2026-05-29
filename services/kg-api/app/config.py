"""Environment config + Neo4j connection driver lifecycle."""
from __future__ import annotations

import os
import secrets
from contextlib import asynccontextmanager
from typing import AsyncIterator

from neo4j import AsyncDriver, AsyncGraphDatabase

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
NEO4J_DATABASE = os.environ.get("NEO4J_DATABASE", "neo4j")

# Bearer token clients must present in `Authorization: Bearer <token>`.
KG_API_TOKEN = os.environ.get("KG_API_TOKEN", "")

# Webhook secret for backend-only callers (kg-sync, kg-extract). Sent in
# `X-Webhook-Secret`. Optional; some endpoints accept either bearer or webhook.
KG_WEBHOOK_SECRET = os.environ.get("KG_WEBHOOK_SECRET", "")


def assert_required():
    missing = []
    if not NEO4J_PASSWORD:
        missing.append("NEO4J_PASSWORD")
    if not KG_API_TOKEN:
        missing.append("KG_API_TOKEN")
    if missing:
        raise RuntimeError(f"missing required env: {', '.join(missing)}")


_driver: AsyncDriver | None = None


def get_driver() -> AsyncDriver:
    """Return the process-wide async Neo4j driver. Created lazily on first call."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
            max_connection_pool_size=20,
            connection_timeout=10,
        )
    return _driver


async def close_driver():
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


@asynccontextmanager
async def session(database: str | None = None) -> AsyncIterator:
    """Yield a Neo4j async session against the requested database (or the
    default DB if None)."""
    driver = get_driver()
    db = database or NEO4J_DATABASE
    async with driver.session(database=db) as s:
        yield s


def constant_time_eq(a: str, b: str) -> bool:
    """Constant-time string comparison to avoid timing leaks on token checks."""
    if not a or not b:
        return False
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
