# 1. builder 
FROM python:3.11-slim-bookworm AS builder

WORKDIR /build

# RUN apt-get update && apt-get install -y --no-install-recommends \
#         libglib2.0-0 \
#         libgl1 \
#     && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
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


COPY postprocess.py server.py ./
COPY best.pt ./best.pt
COPY runs.sh ./
# -R for dir
RUN chown -R appuser /app
USER appuser

EXPOSE 7860

ENV PORT=7860 \
    HOST=0.0.0.0 \
    WEIGHTS=best.pt \
    VIOLENCE_THRESHOLD=0.6 \
    VIOLENCE_SECONDS=3 \
    ALERT_COOLDOWN_SECONDS=30

RUN chmod +x run.sh

CMD ["./start.sh"]