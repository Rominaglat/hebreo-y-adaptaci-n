"""kg-api FastAPI app — single-instance, multi-tenant Neo4j knowledge graph.

Designed to be a drop-in replacement for the AI Agency School kg-api so the
existing Supabase edge functions (kg-sync, kg-extract, kg-embed,
ai-assistant, kg-recommend, generate-learning-path) work unchanged once
KG_API_URL / KG_API_TOKEN / KG_WEBHOOK_SECRET point here."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_bearer, require_webhook_or_bearer
from .config import assert_required, close_driver, get_driver, session
from .models import (
    ConceptsSync, CourseSync, CypherRequest, DeleteSync, EmbeddingSync,
    LessonSync, ModuleSync, QueryRequest, RecommendRequest, TenantProvision,
    TenantSync,
)
from .retrieval import recommend_courses, vector_query
from .schema import ensure_schema
from .sync_handlers import (
    cascade_delete, replace_lesson_concepts, set_lesson_embedding,
    upsert_course, upsert_lesson, upsert_module, upsert_tenant,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_required()
    # Warm the driver + run schema bootstrap.
    get_driver()
    try:
        await ensure_schema()
    except Exception as e:
        # Surface the error in logs but don't crash the worker — health check
        # will still report "ok" so Railway doesn't loop the deploy. Operators
        # see the failure in startup logs and can fix the password / URL.
        print(f"[kg-api] schema bootstrap failed: {e}")
    yield
    await close_driver()


app = FastAPI(title="kg-api", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def assert_body_tenant(path_tid: str, body_tid: str) -> None:
    if path_tid != body_tid:
        raise HTTPException(
            status_code=400,
            detail=f"tenant_id mismatch: path={path_tid!r} body={body_tid!r}",
        )


# ────────────────────────────────────────────────────────────────────────────
# Public health
# ────────────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "kg-api", "version": "1.0.0"}


# ────────────────────────────────────────────────────────────────────────────
# Admin
# ────────────────────────────────────────────────────────────────────────────
@app.get("/v1/admin/tenants", dependencies=[Depends(require_bearer)])
async def list_tenants() -> dict[str, Any]:
    async with session() as s:
        res = await s.run(
            "MATCH (t:Tenant) RETURN t.id AS tenant_id, t.slug AS slug, t.name AS name, "
            "t.synced_at AS created_at ORDER BY t.synced_at DESC"
        )
        tenants = [dict(record) async for record in res]
    return {"tenants": tenants}


@app.post("/v1/admin/tenants", dependencies=[Depends(require_bearer)])
async def provision_tenant(payload: TenantProvision) -> dict[str, Any]:
    async with session() as s:
        await upsert_tenant(s, payload.tenant_id, payload.name, payload.slug)
    return {"ok": True, "tenant_id": payload.tenant_id}


@app.post("/v1/admin/reload", dependencies=[Depends(require_bearer)])
async def admin_reload() -> dict[str, Any]:
    # No tenants.json file in this single-instance build; reload is a no-op
    # kept for API compatibility with the VPS kg-api.
    return {"ok": True}


# ────────────────────────────────────────────────────────────────────────────
# Per-tenant utility
# ────────────────────────────────────────────────────────────────────────────
@app.get("/v1/t/{tenant_id}/ping", dependencies=[Depends(require_bearer)])
async def ping(tenant_id: str = Path(...)) -> dict[str, Any]:
    async with session() as s:
        res = await s.run(
            "MATCH (t:Tenant {id: $tid}) RETURN t.id AS id LIMIT 1", tid=tenant_id,
        )
        record = await res.single()
    if not record:
        raise HTTPException(status_code=404, detail=f"tenant {tenant_id} not provisioned in kg")
    return {"ok": True, "tenant_id": tenant_id}


@app.get("/v1/t/{tenant_id}/stats", dependencies=[Depends(require_bearer)])
async def stats(tenant_id: str = Path(...)) -> dict[str, Any]:
    async with session() as s:
        res = await s.run(
            """
            CALL {
              MATCH (t:Tenant {id: $tid}) RETURN 'Tenant' AS label, count(t) AS count
              UNION ALL
              MATCH (c:Course {tenant_id: $tid}) RETURN 'Course' AS label, count(c) AS count
              UNION ALL
              MATCH (m:Module {tenant_id: $tid}) RETURN 'Module' AS label, count(m) AS count
              UNION ALL
              MATCH (l:Lesson {tenant_id: $tid}) RETURN 'Lesson' AS label, count(l) AS count
              UNION ALL
              MATCH (:Lesson {tenant_id: $tid})-[:MENTIONS]->(c:Concept)
              RETURN 'Concept' AS label, count(DISTINCT c) AS count
            }
            RETURN label, count
            """,
            tid=tenant_id,
        )
        rows = [{"label": r["label"], "count": int(r["count"])} async for r in res]
    return {"rows": rows, "count": len(rows)}


# ────────────────────────────────────────────────────────────────────────────
# Sync — backend-only (webhook secret OR bearer accepted)
# ────────────────────────────────────────────────────────────────────────────
@app.post("/v1/t/{tenant_id}/sync/tenant", dependencies=[Depends(require_webhook_or_bearer)])
async def sync_tenant(payload: TenantSync, tenant_id: str = Path(...)) -> dict[str, Any]:
    try:
        body_id = payload.effective_id
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    assert_body_tenant(tenant_id, body_id)
    async with session() as s:
        await upsert_tenant(s, body_id, payload.name, payload.slug)
    return {"rows": [{"id": body_id}], "count": 1}


@app.post("/v1/t/{tenant_id}/sync/course", dependencies=[Depends(require_webhook_or_bearer)])
async def sync_course(payload: CourseSync, tenant_id: str = Path(...)) -> dict[str, Any]:
    assert_body_tenant(tenant_id, payload.tenant_id)
    async with session() as s:
        await upsert_course(s, payload.model_dump())
    return {"rows": [{"id": payload.id}], "count": 1}


@app.post("/v1/t/{tenant_id}/sync/module", dependencies=[Depends(require_webhook_or_bearer)])
async def sync_module(payload: ModuleSync, tenant_id: str = Path(...)) -> dict[str, Any]:
    assert_body_tenant(tenant_id, payload.tenant_id)
    async with session() as s:
        await upsert_module(s, payload.model_dump())
    return {"rows": [{"id": payload.id}], "count": 1}


@app.post("/v1/t/{tenant_id}/sync/lesson", dependencies=[Depends(require_webhook_or_bearer)])
async def sync_lesson(payload: LessonSync, tenant_id: str = Path(...)) -> dict[str, Any]:
    assert_body_tenant(tenant_id, payload.tenant_id)
    async with session() as s:
        await upsert_lesson(s, payload.model_dump())
    return {"rows": [{"id": payload.id}], "count": 1}


@app.post("/v1/t/{tenant_id}/sync/embedding", dependencies=[Depends(require_webhook_or_bearer)])
async def sync_embedding(payload: EmbeddingSync, tenant_id: str = Path(...)) -> dict[str, Any]:
    assert_body_tenant(tenant_id, payload.tenant_id)
    async with session() as s:
        await set_lesson_embedding(s, payload.tenant_id, payload.lesson_id, payload.embedding)
    return {"rows": [{"id": payload.lesson_id}], "count": 1}


@app.post("/v1/t/{tenant_id}/sync/concepts", dependencies=[Depends(require_webhook_or_bearer)])
async def sync_concepts(payload: ConceptsSync, tenant_id: str = Path(...)) -> dict[str, Any]:
    assert_body_tenant(tenant_id, payload.tenant_id)
    async with session() as s:
        await replace_lesson_concepts(
            s, payload.tenant_id, payload.lesson_id,
            [c.model_dump() for c in payload.concepts],
        )
    return {"rows": [{"id": payload.lesson_id, "count": len(payload.concepts)}], "count": 1}


@app.post("/v1/t/{tenant_id}/sync/delete", dependencies=[Depends(require_webhook_or_bearer)])
async def sync_delete(payload: DeleteSync, tenant_id: str = Path(...)) -> dict[str, Any]:
    assert_body_tenant(tenant_id, payload.tenant_id)
    async with session() as s:
        await cascade_delete(s, payload.tenant_id, payload.kind, payload.id)
    return {"rows": [{"id": payload.id}], "count": 1}


# ────────────────────────────────────────────────────────────────────────────
# Retrieval — bearer only (user-facing reads)
# ────────────────────────────────────────────────────────────────────────────
@app.post("/v1/t/{tenant_id}/query", dependencies=[Depends(require_bearer)])
async def query(payload: QueryRequest, tenant_id: str = Path(...)) -> dict[str, Any]:
    async with session() as s:
        hits = await vector_query(
            s, tenant_id, payload.query_embedding, payload.k,
            payload.course_id, payload.expand_via_concepts,
        )
    return {"hits": hits}


@app.post("/v1/t/{tenant_id}/recommend/courses", dependencies=[Depends(require_bearer)])
async def recommend(payload: RecommendRequest, tenant_id: str = Path(...)) -> dict[str, Any]:
    async with session() as s:
        rows = await recommend_courses(
            s, tenant_id, payload.seed_course_ids,
            payload.exclude_course_ids, payload.limit,
        )
    return {"rows": rows, "count": len(rows)}


@app.post("/v1/t/{tenant_id}/cypher", dependencies=[Depends(require_bearer)])
async def cypher(payload: CypherRequest, tenant_id: str = Path(...)) -> dict[str, Any]:
    # Inject tenant_id into params if the caller forgot — most queries scope
    # explicitly via property filters, so this is a convenience.
    params = {"tenant_id": tenant_id, **payload.params}
    async with session() as s:
        res = await s.run(payload.query, params)
        rows = [dict(record) async for record in res]
    return {"rows": rows, "count": len(rows)}


@app.get("/v1/t/{tenant_id}/graph", dependencies=[Depends(require_bearer)])
async def graph(tenant_id: str = Path(...), limit: int = 500) -> dict[str, Any]:
    """Cytoscape-compatible full dump for visualization."""
    async with session() as s:
        node_res = await s.run(
            """
            MATCH (n)
            WHERE (n:Tenant AND n.id = $tid)
               OR (n:Course AND n.tenant_id = $tid)
               OR (n:Module AND n.tenant_id = $tid)
               OR (n:Lesson AND n.tenant_id = $tid)
               OR (n:Concept AND EXISTS {
                    MATCH (:Lesson {tenant_id: $tid})-[:MENTIONS]->(n)
                  })
            RETURN elementId(n) AS id, labels(n)[0] AS label, properties(n) AS props
            LIMIT $limit
            """,
            tid=tenant_id, limit=limit,
        )
        nodes = [dict(record) async for record in node_res]

        edge_res = await s.run(
            """
            MATCH (a)-[r]->(b)
            WHERE (a.tenant_id = $tid OR (a:Tenant AND a.id = $tid))
              AND (b.tenant_id = $tid OR labels(b)[0] = 'Concept')
            RETURN elementId(r) AS id,
                   elementId(a) AS source,
                   elementId(b) AS target,
                   type(r) AS type,
                   properties(r) AS props
            LIMIT $limit
            """,
            tid=tenant_id, limit=limit,
        )
        edges = [dict(record) async for record in edge_res]
    return {"nodes": nodes, "edges": edges}
