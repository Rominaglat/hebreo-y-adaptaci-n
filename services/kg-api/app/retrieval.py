"""Vector search + graph expansion + concept-overlap recommendations."""
from __future__ import annotations

from typing import Any

from neo4j import AsyncSession

from .schema import VECTOR_INDEX_NAME


async def vector_query(
    s: AsyncSession,
    tenant_id: str,
    embedding: list[float],
    k: int,
    course_id: str | None,
    expand_via_concepts: bool,
) -> list[dict[str, Any]]:
    # Oversample 5x when a course filter is present so post-filtering still
    # leaves us with a reasonable result count.
    over_k = k * 5 if course_id else k

    cypher = """
    CALL db.index.vector.queryNodes($index_name, $over_k, $embedding)
      YIELD node AS l, score
    WHERE l.tenant_id = $tenant_id
      AND ($course_id IS NULL OR l.course_id = $course_id)
    OPTIONAL MATCH (m:Module {id: l.module_id})
    OPTIONAL MATCH (c:Course {id: l.course_id})
    RETURN l.id AS lesson_id,
           l.title AS lesson_title,
           l.content_text AS content,
           l.module_id AS module_id,
           m.title AS module_title,
           l.course_id AS course_id,
           c.title AS course_title,
           score,
           'vector' AS source
    ORDER BY score DESC
    LIMIT $k
    """
    res = await s.run(
        cypher,
        index_name=VECTOR_INDEX_NAME,
        over_k=over_k,
        embedding=embedding,
        tenant_id=tenant_id,
        course_id=course_id,
        k=k,
    )
    rows: list[dict[str, Any]] = []
    async for record in res:
        rows.append({
            "lesson_id":     record["lesson_id"],
            "lesson_title":  record["lesson_title"],
            "content":       record["content"],
            "module_id":     record["module_id"],
            "module_title":  record["module_title"],
            "course_id":     record["course_id"],
            "course_title":  record["course_title"],
            "score":         float(record["score"]),
            "source":        record["source"],
        })

    if not expand_via_concepts or not rows:
        return rows

    # Graph expansion: pull a few more lessons that share concepts with the
    # top vector hits, deduped against what we already have.
    seed_ids = [r["lesson_id"] for r in rows[: min(5, len(rows))]]
    existing = {r["lesson_id"] for r in rows}
    expansion_k = max(1, k // 2)

    expand_cypher = """
    UNWIND $seed_ids AS sid
    MATCH (seed:Lesson {id: sid, tenant_id: $tenant_id})-[:MENTIONS]->(c:Concept)<-[:MENTIONS]-(l:Lesson)
    WHERE l.tenant_id = $tenant_id
      AND l.id <> sid
      AND NOT l.id IN $existing
      AND ($course_id IS NULL OR l.course_id = $course_id)
    WITH l, count(DISTINCT c) AS shared
    ORDER BY shared DESC
    LIMIT $expansion_k
    OPTIONAL MATCH (m:Module {id: l.module_id})
    OPTIONAL MATCH (course:Course {id: l.course_id})
    RETURN l.id AS lesson_id,
           l.title AS lesson_title,
           l.content_text AS content,
           l.module_id AS module_id,
           m.title AS module_title,
           l.course_id AS course_id,
           course.title AS course_title,
           toFloat(shared) / 10.0 AS score,
           'graph_expansion' AS source
    """
    res2 = await s.run(
        expand_cypher,
        seed_ids=seed_ids,
        tenant_id=tenant_id,
        existing=list(existing),
        course_id=course_id,
        expansion_k=expansion_k,
    )
    async for record in res2:
        rows.append({
            "lesson_id":     record["lesson_id"],
            "lesson_title":  record["lesson_title"],
            "content":       record["content"],
            "module_id":     record["module_id"],
            "module_title":  record["module_title"],
            "course_id":     record["course_id"],
            "course_title":  record["course_title"],
            "score":         float(record["score"]),
            "source":        record["source"],
        })
    return rows


async def recommend_courses(
    s: AsyncSession,
    tenant_id: str,
    seed_course_ids: list[str],
    exclude_course_ids: list[str],
    limit: int,
) -> list[dict[str, Any]]:
    if not seed_course_ids:
        # Fallback: courses with the largest variety of concepts.
        cypher = """
        MATCH (c:Course {tenant_id: $tenant_id})-[:HAS_MODULE]->(:Module)
              -[:HAS_LESSON]->(:Lesson)-[:MENTIONS]->(concept:Concept)
        WHERE NOT c.id IN $exclude
        WITH c, count(DISTINCT concept) AS shared_concepts, count(concept) AS total_mentions
        ORDER BY shared_concepts DESC, total_mentions DESC
        LIMIT $limit
        RETURN c.id AS course_id, c.title AS course_title, c.description AS description,
               c.thumbnail_url AS thumbnail_url, shared_concepts, total_mentions
        """
        res = await s.run(cypher, tenant_id=tenant_id, exclude=exclude_course_ids, limit=limit)
    else:
        cypher = """
        MATCH (seed:Course {tenant_id: $tenant_id})-[:HAS_MODULE]->(:Module)
              -[:HAS_LESSON]->(:Lesson)-[:MENTIONS]->(concept:Concept)
        WHERE seed.id IN $seeds
        WITH collect(DISTINCT concept) AS seed_concepts

        MATCH (c:Course {tenant_id: $tenant_id})-[:HAS_MODULE]->(:Module)
              -[:HAS_LESSON]->(:Lesson)-[:MENTIONS]->(concept:Concept)
        WHERE NOT c.id IN $seeds
          AND NOT c.id IN $exclude
          AND concept IN seed_concepts
        WITH c, count(DISTINCT concept) AS shared_concepts, count(concept) AS total_mentions
        ORDER BY shared_concepts DESC, total_mentions DESC
        LIMIT $limit
        RETURN c.id AS course_id, c.title AS course_title, c.description AS description,
               c.thumbnail_url AS thumbnail_url, shared_concepts, total_mentions
        """
        res = await s.run(
            cypher,
            tenant_id=tenant_id,
            seeds=seed_course_ids,
            exclude=exclude_course_ids,
            limit=limit,
        )
    rows: list[dict[str, Any]] = []
    async for record in res:
        rows.append({
            "course_id":       record["course_id"],
            "course_title":    record["course_title"],
            "description":     record["description"],
            "thumbnail_url":   record["thumbnail_url"],
            "shared_concepts": int(record["shared_concepts"] or 0),
            "total_mentions":  int(record["total_mentions"] or 0),
        })
    return rows
