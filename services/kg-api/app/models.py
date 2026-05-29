"""Pydantic payload models for the kg-api sync + query endpoints.

Field names match the existing AI Agency School edge functions verbatim so
the same Supabase functions (kg-sync, kg-embed, kg-extract, ai-assistant,
kg-recommend, generate-learning-path) work against this kg-api with no
changes."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ────────────────────────────────────────────────────────────────────────────
# Admin: tenant provisioning
# ────────────────────────────────────────────────────────────────────────────
class TenantProvision(BaseModel):
    tenant_id: str
    slug: str
    name: str


# ────────────────────────────────────────────────────────────────────────────
# Sync upserts (one model per node type)
# ────────────────────────────────────────────────────────────────────────────
class TenantSync(BaseModel):
    tenant_id: str
    id: str | None = None        # falls back to tenant_id
    name: str | None = None
    slug: str | None = None


class CourseSync(BaseModel):
    tenant_id: str
    id: str
    title: str
    description: str | None = None
    instructor_id: str | None = None
    is_published: bool | None = None
    order_index: int | None = None
    thumbnail_url: str | None = None


class ModuleSync(BaseModel):
    tenant_id: str
    id: str
    course_id: str
    title: str
    description: str | None = None
    order_index: int | None = None


class LessonSync(BaseModel):
    tenant_id: str
    id: str
    module_id: str
    course_id: str
    title: str
    content_text: str | None = None
    lesson_type: str | None = None
    video_url: str | None = None
    file_url: str | None = None
    resources_url: str | None = None
    embed_url: str | None = None
    duration_minutes: int | None = None
    order_index: int | None = None


class ConceptItem(BaseModel):
    name: str
    confidence: float = 1.0


class ConceptsSync(BaseModel):
    tenant_id: str
    lesson_id: str
    concepts: list[ConceptItem] = Field(default_factory=list)


class EmbeddingSync(BaseModel):
    tenant_id: str
    lesson_id: str
    embedding: list[float]


class DeleteSync(BaseModel):
    tenant_id: str
    kind: str  # "tenant" | "course" | "module" | "lesson"
    id: str


# ────────────────────────────────────────────────────────────────────────────
# Retrieval
# ────────────────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    query_embedding: list[float]
    k: int = 10
    course_id: str | None = None
    expand_via_concepts: bool = True


class RecommendRequest(BaseModel):
    seed_course_ids: list[str] = Field(default_factory=list)
    exclude_course_ids: list[str] = Field(default_factory=list)
    limit: int = 5


class CypherRequest(BaseModel):
    query: str
    params: dict[str, Any] = Field(default_factory=dict)
