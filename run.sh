#!/bin/bash
set -e   

if [ -z "$FIREBASE_CREDENTIALS_JSON" ]; then
  echo "ERROR: FIREBASE_CREDENTIALS_JSON secret is not set" >&2
  exit 1
fi

echo "Starting Detex server on port ${PORT:-7860}..."

exec python server.py \
  --host "${HOST}" \
  --port "${PORT}" \
  --weights "${}" \
  --no-ssl