// ai-assistant — knowledge-graph-backed chat for the portal.
//
// Pipeline per user message:
//   1. Embed the user's last message with Gemini (RETRIEVAL_QUERY)
//   2. Call kg-api /v1/t/{tenant_id}/query to get top-K lesson hits
//      (optionally filtered to a single course_id)
//   3. Build a context-injected prompt with citations
//   4. Call Gemini 2.5 Flash with SSE streaming
//   5. Transform Gemini SSE → OpenAI-format SSE (so the existing useAiChat
//      frontend hook works unchanged)
//   6. Emit unique sources at the end
//   7. Save user + assistant messages to chat_messages
//
// KG-backed chat. No external assistant service used.
//
// Required Supabase secrets:
//   GEMINI_API_KEY, KG_API_URL, KG_API_TOKEN,
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  buildCurrentLessonBlock,
  buildDefaultSystemPrompt,
  scrubInjection,
  stripHtml,
} from "../_shared/assistant-prompt.ts";


const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const KG_API_URL = Deno.env.get("KG_API_URL")!;
const KG_API_TOKEN = Deno.env.get("KG_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Single-tenant: every KG resource lives under this constant namespace,
// matching the value baked into the frontend (src/constants/singleTenant.ts).
const SINGLE_TENANT_ID = "00000000-0000-0000-0000-000000000000";

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 1024;
const CHAT_MODEL = "gemini-2.5-flash";

// Cap each retrieved lesson's snippet so we don't blow the context budget
const MAX_SNIPPET_CHARS = 1500;
// Top K to retrieve from the KG
const TOP_K = 10;

// Retry config for Gemini 429s (free tier is 10 RPM for chat, 100 RPM for embed)
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const resp = await fetch(url, init);
    if (resp.ok) return resp;
    // Non-retryable client error → bubble up immediately
    if (resp.status !== 429 && resp.status < 500) return resp;
    // Last attempt → return as-is so the caller can read the error body
    if (attempt === MAX_RETRIES - 1) return resp;

    // Retryable: honor Retry-After if present, else exponential backoff + jitter
    const retryAfter = resp.headers.get("retry-after");
    const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : NaN;
    const backoffMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? retryAfterMs
      : BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
    console.warn(
      `[${label}] ${resp.status} attempt ${attempt + 1}/${MAX_RETRIES}, ` +
      `backing off ${Math.round(backoffMs)}ms`,
    );
    // Drain body so the connection can be reused for the retry
    try { await resp.text(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, backoffMs));
  }
  // Unreachable — the loop always returns
  throw new Error(`${label}: fetchWithRetry exhausted`);
}

// ─── Gemini embedding ────────────────────────────────────────────────────────

async function embedQuery(text: string): Promise<number[]> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const resp = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBED_DIM,
      }),
    },
    "gemini-embed",
  );
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

// ─── kg-api retrieval ────────────────────────────────────────────────────────

interface RetrievalHit {
  lesson_id: string;
  lesson_title: string | null;
  content: string | null;
  module_id: string | null;
  module_title: string | null;
  course_id: string | null;
  course_title: string | null;
  score: number;
  source: string;
}

interface UserAccess {
  enrolledCourseIds: Set<string>;
  isFullAccess: boolean;  // admin/super_admin/instructor see all courses
}

// deno-lint-ignore no-explicit-any
async function fetchUserAccess(supabase: any, userId: string): Promise<UserAccess> {
  // Admin / super_admin / instructor have access to every course's content
  // for retrieval purposes — they shouldn't be teased with paywall hints.
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = new Set<string>(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
  if (roles.has("admin") || roles.has("super_admin") || roles.has("instructor")) {
    return { enrolledCourseIds: new Set(), isFullAccess: true };
  }

  const { data: enrollRows } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("user_id", userId);
  const enrolledCourseIds = new Set<string>(
    ((enrollRows ?? []) as { course_id: string }[]).map((r) => r.course_id),
  );
  return { enrolledCourseIds, isFullAccess: false };
}

async function retrieve(
  tenantId: string,
  embedding: number[],
  courseId?: string,
): Promise<RetrievalHit[]> {
  const resp = await fetch(`${KG_API_URL}/v1/t/${tenantId}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KG_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_embedding: embedding,
      k: TOP_K,
      expand_via_concepts: !courseId, // graph expansion is less useful inside one course
      course_id: courseId,
    }),
  });
  if (!resp.ok) {
    throw new Error(`kg-api query ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data.hits ?? []) as RetrievalHit[];
}

// ─── Prompt assembly ─────────────────────────────────────────────────────────

function buildContextBlock(hits: RetrievalHit[], access: UserAccess): string {
  if (hits.length === 0) {
    // Explicit "use your teaching knowledge" hint — the empty-context state
    // used to lead Gemini to refuse even basic Hebrew-vocab questions.
    return (
      "(No se encontraron lecciones directamente relevantes en el material del " +
      "curso para esta pregunta. Si la pregunta es de aprendizaje del hebreo " +
      "—vocabulario, gramática, pronunciación, expresiones cotidianas— responde " +
      "como profesora usando tu conocimiento del idioma. Si la pregunta es sobre " +
      "contenido específico del curso, dilo honestamente.)"
    );
  }
  const parts: string[] = [];
  hits.forEach((h, i) => {
    const isLocked =
      !access.isFullAccess &&
      !!h.course_id &&
      !access.enrolledCourseIds.has(h.course_id);

    const header = [
      `## [${i + 1}] ${h.course_title ?? "—"} / ${h.module_title ?? "—"} / ${h.lesson_title ?? "—"}`,
      `course_id: ${h.course_id ?? ""}`,
      `lesson_id: ${h.lesson_id}`,
    ];

    if (isLocked) {
      // LOCKED: the user is NOT enrolled in this course. We expose ONLY the
      // titles + the access flag so the assistant can say "this topic is
      // covered in <course> — you'd need to enroll" without leaking the
      // actual lesson content and without linking to a page the user
      // can't open.
      header.push("ACCESS_STATUS: LOCKED — el usuario NO está inscrito en este curso");
      header.push(
        "(No incluyas el contenido de esta lección en tu respuesta y no enlaces a /courses/<id>?lesson=<id>. " +
        "Puedes mencionar que el tema se cubre en este curso y sugerir inscribirse o adquirirlo.)",
      );
      parts.push(header.join("\n"));
      return;
    }

    // ENROLLED (or full-access role): include the snippet for the model to
    // ground on. We still scrub injection patterns from the lesson content
    // before injection.
    const rawSnippet = stripHtml(h.content || "").slice(0, MAX_SNIPPET_CHARS);
    const snippet = scrubInjection(rawSnippet);
    header.push("ACCESS_STATUS: ENROLLED");
    header.push(
      // Explicit delimiters around the (untrusted) lesson content. The
      // system prompt above tells the model to treat anything between
      // BEGIN_LESSON_CONTENT / END_LESSON_CONTENT as data, not instructions.
      "BEGIN_LESSON_CONTENT",
      snippet || "(אין תוכן טקסטואלי זמין)",
      "END_LESSON_CONTENT",
    );
    parts.push(header.join("\n"));
  });
  return parts.join("\n\n---\n\n");
}

// ─── Gemini streaming call ───────────────────────────────────────────────────

interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

/**
 * Convert OpenAI-style messages to Gemini contents.
 * - "assistant" → "model"
 * - Drops messages with empty/whitespace-only content (Gemini rejects empty parts)
 * - Collapses consecutive same-role messages by joining their text (Gemini
 *   requires strict user/model alternation; consecutive same-role would 400)
 */
function toGeminiMessages(
  messages: { role: string; content: string }[],
): GeminiMessage[] {
  const out: GeminiMessage[] = [];
  for (const m of messages) {
    const text = (m.content || "").trim();
    if (!text) continue;
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) {
      // Merge into the previous message instead of creating an invalid sequence
      last.parts[0].text = `${last.parts[0].text}\n\n${text}`;
    } else {
      out.push({ role, parts: [{ text }] });
    }
  }
  return out;
}

async function callGeminiStream(
  systemInstruction: string,
  contents: GeminiMessage[],
): Promise<Response> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
  // NOTE: systemInstruction does NOT take a `role` field — passing it causes
  // 400 errors on multi-turn requests.
  return await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          temperature: 0.3,
          topP: 0.95,
          // 8192 is Gemini 2.5 Flash's max output. Hebrew + URLs use a lot of
          // tokens; 2048 was too low and caused mid-response truncation.
          maxOutputTokens: 8192,
        },
      }),
    },
    "gemini-chat",
  );
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const messages = body.messages as { role: string; content: string }[] | undefined;
    const conversation_id = body.conversation_id as string | undefined;
    let course_id = body.course_id as string | undefined;
    // The lesson open on the student's screen (CourseDetail), if any.
    const lesson_id = typeof body.lesson_id === "string" ? body.lesson_id : undefined;
    // Single-tenant: server-side constant, no longer accepted from the body.
    const tenant_id = SINGLE_TENANT_ID;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    // Lead tier (preview / sales accounts) is not entitled to the AI
    // assistant. The frontend hides the FAB but a determined lead could
    // POST here directly with their session token — block them server-
    // side so the assistant ToS / token cost stays paid-tier-only.
    {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const allRoles = new Set<string>(((roleRows ?? []) as { role: string }[]).map((r) => r.role));
      const hasNonLeadRole = ["admin", "super_admin", "instructor", "student"].some((r) =>
        allRoles.has(r),
      );
      if (!hasNonLeadRole && allRoles.has("lead")) {
        return new Response(JSON.stringify({ error: "forbidden_for_lead" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // SEC-012 — per-user rate limit (20/min)
    const rl = await checkRateLimit(supabase, `ai-assistant:${user.id}`, 20);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "rate_limit" }), {
        status: 429,
        headers: { ...corsHeaders, ...rl.headers, "Content-Type": "application/json" },
      });
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";

    // The conversation must be the caller's: the service-role client below
    // would otherwise write into anyone's conversation id it was handed.
    if (conversation_id) {
      const { data: conv } = await supabase
        .from("chat_conversations")
        .select("user_id")
        .eq("id", conversation_id)
        .maybeSingle();
      if (!conv || (conv as { user_id: string }).user_id !== user.id) {
        return new Response(JSON.stringify({ error: "conversation_not_found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Save the user message immediately (idempotent-ish: if retries happen,
    // we'd have dupes, but chat UIs tolerate this)
    if (conversation_id) {
      await supabase.from("chat_messages").insert({
        conversation_id, role: "user", content: lastUserMessage,
      });
    }

    // Fetch assistant customization (single-tenant: at most one row).
    let customSystemPrompt: string | null = null;
    let customAssistantName: string | null = null;
    try {
      const { data: tenantSettings } = await supabase
        .from("tenant_settings")
        .select("ai_assistant_name, ai_assistant_system_prompt")
        .limit(1)
        .maybeSingle();
      const row = tenantSettings as
        | { ai_assistant_name?: string | null; ai_assistant_system_prompt?: string | null }
        | null;
      customSystemPrompt = row?.ai_assistant_system_prompt?.trim() || null;
      customAssistantName = row?.ai_assistant_name?.trim() || null;
    } catch (e) {
      console.warn("tenant_settings assistant columns missing — skipping", e);
    }

    // Resolve the asking user's course access (enrollments + role overrides)
    // BEFORE retrieving hits — we use the access map to decide which hits
    // contribute full content vs. a "locked, enroll to access" hint.
    let access: UserAccess;
    try {
      access = await fetchUserAccess(supabase, user.id);
    } catch (e) {
      console.error("access lookup failed, defaulting to no enrollments:", e);
      access = { enrolledCourseIds: new Set(), isFullAccess: false };
    }

    // The lesson on screen: pinned above the retrieved hits so "resúmeme esta
    // lección" works. Only for a lesson the student may open (staff, or
    // enrolled in its course) — anything else is silently ignored.
    let currentLessonBlock = "";
    if (lesson_id) {
      try {
        const { data: lessonRow } = await supabase
          .from("lessons")
          .select("id, title, lesson_type, content_text, file_url, modules(title, course_id, courses(title))")
          .eq("id", lesson_id)
          .maybeSingle();
        // deno-lint-ignore no-explicit-any
        const l = lessonRow as any;
        const lessonCourseId: string | undefined = l?.modules?.course_id;
        if (l && lessonCourseId && (access.isFullAccess || access.enrolledCourseIds.has(lessonCourseId))) {
          currentLessonBlock = buildCurrentLessonBlock({
            courseId: lessonCourseId,
            lessonId: l.id,
            courseTitle: l.modules?.courses?.title ?? null,
            moduleTitle: l.modules?.title ?? null,
            lessonTitle: l.title ?? null,
            lessonType: l.lesson_type ?? null,
            hasFile: !!l.file_url,
            content: l.content_text ?? null,
          });
          course_id = course_id ?? lessonCourseId;
        }
      } catch (e) {
        console.error("current lesson lookup failed:", e);
      }
    }

    // Retrieve from KG
    let hits: RetrievalHit[] = [];
    try {
      const embedding = await embedQuery(lastUserMessage);
      hits = await retrieve(tenant_id, embedding, course_id);
    } catch (e) {
      console.error("retrieval failed:", e);
      // Continue with empty context — the LLM will say it has no info
    }

    // Build system prompt. A custom prompt from the settings page replaces the
    // default; the default now carries the configured name ("Romina AI").
    const baseSystem = customSystemPrompt
      ? (customAssistantName
        ? `שמך הוא "${customAssistantName}". ${customSystemPrompt}`
        : customSystemPrompt)
      : buildDefaultSystemPrompt(customAssistantName);

    const contextBlock = buildContextBlock(hits, access);
    const systemInstruction =
      `${baseSystem}\n\n` +
      (currentLessonBlock ? `${currentLessonBlock}\n\n` : "") +
      `# חומרי לימוד רלוונטיים (ממוינים לפי רלוונטיות):\n${contextBlock}`;

    // Convert the entire conversation to Gemini contents. The helper handles
    // role mapping, drops empty messages, and collapses consecutive same-role
    // messages so Gemini's strict user/model alternation is always satisfied.
    const geminiContents = toGeminiMessages(messages);

    // Gemini requires the last message to be from "user". If somehow it isn't
    // (e.g. trailing assistant message), append the latest user text manually.
    if (geminiContents.length === 0 || geminiContents[geminiContents.length - 1].role !== "user") {
      geminiContents.push({ role: "user", parts: [{ text: lastUserMessage || " " }] });
    }

    const lockedHits = access.isFullAccess
      ? 0
      : hits.filter((h) => h.course_id && !access.enrolledCourseIds.has(h.course_id)).length;
    console.log(
      `[ai-assistant] tenant=${tenant_id} conv=${conversation_id} ` +
      `msgs_in=${messages.length} contents_out=${geminiContents.length} ` +
      `hits=${hits.length} locked=${lockedHits} ` +
      `enrolled_courses=${access.enrolledCourseIds.size} full_access=${access.isFullAccess}`,
    );

    const geminiResp = await callGeminiStream(systemInstruction, geminiContents);
    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error(
        `[ai-assistant] gemini ${geminiResp.status} for conv=${conversation_id}:`,
        errText.slice(0, 500),
      );
      if (geminiResp.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limit" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // SEC-016 — do not leak Gemini error text to the client. Server-side
      // log above retains the detail for debugging.
      return new Response(JSON.stringify({ error: "chat_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Transform Gemini SSE → OpenAI SSE
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      const reader = geminiResp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let lastFinishReason: string | null = null;

      // deno-lint-ignore no-explicit-any
      const processEvent = async (event: any) => {
        const candidate = event?.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        // deno-lint-ignore no-explicit-any
        const text = parts.map((p: any) => p?.text ?? "").join("");
        if (text) {
          fullContent += text;
          const chunk = JSON.stringify({ choices: [{ delta: { content: text } }] });
          await writer.write(encoder.encode(`data: ${chunk}\n\n`));
        }
        if (candidate?.finishReason) {
          lastFinishReason = candidate.finishReason;
        }
      };

      const processLine = async (line: string) => {
        if (!line.startsWith("data: ")) return;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") return;
        try {
          await processEvent(JSON.parse(jsonStr));
        } catch {
          /* ignore parse errors */
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).trimEnd();
            buffer = buffer.slice(newlineIdx + 1);
            await processLine(line);
          }
        }
        // Flush trailing buffer (if the last event arrived without a newline)
        const flush = decoder.decode();
        if (flush) buffer += flush;
        if (buffer.trim()) {
          for (const line of buffer.split("\n")) {
            await processLine(line.trimEnd());
          }
        }

        if (lastFinishReason && lastFinishReason !== "STOP") {
          console.warn(
            `[ai-assistant] gemini finishReason=${lastFinishReason} ` +
            `len=${fullContent.length} conv=${conversation_id}`,
          );
        }

        // Build unique sources from retrieval hits (not from LLM output).
        // We only emit sources the user actually has access to — emitting a
        // locked lesson would render as a clickable card that 403s on click.
        const seen = new Set<string>();
        const sources: { course_id: string; course_title: string; lesson_id: string; lesson_title: string | null }[] = [];
        for (const h of hits) {
          if (!h.course_id || !h.lesson_id) continue;
          const isLocked =
            !access.isFullAccess && !access.enrolledCourseIds.has(h.course_id);
          if (isLocked) continue;
          const key = `${h.course_id}:${h.lesson_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          sources.push({
            course_id: h.course_id,
            course_title: h.course_title ?? "",
            lesson_id: h.lesson_id,
            lesson_title: h.lesson_title,
          });
        }
        // Legacy frontend expects unique by course_id; send both shapes
        const uniqueCourses = sources.filter((s, i, arr) =>
          arr.findIndex((x) => x.course_id === s.course_id) === i
        );
        if (uniqueCourses.length > 0) {
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ sources: uniqueCourses })}\n\n`),
          );
        }

        // An empty answer (safety stop, truncated stream) used to leave the
        // student with nothing at all. Say so instead.
        if (!fullContent.trim()) {
          fullContent = "No pude generar una respuesta esta vez. ¿Puedes reformular la pregunta o intentarlo de nuevo?";
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\n`),
          );
        }

        // Persist the answer BEFORE closing the stream, and hand its id to the
        // client — the 👍/👎 buttons rate this exact message.
        if (conversation_id) {
          const { data: saved, error: saveErr } = await supabase.from("chat_messages").insert({
            conversation_id, role: "assistant", content: fullContent,
            sources: uniqueCourses.length > 0 ? uniqueCourses : null,
          }).select("id").single();
          if (saveErr) console.error("[ai-assistant] saving answer failed:", saveErr.message);
          if (saved?.id) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ message_id: saved.id })}\n\n`));
          }
        }
        await writer.write(encoder.encode("data: [DONE]\n\n"));

        if (conversation_id) {
          if (lastUserMessage) {
            const title = lastUserMessage.slice(0, 50) + (lastUserMessage.length > 50 ? "..." : "");
            await supabase
              .from("chat_conversations")
              .update({ title, updated_at: new Date().toISOString() })
              .eq("id", conversation_id)
              // The client names a new conversation in the UI language
              // ('aiChat.newChat'); matching only the Hebrew one left every
              // Spanish conversation titled "Nueva conversación" forever.
              .in("title", ["שיחה חדשה", "New chat", "Nueva conversación"]);
          }
        }
      } catch (e) {
        console.error("stream processing error:", e);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
