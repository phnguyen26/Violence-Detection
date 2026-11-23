# 1. builder 
FROM python:3.11-slim-bookworm AS builder

WORKDIR /build

# RUN apt-get update && apt-get install -y --no-install-recommends \
#         libglib2.0-0 \
#         libgl1 \
#     && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-base.txt ./
#install dependencies to /install (avoid polluting the system site-packages)
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# 2. runtime 
FROM python:3.11-slim-bookworm

#-m manually -u uid
RUN useradd -m -u 1000 appuser

WORKDIR /app


COPY --from=builder /install /usr/local


RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*


COPY server.py ./
COPY src ./src
COPY best.engine ./
COPY --chmod=+x run.sh ./
# -R for dir
RUN chown -R appuser /app
USER appuser

EXPOSE 7860

ENV PORT=7860 \
    HOST=0.0.0.0 \
    WEIGHTS=best.engine \
    VIOLENCE_THRESHOLD=0.6 \
    ALERT_COOLDOWN_SECONDS=30 \
    INFERENCE_BATCH_SIZE=2\
    FRAME_QUEUE_SIZE=12\
    FIREBASE_SERVICE_ACCOUNT=detex.json\
    CORS_ORIGINS=http://localhost:8080\
    VIOLENCE_THRESHOLD=0.6
ENTRYPOINT ["./run.sh"]