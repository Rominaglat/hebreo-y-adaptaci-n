FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "gunicorn -k uvicorn.workers.UvicornWorker -w 2 --bind 0.0.0.0:${PORT:-8080} --timeout 120 app.main:app"]
