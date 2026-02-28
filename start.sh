#!/bin/bash
# ──────────────────────────────────────────────────────────────
# ECA Command Center — Production Launcher (Gunicorn)
# ──────────────────────────────────────────────────────────────
# 4 workers x 4 threads = 16 concurrent requests
# Use `python3 server.py` for local dev instead.
#
# Environment variables (all optional):
#   ECA_PORT          — listen port (default: 5000)
#   ECA_BIND          — bind address (default: 127.0.0.1, use 0.0.0.0 without nginx)
#   ECA_WORKERS       — number of gunicorn workers (default: 4)
#   ECA_THREADS       — threads per worker (default: 4)
#   ECA_TIMEOUT       — request timeout in seconds (default: 300)
#   ECA_MAX_REQUESTS  — restart worker after N requests to prevent memory leaks (default: 1000)
# ──────────────────────────────────────────────────────────────

cd "$(dirname "$0")"

# Load .env file if it exists
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

PORT="${ECA_PORT:-5000}"
BIND="${ECA_BIND:-127.0.0.1}"
WORKERS="${ECA_WORKERS:-4}"
THREADS="${ECA_THREADS:-4}"
TIMEOUT="${ECA_TIMEOUT:-300}"
MAX_REQUESTS="${ECA_MAX_REQUESTS:-1000}"

exec gunicorn server:app \
    -w "$WORKERS" \
    --threads "$THREADS" \
    -b "${BIND}:${PORT}" \
    --timeout "$TIMEOUT" \
    --max-requests "$MAX_REQUESTS" \
    --max-requests-jitter 50 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile -
