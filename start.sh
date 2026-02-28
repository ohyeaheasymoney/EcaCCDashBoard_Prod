#!/bin/bash
# Production launcher — 4 workers x 4 threads = 16 concurrent requests
# Use `python3 server.py` for local dev instead.
cd "$(dirname "$0")"
exec gunicorn server:app \
    -w 4 \
    --threads 4 \
    -b 0.0.0.0:5000 \
    --timeout 300 \
    --access-logfile -
