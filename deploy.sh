#!/bin/bash
# ──────────────────────────────────────────────────────────────
# ECA Command Center — Quick Deployment Script
# ──────────────────────────────────────────────────────────────
# Usage:  sudo bash deploy.sh
#
# This script:
#   1. Installs system dependencies (Python3, pip, ansible, arp-scan)
#   2. Creates the app directory and copies files
#   3. Installs Python packages in a virtualenv
#   4. Sets up the playbook directory
#   5. Configures sudoers for arp-scan
#   6. Optionally installs nginx + systemd service
# ──────────────────────────────────────────────────────────────

set -e

# ─── Load .env if present ───
SCRIPT_DIR_EARLY="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR_EARLY/.env" ]; then
    set -a; source "$SCRIPT_DIR_EARLY/.env"; set +a
fi

# ─── Config (override via .env or env vars) ───
APP_USER="${ECA_USER:-eca}"
APP_DIR="${ECA_APP_DIR:-/home/$APP_USER/eca-command-center}"
PLAYBOOK_DIR="${ECA_PLAYBOOK_DIR:-/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4}"
PORT="${ECA_PORT:-5000}"
NFS_HOST="${ECA_NFS_HOST:-10.3.3.157}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ECA]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── Pre-checks ───
if [ "$EUID" -ne 0 ]; then
    err "Please run as root: sudo bash deploy.sh"
fi

log "Starting ECA Command Center deployment..."

# ─── 1. System packages ───
log "Installing system dependencies..."
if command -v dnf &>/dev/null; then
    dnf install -y python3 python3-pip python3-devel gcc arp-scan ansible-core 2>/dev/null || true
elif command -v yum &>/dev/null; then
    yum install -y python3 python3-pip python3-devel gcc arp-scan ansible 2>/dev/null || true
elif command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y python3 python3-pip python3-venv python3-dev gcc arp-scan ansible 2>/dev/null || true
fi

# ─── 2. Create app user if needed ───
if ! id "$APP_USER" &>/dev/null; then
    log "Creating user: $APP_USER"
    useradd -m -s /bin/bash "$APP_USER"
fi

# ─── 3. Copy app files ───
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
log "Deploying app to $APP_DIR ..."

mkdir -p "$APP_DIR"
# Copy GUI files
cp "$SCRIPT_DIR/server.py" "$APP_DIR/"
cp "$SCRIPT_DIR/config_backend.py" "$APP_DIR/"
cp "$SCRIPT_DIR/manage_users.py" "$APP_DIR/"
cp "$SCRIPT_DIR/requirements.txt" "$APP_DIR/"
cp "$SCRIPT_DIR/start.sh" "$APP_DIR/"
cp "$SCRIPT_DIR/nginx.conf" "$APP_DIR/"
cp "$SCRIPT_DIR/workflows.json" "$APP_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/.env.example" "$APP_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/README.md" "$APP_DIR/" 2>/dev/null || true
chmod +x "$APP_DIR/start.sh"

# Copy scripts directory
mkdir -p "$APP_DIR/scripts"
cp "$SCRIPT_DIR"/scripts/*.sh "$APP_DIR/scripts/" 2>/dev/null || true
chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true

# Create .env from example if it doesn't exist
if [ ! -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    sed -i "s|^ECA_USER=.*|ECA_USER=$APP_USER|" "$APP_DIR/.env"
    sed -i "s|^ECA_APP_DIR=.*|ECA_APP_DIR=$APP_DIR|" "$APP_DIR/.env"
    sed -i "s|^ECA_PLAYBOOK_DIR=.*|ECA_PLAYBOOK_DIR=$PLAYBOOK_DIR|" "$APP_DIR/.env"
    sed -i "s|^ECA_NFS_HOST=.*|ECA_NFS_HOST=$NFS_HOST|" "$APP_DIR/.env"
    # Auto-generate a secret key for session persistence
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    sed -i "s|^ECA_SECRET_KEY=.*|ECA_SECRET_KEY=$SECRET_KEY|" "$APP_DIR/.env"
    # Set CORS to allow the server's own IP
    SERVER_IP=$(hostname -I | awk '{print $1}')
    sed -i "s|^ECA_CORS_ORIGINS=.*|ECA_CORS_ORIGINS=http://${SERVER_IP},http://${SERVER_IP}:${PORT},http://localhost:${PORT}|" "$APP_DIR/.env"
    log "Created .env with auto-generated secret key"
fi

# Copy static files
mkdir -p "$APP_DIR/static"
cp "$SCRIPT_DIR"/static/*.js "$APP_DIR/static/"
cp "$SCRIPT_DIR"/static/*.html "$APP_DIR/static/" 2>/dev/null || true
cp "$SCRIPT_DIR"/static/index.html "$APP_DIR/static/" 2>/dev/null || true
cp "$SCRIPT_DIR"/static/*.css "$APP_DIR/static/"
cp "$SCRIPT_DIR"/static/*.svg "$APP_DIR/static/" 2>/dev/null || true

# Patch ui-config.js with actual server IP and playbook path
SERVER_IP="${SERVER_IP:-$(hostname -I | awk '{print $1}')}"
if [ -f "$APP_DIR/static/ui-config.js" ]; then
    sed -i "s|controlIP:.*|controlIP: \"${SERVER_IP}\",|" "$APP_DIR/static/ui-config.js"
    sed -i "s|playbookRoot:.*|playbookRoot: \"${PLAYBOOK_DIR}\",|" "$APP_DIR/static/ui-config.js"
    log "Patched ui-config.js (controlIP: $SERVER_IP)"
fi

# Copy playbooks
log "Deploying playbooks to $PLAYBOOK_DIR ..."
mkdir -p "$PLAYBOOK_DIR"
if [ -d "$SCRIPT_DIR/playbooks" ]; then
    cp "$SCRIPT_DIR"/playbooks/*.yaml "$PLAYBOOK_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/playbooks/*.yml "$PLAYBOOK_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/playbooks/*.py "$PLAYBOOK_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/playbooks/*.cfg "$PLAYBOOK_DIR/" 2>/dev/null || true
    cp "$SCRIPT_DIR"/playbooks/hosts "$PLAYBOOK_DIR/" 2>/dev/null || true

    # Patch vars.yml with actual deployment paths and NFS host
    if [ -f "$PLAYBOOK_DIR/vars.yml" ]; then
        sed -i "s|local_path:.*|local_path: \"$APP_DIR\"|" "$PLAYBOOK_DIR/vars.yml"
        sed -i "s|local_path_tsr:.*|local_path_tsr: \"$APP_DIR/TSR\"|" "$PLAYBOOK_DIR/vars.yml"
        sed -i "s|local_path_QuickQC:.*|local_path_QuickQC: \"$APP_DIR/QuickQC\"|" "$PLAYBOOK_DIR/vars.yml"
        sed -i "s|nfs_share_path:.*|nfs_share_path: \"$NFS_HOST:$APP_DIR/Firmware\"|" "$PLAYBOOK_DIR/vars.yml"
        log "Patched vars.yml with deployment paths (NFS: $NFS_HOST)"
    fi
fi

# Create jobs directory and runtime directories
mkdir -p "$APP_DIR/jobs" "$APP_DIR/backups"

# ─── 4. Python virtualenv ───
log "Setting up Python virtualenv..."
if [ ! -d "$APP_DIR/venv" ]; then
    python3 -m venv "$APP_DIR/venv"
fi
"$APP_DIR/venv/bin/pip" install --upgrade pip -q
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt" -q
log "Python packages installed."

# ─── 5. Fix ownership ───
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "$PLAYBOOK_DIR" 2>/dev/null || true

# ─── 6. Sudoers for arp-scan ───
SUDOERS_FILE="/etc/sudoers.d/eca-arp-scan"
if [ ! -f "$SUDOERS_FILE" ]; then
    log "Configuring sudoers for arp-scan..."
    echo "$APP_USER ALL=(ALL) NOPASSWD: /usr/sbin/arp-scan" > "$SUDOERS_FILE"
    chmod 440 "$SUDOERS_FILE"
fi

# ─── 7. Systemd service ───
log "Installing systemd service..."
if [ -f "$SCRIPT_DIR/eca-command-center.service" ]; then
    # Use the version-controlled service file, patching paths
    sed -e "s|User=eca|User=$APP_USER|g" \
        -e "s|Group=eca|Group=$APP_USER|g" \
        -e "s|/home/eca/eca-command-center|$APP_DIR|g" \
        "$SCRIPT_DIR/eca-command-center.service" > /etc/systemd/system/eca-command-center.service
else
    cat > /etc/systemd/system/eca-command-center.service <<SVCEOF
[Unit]
Description=ECA Command Center Dashboard - Production
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
Environment="PATH=$APP_DIR/venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=$APP_DIR/start.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF
fi

systemctl daemon-reload
systemctl enable eca-command-center
systemctl restart eca-command-center

# ─── 7b. Install logrotate config ───
if [ -f "$SCRIPT_DIR/eca-command-center.logrotate" ]; then
    sed "s|/home/eca/eca-command-center|$APP_DIR|g" \
        "$SCRIPT_DIR/eca-command-center.logrotate" > /etc/logrotate.d/eca-command-center
    log "Logrotate configured"
fi

# ─── 7c. Install backup cron ───
if [ -f "$APP_DIR/scripts/backup.sh" ]; then
    CRON_LINE="0 2 * * * $APP_DIR/scripts/backup.sh >> $APP_DIR/backup.log 2>&1"
    (crontab -u "$APP_USER" -l 2>/dev/null | grep -v "backup.sh"; echo "$CRON_LINE") | crontab -u "$APP_USER" -
    log "Daily backup cron installed (2:00 AM)"
fi

# ─── 8. Create default admin user ───
log "Ensuring default admin account exists..."
cd "$APP_DIR"
"$APP_DIR/venv/bin/python3" -c "import config_backend; config_backend._create_default_users()" 2>/dev/null || true

# ─── 9. Optional nginx ───
if command -v nginx &>/dev/null; then
    log "Configuring nginx reverse proxy..."
    sed "s|/home/eca/eca-command-center|$APP_DIR|g" "$APP_DIR/nginx.conf" > /etc/nginx/conf.d/eca.conf
    nginx -t 2>/dev/null && systemctl reload nginx
    log "Nginx configured — access UI at http://$(hostname -I | awk '{print $1}')/"
else
    warn "Nginx not installed. Access UI directly at http://$(hostname -I | awk '{print $1}'):$PORT/"
    warn "To use without nginx, set ECA_BIND=0.0.0.0 in .env"
fi

# ─── Done ───
echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}ECA Command Center deployed successfully!${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  App directory:     $APP_DIR"
echo "  Playbook directory: $PLAYBOOK_DIR"
echo "  Service:           systemctl status eca-command-center"
echo "  Default login:     admin / admin"
echo ""
echo "  Manage users:      cd $APP_DIR && venv/bin/python3 manage_users.py list"
echo "  View logs:         journalctl -u eca-command-center -f"
echo ""
echo "  IMPORTANT: Change the default admin password after first login:"
echo "    cd $APP_DIR && venv/bin/python3 manage_users.py add admin <new-password> --role admin"
echo ""
