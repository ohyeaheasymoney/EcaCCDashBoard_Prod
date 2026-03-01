#!/bin/bash
# ──────────────────────────────────────────────────────────────
# ECA Command Center — Pre-flight Deployment Check
# ──────────────────────────────────────────────────────────────
# Run BEFORE deploy.sh to validate the environment is ready.
#
# Usage:  sudo bash scripts/preflight-check.sh
#
# Checks:
#   1. Root/sudo access
#   2. OS and kernel
#   3. Required system packages
#   4. Python 3.9+ available
#   5. Disk space (minimum 10 GB free)
#   6. NFS server reachable
#   7. Network interfaces for arp-scan
#   8. Playbook directory path
#   9. Firewall ports
#  10. Ansible installed and working
# ──────────────────────────────────────────────────────────────

# Load .env if present
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a; source "$SCRIPT_DIR/.env"; set +a
fi

NFS_HOST="${ECA_NFS_HOST:-10.3.3.157}"
APP_DIR="${ECA_APP_DIR:-/home/${ECA_USER:-eca}/eca-command-center}"
PLAYBOOK_DIR="${ECA_PLAYBOOK_DIR:-/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4}"
PORT="${ECA_PORT:-5000}"

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
echo "  ECA Command Center — Pre-flight Deployment Check"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 1. Root check ──
header "Privileges"
if [ "$EUID" -eq 0 ]; then
    pass "Running as root"
else
    warn "Not running as root — deploy.sh requires root (sudo)"
fi

# ── 2. OS info ──
header "Operating System"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    info "OS: $PRETTY_NAME"
    if [[ "$ID" =~ ^(rhel|rocky|almalinux|centos|fedora)$ ]]; then
        pass "RHEL-based OS detected"
    elif [[ "$ID" =~ ^(ubuntu|debian)$ ]]; then
        pass "Debian-based OS detected"
    else
        warn "Untested OS ($ID) — deploy.sh supports RHEL/Debian-based"
    fi
else
    warn "Cannot detect OS version"
fi
info "Kernel: $(uname -r)"

# ── 3. Required packages ──
header "System Packages"
REQUIRED_PKGS=(python3 pip3 gcc ansible-playbook arp-scan)
OPTIONAL_PKGS=(nginx sqlite3 curl git)

for pkg in "${REQUIRED_PKGS[@]}"; do
    if command -v "$pkg" &>/dev/null; then
        pass "$pkg found: $(command -v $pkg)"
    else
        # pip3 might be pip
        if [ "$pkg" = "pip3" ] && command -v pip &>/dev/null; then
            pass "pip found: $(command -v pip)"
        else
            fail "$pkg not found — required for deployment"
        fi
    fi
done

for pkg in "${OPTIONAL_PKGS[@]}"; do
    if command -v "$pkg" &>/dev/null; then
        pass "$pkg found (optional)"
    else
        warn "$pkg not found — recommended but not required"
    fi
done

# ── 4. Python version ──
header "Python"
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
    if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 9 ]; then
        pass "Python $PY_VER (>= 3.9 required)"
    else
        fail "Python $PY_VER is too old — 3.9+ required"
    fi

    # Check venv module
    if python3 -c "import venv" 2>/dev/null; then
        pass "Python venv module available"
    else
        fail "Python venv module missing — install python3-venv"
    fi
else
    fail "Python3 not found"
fi

# ── 5. Disk space ──
header "Disk Space"
APP_MOUNT=$(df -P "${APP_DIR%/*}" 2>/dev/null | tail -1 | awk '{print $4}')
if [ -n "$APP_MOUNT" ]; then
    FREE_GB=$((APP_MOUNT / 1024 / 1024))
    if [ "$FREE_GB" -ge 10 ]; then
        pass "${FREE_GB} GB free on $(df -P "${APP_DIR%/*}" | tail -1 | awk '{print $6}')"
    elif [ "$FREE_GB" -ge 5 ]; then
        warn "${FREE_GB} GB free — recommend at least 10 GB for jobs/firmware"
    else
        fail "Only ${FREE_GB} GB free — need at least 5 GB"
    fi
else
    warn "Cannot determine free disk space"
fi

# ── 6. NFS connectivity ──
header "NFS Share ($NFS_HOST)"
if ping -c 1 -W 3 "$NFS_HOST" &>/dev/null; then
    pass "NFS host $NFS_HOST is reachable (ping)"
else
    warn "NFS host $NFS_HOST is not reachable — firmware updates will fail"
    info "Verify the NFS server is running and firewall allows access"
fi

if command -v showmount &>/dev/null; then
    if showmount -e "$NFS_HOST" &>/dev/null; then
        pass "NFS exports available on $NFS_HOST"
        info "Exports: $(showmount -e $NFS_HOST 2>/dev/null | tail -n +2 | head -3)"
    else
        warn "Cannot list NFS exports from $NFS_HOST — NFS server may not be configured yet"
    fi
else
    info "showmount not installed — skipping NFS export check (install nfs-utils)"
fi

# ── 7. Network interfaces ──
header "Network"
if ip link show | grep -q "state UP"; then
    IFACE=$(ip route get 1.1.1.1 2>/dev/null | head -1 | awk '{for(i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}')
    if [ -n "$IFACE" ]; then
        IP_ADDR=$(ip -4 addr show "$IFACE" | grep -oP 'inet \K[0-9.]+')
        pass "Primary interface: $IFACE ($IP_ADDR)"
    else
        warn "Cannot determine primary network interface"
    fi
else
    fail "No active network interfaces found"
fi

# Check if port is available
if command -v ss &>/dev/null; then
    if ss -tlnp | grep -q ":${PORT} "; then
        warn "Port $PORT is already in use — will need to stop existing service"
        info "$(ss -tlnp | grep ":${PORT} ")"
    else
        pass "Port $PORT is available"
    fi
fi

# ── 8. Playbook directory ──
header "Playbook Directory"
PLAYBOOK_PARENT=$(dirname "$PLAYBOOK_DIR")
if [ -d "$PLAYBOOK_DIR" ]; then
    pass "Playbook directory exists: $PLAYBOOK_DIR"
    PB_COUNT=$(find "$PLAYBOOK_DIR" -name "*.yaml" -o -name "*.yml" 2>/dev/null | wc -l)
    info "$PB_COUNT playbook files found"
elif [ -d "$PLAYBOOK_PARENT" ]; then
    info "Parent directory exists, playbook dir will be created by deploy.sh"
    pass "Playbook parent accessible: $PLAYBOOK_PARENT"
else
    warn "Playbook directory path does not exist yet: $PLAYBOOK_DIR"
    info "deploy.sh will create it — ensure the parent is writable"
fi

# ── 9. Firewall ──
header "Firewall"
if command -v firewall-cmd &>/dev/null; then
    if systemctl is-active firewalld &>/dev/null; then
        info "firewalld is active"
        if firewall-cmd --query-port=${PORT}/tcp &>/dev/null; then
            pass "Port $PORT/tcp is open in firewall"
        else
            warn "Port $PORT/tcp not open — run: sudo firewall-cmd --permanent --add-port=${PORT}/tcp && sudo firewall-cmd --reload"
        fi
        if firewall-cmd --query-service=http &>/dev/null; then
            pass "HTTP (port 80) is open in firewall"
        else
            warn "HTTP not open — run: sudo firewall-cmd --permanent --add-service=http && sudo firewall-cmd --reload"
        fi
    else
        info "firewalld is not running — no firewall rules to check"
    fi
elif command -v ufw &>/dev/null; then
    info "ufw detected — verify ports $PORT and 80 are allowed"
else
    info "No firewall manager detected"
fi

# ── 10. Ansible ──
header "Ansible"
if command -v ansible-playbook &>/dev/null; then
    ANS_VER=$(ansible-playbook --version 2>/dev/null | head -1)
    pass "$ANS_VER"

    # Test ansible syntax with a simple command
    if ansible localhost -m ping -o &>/dev/null; then
        pass "Ansible can execute locally"
    else
        warn "Ansible local execution test failed — may need configuration"
    fi
else
    fail "ansible-playbook not found — install ansible-core"
fi

# ── 11. SELinux ──
header "SELinux"
if command -v getenforce &>/dev/null; then
    SELINUX_STATUS=$(getenforce 2>/dev/null)
    info "SELinux: $SELINUX_STATUS"
    if [ "$SELINUX_STATUS" = "Enforcing" ]; then
        warn "SELinux is enforcing — may need httpd_can_network_connect for nginx proxy"
        info "Fix: sudo setsebool -P httpd_can_network_connect 1"
    fi
fi

# ── Summary ──
echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "  Results:  ${GREEN}${PASS} passed${NC}  |  ${YELLOW}${WARN} warnings${NC}  |  ${RED}${FAIL} failed${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "  ${RED}Fix the failures above before running deploy.sh${NC}"
    echo ""
    exit 1
elif [ "$WARN" -gt 0 ]; then
    echo -e "  ${YELLOW}Warnings found — deployment will proceed but check the items above${NC}"
    echo ""
    exit 0
else
    echo -e "  ${GREEN}All checks passed — ready to deploy!${NC}"
    echo -e "  Run: ${BOLD}sudo bash deploy.sh${NC}"
    echo ""
    exit 0
fi
