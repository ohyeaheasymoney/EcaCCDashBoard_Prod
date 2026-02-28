FROM python:3.11-slim

LABEL maintainer="ohyeaheasymoney"
LABEL description="ECA Command Center Dashboard - Production"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ansible \
    arp-scan \
    gcc \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd -m -s /bin/bash eca

WORKDIR /home/eca/eca-command-center

# Install Python dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy application files
COPY server.py config_backend.py manage_users.py start.sh ./
COPY workflows.json ./
COPY nginx.conf ./
COPY static/ static/
COPY playbooks/ playbooks/

# Create runtime directories
RUN mkdir -p jobs backups && \
    chown -R eca:eca /home/eca/eca-command-center

RUN chmod +x start.sh

USER eca

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

# Default to binding 0.0.0.0 in container mode
ENV ECA_BIND=0.0.0.0
ENV ECA_PORT=5000

CMD ["./start.sh"]
