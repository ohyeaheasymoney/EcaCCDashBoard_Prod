#!/bin/bash
# ──────────────────────────────────────────────────────────────
# ECA Command Center — Restore from Backup
# ──────────────────────────────────────────────────────────────
# Usage:  bash scripts/restore.sh <backup_file.tar.gz>
# Example: bash scripts/restore.sh backups/backup_20260228_020000.tar.gz
# ──────────────────────────────────────────────────────────────

set -euo pipefail

APP_DIR="${ECA_APP_DIR:-/home/eca/eca-command-center}"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <backup_file.tar.gz>"
    echo ""
    echo "Available backups:"
    ls -lt "$APP_DIR/backups"/backup_*.tar.gz 2>/dev/null || echo "  No backups found."
    exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
    BACKUP_FILE="$APP_DIR/$1"
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "[ERROR] Backup file not found: $1"
    exit 1
fi

echo "[RESTORE] Extracting $BACKUP_FILE ..."
TEMP_DIR=$(mktemp -d)
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Find the extracted directory
EXTRACTED=$(find "$TEMP_DIR" -maxdepth 1 -type d | tail -1)

echo "[RESTORE] Stopping service..."
sudo systemctl stop eca-command-center 2>/dev/null || true

if [ -f "$EXTRACTED/jobs.db" ]; then
    cp "$EXTRACTED/jobs.db" "$APP_DIR/jobs/jobs.db"
    echo "[RESTORE] Database restored"
fi

for f in workflows.json customers.json users.json .env; do
    if [ -f "$EXTRACTED/$f" ]; then
        cp "$EXTRACTED/$f" "$APP_DIR/"
        echo "[RESTORE] Restored $f"
    fi
done

rm -rf "$TEMP_DIR"

echo "[RESTORE] Starting service..."
sudo systemctl start eca-command-center 2>/dev/null || true

echo "[RESTORE] Done. Verify: sudo systemctl status eca-command-center"
