// kg-embed-backfill — embed all lessons in a tenant in true batches.
//
// Strategy:
//   1. Pull a page of lessons from Supabase
//   2. Build embedding text per lesson (title + stripped HTML, capped to 7K chars)
//   3. Send ONE batchEmbedContents request to Gemini (up to 100 per call)
//   4. POST each (lesson_id, embedding) to kg-api /v1/t/{tid}/sync/embedding
//
// This avoids both Gemini's per-request rate limit AND the Supabase Edge
// Functions outbound rate limit, since each invocation makes ~1 Gemini call
// and N quick kg-api calls instead of N parallel kg-embed invocations.
//
// Query params: tenant_id (req), from (default 0), limit (default 80)
// Auth: X-Webhook-Secret matching KG_WEBHOOK_SECRET

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildLessonText } from "../_shared/lesson_text.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const KG_WEBHOOK_SECRET = Deno.env.get("KG_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "gemini-embedding-001";
const OUTPUT_DIM = 1024;
// Gemini free tier: 30K tokens per minute. Hebrew transcripts are token-dense
// (~3 chars/token vs ~4 in English). 2500 chars * 5 lessons = 12500 chars =
// ~4500 tokens including overhead. 60s between batches gives 4.5K * 1 = 4.5K TPM
// with massive headroom. 372 lessons → ~75 min worst case.
//
// Yes, this is glacial — but free tier is what it is. Paid tier has 1M TPM.
const MAX_CHARS = 2500;
const GEMINI_BATCH_SIZE = 5;
const SLEEP_BETWEEN_BATCHES_MS = 12_000;
const MAX_RETRIES = 5;

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

interface LessonText {
  id: string;
  title: string;
  text: string;
}

async function batchEmbed(items: LessonText[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`;

  const requests = items.map((item) => ({
    model: `models/${MODEL}`,
    content: { parts: [{ text: item.text }] },
    taskType: "RETRIEVAL_DOCUMENT",
    title: item.title || undefined,
    outputDimensionality: OUTPUT_DIM,
  }));

  let resp: Response | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (resp.ok) break;
    if (resp.status !== 429 && resp.status < 500) {
      throw new Error(`gemini batch ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
    const wait = Math.min(60, Math.pow(2, attempt + 1)) + Math.random();
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!resp || !resp.ok) {
    throw new Error(`gemini batch ${resp?.status}: ${resp ? (await resp.text()).slice(0, 200) : "no response"}`);
  }

  const data = await resp.json();
  // Response shape: { embeddings: [{values: [...]}, ...] } in same order
  const embeddings = data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== items.length) {
    throw new Error(`gemini returned ${embeddings?.length} embeddings, expected ${items.length}`);
  }
  for (let i = 0; i < items.length; i++) {
    const v = embeddings[i]?.values;
    if (Array.isArray(v) && v.length === OUTPUT_DIM) {
      out.set(items[i].id, v);
    }
  }
  return out;
}

async function pushEmbedding(
  tenantId: string,
  lessonId: string,
  embedding: number[],
): Promise<void> {
  const resp = await fetch(`${KG_API_URL}/v1/t/${tenantId}/sync/embedding`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lesson_id: lessonId, tenant_id: tenantId, embedding }),
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`kg-api ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-webhook-secret") !== KG_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId) {
    return new Response(JSON.stringify({ error: "tenant_id required" }), { status: 400 });
  }
  const from = parseInt(url.searchParams.get("from") || "0", 10);
  // Default 30 lessons = 6 batches of 5 = ~70s + transcript fetch time
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10), 60);

  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: lessons, error } = await supabase
    .from("lessons")
    .select(
      "id, title, content_text, file_url, resources_url, modules!inner(courses!inner(tenant_id))",
    )
    .eq("modules.courses.tenant_id", tenantId)
    .order("id")
    .range(from, from + limit - 1);

  if (error) {
    return new Response(
      JSON.stringify({ error: `supabase ${error.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Build embedding texts in parallel; transcripts and PDFs are pulled per lesson.
  // Skip PDFs in backfill to keep latency low — content_text + transcripts cover
  // the vast majority of signal. PDFs ARE indexed by kg-extract.
  const built = await Promise.all(
    (lessons ?? []).map(async (l) => {
      const b = await buildLessonText(l, {
        includeTranscripts: true,
        includePdfs: false,
        maxChars: MAX_CHARS,
      });
      return {
        id: l.id as string,
        title: (l.title as string) || "",
        text: [l.title, b.text].filter(Boolean).join("\n\n").slice(0, MAX_CHARS),
      };
    }),
  );

  const items: LessonText[] = [];
  let skipped_empty = 0;
  for (const it of built) {
    if (it.text.length < 5) {
      skipped_empty++;
      continue;
    }
    items.push(it);
  }

  let succeeded = 0;
  const errors: string[] = [];

  // Gemini batch in chunks of GEMINI_BATCH_SIZE with throttling between chunks.
  // Stop early if approaching the 150s edge function deadline.
  const deadline = startedAt + 130_000;
  for (let i = 0; i < items.length; i += GEMINI_BATCH_SIZE) {
    if (Date.now() > deadline) break;
    if (i > 0) {
      await new Promise((r) => setTimeout(r, SLEEP_BETWEEN_BATCHES_MS));
      if (Date.now() > deadline) break;
    }
    const chunk = items.slice(i, i + GEMINI_BATCH_SIZE);
    try {
      const embMap = await batchEmbed(chunk);
      for (const [lessonId, embedding] of embMap) {
        try {
          await pushEmbedding(tenantId, lessonId, embedding);
          succeeded++;
        } catch (e) {
          errors.push(`${lessonId}: kg-api ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      errors.push(`gemini batch starting at ${i}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const total = lessons?.length ?? 0;
  return new Response(
    JSON.stringify({
      tenant_id: tenantId,
      from,
      total_in_batch: total,
      embeddable: items.length,
      skipped_empty,
      succeeded,
      failed: items.length - succeeded,
      errors: errors.slice(0, 10),
      next_from: total === limit ? from + limit : null,
      elapsed_ms: Date.now() - startedAt,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
