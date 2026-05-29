"""Neo4j schema bootstrap — constraints, range indexes, vector index,
fulltext index. Idempotent: safe to run on every startup.

The graph is single-instance: one Neo4j database holds every tenant, scoped
by the `tenant_id` property on Course / Module / Lesson / Concept. Constraints
keep Tenant.id, Course.id etc. globally unique."""
from __future__ import annotations

from .config import session

VECTOR_INDEX_NAME = "lesson_embeddings"
VECTOR_DIM = 1024  # gemini-embedding-001 truncated to 1024 dims
VECTOR_SIMILARITY = "cosine"

FULLTEXT_INDEX_NAME = "content_search"

CONSTRAINTS = [
    "CREATE CONSTRAINT tenant_id_unique IF NOT EXISTS FOR (n:Tenant) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT course_id_unique IF NOT EXISTS FOR (n:Course) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT module_id_unique IF NOT EXISTS FOR (n:Module) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT lesson_id_unique IF NOT EXISTS FOR (n:Lesson) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT concept_norm_unique IF NOT EXISTS FOR (n:Concept) REQUIRE n.norm_name IS UNIQUE",
]

RANGE_INDEXES = [
    "CREATE INDEX course_tenant IF NOT EXISTS FOR (n:Course) ON (n.tenant_id)",
    "CREATE INDEX module_tenant IF NOT EXISTS FOR (n:Module) ON (n.tenant_id)",
    "CREATE INDEX module_course IF NOT EXISTS FOR (n:Module) ON (n.course_id)",
    "CREATE INDEX lesson_tenant IF NOT EXISTS FOR (n:Lesson) ON (n.tenant_id)",
    "CREATE INDEX lesson_module IF NOT EXISTS FOR (n:Lesson) ON (n.module_id)",
    "CREATE INDEX lesson_course IF NOT EXISTS FOR (n:Lesson) ON (n.course_id)",
    "CREATE INDEX concept_name IF NOT EXISTS FOR (n:Concept) ON (n.name)",
]

VECTOR_INDEX_CYPHER = f"""
CREATE VECTOR INDEX {VECTOR_INDEX_NAME} IF NOT EXISTS
FOR (l:Lesson) ON (l.embedding)
OPTIONS {{indexConfig: {{
  `vector.dimensions`: {VECTOR_DIM},
  `vector.similarity_function`: '{VECTOR_SIMILARITY}'
}}}}
"""

FULLTEXT_INDEX_CYPHER = f"""
CREATE FULLTEXT INDEX {FULLTEXT_INDEX_NAME} IF NOT EXISTS
FOR (n:Lesson|Course|Module) ON EACH [n.title, n.description, n.content_text]
"""


async def ensure_schema() -> None:
    """Run every CREATE on startup. All statements are IF NOT EXISTS so this
    is idempotent and cheap."""
    async with session() as s:
        for stmt in CONSTRAINTS + RANGE_INDEXES:
            await s.run(stmt)
        await s.run(VECTOR_INDEX_CYPHER)
        await s.run(FULLTEXT_INDEX_CYPHER)
