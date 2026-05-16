// kg-extract-backfill — run kg-extract on every lesson in a tenant.
//
// Designed for the initial Phase 2 rollout. After this runs once, kg-sync will
// keep concepts fresh on every lesson edit.
//
// Query params:
//   tenant_id  (required) — which tenant's lessons to process
//   from       (optional) — offset, default 0
//   limit      (optional) — max lessons to process this invocation, default 100
//   concurrency (optional) — parallel kg-extract calls, default 6
//
// Because Supabase Edge Functions have a 150s wall-clock limit, this runs in
// batches. Caller should re-invoke with `from=<previous_done>` until done.
//
// Auth: X-Webhook-Secret matching KG_WEBHOOK_SECRET.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const KG_WEBHOOK_SECRET = Deno.env.get("KG_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const KG_EXTRACT_URL = `${SUPABASE_URL}/functions/v1/kg-extract`;

interface BackfillResult {
  tenant_id: string;
  from: number;
  processed: number;
  succeeded: number;
  failed: number;
  total_in_batch: number;
  errors: string[];
  next_from: number | null;
  elapsed_ms: number;
}

async function callExtract(lessonId: string, tenantId: string): Promise<void> {
  const resp = await fetch(KG_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": KG_WEBHOOK_SECRET,
    },
    body: JSON.stringify({ lesson_id: lessonId, tenant_id: tenantId }),
  });
  if (!resp.ok) {
    throw new Error(`kg-extract ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  deadline: number,
  onError: (item: T, e: Error) => void,
): Promise<{ succeeded: number; processed: number }> {
  let processed = 0;
  let succeeded = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    if (Date.now() > deadline) break;
    const slice = items.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (item) => {
        try {
          await worker(item);
          succeeded++;
        } catch (e) {
          onError(item, e instanceof Error ? e : new Error(String(e)));
        } finally {
          processed++;
        }
      }),
    );
  }
  return { succeeded, processed };
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (req.headers.get("x-webhook-secret") !== KG_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId) {
    return new Response(JSON.stringify({ error: "tenant_id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const from = parseInt(url.searchParams.get("from") || "0", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 200);
  const concurrency = Math.min(parseInt(url.searchParams.get("concurrency") || "6", 10), 12);

  // Leave headroom under the 150s edge function limit
  const startedAt = Date.now();
  const deadline = startedAt + 130_000;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Fetch lesson IDs in stable order, scoped to tenant via join
  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("id, modules!inner(courses!inner(tenant_id))")
    .eq("modules.courses.tenant_id", tenantId)
    .order("id")
    .range(from, from + limit - 1);

  if (error) {
    return new Response(
      JSON.stringify({ error: `supabase ${error.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const ids = (lessons ?? []).map((l) => l.id as string);
  const errors: string[] = [];

  const { succeeded, processed } = await processInBatches(
    ids,
    concurrency,
    (id) => callExtract(id, tenantId),
    deadline,
    (id, e) => errors.push(`${id}: ${e.message}`),
  );

  const result: BackfillResult = {
    tenant_id: tenantId,
    from,
    processed,
    succeeded,
    failed: processed - succeeded,
    total_in_batch: ids.length,
    errors: errors.slice(0, 10),
    next_from: processed < ids.length
      // Hit the deadline mid-batch — resume from where we stopped
      ? from + processed
      // Whole batch finished. More to process if it was a full batch.
      : (ids.length === limit ? from + limit : null),
    elapsed_ms: Date.now() - startedAt,
  };

  return new Response(JSON.stringify(result, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
