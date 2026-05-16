// Transcribe and summarize a lesson video using Gemini.
// - YouTube URLs: passed directly to Gemini as fileData (no download needed)
// - Vimeo / other URLs: resolved to a direct media URL via the yt-dlp helper service,
//   then downloaded and uploaded to Gemini Files API
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com";

const SYSTEM_PROMPT_HE = `אתה מקבל וידאו של שיעור. עליך להפיק:
1. תמלול מלא ומדויק של דברי המורה.
2. סיכום מובנה לפי הפורמט הבא, ב־HTML נקי עם <h3>, <p>, <ul>, <li>, <strong>:

🎯 מטרת השיעור — 2 משפטים על הנושא ומה התלמידים אמורים ללמוד.
📁 משאבים שימושיים — רשימה ממוספרת של כל משאב שהוזכר (מאמרים, אתרים, ספרים, מצגות) כולל קישור אם נזכר. אם אין — "לא צויינו משאבים במהלך השיעור."
📌 נקודות מרכזיות — 2–6 נקודות עם כותרת קצרה והסבר של עד 5 משפטים לכל אחת.
📝 סיכום השיעור — פסקה קצרה (1–2 משפטים) שמסכמת את השיעור. אם הוזכרו שיעורי בית, הוסף אותם כאן.

הנחיות:
- השתמש באייקונים 🎯📁📌📝 בדיוק כפי שמופיע.
- אל תשתמש בציטוטים ישירים, נסח בלשון סיכום.
- הימנע ממידע לא רלוונטי או שיחות חולין.
- כתוב את כל הסיכום בעברית.

החזר את התוצאה כ־JSON תקין בלבד (ללא markdown fences, ללא טקסט נוסף):
{"transcript": "<full transcript text>", "summary": "<HTML summary>"}`;

const SYSTEM_PROMPT_EN = `You are given a lesson video. Produce:
1. A complete and accurate transcript of the speaker's words.
2. A structured summary in clean HTML using <h3>, <p>, <ul>, <li>, <strong>, in this format:

🎯 Lesson Goal — 2 sentences on the topic and what students should learn.
📁 Useful Resources — numbered list of every resource mentioned (articles, websites, books, slides) including links if given. If none — "No resources were mentioned in this lesson."
📌 Key Points — 2–6 points, each with a short title and an explanation of up to 5 sentences.
📝 Lesson Summary — short paragraph (1–2 sentences) that ties the goal to what was actually taught. If homework was mentioned, include it here.

Guidelines:
- Use the icons 🎯📁📌📝 exactly as shown.
- Do not use direct quotes; phrase as a summary.
- Avoid irrelevant material or small talk.
- Write the entire summary in English.

Return the result as valid JSON only (no markdown fences, no extra text):
{"transcript": "<full transcript text>", "summary": "<HTML summary>"}`;

// SEC-010 — URL allowlist + SSRF guards.
// Only YouTube / Vimeo are accepted as user-supplied video sources. Everything
// else (private IPs, cloud metadata endpoints, internal hosts) is rejected
// before any fetch is issued.
const ALLOWED_VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

// Vimeo CDN media URLs returned by the yt-dlp resolver land on these hosts.
// Used to validate the resolved URL before we hand it to Gemini.
const ALLOWED_MEDIA_HOST_SUFFIXES = [
  ".vimeocdn.com",
  ".akamaized.net",
  ".cloudfront.net",
  ".googlevideo.com",
];

function isPrivateOrLoopbackHost(host: string): boolean {
  // IPv4 literals
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  // IPv6 literals: refuse anything inside brackets
  if (host.startsWith("[") && host.endsWith("]")) return true;
  // common internal names
  const lower = host.toLowerCase();
  if (lower === "localhost") return true;
  if (lower === "metadata.google.internal") return true;
  if (lower.endsWith(".internal")) return true;
  if (lower.endsWith(".local")) return true;
  return false;
}

function validateVideoUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "video_url is not a valid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "video_url protocol must be http(s)" };
  }
  if (isPrivateOrLoopbackHost(url.hostname)) {
    return { ok: false, error: "video_url host is not allowed" };
  }
  if (!ALLOWED_VIDEO_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, error: "video_url host is not on the allowlist" };
  }
  return { ok: true, url };
}

function validateResolvedMediaUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "resolved media URL is not valid" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "resolved media URL must be https" };
  }
  if (isPrivateOrLoopbackHost(url.hostname)) {
    return { ok: false, error: "resolved media URL host is not allowed" };
  }
  const lower = url.hostname.toLowerCase();
  const okHost =
    ALLOWED_VIDEO_HOSTS.has(lower) ||
    ALLOWED_MEDIA_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
  if (!okHost) {
    return { ok: false, error: "resolved media URL host is not on the allowlist" };
  }
  return { ok: true, url };
}

const REFERER_ALLOWED_HOSTS = new Set([
  "app.example.com",
  "example.com",
  "www.example.com",
]);

function validateRefererUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (isPrivateOrLoopbackHost(url.hostname)) return null;
    if (REFERER_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// Gemini Files API: upload a remote file (Vimeo, etc.)
// ============================================================

async function uploadFileToGemini(
  mediaUrl: string,
  apiKey: string,
  referer?: string,
): Promise<{ fileUri: string; mimeType: string }> {
  console.log("Downloading media from:", mediaUrl.substring(0, 100));
  const mediaResp = await fetch(mediaUrl, {
    headers: referer ? { Referer: referer } : {},
  });
  if (!mediaResp.ok) {
    throw new Error(`Failed to download media: ${mediaResp.status}`);
  }
  const mimeType = mediaResp.headers.get("content-type") || "video/mp4";
  const contentLength = mediaResp.headers.get("content-length");
  const blob = await mediaResp.blob();
  console.log(`Media downloaded: ${mimeType}, ${contentLength || blob.size} bytes`);

  // Resumable upload init
  const initResp = await fetch(
    `${GEMINI_BASE}/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(blob.size),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: `lesson_${Date.now()}` } }),
    },
  );
  if (!initResp.ok) {
    throw new Error(`Gemini upload init failed: ${initResp.status} ${await initResp.text()}`);
  }
  const uploadUrl = initResp.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini upload init: missing upload URL");

  // Upload bytes
  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(blob.size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: blob,
  });
  if (!uploadResp.ok) {
    throw new Error(`Gemini upload bytes failed: ${uploadResp.status} ${await uploadResp.text()}`);
  }
  const uploadResult = await uploadResp.json();
  const fileUri: string = uploadResult.file?.uri;
  const fileName: string = uploadResult.file?.name;
  if (!fileUri || !fileName) throw new Error("Gemini upload: missing file URI in response");
  console.log("Uploaded to Gemini:", fileName);

  // Poll for ACTIVE state
  const startPoll = Date.now();
  const maxPollMs = 5 * 60 * 1000;
  while (Date.now() - startPoll < maxPollMs) {
    const stateResp = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${apiKey}`);
    if (stateResp.ok) {
      const state = await stateResp.json();
      if (state.state === "ACTIVE") {
        console.log("Gemini file ACTIVE");
        return { fileUri, mimeType };
      }
      if (state.state === "FAILED") {
        throw new Error(`Gemini file processing failed: ${JSON.stringify(state)}`);
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("Gemini file processing timed out");
}

// ============================================================
// Gemini generateContent: transcript + summary in one call
// ============================================================

interface GeminiPart {
  text?: string;
  fileData?: { fileUri: string; mimeType: string };
}

async function callGemini(
  apiKey: string,
  parts: GeminiPart[],
  systemInstruction: string,
): Promise<{ transcript: string; summary: string }> {
  const resp = await fetch(
    `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini generateContent failed: ${resp.status} ${errText.substring(0, 500)}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini returned empty response: ${JSON.stringify(data).substring(0, 500)}`);
  }

  let parsed: any;
  try {
    // Strip any accidental markdown fences just in case
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON response: ${(e as Error).message}\nGot: ${text.substring(0, 500)}`);
  }

  return {
    transcript: parsed.transcript || "",
    summary: parsed.summary || "",
  };
}

// ── Main handler ──

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== TRANSCRIBE-LESSON START ===");
    const startTime = Date.now();

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    console.log("User:", user.id);

    // Input + SSRF-safe URL validation (SEC-010)
    const { video_url, language = "he", referer_url } = await req.json();
    if (!video_url || typeof video_url !== "string") {
      return json({ error: "video_url is required" }, 400);
    }
    const urlCheck = validateVideoUrl(video_url);
    if (!urlCheck.ok) {
      console.warn("[transcribe] rejected video_url:", urlCheck.error);
      return json({ error: urlCheck.error }, 400);
    }
    const safeRefererUrl = validateRefererUrl(referer_url) ?? "https://example.com/";
    console.log("Input:", { video_url: video_url.substring(0, 80), language });

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not configured" }, 500);

    const YTDLP_SERVICE_URL = Deno.env.get("YTDLP_SERVICE_URL");
    const YTDLP_SERVICE_KEY = Deno.env.get("YTDLP_SERVICE_KEY");

    const isYouTube = /(?:youtube\.com|youtu\.be)\//.test(video_url);
    const isVimeo = /vimeo\.com\//.test(video_url);
    const systemPrompt = language === "he" ? SYSTEM_PROMPT_HE : SYSTEM_PROMPT_EN;

    // Build the parts for Gemini
    let parts: GeminiPart[];

    if (isYouTube) {
      // Gemini supports YouTube URLs natively
      console.log("=== USING YOUTUBE URL DIRECTLY ===");
      parts = [
        { fileData: { fileUri: video_url, mimeType: "video/*" } },
        { text: "Transcribe and summarize this lesson video." },
      ];
    } else {
      // Vimeo or other source: resolve to direct URL via yt-dlp helper, then upload to Gemini
      let mediaUrl = video_url;
      if (isVimeo) {
        if (!YTDLP_SERVICE_URL) {
          throw new Error("YTDLP_SERVICE_URL not configured (required for Vimeo)");
        }
        console.log("=== RESOLVING VIMEO VIA YT-DLP SERVICE ===");
        const svcResp = await fetch(`${YTDLP_SERVICE_URL}/get-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(YTDLP_SERVICE_KEY ? { Authorization: `Bearer ${YTDLP_SERVICE_KEY}` } : {}),
          },
          body: JSON.stringify({ video_url, referer_url: safeRefererUrl }),
        });
        if (!svcResp.ok) {
          const err = await svcResp.json().catch(() => ({}));
          throw new Error(`yt-dlp service failed: ${(err as any).error || svcResp.status}`);
        }
        const { url: resolvedUrl } = await svcResp.json();
        const resolvedCheck = validateResolvedMediaUrl(resolvedUrl);
        if (!resolvedCheck.ok) {
          console.warn("[transcribe] rejected resolved media URL:", resolvedCheck.error);
          return json({ error: "Resolved media URL is not allowed" }, 502);
        }
        mediaUrl = resolvedCheck.url.toString();
        console.log("Resolved URL:", mediaUrl.substring(0, 80));
      }

      console.log("=== UPLOADING TO GEMINI FILES API ===");
      const { fileUri, mimeType } = await uploadFileToGemini(
        mediaUrl,
        GEMINI_API_KEY,
        isVimeo ? safeRefererUrl : undefined,
      );
      parts = [
        { fileData: { fileUri, mimeType } },
        { text: "Transcribe and summarize this lesson video." },
      ];
    }

    // ── Call Gemini for transcript + summary ──
    console.log("=== CALLING GEMINI ===");
    const { transcript, summary } = await callGemini(GEMINI_API_KEY, parts, systemPrompt);
    console.log(`Got transcript (${transcript.length} chars) and summary (${summary.length} chars)`);

    if (!transcript) {
      throw new Error("Gemini returned an empty transcript");
    }

    // ── Save transcript to PRIVATE bucket; serve via signed URL (SEC-029) ──
    // Single-tenant: every transcript lives under the same constant prefix.
    console.log("=== SAVING TRANSCRIPT ===");
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const filePath = `${user.id}/${Date.now()}_transcript.txt`;
    const blob = new Blob([transcript], { type: "text/plain" });

    const { error: uploadErr } = await serviceClient.storage
      .from("transcripts")
      .upload(filePath, blob, { contentType: "text/plain", upsert: false });
    if (uploadErr) console.error("Storage error:", uploadErr);

    // Signed URL valid for 24h. Callers that need a longer-lived link can
    // ask for a fresh signed URL from a dedicated endpoint.
    const { data: signed } = await serviceClient.storage
      .from("transcripts")
      .createSignedUrl(filePath, 60 * 60 * 24);
    const transcriptFileUrl = signed?.signedUrl ?? "";
    console.log("Transcript URL (signed, 24h):", transcriptFileUrl ? "<set>" : "<unset>");

    console.log("=== DONE ===", Math.round((Date.now() - startTime) / 1000), "seconds");
    return json({ summary, transcript_text: transcript, transcript_file_url: transcriptFileUrl });
  } catch (error) {
    console.error("FATAL:", error);
    // Do not leak internal error messages to the client (defense-in-depth).
    return json({ error: "transcription_failed" }, 500);
  }
});
