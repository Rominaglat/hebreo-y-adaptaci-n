// Shared helper: build the FULL text of a lesson by combining
//   1. content_text (HTML stripped)
//   2. transcripts (.txt files referenced in resources_url)
//   3. PDF text (file_url + .pdf entries in resources_url) — extracted via Gemini
//
// Used by kg-extract and kg-embed so both indexers see the same content.
//
// The Gemini PDF call costs ~$0.0001 per page. We accept this because PDFs are
// rare (<50 lessons) and the alternative (pure-Deno PDF parsing) is fragile.

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

interface ResourceItem {
  name?: string;
  url?: string;
}

export function stripHtml(html: string): string {
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

function parseResources(raw: string | null | undefined): ResourceItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ResourceItem[];
    return [];
  } catch {
    return [];
  }
}

async function fetchTextFile(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`fetch ${url} ${resp.status}`);
  }
  return await resp.text();
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`pdf fetch ${url} ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid `String.fromCharCode(...bytes)` which blows the call stack on big files.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Extract text from a PDF via Gemini's inline-data API.
// Limit: ~20 MB inline. Anything larger we skip silently.
async function extractPdfText(url: string): Promise<string> {
  const bytes = await fetchPdfBytes(url);
  if (bytes.byteLength > 18 * 1024 * 1024) {
    return ""; // too big for inline
  }
  const base64 = bytesToBase64(bytes);

  const apiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: "application/pdf", data: base64 } },
        {
          text:
            "Extract the full readable text from this PDF. Preserve paragraph structure. Output the text only, no commentary, no markdown.",
        },
      ],
    }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 8192,
    },
  };

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`gemini pdf ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  // deno-lint-ignore no-explicit-any
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    // deno-lint-ignore no-explicit-any
    .map((p: any) => p.text || "")
    .join("\n")
    .trim();
  return text;
}

export interface LessonRow {
  title?: string | null;
  content_text?: string | null;
  file_url?: string | null;
  resources_url?: string | null;
}

export interface BuildOptions {
  // If true, fetch and inline transcript .txt files
  includeTranscripts?: boolean;
  // If true, fetch PDFs and extract text via Gemini
  includePdfs?: boolean;
  // Hard cap on returned text length (chars)
  maxChars?: number;
}

/**
 * Build the unified text representation of a lesson.
 *
 * Order of inclusion:
 *   1. content_text (HTML stripped)
 *   2. each transcript .txt file from resources_url
 *   3. each PDF (file_url + .pdf entries in resources_url) → Gemini → text
 *
 * Failures on individual files are logged and skipped (best-effort).
 */
export async function buildLessonText(
  lesson: LessonRow,
  opts: BuildOptions = {},
): Promise<{ text: string; sources: string[] }> {
  const {
    includeTranscripts = true,
    includePdfs = true,
    maxChars = 100_000,
  } = opts;

  const parts: string[] = [];
  const sources: string[] = [];

  // 1. content_text
  const cleanHtml = stripHtml(lesson.content_text || "");
  if (cleanHtml) {
    parts.push(cleanHtml);
    sources.push("content_text");
  }

  const resources = parseResources(lesson.resources_url);

  // 2. transcripts (.txt)
  if (includeTranscripts) {
    const txtUrls = resources
      .filter((r) => r.url && /\.txt(\?|$)/i.test(r.url))
      .map((r) => r.url as string);
    for (const url of txtUrls) {
      try {
        const t = (await fetchTextFile(url)).trim();
        if (t) {
          parts.push(`[Transcript]\n${t}`);
          sources.push(`transcript:${url.split("/").pop()}`);
        }
      } catch (e) {
        console.error(`buildLessonText: transcript fetch failed for ${url}:`, e);
      }
    }
  }

  // 3. PDFs (file_url + resources)
  if (includePdfs) {
    const pdfUrls: string[] = [];
    if (lesson.file_url && /\.pdf(\?|$)/i.test(lesson.file_url)) {
      pdfUrls.push(lesson.file_url);
    }
    for (const r of resources) {
      if (r.url && /\.pdf(\?|$)/i.test(r.url)) pdfUrls.push(r.url);
    }
    for (const url of pdfUrls) {
      try {
        const t = await extractPdfText(url);
        if (t) {
          parts.push(`[PDF: ${url.split("/").pop()}]\n${t}`);
          sources.push(`pdf:${url.split("/").pop()}`);
        }
      } catch (e) {
        console.error(`buildLessonText: pdf extraction failed for ${url}:`, e);
      }
    }
  }

  let combined = parts.join("\n\n").slice(0, maxChars);
  return { text: combined, sources };
}
