// kg-sync — bridges Supabase Database Webhooks → kg-api on the Hostinger VPS.
//
// Receives Supabase webhook payload format:
//   { type: "INSERT"|"UPDATE"|"DELETE", table, schema, record, old_record }
//
// For modules/lessons that lack tenant_id, we resolve it via the parent chain
// using the service role key. The fully-enriched payload is then forwarded
// to the kg-api on https://kg.example.com.
//
// Auth: this function is called only by Supabase webhooks (internal). It verifies
// a shared secret in the X-Webhook-Secret header to prevent abuse.
//
// Required Supabase secrets:
//   KG_API_URL          — e.g. https://kg.example.com
//   KG_API_TOKEN        — bearer token for kg-api
//   KG_WEBHOOK_SECRET   — shared with Supabase webhook config

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const KG_WEBHOOK_SECRET = Deno.env.get("KG_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: "tenants" | "courses" | "modules" | "lessons";
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
};

async function callKg(path: string, body: unknown): Promise<Response> {
  const resp = await fetch(`${KG_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`kg-api ${path} ${resp.status}: ${text}`);
  }
  return resp;
}

// All sync endpoints are scoped under /v1/t/{tenant_id}/...
// If a tenant has no provisioned Neo4j container yet, kg-api returns 404.
// We swallow that 404 silently — content for unprovisioned tenants is ignored
// until an admin runs scripts/provision-tenant.sh on the VPS.
async function callTenantKg(
  tenantId: string,
  subpath: string,
  body: unknown,
): Promise<unknown> {
  const url = `${KG_API_URL}/v1/t/${tenantId}${subpath}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (resp.status === 404) {
    return { skipped: true, reason: "tenant not provisioned in kg" };
  }
  if (!resp.ok) {
    throw new Error(`kg-api ${subpath} ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

// Fire-and-forget downstream pipeline for a lesson.
// EdgeRuntime.waitUntil keeps the Deno runtime alive past the response so the
// background promises actually finish.
//
// Two parallel pipelines:
//   - kg-extract: lesson text → Concept nodes + MENTIONS edges (Phase 2)
//   - kg-embed:   lesson text → 1024-dim Gemini vector on the Lesson node (Phase 3)
function fireDownstream(lessonId: string, tenantId: string): void {
  const secret = Deno.env.get("KG_WEBHOOK_SECRET")!;
  const headers = {
    "Content-Type": "application/json",
    "X-Webhook-Secret": secret,
  };
  const body = JSON.stringify({ lesson_id: lessonId, tenant_id: tenantId });

  const fire = (path: string) =>
    fetch(`${SUPABASE_URL}/functions/v1/${path}`, { method: "POST", headers, body })
      .then(async (r) => {
        if (!r.ok) {
          console.error(`${path} failed for lesson ${lessonId}:`, r.status, await r.text());
        }
      })
      .catch((e) => console.error(`${path} fetch error for lesson ${lessonId}:`, e));

  const promises = Promise.all([fire("kg-extract"), fire("kg-embed")]);

  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    er.waitUntil(promises);
  }
}

async function resolveModuleContext(
  supabase: SupabaseClient,
  moduleId: string,
): Promise<{ course_id: string; tenant_id: string }> {
  const { data, error } = await supabase
    .from("modules")
    .select("course_id, courses!inner(tenant_id)")
    .eq("id", moduleId)
    .single();
  if (error || !data) throw new Error(`module ${moduleId} not found: ${error?.message}`);
  // deno-lint-ignore no-explicit-any
  const tenantId = (data as any).courses?.tenant_id;
  if (!tenantId) throw new Error(`tenant_id missing for module ${moduleId}`);
  return { course_id: data.course_id, tenant_id: tenantId };
}

async function resolveCourseTenant(
  supabase: SupabaseClient,
  courseId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("courses")
    .select("tenant_id")
    .eq("id", courseId)
    .single();
  if (error || !data?.tenant_id) {
    throw new Error(`tenant_id missing for course ${courseId}: ${error?.message}`);
  }
  return data.tenant_id;
}

async function handleSync(
  supabase: SupabaseClient,
  payload: WebhookPayload,
): Promise<unknown> {
  const { type, table, record, old_record } = payload;

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (type === "DELETE") {
    const old = old_record as Record<string, unknown> | null;
    const id = old?.id as string | undefined;
    if (!id) throw new Error("DELETE without old_record.id");
    const kindMap = {
      tenants: "tenant",
      courses: "course",
      modules: "module",
      lessons: "lesson",
    } as const;
    const kind = kindMap[table];

    // Resolve tenant_id from old_record (or by lookup) so we know which tenant DB to hit
    let tenantId: string | undefined;
    if (table === "tenants") {
      tenantId = id;
    } else if (table === "courses") {
      tenantId = old?.tenant_id as string | undefined;
    } else if (table === "modules") {
      // old.course_id may still resolve via courses table (course may be gone if cascade)
      const courseId = old?.course_id as string | undefined;
      if (courseId) {
        try {
          tenantId = await resolveCourseTenant(supabase, courseId);
        } catch {
          // course already gone — can't route delete
          return { skipped: true, reason: "tenant unknown for orphan module delete" };
        }
      }
    } else if (table === "lessons") {
      const moduleId = old?.module_id as string | undefined;
      if (moduleId) {
        try {
          tenantId = (await resolveModuleContext(supabase, moduleId)).tenant_id;
        } catch {
          return { skipped: true, reason: "tenant unknown for orphan lesson delete" };
        }
      }
    }

    if (!tenantId) {
      return { skipped: true, reason: "could not resolve tenant_id for delete" };
    }
    return await callTenantKg(tenantId, "/sync/delete", { kind, id });
  }

  // ── INSERT / UPDATE ────────────────────────────────────────────────────────
  if (!record) throw new Error(`${type} without record`);
  const r = record as Record<string, unknown>;

  if (table === "tenants") {
    const tenantId = r.id as string;
    return await callTenantKg(tenantId, "/sync/tenant", {
      id: r.id, name: r.name, slug: r.slug,
    });
  }

  if (table === "courses") {
    const tenantId = r.tenant_id as string;
    return await callTenantKg(tenantId, "/sync/course", {
      id: r.id,
      tenant_id: tenantId,
      title: r.title,
      description: r.description,
      instructor_id: r.instructor_id,
      is_published: r.is_published,
      order_index: r.order_index,
      thumbnail_url: r.thumbnail_url,
    });
  }

  if (table === "modules") {
    const tenant_id = await resolveCourseTenant(supabase, r.course_id as string);
    return await callTenantKg(tenant_id, "/sync/module", {
      id: r.id,
      course_id: r.course_id,
      tenant_id,
      title: r.title,
      description: r.description,
      order_index: r.order_index,
    });
  }

  if (table === "lessons") {
    const ctx = await resolveModuleContext(supabase, r.module_id as string);
    const result = await callTenantKg(ctx.tenant_id, "/sync/lesson", {
      id: r.id,
      module_id: r.module_id,
      course_id: ctx.course_id,
      tenant_id: ctx.tenant_id,
      title: r.title,
      content_text: r.content_text,
      lesson_type: r.lesson_type,
      video_url: r.video_url,
      file_url: r.file_url,
      resources_url: r.resources_url,
      embed_url: r.embed_url,
      duration_minutes: r.duration_minutes,
      order_index: r.order_index,
    });

    // Phase 2 + 3: fire-and-forget concept extraction + embedding refresh.
    // Both downstream functions handle empty content gracefully.
    fireDownstream(r.id as string, ctx.tenant_id);

    return result;
  }

  throw new Error(`unhandled table: ${table}`);
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Shared-secret check (Supabase webhook config sets this header).
  const provided = req.headers.get("x-webhook-secret");
  if (!provided || provided !== KG_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const result = await handleSync(supabase, payload);
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("kg-sync error:", e, "payload:", payload);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
