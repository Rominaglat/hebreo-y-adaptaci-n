// kg-embed — embed a lesson with Gemini text-embedding-004 / gemini-embedding-001
// and store the vector on the corresponding Neo4j Lesson node via kg-api.
//
// Input: { lesson_id, tenant_id }
//
// Pipeline:
//   1. Fetch lesson from Supabase, verify tenant
//   2. Build embedding text: title + stripped HTML body (capped to ~6K chars)
//   3. Call Gemini Embedding API (RETRIEVAL_DOCUMENT task)
//   4. POST 1024-dim vector to kg-api /v1/t/{tenant_id}/sync/embedding
//
// Auth: X-Webhook-Secret matching KG_WEBHOOK_SECRET (called by kg-sync or backfill).
//
// Required Supabase secrets:
//   GEMINI_API_KEY, KG_API_URL, KG_API_TOKEN, KG_WEBHOOK_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
// Gemini embedding-001 input limit: 2048 tokens. Hebrew ~3.5 chars/token → cap at 7K.
// Even though buildLessonText() returns up to 40K chars (for the LLM extractor),
// the embedding only sees the first 7K — which is fine because dense embeddings
// degrade past ~512-1000 tokens anyway. Most signal is in the first few KB.
const MAX_EMBED_CHARS = 7000;
const MAX_RETRIES = 5;

interface EmbedOptions {
  taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY";
  title?: string;
}

export async function embedText(text: string, opts: EmbedOptions = {}): Promise<number[]> {
  const taskType = opts.taskType ?? "RETRIEVAL_DOCUMENT";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${GEMINI_API_KEY}`;

  const body: Record<string, unknown> = {
    model: `models/${MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: OUTPUT_DIM,
  };
  if (opts.title) body.title = opts.title;

  let resp: Response | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (resp.ok) break;
    if (resp.status !== 429 && resp.status < 500) {
      throw new Error(`gemini ${resp.status}: ${await resp.text()}`);
    }
    const wait = Math.min(60, Math.pow(2, attempt)) + Math.random() * 0.5;
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!resp || !resp.ok) {
    throw new Error(`gemini ${resp?.status}: ${resp ? await resp.text() : "no response"}`);
  }

  const data = await resp.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== OUTPUT_DIM) {
    throw new Error(`gemini returned bad embedding: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return values;
}

async function syncEmbeddingToKg(
  tenantId: string,
  lessonId: string,
  embedding: number[],
): Promise<void> {
  const url = `${KG_API_URL}/v1/t/${tenantId}/sync/embedding`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      lesson_id: lessonId,
      tenant_id: tenantId,
      embedding,
    }),
  });
  if (resp.status === 404) return; // tenant not provisioned
  if (!resp.ok) {
    throw new Error(`kg-api sync/embedding ${resp.status}: ${await resp.text()}`);
  }
}

interface EmbedRequest {
  lesson_id: string;
  tenant_id: string;
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (req.headers.get("x-webhook-secret") !== KG_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: EmbedRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.lesson_id || !body.tenant_id) {
    return new Response(
      JSON.stringify({ error: "lesson_id and tenant_id required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { data: lesson, error } = await supabase
      .from("lessons")
      .select(
        "id, title, content_text, file_url, resources_url, modules!inner(courses!inner(tenant_id))",
      )
      .eq("id", body.lesson_id)
      .single();
    if (error || !lesson) {
      throw new Error(`lesson ${body.lesson_id} not found: ${error?.message}`);
    }
    // deno-lint-ignore no-explicit-any
    const lessonTenant = (lesson as any).modules?.courses?.tenant_id;
    if (lessonTenant !== body.tenant_id) {
      throw new Error(`tenant mismatch`);
    }

    // Pull full text (content + transcripts + PDFs); embedding only needs the
    // first MAX_EMBED_CHARS chars but we still get the title prepended.
    const built = await buildLessonText(lesson, {
      includeTranscripts: true,
      includePdfs: true,
      maxChars: MAX_EMBED_CHARS,
    });
    const text = [lesson.title, built.text].filter(Boolean).join("\n\n").slice(0, MAX_EMBED_CHARS);

    if (text.length < 5) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "no content", lesson_id: body.lesson_id }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const embedding = await embedText(text, {
      taskType: "RETRIEVAL_DOCUMENT",
      title: lesson.title || undefined,
    });

    await syncEmbeddingToKg(body.tenant_id, body.lesson_id, embedding);

    return new Response(
      JSON.stringify({
        ok: true,
        lesson_id: body.lesson_id,
        dim: embedding.length,
        chars: text.length,
        sources: built.sources,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("kg-embed error:", e, "body:", body);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
