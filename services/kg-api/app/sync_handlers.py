"""Cypher write handlers for every sync endpoint. Each upsert is a single
MERGE so the operation is idempotent — kg-sync replays the same payload on
restart without duplicating data."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from neo4j import AsyncSession


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def norm_concept(name: str) -> str:
    """Entity-resolution key for Concept nodes: lowercase + collapsed whitespace."""
    return re.sub(r"\s+", " ", (name or "").strip().lower())


async def upsert_tenant(s: AsyncSession, tenant_id: str, name: str | None, slug: str | None) -> None:
    await s.run(
        """
        MERGE (t:Tenant {id: $tenant_id})
        SET t.name = coalesce($name, t.name),
            t.slug = coalesce($slug, t.slug),
            t.synced_at = $synced_at
        """,
        tenant_id=tenant_id, name=name, slug=slug, synced_at=now_iso(),
    )


async def upsert_course(s: AsyncSession, p: dict[str, Any]) -> None:
    await s.run(
        """
        MATCH (t:Tenant {id: $tenant_id})
        MERGE (c:Course {id: $id})
        SET c.tenant_id     = $tenant_id,
            c.title         = $title,
            c.description   = $description,
            c.instructor_id = $instructor_id,
            c.is_published  = $is_published,
            c.order_index   = $order_index,
            c.thumbnail_url = $thumbnail_url,
            c.synced_at     = $synced_at
        MERGE (t)-[:OWNS]->(c)
        """,
        synced_at=now_iso(),
        **p,
    )


async def upsert_module(s: AsyncSession, p: dict[str, Any]) -> None:
    await s.run(
        """
        MATCH (c:Course {id: $course_id})
        MERGE (m:Module {id: $id})
        SET m.tenant_id   = $tenant_id,
            m.course_id   = $course_id,
            m.title       = $title,
            m.description = $description,
            m.order_index = $order_index,
            m.synced_at   = $synced_at
        MERGE (c)-[:HAS_MODULE]->(m)
        """,
        synced_at=now_iso(),
        **p,
    )


async def upsert_lesson(s: AsyncSession, p: dict[str, Any]) -> None:
    await s.run(
        """
        MATCH (m:Module {id: $module_id})
        MERGE (l:Lesson {id: $id})
        SET l.tenant_id        = $tenant_id,
            l.module_id        = $module_id,
            l.course_id        = $course_id,
            l.title            = $title,
            l.content_text     = $content_text,
            l.lesson_type      = $lesson_type,
            l.video_url        = $video_url,
            l.file_url         = $file_url,
            l.resources_url    = $resources_url,
            l.embed_url        = $embed_url,
            l.duration_minutes = $duration_minutes,
            l.order_index      = $order_index,
            l.synced_at        = $synced_at
        MERGE (m)-[:HAS_LESSON]->(l)
        """,
        synced_at=now_iso(),
        **p,
    )


async def set_lesson_embedding(s: AsyncSession, tenant_id: str, lesson_id: str, embedding: list[float]) -> None:
    await s.run(
        """
        MATCH (l:Lesson {id: $lesson_id, tenant_id: $tenant_id})
        CALL db.create.setNodeVectorProperty(l, 'embedding', $embedding)
        SET l.embedded_at = $embedded_at
        """,
        lesson_id=lesson_id, tenant_id=tenant_id, embedding=embedding, embedded_at=now_iso(),
    )


async def replace_lesson_concepts(
    s: AsyncSession,
    tenant_id: str,
    lesson_id: str,
    concepts: list[dict[str, Any]],
) -> None:
    # Drop the existing edges first so the set is replaced atomically.
    await s.run(
        """
        MATCH (l:Lesson {id: $lesson_id, tenant_id: $tenant_id})-[r:MENTIONS]->()
        DELETE r
        """,
        lesson_id=lesson_id, tenant_id=tenant_id,
    )
    if not concepts:
        return
    # Then create/merge each concept by its normalized form and link.
    payload = [
        {
            "name": c["name"],
            "norm_name": norm_concept(c["name"]),
            "confidence": float(c.get("confidence", 1.0)),
        }
        for c in concepts
        if c.get("name") and norm_concept(c["name"])
    ]
    if not payload:
        return
    await s.run(
        """
        MATCH (l:Lesson {id: $lesson_id, tenant_id: $tenant_id})
        UNWIND $items AS item
        MERGE (c:Concept {norm_name: item.norm_name})
          ON CREATE SET c.id = randomUUID(),
                        c.name = item.name,
                        c.created_at = $now
          ON MATCH  SET c.name = coalesce(c.name, item.name)
        MERGE (l)-[r:MENTIONS]->(c)
        SET r.confidence = item.confidence,
            r.created_at = $now
        """,
        lesson_id=lesson_id, tenant_id=tenant_id, items=payload, now=now_iso(),
    )


async def cascade_delete(s: AsyncSession, tenant_id: str, kind: str, id_: str) -> None:
    label = {"tenant": "Tenant", "course": "Course", "module": "Module", "lesson": "Lesson"}.get(kind)
    if not label:
        raise ValueError(f"unknown kind: {kind}")

    if label == "Tenant":
        await s.run(
            """
            MATCH (t:Tenant {id: $id})
            OPTIONAL MATCH (t)-[:OWNS]->(c:Course)-[:HAS_MODULE*0..]->(m:Module)
            OPTIONAL MATCH (m)-[:HAS_LESSON]->(l:Lesson)
            DETACH DELETE t, c, m, l
            """,
            id=id_,
        )
    elif label == "Course":
        await s.run(
            """
            MATCH (c:Course {id: $id, tenant_id: $tenant_id})
            OPTIONAL MATCH (c)-[:HAS_MODULE]->(m:Module)
            OPTIONAL MATCH (m)-[:HAS_LESSON]->(l:Lesson)
            DETACH DELETE c, m, l
            """,
            id=id_, tenant_id=tenant_id,
        )
    elif label == "Module":
        await s.run(
            """
            MATCH (m:Module {id: $id, tenant_id: $tenant_id})
            OPTIONAL MATCH (m)-[:HAS_LESSON]->(l:Lesson)
            DETACH DELETE m, l
            """,
            id=id_, tenant_id=tenant_id,
        )
    else:  # Lesson
        await s.run(
            "MATCH (l:Lesson {id: $id, tenant_id: $tenant_id}) DETACH DELETE l",
            id=id_, tenant_id=tenant_id,
        )
