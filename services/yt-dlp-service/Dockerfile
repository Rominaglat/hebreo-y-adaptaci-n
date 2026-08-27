FROM python:3.12-slim

# Deno is yt-dlp's default JavaScript runtime. Without one, yt-dlp can't solve
# YouTube's player challenge and warns that extraction is deprecated and
# "some formats may be missing" — which is how a download ends up picking a
# format whose URL then 403s. Copied from the official bin image so there's no
# install script to break the build.
COPY --from=denoland/deno:bin-2.9.5 /deno /usr/local/bin/deno

# print() from the Flask worker is block-buffered when stdout isn't a TTY, so
# without this Railway's log stream shows gunicorn's own lines and nothing
# else — every job trace stays stuck in an 8KB buffer. Debugging a YouTube
# failure without the yt-dlp stderr in the logs is guesswork.
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

CMD ["sh", "-c", "gunicorn server:app --bind 0.0.0.0:${PORT:-5000} --timeout 600"]
