#!/bin/bash
# ──────────────────────────────────────────────────────────────
# ECA Command Center — Database & Config Backup Script
# ──────────────────────────────────────────────────────────────
# Usage:  bash scripts/backup.sh
# Cron:   0 2 * * * /home/eca/eca-command-center/scripts/backup.sh
#
# Creates timestamped backups of:
#   - SQLite database (jobs.db)
#   - workflows.json
#   - customers.json
#   - users.json
#   - .env
#
# Keeps the last 14 daily backups (configurable).
# ──────────────────────────────────────────────────────────────

set -euo pipefail

APP_DIR="${ECA_APP_DIR:-/home/eca/eca-command-center}"
BACKUP_DIR="${APP_DIR}/backups"
KEEP_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

echo "[BACKUP] Starting backup at $(date)"

mkdir -p "$BACKUP_PATH"

# SQLite safe backup (handles WAL mode)
if [ -f "$APP_DIR/jobs/jobs.db" ]; then
    sqlite3 "$APP_DIR/jobs/jobs.db" ".backup '${BACKUP_PATH}/jobs.db'"
    echo "[BACKUP] Database backed up"
else
    echo "[BACKUP] No database found, skipping"
fi

# Config files
for f in workflows.json customers.json users.json .env; do
    if [ -f "$APP_DIR/$f" ]; then
        cp "$APP_DIR/$f" "$BACKUP_PATH/"
        echo "[BACKUP] Copied $f"
    fi
done

# Compress
tar -czf "${BACKUP_DIR}/backup_${TIMESTAMP}.tar.gz" -C "$BACKUP_DIR" "$TIMESTAMP"
rm -rf "$BACKUP_PATH"
echo "[BACKUP] Compressed to backup_${TIMESTAMP}.tar.gz"

# Prune old backups
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +${KEEP_DAYS} -delete
echo "[BACKUP] Pruned backups older than ${KEEP_DAYS} days"

echo "[BACKUP] Done at $(date)"
