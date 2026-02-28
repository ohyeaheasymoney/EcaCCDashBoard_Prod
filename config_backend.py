# config_backend.py
import os
import re
import json
import glob
import time
import shutil
import signal
import sqlite3
import logging
import threading
import subprocess
from datetime import datetime
from typing import Dict, List, Optional, Any
from flask import request
from filelock import FileLock
import hashlib

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# TYPED EXCEPTIONS
# ─────────────────────────────────────────────────────────────

class JobNotFoundError(RuntimeError):
    """Raised when a job ID does not exist."""

class ValidationError(RuntimeError):
    """Raised for invalid input (bad names, unsupported file types, etc.)."""

class ExecutionError(RuntimeError):
    """Raised when a playbook or subprocess execution fails."""

class InventoryError(RuntimeError):
    """Raised when inventory generation fails."""


# ─────────────────────────────────────────────────────────────
# PATHS / CONSTANTS
# ─────────────────────────────────────────────────────────────

UI_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

JOBS_ROOT = os.path.join(UI_BASE_DIR, "jobs")
os.makedirs(JOBS_ROOT, exist_ok=True)

AUTH_USERS_FILE = os.path.join(UI_BASE_DIR, "users.json")
CUSTOMERS_FILE = os.path.join(UI_BASE_DIR, "customers.json")
WORKFLOWS_FILE = os.path.join(UI_BASE_DIR, "workflows.json")


def _hash_pw(pw):
    """Hash a password with SHA-256."""
    return hashlib.sha256(pw.encode()).hexdigest()


def verify_user(username, password):
    """Verify username/password against users.json. Returns True/False."""
    users = _load_users()
    user = users.get(username)
    if not user:
        return False
    return user.get("password_hash") == _hash_pw(password)


def _load_users():
    """Load users from users.json, creating default admin if missing."""
    if not os.path.isfile(AUTH_USERS_FILE):
        _create_default_users()
    try:
        with open(AUTH_USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        log.warning("[auth] Failed to load users.json", exc_info=True)
        return {}


def _save_users(data):
    """Atomic write of users dict (with backup)."""
    _write_json(AUTH_USERS_FILE, data)


def _create_default_users():
    """Create users.json with default admin/admin account."""
    users = {
        "admin": {
            "password_hash": _hash_pw("admin"),
            "role": "admin",
        }
    }
    with open(AUTH_USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)
    log.info("[auth] Created default users.json with admin account")


def list_users():
    """List usernames and roles (no password hashes)."""
    users = _load_users()
    return {u: {"role": v.get("role", "user"), "mustChangePassword": v.get("mustChangePassword", False), "fullName": v.get("fullName", ""), "badgeNumber": v.get("badgeNumber", "")} for u, v in users.items()}


def add_user(username, password, role="user", fullName="", badgeNumber=""):
    """Add a new user in users.json with mustChangePassword flag."""
    users = _load_users()
    users[username] = {"password_hash": _hash_pw(password), "role": role, "mustChangePassword": True, "fullName": fullName, "badgeNumber": badgeNumber}
    _save_users(users)


def remove_user(username):
    """Remove a user from users.json."""
    users = _load_users()
    if username in users:
        del users[username]
        _save_users(users)
        return True
    return False


def get_user_role(username):
    """Return role string for a user ('admin' or 'user')."""
    users = _load_users()
    user = users.get(username)
    if not user:
        return "user"
    return user.get("role", "user")


def update_user_role(username, role):
    """Update a user's role without changing password."""
    if role not in ("admin", "user"):
        raise ValidationError("Role must be 'admin' or 'user'")
    users = _load_users()
    if username not in users:
        raise ValidationError(f"User '{username}' not found")
    users[username]["role"] = role
    _save_users(users)
    return True


def reset_user_password(username, new_password):
    """Reset a user's password hash (admin action — re-sets mustChangePassword)."""
    if not new_password or len(new_password) < 3:
        raise ValidationError("Password must be at least 3 characters")
    users = _load_users()
    if username not in users:
        raise ValidationError(f"User '{username}' not found")
    users[username]["password_hash"] = _hash_pw(new_password)
    users[username]["mustChangePassword"] = True
    _save_users(users)
    return True


def get_must_change_password(username):
    """Check if user must change password on next login."""
    users = _load_users()
    user = users.get(username)
    if not user:
        return False
    return user.get("mustChangePassword", False)


def change_own_password(username, current_password, new_password):
    """User changes their own password. Verifies current password first, clears mustChangePassword."""
    if not new_password or len(new_password) < 3:
        raise ValidationError("New password must be at least 3 characters")
    users = _load_users()
    if username not in users:
        raise ValidationError("User not found")
    if users[username].get("password_hash") != _hash_pw(current_password):
        raise ValidationError("Current password is incorrect")
    if current_password == new_password:
        raise ValidationError("New password must be different from current password")
    users[username]["password_hash"] = _hash_pw(new_password)
    users[username]["mustChangePassword"] = False
    _save_users(users)
    return True


# ─────────────────────────────────────────────────────────────
# CUSTOMER / WORKFLOW CONFIG (server-side JSON)
# ─────────────────────────────────────────────────────────────

def _load_customers():
    """Load customers from JSON, auto-creating defaults if missing."""
    if not os.path.isfile(CUSTOMERS_FILE):
        _create_default_customers()
    try:
        with open(CUSTOMERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        log.warning("[config] Failed to load customers.json", exc_info=True)
        return {}


def _save_customers(data):
    """Atomic write of customers dict."""
    _write_json(CUSTOMERS_FILE, data)


def _create_default_customers():
    """Seed customers.json with current hardcoded definitions."""
    defaults = {
        "servicenow": {
            "label": "ServiceNow",
            "description": "Full server deployment, provisioning, QC, network, and power automation.",
            "path": "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
            "hasServerClass": True,
            "workflows": ["configbuild", "postprov", "quickqc", "cisco_switch", "juniper_switch", "console_switch", "pdu"],
        },
        "openai": {
            "label": "OpenAI",
            "description": "Network switch automation — Cisco, Juniper, and console switch setup and firmware.",
            "path": "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
            "hasServerClass": False,
            "workflows": ["cisco_switch", "juniper_switch", "console_switch"],
        },
        "aes": {
            "label": "AES",
            "description": "Network switch automation — Cisco, Juniper, and console switch setup and firmware.",
            "path": "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
            "hasServerClass": False,
            "workflows": ["cisco_switch", "juniper_switch", "console_switch"],
        },
        "traderjoes": {
            "label": "Trader Joe's",
            "description": "Network switch automation — Cisco, Juniper, and console switch setup and firmware.",
            "path": "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
            "hasServerClass": False,
            "workflows": ["cisco_switch", "juniper_switch", "console_switch"],
        },
    }
    _write_json(CUSTOMERS_FILE, defaults)
    log.info("[config] Created default customers.json")


def list_customers():
    """Return all customer definitions."""
    return _load_customers()


def save_customer(cust_id, data):
    """Create or update a customer definition."""
    if not cust_id or not re.match(r'^[a-z0-9_]+$', cust_id):
        raise ValidationError("Customer ID must be lowercase alphanumeric/underscores")
    if not data.get("label"):
        raise ValidationError("Customer label is required")
    customers = _load_customers()
    customers[cust_id] = {
        "label": data.get("label", ""),
        "description": data.get("description", ""),
        "path": data.get("path", ""),
        "hasServerClass": bool(data.get("hasServerClass", False)),
        "enabled": bool(data.get("enabled", True)),
        "workflows": data.get("workflows", []),
        "lastModified": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    _save_customers(customers)
    return customers[cust_id]


def delete_customer(cust_id):
    """Delete a customer definition."""
    customers = _load_customers()
    if cust_id not in customers:
        raise ValidationError(f"Customer '{cust_id}' not found")
    del customers[cust_id]
    _save_customers(customers)
    return {"status": "deleted", "id": cust_id}


def _load_workflows():
    """Load workflow definitions from JSON, auto-creating defaults if missing."""
    if not os.path.isfile(WORKFLOWS_FILE):
        _create_default_workflows()
    try:
        with open(WORKFLOWS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        log.warning("[config] Failed to load workflows.json", exc_info=True)
        return {}


def _save_workflows(data):
    """Atomic write of workflows dict."""
    _write_json(WORKFLOWS_FILE, data)


def _create_default_workflows():
    """Seed workflows.json with current hardcoded task/workflow definitions."""
    defaults = {
        "configbuild": {
            "label": "Server Build & Configure",
            "category": "Server",
            "description": "Builds and configures the server based on the selected build standard.",
            "playbookName": "ConfigMain._I_class.yaml",
            "enabled": True,
            "requiresInventory": True,
            "requiresWorkbook": False,
            "requiresFirmware": True,
            "requiresBiosXml": True,
            "supportsServerClass": True,
            "supportsHostLimit": True,
            "hasTasks": True,
            "cardInstructions": "",
            "tasks": {
                "configbuild_i": [
                    {"id": "powerup", "label": "PowerUp", "tags": ["powerup"]},
                    {"id": "lldp", "label": "Enable LLDP", "tags": ["lldp"]},
                    {"id": "rackslot", "label": "RackSlot", "tags": ["rackslot"]},
                    {"id": "assettag", "label": "Asset Tag", "tags": ["assettag"]},
                    {"id": "firmware", "label": "Firmware", "tags": ["update"]},
                    {"id": "powercycle1", "label": "Power Cycle", "tags": ["reboot"]},
                    {"id": "importxml", "label": "Import XML", "tags": ["xml"]},
                ],
                "configbuild_j": [
                    {"id": "powerup_j", "label": "PowerUp", "tags": ["powerup"]},
                    {"id": "lldp_j", "label": "Enable LLDP", "tags": ["lldp"]},
                    {"id": "rackslot_j", "label": "RackSlot", "tags": ["rackslot"]},
                    {"id": "assettag_j", "label": "Asset Tag", "tags": ["assettag"]},
                    {"id": "firmware_j", "label": "Firmware", "tags": ["update"]},
                    {"id": "powercycle1_j", "label": "Power Cycle", "tags": ["reboot"]},
                    {"id": "idrac_j", "label": "Configure iDRAC", "tags": ["xml"]},
                ],
            },
        },
        "postprov": {
            "label": "Post-Provisioning Setup",
            "category": "Server",
            "description": "Executes post-provisioning automation after the base build is complete.",
            "playbookName": "PostProv.yaml",
            "enabled": True,
            "requiresInventory": True,
            "requiresWorkbook": False,
            "requiresFirmware": False,
            "requiresBiosXml": False,
            "supportsServerClass": False,
            "supportsHostLimit": True,
            "hasTasks": True,
            "cardInstructions": "",
            "tasks": {
                "postprov": [
                    {"id": "diagnostics", "label": "Diagnostics", "tags": ["diagnostics"]},
                    {"id": "disablelldp", "label": "Disable LLDP", "tags": ["disablelld"]},
                    {"id": "tsr", "label": "Collect/Export TSR", "tags": ["tsr"]},
                    {"id": "cleanup", "label": "CleanUp", "tags": ["cleanup"]},
                    {"id": "powerdown", "label": "PowerDown", "tags": ["shutdown"]},
                ],
            },
        },
        "quickqc": {
            "label": "Quick QC Validation",
            "category": "Server",
            "description": "Performs quick validation checks to confirm configuration compliance and readiness.",
            "playbookName": "QuickQC.yaml",
            "enabled": True,
            "requiresInventory": True,
            "requiresWorkbook": False,
            "requiresFirmware": False,
            "requiresBiosXml": False,
            "supportsServerClass": False,
            "supportsHostLimit": True,
            "hasTasks": False,
            "cardInstructions": "Runs entire playbook — no individual task selection.",
            "tasks": {"quickqc": []},
        },
        "cisco_switch": {
            "label": "Cisco Switch Automation",
            "category": "Network",
            "description": "Performs Cisco switch automation setup and firmware updates for deployment readiness.",
            "playbookName": "CiscoSwitch.yaml",
            "enabled": True,
            "requiresInventory": False,
            "requiresWorkbook": True,
            "requiresFirmware": False,
            "requiresBiosXml": False,
            "supportsServerClass": False,
            "supportsHostLimit": False,
            "hasTasks": True,
            "cardInstructions": "",
            "tasks": {
                "cisco_switch": [
                    {"id": "fw_update", "label": "Firmware Update", "tags": ["firmware"]},
                    {"id": "basic_config", "label": "Basic Config Setup", "tags": ["dhcp"]},
                ],
            },
        },
        "juniper_switch": {
            "label": "Juniper Switch Automation",
            "category": "Network",
            "description": "Performs Juniper switch automation setup using workbook-driven mappings and selected port ranges.",
            "playbookName": "JuniperSwitch.yaml",
            "enabled": True,
            "requiresInventory": False,
            "requiresWorkbook": True,
            "requiresFirmware": False,
            "requiresBiosXml": False,
            "supportsServerClass": False,
            "supportsHostLimit": False,
            "hasTasks": True,
            "cardInstructions": "",
            "tasks": {
                "juniper_switch": [
                    {"id": "fw_update_j", "label": "Firmware Update", "tags": ["firmware"]},
                    {"id": "basic_config_j", "label": "Basic Config Setup", "tags": ["dhcp"]},
                    {"id": "enable_lldp_j", "label": "Enable LLDP", "tags": ["lldp"]},
                ],
            },
        },
        "console_switch": {
            "label": "Console Switch Setup",
            "category": "Network",
            "description": "Configures 8-port console switches for serial console access to rack equipment.",
            "playbookName": "ConsoleSwitch.yaml",
            "enabled": True,
            "requiresInventory": False,
            "requiresWorkbook": True,
            "requiresFirmware": False,
            "requiresBiosXml": False,
            "supportsServerClass": False,
            "supportsHostLimit": False,
            "hasTasks": True,
            "cardInstructions": "",
            "tasks": {
                "console_switch": [
                    {"id": "fw_update_c", "label": "Firmware Update", "tags": ["firmware"]},
                    {"id": "basic_config_c", "label": "Basic Config Setup", "tags": ["dhcp"]},
                    {"id": "enable_lldp_c", "label": "Enable LLDP", "tags": ["lldp"]},
                ],
            },
        },
        "pdu": {
            "label": "PDU Setup",
            "category": "Power",
            "description": "Configures rack PDUs using a power cable mapping file.",
            "playbookName": "PDU.yaml",
            "enabled": True,
            "requiresInventory": False,
            "requiresWorkbook": True,
            "requiresFirmware": False,
            "requiresBiosXml": False,
            "supportsServerClass": False,
            "supportsHostLimit": False,
            "hasTasks": False,
            "cardInstructions": "",
            "tasks": {"pdu": []},
        },
    }
    _write_json(WORKFLOWS_FILE, defaults)
    log.info("[config] Created default workflows.json")


def list_workflows_config():
    """Return all workflow definitions."""
    return _load_workflows()


def list_workflows_public():
    """Return workflow definitions with enabled!=false filtered out (for job wizard)."""
    workflows = _load_workflows()
    return {k: v for k, v in workflows.items() if v.get("enabled", True)}


def save_workflow(wf_id, data):
    """Create or update a workflow definition."""
    if not wf_id or not re.match(r'^[a-z0-9_]+$', wf_id):
        raise ValidationError("Workflow ID must be lowercase alphanumeric/underscores")
    if not data.get("label"):
        raise ValidationError("Workflow label is required")
    workflows = _load_workflows()
    existing = workflows.get(wf_id, {})
    workflows[wf_id] = {
        "label": data.get("label", existing.get("label", "")),
        "category": data.get("category", existing.get("category", "Server")),
        "description": data.get("description", existing.get("description", "")),
        "playbookName": data.get("playbookName", existing.get("playbookName", "")),
        "enabled": bool(data.get("enabled", existing.get("enabled", True))),
        "requiresInventory": bool(data.get("requiresInventory", existing.get("requiresInventory", False))),
        "requiresWorkbook": bool(data.get("requiresWorkbook", existing.get("requiresWorkbook", False))),
        "requiresFirmware": bool(data.get("requiresFirmware", existing.get("requiresFirmware", False))),
        "requiresBiosXml": bool(data.get("requiresBiosXml", existing.get("requiresBiosXml", False))),
        "supportsServerClass": bool(data.get("supportsServerClass", existing.get("supportsServerClass", False))),
        "supportsHostLimit": bool(data.get("supportsHostLimit", existing.get("supportsHostLimit", False))),
        "hasTasks": bool(data.get("hasTasks", existing.get("hasTasks", True))),
        "cardInstructions": data.get("cardInstructions", existing.get("cardInstructions", "")),
        "tasks": data.get("tasks", existing.get("tasks", {})),
        "lastModified": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    _save_workflows(workflows)
    # Update runtime VALID_WORKFLOWS set
    global VALID_WORKFLOWS
    VALID_WORKFLOWS = set(workflows.keys())
    return workflows[wf_id]


def delete_workflow(wf_id):
    """Delete a workflow definition."""
    workflows = _load_workflows()
    if wf_id not in workflows:
        raise ValidationError(f"Workflow '{wf_id}' not found")
    del workflows[wf_id]
    _save_workflows(workflows)
    global VALID_WORKFLOWS
    VALID_WORKFLOWS = set(workflows.keys())
    return {"status": "deleted", "id": wf_id}


def _parse_audit_line(line: str) -> Optional[Dict[str, str]]:
    """Parse a single audit log line into a dict with timestamp, action, etc."""
    line = line.strip()
    if not line:
        return None
    entry: Dict[str, str] = {"raw": line}
    parts = line.split(" ", 2)
    if len(parts) >= 3:
        entry["timestamp"] = parts[0] + " " + parts[1]
        remainder = parts[2]
        for field in ("ACTION", "JOB", "USER", "IP", "DETAIL"):
            marker = f"{field}="
            idx = remainder.find(marker)
            if idx != -1:
                val_start = idx + len(marker)
                next_idx = len(remainder)
                for nf in ("ACTION", "JOB", "USER", "IP", "DETAIL"):
                    ni = remainder.find(f" {nf}=", val_start)
                    if ni != -1 and ni < next_idx:
                        next_idx = ni
                entry[field.lower()] = remainder[val_start:next_idx].strip()
    return entry


def read_audit_log(limit=200, offset=0, action_filter=None):
    """Read audit.log, return most-recent-first with parsed fields.

    Reads backward from end-of-file in 8 KB chunks to avoid loading
    the entire file into memory.  When action_filter is set, we must
    read enough lines to satisfy offset+limit after filtering.
    """
    audit_path = os.path.join(UI_BASE_DIR, "audit.log")
    if not os.path.isfile(audit_path):
        return {"entries": [], "total": 0}

    CHUNK = 8192
    af = action_filter.upper() if action_filter else None

    try:
        with open(audit_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            file_size = f.tell()

            if file_size == 0:
                return {"entries": [], "total": 0}

            # If filtering, we need to read the whole file to get accurate total
            # For non-filtered, read backward and stop once we have enough
            if af:
                # Stream line-by-line instead of bulk load
                f.seek(0)
                all_matching = []
                for raw_line in f:
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\n")
                    entry = _parse_audit_line(line)
                    if entry and af in (entry.get("action", "")).upper():
                        all_matching.append(entry)
                all_matching.reverse()
                total = len(all_matching)
                page = all_matching[offset:offset + limit]
                return {"entries": page, "total": total}

            # No filter: read backward, collect only what we need
            need = offset + limit + 1  # +1 buffer for partial line at boundary
            collected_data = b""
            pos = file_size

            while pos > 0 and collected_data.count(b"\n") < need + 1:
                read_size = min(CHUNK, pos)
                pos -= read_size
                f.seek(pos)
                collected_data = f.read(read_size) + collected_data

            lines = collected_data.decode("utf-8", errors="replace").split("\n")
            lines.reverse()

            all_entries = []
            for line in lines:
                entry = _parse_audit_line(line)
                if entry:
                    all_entries.append(entry)
                    if len(all_entries) >= offset + limit:
                        break

            # For total count without filter, use a fast line count
            f.seek(0)
            total = sum(1 for ln in f if ln.strip())

            page = all_entries[offset:offset + limit]
            return {"entries": page, "total": total}

    except Exception:
        log.warning("[audit] Failed to read audit log", exc_info=True)
        return {"entries": [], "total": 0}


def get_admin_stats():
    """Return summary counts for admin KPI cards."""
    users = _load_users()
    customers = _load_customers()
    workflows = _load_workflows()
    audit_path = os.path.join(UI_BASE_DIR, "audit.log")
    audit_count = 0
    if os.path.isfile(audit_path):
        try:
            with open(audit_path, "r") as f:
                audit_count = sum(1 for _ in f)
        except Exception:
            log.warning("[admin] Failed to count audit log entries", exc_info=True)
    return {
        "users": len(users),
        "customers": len(customers),
        "workflows": len(workflows),
        "audit_entries": audit_count,
    }


def export_audit_csv(action_filter=None):
    """Return all audit entries as CSV text, optionally filtered by action."""
    result = read_audit_log(limit=100000, offset=0, action_filter=action_filter)
    entries = result.get("entries", [])
    import io, csv
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp", "Action", "User", "Job", "IP", "Detail"])
    for e in entries:
        writer.writerow([
            e.get("timestamp", ""),
            e.get("action", ""),
            e.get("user", ""),
            e.get("job", ""),
            e.get("ip", ""),
            e.get("detail", ""),
        ])
    return output.getvalue()


DB_PATH = os.path.join(JOBS_ROOT, "jobs.db")
_db_local = threading.local()


def _get_db() -> sqlite3.Connection:
    """Return a thread-local SQLite connection (WAL mode, 10s busy timeout)."""
    conn = getattr(_db_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        conn.row_factory = sqlite3.Row
        _db_local.conn = conn
    return conn


def _init_db() -> None:
    """Create the jobs table if it doesn't exist, then migrate any legacy JSON."""
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id      TEXT PRIMARY KEY,
            job_name    TEXT NOT NULL DEFAULT '',
            workflow    TEXT NOT NULL DEFAULT 'configbuild',
            status      TEXT NOT NULL DEFAULT 'saved',
            created_at  TEXT,
            updated_at  TEXT,
            data        TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC)")
    conn.commit()

    # One-time migration: import existing job.json files into SQLite
    if not os.path.isdir(JOBS_ROOT):
        return
    migrated = 0
    for entry in os.listdir(JOBS_ROOT):
        jpath = os.path.join(JOBS_ROOT, entry, "job.json")
        if not os.path.isfile(jpath):
            continue
        # Skip if already in DB
        row = conn.execute("SELECT 1 FROM jobs WHERE job_id = ?", (entry,)).fetchone()
        if row:
            continue
        try:
            with open(jpath, "r", encoding="utf-8") as f:
                job = json.load(f)
            conn.execute(
                "INSERT INTO jobs (job_id, job_name, workflow, status, created_at, updated_at, data) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    entry,
                    job.get("jobName", ""),
                    job.get("workflow", "configbuild"),
                    job.get("status", "saved"),
                    job.get("createdAt", ""),
                    job.get("createdAt", ""),
                    json.dumps(job, ensure_ascii=False),
                ),
            )
            migrated += 1
        except Exception:
            log.warning("[db] Failed to migrate job.json for %s", entry[:80], exc_info=True)
            continue
    if migrated:
        conn.commit()
        log.info("[db] Migrated %d legacy job.json files into SQLite", migrated)


def db_get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Read a job from SQLite. Returns the parsed dict or None."""
    conn = _get_db()
    row = conn.execute("SELECT data FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
    if not row:
        return None
    return json.loads(row[0])


def db_save_job(job_id: str, job: Dict[str, Any]) -> None:
    """Insert or replace a job in SQLite (atomic upsert)."""
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO jobs (job_id, job_name, workflow, status, created_at, updated_at, data) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            job_id,
            job.get("jobName", ""),
            job.get("workflow", "configbuild"),
            job.get("status", "saved"),
            job.get("createdAt", ""),
            _now(),
            json.dumps(job, ensure_ascii=False),
        ),
    )
    conn.commit()
    # Also write job.json as a backup / for debugging
    jpath = os.path.join(JOBS_ROOT, job_id, "job.json")
    if os.path.isdir(os.path.dirname(jpath)):
        _write_json(jpath, job)


def db_delete_job(job_id: str) -> None:
    """Remove a job from SQLite."""
    conn = _get_db()
    conn.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
    conn.commit()


def db_list_jobs() -> List[Dict[str, Any]]:
    """List all jobs from SQLite, ordered by created_at DESC."""
    conn = _get_db()
    rows = conn.execute("SELECT data FROM jobs ORDER BY created_at DESC").fetchall()
    jobs = []
    for row in rows:
        try:
            jobs.append(json.loads(row[0]))
        except Exception:
            log.warning("[db] Skipping malformed job row: %s", str(row[0])[:80], exc_info=True)
            continue
    return jobs


# Initialize database on module load
_init_db()


PLAYBOOK_ROOT = "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4"
CENTRAL_GENERATE_INVENTORY = os.path.join(PLAYBOOK_ROOT, "generate_inventory.py")

# IMPORTANT: your generate_inventory.py is writing to this (per your output)
# so we fall back to it if --out isn't honored.
FALLBACK_GENERATED_HOSTS = "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/hosts"

DEFAULT_INVENTORY_NAME = "target_hosts"

# Valid workflow names (what the frontend sends)
VALID_WORKFLOWS = {"configbuild", "postprov", "quickqc", "cisco_switch", "juniper_switch", "console_switch", "pdu"}

# DellServerAuto_4 uses separate J/I class playbooks for configbuild
WORKFLOW_PLAYBOOKS = {
    "configbuild_j": "ConfigMain._J_class.yaml",
    "configbuild_i": "ConfigMain._I_class.yaml",
    "postprov": "post_provisioning.yaml",
    "quickqc": "Quick_QC.yaml",
}

# ✅ UPDATED: allow firmware payload uploads (exe/bin) in addition to csv/xml/yaml
ALLOWED_UPLOAD_EXTS = {".csv", ".xml", ".yml", ".yaml", ".exe", ".bin", ".img", ".tgz"}

# Max concurrent ansible-playbook runs across all workers
MAX_CONCURRENT_RUNS = 50


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def _slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "job"

_JOB_ID_RE = re.compile(r'^[a-z0-9_]{1,200}$')

def validate_job_id(job_id):
    """Validate job ID format — only lowercase alphanumeric and underscores."""
    if not _JOB_ID_RE.match(job_id):
        raise ValidationError(f"Invalid job ID: {job_id}")

def _job_dir(job_id: str) -> str:
    return os.path.join(JOBS_ROOT, job_id)

def _job_json(job_id: str) -> str:
    return os.path.join(_job_dir(job_id), "job.json")

def _job_lock(job_id: str) -> FileLock:
    """Return a FileLock for this job's directory (cross-process safe)."""
    return FileLock(os.path.join(_job_dir(job_id), "job.lock"), timeout=10)

# Protects the in-memory _running_procs dict across threads within one worker
_proc_lock = threading.Lock()

# Cross-process lock for checking + starting ansible runs (prevents race on slot count)
_run_gate_lock = FileLock(os.path.join(JOBS_ROOT, ".run_gate.lock"), timeout=15)


def _count_active_runs() -> int:
    """Count jobs with status=running and a live PID (cross-process safe via SQLite)."""
    conn = _get_db()
    rows = conn.execute("SELECT data FROM jobs WHERE status = 'running'").fetchall()
    count = 0
    for row in rows:
        try:
            job = json.loads(row[0])
            pid = _safe_int(job.get("lastPid"))
            if pid and _pid_alive(pid):
                count += 1
        except Exception:
            log.warning("[jobs] Error counting active run", exc_info=True)
            continue
    return count

def _count_active_run_groups() -> int:
    """Count individual live PIDs (run groups) across ALL jobs.

    For jobs with activeRuns, each group PID counts separately.
    For legacy jobs, lastPid counts as 1.
    """
    conn = _get_db()
    rows = conn.execute("SELECT data FROM jobs WHERE status = 'running'").fetchall()
    count = 0
    for row in rows:
        try:
            job = json.loads(row[0])
            active_runs = job.get("activeRuns")
            if active_runs and isinstance(active_runs, dict):
                for gid, ginfo in active_runs.items():
                    pid = _safe_int(ginfo.get("pid"))
                    if pid and _pid_alive(pid):
                        count += 1
            else:
                pid = _safe_int(job.get("lastPid"))
                if pid and _pid_alive(pid):
                    count += 1
        except Exception:
            log.warning("[jobs] Error counting active run group", exc_info=True)
            continue
    return count


def _read_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def _write_json(path: str, data: Dict[str, Any]) -> None:
    import tempfile
    dir_name = os.path.dirname(path)
    # Backup existing file before overwriting
    if os.path.isfile(path):
        try:
            shutil.copy2(path, path + ".bak")
        except OSError:
            pass
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

def _ensure_job_dirs(job_id: str) -> None:
    os.makedirs(_job_dir(job_id), exist_ok=True)
    os.makedirs(os.path.join(_job_dir(job_id), "uploads"), exist_ok=True)
    os.makedirs(os.path.join(_job_dir(job_id), "runs"), exist_ok=True)
    os.makedirs(os.path.join(_job_dir(job_id), "firmware"), exist_ok=True)
    os.makedirs(os.path.join(_job_dir(job_id), "TSR"), exist_ok=True)
    os.makedirs(os.path.join(_job_dir(job_id), "QuickQC"), exist_ok=True)

NFS_HOST = "10.3.3.157"


def _generate_vars_yml(job_id: str, _job: Optional[Dict[str, Any]] = None) -> str:
    """Generate a vars.yml for this job with correct paths and filenames.

    Pass _job to skip the get_job() call (avoids deadlock when already locked).
    """
    job = _job if _job is not None else get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    jdir = _job_dir(job_id)
    fw_dir = _firmware_dir(job_id)
    tsr_dir = os.path.join(jdir, "TSR")
    qc_dir = os.path.join(jdir, "QuickQC")

    # Find uploaded filenames by role
    files = job.get("files", []) or []
    bios_xml_name = ""
    workbook_name = ""
    for f in files:
        if f.get("role") == "bios_xml":
            bios_xml_name = f.get("filename", "")
        elif f.get("role") == "workbook":
            workbook_name = f.get("filename", "")

    vars_content = (
        "# Auto-generated vars for job: {job_name}\n"
        "# Job ID: {job_id}\n"
        "# Generated: {now}\n"
        "\n"
        "# ───── iDRAC Credentials (from inventory) ─────\n"
        'idrac_user: "{{{{ ansible_ssh_user }}}}"\n'
        'idrac_password: "{{{{ ansible_ssh_pass }}}}"\n'
        'idrac_ip: "{{{{ inventory_hostname }}}}"\n'
        "\n"
        "# ───── File Paths ─────\n"
        'local_path: "{jdir}"\n'
        'local_path_tsr: "{tsr_dir}"\n'
        'local_path_QuickQC: "{qc_dir}"\n'
        'nfs_share_path: "{nfs_host}:{fw_dir}"\n'
        "\n"
        "# ───── File Names ─────\n"
        'scp_file_name: "{bios_xml}"\n'
        'catalog_file_name: "Catalog.xml"\n'
        'mapping_file: "{workbook}"\n'
        'asset_tag_mapping_file: "{workbook}"\n'
        "\n"
        "# ───── Power & Shutdown ─────\n"
        'shutdown_type: "Graceful"\n'
        'end_host_power_state: "On"\n'
        "\n"
        "# ───── Job Execution Options ─────\n"
        "job_wait: true\n"
        "validate_certs: false\n"
        'run_mode: "express"\n'
        "\n"
        "# ───── Pause Timing (in seconds) ─────\n"
        "pause_powerup_seconds: 300\n"
        "pause_lldp_seconds: 300\n"
        "pause_provision_seconds: 420\n"
        "pause_firmware_seconds: 300\n"
        "pause_reboot_seconds: 300\n"
        "pause_configure_seconds: 300\n"
        "pause_powercycle_seconds: 600\n"
    ).format(
        job_name=job.get("jobName", ""),
        job_id=job_id,
        now=_now(),
        jdir=jdir,
        tsr_dir=tsr_dir,
        qc_dir=qc_dir,
        nfs_host=NFS_HOST,
        fw_dir=fw_dir,
        bios_xml=bios_xml_name,
        workbook=workbook_name,
    )

    vars_path = os.path.join(jdir, "vars.yml")
    with open(vars_path, "w", encoding="utf-8") as f:
        f.write(vars_content)
    return vars_path

def _firmware_dir(job_id: str) -> str:
    return os.path.join(_job_dir(job_id), "firmware")


def _parse_dell_firmware_filename(fname: str) -> Dict[str, str]:
    """Parse Dell firmware filename pattern to extract packageID, version, osCode, dellVersion.

    Examples:
      Firmware_6Y9X7_WN64_7.10_A00_10.EXE → pkgId=6Y9X7, osCode=WN64, version=7.10, dellVersion=A00
      iDRAC-with-Lifecycle-Controller_Firmware_6CKFT_WN64_7.20.60.50_A00.EXE → pkgId=6CKFT, version=7.20.60.50
      BIOS_GPMNW_WN64_2.8.2.EXE → pkgId=GPMNW, osCode=WN64, version=2.8.2, dellVersion=A00
    """
    name_part = os.path.splitext(fname)[0]  # strip extension

    # Pattern 1: _PKGID_OSCODE_VERSION_DELLVERSION (with A00 suffix)
    m = re.search(r'_([A-Za-z0-9]{5})_(W[A-Za-z0-9]+)_([\d.]+)_(A\d+)', name_part)
    if m:
        return {
            "packageID": m.group(1),
            "osCode": m.group(2),
            "vendorVersion": m.group(3),
            "dellVersion": m.group(4),
        }

    # Pattern 2: _PKGID_OSCODE_VERSION (no A00 suffix, e.g. BIOS_GPMNW_WN64_2.8.2)
    m = re.search(r'_([A-Za-z0-9]{5})_(W[A-Za-z0-9]+)_([\d.]+)$', name_part)
    if m:
        return {
            "packageID": m.group(1),
            "osCode": m.group(2),
            "vendorVersion": m.group(3),
            "dellVersion": "A00",
        }

    # Fallback: split by underscore
    parts = name_part.split("_")
    if len(parts) >= 4:
        return {
            "packageID": parts[1],
            "osCode": parts[2] if len(parts) > 2 else "WN64",
            "vendorVersion": parts[3],
            "dellVersion": parts[4] if len(parts) > 4 else "A00",
        }

    return {
        "packageID": name_part[:5],
        "osCode": "WN64",
        "vendorVersion": "0.0",
        "dellVersion": "A00",
    }


def _compute_md5(filepath: str) -> str:
    """Compute MD5 hash of a file."""
    import hashlib
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _detect_firmware_type(fname: str) -> str:
    """Detect firmware type from Dell filename. Returns: idrac, bios, backplane, cpld, generic."""
    fname_lower = fname.lower()
    if "idrac" in fname_lower or "lifecycle" in fname_lower:
        return "idrac"
    if "bios" in fname_lower:
        return "bios"
    if "backplane" in fname_lower or "sep" in fname_lower:
        return "backplane"
    if "cpld" in fname_lower:
        return "cpld"
    return "generic"


# All 16th-gen PowerEdge models with BIOS systemIDs — used for SupportedSystems
_PE_MODELS = [
    ("0A6C", "R660"), ("0A6B", "R760"), ("0AF6", "R6615"), ("0AF7", "R7615"),
    ("0AF8", "R6625"), ("0AF9", "R7625"), ("0AAD", "R860"), ("0AAE", "R960"),
    ("0B72", "R760XA"), ("0B53", "R760XD2"), ("0B9D", "R660XS"), ("0B9E", "R760XS"),
    ("0B52", "T560"), ("0C44", "T360"), ("0C46", "T160"), ("0A93", "R250"),
    ("0A92", "T350"), ("0A94", "R350"), ("0A91", "T150"), ("0C47", "R260"),
    ("0C45", "R360"), ("0A17", "R450"), ("0A18", "R550"), ("0A19", "R650xs"),
    ("0A1A", "R750xs"), ("0A1B", "T550"), ("0912", "R650"), ("090E", "R750"),
    ("090F", "R750xa"), ("0917", "C6520"), ("0A6D", "C6620"), ("0C60", "C6615"),
    ("0B74", "XE8640"), ("0B73", "XE9680"), ("0BBE", "XE9640"), ("0CF2", "XE9680L"),
    ("0D44", "XE9685L"), ("0A2D", "XE8545"), ("0B88", "XR7620"), ("0BDE", "XR8620t"),
    ("0BDD", "XR8610t"), ("0B1B", "XR5610"), ("0AD6", "XR4520c"), ("0ABD", "XR4510c"),
    ("09D4", "XR11"), ("09D5", "XR12"), ("0B4F", "HS5610"), ("0B51", "HS5620"),
    ("0A8A", "MX760c"), ("094A", "MX750c"), ("08FC", "R6515"), ("08FD", "R7515"),
    ("08FE", "R6525"), ("08FF", "R7525"), ("0900", "C6525"),
]



# ─────────────────────────────────────────────────────────────
# DELL OFFICIAL CATALOG LOOKUP
# ─────────────────────────────────────────────────────────────
# Cache Dell's official catalog.xml and extract SoftwareComponent entries
# by packageID. This lets ANY Dell firmware "just work" without manual metadata.

DELL_CATALOG_CACHE = os.path.join(UI_BASE_DIR, "dell_catalog_cache.xml")
DELL_CATALOG_URL = "https://downloads.dell.com/catalog/Catalog.xml.gz"
_dell_component_cache: Dict[str, str] = {}  # packageID → XML string


def _load_dell_catalog() -> str:
    """Load the Dell catalog content (from cache or download).
    Returns the full XML content as a string."""
    # Use local cache if recent (less than 7 days old)
    if os.path.isfile(DELL_CATALOG_CACHE):
        age = time.time() - os.path.getmtime(DELL_CATALOG_CACHE)
        if age < 7 * 86400:
            with open(DELL_CATALOG_CACHE, "r", encoding="utf-8") as f:
                return f.read()

    # Also check /tmp/dell_catalog.xml (previously downloaded)
    tmp_catalog = "/tmp/dell_catalog.xml"
    if os.path.isfile(tmp_catalog):
        with open(tmp_catalog, "r", encoding="utf-16-le") as f:
            content = f.read()
        # Cache it in our dir as utf-8 for faster reads
        with open(DELL_CATALOG_CACHE, "w", encoding="utf-8") as f:
            f.write(content)
        return content

    # Try to download
    try:
        import urllib.request
        import gzip
        log.info("[catalog] Downloading Dell catalog from downloads.dell.com ...")
        req = urllib.request.Request(DELL_CATALOG_URL, headers={"User-Agent": "AnsibleUI/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            gz_data = resp.read()
        xml_bytes = gzip.decompress(gz_data)
        # Dell catalog is UTF-16LE with BOM
        content = xml_bytes.decode("utf-16-le", errors="replace")
        with open(DELL_CATALOG_CACHE, "w", encoding="utf-8") as f:
            f.write(content)
        log.info("[catalog] Dell catalog cached successfully.")
        return content
    except Exception as e:
        log.warning("[catalog] Could not download Dell catalog: %s", e)
        return ""


def _lookup_dell_component(package_id: str, local_filename: str) -> Optional[str]:
    """Look up a SoftwareComponent entry from Dell's catalog by packageID.
    Returns the XML string with 'path' rewritten to local_filename, or None."""
    if not _dell_component_cache:
        content = _load_dell_catalog()
        if content:
            # Parse all SoftwareComponent entries into cache
            for m in re.finditer(
                r'(<SoftwareComponent[^>]*packageID="([^"]*)"[^>]*>.*?</SoftwareComponent>)',
                content, re.DOTALL
            ):
                pid = m.group(2)
                if pid not in _dell_component_cache:
                    _dell_component_cache[pid] = m.group(1)
            log.info("[catalog] Indexed %d Dell firmware entries.", len(_dell_component_cache))

    xml = _dell_component_cache.get(package_id)
    if not xml:
        return None

    # Rewrite path="" to point to our local filename
    xml = re.sub(r'path="[^"]*"', f'path="{local_filename}"', xml, count=1)
    return xml


def _generate_catalog(job_id: str) -> str:
    """Scan jobs/{job_id}/firmware/ for .exe/.bin, write Dell-format Catalog.xml.

    Strategy: look up each firmware file in Dell's official catalog by packageID.
    If found, use the exact XML from Dell (metadata-perfect for any firmware).
    If not found, fall back to generated XML based on filename detection.
    """
    import uuid

    fw_dir = _firmware_dir(job_id)
    catalog_path = os.path.join(fw_dir, "Catalog.xml")

    fw_files = [
        f for f in os.listdir(fw_dir)
        if os.path.isfile(os.path.join(fw_dir, f))
        and os.path.splitext(f)[1].lower() in (".exe", ".bin")
    ]

    now_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    manifest_id = str(uuid.uuid4())
    bundle_id = str(uuid.uuid4())

    # ── Build Package list for SoftwareBundle Contents ──
    package_lines = ""
    for fname in sorted(fw_files):
        package_lines += f'            <Package path="{fname}"/>\n'

    # ── Build SoftwareComponent entries ──
    # Try Dell catalog lookup first, fall back to manual generation
    component_lines = ""
    dell_hit = 0
    dell_miss = 0
    for fname in sorted(fw_files):
        meta = _parse_dell_firmware_filename(fname)
        pkg_id = meta["packageID"]

        # Try Dell official catalog lookup
        dell_xml = _lookup_dell_component(pkg_id, fname)
        if dell_xml:
            # Indent the Dell XML to fit inside our Manifest
            # Dell entries are already complete SoftwareComponent blocks
            component_lines += f"    {dell_xml}\n"
            dell_hit += 1
            log.info("[catalog] %s: matched Dell catalog (packageID=%s)", fname, pkg_id)
            continue

        dell_miss += 1
        log.info("[catalog] %s: no Dell match, using fallback (packageID=%s)", fname, pkg_id)

        # ── Fallback: generate SoftwareComponent from filename ──
        fpath = os.path.join(fw_dir, fname)
        fsize = os.path.getsize(fpath)
        md5hash = _compute_md5(fpath)
        version = meta["vendorVersion"]
        dell_ver = meta["dellVersion"]
        fw_type = _detect_firmware_type(fname)

        # Build SupportedSystems for fallback
        models_xml = ""
        for sys_id, name in _PE_MODELS:
            models_xml += (
                f'                <Model systemID="{sys_id}" systemIDType="BIOS">\n'
                f'                    <Display lang="en"><![CDATA[{name}]]></Display>\n'
                f'                </Model>\n'
            )
        supported_systems = (
            f'        <SupportedSystems>\n'
            f'            <Brand key="3" prefix="PE">\n'
            f'                <Display lang="en"><![CDATA[PowerEdge]]></Display>\n'
            f'{models_xml}'
            f'            </Brand>\n'
            f'        </SupportedSystems>'
        )

        if fw_type == "idrac":
            display_name = f"iDRAC {version}"
            lu_cat = "iDRAC with Lifecycle Controller"
            cat_val = "iDRAC with Lifecycle Controller"
            devices_block = (
                f'        <SupportedDevices>\n'
                f'            <Device componentID="25227" embedded="1">\n'
                f'                <Display lang="en"><![CDATA[iDRAC with Lifecycle Controller]]></Display>\n'
                f'                <RollbackInformation fmpWrapperIdentifier="28A17667-2D38-4BDA-9C21-3309D5B1FCD0" impactsTPMmeasurements="false" rollbackIdentifier="7d0f4554-8f84-42f7-8839-fa980b04a6fc" rollbackTimeout="2400" rollbackVolume="MAS022"/>\n'
                f'                <PayloadConfiguration>\n'
                f'                    <Image filename="" identifier="C7FF9BB7-B703-4465-B10A-612234B057D3" skip="false" type="FRMW" version="{version}"/>\n'
                f'                </PayloadConfiguration>\n'
                f'            </Device>\n'
                f'        </SupportedDevices>'
            )
            fmp_block = (
                f'        <FMPWrappers>\n'
                f'            <FMPWrapperInformation digitalSignature="false" filePathName="iDracWrapper.efi" identifier="28A17667-2D38-4BDA-9C21-3309D5B1FCD0" name="DRAC">\n'
                f'                <Inventory source="LCL" supported="true"/>\n'
                f'                <Update rollback="true" supported="true"/>\n'
                f'            </FMPWrapperInformation>\n'
                f'        </FMPWrappers>\n'
            )
            sc_attrs = (
                f'dateTime="{now_iso}" dellVersion="{dell_ver}" '
                f'hashMD5="{md5hash}" packageID="{pkg_id}" packageType="LW64" '
                f'path="{fname}" rebootRequired="false" '
                f'releaseDate="{datetime.now().strftime("%B %d, %Y")}" releaseID="{pkg_id}" '
                f'schemaVersion="2.4" size="{fsize}" '
                f'vendorVersion="{version}"'
            )
            comp_type_val = "FRMW"
            comp_type_display = "Firmware"
        elif fw_type == "bios":
            display_name = f"Dell Server PowerEdge BIOS Version {version}"
            lu_cat = "BIOS"
            cat_val = "BI"
            bios_image_id = str(uuid.uuid4()).upper()
            bios_rb_id = str(uuid.uuid4()).lower()
            bios_fmp_id = str(uuid.uuid4()).lower()
            bios_fmpw_id = str(uuid.uuid4()).lower()
            devices_block = (
                f'        <SupportedDevices>\n'
                f'            <Device componentID="159" embedded="1">\n'
                f'                <Display lang="en"><![CDATA[BIOS]]></Display>\n'
                f'                <RollbackInformation alternateRollbackIdentifier="159" fieldService="forced" fmpIdentifier="{bios_fmp_id}" fmpWrapperIdentifier="{bios_fmpw_id}" fmpWrapperVersion="1.0" impactsTPMmeasurements="false" rollbackIdentifier="{bios_rb_id}" rollbackTimeout="720" rollbackVolume="MAS022" />\n'
                f'                <PayloadConfiguration>\n'
                f'                    <Image filename="" id="{bios_image_id}" skip="false" type="BIOS" version="{version}" />\n'
                f'                </PayloadConfiguration>\n'
                f'            </Device>\n'
                f'        </SupportedDevices>'
            )
            fmp_block = ""
            sc_attrs = (
                f'dateTime="{now_iso}" dellVersion="{version}" '
                f'hashMD5="{md5hash}" packageID="{pkg_id}" packageType="LW64" '
                f'path="{fname}" rebootRequired="true" '
                f'releaseDate="{datetime.now().strftime("%B %d, %Y")}" releaseID="{pkg_id}" '
                f'schemaVersion="2.4" size="{fsize}" '
                f'vendorVersion="{version}"'
            )
            comp_type_val = "BIOS"
            comp_type_display = "BIOS"
        else:
            display_name = fname
            lu_cat = "Firmware"
            cat_val = "FW"
            devices_block = (
                f'        <SupportedDevices>\n'
                f'            <Device componentID="0" embedded="1">\n'
                f'                <Display lang="en"><![CDATA[{fname}]]></Display>\n'
                f'            </Device>\n'
                f'        </SupportedDevices>'
            )
            fmp_block = ""
            sc_attrs = (
                f'dateTime="{now_iso}" dellVersion="{dell_ver}" '
                f'hashMD5="{md5hash}" packageID="{pkg_id}" packageType="LW64" '
                f'path="{fname}" rebootRequired="false" '
                f'releaseDate="{datetime.now().strftime("%B %d, %Y")}" releaseID="{pkg_id}" '
                f'schemaVersion="2.4" size="{fsize}" '
                f'vendorVersion="{version}"'
            )
            comp_type_val = "FRMW"
            comp_type_display = "Firmware"

        component_lines += (
            f'    <SoftwareComponent {sc_attrs}>\n'
            f'        <Name>\n'
            f'            <Display lang="en"><![CDATA[{display_name}]]></Display>\n'
            f'        </Name>\n'
            f'        <ComponentType value="{comp_type_val}">\n'
            f'            <Display lang="en"><![CDATA[{comp_type_display}]]></Display>\n'
            f'        </ComponentType>\n'
            f'        <Description>\n'
            f'            <Display lang="en"><![CDATA[{display_name}]]></Display>\n'
            f'        </Description>\n'
            f'        <LUCategory value="{lu_cat}">\n'
            f'            <Display lang="en"><![CDATA[{lu_cat}]]></Display>\n'
            f'        </LUCategory>\n'
            f'        <Category value="{cat_val}">\n'
            f'            <Display lang="en"><![CDATA[{cat_val}]]></Display>\n'
            f'        </Category>\n'
            f'{devices_block}\n'
            f'{supported_systems}\n'
            f'        <RevisionHistory>\n'
            f'            <Display lang="en"><![CDATA[{display_name}]]></Display>\n'
            f'        </RevisionHistory>\n'
            f'        <ImportantInfo URL="https://www.dell.com/support/home/en-us/drivers/DriversDetails?driverId={pkg_id}">\n'
            f'            <Display lang="en"><![CDATA[NA]]></Display>\n'
            f'        </ImportantInfo>\n'
            f'        <Criticality value="1">\n'
            f'            <Display lang="en"><![CDATA[Recommended]]></Display>\n'
            f'        </Criticality>\n'
            f'{fmp_block}'
            f'    </SoftwareComponent>\n'
        )

    log.info("[catalog] Generated: %d from Dell catalog, %d fallback", dell_hit, dell_miss)

    # ── Assemble full catalog XML (exact Dell format) ──
    xml_content = (
        f'\ufeff<?xml version="1.0" encoding="UTF-16LE" standalone="no"?>'
        f'<Manifest baseLocation="" dateTime="{now_iso}" '
        f'identifier="{manifest_id}" releaseID="CUSTOM" version="1.01">\n'
        # InventoryComponent (required by iDRAC for catalog validation)
        f'    <InventoryComponent dateTime="2025-06-02T04:09:54Z" dellVersion="A00" '
        f'hashMD5="fb937f0977146266ef42ab7936835007" osCode="WIN64" '
        f'path="FOLDER13183736M/1/invCol_WIN64_6CTYC_25_06_00_403_A00.exe" '
        f'releaseDate="June 02, 2025" releaseID="6CTYC" schemaVersion="2.0" '
        f'vendorVersion="25.06.00"/>\n'
        # SoftwareBundle
        f'    <SoftwareBundle bundleID="CUSTOM_WN64" bundleType="BTW64" '
        f'dateTime="{now_iso}" identifier="{bundle_id}" '
        f'path="custom-bundle.xml" predecessorID="{bundle_id}" '
        f'releaseID="CUSTOM_WN64" schemaVersion="2.4" size="0" '
        f'vendorVersion="1.0">\n'
        f'        <Name>\n'
        f'            <Display lang="en">Custom Firmware Bundle</Display>\n'
        f'        </Name>\n'
        f'        <ComponentType value="SBDL">\n'
        f'            <Display lang="en">Dell System Bundle</Display>\n'
        f'        </ComponentType>\n'
        f'        <Description>\n'
        f'            <Display lang="en">Custom Firmware Bundle</Display>\n'
        f'        </Description>\n'
        f'        <Category value="SM">\n'
        f'            <Display lang="en">Systems Management</Display>\n'
        f'        </Category>\n'
        f'        <TargetOSes>\n'
        f'            <OperatingSystem majorVersion="" minorVersion="" osCode="WIN64" '
        f'osVendor="Microsoft" preinstallationEnvironment="false" '
        f'spMajorVersion="" spMinorVersion="" suiteMask="0">\n'
        f'                <Display lang="en">Microsoft Windows x64</Display>\n'
        f'            </OperatingSystem>\n'
        f'        </TargetOSes>\n'
        f'        <TargetSystems>\n'
        f'            <Brand key="3" prefix="PE">\n'
        f'                <Display lang="en">PowerEdge</Display>\n'
        f'                <Model systemID="0A6C" systemIDType="BIOS">\n'
        f'                    <Display lang="en">R660</Display>\n'
        f'                </Model>\n'
        f'            </Brand>\n'
        f'        </TargetSystems>\n'
        f'        <RevisionHistory>\n'
        f'            <Display lang="en"/>\n'
        f'        </RevisionHistory>\n'
        f'        <ImportantInfo URL="http://www.dell.com/support">\n'
        f'            <Display lang="en"/>\n'
        f'        </ImportantInfo>\n'
        f'        <Contents>\n'
        f'{package_lines}'
        f'        </Contents>\n'
        f'    </SoftwareBundle>\n'
        f'{component_lines}'
        f'    <Prerequisites/>\n'
        f'</Manifest>\n'
    )

    with open(catalog_path, "w", encoding="utf-16-le") as f:
        f.write(xml_content)

    return catalog_path


def _allowed_ext(filename: str) -> bool:
    return os.path.splitext(filename)[1].lower() in ALLOWED_UPLOAD_EXTS

def _tail(s: str, n: int = 8000) -> str:
    s = s or ""
    return s if len(s) <= n else s[-n:]

def _file_ok(path: str, min_bytes: int = 5) -> bool:
    return bool(path) and os.path.isfile(path) and os.path.getsize(path) >= min_bytes

def _safe_int(v: Any) -> Optional[int]:
    try:
        iv = int(str(v).strip())
        return iv if iv > 0 else None
    except Exception:
        return None

def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except Exception:
        return False
    # Check for zombie (defunct) processes — they respond to kill(0) but are not truly alive
    try:
        with open(f"/proc/{pid}/status", "r") as f:
            for line in f:
                if line.startswith("State:"):
                    return "Z" not in line  # Z = zombie
    except Exception:
        pass
    return True

def get_json_request() -> Dict[str, Any]:
    """Extract JSON body from the current Flask request."""
    data = request.get_json(silent=True)
    if data is None:
        return {}
    return data

def get_uploaded_file():
    """Return the uploaded file object from the current Flask request."""
    f = request.files.get("file")
    if not f:
        raise ValidationError("No file in request (expected form field 'file')")
    return f

def get_form_value(key: str, default: str = "") -> str:
    """Return a form field value from the current Flask request."""
    return request.form.get(key, default)

# Track Popen objects so we can reap zombies
_running_procs: Dict[int, subprocess.Popen] = {}

# Maximum wall-clock time for a single playbook run (4 hours)
MAX_RUN_TIMEOUT = 4 * 3600


def _reap_stale_processes():
    """Background thread that kills playbook processes older than MAX_RUN_TIMEOUT."""
    while True:
        time.sleep(60)
        try:
            with _proc_lock:
                stale = []
                for pid, proc in _running_procs.items():
                    try:
                        # Check how long the process has been running via /proc
                        stat_path = f"/proc/{pid}/stat"
                        if os.path.isfile(stat_path):
                            boot_ticks = os.sysconf("SC_CLK_TCK")
                            with open(stat_path, "r") as f:
                                fields = f.read().split()
                            start_ticks = int(fields[21])
                            with open("/proc/uptime", "r") as f:
                                uptime_secs = float(f.read().split()[0])
                            elapsed = uptime_secs - (start_ticks / boot_ticks)
                            if elapsed > MAX_RUN_TIMEOUT:
                                stale.append((pid, proc, elapsed))
                    except Exception:
                        pass
                for pid, proc, elapsed in stale:
                    log.warning("[reaper] Killing stale process pid=%d (running %.0fs > %ds limit)",
                                pid, elapsed, MAX_RUN_TIMEOUT)
                    try:
                        proc.kill()
                        proc.wait(timeout=5)
                    except Exception:
                        pass
                    _running_procs.pop(pid, None)
        except Exception:
            log.warning("[reaper] Error in stale process reaper", exc_info=True)


# Start the reaper thread on module load
_reaper_thread = threading.Thread(target=_reap_stale_processes, daemon=True, name="proc-reaper")
_reaper_thread.start()


def _parse_run_result_from_log(log_path: str) -> str:
    """Parse a specific log file for PLAY RECAP to determine passed/failed/''."""
    if not log_path or not os.path.isfile(log_path):
        return ""
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if "PLAY RECAP" not in content:
            return ""
        recap_idx = content.index("PLAY RECAP")
        recap_block = content[recap_idx:]
        for line in recap_block.split("\n")[1:]:
            m = re.search(r'failed=(\d+)', line)
            if m and int(m.group(1)) > 0:
                return "failed"
        return "passed"
    except Exception:
        log.warning("[run] Failed to parse run result from log", exc_info=True)
        return ""


def _update_job_status_from_pid(job: Dict[str, Any]) -> Dict[str, Any]:
    """
    If lastPid is set:
      - if PID alive => running
      - if PID gone/zombie => completed (only if it was running)
    Also handles multi-group activeRuns.
    """
    # ── Multi-group path ──
    active_runs = job.get("activeRuns")
    if active_runs and isinstance(active_runs, dict):
        any_alive = False
        any_failed = False
        for gid, ginfo in active_runs.items():
            if ginfo.get("status") not in ("running",):
                if ginfo.get("status") == "failed":
                    any_failed = True
                continue
            pid = _safe_int(ginfo.get("pid"))
            if not pid:
                continue
            if _pid_alive(pid):
                any_alive = True
            else:
                # Reap zombie
                with _proc_lock:
                    proc = _running_procs.pop(pid, None)
                if proc:
                    try:
                        proc.wait(timeout=2)
                    except Exception:
                        log.warning("[run] Failed to wait for process %d", pid)
                # Parse this group's log for result
                group_log = ginfo.get("logPath", "")
                group_result = _parse_run_result_from_log(group_log)
                ginfo["status"] = "failed" if group_result == "failed" else "completed"
                ginfo["pid"] = ""
                if ginfo["status"] == "failed":
                    any_failed = True
        if any_alive:
            job["status"] = "running"
        elif job.get("status") == "running":
            job["status"] = "failed" if any_failed else "completed"
            job["lastPid"] = ""
        return job

    # ── Legacy single-run path ──
    pid = _safe_int(job.get("lastPid"))
    if not pid:
        return job

    if _pid_alive(pid):
        job["status"] = "running"
    else:
        # Reap zombie if we have the Popen object
        with _proc_lock:
            proc = _running_procs.pop(pid, None)
        if proc:
            try:
                proc.wait(timeout=2)
            except Exception:
                log.warning("[run] Failed to wait for process %d", pid)
        if job.get("status") == "running":
            result = _parse_last_run_result(job)
            job["status"] = "failed" if result == "failed" else "completed"
            job["lastPid"] = ""
    return job


# ─────────────────────────────────────────────────────────────
# JOB CRUD
# ─────────────────────────────────────────────────────────────

def _count_host_lines(job_id: str, job: Dict[str, Any]) -> int:
    """Count IP lines in the job's target_hosts inventory file."""
    inv_path = job.get("jobInventoryPath") or os.path.join(_job_dir(job_id), "target_hosts")
    if not os.path.isfile(inv_path):
        return 0
    count = 0
    try:
        with open(inv_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and not line.startswith("["):
                    if re.match(r'^\d+\.\d+\.\d+\.\d+', line):
                        count += 1
    except Exception:
        log.warning("[jobs] Failed to count host lines for job", exc_info=True)
    return count


def _count_firmware_files(job_id: str) -> int:
    """Count .exe/.bin firmware files in the job's firmware dir."""
    fw_dir = _firmware_dir(job_id)
    if not os.path.isdir(fw_dir):
        return 0
    count = 0
    for f in os.listdir(fw_dir):
        if os.path.splitext(f)[1].lower() in (".exe", ".bin"):
            count += 1
    return count


def _count_tsr_files(job_id: str) -> int:
    """Count files in the job's TSR/ directory."""
    tsr_dir = os.path.join(_job_dir(job_id), "TSR")
    if not os.path.isdir(tsr_dir):
        return 0
    count = 0
    for root, _dirs, files in os.walk(tsr_dir):
        count += len(files)
    return count


def get_tsr_status(job_id: str, job: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Analyze TSR files per serial: collected, missing, duplicates."""
    if job is None:
        job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    tsr_dir = os.path.join(_job_dir(job_id), "TSR")
    tsr_files = []
    serial_files: Dict[str, List[Dict[str, Any]]] = {}

    # 1. Scan TSR directory and extract serial from each filename
    if os.path.isdir(tsr_dir):
        pattern = re.compile(r"TSR(\d{8}T\d{6})_(\w+)\.zip", re.IGNORECASE)
        for fname in sorted(os.listdir(tsr_dir)):
            fpath = os.path.join(tsr_dir, fname)
            if not os.path.isfile(fpath):
                continue
            m = pattern.match(fname)
            serial = m.group(2) if m else ""
            stat = os.stat(fpath)
            entry = {
                "name": fname,
                "serial": serial,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            }
            tsr_files.append(entry)
            if serial:
                serial_files.setdefault(serial, []).append(fname)

    # 2. Get expected serials from workbook CSV + inventory (servers only)
    _NON_SERVER_PREFIXES = ("PDU-", "RCON", "SWITCH", "CONSOLE")
    expected: Dict[str, Dict[str, str]] = {}  # serial -> {name, ip, mac, part_number, rack_unit}
    try:
        csv_path = _find_csv_for_job(job_id, job)
        if csv_path:
            mac_map = _parse_csv_mac_map(csv_path)
            mac_map.pop("__by_name__", None)
            for _mac, info in mac_map.items():
                name = info.get("name", "").strip()
                # Skip non-server devices
                if any(name.upper().startswith(p) for p in _NON_SERVER_PREFIXES):
                    continue
                s = info.get("serial", "").strip()
                if s:
                    expected[s] = {
                        "name": name,
                        "ip": info.get("ip", ""),
                        "mac": _mac,
                        "part_number": info.get("part_number", ""),
                        "rack_unit": info.get("rack_unit", ""),
                    }

        # Also cross-ref with inventory for IPs (servers only)
        inv = parse_job_inventory(job_id)
        for h in inv.get("hosts", []):
            hname = h.get("name", "").strip()
            if any(hname.upper().startswith(p) for p in _NON_SERVER_PREFIXES):
                continue
            s = h.get("serial", "").strip()
            if s:
                if s not in expected:
                    expected[s] = {
                        "name": hname,
                        "ip": h.get("ip", ""),
                        "mac": h.get("mac", ""),
                        "part_number": h.get("part_number", ""),
                        "rack_unit": h.get("rack_unit", ""),
                    }
                else:
                    if not expected[s].get("ip"):
                        expected[s]["ip"] = h.get("ip", "")
                    if not expected[s].get("mac"):
                        expected[s]["mac"] = h.get("mac", "")
                    if not expected[s].get("part_number"):
                        expected[s]["part_number"] = h.get("part_number", "")
                    if not expected[s].get("rack_unit"):
                        expected[s]["rack_unit"] = h.get("rack_unit", "")
    except Exception:
        log.warning("[tsr] Failed to parse expected hosts", exc_info=True)

    # 3. Build collected / missing / duplicates
    collected_serials = set(serial_files.keys())
    collected = []
    duplicates = []
    for serial, files in sorted(serial_files.items()):
        info = expected.get(serial, {})
        collected.append({
            "serial": serial,
            "ip": info.get("ip", ""),
            "name": info.get("name", ""),
            "mac": info.get("mac", ""),
            "part_number": info.get("part_number", ""),
            "rack_unit": info.get("rack_unit", ""),
            "files": files,
            "latestFile": files[-1] if files else "",
            "fileCount": len(files),
        })
        if len(files) > 1:
            duplicates.append({
                "serial": serial,
                "fileCount": len(files),
                "files": files,
            })

    missing = []
    for serial, info in sorted(expected.items()):
        if serial not in collected_serials:
            missing.append({
                "serial": serial,
                "ip": info.get("ip", ""),
                "name": info.get("name", ""),
                "mac": info.get("mac", ""),
                "part_number": info.get("part_number", ""),
                "rack_unit": info.get("rack_unit", ""),
            })

    total_expected = len(expected) if expected else len(collected_serials)
    summary = {
        "total": total_expected,
        "collected": len(collected_serials),
        "missing": len(missing),
        "duplicateSerials": len(duplicates),
    }

    return {
        "collected": collected,
        "missing": missing,
        "duplicates": duplicates,
        "summary": summary,
        "tsrFiles": tsr_files,
    }


def delete_tsr_file(job_id: str, filename: str, ip: str = "", user: str = "") -> Dict[str, Any]:
    """Delete a specific TSR file from a job's TSR directory."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")
    # Prevent path traversal
    safe_name = os.path.basename(filename)
    tsr_dir = os.path.join(_job_dir(job_id), "TSR")
    fpath = os.path.join(tsr_dir, safe_name)
    if not os.path.isfile(fpath):
        raise ValidationError(f"TSR file not found: {safe_name}")
    try:
        os.remove(fpath)
    except FileNotFoundError:
        pass  # already deleted
    except OSError as e:
        log.error("[file] Failed to remove TSR %s: %s", fpath, e)
        raise ValidationError(f"Cannot delete file: {e}")
    _audit_log("DELETE_TSR", job_id, detail=safe_name, ip=ip)
    log.info("Deleted TSR file %s for job %s", safe_name, job_id)
    return {"status": "ok", "deleted": safe_name}


def _parse_last_run_result(job: Dict[str, Any]) -> str:
    """Parse the last run log for PLAY RECAP to determine passed/failed/''."""
    log_path = job.get("lastLogPath", "")
    if not log_path or not os.path.isfile(log_path):
        return ""
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if "PLAY RECAP" not in content:
            return ""
        recap_idx = content.index("PLAY RECAP")
        recap_block = content[recap_idx:]
        # Check if any host has failed > 0
        for line in recap_block.split("\n")[1:]:
            m = re.search(r'failed=(\d+)', line)
            if m and int(m.group(1)) > 0:
                return "failed"
        return "passed"
    except Exception:
        log.warning("[run] Failed to parse last run result", exc_info=True)
        return ""


def list_jobs() -> List[Dict[str, Any]]:
    """List all jobs from SQLite, enriched with live summary data.

    Cached counts (hostCount, firmwareCount, tsrCount, lastRunResult) are
    stored in the job JSON and only recomputed when the job is running or
    when the field is missing (migration for older jobs).
    """
    raw = db_list_jobs()
    jobs: List[Dict[str, Any]] = []
    for job in raw:
        job_id = job.get("jobId", "")
        if not job_id:
            continue
        try:
            # Refresh PID-based status (detect finished/failed jobs)
            old_status = job.get("status")
            job = _update_job_status_from_pid(job)
            status_changed = job.get("status") != old_status

            is_running = job.get("status") == "running"
            needs_cache = ("hostCount" not in job or "firmwareCount" not in job
                           or "tsrCount" not in job or "lastRunResult" not in job)

            if is_running or needs_cache:
                job["hostCount"] = _count_host_lines(job_id, job)
                job["firmwareCount"] = _count_firmware_files(job_id)
                job["tsrCount"] = _count_tsr_files(job_id)
                job["lastRunResult"] = _parse_last_run_result(job)
                db_save_job(job_id, job)
            elif status_changed:
                # Status changed (e.g. running → completed) — recompute and persist
                job["tsrCount"] = _count_tsr_files(job_id)
                job["lastRunResult"] = _parse_last_run_result(job)
                db_save_job(job_id, job)

            jobs.append(job)
        except Exception:
            log.warning("[jobs] Skipping malformed job %s in list_jobs", job_id[:80], exc_info=True)
            continue
    return jobs


def _get_job_unlocked(job_id: str) -> Optional[Dict[str, Any]]:
    """Read job from SQLite and refresh PID-based status.

    Called from within locked contexts or from get_job().
    """
    job = db_get_job(job_id)
    if not job:
        return None

    # keep status fresh when viewing
    old_status = job.get("status")
    job = _update_job_status_from_pid(job)
    status_changed = job.get("status") != old_status
    is_running = job.get("status") == "running"
    needs_recount = is_running or "tsrCount" not in job or status_changed
    if needs_recount:
        old_tsr = job.get("tsrCount")
        job["tsrCount"] = _count_tsr_files(job_id)
        if status_changed or job["tsrCount"] != old_tsr:
            db_save_job(job_id, job)
    elif status_changed:
        db_save_job(job_id, job)
    return job


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Read job from SQLite (public API for routes)."""
    return _get_job_unlocked(job_id)


def save_job(job_id: str, job: Dict[str, Any]) -> None:
    _ensure_job_dirs(job_id)
    db_save_job(job_id, job)

def create_job(payload: Dict[str, Any], ip: str = "", user: str = "") -> Dict[str, Any]:
    job_name = (payload.get("jobName") or "").strip()
    if not job_name:
        raise ValidationError("jobName is required")

    workflow = str(payload.get("workflow", "configbuild")).lower().strip()
    if workflow and workflow not in VALID_WORKFLOWS:
        raise ValidationError("Invalid workflow")
    if not workflow:
        workflow = "configbuild"

    server_class = str(payload.get("serverClass", "")).strip().upper()
    if workflow == "configbuild" and server_class not in ("J", "I"):
        server_class = "J"  # default

    job_id = f"{_slugify(job_name)}_{_stamp()}"

    customer = str(payload.get("customer", "servicenow")).strip() or "servicenow"

    job = {
        "jobId": job_id,
        "jobName": job_name,
        "customer": customer,
        "workflow": workflow,
        "serverClass": server_class if workflow == "configbuild" else "",
        "status": "saved",
        "createdAt": _now(),
        "inventory": payload.get("inventory", DEFAULT_INVENTORY_NAME),
        "hostLimit": payload.get("hostLimit", ""),
        "rackId": str(payload.get("rackId", "")).strip(),
        "sku": str(payload.get("sku", "")).strip(),
        "po": str(payload.get("po", "")).strip(),
        "jobInventoryPath": "",
        "files": [],
        "lastRunId": "",
        "lastLogPath": "",
        "lastPid": "",
        "notes": str(payload.get("notes", "")).strip(),
        "lastRunTags": [],
    }

    save_job(job_id, job)
    _generate_vars_yml(job_id)
    _audit_log("CREATE_JOB", job_id, ip=ip)
    log.info("[job] Created job '%s' (id=%s, workflow=%s)", job_name, job_id, workflow)
    return job


def update_job(job_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    """Update allowed fields on an existing job."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    ALLOWED_FIELDS = {"workflow", "serverClass", "hostLimit", "inventory",
                      "jobName", "rackId", "sku", "po", "notes", "customer"}
    for key, val in updates.items():
        if key in ALLOWED_FIELDS:
            if key == "jobName":
                val = str(val).strip()
                if not val:
                    raise ValidationError("jobName cannot be empty")
            if key == "workflow":
                val = str(val).lower().strip()
                if val not in VALID_WORKFLOWS:
                    raise ValidationError(f"Invalid workflow: {val}")
            job[key] = val

    save_job(job_id, job)
    return job


def clone_job(job_id: str, overrides: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Clone a job: copy metadata + uploaded files to a new job."""
    source = get_job(job_id)
    if not source:
        raise JobNotFoundError("Job not found")

    ov = overrides or {}
    payload = {
        "jobName": ov.get("jobName") or (source.get("jobName", "") + " (copy)").strip(),
        "customer": source.get("customer", "servicenow"),
        "workflow": source.get("workflow", "configbuild"),
        "serverClass": source.get("serverClass", ""),
        "sku": ov.get("sku") if "sku" in ov else source.get("sku", ""),
        "po": ov.get("po") if "po" in ov else source.get("po", ""),
        "notes": source.get("notes", ""),
        "rackId": ov.get("rackId") if "rackId" in ov else source.get("rackId", ""),
    }
    new_job = create_job(payload)
    new_id = new_job["jobId"]

    # Copy uploaded files from source to new job
    source_files = source.get("files", []) or []
    new_files = []
    for f in source_files:
        src_path = f.get("path", "")
        if not src_path or not os.path.isfile(src_path):
            continue

        role = f.get("role", "file")
        fname = f.get("filename", os.path.basename(src_path))

        # Determine destination based on role
        if role in ("firmware", "bios_xml"):
            dest_dir = _firmware_dir(new_id)
        elif role == "workbook":
            dest_dir = _job_dir(new_id)
        else:
            dest_dir = os.path.join(_job_dir(new_id), "uploads", role)
        os.makedirs(dest_dir, exist_ok=True)

        dest_path = os.path.join(dest_dir, fname)
        shutil.copy2(src_path, dest_path)

        new_files.append({
            "role": role,
            "filename": fname,
            "path": dest_path,
            "uploadedAt": _now(),
            "size": os.path.getsize(dest_path),
        })

    if new_files:
        new_job["files"] = new_files
        save_job(new_id, new_job)

        # Regenerate catalog if firmware was copied
        if any(f["role"] == "firmware" for f in new_files):
            try:
                _generate_catalog(new_id)
            except Exception:
                log.warning("[catalog] Failed to regenerate catalog for cloned job %s", new_id)

        # Regenerate vars.yml with new file references
        _generate_vars_yml(new_id)

    return new_job


def delete_job(job_id: str, ip: str = "", user: str = "") -> Dict[str, Any]:
    """Delete a job and all its files permanently."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    # Don't allow deleting a running job
    if job.get("status") == "running":
        pid = _safe_int(job.get("lastPid"))
        if pid and _pid_alive(pid):
            raise ValidationError("Cannot delete a running job. Stop it first.")

    db_delete_job(job_id)
    _audit_log("DELETE_JOB", job_id, ip=ip)
    jdir = _job_dir(job_id)
    if os.path.isdir(jdir):
        shutil.rmtree(jdir)

    log.info("[job] Deleted job %s", job_id)
    return {"status": "deleted", "jobId": job_id}


# ─────────────────────────────────────────────────────────────
# FILE UPLOADS
# ─────────────────────────────────────────────────────────────

def save_uploaded_file(job_id: str, file_storage, file_role: Optional[str] = None) -> str:
    """Save an uploaded file (werkzeug FileStorage) — streams to disk, no full-RAM buffer."""
    filename = file_storage.filename or ""
    if not filename or not _allowed_ext(filename):
        raise ValidationError(f"File type not allowed: {os.path.splitext(filename)[1].lower()}")

    role = _slugify((file_role or "supporting").strip().lower())

    # Firmware and BIOS XML files go to jobs/{job_id}/firmware/ (served via NFS)
    if role in ("firmware", "bios_xml"):
        fw_dir = _firmware_dir(job_id)
        os.makedirs(fw_dir, exist_ok=True)
        dest = os.path.join(fw_dir, os.path.basename(filename))
    elif role == "workbook":
        # Workbook CSV saved to job root dir (local_path in vars.yml)
        dest = os.path.join(_job_dir(job_id), os.path.basename(filename))
    else:
        upload_dir = os.path.join(_job_dir(job_id), "uploads", role)
        os.makedirs(upload_dir, exist_ok=True)
        dest = os.path.join(upload_dir, os.path.basename(filename))

    # Stream to disk in chunks — never holds the full file in RAM
    file_storage.save(dest)

    entry = {
        "role": role,
        "filename": os.path.basename(filename),
        "path": dest,
        "uploadedAt": _now(),
        "size": os.path.getsize(dest),
    }

    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    files = job.get("files", []) or []
    # For single-file roles (workbook, bios_xml), replace any existing file with that role
    # For multi-file roles (firmware), only replace same role+filename
    if role in ("workbook", "bios_xml"):
        # Remove old file(s) with same role, and delete old file from disk
        for old in files:
            if old.get("role") == role and old.get("filename") != entry["filename"]:
                old_path = old.get("path", "")
                if old_path and os.path.isfile(old_path):
                    try:
                        os.remove(old_path)
                    except FileNotFoundError:
                        pass
                    except OSError as e:
                        log.error("[file] Failed to remove old %s file %s: %s", role, old_path, e)
        files = [x for x in files if x.get("role") != role]
    else:
        files = [x for x in files if not (x.get("role") == role and x.get("filename") == entry["filename"])]
    files.append(entry)

    job["files"] = files
    # Count firmware from in-memory list instead of rescanning disk
    job["firmwareCount"] = sum(1 for f in files if f.get("role") == "firmware")
    save_job(job_id, job)

    # Auto-generate Catalog.xml after firmware upload
    if role == "firmware":
        _generate_catalog(job_id)

    # Regenerate vars.yml so file references stay current
    _generate_vars_yml(job_id)

    log.info("[file] Uploaded %s (role=%s) to job %s", filename, role, job_id)
    return dest


def delete_uploaded_file(job_id: str, role: str, filename: str, ip: str = "", user: str = "") -> Dict[str, Any]:
    """Delete an uploaded file from a job."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    files = job.get("files", []) or []
    target = None
    for f in files:
        if f.get("role") == role and f.get("filename") == filename:
            target = f
            break

    if not target:
        raise ValidationError(f"File not found: {role}/{filename}")

    # Remove from disk
    fpath = target.get("path", "")
    if fpath and os.path.isfile(fpath):
        try:
            os.remove(fpath)
        except FileNotFoundError:
            pass
        except OSError as e:
            log.error("[file] Failed to remove %s: %s", fpath, e)
            raise ValidationError(f"Cannot delete file: {e}")

    _audit_log("DELETE_FILE", job_id, detail=f"{role}/{filename}", ip=ip)

    # Remove from job metadata
    files = [x for x in files if not (x.get("role") == role and x.get("filename") == filename)]
    job["files"] = files
    save_job(job_id, job)

    # Re-generate catalog if firmware was removed
    if role == "firmware":
        try:
            _generate_catalog(job_id)
        except Exception:
            log.warning("[catalog] Failed to regenerate catalog after file delete for job %s", job_id)

    # Regenerate vars.yml so file references stay current
    _generate_vars_yml(job_id)

    log.info("[file] Deleted %s (role=%s) from job %s", filename, role, job_id)
    return {"status": "ok", "deleted": filename, "role": role}


def get_file_path(job_id: str, role: str, filename: str) -> str:
    """Return the on-disk path for a job file, for download."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    for f in (job.get("files", []) or []):
        if f.get("role") == role and f.get("filename") == filename:
            fpath = f.get("path", "")
            if fpath and os.path.isfile(fpath):
                return fpath
            raise ValidationError(f"File not on disk: {fpath}")

    raise ValidationError(f"File not found: {role}/{filename}")


# ─────────────────────────────────────────────────────────────
# INVENTORY GENERATION (sudo python3 + show output)
# ─────────────────────────────────────────────────────────────

def _find_csv_for_job(job_id: str, job: Dict[str, Any]) -> Optional[str]:
    # Prefer uploaded CSVs in metadata
    for f in job.get("files", []) or []:
        p = f.get("path")
        if p and str(p).lower().endswith(".csv") and os.path.isfile(p):
            return p

    # fallback search
    patterns = [
        os.path.join(_job_dir(job_id), "*.csv"),
        os.path.join(_job_dir(job_id), "uploads", "**", "*.csv"),
    ]
    for pat in patterns:
        matches = glob.glob(pat, recursive=True)
        if matches:
            return matches[0]
    return None


_inventory_gen_lock = FileLock(os.path.join(JOBS_ROOT, ".inventory_gen.lock"), timeout=300)


def generate_inventory_for_job(job_id: str) -> Dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    if not os.path.isfile(CENTRAL_GENERATE_INVENTORY):
        raise InventoryError(f"generate_inventory.py not found: {CENTRAL_GENERATE_INVENTORY}")

    csv_path = _find_csv_for_job(job_id, job)
    if not csv_path:
        raise InventoryError("No CSV found. Upload workbook first.")

    job_path = _job_dir(job_id)
    out_inventory = os.path.join(job_path, "target_hosts")

    # ── Isolated config: create a temp config.py with this job's CSV path ──
    # The generate_inventory.py script does `import config` and reads
    # config.MAC_FILE_PATH.  We inject our temp dir ahead of PLAYBOOK_ROOT
    # in sys.path so each job uses its own CSV without overwriting others.
    import tempfile
    config_py = os.path.join(PLAYBOOK_ROOT, "config.py")
    csv_copied_to = ""

    with tempfile.TemporaryDirectory(prefix=f"inv_{job_id}_") as tmpdir:
        # Copy original config.py and patch MAC_FILE_PATH
        if os.path.isfile(config_py):
            with open(config_py, "r", encoding="utf-8", errors="replace") as f:
                orig_config = f.read()
            patched = re.sub(
                r'(MAC_FILE_PATH\s*=\s*)(["\']).*?\2',
                f'\\1"{csv_path}"',
                orig_config,
            )
            with open(os.path.join(tmpdir, "config.py"), "w", encoding="utf-8") as f:
                f.write(patched)
            csv_copied_to = f"{tmpdir}/config.py (isolated)"
        else:
            # No config.py found — write a minimal one
            with open(os.path.join(tmpdir, "config.py"), "w", encoding="utf-8") as f:
                f.write(f'MAC_FILE_PATH = "{csv_path}"\n')
            csv_copied_to = csv_path

        # Run generate_inventory.py with the temp config at front of sys.path.
        # CWD stays PLAYBOOK_ROOT so other imports / relative paths still work.
        cmd = [
            "python3", "-c",
            f"import sys; sys.path.insert(0, r'{tmpdir}'); "
            f"exec(compile(open(r'{CENTRAL_GENERATE_INVENTORY}').read(), "
            f"r'{CENTRAL_GENERATE_INVENTORY}', 'exec'))"
        ]

        # Serialize output-file copy: the script writes to FALLBACK_GENERATED_HOSTS
        with _inventory_gen_lock:
            proc = subprocess.run(cmd, capture_output=True, text=True, cwd=PLAYBOOK_ROOT, timeout=120)

            # Copy from shared output path into job dir immediately (under lock)
            used_source = ""
            if _file_ok(FALLBACK_GENERATED_HOSTS):
                shutil.copy2(FALLBACK_GENERATED_HOSTS, out_inventory)
                used_source = FALLBACK_GENERATED_HOSTS
            elif _file_ok(out_inventory):
                used_source = out_inventory

    stdout_tail = _tail(proc.stdout or "", 12000)
    stderr_tail = _tail(proc.stderr or "", 12000)

    gen_log = os.path.join(job_path, "generate_inventory.log")
    with open(gen_log, "w", encoding="utf-8") as f:
        f.write("CMD: python3 generate_inventory.py (isolated config)\n")
        f.write(f"CWD: {PLAYBOOK_ROOT}\n")
        f.write(f"Config isolation: {csv_copied_to}\n")
        f.write("\nSTDOUT:\n" + (proc.stdout or "") + "\n\n")
        f.write("STDERR:\n" + (proc.stderr or "") + "\n")

    if not _file_ok(out_inventory):
        combined = (proc.stdout or "") + (proc.stderr or "")
        raise InventoryError(
            "Inventory generated but no hosts found. Check if arp-scan has sudo access.\n\n"
            + _tail(combined, 4000)
        )

    job = get_job(job_id)
    if job:
        job["jobInventoryPath"] = out_inventory
        # Cache host count in job metadata
        job["hostCount"] = _count_host_lines(job_id, job)
        save_job(job_id, job)

    return {
        "status": "ok",
        "jobId": job_id,
        "csvUsed": csv_path,
        "csvCopiedTo": csv_copied_to,
        "inventoryPath": out_inventory,
        "sourceUsed": used_source,
        "logPath": gen_log,
        "stdout": stdout_tail,
        "stderr": stderr_tail,
    }


# ─────────────────────────────────────────────────────────────
# RUN JOB
# ─────────────────────────────────────────────────────────────

def run_job(job_id: str, tags: List[str], workflow_override: Optional[str] = None, ip: str = "", user: str = "") -> Dict[str, Any]:
    with _run_gate_lock:
        job = get_job(job_id)
        if not job:
            raise JobNotFoundError("Job not found")

        # ── Concurrent run handling ──
        existing_active_runs = {}
        if job.get("status") == "running":
            pid = _safe_int(job.get("lastPid"))
            ar = job.get("activeRuns")
            has_live = False
            if ar and isinstance(ar, dict):
                has_live = any(
                    _pid_alive(_safe_int(g.get("pid")) or 0)
                    for g in ar.values()
                    if g.get("status") == "running"
                )
                if has_live:
                    existing_active_runs = dict(ar)
            elif pid and _pid_alive(pid):
                has_live = True
                # Migrate legacy single-run into activeRuns format
                existing_active_runs = {"run1": {
                    "pid": str(pid),
                    "logPath": job.get("lastLogPath", ""),
                    "tags": job.get("lastRunTags", []),
                    "hosts": job.get("hostLimit", ""),
                    "label": "Run 1",
                    "status": "running",
                    "workflow": job.get("workflow", ""),
                }}
            if not has_live:
                # PID(s) dead — auto-fix stale status
                job["status"] = "completed"
                job["lastPid"] = ""
                job["activeRuns"] = {}
                save_job(job_id, job)
                log.info("[run] Auto-fixed stale running status for job %s", job_id)

        # ── Concurrent run limit ──
        active = _count_active_run_groups()
        if active + 1 > MAX_CONCURRENT_RUNS:
            raise ExecutionError(
                f"Run queue full ({active}/{MAX_CONCURRENT_RUNS} active). "
                "Wait for a running job to finish or stop one first."
            )

        # workflow_override lets callers (e.g. TSR re-run) use a different
        # playbook without permanently changing the job's workflow setting
        workflow = workflow_override.lower().strip() if workflow_override else str(job.get("workflow", "configbuild")).lower().strip()
        server_class = str(job.get("serverClass", "")).strip().upper()

        # Resolve playbook: configbuild uses separate J/I class playbooks
        if workflow == "configbuild":
            if server_class not in ("J", "I"):
                server_class = "J"
            playbook_key = f"configbuild_{server_class.lower()}"
        else:
            playbook_key = workflow

        playbook_name = WORKFLOW_PLAYBOOKS.get(playbook_key)
        if not playbook_name:
            raise ExecutionError(f"No playbook mapped for workflow: {workflow} (key: {playbook_key})")

        playbook_path = os.path.join(PLAYBOOK_ROOT, playbook_name)
        if not os.path.isfile(playbook_path):
            raise ExecutionError(f"Playbook not found: {playbook_path}")

        inv_path = job.get("jobInventoryPath") or os.path.join(PLAYBOOK_ROOT, job.get("inventory", DEFAULT_INVENTORY_NAME))
        if not os.path.isfile(inv_path):
            raise ExecutionError(f"Inventory not found: {inv_path} (Generate from CSV first)")

        run_id = _stamp()
        run_dir = os.path.join(_job_dir(job_id), "runs", run_id)
        os.makedirs(run_dir, exist_ok=True)

        log_path = os.path.join(run_dir, "run.log")

        # Save run metadata for history (tags, workflow, timestamp)
        run_meta = {
            "tags": [],  # will be populated below after tag processing
            "workflow": workflow,
            "serverClass": server_class if workflow == "configbuild" else "",
            "startedAt": _now(),
        }

        cmd = ["ansible-playbook", "-i", inv_path, playbook_path]

        # Handle tags as string or list
        if isinstance(tags, str):
            tags = [s.strip() for s in tags.split(",") if s.strip()]
        clean_tags: List[str] = []
        for t in (tags or []):
            if isinstance(t, str) and t.strip():
                clean_tags.append(t.strip())

        # Validate tags against known task definitions
        VALID_TAGS = {
            "powerup", "lldp", "rackslot", "assettag", "update", "reboot", "xml", "idrac",
            "diagnostics", "disablelld", "tsr", "cleanup", "shutdown", "postlogs",
            "firmware", "dhcp",
        }
        if clean_tags:
            invalid = [t for t in clean_tags if t not in VALID_TAGS]
            if invalid:
                raise ValidationError(f"Unknown task tags: {', '.join(invalid)}. Valid: {', '.join(sorted(VALID_TAGS))}")

        if clean_tags:
            cmd += ["--tags", ",".join(clean_tags)]

        # Finalize and write run metadata
        run_meta["tags"] = clean_tags
        _write_json(os.path.join(run_dir, "run_meta.json"), run_meta)

        host_limit = (job.get("hostLimit") or "").strip()
        if host_limit:
            cmd += ["--limit", host_limit]

        # Regenerate and pass vars.yml with job-specific paths
        vars_path = _generate_vars_yml(job_id, _job=job)
        cmd += ["-e", f"@{vars_path}"]

        with open(log_path, "w", encoding="utf-8") as lf:
            lf.write("CMD: " + " ".join(cmd) + "\n\n")
            lf.write(f"Started: {_now()}\n\n")
            lf.flush()
            proc = subprocess.Popen(cmd, cwd=PLAYBOOK_ROOT, stdout=lf, stderr=subprocess.STDOUT)

        with _proc_lock:
            _running_procs[proc.pid] = proc

        # Build group entry for this new run
        new_gid = "run%d" % (len(existing_active_runs) + 1)
        # Avoid collision with existing group IDs
        while new_gid in existing_active_runs:
            new_gid = "run_%s" % run_id
        new_group_entry = {
            "pid": str(proc.pid),
            "logPath": log_path,
            "tags": clean_tags,
            "hosts": host_limit,
            "label": ", ".join(clean_tags) if clean_tags else "Full Workflow",
            "status": "running",
            "workflow": workflow,
        }

        # Merge into activeRuns
        merged_runs = dict(existing_active_runs)
        merged_runs[new_gid] = new_group_entry

        job["status"] = "running"
        job["lastRunId"] = run_id
        job["lastLogPath"] = log_path
        job["lastPid"] = str(proc.pid)
        job["lastRunTags"] = clean_tags
        job["activeRuns"] = merged_runs
        save_job(job_id, job)

    _audit_log("RUN_JOB", job_id, detail=f"tags={clean_tags}", ip=ip)
    log.info("[run] Started job %s (run=%s, pid=%d, tags=%s)", job_id, run_id, proc.pid, clean_tags or "full")

    return {
        "status": "started",
        "jobId": job_id,
        "runId": run_id,
        "pid": proc.pid,
        "logPath": log_path,
        "inventoryUsed": inv_path,
        "playbook": playbook_path,
        "tags": clean_tags,
        "hostLimit": host_limit,
    }


# ─────────────────────────────────────────────────────────────
# RUN JOB GROUPS (parallel multi-group execution)
# ─────────────────────────────────────────────────────────────

VALID_TAGS_SET = {
    "powerup", "lldp", "rackslot", "assettag", "update", "reboot", "xml", "idrac",
    "diagnostics", "disablelld", "tsr", "cleanup", "shutdown", "postlogs",
    "firmware", "dhcp",
}


def run_job_groups(job_id: str, groups: List[Dict[str, Any]], ip: str = "", user: str = "") -> Dict[str, Any]:
    """Run multiple host/task groups in parallel as separate ansible-playbook processes."""
    if not groups or len(groups) < 2:
        raise ValidationError("run_job_groups requires at least 2 groups")

    with _run_gate_lock:
        job = get_job(job_id)
        if not job:
            raise JobNotFoundError("Job not found")

        # Concurrent run handling — collect existing live runs to merge
        existing_active_runs: Dict[str, Any] = {}
        if job.get("status") == "running":
            pid = _safe_int(job.get("lastPid"))
            ar = job.get("activeRuns")
            has_live = False
            if ar and isinstance(ar, dict):
                has_live = any(
                    _pid_alive(_safe_int(g.get("pid")) or 0)
                    for g in ar.values()
                    if g.get("status") == "running"
                )
                if has_live:
                    existing_active_runs = dict(ar)
            elif pid and _pid_alive(pid):
                has_live = True
                existing_active_runs = {"run1": {
                    "pid": str(pid),
                    "logPath": job.get("lastLogPath", ""),
                    "tags": job.get("lastRunTags", []),
                    "hosts": job.get("hostLimit", ""),
                    "label": "Run 1",
                    "status": "running",
                    "workflow": job.get("workflow", ""),
                }}
            if not has_live:
                job["status"] = "completed"
                job["lastPid"] = ""
                job["activeRuns"] = {}
                save_job(job_id, job)

        # Concurrent run limit (count individual group PIDs)
        active_count = _count_active_run_groups()
        if active_count + len(groups) > MAX_CONCURRENT_RUNS:
            raise ExecutionError(
                f"Run queue full ({active_count} active + {len(groups)} requested > {MAX_CONCURRENT_RUNS} limit). "
                "Wait for running jobs to finish or stop some first."
            )

        # Shared setup
        workflow_default = str(job.get("workflow", "configbuild")).lower().strip()
        server_class_default = str(job.get("serverClass", "")).strip().upper()
        inv_path = job.get("jobInventoryPath") or os.path.join(
            PLAYBOOK_ROOT, job.get("inventory", DEFAULT_INVENTORY_NAME)
        )
        if not os.path.isfile(inv_path):
            raise ExecutionError(f"Inventory not found: {inv_path} (Generate from CSV first)")

        vars_path = _generate_vars_yml(job_id, _job=job)

        run_id = _stamp()
        run_dir = os.path.join(_job_dir(job_id), "runs", run_id)
        os.makedirs(run_dir, exist_ok=True)

        active_runs_dict: Dict[str, Any] = dict(existing_active_runs)
        first_group = not existing_active_runs

        for g in groups:
            gid = str(g.get("groupId", "")).strip()
            if not gid:
                raise ValidationError("Each group must have a groupId")
            # Avoid collision with existing group IDs
            if gid in active_runs_dict:
                gid = "%s_%s" % (gid, run_id)
            label = str(g.get("label", gid)).strip()

            # Resolve workflow: group can override or use job default
            wf = str(g.get("workflow", "")).lower().strip() or workflow_default
            sc = str(g.get("serverClass", "")).strip().upper() or server_class_default

            if wf == "configbuild":
                if sc not in ("J", "I"):
                    sc = "J"
                playbook_key = f"configbuild_{sc.lower()}"
            else:
                playbook_key = wf

            playbook_name = WORKFLOW_PLAYBOOKS.get(playbook_key)
            if not playbook_name:
                raise ExecutionError(f"No playbook for group '{label}' workflow: {wf} (key: {playbook_key})")

            playbook_path = os.path.join(PLAYBOOK_ROOT, playbook_name)
            if not os.path.isfile(playbook_path):
                raise ExecutionError(f"Playbook not found for group '{label}': {playbook_path}")

            # Parse and validate tags
            raw_tags = g.get("tags", [])
            if isinstance(raw_tags, str):
                raw_tags = [s.strip() for s in raw_tags.split(",") if s.strip()]
            clean_tags = [t.strip() for t in raw_tags if isinstance(t, str) and t.strip()]
            if clean_tags:
                invalid = [t for t in clean_tags if t not in VALID_TAGS_SET]
                if invalid:
                    raise ValidationError(
                        f"Group '{label}': unknown tags: {', '.join(invalid)}. "
                        f"Valid: {', '.join(sorted(VALID_TAGS_SET))}"
                    )

            # Hosts limit for this group
            hosts_str = str(g.get("hosts", "")).strip()

            # Create group run directory
            group_dir = os.path.join(run_dir, gid)
            os.makedirs(group_dir, exist_ok=True)
            group_log = os.path.join(group_dir, "run.log")

            # Write group run metadata
            group_meta = {
                "groupId": gid,
                "label": label,
                "tags": clean_tags,
                "hosts": hosts_str,
                "workflow": wf,
                "serverClass": sc if wf == "configbuild" else "",
                "startedAt": _now(),
            }
            _write_json(os.path.join(group_dir, "run_meta.json"), group_meta)

            # Build command
            cmd = ["ansible-playbook", "-i", inv_path, playbook_path]
            if clean_tags:
                cmd += ["--tags", ",".join(clean_tags)]
            if hosts_str:
                cmd += ["--limit", hosts_str]
            cmd += ["-e", f"@{vars_path}"]

            # Launch process
            with open(group_log, "w", encoding="utf-8") as lf:
                lf.write(f"=== Run Group: {label} ===\n")
                lf.write("CMD: " + " ".join(cmd) + "\n\n")
                lf.write(f"Started: {_now()}\n\n")
                lf.flush()
                proc = subprocess.Popen(cmd, cwd=PLAYBOOK_ROOT, stdout=lf, stderr=subprocess.STDOUT)

            with _proc_lock:
                _running_procs[proc.pid] = proc

            active_runs_dict[gid] = {
                "pid": str(proc.pid),
                "logPath": group_log,
                "tags": clean_tags,
                "hosts": hosts_str,
                "label": label,
                "status": "running",
                "workflow": wf,
            }

            # Backward compat: set legacy fields from first group
            if first_group:
                job["lastPid"] = str(proc.pid)
                job["lastLogPath"] = group_log
                job["lastRunTags"] = clean_tags
                first_group = False

            log.info("[run-group] Started group '%s' (pid=%d, tags=%s, hosts=%s)",
                     label, proc.pid, clean_tags or "full", hosts_str or "all")

        # Write overall run metadata
        run_meta = {
            "groups": [
                {"groupId": g.get("groupId"), "label": g.get("label", g.get("groupId"))}
                for g in groups
            ],
            "workflow": workflow_default,
            "startedAt": _now(),
        }
        _write_json(os.path.join(run_dir, "run_meta.json"), run_meta)

        job["status"] = "running"
        job["lastRunId"] = run_id
        job["activeRuns"] = active_runs_dict
        save_job(job_id, job)

    _audit_log("RUN_JOB_GROUPS", job_id,
               detail=f"groups={len(groups)} ids={[g.get('groupId') for g in groups]}", ip=ip)
    log.info("[run-groups] Started %d groups for job %s (run=%s)", len(groups), job_id, run_id)

    return {
        "status": "started",
        "jobId": job_id,
        "runId": run_id,
        "groupCount": len(groups),
        "groups": {
            gid: {"pid": int(info["pid"]), "label": info["label"], "tags": info["tags"], "hosts": info["hosts"]}
            for gid, info in active_runs_dict.items()
        },
    }


# ─────────────────────────────────────────────────────────────
# STOP JOB (Kill lastPid)
# ─────────────────────────────────────────────────────────────

def _kill_pid(pid: int) -> None:
    """Send SIGTERM then SIGKILL to a PID."""
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception as e:
        raise ExecutionError(f"Unable to send SIGTERM to pid {pid}: {e}")
    for _ in range(30):
        if not _pid_alive(pid):
            return
        time.sleep(0.1)
    if _pid_alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except Exception as e:
            raise ExecutionError(f"SIGTERM sent but SIGKILL failed for pid {pid}: {e}")


def stop_job(job_id: str, group_id: Optional[str] = None, ip: str = "", user: str = "") -> Dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    active_runs = job.get("activeRuns")

    # ── Multi-group path ──
    if active_runs and isinstance(active_runs, dict):
        stopped_pids = []

        if group_id:
            # Stop a single group
            ginfo = active_runs.get(group_id)
            if not ginfo:
                return {"status": "noop", "jobId": job_id, "note": f"Group '{group_id}' not found."}
            pid = _safe_int(ginfo.get("pid"))
            if pid and _pid_alive(pid):
                _kill_pid(pid)
                stopped_pids.append(pid)
            ginfo["status"] = "stopped"
            ginfo["pid"] = ""
        else:
            # Stop ALL groups
            for gid, ginfo in active_runs.items():
                pid = _safe_int(ginfo.get("pid"))
                if pid and _pid_alive(pid):
                    _kill_pid(pid)
                    stopped_pids.append(pid)
                ginfo["status"] = "stopped"
                ginfo["pid"] = ""

        # Check if any groups still running
        any_running = any(
            g.get("status") == "running" for g in active_runs.values()
        )
        if not any_running:
            job["status"] = "stopped"
            job["lastPid"] = ""

        save_job(job_id, job)
        detail = f"group={group_id}" if group_id else f"all_groups ({len(active_runs)})"
        _audit_log("STOP_JOB", job_id, detail=detail, ip=ip)
        log.info("[run] Stopped job %s groups (%s, pids=%s)", job_id, detail, stopped_pids)
        return {"status": "ok", "jobId": job_id, "stopped": stopped_pids, "note": "Stopped."}

    # ── Legacy single-run path ──
    pid = _safe_int(job.get("lastPid"))
    if not pid:
        return {"status": "noop", "jobId": job_id, "note": "No PID recorded for this job."}

    if not _pid_alive(pid):
        job["status"] = "stopped"
        job["lastPid"] = ""
        save_job(job_id, job)
        return {"status": "ok", "jobId": job_id, "pid": pid, "note": "Process not running (already stopped)."}

    _kill_pid(pid)

    job["status"] = "stopped"
    job["lastPid"] = ""
    save_job(job_id, job)

    _audit_log("STOP_JOB", job_id, ip=ip)
    log.info("[run] Stopped job %s (pid=%d)", job_id, pid)
    return {"status": "ok", "jobId": job_id, "pid": pid, "note": "Stopped."}


# ─────────────────────────────────────────────────────────────
# DOWNLOAD TSR (zip the TSR folder)
# ─────────────────────────────────────────────────────────────

def download_tsr_zip(job_id: str) -> str:
    """Create a zip of the TSR folder and return its path."""
    import zipfile
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    tsr_dir = os.path.join(_job_dir(job_id), "TSR")
    if not os.path.isdir(tsr_dir):
        raise ValidationError("TSR folder not found")

    tsr_files = []
    for root, dirs, files in os.walk(tsr_dir):
        for f in files:
            tsr_files.append(os.path.join(root, f))

    if not tsr_files:
        raise ValidationError("TSR folder is empty — no TSR exports yet")

    zip_path = os.path.join(_job_dir(job_id), f"TSR_{job_id}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fpath in tsr_files:
            arcname = os.path.relpath(fpath, _job_dir(job_id))
            zf.write(fpath, arcname)

    return zip_path


def download_tsr_selected(job_id: str, filenames: List[str]) -> str:
    """Create a zip of selected TSR files and return its path."""
    import zipfile
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    tsr_dir = os.path.join(_job_dir(job_id), "TSR")
    if not os.path.isdir(tsr_dir):
        raise ValidationError("TSR folder not found")

    matched = []
    for fname in filenames:
        safe = os.path.basename(fname)
        fpath = os.path.join(tsr_dir, safe)
        if os.path.isfile(fpath):
            matched.append(fpath)

    if not matched:
        raise ValidationError("No matching TSR files found")

    zip_path = os.path.join(_job_dir(job_id), f"TSR_{job_id}_selected.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fpath in matched:
            zf.write(fpath, os.path.join("TSR", os.path.basename(fpath)))

    return zip_path


# ─────────────────────────────────────────────────────────────
# LOG VIEW
# ─────────────────────────────────────────────────────────────

def get_job_log(job_id: str, offset: int = 0, group_id: Optional[str] = None) -> Dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    active_runs = job.get("activeRuns")

    # ── Multi-group: return group metadata overview ──
    if active_runs and isinstance(active_runs, dict) and not group_id:
        groups_meta = {}
        for gid, ginfo in active_runs.items():
            glog = ginfo.get("logPath", "")
            gsize = 0
            if glog and os.path.isfile(glog):
                try:
                    gsize = os.path.getsize(glog)
                except Exception:
                    log.warning("[log] Failed to get log size", exc_info=True)
            groups_meta[gid] = {
                "label": ginfo.get("label", gid),
                "status": ginfo.get("status", "unknown"),
                "logSize": gsize,
                "tags": ginfo.get("tags", []),
                "hosts": ginfo.get("hosts", ""),
            }
        return {
            "multiGroup": True,
            "groups": groups_meta,
            "status": job.get("status", "saved"),
        }

    # ── Multi-group: single group log ──
    if active_runs and isinstance(active_runs, dict) and group_id:
        ginfo = active_runs.get(group_id)
        if not ginfo:
            return {"note": f"Group '{group_id}' not found", "text": "", "status": job.get("status", "saved"), "offset": 0, "size": 0}
        log_path = ginfo.get("logPath", "")
        group_status = ginfo.get("status", "unknown")
    else:
        # ── Legacy single-log path ──
        log_path = job.get("lastLogPath") or ""
        group_status = None

    if not log_path:
        msg = "No run started yet."
        return {"note": msg, "text": msg, "status": job.get("status", "saved"), "offset": 0, "size": 0}

    if not os.path.isfile(log_path):
        msg = f"Log not found yet: {log_path}"
        return {"note": msg, "text": msg, "status": job.get("status", "saved"), "offset": 0, "size": 0}

    try:
        size = os.path.getsize(log_path)
        with open(log_path, "rb") as f:
            if offset > 0 and offset <= size:
                f.seek(offset)
                content = f.read().decode("utf-8", errors="replace")
            elif size > 200_000:
                f.seek(-200_000, os.SEEK_END)
                offset = max(0, size - 200_000)
                content = f.read().decode("utf-8", errors="replace")
            else:
                offset = 0
                content = f.read().decode("utf-8", errors="replace")
        new_offset = offset + len(content.encode("utf-8"))
    except Exception as e:
        msg = f"Unable to read log: {e}"
        return {"note": msg, "text": msg, "status": job.get("status", "saved"), "offset": 0, "size": 0}

    result = {"log": content, "text": content, "status": job.get("status", "saved"), "offset": new_offset, "size": size}
    if group_status is not None:
        result["groupStatus"] = group_status
    return result


# ─────────────────────────────────────────────────────────────
# FIRMWARE INFO
# ─────────────────────────────────────────────────────────────

def get_job_firmware(job_id: str) -> Dict[str, Any]:
    """Return list of firmware files and catalog status for a job."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    fw_dir = _firmware_dir(job_id)
    fw_files = []
    if os.path.isdir(fw_dir):
        for f in sorted(os.listdir(fw_dir)):
            fpath = os.path.join(fw_dir, f)
            if os.path.isfile(fpath) and f != "Catalog.xml":
                fw_files.append({
                    "filename": f,
                    "size": os.path.getsize(fpath),
                })

    catalog_path = os.path.join(fw_dir, "Catalog.xml")
    catalog_exists = os.path.isfile(catalog_path)

    return {
        "jobId": job_id,
        "firmwareDir": fw_dir,
        "files": fw_files,
        "catalogExists": catalog_exists,
        "catalogPath": catalog_path if catalog_exists else "",
    }


def generate_catalog_for_job(job_id: str) -> Dict[str, Any]:
    """Generate Catalog.xml from firmware files in the job's firmware directory."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    fw_dir = _firmware_dir(job_id)
    fw_files = [
        f for f in (os.listdir(fw_dir) if os.path.isdir(fw_dir) else [])
        if os.path.isfile(os.path.join(fw_dir, f))
        and os.path.splitext(f)[1].lower() in (".exe", ".bin")
    ]

    if not fw_files:
        raise ValidationError("No firmware files (.exe/.bin) found. Upload firmware first.")

    catalog_path = _generate_catalog(job_id)

    return {
        "status": "ok",
        "jobId": job_id,
        "catalogPath": catalog_path,
        "firmwareCount": len(fw_files),
    }


# ─────────────────────────────────────────────────────────────
# INVENTORY VIEWER
# ─────────────────────────────────────────────────────────────

def _parse_csv_mac_map(csv_path: str) -> Dict[str, Dict[str, str]]:
    """Parse a workbook CSV to build {mac -> {name, mac, ip, serial}} and {name -> ...} lookups."""
    import csv as csvmod
    mac_map: Dict[str, Dict[str, str]] = {}
    name_map: Dict[str, Dict[str, str]] = {}
    if not csv_path or not os.path.isfile(csv_path):
        return mac_map
    try:
        with open(csv_path, "r", encoding="utf-8-sig") as f:
            reader = csvmod.DictReader(f)
            headers_lower = {h.lower().strip(): h for h in (reader.fieldnames or [])}
            mac_col = headers_lower.get("mac_address") or headers_lower.get("management_mac") or headers_lower.get("mac") or headers_lower.get("idrac_mac")
            name_col = headers_lower.get("asset_name") or headers_lower.get("name") or headers_lower.get("hostname") or headers_lower.get("host")
            ip_col = headers_lower.get("management_ip") or headers_lower.get("ip") or headers_lower.get("idrac_ip")
            serial_col = headers_lower.get("serial_number") or headers_lower.get("serial") or headers_lower.get("service_tag")
            part_col = headers_lower.get("part_number") or headers_lower.get("part_num") or headers_lower.get("model") or headers_lower.get("sku")
            rack_unit_col = headers_lower.get("rack_unit") or headers_lower.get("rack_u") or headers_lower.get("rackunit")
            if not mac_col:
                return mac_map
            for row in reader:
                mac = (row.get(mac_col) or "").strip().lower()
                name = (row.get(name_col) or "").strip() if name_col else ""
                ip = (row.get(ip_col) or "").strip() if ip_col else ""
                serial = (row.get(serial_col) or "").strip() if serial_col else ""
                part_number = (row.get(part_col) or "").strip() if part_col else ""
                rack_unit = (row.get(rack_unit_col) or "").strip() if rack_unit_col else ""
                if mac:
                    entry = {"mac": mac, "name": name, "ip": ip, "serial": serial, "part_number": part_number, "rack_unit": rack_unit}
                    mac_map[mac] = entry
                    if name:
                        name_map[name.lower()] = entry
    except Exception:
        log.warning("[inventory] Failed to parse workbook CSV %s", csv_path, exc_info=True)
    # Attach name_map to mac_map as a special key for cross-ref
    mac_map["__by_name__"] = name_map  # type: ignore
    return mac_map


def _parse_inventory_log(log_path: str) -> Dict[str, str]:
    """Parse generate_inventory.log for 'Found: MAC → IP' lines. Returns {ip: mac}."""
    ip_to_mac: Dict[str, str] = {}
    if not log_path or not os.path.isfile(log_path):
        return ip_to_mac
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                # Match patterns like: Found: c4:5a:b1:b8:7f:95 → 192.168.0.5
                m = re.search(r'([0-9a-fA-F:]{17})\s*(?:→|->|=>)\s*(\d+\.\d+\.\d+\.\d+)', line)
                if m:
                    mac = m.group(1).lower()
                    ip = m.group(2)
                    ip_to_mac[ip] = mac
    except Exception:
        log.warning("[inventory] Failed to parse inventory log %s", log_path, exc_info=True)
    return ip_to_mac


def parse_job_inventory(job_id: str) -> Dict[str, Any]:
    """Parse the job's target_hosts inventory and cross-reference with CSV/log for MAC/name."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    inv_path = job.get("jobInventoryPath") or os.path.join(_job_dir(job_id), "target_hosts")
    if not os.path.isfile(inv_path):
        return {"hosts": [], "total": 0}

    # Parse INI-style inventory for host IPs
    hosts_raw: List[Dict[str, str]] = []
    try:
        with open(inv_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("["):
                    continue
                parts = line.split()
                ip = parts[0]
                # Basic IP check
                if not re.match(r'^\d+\.\d+\.\d+\.\d+$', ip):
                    continue
                hosts_raw.append({"ip": ip})
    except Exception:
        log.warning("[inventory] Failed to parse inventory for job %s", job_id, exc_info=True)
        return {"hosts": [], "total": 0}

    # Cross-reference: get MAC from log, name from CSV
    log_path = os.path.join(_job_dir(job_id), "generate_inventory.log")
    ip_to_mac = _parse_inventory_log(log_path)

    csv_path = _find_csv_for_job(job_id, job) or ""
    mac_map = _parse_csv_mac_map(csv_path)
    name_map = mac_map.pop("__by_name__", {})  # type: ignore  # noqa

    result_hosts = []
    found_macs = set()
    for h in hosts_raw:
        ip = h["ip"]
        mac = ip_to_mac.get(ip, "")
        name = ""
        serial = ""
        part_number = ""
        rack_unit = ""
        if mac:
            found_macs.add(mac)
            if mac in mac_map:
                name = mac_map[mac].get("name", "")
                serial = mac_map[mac].get("serial", "")
                part_number = mac_map[mac].get("part_number", "")
                rack_unit = mac_map[mac].get("rack_unit", "")
        result_hosts.append({"ip": ip, "mac": mac, "name": name, "serial": serial, "part_number": part_number, "rack_unit": rack_unit})

    # Compute missing MACs: in CSV but not found via ARP scan
    all_csv_macs = {m for m in mac_map if m != "__by_name__"}
    missing_mac_set = sorted(all_csv_macs - found_macs)
    missing_macs = []
    for m in missing_mac_set:
        info = mac_map.get(m, {})
        missing_macs.append({
            "mac": m,
            "serial": info.get("serial", ""),
            "part_number": info.get("part_number", ""),
            "name": info.get("name", ""),
            "rack_unit": info.get("rack_unit", ""),
        })

    return {"hosts": result_hosts, "total": len(result_hosts), "missingMacs": missing_macs}


# ─────────────────────────────────────────────────────────────
# RUN HISTORY
# ─────────────────────────────────────────────────────────────

def list_job_runs(job_id: str) -> Dict[str, Any]:
    """List all runs for a job with timestamps and results."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    runs_dir = os.path.join(_job_dir(job_id), "runs")
    if not os.path.isdir(runs_dir):
        return {"jobId": job_id, "runs": []}

    runs = []
    for run_id in sorted(os.listdir(runs_dir), reverse=True):
        run_path = os.path.join(runs_dir, run_id)
        if not os.path.isdir(run_path):
            continue
        log_path = os.path.join(run_path, "run.log")
        log_size = os.path.getsize(log_path) if os.path.isfile(log_path) else 0

        # Parse timestamp from run_id (format: YYYYMMDD_HHMMSS)
        timestamp = ""
        try:
            timestamp = datetime.strptime(run_id, "%Y%m%d_%H%M%S").strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            timestamp = run_id

        # Parse result from log
        result = ""
        if os.path.isfile(log_path):
            try:
                with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                if "PLAY RECAP" in content:
                    recap_idx = content.index("PLAY RECAP")
                    recap_block = content[recap_idx:]
                    has_failed = False
                    for line in recap_block.split("\n")[1:]:
                        m = re.search(r'failed=(\d+)', line)
                        if m and int(m.group(1)) > 0:
                            has_failed = True
                            break
                    result = "failed" if has_failed else "passed"
            except Exception:
                log.warning("[runs] Failed to parse run log for %s", run_id, exc_info=True)

        # Read run metadata (tags, workflow) if available
        run_tags = []
        run_workflow = ""
        meta_path = os.path.join(run_path, "run_meta.json")
        if os.path.isfile(meta_path):
            try:
                meta = _read_json(meta_path)
                run_tags = meta.get("tags", [])
                run_workflow = meta.get("workflow", "")
            except Exception:
                log.warning("[runs] Failed to parse run metadata for %s", run_id, exc_info=True)

        # Parse duration from log start/end timestamps
        duration = 0
        if os.path.isfile(log_path):
            try:
                with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                    log_lines = f.readlines()
                ts_pattern = re.compile(r'^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})')
                first_ts = None
                last_ts = None
                for line in log_lines:
                    m = ts_pattern.match(line)
                    if m:
                        if first_ts is None:
                            first_ts = m.group(1)
                        last_ts = m.group(1)
                if first_ts and last_ts:
                    fmt = "%Y-%m-%d %H:%M:%S" if " " in first_ts else "%Y-%m-%dT%H:%M:%S"
                    t0 = datetime.strptime(first_ts, fmt)
                    t1 = datetime.strptime(last_ts, fmt)
                    duration = max(0, int((t1 - t0).total_seconds()))
            except Exception:
                log.warning("[runs] Failed to parse duration for run %s", run_id, exc_info=True)

        # Scan for group subdirectories (parallel run groups)
        groups = []
        for entry in sorted(os.listdir(run_path)):
            group_path = os.path.join(run_path, entry)
            if not os.path.isdir(group_path):
                continue
            group_meta_path = os.path.join(group_path, "run_meta.json")
            if not os.path.isfile(group_meta_path):
                continue
            try:
                gmeta = _read_json(group_meta_path)
                g_started = gmeta.get("startedAt", "")
                g_label = gmeta.get("label", entry)
                g_tags = gmeta.get("tags", [])
                g_result = ""
                # Parse group result from group log
                g_log = os.path.join(group_path, "run.log")
                g_ended = ""
                if os.path.isfile(g_log):
                    with open(g_log, "r", encoding="utf-8", errors="replace") as gf:
                        g_content = gf.read()
                    # Find last timestamp for endedAt
                    g_ts_matches = re.findall(r'^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})', g_content, re.MULTILINE)
                    if g_ts_matches:
                        g_ended = g_ts_matches[-1]
                    if "PLAY RECAP" in g_content:
                        g_recap = g_content[g_content.index("PLAY RECAP"):]
                        g_has_failed = False
                        for gline in g_recap.split("\n")[1:]:
                            gm = re.search(r'failed=(\d+)', gline)
                            if gm and int(gm.group(1)) > 0:
                                g_has_failed = True
                                break
                        g_result = "failed" if g_has_failed else "passed"
                groups.append({
                    "groupId": entry,
                    "label": g_label,
                    "tags": g_tags,
                    "startedAt": g_started,
                    "endedAt": g_ended,
                    "result": g_result,
                })
            except Exception:
                log.warning("[runs] Failed to parse group in run %s", run_id, exc_info=True)

        runs.append({
            "runId": run_id,
            "timestamp": timestamp,
            "result": result,
            "logSize": log_size,
            "tags": run_tags,
            "workflow": run_workflow,
            "duration": duration,
            "groups": groups,
        })

    return {"jobId": job_id, "runs": runs}


def generate_run_report(job_id: str, run_id: str) -> str:
    """Generate an HTML report for a specific run. Returns the report file path."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    run_dir = os.path.join(_job_dir(job_id), "runs", run_id)
    log_path = os.path.join(run_dir, "run.log")
    if not os.path.isfile(log_path):
        raise ValidationError(f"Run log not found: {run_id}")

    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
        log_content = f.read()

    # Parse PLAY RECAP for per-host results
    host_rows = ""
    if "PLAY RECAP" in log_content:
        recap_idx = log_content.index("PLAY RECAP")
        recap_block = log_content[recap_idx:]
        for line in recap_block.split("\n")[1:]:
            m = re.match(r'^(\S+)\s+.*ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)', line)
            if m:
                host, ok, changed, unreach, failed = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
                status_cls = "color:#f87171;font-weight:bold;" if int(failed) > 0 else "color:#4ade80;"
                status_txt = "FAILED" if int(failed) > 0 else "PASSED"
                host_rows += f"<tr><td>{host}</td><td>{ok}</td><td>{changed}</td><td>{unreach}</td><td>{failed}</td><td style='{status_cls}'>{status_txt}</td></tr>\n"

    recap_table = ""
    if host_rows:
        recap_table = f"""
        <h2>PLAY RECAP</h2>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
          <thead><tr><th>Host</th><th>OK</th><th>Changed</th><th>Unreachable</th><th>Failed</th><th>Status</th></tr></thead>
          <tbody>{host_rows}</tbody>
        </table>"""

    job_name = safeText(job.get("jobName", ""))
    timestamp = ""
    try:
        timestamp = datetime.strptime(run_id, "%Y%m%d_%H%M%S").strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        timestamp = run_id

    # Escape HTML in log
    import html as html_mod
    safe_log = html_mod.escape(log_content)

    report_html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Run Report — {html_mod.escape(job_name)}</title>
<style>body{{font-family:sans-serif;margin:20px;background:#1a1a2e;color:#e5e7eb;}}
h1{{color:#c7d2fe;}}h2{{color:#8b5cf6;margin-top:24px;}}
table{{width:100%;}}th{{background:#2d2d44;padding:8px;text-align:left;}}td{{padding:6px 8px;}}
tr:nth-child(even){{background:rgba(255,255,255,0.03);}}
pre{{background:#0a0e1a;padding:16px;border-radius:8px;overflow:auto;max-height:600px;font-size:12px;white-space:pre-wrap;}}
.meta{{color:#9ca3af;margin-bottom:4px;font-size:13px;}}</style></head>
<body>
<h1>Run Report</h1>
<div class="meta"><b>Job:</b> {html_mod.escape(job_name)}</div>
<div class="meta"><b>Job ID:</b> {html_mod.escape(job_id)}</div>
<div class="meta"><b>Run ID:</b> {html_mod.escape(run_id)}</div>
<div class="meta"><b>Timestamp:</b> {html_mod.escape(timestamp)}</div>
{recap_table}
<h2>Full Log</h2>
<pre>{safe_log}</pre>
</body></html>"""

    report_path = os.path.join(run_dir, "report.html")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_html)
    return report_path


def safeText(s) -> str:
    """Safe text helper for backend templates."""
    return str(s) if s is not None else ""


# ─────────────────────────────────────────────────────────────
# JOB OUTPUT FILES (PDU / Switches / Console)
# ─────────────────────────────────────────────────────────────

def list_job_outputs(job_id: str, output_type: str) -> Dict[str, Any]:
    """List output files matching a type pattern (pdu, switch, console)."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")

    jdir = _job_dir(job_id)
    patterns = {
        "pdu": ["*pdu*", "*PDU*"],
        "switches": ["*switch*", "*Switch*", "*console*", "*Console*"],
        "diagnostics": ["*diagnostics*", "*Diagnostics*", "*diag*", "*SupportAssist*"],
    }

    globs = patterns.get(output_type, [f"*{output_type}*"])
    found_files = []
    seen = set()

    for pat in globs:
        for fpath in glob.glob(os.path.join(jdir, "**", pat), recursive=True):
            if os.path.isfile(fpath) and fpath not in seen:
                seen.add(fpath)
                stat = os.stat(fpath)
                found_files.append({
                    "filename": os.path.basename(fpath),
                    "path": fpath,
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                })

    found_files.sort(key=lambda x: x["modified"], reverse=True)
    return {"jobId": job_id, "type": output_type, "files": found_files}


def validate_output_path(job_id: str, fpath: str) -> str:
    """Validate that fpath belongs to the job directory. Returns safe absolute path."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")
    jdir = os.path.realpath(_job_dir(job_id))
    real_path = os.path.realpath(fpath)
    if not real_path.startswith(jdir):
        raise ValidationError("Invalid file path")
    if not os.path.isfile(real_path):
        raise ValidationError("File not found")
    return real_path


def download_selected_outputs(job_id: str, paths: list) -> str:
    """Zip selected output files for download."""
    import zipfile as zf
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")
    jdir = os.path.realpath(_job_dir(job_id))
    tmp_dir = os.path.join(_job_dir(job_id), "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    zip_path = os.path.join(tmp_dir, f"outputs_{job_id}.zip")
    with zf.ZipFile(zip_path, "w", zf.ZIP_DEFLATED) as zipf:
        for p in paths:
            real_p = os.path.realpath(p)
            if real_p.startswith(jdir) and os.path.isfile(real_p):
                zipf.write(real_p, os.path.basename(real_p))
    return zip_path


# ─────────────────────────────────────────────────────────────
# DASHBOARD STATS
# ─────────────────────────────────────────────────────────────

def get_dashboard_stats() -> Dict[str, Any]:
    """Aggregate host stats across all jobs for dashboard KPI cards."""
    jobs = list_jobs()
    stats = {"total_hosts": 0, "configured": 0, "failed": 0, "pending": 0, "running_jobs": 0}
    for job in jobs:
        if job.get("status") == "running":
            stats["running_jobs"] += 1
        result = job.get("lastRunResult", "")
        hc = job.get("hostCount", 0)
        if result == "passed":
            stats["configured"] += hc
        elif result == "failed":
            stats["failed"] += hc
        else:
            stats["pending"] += hc
        stats["total_hosts"] += hc
    return stats


# ─────────────────────────────────────────────────────────────
# JOB TEMPLATES
# ─────────────────────────────────────────────────────────────

TEMPLATES_DIR = os.path.join(JOBS_ROOT, "templates")
os.makedirs(TEMPLATES_DIR, exist_ok=True)


def save_as_template(job_id: str, template_name: str) -> Dict[str, Any]:
    """Save a job's config as a reusable template."""
    job = get_job(job_id)
    if not job:
        raise JobNotFoundError("Job not found")
    if not template_name or not template_name.strip():
        raise ValidationError("Template name is required")
    template = {k: job[k] for k in ("workflow", "serverClass", "customer", "sku", "po") if k in job}
    template["templateName"] = template_name.strip()
    template["templateId"] = _slugify(template_name) + "_" + _stamp()
    template["createdAt"] = _now()
    template["sourceJobId"] = job_id
    tpath = os.path.join(TEMPLATES_DIR, template["templateId"] + ".json")
    _write_json(tpath, template)
    log.info("[template] Saved template '%s' from job %s", template_name, job_id)
    return template


def list_templates() -> List[Dict[str, Any]]:
    """List all saved templates."""
    templates = []
    if not os.path.isdir(TEMPLATES_DIR):
        return templates
    for fname in sorted(os.listdir(TEMPLATES_DIR)):
        if not fname.endswith(".json"):
            continue
        try:
            tpath = os.path.join(TEMPLATES_DIR, fname)
            templates.append(_read_json(tpath))
        except Exception:
            log.warning("[template] Failed to load template %s", fname, exc_info=True)
            continue
    return templates


def delete_template(template_id: str) -> Dict[str, Any]:
    """Delete a template by ID."""
    if not template_id or not re.match(r'^[a-z0-9_]+$', template_id):
        raise ValidationError("Invalid template ID")
    tpath = os.path.join(TEMPLATES_DIR, template_id + ".json")
    if not os.path.isfile(tpath):
        raise JobNotFoundError("Template not found")
    try:
        os.remove(tpath)
    except FileNotFoundError:
        pass
    except OSError as e:
        log.error("[file] Failed to remove template %s: %s", tpath, e)
        raise ValidationError(f"Cannot delete template: {e}")
    log.info("[template] Deleted template %s", template_id)
    return {"status": "deleted", "templateId": template_id}


def create_from_template(template_id: str, job_name: str, rack_id: str = "") -> Dict[str, Any]:
    """Create a new job pre-filled from a template."""
    if not template_id or not re.match(r'^[a-z0-9_]+$', template_id):
        raise ValidationError("Invalid template ID")
    tpath = os.path.join(TEMPLATES_DIR, template_id + ".json")
    if not os.path.isfile(tpath):
        raise JobNotFoundError("Template not found")
    template = _read_json(tpath)
    payload = {
        "jobName": job_name or template.get("templateName", "From Template"),
        "workflow": template.get("workflow", "configbuild"),
        "serverClass": template.get("serverClass", ""),
        "customer": template.get("customer", "servicenow"),
        "sku": template.get("sku", ""),
        "po": template.get("po", ""),
        "rackId": rack_id,
    }
    return create_job(payload)


# ─────────────────────────────────────────────────────────────
# AUDIT LOGGING
# ─────────────────────────────────────────────────────────────

_audit_logger = logging.getLogger("eca.audit")


def _setup_audit_log():
    """Configure a separate rotating file handler for audit events."""
    if _audit_logger.handlers:
        return
    _audit_logger.setLevel(logging.INFO)
    _audit_logger.propagate = False
    audit_path = os.path.join(UI_BASE_DIR, "audit.log")
    from logging.handlers import RotatingFileHandler
    fh = RotatingFileHandler(audit_path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    fh.setFormatter(fmt)
    _audit_logger.addHandler(fh)


_setup_audit_log()


def _audit_log(action: str, job_id: str = "", detail: str = "", user: str = "", ip: str = ""):
    """Write a structured audit log entry."""
    _audit_logger.info("ACTION=%s JOB=%s USER=%s IP=%s DETAIL=%s", action, job_id, user, ip, detail)

