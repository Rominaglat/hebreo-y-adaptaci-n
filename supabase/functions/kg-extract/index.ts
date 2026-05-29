// kg-extract — extract Concept entities from a lesson and sync them to kg-api.
//
// Input: { lesson_id, tenant_id }
//
// Pipeline:
//   1. Fetch lesson row from Supabase (must belong to tenant_id)
//   2. Strip HTML from content_text
//   3. Call Claude Sonnet with tool-use schema to extract 5-15 concepts
//   4. POST extracted concepts to kg-api /v1/t/{tenant_id}/sync/concepts
//
// Auth: requires X-Webhook-Secret matching KG_WEBHOOK_SECRET (called by kg-sync
// or admin tooling, never directly by users).
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY, KG_API_URL, KG_API_TOKEN, KG_WEBHOOK_SECRET,
//   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildLessonText } from "../_shared/lesson_text.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const KG_WEBHOOK_SECRET = Deno.env.get("KG_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "gemini-2.5-flash";
// Lessons with full transcripts can run 30K-100K chars. Cap at 40K (~13K tokens),
// well within Haiku's window, predictable cost.
const MAX_INPUT_CHARS = 40_000;

const MAX_RETRIES = 5;

const EXTRACTION_TOOL = {
  name: "save_concepts",
  description:
    "Save the technical/domain-specific concepts taught or discussed in this lesson.",
  input_schema: {
    type: "object",
    properties: {
      concepts: {
        type: "array",
        minItems: 0,
        maxItems: 15,
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "The concept in its canonical, normalized form (e.g., 'RAG', 'Claude Code', 'Vector Database', 'Prompt Engineering'). Use the original language from the lesson when natural (Hebrew or English). Do NOT include generic words like 'introduction' or 'example'.",
              minLength: 2,
              maxLength: 80,
            },
            confidence: {
              type: "number",
              description:
                "How confident you are this is a real, important concept taught in this specific lesson (not just mentioned in passing). 0.0-1.0.",
              minimum: 0.0,
              maximum: 1.0,
            },
          },
          required: ["name", "confidence"],
        },
      },
    },
    required: ["concepts"],
  },
} as const;

const SYSTEM_PROMPT = `You are an expert in analyzing educational content to build a knowledge graph.

Given the title and text of a lesson, extract 5-15 of the most important TECHNICAL or DOMAIN-SPECIFIC concepts that are taught or discussed. Focus on:
  - Tools, frameworks, libraries, APIs (e.g. "Claude Code", "Supabase", "n8n")
  - Technical concepts (e.g. "RAG", "Vector Embeddings", "Prompt Engineering")
  - Specific methodologies (e.g. "Atomic Design", "MVP")
  - Named entities relevant to the domain

Do NOT extract:
  - Generic verbs or actions ("learning", "doing")
  - Generic nouns ("introduction", "example", "lesson")
  - Pronouns or filler words
  - Section headers that are not concepts themselves

Use the canonical form: "RAG" not "retrieval augmented generation"; "Claude Code" not "claude-code".
Use the original language from the lesson when natural (Hebrew or English).
Set confidence based on how central the concept is to THIS specific lesson (not the field in general).

Always call the save_concepts tool. If the lesson has no extractable technical concepts, call it with an empty list.`;

interface ExtractedConcept {
  name: string;
  confidence: number;
}

async function extractConcepts(
  title: string,
  body: string,
): Promise<ExtractedConcept[]> {
  const truncated = body.length > MAX_INPUT_CHARS
    ? body.slice(0, MAX_INPUT_CHARS) + "\n\n[truncated]"
    : body;

  const userPrompt = [
    `# Lesson title`,
    title,
    ``,
    `# Lesson body`,
    truncated || "(no body)",
  ].join("\n");

  const responseSchema = {
    type: "OBJECT",
    properties: {
      concepts: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            confidence: { type: "NUMBER" },
          },
          required: ["name", "confidence"],
        },
      },
    },
    required: ["concepts"],
  };

  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.2,
      maxOutputTokens: 2000,
    },
  });

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  let resp: Response | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });
    if (resp.ok) break;
    if (resp.status !== 429 && resp.status < 500) {
      throw new Error(`gemini ${resp.status}: ${await resp.text()}`);
    }
    const retryAfterHeader = resp.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    const backoffSec = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? retryAfterSec
      : Math.min(60, Math.pow(2, attempt));
    const jitter = Math.random() * 0.5;
    await new Promise((r) => setTimeout(r, (backoffSec + jitter) * 1000));
  }

  if (!resp || !resp.ok) {
    throw new Error(`gemini ${resp?.status ?? "no-response"}: ${resp ? await resp.text() : "no response"}`);
  }

  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");
  if (!text) {
    throw new Error("gemini returned empty text");
  }
  let parsed: { concepts?: ExtractedConcept[] };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`gemini returned non-JSON: ${String(e).slice(0, 200)}`);
  }
  const concepts = (parsed.concepts ?? []) as ExtractedConcept[];

  // Defensive sanitation
  return concepts
    .filter((c) => c && typeof c.name === "string" && c.name.trim().length >= 2)
    .map((c) => ({
      name: c.name.trim().slice(0, 80),
      confidence: Math.min(1, Math.max(0, Number(c.confidence) || 0.7)),
    }));
}

async function syncConceptsToKg(
  tenantId: string,
  lessonId: string,
  concepts: ExtractedConcept[],
): Promise<void> {
  const url = `${KG_API_URL}/v1/t/${tenantId}/sync/concepts`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      lesson_id: lessonId,
      tenant_id: tenantId,
      concepts,
    }),
  });
  if (resp.status === 404) {
    // tenant not provisioned in kg — silently ignore
    return;
  }
  if (!resp.ok) {
    throw new Error(`kg-api sync/concepts ${resp.status}: ${await resp.text()}`);
  }
}

interface ExtractRequest {
  lesson_id: string;
  tenant_id: string;
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

  let body: ExtractRequest;
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
      JSON.stringify({ error: "lesson_id and tenant_id are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // Fetch lesson + verify tenant. Now also pulls file_url + resources_url
    // so buildLessonText() can ingest transcripts and PDFs.
    const { data: lesson, error } = await supabase
      .from("lessons")
      .select(
        "id, title, content_text, file_url, resources_url, modules!inner(course_id, courses!inner(tenant_id))",
      )
      .eq("id", body.lesson_id)
      .single();

    if (error || !lesson) {
      throw new Error(`lesson ${body.lesson_id} not found: ${error?.message}`);
    }
    // deno-lint-ignore no-explicit-any
    const lessonTenant = (lesson as any).modules?.courses?.tenant_id;
    if (lessonTenant !== body.tenant_id) {
      throw new Error(
        `tenant mismatch: lesson belongs to ${lessonTenant}, requested ${body.tenant_id}`,
      );
    }

    const built = await buildLessonText(lesson, {
      includeTranscripts: true,
      includePdfs: true,
      maxChars: MAX_INPUT_CHARS,
    });

    if (built.text.length < 50 && (lesson.title || "").length < 5) {
      // Nothing to extract — clear any existing concepts
      await syncConceptsToKg(body.tenant_id, body.lesson_id, []);
      return new Response(
        JSON.stringify({ ok: true, lesson_id: body.lesson_id, concepts: 0, skipped: "no content" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const concepts = await extractConcepts(lesson.title || "", built.text);
    await syncConceptsToKg(body.tenant_id, body.lesson_id, concepts);

    return new Response(
      JSON.stringify({
        ok: true,
        lesson_id: body.lesson_id,
        chars: built.text.length,
        sources: built.sources,
        concepts: concepts.length,
        names: concepts.map((c) => c.name),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("kg-extract error:", e, "body:", body);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
