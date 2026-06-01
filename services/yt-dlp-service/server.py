"""
Async transcription microservice (Gemini-only).
POST /transcribe → starts job in background, returns { job_id }
GET  /status/<job_id> → returns { status, progress, summary, transcript_text, transcript_file_url, error }
GET  /health → env check
"""
import os
import glob
import json
import re
import subprocess
import tempfile
import time
import uuid
import threading
from urllib.parse import urlparse
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

for _var in ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"]:
    print(f"  {_var}: {'SET' if os.environ.get(_var) else 'MISSING'}")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
# YouTube cookies (Netscape cookies.txt format). Required for restricted /
# age-gated / unlisted-w-bot-detection videos. Paste the full file contents
# into the YT_DLP_COOKIES env var on Railway.
YT_DLP_COOKIES = os.environ.get("YT_DLP_COOKIES", "")
COOKIES_FILE = "/tmp/yt-dlp-cookies.txt"
if YT_DLP_COOKIES:
    try:
        with open(COOKIES_FILE, "w", encoding="utf-8") as _fh:
            _fh.write(YT_DLP_COOKIES)
        print(f"  YT_DLP_COOKIES: written to {COOKIES_FILE}")
    except Exception as _e:
        print(f"  YT_DLP_COOKIES: failed to write — {_e}")
        COOKIES_FILE = ""
else:
    COOKIES_FILE = ""

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_BASE = "https://generativelanguage.googleapis.com"

jobs = {}

# ────────────────────────────────────────────────────────────────
# Two-pass transcribe + summarize:
#   Pass 1 — audio → plain-text transcript      (65k-token budget)
#   Pass 2 — transcript → structured HTML summary (16k-token budget)
#
# We previously packed both into one JSON response sharing an 8k-token
# budget, which silently truncated long lessons mid-output — users got
# a half summary, or transcript-only with an empty summary. Splitting
# into two calls means neither side can starve the other.
# ────────────────────────────────────────────────────────────────

TRANSCRIBE_PROMPT_HE = (
    "תמלל את האודיו/וידאו הזה של שיעור בעברית במלואו ובדיוק. "
    "החזר אך ורק את הטקסט המתומלל — בלי כותרות, בלי הערות, בלי JSON, בלי markdown."
)
TRANSCRIBE_PROMPT_EN = (
    "Transcribe this lesson audio/video verbatim. "
    "Return only the transcript text — no headings, no commentary, no JSON, no markdown."
)
TRANSCRIBE_PROMPT_ES = (
    "Transcribe este audio/video de la clase de forma íntegra y literal. "
    "Devuelve solo el texto transcrito — sin encabezados, sin comentarios, sin JSON, sin markdown."
)

SUMMARIZE_PROMPT_HE = """אתה מקבל תמלול של שיעור. הפק סיכום מובנה ב־HTML נקי בלבד, באמצעות <h3>, <p>, <ul>, <li>, <strong>, בפורמט הבא:

🎯 מטרת השיעור — 2 משפטים על הנושא ומה התלמידים אמורים ללמוד.
📁 משאבים שימושיים — רשימה ממוספרת של כל משאב שהוזכר (מאמרים, אתרים, ספרים, מצגות) כולל קישור אם נזכר. אם אין — "לא צויינו משאבים במהלך השיעור."
📌 נקודות מרכזיות — 2–6 נקודות עם כותרת קצרה והסבר של עד 5 משפטים לכל אחת.
📝 סיכום השיעור — פסקה קצרה (1–2 משפטים) שמסכמת את השיעור. אם הוזכרו שיעורי בית, הוסף אותם כאן.

הנחיות:
- השתמש באייקונים 🎯📁📌📝 בדיוק כפי שמופיע.
- אל תשתמש בציטוטים ישירים, נסח בלשון סיכום.
- הימנע ממידע לא רלוונטי או שיחות חולין.
- כתוב את כל הסיכום בעברית.
- החזר אך ורק את ה־HTML של הסיכום, ללא JSON וללא ```html fences."""

SUMMARIZE_PROMPT_EN = """You are given a lesson transcript. Produce a structured summary in clean HTML only, using <h3>, <p>, <ul>, <li>, <strong>, in this format:

🎯 Lesson Goal — 2 sentences on the topic and what students should learn.
📁 Useful Resources — numbered list of every resource mentioned (articles, websites, books, slides) including links if given. If none — "No resources were mentioned in this lesson."
📌 Key Points — 2–6 points, each with a short title and an explanation of up to 5 sentences.
📝 Lesson Summary — short paragraph (1–2 sentences) that ties the goal to what was actually taught. If homework was mentioned, include it here.

Guidelines:
- Use the icons 🎯📁📌📝 exactly as shown.
- Do not use direct quotes; phrase as a summary.
- Avoid irrelevant material or small talk.
- Write the entire summary in English.
- Return only the HTML for the summary — no JSON, no ```html fences."""

SUMMARIZE_PROMPT_ES = """Recibes la transcripción de una clase. Produce un resumen estructurado únicamente en HTML limpio, usando <h3>, <p>, <ul>, <li>, <strong>, con este formato:

🎯 Objetivo de la clase — 2 oraciones sobre el tema y lo que los estudiantes deben aprender.
📁 Recursos útiles — lista numerada de cada recurso mencionado (artículos, sitios web, libros, presentaciones) incluyendo enlaces si se mencionan. Si no hay — "No se mencionaron recursos en esta clase."
📌 Puntos clave — entre 2 y 6 puntos, cada uno con un título corto y una explicación de hasta 5 oraciones.
📝 Resumen de la clase — un párrafo breve (1–2 oraciones) que conecte el objetivo con lo realmente enseñado. Si se mencionó tarea, inclúyela aquí.

Directrices:
- Usa los iconos 🎯📁📌📝 exactamente como aparecen.
- No uses citas directas; redacta como resumen.
- Evita material irrelevante o conversación informal.
- Escribe todo el resumen en español.
- Devuelve solo el HTML del resumen — sin JSON, sin bloques ```html."""


def verify_supabase_auth(token):
    if not SUPABASE_URL:
        print("ERROR: SUPABASE_URL not set")
        return None
    apikey = SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY
    if not apikey:
        print("ERROR: No Supabase API key available")
        return None
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": apikey},
            timeout=10,
        )
        if resp.status_code != 200:
            print(f"Auth failed: {resp.status_code} {resp.text[:200]}")
            return None
        return resp.json()
    except Exception as e:
        print(f"Auth error: {e}")
        return None


def gemini_upload_file(file_path, mime_type):
    """Upload a local file to Gemini Files API. Returns the file URI."""
    file_size = os.path.getsize(file_path)
    display_name = os.path.basename(file_path)

    # Step 1: initiate resumable upload
    start = requests.post(
        f"{GEMINI_BASE}/upload/v1beta/files?key={GEMINI_API_KEY}",
        headers={
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(file_size),
            "X-Goog-Upload-Header-Content-Type": mime_type,
            "Content-Type": "application/json",
        },
        data=json.dumps({"file": {"display_name": display_name}}),
        timeout=30,
    )
    if start.status_code != 200:
        raise RuntimeError(f"Gemini upload init failed: {start.status_code} {start.text[:300]}")

    upload_url = start.headers.get("X-Goog-Upload-URL") or start.headers.get("x-goog-upload-url")
    if not upload_url:
        raise RuntimeError("Gemini upload init missing X-Goog-Upload-URL header")

    # Step 2: upload the bytes and finalize
    with open(file_path, "rb") as fh:
        upload = requests.post(
            upload_url,
            headers={
                "Content-Length": str(file_size),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
            },
            data=fh,
            timeout=600,
        )
    if upload.status_code != 200:
        raise RuntimeError(f"Gemini upload failed: {upload.status_code} {upload.text[:300]}")

    info = upload.json().get("file", {})
    uri = info.get("uri")
    name = info.get("name", "")
    # IMPORTANT: do NOT default to ACTIVE. Video uploads almost always come
    # back as PROCESSING, and if we skip the poll Gemini's generateContent
    # immediately returns FAILED_PRECONDITION ("file is not in an ACTIVE
    # state"). Treat a missing state as "needs polling".
    state = info.get("state") or "PROCESSING"
    if not uri:
        raise RuntimeError(f"Gemini upload returned no URI: {info}")

    # Step 3: poll until ACTIVE (or fail loudly). Large videos can take
    # over a minute on Gemini's side; allow up to 5 minutes.
    if state != "ACTIVE":
        if not name:
            raise RuntimeError(f"Gemini upload missing `name`, can't poll for state: {info}")
        for _ in range(150):  # 150 * 2s = 5 min
            time.sleep(2)
            poll = requests.get(
                f"{GEMINI_BASE}/v1beta/{name}?key={GEMINI_API_KEY}", timeout=10,
            )
            if poll.status_code != 200:
                continue
            poll_state = (poll.json() or {}).get("state", "")
            if poll_state == "ACTIVE":
                state = "ACTIVE"
                break
            if poll_state == "FAILED":
                err = poll.json().get("error", {})
                raise RuntimeError(f"Gemini file processing FAILED: {err}")
        else:
            raise RuntimeError("Gemini file did not become ACTIVE within 5 minutes")

    return uri


class GeminiPermissionError(RuntimeError):
    """Raised when Gemini returns 403 — typically for a YouTube URL that the
    API key project isn't allowed to access (free-tier quota or feature not
    enabled). The caller can fall back to yt-dlp + Files API upload."""


def _gemini_call(payload, action_label):
    """Shared Gemini POST + finishReason handling. Returns the response text.
    Raises GeminiPermissionError on 403 and RuntimeError with a clear message
    on MAX_TOKENS / empty / non-200 responses."""
    resp = requests.post(
        f"{GEMINI_BASE}/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=600,
    )
    if resp.status_code == 403:
        raise GeminiPermissionError(f"Gemini denied (403): {resp.text[:300]}")
    if resp.status_code != 200:
        # Diagnostic dump: 400s from Gemini are often generic ("invalid
        # argument") with the real cause hidden in `error.details`. Print
        # the full response + the parts we sent (minus file bytes) so the
        # next failure leaves a paper trail in Railway logs.
        try:
            parts = payload.get("contents", [{}])[0].get("parts", [])
            parts_summary = [
                {"fileData": {"fileUri": p["fileData"].get("fileUri", "")[:120],
                              "mimeType": p["fileData"].get("mimeType")}}
                if "fileData" in p
                else {"text_len": len(p.get("text", ""))}
                for p in parts
            ]
        except Exception:
            parts_summary = "(parts dump failed)"
        print(
            f"[gemini] {action_label} {resp.status_code} — model={GEMINI_MODEL} "
            f"genConfig={payload.get('generationConfig')} parts={parts_summary}"
        )
        print(f"[gemini] {action_label} body: {resp.text}")
        raise RuntimeError(
            f"Gemini {action_label} failed: {resp.status_code} {resp.text}"
        )

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise RuntimeError(f"Gemini {action_label} returned no candidates: {data}")
    finish_reason = candidates[0].get("finishReason", "")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts).strip()
    if finish_reason == "MAX_TOKENS":
        # Hard-fail instead of returning a half-baked result. Callers surface
        # this to the user so they know to shorten the lesson or split it.
        raise RuntimeError(
            f"Gemini {action_label} hit the output-token cap — the lesson is "
            f"too long for a single pass. Got {len(text)} chars before truncation."
        )
    if not text:
        raise RuntimeError(
            f"Gemini {action_label} returned empty text (finishReason={finish_reason!r})"
        )
    return text


def gemini_transcribe(file_uri, mime_type, language):
    """Pass 1: audio/video → plain-text transcript.

    Gemini 2.5 Flash's per-response output cap is 8192 tokens (an earlier
    version of this file used 65536 by mistake — that's the 2.5 Pro
    number — and triggered 400 INVALID_ARGUMENT). Long lessons can still
    blow this; _gemini_call surfaces finishReason=MAX_TOKENS so the
    caller fails loud instead of returning half a transcript."""
    # Gemini's fileData rules (current API behavior, 2026):
    #   - wildcards like "video/*" → 400 INVALID_ARGUMENT
    #   - omitting mimeType on a YouTube URL → Gemini does a plain HTTP
    #     GET, hits the YouTube watch page, returns "Unsupported MIME
    #     type: text/html" 400. Counter-intuitive but verified empirically.
    #   - application/octet-stream → also rejected.
    # The safe answer is to always send a concrete mime. For YouTube URLs
    # the caller passes "video/mp4" explicitly; for uploaded files we use
    # MIME_BY_EXT. If the caller passes octet-stream / wildcard we default
    # to "video/mp4" as a best-effort.
    if not mime_type or mime_type == "video/*" or mime_type == "application/octet-stream":
        mime_type = "video/mp4"
    file_data = {"fileUri": file_uri, "mimeType": mime_type}
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"fileData": file_data},
                    {"text": transcribe_prompt_for(language)},
                ],
            }
        ],
        "generationConfig": {
            "temperature":     0.0,
            "maxOutputTokens": 8192,
            # LOW res cuts video token use ~4x (~66 vs ~258 tokens/sec).
            # Transcripts ride on the audio track, so this loses nothing
            # for our use case and lets ~4-hour videos fit in the 1M-token
            # input window instead of the ~hour cap at default resolution.
            "mediaResolution": "MEDIA_RESOLUTION_LOW",
        },
    }
    text = _gemini_call(payload, "transcribe")
    # Strip accidental markdown code fences if the model wrapped anything.
    text = re.sub(r"^```(?:[a-z]+)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    return text.strip()


def gemini_summarize(transcript_text, language):
    """Pass 2: transcript → structured HTML summary.

    Same 8192-token output cap as transcribe — the summary is a fraction
    of that in practice (~1-2k tokens of HTML) so it's never the
    bottleneck."""
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": transcript_text},
                    {"text": "Summarize the lesson transcript above using the format specified in the system instructions."},
                ],
            }
        ],
        "systemInstruction": {"parts": [{"text": summarize_prompt_for(language)}]},
        "generationConfig": {
            "temperature":     0.2,
            "maxOutputTokens": 8192,
        },
    }
    text = _gemini_call(payload, "summarize")
    # Strip ```html / ```json fences just in case the model adds them.
    text = re.sub(r"^```(?:[a-z]+)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    return text.strip()


def gemini_generate(file_uri, mime_type, language):
    """Two-pass transcribe + summarize. Each pass has its own output-token
    budget so the summary can never be truncated by a long transcript
    (which was the root cause of half-summaries / empty summaries)."""
    transcript = gemini_transcribe(file_uri, mime_type, language)
    summary = gemini_summarize(transcript, language)
    return {"transcript": transcript, "summary": summary}


def is_youtube_url(url):
    return bool(re.search(r"(?:youtube\.com|youtu\.be)/", url or ""))


def canonicalize_youtube_url(url):
    """Strip everything except the video id so Gemini's YouTube ingestion
    works. With extras like '&t=5s' Gemini returns 400 'Cannot fetch
    content from the provided URL'. Handles both watch?v= and youtu.be/
    short links."""
    if not url:
        return url
    m = re.search(r"(?:youtube\.com/(?:watch\?[^#]*?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"
    return url


def transcribe_prompt_for(language):
    if language == "he":
        return TRANSCRIBE_PROMPT_HE
    if language == "es":
        return TRANSCRIBE_PROMPT_ES
    return TRANSCRIBE_PROMPT_EN


def summarize_prompt_for(language):
    if language == "he":
        return SUMMARIZE_PROMPT_HE
    if language == "es":
        return SUMMARIZE_PROMPT_ES
    return SUMMARIZE_PROMPT_EN


# Map of common audio/video file extensions to the MIME type Gemini wants.
# Anything not in this map falls back to "application/octet-stream", which
# Gemini will still accept for most cases.
MIME_BY_EXT = {
    ".mp3":  "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".mp4":  "video/mp4",
    ".mov":  "video/quicktime",
    ".webm": "video/webm",
    ".wav":  "audio/wav",
    ".ogg":  "audio/ogg",
    ".aac":  "audio/aac",
    ".flac": "audio/flac",
    ".mpeg": "video/mpeg",
    ".mpg":  "video/mpeg",
    ".avi":  "video/x-msvideo",
    ".wmv":  "video/x-ms-wmv",
    ".3gp":  "video/3gpp",
    ".mkv":  "video/x-matroska",
}


def guess_mime_for(path):
    ext = os.path.splitext(path)[1].lower()
    return MIME_BY_EXT.get(ext, "application/octet-stream")


def download_remote_file(job_id, url, tmpdir):
    """Stream a remote file (Supabase Storage public URL, etc.) to disk so
    we can hand it to Gemini's Files API. Returns the local path."""
    parsed = urlparse(url)
    name = os.path.basename(parsed.path) or "upload.bin"
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:120] or "upload.bin"
    dest = os.path.join(tmpdir, f"source_{name}")
    print(f"[{job_id}] downloading file from {url[:120]}")
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
    size = os.path.getsize(dest)
    print(f"[{job_id}] downloaded {size:,} bytes → {dest}")
    if size == 0:
        raise RuntimeError("downloaded file is empty")
    return dest


def download_audio_with_ytdlp(job_id, video_url, referer_url, tmpdir):
    """Download audio with yt-dlp. Uses curl_cffi impersonation so YouTube
    doesn't reject us as a bot from a cloud IP, and a cookies file
    (YT_DLP_COOKIES env var) when present for unlisted / age-restricted
    videos. Returns the local audio file path."""
    out_template = os.path.join(tmpdir, "audio.%(ext)s")
    cmd = [
        "yt-dlp",
        "-f", "bestaudio/best",
        "-x", "--audio-format", "mp3",
        "--extractor-args", "youtube:player_client=web,android,ios",
        "--impersonate", "chrome",
        "-o", out_template,
    ]
    if COOKIES_FILE:
        cmd += ["--cookies", COOKIES_FILE]
    if referer_url:
        cmd += ["--referer", referer_url]
    cmd.append(video_url)

    print(f"[{job_id}] yt-dlp cmd: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    print(f"[{job_id}] yt-dlp exit={result.returncode}")
    if result.returncode != 0:
        print(f"[{job_id}] yt-dlp stderr: {result.stderr[-500:]}")
        raise RuntimeError(f"yt-dlp failed: {result.stderr.strip()[-300:]}")

    files = glob.glob(os.path.join(tmpdir, "audio.*"))
    if not files:
        raise RuntimeError("yt-dlp produced no audio file")
    return files[0]


def process_job(job_id, video_url, file_url, referer_url, language, user_id):
    """Background worker — uses Gemini for transcription + summary.

    Three input modes:
      1. file_url set      → download the file directly (Supabase Storage,
                              any HTTPS URL), upload to Gemini Files API,
                              transcribe. This is the bulletproof path for
                              unlisted / restricted videos — admins upload
                              the source MP4/MP3 once instead of fighting
                              YouTube's bot detection.
      2. YouTube video_url → try Gemini's native YouTube fileData first;
                              on 403 fall back to yt-dlp + Files API.
      3. other video_url   → yt-dlp + Files API (Vimeo etc.).
    """
    job = jobs[job_id]
    tmpdir = tempfile.mkdtemp()
    try:
        out = None

        if file_url:
            # ── Upload path: just download + transcribe, no YouTube at all ──
            job["progress"] = "downloading"
            local_path = download_remote_file(job_id, file_url, tmpdir)
            mime = guess_mime_for(local_path)

            job["progress"] = "uploading"
            file_uri = gemini_upload_file(local_path, mime)
            print(f"[{job_id}] Gemini file URI: {file_uri}")

            job["progress"] = "transcribing"
            out = gemini_generate(file_uri, mime, language)

        elif is_youtube_url(video_url):
            # ── YouTube fast path — Gemini accepts the URL natively ──
            # Canonicalize the URL: query params like &t=5s, &list=...,
            # &si=... make Gemini return 400 'Cannot fetch content from
            # the provided URL'. We keep only the video id.
            clean_url = canonicalize_youtube_url(video_url)
            try:
                job["progress"] = "transcribing"
                print(f"[{job_id}] YouTube native path: {clean_url[:80]}")
                out = gemini_generate(clean_url, "video/mp4", language)
            except GeminiPermissionError as e:
                print(f"[{job_id}] Gemini denied YouTube URL, falling back to yt-dlp: {e}")

        if out is None:
            # ── Fallback / non-YouTube path: yt-dlp → Files API → generate ──
            job["progress"] = "downloading"
            audio_path = download_audio_with_ytdlp(job_id, video_url, referer_url, tmpdir)

            job["progress"] = "uploading"
            file_uri = gemini_upload_file(audio_path, "audio/mp3")
            print(f"[{job_id}] Gemini file URI: {file_uri}")

            job["progress"] = "transcribing"
            out = gemini_generate(file_uri, "audio/mp3", language)

        transcript_text = out["transcript"]
        summary = out["summary"]

        if not transcript_text:
            job["status"] = "error"
            job["error"] = "Gemini returned an empty transcript"
            return

        job["transcript_text"] = transcript_text
        job["summary"] = summary

        # ── Step 4: Save transcript to Supabase Storage ──
        job["progress"] = "saving"
        file_path = f"transcripts/{user_id}/{int(time.time())}_transcript.txt"
        sr = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/course-images/{file_path}",
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}", "Content-Type": "text/plain"},
            data=transcript_text.encode("utf-8"),
        )
        if sr.status_code in (200, 201):
            job["transcript_file_url"] = f"{SUPABASE_URL}/storage/v1/object/public/course-images/{file_path}"

        job["status"] = "completed"
        job["progress"] = "done"

    except subprocess.TimeoutExpired:
        job["status"] = "error"
        job["error"] = "Download timed out (10 min)"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        print(f"[{job_id}] error: {e}")
    finally:
        for f in glob.glob(os.path.join(tmpdir, "*")):
            try:
                os.remove(f)
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass


@app.route("/health", methods=["GET"])
def health():
    def preview(k):
        return f"{k[:4]}...{k[-4:]}" if len(k) > 8 else f"len={len(k)}"
    return jsonify({
        "status": "ok",
        "env": {
            "SUPABASE_URL": bool(SUPABASE_URL),
            "SUPABASE_ANON_KEY": bool(SUPABASE_ANON_KEY),
            "SUPABASE_SERVICE_ROLE_KEY": bool(SUPABASE_SERVICE_ROLE_KEY),
            "GEMINI_API_KEY": preview(GEMINI_API_KEY),
        },
    })


@app.route("/transcribe", methods=["POST"])
def transcribe():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"error": "Unauthorized"}), 401

    token = auth_header.replace("Bearer ", "")
    user = verify_supabase_auth(token)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    video_url = data.get("video_url", "")
    file_url = data.get("file_url", "")
    if not video_url and not file_url:
        return jsonify({"error": "video_url or file_url is required"}), 400

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "processing",
        "progress": "queued",
        "summary": "",
        "transcript_text": "",
        "transcript_file_url": "",
        "error": "",
    }

    threading.Thread(
        target=process_job,
        args=(
            job_id,
            video_url,
            file_url,
            data.get("referer_url", ""),
            data.get("language", "he"),
            user.get("id", ""),
        ),
        daemon=True,
    ).start()

    return jsonify({"job_id": job_id})


@app.route("/status/<job_id>", methods=["GET"])
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


if __name__ == "__main__":
    print("=== ENV CHECK ===")
    for var in ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"]:
        print(f"  {var}: {'SET' if os.environ.get(var) else 'MISSING'}")
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
