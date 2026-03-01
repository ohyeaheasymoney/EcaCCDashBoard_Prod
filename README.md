# ECA Command Center Dashboard — Production

Production deployment of the ECA Command Center, a web-based automation platform for Dell server provisioning, network switch configuration, and infrastructure management. Built on Flask + Ansible with a modular vanilla JS frontend.

---

## Quick Start (3 Commands)

```bash
git clone git@github.com:ohyeaheasymoney/EcaCCDashBoard_Prod.git
cd EcaCCDashBoard_Prod
make full-deploy
```

This runs: **preflight checks** → **deploy** → **smoke tests** — fully automated.

Or step by step:

```bash
sudo bash scripts/preflight-check.sh   # Validate environment
sudo bash deploy.sh                     # Install everything
bash scripts/post-deploy-test.sh        # Verify it works
```

After deployment, access the UI at `http://<server-ip>/` and log in with `admin` / `admin`.

> Run `make help` to see all available commands.

---

## Table of Contents

- [Quick Start](#quick-start-3-commands)
- [Features](#features)
- [Architecture](#architecture)
- [Infrastructure Requirements](#infrastructure-requirements)
- [Network Configuration](#network-configuration)
- [Project Structure](#project-structure)
- [Deployment Guide](#deployment-guide)
- [Docker Deployment](#docker-deployment)
- [Environment Configuration](#environment-configuration)
- [Playbooks Reference](#playbooks-reference)
- [Workflows](#workflows)
- [Configuration Reference](#configuration-reference)
- [User Management](#user-management)
- [Backup & Restore](#backup--restore)
- [NFS Share Setup](#nfs-share-setup)
- [Firewall Rules](#firewall-rules)
- [CI/CD Pipeline](#cicd-pipeline)
- [Make Commands Reference](#make-commands-reference)
- [Troubleshooting](#troubleshooting)

---

## Features

- **7 Automation Workflows**
  - Server Build & Configure (I Class / J Class)
  - Post-Provisioning Setup (TSR, cleanup, power actions)
  - Quick QC Validation
  - Cisco Switch Automation
  - Juniper Switch Automation
  - Console Switch Setup
  - PDU Setup
- **Job Management** — Create, clone, delete jobs with per-job file storage, inventory, and run history
- **Inventory Generation** — CSV workbook parsing with ARP-based network discovery
- **Task Presets** — Full Stack, Quick Deploy, or Custom task selection per workflow
- **Live Status** — Real-time log streaming, host status matrix, progress tracking
- **TSR Collection** — Collect, download, delete, and re-run Technical Support Reports per host
- **Dell Firmware Catalog** — Auto-generated from uploaded firmware with Dell catalog cross-reference
- **Run History** — Per-run reports, log downloads, and run comparison
- **Dark/Light Theme** — Toggle with persistent preference
- **Role-Based Access** — Admin and operator roles with audit logging
- **Multi-Customer Support** — Customer-scoped job isolation

---

## Architecture

```
                      ┌──────────────┐
   Browser ─────────▶ │    Nginx     │ :80 (reverse proxy)
                      │  static files│
                      └──────┬───────┘
                             │
                      ┌──────▼───────┐
                      │   Gunicorn   │ :5000  (4 workers x 4 threads)
                      │  Flask App   │
                      └──────┬───────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
       ┌────▼─────┐   ┌─────▼──────┐   ┌─────▼─────┐
       │  SQLite   │   │  Ansible   │   │   NFS     │
       │  jobs.db  │   │ Playbooks  │   │  Share    │
       └──────────┘   └────────────┘   │10.3.3.157 │
                                        └───────────┘
```

| Layer          | Technology                                 |
|----------------|--------------------------------------------|
| Backend        | Python 3.9+, Flask 3.0+, Flask-CORS, Gunicorn |
| Frontend       | Vanilla JS (modular), CSS (dark/light themes) |
| Database       | SQLite (`jobs/jobs.db`)                    |
| Automation     | Ansible Playbooks (ansible-core)           |
| Reverse Proxy  | Nginx (recommended for production)         |
| NFS Storage    | `10.3.3.157` — firmware, BIOS XML, catalogs |
| Discovery      | `arp-scan` (NOPASSWD sudoers)              |
| Process Mgmt   | systemd (`eca-command-center.service`)     |

---

## Infrastructure Requirements

### Server (Application Host)

| Requirement       | Minimum                              |
|--------------------|--------------------------------------|
| OS                 | RHEL 9 / Rocky 9 / AlmaLinux 9      |
| Python             | 3.9+                                |
| RAM                | 4 GB                                 |
| Disk               | 50 GB (jobs, logs, firmware cache)   |
| Network            | Access to iDRAC management VLAN      |
| Packages           | `python3`, `python3-pip`, `python3-devel`, `gcc`, `ansible-core`, `arp-scan`, `nginx` |

### Python Dependencies

```
Flask>=3.0.0
flask-cors>=4.0.0
filelock>=3.12.0
gunicorn>=21.2.0
```

### External Services

| Service          | IP / Host        | Purpose                              |
|------------------|------------------|--------------------------------------|
| NFS Share        | `10.3.3.157`     | Firmware files, BIOS XML configs, Dell catalogs |
| iDRAC Network    | Management VLAN  | Server out-of-band management        |
| DNS (optional)   | Internal DNS     | Hostname resolution for dashboard    |

---

## Network Configuration

### Key IP Addresses

| Resource          | IP Address       | Notes                                |
|-------------------|------------------|--------------------------------------|
| NFS Share Server  | `10.3.3.157`     | Firmware & config file storage       |
| App Server        | *(your host IP)* | Runs the ECA Command Center          |
| iDRAC Targets     | *(from inventory)*| Dell server management interfaces   |

### Required Network Access

| From              | To               | Port(s)         | Protocol | Purpose           |
|-------------------|------------------|-----------------|----------|-------------------|
| App Server        | NFS Share        | 2049, 111       | TCP/UDP  | NFS mount         |
| App Server        | iDRAC hosts      | 443             | HTTPS    | Redfish API       |
| App Server        | iDRAC hosts      | 22              | SSH      | Ansible SSH       |
| Browser clients   | App Server       | 80 (nginx)      | HTTP     | Web UI            |
| Browser clients   | App Server       | 5000 (direct)   | HTTP     | Web UI (no nginx) |
| App Server        | Local subnet     | ARP             | L2       | arp-scan discovery|

---

## Project Structure

```
EcaCCDashBoard_Prod/
├── server.py                    # Flask app entry point + all API routes
├── config_backend.py            # Business logic: jobs, inventory, TSR, runs
├── manage_users.py              # CLI user management tool
├── deploy.sh                    # Automated production deployment script
├── start.sh                     # Production launcher (gunicorn, env-configurable)
├── nginx.conf                   # Nginx reverse proxy config (with security headers)
├── nginx-docker.conf            # Nginx config for Docker Compose deployment
├── requirements.txt             # Python dependencies
├── workflows.json               # Workflow definitions (tasks, tags, presets)
├── .env.example                 # Environment variable template
├── .gitignore
├── Dockerfile                   # Container build for the app
├── docker-compose.yml           # Multi-container deployment (app + nginx)
├── eca-command-center.service   # systemd unit file (version-controlled)
├── eca-command-center.logrotate # Log rotation configuration
│
├── Makefile                     # Quick-reference commands (make help)
│
├── scripts/                     # Operational scripts
│   ├── preflight-check.sh       # Pre-deployment environment validation
│   ├── post-deploy-test.sh      # Post-deployment smoke tests
│   ├── backup.sh                # Database & config backup (cron-ready)
│   └── restore.sh               # Restore from backup archive
│
├── .github/workflows/           # CI/CD
│   └── ci.yml                   # Lint, YAML validation, Docker build test
│
├── static/                      # Frontend GUI (served by nginx/flask)
│   ├── index.html               # Single-page app shell
│   ├── styles.css               # All styles (dark/light themes)
│   ├── api.js                   # Fetch wrapper (apiGet, apiPost, etc.)
│   ├── utils.js                 # Shared helpers, toasts, modals
│   ├── dashboard.js             # Job list, filters, sorting, search
│   ├── wizard.js                # Main app init + routing
│   ├── wizard-modal.js          # New job creation wizard
│   ├── workflow-logic.js        # Workflow definitions
│   ├── ui-config.js             # UI constants
│   ├── theme.js                 # Dark/light theme toggle
│   ├── admin.js                 # Admin panel (users, workflows, customers)
│   ├── job-panel-core.js        # Job panel shell, tabs, shared state
│   ├── job-panel-customer.js    # Customer/workflow selectors
│   ├── job-panel-files.js       # File upload, preview, delete, catalog
│   ├── job-panel-inventory.js   # Inventory generation, host picker
│   ├── job-panel-tasks.js       # Task presets, checkboxes, preflight
│   ├── job-panel-execution.js   # Run/stop controls
│   ├── job-panel-status.js      # Live log, progress, host status matrix
│   ├── job-panel-history.js     # Run history, reports, comparison
│   ├── job-panel-groups.js      # Host group management
│   ├── job-panel-tsr.js         # TSR collection status, download
│   ├── favicon.svg              # Browser tab icon
│   └── logo-eca.svg             # ECA logo
│
├── playbooks/                   # Ansible playbooks for Dell server automation
│   ├── ansible.cfg              # Ansible configuration (forks, SSH, timeouts)
│   ├── hosts                    # Default inventory file (target_hosts)
│   ├── vars.yml                 # Shared variables (paths, NFS, credentials)
│   ├── ConfigMain._I_class.yaml # I Class server full build playbook
│   ├── ConfigMain._J_class.yaml # J Class server full build playbook
│   ├── post_provisioning.yaml   # Post-provisioning (diagnostics, TSR, cleanup)
│   ├── Quick_QC.yaml            # Quick QC validation playbook
│   ├── PowerUp.yaml             # Power on servers
│   ├── PowerDown.yaml           # Graceful power off
│   ├── powercycle.yaml          # Power cycle servers
│   ├── Enable_LLDP.yaml         # Enable LLDP on iDRAC
│   ├── Disable_LLDP.yaml        # Disable LLDP on iDRAC
│   ├── Firmware.yaml            # Firmware update via NFS catalog
│   ├── Configure_iDRAC.yml      # iDRAC configuration import
│   ├── ImportXML.yaml           # BIOS XML import via SCP
│   ├── RackSlot.yaml            # Set rack name + slot
│   ├── asset_tag.yaml           # Set asset tags from CSV mapping
│   ├── change_asset_tags.yml    # Bulk asset tag changes
│   ├── changeracklocation.yml   # Bulk rack location changes
│   ├── Diagnostics.yaml         # Run remote diagnostics
│   ├── supportAssist.yaml       # Dell SupportAssist collection
│   ├── Cleanup.yaml             # Post-build cleanup
│   ├── QuickDellInventoryDellModsTemplate.yaml  # Dell inventory template
│   ├── generate_inventory.py    # Inventory generation from workbook
│   ├── format_dell_inventoryTemplate.py  # Dell inventory formatter
│   ├── CreateCatalogFile.py     # Catalog XML generator
│   ├── rename_file.py           # File rename utility
│   ├── rename_json_serial.py    # Serial-based JSON rename
│   └── config.py                # Playbook path configuration
│
└── jobs/                        # Runtime data (auto-created, not in git)
    ├── jobs.db                  # SQLite database
    └── {job_id}/                # Per-job folders
        ├── job.json             # Job metadata
        ├── input/               # Uploaded workbooks, firmware
        ├── runs/                # Per-run logs and reports
        ├── firmware/            # Firmware files (NFS-served)
        ├── TSR/                 # Technical Support Reports
        └── QuickQC/             # QC results
```

---

## Deployment Guide

### Option A: Automated Deployment (Recommended)

```bash
# 1. Clone the repo
git clone git@github.com:ohyeaheasymoney/EcaCCDashBoard_Prod.git
cd EcaCCDashBoard_Prod

# 2. Pre-flight check (validates packages, Python, NFS, disk, network)
sudo bash scripts/preflight-check.sh

# 3. Deploy (installs everything, creates .env with auto-generated secret key)
sudo bash deploy.sh

# 4. Verify deployment (checks service, health endpoint, nginx, database, NFS)
bash scripts/post-deploy-test.sh
```

Or run all three in one command: `make full-deploy`

The `deploy.sh` script handles everything:
1. Installs system packages (Python3, pip, ansible-core, arp-scan, gcc)
2. Creates the `eca` user if it doesn't exist
3. Copies app files to `/home/eca/eca-command-center`
4. Deploys playbooks and patches `vars.yml` with correct paths + NFS host
5. Creates `.env` from template with auto-generated secret key + CORS config
6. Creates a Python virtualenv and installs dependencies
7. Sets file ownership
8. Configures sudoers for `arp-scan` (NOPASSWD)
9. Creates and enables the `eca-command-center` systemd service
10. Installs logrotate configuration
11. Sets up daily backup cron job (2:00 AM)
12. Configures Nginx reverse proxy (if nginx is installed)
13. Creates the default admin user (`admin`/`admin`)

### Option B: Manual Deployment

```bash
# 1. Install system dependencies
sudo dnf install -y python3 python3-pip python3-devel gcc arp-scan ansible-core nginx

# 2. Clone the repo
git clone git@github.com:ohyeaheasymoney/EcaCCDashBoard_Prod.git
cd EcaCCDashBoard_Prod

# 3. Create virtualenv and install Python packages
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 4. Copy playbooks to the playbook directory
sudo mkdir -p /var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4
sudo cp playbooks/* /var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4/
sudo chown -R eca:eca /var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4

# 5. Configure sudoers for arp-scan
echo "eca ALL=(ALL) NOPASSWD: /usr/sbin/arp-scan" | sudo tee /etc/sudoers.d/eca-arp-scan
sudo chmod 440 /etc/sudoers.d/eca-arp-scan

# 6. Start the application
bash start.sh
```

### Option C: Development Server

```bash
python3 server.py
# Runs on http://0.0.0.0:5000 with auto-reload
```

---

### Systemd Service Setup

```bash
sudo tee /etc/systemd/system/eca-command-center.service << 'EOF'
[Unit]
Description=ECA Command Center Dashboard - Production
After=network.target

[Service]
Type=simple
User=eca
Group=eca
WorkingDirectory=/home/eca/eca-command-center
Environment="PATH=/home/eca/eca-command-center/venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/home/eca/eca-command-center/venv/bin/gunicorn server:app -w 4 --threads 4 -b 0.0.0.0:5000 --timeout 300
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now eca-command-center
```

### Nginx Reverse Proxy

```bash
# Copy the included nginx.conf
sudo cp nginx.conf /etc/nginx/conf.d/eca.conf

# Update the static file path in the config
sudo sed -i 's|/home/eca/Downloads/UI/ansible-ui|/home/eca/eca-command-center|g' /etc/nginx/conf.d/eca.conf

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

Access the UI at `http://<server-ip>/` (port 80) instead of `:5000`.

---

## Docker Deployment

### Quick Start with Docker Compose

```bash
# 1. Clone the repo
git clone git@github.com:ohyeaheasymoney/EcaCCDashBoard_Prod.git
cd EcaCCDashBoard_Prod

# 2. Create your .env file
cp .env.example .env
# Edit .env with your NFS host, playbook path, etc.

# 3. Launch (app + nginx)
docker compose up -d

# 4. Check status
docker compose ps
docker compose logs -f eca-command-center
```

Access at `http://localhost/` (port 80 via nginx) or `http://localhost:5000` (direct).

### Docker Only (no nginx)

```bash
docker build -t eca-command-center .
docker run -d --name eca \
    -p 5000:5000 \
    -v eca-jobs:/home/eca/eca-command-center/jobs \
    --env-file .env \
    eca-command-center
```

---

## Environment Configuration

All configuration is driven by environment variables. Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `ECA_USER` | `eca` | Linux user that runs the app |
| `ECA_APP_DIR` | `/home/eca/eca-command-center` | Application install directory |
| `ECA_PORT` | `5000` | Gunicorn listen port |
| `ECA_BIND` | `127.0.0.1` | Bind address (`0.0.0.0` without nginx) |
| `ECA_WORKERS` | `4` | Gunicorn worker processes |
| `ECA_THREADS` | `4` | Threads per worker |
| `ECA_TIMEOUT` | `300` | Request timeout (seconds) |
| `ECA_MAX_REQUESTS` | `1000` | Restart worker after N requests (memory leak prevention) |
| `ECA_PLAYBOOK_DIR` | `/var/lib/rundeck/.../DellServerAuto_4` | Ansible playbook directory |
| `ECA_NFS_HOST` | `10.3.3.157` | NFS server for firmware storage |
| `ECA_SECRET_KEY` | *(auto-generated)* | Flask session secret — set for session persistence across restarts |
| `ECA_CORS_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `ECA_MAX_CONCURRENT_RUNS` | `50` | Max simultaneous ansible-playbook processes |

The `deploy.sh` script automatically creates `.env` from `.env.example` during installation with an auto-generated secret key and CORS origins configured to the server's IP. The `start.sh` launcher sources `.env` at startup.

---

## Playbooks Reference

### Server Build Playbooks

| Playbook | Purpose | Tags |
|----------|---------|------|
| `ConfigMain._J_class.yaml` | Full J Class server build | powerup, lldp, rackslot, assettag, update, reboot, xml, idrac |
| `ConfigMain._I_class.yaml` | Full I Class server build | powerup, lldp, rackslot, assettag, update, reboot, xml |
| `post_provisioning.yaml` | Post-build finalization | diagnostics, disablelld, tsr, cleanup, shutdown |
| `Quick_QC.yaml` | Quick validation check | *(runs entire playbook)* |

### Individual Task Playbooks

| Playbook | Purpose |
|----------|---------|
| `PowerUp.yaml` | Power on servers via iDRAC |
| `PowerDown.yaml` | Graceful shutdown via iDRAC |
| `powercycle.yaml` | Power cycle via iDRAC |
| `Enable_LLDP.yaml` | Enable LLDP on iDRAC NIC |
| `Disable_LLDP.yaml` | Disable LLDP on iDRAC NIC |
| `Firmware.yaml` | Update firmware from NFS catalog |
| `Configure_iDRAC.yml` | Import iDRAC configuration |
| `ImportXML.yaml` | Import BIOS XML config via SCP |
| `RackSlot.yaml` | Set rack name and slot number |
| `asset_tag.yaml` | Set asset tags from CSV mapping |
| `Diagnostics.yaml` | Run remote diagnostics |
| `supportAssist.yaml` | Collect Dell SupportAssist data |
| `Cleanup.yaml` | Post-build cleanup tasks |

### Helper Scripts

| Script | Purpose |
|--------|---------|
| `generate_inventory.py` | Generate Ansible inventory from CSV workbook |
| `format_dell_inventoryTemplate.py` | Format Dell inventory data |
| `CreateCatalogFile.py` | Generate firmware catalog XML |
| `config.py` | Playbook path configuration |

---

## Workflows

Workflow definitions are stored in `workflows.json` and managed via the Admin panel in the GUI.

| Workflow | Category | Playbook | Task Selection |
|----------|----------|----------|----------------|
| Server Build & Configure (I Class) | Server | `ConfigMain._I_class.yaml` | PowerUp, LLDP, RackSlot, AssetTag, Firmware, PowerCycle, ImportXML |
| Server Build & Configure (J Class) | Server | `ConfigMain._J_class.yaml` | PowerUp, LLDP, RackSlot, AssetTag, Firmware, PowerCycle, Configure iDRAC |
| Post-Provisioning Setup | Server | `post_provisioning.yaml` | Diagnostics, Disable LLDP, TSR, CleanUp, PowerDown |
| Quick QC Validation | Server | `Quick_QC.yaml` | *(runs entire playbook)* |
| Cisco Switch Automation | Network | *(vendor-specific)* | Firmware Update, Basic Config |
| Juniper Switch Automation | Network | *(vendor-specific)* | Firmware Update, Basic Config, Enable LLDP |
| Console Switch Setup | Network | *(vendor-specific)* | Firmware Update, Basic Config, Enable LLDP |
| PDU Setup | Power | *(vendor-specific)* | IP, vendor (Gelu/Ratnier), deployment type |

---

## Configuration Reference

### config_backend.py — Key Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JOBS_ROOT` | `./jobs` | Where job folders and SQLite DB are stored |
| `PLAYBOOK_ROOT` | `/var/lib/rundeck/.../DellServerAuto_4` | Ansible playbook directory |
| `MAX_CONCURRENT_RUNS` | `5` | Max simultaneous ansible-playbook processes |
| `ALLOWED_UPLOAD_EXTS` | `.csv .xml .yml .exe .bin .img .tgz` | Accepted upload file types |
| `NFS_HOST` | `10.3.3.157` | NFS server for firmware/config storage |

### playbooks/vars.yml — Ansible Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `local_path` | `/home/eca/eca-command-center` | App working directory |
| `local_path_tsr` | `{local_path}/TSR` | TSR export destination |
| `local_path_QuickQC` | `{local_path}/QuickQC` | QC export destination |
| `nfs_share_path` | `10.3.3.157:{local_path}/Firmware` | NFS firmware share |
| `scp_file_name` | `config_9_20.xml` | BIOS configuration XML |
| `catalog_file_name` | `catalog.xml` | Dell firmware catalog |
| `shutdown_type` | `Graceful` | Server shutdown method |
| `run_mode` | `express` | iDRAC job execution mode |

### Pause Timings (seconds)

| Stage | Default | Purpose |
|-------|---------|---------|
| `pause_powerup_seconds` | 300 (5 min) | Wait after PowerUp |
| `pause_lldp_seconds` | 300 (5 min) | Wait after LLDP enable |
| `pause_provision_seconds` | 420 (7 min) | Wait after RackSlot & AssetTag |
| `pause_firmware_seconds` | 300 (5 min) | Wait after firmware update |
| `pause_reboot_seconds` | 300 (5 min) | Wait after mid-run reboot |
| `pause_configure_seconds` | 300 (5 min) | Wait after iDRAC config |
| `pause_powercycle_seconds` | 600 (10 min) | Wait after final power cycle |

### ansible.cfg

| Setting | Value | Purpose |
|---------|-------|---------|
| `host_key_checking` | `False` | Skip SSH host verification |
| `forks` | `2` | Parallel task execution |
| `pipelining` | `True` | SSH pipelining for speed |
| `timeout` | `60` | Connection timeout |
| `retries` | `10` | Connection retry count |
| `retry_delay` | `45` | Seconds between retries |

---

## User Management

```bash
cd /home/eca/eca-command-center

# List users
venv/bin/python3 manage_users.py list

# Add admin user
venv/bin/python3 manage_users.py add <username> <password> --role admin

# Add operator user
venv/bin/python3 manage_users.py add <username> <password> --role operator

# Delete user
venv/bin/python3 manage_users.py delete <username>
```

**Default credentials:** `admin` / `admin` — change immediately after first login.

---

## Backup & Restore

### Automated Daily Backups

The `deploy.sh` script installs a cron job that runs `scripts/backup.sh` daily at 2:00 AM. Backups include:
- SQLite database (`jobs.db`) — safe WAL-mode backup
- `workflows.json`, `customers.json`, `users.json`, `.env`

Backups are compressed and stored in the `backups/` directory. The last 14 days are retained.

### Manual Backup

```bash
bash scripts/backup.sh
```

### Restore from Backup

```bash
# List available backups
bash scripts/restore.sh

# Restore a specific backup (stops and restarts the service)
bash scripts/restore.sh backups/backup_20260228_020000.tar.gz
```

---

## NFS Share Setup

The NFS share at `10.3.3.157` is used to serve firmware files and BIOS XML configurations to Dell servers during provisioning.

### On the NFS Server (10.3.3.157)

```bash
# Install NFS
sudo dnf install -y nfs-utils

# Create the export directory
sudo mkdir -p /home/eca/eca-command-center/Firmware
sudo chown eca:eca /home/eca/eca-command-center/Firmware

# Configure exports
echo "/home/eca/eca-command-center/Firmware *(ro,sync,no_subtree_check,no_root_squash)" | sudo tee -a /etc/exports

# Start NFS
sudo systemctl enable --now nfs-server
sudo exportfs -rav
```

### On the App Server

```bash
# Verify NFS connectivity
showmount -e 10.3.3.157

# Test mount
sudo mount -t nfs 10.3.3.157:/home/eca/eca-command-center/Firmware /mnt/test
ls /mnt/test
sudo umount /mnt/test
```

### Firmware Upload Flow

1. User uploads firmware files via the GUI (Job Files tab)
2. Files are stored in `jobs/{job_id}/firmware/`
3. During playbook execution, the `nfs_share_path` variable points iDRAC to `10.3.3.157` to pull firmware
4. Dell iDRAC mounts the NFS share and installs firmware directly

---

## Firewall Rules

```bash
# App server — allow HTTP and app port
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-port=5000/tcp

# If this server is also the NFS server
sudo firewall-cmd --permanent --add-service=nfs
sudo firewall-cmd --permanent --add-service=mountd
sudo firewall-cmd --permanent --add-service=rpc-bind

# Reload
sudo firewall-cmd --reload
```

---

## Service Management

```bash
# Check status
sudo systemctl status eca-command-center

# View logs (live)
journalctl -u eca-command-center -f

# Restart
sudo systemctl restart eca-command-center

# Stop
sudo systemctl stop eca-command-center

# Application log file
tail -f /home/eca/eca-command-center/server.log
```

---

## CI/CD Pipeline

GitHub Actions runs on every push and PR to `main`:

1. **Lint** — `flake8` checks Python code style
2. **YAML Validation** — `yamllint` validates all playbook syntax
3. **Credential Scan** — Checks for hardcoded passwords/secrets
4. **Docker Build** — Builds the container image and verifies it starts with a health check

The workflow is defined in `.github/workflows/ci.yml`.

---

## Make Commands Reference

Run `make help` to see all commands. Summary:

| Command | Description |
|---------|-------------|
| `make full-deploy` | Preflight + Deploy + Verify (one command) |
| `make preflight` | Run pre-flight environment checks |
| `make deploy` | Run the deployment script |
| `make verify` | Run post-deployment smoke tests |
| `make status` | Show service status |
| `make logs` | Tail live service logs |
| `make restart` | Restart the service |
| `make health` | Check the `/api/health` endpoint |
| `make users` | List all users |
| `make add-admin` | Add an admin user (interactive) |
| `make add-user` | Add an operator user (interactive) |
| `make backup` | Run a manual backup |
| `make list-backups` | List available backups |
| `make restore FILE=...` | Restore from a backup |
| `make check-nfs` | Test NFS server connectivity |
| `make docker-up` | Start with Docker Compose |
| `make docker-down` | Stop Docker Compose stack |
| `make dev` | Run Flask dev server with auto-reload |
| `make lint` | Run Python linter |
| `make validate-playbooks` | Validate playbook YAML syntax |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Service won't start | Check `journalctl -u eca-command-center -xe` for errors |
| Port 5000 in use | `ss -tlnp \| grep 5000` — kill the conflicting process |
| Playbook fails | Check `jobs/{job_id}/runs/{run_id}/ansible_stdout.log` |
| NFS mount fails | Verify `showmount -e 10.3.3.157` and firewall rules |
| arp-scan permission denied | Verify `/etc/sudoers.d/eca-arp-scan` exists with correct perms |
| Inventory generation fails | Ensure `generate_inventory.py` and `config.py` are in the playbook directory |
| Nginx 502 Bad Gateway | Ensure gunicorn is running on port 5000 |
| File upload fails | Check `client_max_body_size` in nginx.conf (default 2G) |
| Database locked | Only one gunicorn master should run; check for duplicates |

---

## Logs

| Log | Location | Rotation |
|-----|----------|----------|
| Application | `server.log` | 10 MB x 3 backups (auto) |
| Per-run Ansible | `jobs/{job_id}/runs/{run_id}/ansible_stdout.log` | None (kept per run) |
| Gunicorn access | stdout → journalctl | systemd journal |
| Audit log | `audit.log` | Manual |

---

## Source Repositories

| Repository | Purpose |
|------------|---------|
| [EcaCCDashBoard_Prod](https://github.com/ohyeaheasymoney/EcaCCDashBoard_Prod) | This repo — production deployment bundle |
| [EcaAutomationOps](https://github.com/ohyeaheasymoney/EcaAutomationOps) | Core GUI application (server + frontend) |
| [EcaCCGui_Prod](https://github.com/ohyeaheasymoney/EcaCCGui_Prod) | GUI + Playbooks production branch |

---

*Generated: 2026-02-28*
