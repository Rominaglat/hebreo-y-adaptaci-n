"""
Async transcription microservice:
POST /transcribe → starts job in background, returns { job_id }
GET  /status/<job_id> → returns { status, progress, summary, transcript_text, transcript_file_url, error }
"""
import os
import glob
import subprocess
import tempfile
import time
import uuid
import threading
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Log env var status on startup (visible in Render logs)
for _var in ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ASSEMBLYAI_API_KEY", "OPENAI_API_KEY"]:
    print(f"  {_var}: {'SET' if os.environ.get(_var) else 'MISSING'}")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ASSEMBLYAI_API_KEY = os.environ.get("ASSEMBLYAI_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# In-memory job store
jobs = {}

SUMMARY_PROMPT = """אתה מקבל תמלול טקסטואלי של שיעור.

המטרה שלך היא להפיק סיכום ברור, תמציתי ומובנה לפי הפורמט הבא:

🎯 מטרת השיעור
📁 משאבים שימושיים
📌 נקודות מרכזיות
📝 סיכום השיעור

עליך לנתח את התמלול ולבנות סיכום בפורמט הבא:

🎯 מטרת השיעור
סכם את מטרת השיעור ב־2 משפטים. ציין את הנושא העיקרי ומה התלמידים אמורים להבין או ללמוד מהשיעור.

📁 משאבים שימושיים
רשום רשימה ממוספרת של כל משאב שנזכר במהלך השיעור (מאמרים, אתרים, ספרים, מצגות וכו') כולל שם המשאב וקישור אם נזכר.

📌 נקודות מרכזיות
רשום 2–6 נקודות עיקריות שנאמרו בשיעור.
כל נקודה תכיל כותרת קצרה + הסבר של עד 5 משפטים שמסביר את הנקודה או הרעיון המרכזי.

📝 סיכום השיעור
כתוב פסקה קצרה (1–2 משפטים) שמסכמת את השיעור, מחברת בין המטרה לבין מה שנלמד בפועל.
במידה וצויינו בשיעור שיעורי בית, הם יופיעו כאן.

📌 הנחיות חשובות:
- השתמש באייקונים 🎯📁📌📝 בדיוק כפי שמופיע.
- שמור על מבנה ברור עם רווחים בין מקטעים.
- אם אין משאבים שהוזכרו, רשום "לא צויינו משאבים במהלך השיעור."
- אל תשתמש בציטוטים ישירים, נסח תמיד בלשון סיכום.
- הימנע ממידע לא רלוונטי או אישי (כגון שיחות חולין).
- Format the output as clean HTML using <h3>, <p>, <ul>, <li>, <strong> tags for proper rendering."""


def verify_supabase_auth(token):
    if not SUPABASE_URL:
        print("ERROR: SUPABASE_URL not set")
        return None
    # Use anon key for API gateway routing; fall back to service_role key
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


def process_job(job_id, video_url, referer_url, language, user_id):
    """Background worker — runs the full transcription pipeline."""
    job = jobs[job_id]
    tmpdir = tempfile.mkdtemp()
    try:
        # ── Step 1: Download ──
        job["progress"] = "downloading"
        out_template = os.path.join(tmpdir, "audio.%(ext)s")
        cmd = ["yt-dlp", "-f", "bestaudio/best", "-x", "--audio-format", "mp3", "-o", out_template]
        if referer_url:
            cmd += ["--referer", referer_url]
        cmd.append(video_url)

        print(f"[{job_id}] yt-dlp cmd: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        print(f"[{job_id}] yt-dlp exit={result.returncode} stdout={result.stdout[:200]}")
        if result.returncode != 0:
            job["status"] = "error"
            job["error"] = f"Download failed: {result.stderr.strip()[-300:]}"
            print(f"[{job_id}] yt-dlp stderr: {result.stderr[-500:]}")
            return

        files = glob.glob(os.path.join(tmpdir, "audio.*"))
        if not files:
            job["status"] = "error"
            job["error"] = "No audio file produced"
            return

        # ── Step 2: Upload to AssemblyAI ──
        job["progress"] = "uploading"
        with open(files[0], "rb") as f:
            resp = requests.post(
                "https://api.assemblyai.com/v2/upload",
                headers={"authorization": ASSEMBLYAI_API_KEY},
                data=f,
            )
        if resp.status_code != 200:
            job["status"] = "error"
            job["error"] = f"Upload failed: {resp.text[:200]}"
            return

        upload_url = resp.json().get("upload_url", "")

        # ── Step 3: Transcribe ──
        job["progress"] = "transcribing"
        lang_code = "he" if language == "he" else "en"
        tx = requests.post(
            "https://api.assemblyai.com/v2/transcript",
            headers={"authorization": ASSEMBLYAI_API_KEY, "Content-Type": "application/json"},
            json={"audio_url": upload_url, "language_code": lang_code},
        )
        if tx.status_code != 200:
            job["status"] = "error"
            job["error"] = f"Transcription submit failed: {tx.text[:200]}"
            return

        transcript_id = tx.json().get("id", "")

        # Poll (max 10 min)
        start = time.time()
        transcript_text = ""
        while time.time() - start < 600:
            time.sleep(5)
            poll = requests.get(
                f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
                headers={"authorization": ASSEMBLYAI_API_KEY},
            )
            st = poll.json().get("status", "")
            if st == "completed":
                transcript_text = poll.json().get("text", "")
                break
            if st == "error":
                job["status"] = "error"
                job["error"] = f"Transcription failed: {poll.json().get('error', '')}"
                return

        if not transcript_text:
            job["status"] = "error"
            job["error"] = "Transcription timed out"
            return

        job["transcript_text"] = transcript_text

        # ── Step 4: Save transcript ──
        job["progress"] = "saving"
        file_path = f"transcripts/{user_id}/{int(time.time())}_transcript.txt"
        sr = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/course-images/{file_path}",
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}", "Content-Type": "text/plain"},
            data=transcript_text.encode("utf-8"),
        )
        if sr.status_code in (200, 201):
            job["transcript_file_url"] = f"{SUPABASE_URL}/storage/v1/object/public/course-images/{file_path}"

        # ── Step 5: Summarize ──
        if OPENAI_API_KEY:
            job["progress"] = "summarizing"
            lang_inst = "כתוב את כל הסיכום בעברית." if language == "he" else "Write the entire summary in English."
            try:
                gr = requests.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
                    json={
                        "model": "gpt-4o",
                        "messages": [
                            {"role": "system", "content": f"{SUMMARY_PROMPT}\n\n{lang_inst}"},
                            {"role": "user", "content": transcript_text},
                        ],
                    },
                    timeout=120,
                )
                if gr.status_code == 200:
                    job["summary"] = gr.json()["choices"][0]["message"]["content"]
            except Exception:
                pass

        job["status"] = "completed"
        job["progress"] = "done"

    except subprocess.TimeoutExpired:
        job["status"] = "error"
        job["error"] = "Download timed out (10 min)"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
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
    # Show first/last 4 chars of keys for debugging
    def preview(k):
        return f"{k[:4]}...{k[-4:]}" if len(k) > 8 else f"len={len(k)}"
    return jsonify({
        "status": "ok",
        "env": {
            "SUPABASE_URL": bool(SUPABASE_URL),
            "SUPABASE_ANON_KEY": bool(SUPABASE_ANON_KEY),
            "SUPABASE_SERVICE_ROLE_KEY": bool(SUPABASE_SERVICE_ROLE_KEY),
            "ASSEMBLYAI_API_KEY": preview(ASSEMBLYAI_API_KEY),
            "OPENAI_API_KEY": preview(OPENAI_API_KEY),
        },
    })


@app.route("/transcribe", methods=["POST"])
def transcribe():
    # Auth
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"error": "Unauthorized"}), 401

    token = auth_header.replace("Bearer ", "")
    user = verify_supabase_auth(token)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    video_url = data.get("video_url", "")
    if not video_url:
        return jsonify({"error": "video_url is required"}), 400

    # Create job
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "processing",
        "progress": "queued",
        "summary": "",
        "transcript_text": "",
        "transcript_file_url": "",
        "error": "",
    }

    # Start background thread
    threading.Thread(
        target=process_job,
        args=(job_id, video_url, data.get("referer_url", ""), data.get("language", "he"), user.get("id", "")),
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
    for var in ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ASSEMBLYAI_API_KEY", "OPENAI_API_KEY"]:
        print(f"  {var}: {'SET' if os.environ.get(var) else 'MISSING'}")
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
