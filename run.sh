#!/bin/bash
set -e   

if [[ ! -f detex.json && -z "$FIREBASE_CREDENTIALS_JSON" ]]; then
  echo "ERROR: Firebase secret is not set" >&2
  exit 1
fi

echo "Starting Detex server on port ${PORT:-8000}..."

exec python server.py \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-8000}" \
  --weights "${WEIGHTS:-best.engine}"
