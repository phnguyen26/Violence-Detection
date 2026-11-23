# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:24-alpine AS fe-builder
WORKDIR /app

COPY web/package*.json ./
RUN npm ci

# Firebase config is baked into the bundle at build time
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID

COPY web/ .
RUN npm run build


# ── Stage 2: Install Python dependencies ──────────────────────────────────────
FROM python:3.11-slim-bookworm AS py-builder
WORKDIR /build

COPY requirements.txt requirements-base.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 3: Runtime (nginx + uvicorn, managed by supervisord) ────────────────
FROM python:3.11-slim-bookworm

# System deps: nginx, supervisor, OpenCV runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx \
        supervisor \
        libglib2.0-0 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Python packages
COPY --from=py-builder /install /usr/local

# Frontend static files
COPY --from=fe-builder /app/dist /usr/share/nginx/html

# Backend source
WORKDIR /app
COPY server.py ./
COPY src ./src
COPY best.engine ./
COPY --chmod=+x run.sh ./

# nginx config — listens on 7860 (HF Spaces public port)
# serves FE, proxies /api/ and /ws to uvicorn on localhost:8000
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 7860;
    server_name _;

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

# Remove default nginx config that conflicts
RUN rm -f /etc/nginx/sites-enabled/default

# supervisord: manages nginx + uvicorn
COPY <<'EOF' /etc/supervisor/conf.d/detex.conf
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0

[program:nginx]
command=nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0

[program:backend]
command=/app/run.sh
directory=/app
autostart=true
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
EOF

# HF Spaces runs as uid 1000
RUN useradd -m -u 1000 appuser \
    && chown -R appuser /app \
    && chown -R appuser /var/lib/nginx \
    && chown -R appuser /var/log/nginx \
    && chown -R appuser /run \
    && touch /run/nginx.pid \
    && chown appuser /run/nginx.pid

USER appuser

EXPOSE 7860

ENV HOST=127.0.0.1 \
    PORT=8000 \
    WEIGHTS=/app/best.engine \
    FIREBASE_SERVICE_ACCOUNT=/app/detex.json \
    VIOLENCE_THRESHOLD=0.6 \
    ALERT_COOLDOWN_SECONDS=30 \
    INFERENCE_BATCH_SIZE=2 \
    FRAME_QUEUE_SIZE=12

CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
