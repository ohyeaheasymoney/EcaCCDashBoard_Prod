#!/bin/bash
# ──────────────────────────────────────────────────────────────
# ECA Command Center — Post-Deployment Smoke Test
# ──────────────────────────────────────────────────────────────
# Run AFTER deploy.sh to verify the deployment is working.
#
# Usage:  bash scripts/post-deploy-test.sh
# ──────────────────────────────────────────────────────────────

# Load .env if present
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a; source "$SCRIPT_DIR/.env"; set +a
fi

APP_DIR="${ECA_APP_DIR:-/home/${ECA_USER:-eca}/eca-command-center}"
PORT="${ECA_PORT:-5000}"
NFS_HOST="${ECA_NFS_HOST:-10.3.3.157}"
PLAYBOOK_DIR="${ECA_PLAYBOOK_DIR:-/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
WARN=0
FAIL=0

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; ((PASS++)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; ((WARN++)); }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; ((FAIL++)); }
info() { echo -e "  ${CYAN}INFO${NC}  $1"; }
header() { echo -e "\n${BOLD}── $1 ──${NC}"; }

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ECA Command Center — Post-Deployment Smoke Test"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 1. Service status ──
header "systemd Service"
if systemctl is-active eca-command-center &>/dev/null; then
    pass "eca-command-center service is running"
    UPTIME=$(systemctl show eca-command-center --property=ActiveEnterTimestamp --value 2>/dev/null)
    info "Started: $UPTIME"
else
    fail "eca-command-center service is NOT running"
    info "Check: sudo journalctl -u eca-command-center -n 20"
fi

if systemctl is-enabled eca-command-center &>/dev/null; then
    pass "Service is enabled (starts on boot)"
else
    warn "Service is NOT enabled — run: sudo systemctl enable eca-command-center"
fi

# ── 2. Health endpoint ──
header "Application Health"
if command -v curl &>/dev/null; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)
    if [ "$HTTP_CODE" = "200" ]; then
        pass "Health endpoint responding (HTTP 200)"
        HEALTH=$(curl -s "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)
        info "Response: $HEALTH"
    elif [ "$HTTP_CODE" = "000" ]; then
        fail "Cannot connect to app on port $PORT"
        info "Service may still be starting — wait a few seconds and retry"
    else
        warn "Health endpoint returned HTTP $HTTP_CODE"
    fi
else
    warn "curl not installed — skipping HTTP health check"
fi

# ── 3. Login page ──
header "Web UI"
if command -v curl &>/dev/null; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/" 2>/dev/null)
    if [ "$HTTP_CODE" = "200" ]; then
        pass "Login page accessible (HTTP 200)"
    elif [ "$HTTP_CODE" = "302" ]; then
        pass "Login page accessible (redirecting)"
    else
        fail "Login page returned HTTP $HTTP_CODE"
    fi
fi

# ── 4. Nginx proxy ──
header "Nginx Reverse Proxy"
if systemctl is-active nginx &>/dev/null; then
    pass "Nginx is running"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:80/" 2>/dev/null)
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
        pass "Nginx proxy to app working (port 80 → $PORT)"
    else
        fail "Nginx proxy returned HTTP $HTTP_CODE"
        info "Check: sudo nginx -t && sudo cat /etc/nginx/conf.d/eca.conf"
    fi

    # Check security headers
    HEADERS=$(curl -sI "http://127.0.0.1:80/" 2>/dev/null)
    if echo "$HEADERS" | grep -qi "X-Frame-Options"; then
        pass "Security headers present (X-Frame-Options)"
    else
        warn "Security headers missing from nginx responses"
    fi
else
    warn "Nginx is not running — app accessible on port $PORT only"
    info "Install: sudo dnf install nginx && sudo bash deploy.sh"
fi

# ── 5. App directory ──
header "Application Files"
if [ -d "$APP_DIR" ]; then
    pass "App directory exists: $APP_DIR"
else
    fail "App directory missing: $APP_DIR"
fi

for f in server.py config_backend.py start.sh workflows.json; do
    if [ -f "$APP_DIR/$f" ]; then
        pass "$f present"
    else
        fail "$f missing from $APP_DIR"
    fi
done

if [ -d "$APP_DIR/static" ]; then
    JS_COUNT=$(ls "$APP_DIR/static/"*.js 2>/dev/null | wc -l)
    pass "Static directory: $JS_COUNT JS files"
else
    fail "Static directory missing"
fi

if [ -d "$APP_DIR/venv" ]; then
    pass "Python virtualenv exists"
else
    fail "Python virtualenv missing — run deploy.sh again"
fi

# ── 6. Database ──
header "Database"
if [ -f "$APP_DIR/jobs/jobs.db" ]; then
    pass "SQLite database exists"
    if command -v sqlite3 &>/dev/null; then
        TABLE_COUNT=$(sqlite3 "$APP_DIR/jobs/jobs.db" "SELECT count(*) FROM sqlite_master WHERE type='table';" 2>/dev/null)
        info "$TABLE_COUNT tables in database"
    fi
else
    info "Database not yet created (will be created on first request)"
fi

if [ -w "$APP_DIR/jobs" ] 2>/dev/null; then
    pass "Jobs directory is writable"
else
    warn "Jobs directory may not be writable by app user"
fi

# ── 7. Playbooks ──
header "Playbooks"
if [ -d "$PLAYBOOK_DIR" ]; then
    pass "Playbook directory exists: $PLAYBOOK_DIR"
    PB_COUNT=$(find "$PLAYBOOK_DIR" -name "*.yaml" -o -name "*.yml" 2>/dev/null | wc -l)
    info "$PB_COUNT playbook files deployed"

    # Validate playbook syntax
    if command -v ansible-playbook &>/dev/null; then
        MAIN_PB="$PLAYBOOK_DIR/ConfigMain._J_class.yaml"
        if [ -f "$MAIN_PB" ]; then
            if ansible-playbook --syntax-check "$MAIN_PB" &>/dev/null; then
                pass "Playbook syntax valid (ConfigMain._J_class.yaml)"
            else
                warn "Playbook syntax check failed — may need vars.yml in place"
            fi
        fi
    fi
else
    warn "Playbook directory not found: $PLAYBOOK_DIR"
    info "Run deploy.sh to copy playbooks, or set ECA_PLAYBOOK_DIR in .env"
fi

# ── 8. Sudoers / arp-scan ──
header "arp-scan Permissions"
if [ -f /etc/sudoers.d/eca-arp-scan ]; then
    pass "Sudoers rule for arp-scan exists"
else
    warn "Sudoers rule for arp-scan missing — inventory discovery won't work"
    info "Fix: echo 'eca ALL=(ALL) NOPASSWD: /usr/sbin/arp-scan' | sudo tee /etc/sudoers.d/eca-arp-scan"
fi

# ── 9. NFS connectivity ──
header "NFS Share ($NFS_HOST)"
if ping -c 1 -W 3 "$NFS_HOST" &>/dev/null; then
    pass "NFS host $NFS_HOST reachable"
else
    warn "NFS host $NFS_HOST unreachable — firmware updates will fail"
fi

# ── 10. Environment config ──
header "Environment"
if [ -f "$APP_DIR/.env" ]; then
    pass ".env file exists"

    # Check for secret key
    if grep -q "^ECA_SECRET_KEY=" "$APP_DIR/.env" 2>/dev/null; then
        pass "ECA_SECRET_KEY is set (session persistence)"
    else
        warn "ECA_SECRET_KEY not set — user sessions will break on restart"
        info "Fix: echo \"ECA_SECRET_KEY=$(python3 -c 'import secrets;print(secrets.token_hex(32))')\" >> $APP_DIR/.env"
    fi
else
    warn ".env file missing — using defaults"
    info "Run: cp .env.example .env && edit values"
fi

# ── 11. Logs ──
header "Logging"
if [ -f "$APP_DIR/server.log" ]; then
    LOG_SIZE=$(du -h "$APP_DIR/server.log" 2>/dev/null | cut -f1)
    pass "server.log exists ($LOG_SIZE)"
else
    info "server.log not yet created"
fi

if [ -f /etc/logrotate.d/eca-command-center ]; then
    pass "Logrotate configured"
else
    warn "Logrotate not configured — logs will grow unbounded"
fi

# ── 12. Backup cron ──
header "Backups"
if crontab -u "${ECA_USER:-eca}" -l 2>/dev/null | grep -q "backup.sh"; then
    pass "Daily backup cron job installed"
else
    warn "Backup cron not found — run deploy.sh or manually add cron"
fi

if [ -d "$APP_DIR/backups" ]; then
    BACKUP_COUNT=$(ls "$APP_DIR/backups/"backup_*.tar.gz 2>/dev/null | wc -l)
    info "$BACKUP_COUNT backup(s) stored"
else
    info "No backups yet (backups/ directory will be created on first run)"
fi

# ── Summary ──
echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "  Results:  ${GREEN}${PASS} passed${NC}  |  ${YELLOW}${WARN} warnings${NC}  |  ${RED}${FAIL} failed${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""

IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}Deployment verified!${NC}"
    echo ""
    echo "  Access the UI:"
    if systemctl is-active nginx &>/dev/null; then
        echo "    http://${IP_ADDR}/"
    fi
    echo "    http://${IP_ADDR}:${PORT}/"
    echo ""
    echo "  Default login: admin / admin"
    echo "  (Change password immediately after first login)"
    echo ""
else
    echo -e "  ${RED}Some checks failed — review the issues above${NC}"
    echo ""
fi

exit $FAIL
