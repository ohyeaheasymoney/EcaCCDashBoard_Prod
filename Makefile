# ──────────────────────────────────────────────────────────────
# ECA Command Center — Quick Reference Commands
# ──────────────────────────────────────────────────────────────
# Usage: make <target>
# Run `make help` to see all available commands.
# ──────────────────────────────────────────────────────────────

SHELL := /bin/bash
APP_DIR ?= /home/eca/eca-command-center
VENV := $(APP_DIR)/venv/bin

.DEFAULT_GOAL := help

# ── Deployment ──────────────────────────────────────────────

.PHONY: preflight
preflight: ## Run pre-flight checks before deployment
	sudo bash scripts/preflight-check.sh

.PHONY: deploy
deploy: ## Deploy the application (requires root)
	sudo bash deploy.sh

.PHONY: verify
verify: ## Run post-deployment smoke tests
	bash scripts/post-deploy-test.sh

.PHONY: full-deploy
full-deploy: preflight deploy verify ## Preflight → Deploy → Verify (full pipeline)

# ── Service Management ──────────────────────────────────────

.PHONY: start
start: ## Start the ECA service
	sudo systemctl start eca-command-center

.PHONY: stop
stop: ## Stop the ECA service
	sudo systemctl stop eca-command-center

.PHONY: restart
restart: ## Restart the ECA service
	sudo systemctl restart eca-command-center

.PHONY: status
status: ## Show service status
	sudo systemctl status eca-command-center

.PHONY: logs
logs: ## Tail application logs (live)
	journalctl -u eca-command-center -f

.PHONY: app-log
app-log: ## Tail server.log (live)
	tail -f $(APP_DIR)/server.log

# ── User Management ─────────────────────────────────────────

.PHONY: users
users: ## List all users
	cd $(APP_DIR) && $(VENV)/python3 manage_users.py list

.PHONY: add-admin
add-admin: ## Add admin user (interactive — prompts for username/password)
	@read -p "Username: " user; \
	read -sp "Password: " pass; echo; \
	cd $(APP_DIR) && $(VENV)/python3 manage_users.py add $$user $$pass --role admin

.PHONY: add-user
add-user: ## Add operator user (interactive — prompts for username/password)
	@read -p "Username: " user; \
	read -sp "Password: " pass; echo; \
	cd $(APP_DIR) && $(VENV)/python3 manage_users.py add $$user $$pass --role operator

# ── Backup & Restore ────────────────────────────────────────

.PHONY: backup
backup: ## Run a manual backup
	bash scripts/backup.sh

.PHONY: list-backups
list-backups: ## List available backups
	@ls -lh $(APP_DIR)/backups/backup_*.tar.gz 2>/dev/null || echo "No backups found."

.PHONY: restore
restore: ## Restore from backup (usage: make restore FILE=backups/backup_xxx.tar.gz)
	@if [ -z "$(FILE)" ]; then echo "Usage: make restore FILE=backups/backup_xxx.tar.gz"; exit 1; fi
	bash scripts/restore.sh $(FILE)

# ── Health & Monitoring ──────────────────────────────────────

.PHONY: health
health: ## Check the health endpoint
	@curl -s http://127.0.0.1:5000/api/health | python3 -m json.tool 2>/dev/null || echo "Service not reachable"

.PHONY: check-nfs
check-nfs: ## Test NFS connectivity
	@NFS=$$(grep ECA_NFS_HOST $(APP_DIR)/.env 2>/dev/null | cut -d= -f2 || echo "10.3.3.157"); \
	echo "Pinging NFS host $$NFS..."; \
	ping -c 3 $$NFS

# ── Docker ───────────────────────────────────────────────────

.PHONY: docker-build
docker-build: ## Build Docker image
	docker build -t eca-command-center .

.PHONY: docker-up
docker-up: ## Start with Docker Compose
	docker compose up -d

.PHONY: docker-down
docker-down: ## Stop Docker Compose stack
	docker compose down

.PHONY: docker-logs
docker-logs: ## Tail Docker container logs
	docker compose logs -f eca-command-center

# ── Development ──────────────────────────────────────────────

.PHONY: dev
dev: ## Run the dev server (auto-reload, port 5000)
	cd $(APP_DIR) && $(VENV)/python3 server.py

.PHONY: lint
lint: ## Run Python linter
	flake8 server.py config_backend.py manage_users.py --max-line-length=140 --ignore=E501,W503,E402

.PHONY: validate-playbooks
validate-playbooks: ## Validate playbook YAML syntax
	yamllint -d "{extends: relaxed, rules: {line-length: disable, truthy: disable}}" playbooks/*.yaml playbooks/*.yml

# ── Help ─────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help message
	@echo ""
	@echo "ECA Command Center — Available Commands"
	@echo "════════════════════════════════════════"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
