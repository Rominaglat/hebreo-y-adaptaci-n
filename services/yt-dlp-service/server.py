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

SYSTEM_PROMPT_HE = """אתה מקבל אודיו של שיעור. עליך להפיק:
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
{"transcript": "<full transcript text>", "summary": "<HTML summary>"}"""

SYSTEM_PROMPT_EN = """You are given a lesson audio. Produce:
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
{"transcript": "<full transcript text>", "summary": "<HTML summary>"}"""

SYSTEM_PROMPT_ES = """Recibes el audio de una clase. Debes producir:
1. Una transcripción completa y precisa de las palabras del docente.
2. Un resumen estructurado en HTML limpio usando <h3>, <p>, <ul>, <li>, <strong>, con este formato:

🎯 Objetivo de la clase — 2 oraciones sobre el tema y lo que los estudiantes deben aprender.
📁 Recursos útiles — lista numerada de cada recurso mencionado (artículos, sitios web, libros, presentaciones) incluyendo enlaces si se mencionan. Si no hay — "No se mencionaron recursos en esta clase."
📌 Puntos clave — entre 2 y 6 puntos, cada uno con un título corto y una explicación de hasta 5 oraciones.
📝 Resumen de la clase — un párrafo breve (1–2 oraciones) que conecte el objetivo con lo realmente enseñado. Si se mencionó tarea, inclúyela aquí.

Directrices:
- Usa los iconos 🎯📁📌📝 exactamente como aparecen.
- No uses citas directas; redacta como resumen.
- Evita material irrelevante o conversación informal.
- Escribe todo el resumen en español.

Devuelve el resultado únicamente como JSON válido (sin bloques markdown, sin texto adicional):
{"transcript": "<texto completo de la transcripción>", "summary": "<resumen HTML>"}"""


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
    state = info.get("state", "ACTIVE")
    if not uri:
        raise RuntimeError(f"Gemini upload returned no URI: {info}")

    # Step 3: wait for file processing if needed
    if state == "PROCESSING":
        name = info.get("name", "")
        for _ in range(60):
            time.sleep(2)
            poll = requests.get(f"{GEMINI_BASE}/v1beta/{name}?key={GEMINI_API_KEY}", timeout=10)
            if poll.status_code == 200 and poll.json().get("state") == "ACTIVE":
                break

    return uri


class GeminiPermissionError(RuntimeError):
    """Raised when Gemini returns 403 — typically for a YouTube URL that the
    API key project isn't allowed to access (free-tier quota or feature not
    enabled). The caller can fall back to yt-dlp + Files API upload."""


def gemini_generate(file_uri, mime_type, system_prompt):
    """Call Gemini generateContent with the uploaded file. Returns {transcript, summary}."""
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"fileData": {"fileUri": file_uri, "mimeType": mime_type}},
                    {"text": "Transcribe and summarize this lesson."},
                ],
            }
        ],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
        },
    }
    resp = requests.post(
        f"{GEMINI_BASE}/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=600,
    )
    if resp.status_code == 403:
        raise GeminiPermissionError(f"Gemini denied (403): {resp.text[:300]}")
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini generate failed: {resp.status_code} {resp.text[:400]}")

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise RuntimeError(f"Gemini returned no candidates: {data}")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        raise RuntimeError("Gemini returned empty text")

    # Strip markdown code fences if the model added them
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Gemini returned non-JSON: {e}; first 200: {text[:200]}")

    return {
        "transcript": parsed.get("transcript", "").strip(),
        "summary": parsed.get("summary", "").strip(),
    }


def is_youtube_url(url):
    return bool(re.search(r"(?:youtube\.com|youtu\.be)/", url or ""))


def system_prompt_for(language):
    if language == "he":
        return SYSTEM_PROMPT_HE
    if language == "es":
        return SYSTEM_PROMPT_ES
    return SYSTEM_PROMPT_EN


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
        system_prompt = system_prompt_for(language)
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
            out = gemini_generate(file_uri, mime, system_prompt)

        elif is_youtube_url(video_url):
            # ── YouTube fast path — Gemini accepts the URL natively ──
            try:
                job["progress"] = "transcribing"
                print(f"[{job_id}] YouTube native path: {video_url[:80]}")
                out = gemini_generate(video_url, "video/*", system_prompt)
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
            out = gemini_generate(file_uri, "audio/mp3", system_prompt)

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
