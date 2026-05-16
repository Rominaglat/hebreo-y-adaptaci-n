// generate-learning-path — KG-backed learning-path generation.
//
// Pipeline:
//   1. Fetch all published courses for the tenant from Supabase
//   2. Embed the user's goal with Gemini (RETRIEVAL_QUERY)
//   3. Call kg-api /v1/t/{tid}/query with a large K to get top lessons for the goal
//   4. Aggregate lesson hits → course scores (max lesson score per course)
//   5. Keep the top ~8 candidate courses
//   6. Call Claude Haiku with the candidates + goal and ask for an ordered
//      list of 3-6 courses (foundational → advanced) with 1-line reasoning
//   7. Validate course IDs, save to learning_paths
//
// KG-backed. Uses only Gemini (embeddings) + Claude (ordering) + kg-api.
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY, GEMINI_API_KEY, KG_API_URL, KG_API_TOKEN,
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";


const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 1024;
const ORDER_MODEL = "claude-haiku-4-5-20251001";
const RETRIEVAL_K = 50; // pull 50 lesson hits to get good course coverage
const MAX_CANDIDATES = 8; // narrow to top 8 courses before asking the LLM

interface LearningStep {
  course_id: string;
  course_title: string;
  reason: string;
}

async function embedQuery(text: string): Promise<number[]> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBED_DIM,
    }),
  });
  if (!resp.ok) {
    throw new Error(`gemini embed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIM) {
    throw new Error("gemini returned bad embedding");
  }
  return values;
}

interface RetrievalHit {
  lesson_id: string;
  course_id: string | null;
  course_title: string | null;
  score: number;
}

async function retrieveCourses(
  tenantId: string,
  embedding: number[],
): Promise<Map<string, { title: string; score: number; hits: number }>> {
  const resp = await fetch(`${KG_API_URL}/v1/t/${tenantId}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_embedding: embedding,
      k: RETRIEVAL_K,
      expand_via_concepts: false, // we want pure semantic ordering here
    }),
  });
  if (!resp.ok) {
    throw new Error(`kg-api query ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const hits = (data.hits ?? []) as RetrievalHit[];

  // Aggregate per course: keep max lesson score, count hits as recency/coverage signal
  const byCourse = new Map<string, { title: string; score: number; hits: number }>();
  for (const h of hits) {
    if (!h.course_id) continue;
    const prev = byCourse.get(h.course_id);
    const score = typeof h.score === "number" ? h.score : 0;
    if (!prev) {
      byCourse.set(h.course_id, { title: h.course_title ?? "", score, hits: 1 });
    } else {
      prev.score = Math.max(prev.score, score);
      prev.hits += 1;
    }
  }
  return byCourse;
}

const ORDER_TOOL = {
  name: "save_learning_path",
  description:
    "Save an ordered learning path of 3-6 courses that helps the user achieve their goal, from foundational to advanced.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            course_id: {
              type: "string",
              description:
                "UUID of the course. MUST be chosen from the provided candidate list — do NOT invent IDs.",
            },
            course_title: { type: "string" },
            reason: {
              type: "string",
              description:
                "A single concise sentence in Hebrew explaining why this course fits and at which stage of the learning journey.",
              maxLength: 200,
            },
          },
          required: ["course_id", "course_title", "reason"],
        },
      },
    },
    required: ["steps"],
  },
} as const;

async function orderCourses(
  goal: string,
  candidates: { id: string; title: string; description: string | null; score: number }[],
): Promise<LearningStep[]> {
  const catalog = candidates
    .map((c, i) =>
      `[${i + 1}] id=${c.id} | ${c.title}${c.description ? ` — ${c.description.slice(0, 200)}` : ""}${
        c.score ? ` (semantic_score: ${c.score.toFixed(2)})` : ""
      }`
    )
    .join("\n");

  const userPrompt = [
    `# User goal`,
    goal,
    ``,
    `# Candidate courses (pre-filtered by semantic similarity to the goal)`,
    catalog,
    ``,
    `Build an ordered learning path of 3-6 courses from this candidate list. Order from foundational to advanced. Each reason must be a single Hebrew sentence.`,
    `Always call save_learning_path.`,
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ORDER_MODEL,
      max_tokens: 1500,
      system:
        "You are a learning advisor. You receive a user's goal and a list of pre-filtered candidate courses. You must pick and order 3-6 of them to form a coherent learning path from foundational to advanced. Reasons must be in Hebrew, exactly one sentence each. Only use courses from the candidate list.",
      tools: [ORDER_TOOL],
      tool_choice: { type: "tool", name: "save_learning_path" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  const toolUse = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === "save_learning_path");
  if (!toolUse) {
    throw new Error("Claude did not call save_learning_path");
  }
  return (toolUse.input?.steps ?? []) as LearningStep[];
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { goal, tenant_id } = await req.json();
    if (!goal || !tenant_id) {
      return new Response(
        JSON.stringify({ error: "goal and tenant_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const userJwt = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(userJwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // SEC-012 — per-user rate limit (5/min)
    const rl = await checkRateLimit(supabase, `generate-learning-path:${user.id}`, 5);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429,
        headers: { ...corsHeaders, ...rl.headers, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch published courses (catalog)
    const { data: courses, error: coursesError } = await supabase
      .from("courses")
      .select("id, title, description")
      .eq("tenant_id", tenant_id)
      .eq("is_published", true);

    if (coursesError || !courses || courses.length === 0) {
      return new Response(
        JSON.stringify({ error: "No courses available" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const catalogById = new Map<string, { id: string; title: string; description: string | null }>();
    for (const c of courses) catalogById.set(c.id, c);

    // 2-4. Embed goal, retrieve from KG, aggregate to courses
    let scored: { id: string; title: string; description: string | null; score: number }[] = [];
    try {
      const embedding = await embedQuery(goal);
      const byCourse = await retrieveCourses(tenant_id, embedding);

      // Keep only courses that exist in the published catalog
      scored = [...byCourse.entries()]
        .filter(([id]) => catalogById.has(id))
        .map(([id, info]) => ({
          id,
          title: catalogById.get(id)!.title,
          description: catalogById.get(id)!.description,
          score: info.score,
        }))
        .sort((a, b) => b.score - a.score);
    } catch (e) {
      console.error("KG retrieval failed:", e);
      // Fall back: pass the whole catalog
      scored = courses.map((c: { id: string; title: string; description: string | null }) => ({ id: c.id, title: c.title, description: c.description, score: 0 }));
    }

    // 5. Narrow candidates
    const candidates = (scored.length > 0 ? scored : courses.map((c: { id: string; title: string; description: string | null }) => ({
      id: c.id, title: c.title, description: c.description, score: 0,
    }))).slice(0, MAX_CANDIDATES);

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ error: "No candidate courses found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 6. Order + rationalize with Claude Haiku
    let steps: LearningStep[];
    try {
      steps = await orderCourses(goal, candidates);
    } catch (e) {
      console.error("Claude ordering failed:", e);
      return new Response(
        JSON.stringify({ error: `ordering failed: ${e instanceof Error ? e.message : e}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate course IDs against the catalog
    const validIds = new Set(catalogById.keys());
    const validSteps = steps
      .filter((s) => validIds.has(s.course_id))
      .slice(0, 6);

    if (validSteps.length === 0) {
      return new Response(
        JSON.stringify({ error: "AI suggested invalid courses" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 7. Save (replace) learning path
    await supabase
      .from("learning_paths")
      .delete()
      .eq("user_id", user.id)
      .eq("tenant_id", tenant_id);

    const { data: inserted, error: insertError } = await supabase
      .from("learning_paths")
      .insert({
        user_id: user.id,
        tenant_id,
        goal,
        steps: validSteps,
        current_step: 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error", insertError);
      throw insertError;
    }

    return new Response(JSON.stringify(inserted), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-learning-path error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
