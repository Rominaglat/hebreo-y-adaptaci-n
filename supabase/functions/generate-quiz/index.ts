// generate-quiz — generate multiple-choice quiz questions for a course (or
// specific lessons) using Claude Haiku 4.5 with tool use for structured output.
//
// Pipeline:
//   1. Fetch course title + lessons from Supabase (optionally filtered by lesson_ids).
//      If `topic` is provided AND no lesson_ids, use kg-api semantic retrieval to
//      pick the top-N most relevant lessons within the course for that topic.
//   2. Build the full text via the shared buildLessonText helper, which pulls
//      content_text + transcripts (PDFs skipped here for latency)
//   3. Call Claude Haiku 4.5 with the save_quiz_questions tool
//   4. Validate (4 options, exactly 1 correct, etc.) and return
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY, GEMINI_API_KEY (only if using `topic`),
//   KG_API_URL, KG_API_TOKEN (only if using `topic`),
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildLessonText } from "../_shared/lesson_text.ts";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";


const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 1024;

const MODEL = "gemini-2.5-flash";

// Single-tenant build: every Postgres row already belongs to this tenant
// (phase2c dropped tenant_id from data tables) and the KG has one tenant.
const SINGLE_TENANT_ID = "00000000-0000-0000-0000-000000000000";
// Total context budget across all lessons for quiz generation
const MAX_TOTAL_CHARS = 20_000;
// Per-lesson cap so one giant lesson doesn't crowd out the rest
const PER_LESSON_CHARS = 3500;

const QUIZ_TOOL = {
  name: "save_quiz_questions",
  description:
    "Save a set of multiple-choice quiz questions in Hebrew based on the provided course content. Each question must have exactly 4 options with exactly 1 correct answer.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 3,
        maxItems: 15,
        items: {
          type: "object",
          properties: {
            question_text: {
              type: "string",
              description: "The question text in Hebrew",
              minLength: 5,
              maxLength: 500,
            },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              description: "Exactly 4 multiple-choice options. Exactly ONE must have is_correct=true.",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", maxLength: 300 },
                  is_correct: { type: "boolean" },
                  explanation: {
                    type: "string",
                    description: "Brief Hebrew explanation of why this option is correct or incorrect.",
                    maxLength: 250,
                  },
                },
                required: ["text", "is_correct", "explanation"],
              },
            },
            points: { type: "integer", minimum: 1, maximum: 5 },
          },
          required: ["question_text", "options", "points"],
        },
      },
    },
    required: ["questions"],
  },
} as const;

interface GeneratedOption {
  text: string;
  is_correct: boolean;
  explanation: string;
}

interface GeneratedQuestion {
  question_text: string;
  options: GeneratedOption[];
  points: number;
}

// ─── Optional semantic topic retrieval ──────────────────────────────────────

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

async function topLessonsForTopic(
  tenantId: string,
  courseId: string,
  topic: string,
  k: number,
): Promise<string[]> {
  const embedding = await embedQuery(topic);
  const resp = await fetch(`${KG_API_URL}/v1/t/${tenantId}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_embedding: embedding,
      k,
      course_id: courseId,
      expand_via_concepts: false,
    }),
  });
  if (!resp.ok) {
    throw new Error(`kg-api query ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  return (data.hits || []).map((h: any) => h.lesson_id).filter(Boolean);
}

async function generateQuestions(
  courseTitle: string,
  contentBlock: string,
  numQuestions: number,
): Promise<GeneratedQuestion[]> {
  const systemPrompt =
    `You are a learning assessment expert who creates multiple-choice quiz questions in Hebrew, grounded strictly in the provided course content. Always call save_quiz_questions. Never invent facts that aren't in the source.`;

  const userPrompt = [
    `# Course title`,
    courseTitle,
    ``,
    `# Task`,
    `Generate exactly ${numQuestions} multiple-choice questions in Hebrew based on the course content below. Cover different parts of the content. Make distractors plausible but unambiguously wrong. Each correct answer's explanation should briefly cite WHICH lesson it came from.`,
    ``,
    `# Course content`,
    contentBlock,
  ].join("\n");

  // Gemini structured-output schema. Keep it lean — its constrained decoder
  // explodes on deeply nested min/maxItems combos. We describe size limits
  // (4 options, 3-N questions, 1 correct option) in the prompt instead.
  const responseSchema = {
    type: "OBJECT",
    properties: {
      questions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            question_text: { type: "STRING" },
            options: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  text: { type: "STRING" },
                  is_correct: { type: "BOOLEAN" },
                  explanation: { type: "STRING" },
                },
                required: ["text", "is_correct", "explanation"],
              },
            },
            points: { type: "INTEGER" },
          },
          required: ["question_text", "options", "points"],
        },
      },
    },
    required: ["questions"],
  };

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.3,
        maxOutputTokens: 4000,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const text =
    // deno-lint-ignore no-explicit-any
    (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");
  if (!text) throw new Error("gemini returned empty text");
  let parsed: { questions?: GeneratedQuestion[] };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`gemini returned non-JSON: ${String(e).slice(0, 200)}`);
  }
  return (parsed.questions ?? []) as GeneratedQuestion[];
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const course_id = body.course_id;
    const num_questions = body.num_questions ?? 5;
    const lesson_ids = body.lesson_ids;
    const topic = body.topic;
    // Single-tenant build: tenant_id is the server-side constant. Callers
    // (the frontend ExamManager) don't pass it. Accept overrides for
    // multi-tenant migrations later.
    const tenant_id = body.tenant_id ?? SINGLE_TENANT_ID;

    if (!course_id) {
      return new Response(
        JSON.stringify({ error: "course_id is required" }),
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
    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // SEC-012 — per-user rate limit (5/min)
    const rl = await checkRateLimit(supabase, `generate-quiz:${user.id}`, 5);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429,
        headers: { ...corsHeaders, ...rl.headers, "Content-Type": "application/json" },
      });
    }

    // Fetch course title
    const { data: course } = await supabase
      .from("courses")
      .select("title")
      .eq("id", course_id)
      .maybeSingle();

    // Decide which lesson IDs we need:
    //   - If `lesson_ids` was passed → use as-is (most specific)
    //   - Else if `topic` was passed → semantic retrieval against the KG to
    //     pick the top 8 most relevant lessons inside this course
    //   - Else → fall back to all lessons in the course
    let resolvedLessonIds: string[] | null = null;
    if (Array.isArray(lesson_ids) && lesson_ids.length > 0) {
      resolvedLessonIds = lesson_ids as string[];
    } else if (typeof topic === "string" && topic.trim().length > 2) {
      try {
        resolvedLessonIds = await topLessonsForTopic(tenant_id, course_id, topic.trim(), 8);
      } catch (e) {
        // Soft-fail to "all lessons" so quizzes still generate even if KG is down
        console.warn("topic retrieval failed, falling back to all lessons:", e);
      }
    }

    // Fetch lessons (all in course, or filtered to resolvedLessonIds)
    let lessonsQuery = supabase
      .from("lessons")
      .select("id, title, content_text, file_url, resources_url, modules!inner(course_id)")
      .eq("modules.course_id", course_id);

    if (resolvedLessonIds && resolvedLessonIds.length > 0) {
      lessonsQuery = lessonsQuery.in("id", resolvedLessonIds);
    }

    const { data: lessons, error: lessonsError } = await lessonsQuery;
    if (lessonsError) {
      console.error("Lessons query error", lessonsError);
      return new Response(
        JSON.stringify({ error: `Failed to fetch lessons: ${lessonsError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!lessons || lessons.length === 0) {
      return new Response(
        JSON.stringify({ error: "No lessons found in this course" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build per-lesson text via the shared helper (content + transcripts).
    // Skip PDFs to keep latency low.
    const sections: string[] = [];
    let totalChars = 0;
    for (const lesson of lessons) {
      if (totalChars >= MAX_TOTAL_CHARS) break;
      try {
        const built = await buildLessonText(lesson, {
          includeTranscripts: true,
          includePdfs: false,
          maxChars: PER_LESSON_CHARS,
        });
        if (!built.text) continue;
        const slice = built.text.slice(0, PER_LESSON_CHARS);
        sections.push(`## ${lesson.title}\n${slice}`);
        totalChars += slice.length + lesson.title.length + 4;
      } catch (e) {
        console.error(`buildLessonText failed for ${lesson.id}:`, e);
      }
    }

    if (sections.length === 0) {
      // Fall back to lesson titles only
      sections.push(
        `Course: ${course?.title || "Untitled"}\n\nLessons in this course:\n` +
          lessons.map((l: { title: string }) => `- ${l.title}`).join("\n"),
      );
    }

    const contentBlock = sections.join("\n\n").slice(0, MAX_TOTAL_CHARS);
    const safeNum = Math.min(Math.max(Number(num_questions) || 5, 3), 15);

    let questions: GeneratedQuestion[];
    try {
      questions = await generateQuestions(course?.title || "the course", contentBlock, safeNum);
    } catch (e) {
      console.error("Claude generation failed:", e);
      return new Response(
        JSON.stringify({ error: `Failed to generate quiz: ${e instanceof Error ? e.message : e}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate
    const validQuestions = questions
      .filter((q) =>
        q.question_text &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        q.options.filter((o) => o.is_correct).length === 1
      )
      .map((q) => ({
        question_text: q.question_text,
        options: q.options.map((o) => ({
          text: o.text,
          is_correct: !!o.is_correct,
          explanation: o.explanation || "",
        })),
        points: typeof q.points === "number" ? q.points : 1,
      }));

    if (validQuestions.length === 0) {
      return new Response(
        JSON.stringify({ error: "Generated questions failed validation" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ questions: validQuestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-quiz error", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
