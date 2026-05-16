// kg-backfill — one-shot rebuild of the entire knowledge graph from Supabase.
//
// Iterates tenants → courses → modules → lessons and POSTs each one to kg-api.
// Use this:
//   - On initial migration to Neo4j
//   - After clearing the graph
//   - As a recovery step if many webhooks were dropped
//
// Auth: admin only (verifies caller is in the admin role via service role).
// For simplicity here we accept the same KG_WEBHOOK_SECRET via header.
//
// Required Supabase secrets:
//   KG_API_URL, KG_API_TOKEN, KG_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const KG_WEBHOOK_SECRET = Deno.env.get("KG_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function callKg(tenantId: string, subpath: string, body: unknown): Promise<void> {
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
    throw new Error(`tenant ${tenantId} not provisioned in kg`);
  }
  if (!resp.ok) {
    throw new Error(`kg-api ${subpath} ${resp.status}: ${await resp.text()}`);
  }
}

async function listProvisionedTenants(): Promise<Set<string>> {
  const resp = await fetch(`${KG_API_URL}/v1/admin/tenants`, {
    headers: { "Authorization": `Bearer ${KG_API_TOKEN}` },
  });
  if (!resp.ok) throw new Error(`kg-api admin/tenants ${resp.status}`);
  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  return new Set((data.tenants ?? []).map((t: any) => t.tenant_id));
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const provided = req.headers.get("x-webhook-secret");
  if (!provided || provided !== KG_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // tenant_id is REQUIRED — backfill is always tenant-scoped now (one container per tenant).
  // Optional: ?wipe=true clears the tenant's graph before reloading.
  const url = new URL(req.url);
  const wipe = url.searchParams.get("wipe") === "true";
  const tenantId = url.searchParams.get("tenant_id");

  if (!tenantId) {
    return new Response(
      JSON.stringify({ error: "missing required query param: tenant_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const counts = { tenants: 0, courses: 0, modules: 0, lessons: 0 };
  const errors: string[] = [];

  try {
    // Refuse if tenant not provisioned in kg
    const provisioned = await listProvisionedTenants();
    if (!provisioned.has(tenantId)) {
      return new Response(
        JSON.stringify({
          error: `tenant ${tenantId} not provisioned in kg-api. Run scripts/provision-tenant.sh on the VPS first.`,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (wipe) {
      // Wipe ONLY this tenant's graph (it's a dedicated DB anyway)
      await fetch(`${KG_API_URL}/v1/t/${tenantId}/cypher`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${KG_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "MATCH (n) DETACH DELETE n" }),
      });
    }

    // ── Tenant row ─────────────────────────────────────────────────────────
    // Single-tenant: the tenants table is gone, so we synthesize a row for
    // kg-api consumption. tenantId is the well-known constant from the
    // frontend (src/constants/singleTenant.ts).
    try {
      await callKg(tenantId, "/sync/tenant", {
        id: tenantId,
        name: "Learning Portal",
        slug: "default",
      });
      counts.tenants++;
    } catch (e) {
      errors.push(`tenant ${tenantId}: ${e instanceof Error ? e.message : e}`);
    }

    // ── Courses ────────────────────────────────────────────────────────────
    // Single-tenant: every course belongs to the one tenant — no scoping.
    const { data: courses, error: cErr } = await supabase
      .from("courses")
      .select("id, title, description, instructor_id, is_published, order_index, thumbnail_url");
    if (cErr) throw cErr;

    for (const c of courses ?? []) {
      try {
        await callKg(tenantId, "/sync/course", { ...c, tenant_id: tenantId });
        counts.courses++;
      } catch (e) {
        errors.push(`course ${c.id}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // ── Modules ────────────────────────────────────────────────────────────
    const { data: modules, error: mErr } = await supabase
      .from("modules")
      .select("id, course_id, title, description, order_index");
    if (mErr) throw mErr;

    for (const m of modules ?? []) {
      try {
        await callKg(tenantId, "/sync/module", {
          id: m.id,
          course_id: m.course_id,
          tenant_id: tenantId,
          title: m.title,
          description: m.description,
          order_index: m.order_index,
        });
        counts.modules++;
      } catch (e) {
        errors.push(`module ${m.id}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // ── Lessons ────────────────────────────────────────────────────────────
    const { data: lessons, error: lErr } = await supabase
      .from("lessons")
      .select(
        "id, module_id, title, content_text, lesson_type, video_url, file_url, resources_url, embed_url, duration_minutes, order_index, modules!inner(course_id)",
      );
    if (lErr) throw lErr;

    for (const l of lessons ?? []) {
      try {
        // deno-lint-ignore no-explicit-any
        const mod = (l as any).modules;
        const courseId = mod?.course_id;
        if (!courseId) {
          errors.push(`lesson ${l.id}: missing parent course context`);
          continue;
        }
        await callKg(tenantId, "/sync/lesson", {
          id: l.id,
          module_id: l.module_id,
          course_id: courseId,
          tenant_id: tenantId,
          title: l.title,
          content_text: l.content_text,
          lesson_type: l.lesson_type,
          video_url: l.video_url,
          file_url: l.file_url,
          resources_url: l.resources_url,
          embed_url: l.embed_url,
          duration_minutes: l.duration_minutes,
          order_index: l.order_index,
        });
        counts.lessons++;
      } catch (e) {
        errors.push(`lesson ${l.id}: ${e instanceof Error ? e.message : e}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, counts, errors_count: errors.length, errors: errors.slice(0, 20) }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        counts,
        errors,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
