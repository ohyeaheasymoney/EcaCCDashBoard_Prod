import os
import gzip
import logging
import traceback
import secrets
from logging.handlers import RotatingFileHandler
from flask import Flask, jsonify, request, send_from_directory, session
from functools import wraps
from flask_cors import CORS

import config_backend as backend

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

log = logging.getLogger("eca")


def _setup_logging():
    """Configure structured logging with rotating file + console.

    Guarded against duplicate handlers — safe to call from multiple
    gunicorn workers that each import create_app().
    """
    root = logging.getLogger()
    if root.handlers:
        return  # already configured (another worker or re-import)
    root.setLevel(logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotating file handler → server.log (10 MB, 3 backups)
    fh = RotatingFileHandler(
        os.path.join(BASE_DIR, "server.log"),
        maxBytes=10 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)

    # Console handler
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    root.addHandler(ch)


def create_app():
    _setup_logging()

    app = Flask(
        __name__,
        static_folder=STATIC_DIR,
        static_url_path="/static"   # IMPORTANT
    )

    CORS(app, origins=os.environ.get("ECA_CORS_ORIGINS", "http://localhost:5000").split(","),
         supports_credentials=True)

    app.secret_key = os.environ.get("ECA_SECRET_KEY", secrets.token_hex(32))

    def auth_required(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not session.get("user"):
                return jsonify({"error": "Unauthorized"}), 401
            return f(*args, **kwargs)
        return decorated

    def admin_required(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            user = session.get("user")
            if not user:
                return jsonify({"error": "Unauthorized"}), 401
            role = session.get("role") or backend.get_user_role(user)
            if role != "admin":
                return jsonify({"error": "Admin access required"}), 403
            return f(*args, **kwargs)
        return decorated

    # ─────────────────────────────────────────────
    # Helpers
    # ─────────────────────────────────────────────
    def _client_ip():
        return request.remote_addr or ""

    def _current_user():
        return session.get("user", "")

    # ─────────────────────────────────────────────
    # Startup banner
    # ─────────────────────────────────────────────
    log.info("== Ansible UI ==")
    log.info("BASE_DIR  : %s", BASE_DIR)
    log.info("STATIC_DIR: %s", STATIC_DIR)
    log.info("UI        : http://127.0.0.1:5000/")
    log.info("Static OK : http://127.0.0.1:5000/static/styles.css")

    # ─────────────────────────────────────────────
    # Typed error handler
    # Maps custom exception classes to HTTP status codes.
    # ─────────────────────────────────────────────
    @app.errorhandler(Exception)
    def handle_exception(e):
        tb = traceback.format_exc()
        log.error("FLASK ERROR: %s\n%s", e, tb)

        # Map typed exceptions to HTTP codes
        status_map = {
            "JobNotFoundError": 404,
            "ValidationError": 400,
            "ExecutionError": 500,
            "InventoryError": 500,
        }
        error_type = type(e).__name__
        status_code = status_map.get(error_type, 500)

        return jsonify({
            "error": str(e),
            "type": error_type,
        }), status_code

    @app.before_request
    def _validate_job_id_param():
        if request.view_args and "job_id" in request.view_args:
            backend.validate_job_id(request.view_args["job_id"])

    # ─────────────────────────────────────────────
    # Frontend
    # ─────────────────────────────────────────────
    @app.route("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    # ─────────────────────────────────────────────
    # Health
    # ─────────────────────────────────────────────
    @app.route("/api/health")
    def api_health():
        checks = {}
        # DB check
        try:
            backend._get_db().execute("SELECT 1").fetchone()
            checks["db"] = "ok"
        except Exception as e:
            checks["db"] = str(e)
        # Playbook root
        checks["playbooks"] = "ok" if os.path.isdir(backend.PLAYBOOK_ROOT) else "missing"
        # Jobs dir writable
        checks["writable"] = "ok" if os.access(backend.JOBS_ROOT, os.W_OK) else "read-only"

        ok = all(v == "ok" for v in checks.values())
        return jsonify({"status": "ok" if ok else "degraded", "checks": checks}), 200 if ok else 503

    # ─────────────────────────────────────────────────
    # Authentication
    # ─────────────────────────────────────────────────
    @app.route("/api/login", methods=["POST"])
    def api_login():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if not username or not password:
            return jsonify({"error": "Username and password required"}), 400
        if not backend.verify_user(username, password):
            return jsonify({"error": "Invalid credentials"}), 401
        session["user"] = username
        role = backend.get_user_role(username)
        session["role"] = role
        must_change = backend.get_must_change_password(username)
        return jsonify({"status": "ok", "user": username, "role": role, "mustChangePassword": must_change})

    @app.route("/api/logout", methods=["POST"])
    def api_logout():
        session.pop("user", None)
        session.pop("role", None)
        return jsonify({"status": "ok"})

    @app.route("/api/me")
    def api_me():
        user = session.get("user")
        if not user:
            return jsonify({"error": "Not authenticated"}), 401
        role = backend.get_user_role(user)
        must_change = backend.get_must_change_password(user)
        return jsonify({"user": user, "role": role, "mustChangePassword": must_change})

    @app.route("/api/me/password", methods=["PATCH"])
    @auth_required
    def api_change_own_password():
        data = request.get_json(silent=True) or {}
        current = data.get("currentPassword", "")
        new_pw = data.get("newPassword", "")
        backend.change_own_password(session["user"], current, new_pw)
        return jsonify({"status": "ok"})

    # ─────────────────────────────────────────────
    # Jobs
    # ─────────────────────────────────────────────
    @app.route("/api/jobs", methods=["GET"])
    @auth_required
    def api_list_jobs():
        return jsonify(backend.list_jobs())

    @app.route("/api/jobs", methods=["POST"])
    @auth_required
    def api_create_job():
        payload = backend.get_json_request()
        job = backend.create_job(payload, ip=_client_ip(), user=_current_user())
        return jsonify(job), 201

    @app.route("/api/jobs/<job_id>", methods=["GET"])
    @auth_required
    def api_get_job(job_id):
        job = backend.get_job(job_id)
        if not job:
            return jsonify({"error": "Job not found", "type": "JobNotFoundError"}), 404
        return jsonify(job)

    @app.route("/api/jobs/<job_id>", methods=["PATCH"])
    @auth_required
    def api_update_job(job_id):
        payload = backend.get_json_request()
        job = backend.update_job(job_id, payload)
        return jsonify(job)

    @app.route("/api/jobs/<job_id>", methods=["DELETE"])
    @admin_required
    def api_delete_job(job_id):
        result = backend.delete_job(job_id, ip=_client_ip(), user=_current_user())
        return jsonify(result)

    @app.route("/api/jobs/<job_id>/clone", methods=["POST"])
    @auth_required
    def api_clone_job(job_id):
        overrides = request.get_json(silent=True) or {}
        job = backend.clone_job(job_id, overrides=overrides)
        return jsonify(job), 201

    # ─────────────────────────────────────────────
    # File Uploads
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/files", methods=["POST"])
    @auth_required
    def api_upload_file(job_id):
        file_obj = backend.get_uploaded_file()          # werkzeug FileStorage
        role = backend.get_form_value("role")
        dest = backend.save_uploaded_file(job_id, file_obj, role)
        return jsonify({"status": "ok", "path": dest}), 201

    @app.route("/api/jobs/<job_id>/files/<role>/<filename>", methods=["DELETE"])
    @auth_required
    def api_delete_file(job_id, role, filename):
        result = backend.delete_uploaded_file(job_id, role, filename, ip=_client_ip(), user=_current_user())
        return jsonify(result)

    @app.route("/api/jobs/<job_id>/files/<role>/<filename>", methods=["GET"])
    @auth_required
    def api_download_file(job_id, role, filename):
        fpath = backend.get_file_path(job_id, role, filename)
        directory = os.path.dirname(fpath)
        fname = os.path.basename(fpath)
        return send_from_directory(directory, fname, as_attachment=True)

    @app.route("/api/jobs/<job_id>/files/<role>/<filename>", methods=["PUT"])
    @auth_required
    def api_update_file(job_id, role, filename):
        payload = backend.get_json_request()
        content = payload.get("content")
        if content is None:
            return jsonify({"error": "Missing content"}), 400
        fpath = backend.get_file_path(job_id, role, filename)
        with open(fpath, "w", newline="") as f:
            f.write(content)
        return jsonify({"status": "ok", "path": fpath})

    # ─────────────────────────────────────────────
    # Inventory
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/generate_inventory", methods=["POST"])
    @auth_required
    def api_generate_inventory(job_id):
        result = backend.generate_inventory_for_job(job_id)
        return jsonify(result)

    @app.route("/api/jobs/<job_id>/inventory_hosts", methods=["GET"])
    @auth_required
    def api_inventory_hosts(job_id):
        result = backend.parse_job_inventory(job_id)
        return jsonify(result)

    # ─────────────────────────────────────────────
    # Run Job
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/run", methods=["POST"])
    @auth_required
    def api_run_job(job_id):
        payload = backend.get_json_request()
        groups = payload.get("groups")
        if groups and isinstance(groups, list) and len(groups) >= 2:
            result = backend.run_job_groups(job_id, groups, ip=_client_ip(), user=_current_user())
            return jsonify(result), 202
        if groups and isinstance(groups, list) and len(groups) == 1:
            g = groups[0]
            tags = g.get("tags", [])
            hosts = g.get("hosts", "")
        else:
            tags = payload.get("tags", [])
            hosts = ""
        workflow_override = payload.get("workflowOverride", None)
        result = backend.run_job(job_id, tags, workflow_override=workflow_override, ip=_client_ip(), user=_current_user())
        return jsonify(result), 202

    # ─────────────────────────────────────────────
    # Logs
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/log")
    @auth_required
    def api_get_log(job_id):
        offset = request.args.get("offset", 0, type=int)
        group_id = request.args.get("group", None)
        return jsonify(backend.get_job_log(job_id, offset=offset, group_id=group_id))

    # ─────────────────────────────────────────────
    # Firmware
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/firmware", methods=["GET"])
    @auth_required
    def api_get_firmware(job_id):
        result = backend.get_job_firmware(job_id)
        return jsonify(result)

    @app.route("/api/jobs/<job_id>/generate_catalog", methods=["POST"])
    @auth_required
    def api_generate_catalog(job_id):
        result = backend.generate_catalog_for_job(job_id)
        return jsonify(result)

    # ─────────────────────────────────────────────
    # Stop Job
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/stop", methods=["POST"])
    @auth_required
    def api_stop_job(job_id):
        payload = request.get_json(silent=True) or {}
        group_id = payload.get("groupId") or None
        result = backend.stop_job(job_id, group_id=group_id, ip=_client_ip(), user=_current_user())
        return jsonify(result)

    # ─────────────────────────────────────────────
    # Download TSR (zip)
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/tsr", methods=["GET"])
    @auth_required
    def api_download_tsr(job_id):
        zip_path = backend.download_tsr_zip(job_id)
        directory = os.path.dirname(zip_path)
        fname = os.path.basename(zip_path)
        return send_from_directory(directory, fname, as_attachment=True)

    # ─────────────────────────────────────────────
    # TSR Status (per-serial analysis)
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/tsr_status", methods=["GET"])
    @auth_required
    def api_tsr_status(job_id):
        result = backend.get_tsr_status(job_id)
        return jsonify(result)

    # ─────────────────────────────────────────────
    # Delete TSR file
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/tsr/<filename>", methods=["DELETE"])
    @auth_required
    def api_delete_tsr_file(job_id, filename):
        result = backend.delete_tsr_file(job_id, filename, ip=_client_ip(), user=_current_user())
        return jsonify(result)

    # ─────────────────────────────────────────────
    # Download selected TSR files
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/tsr_selected", methods=["POST"])
    @auth_required
    def api_download_tsr_selected(job_id):
        payload = backend.get_json_request()
        filenames = payload.get("files", [])
        zip_path = backend.download_tsr_selected(job_id, filenames)
        directory = os.path.dirname(zip_path)
        fname = os.path.basename(zip_path)
        return send_from_directory(directory, fname, as_attachment=True)

    # ─────────────────────────────────────────────
    # Run History
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/runs", methods=["GET"])
    @auth_required
    def api_list_runs(job_id):
        result = backend.list_job_runs(job_id)
        return jsonify(result)

    @app.route("/api/jobs/<job_id>/runs/<run_id>/report", methods=["GET"])
    @auth_required
    def api_run_report(job_id, run_id):
        report_path = backend.generate_run_report(job_id, run_id)
        directory = os.path.dirname(report_path)
        fname = os.path.basename(report_path)
        return send_from_directory(directory, fname)

    # ─────────────────────────────────────────────
    # Job Output Files (PDU / Switches)
    # ─────────────────────────────────────────────
    @app.route("/api/jobs/<job_id>/outputs/<output_type>", methods=["GET"])
    @auth_required
    def api_job_outputs(job_id, output_type):
        result = backend.list_job_outputs(job_id, output_type)
        return jsonify(result)

    @app.route("/api/jobs/<job_id>/download_output", methods=["GET"])
    @auth_required
    def api_download_output(job_id):
        fpath = request.args.get("path", "")
        result = backend.validate_output_path(job_id, fpath)
        directory = os.path.dirname(result)
        fname = os.path.basename(result)
        return send_from_directory(directory, fname, as_attachment=True)

    @app.route("/api/jobs/<job_id>/download_outputs", methods=["POST"])
    @auth_required
    def api_download_selected_outputs(job_id):
        payload = backend.get_json_request()
        paths = payload.get("paths", [])
        zip_path = backend.download_selected_outputs(job_id, paths)
        directory = os.path.dirname(zip_path)
        fname = os.path.basename(zip_path)
        return send_from_directory(directory, fname, as_attachment=True)

    # ─────────────────────────────────────────────────
    # Dashboard Stats
    # ─────────────────────────────────────────────────
    @app.route("/api/dashboard/stats")
    @auth_required
    def api_dashboard_stats():
        return jsonify(backend.get_dashboard_stats())

    # ─────────────────────────────────────────────────
    # Templates
    # ─────────────────────────────────────────────────
    @app.route("/api/templates", methods=["GET"])
    @auth_required
    def api_list_templates():
        return jsonify(backend.list_templates())

    @app.route("/api/templates", methods=["POST"])
    @auth_required
    def api_save_template():
        payload = backend.get_json_request()
        job_id = payload.get("jobId", "")
        name = payload.get("templateName", "")
        template = backend.save_as_template(job_id, name)
        return jsonify(template), 201

    @app.route("/api/templates/<template_id>", methods=["DELETE"])
    @admin_required
    def api_delete_template(template_id):
        return jsonify(backend.delete_template(template_id))

    @app.route("/api/templates/<template_id>/create", methods=["POST"])
    @auth_required
    def api_create_from_template(template_id):
        payload = backend.get_json_request()
        job_name = payload.get("jobName", "")
        rack_id = payload.get("rackId", "")
        job = backend.create_from_template(template_id, job_name, rack_id)
        return jsonify(job), 201

    # ─────────────────────────────────────────────────
    # Public Config (auth_required — for job creation)
    # ─────────────────────────────────────────────────
    @app.route("/api/config/customers", methods=["GET"])
    @auth_required
    def api_config_customers():
        return jsonify(backend.list_customers())

    @app.route("/api/config/workflows", methods=["GET"])
    @auth_required
    def api_config_workflows():
        return jsonify(backend.list_workflows_public())

    # ─────────────────────────────────────────────────
    # Admin — User Management
    # ─────────────────────────────────────────────────
    @app.route("/api/admin/users", methods=["GET"])
    @admin_required
    def api_admin_list_users():
        return jsonify(backend.list_users())

    @app.route("/api/admin/users", methods=["POST"])
    @admin_required
    def api_admin_create_user():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        role = data.get("role", "user")
        fullName = (data.get("fullName") or "").strip()
        badgeNumber = (data.get("badgeNumber") or "").strip()
        if not username or not password:
            return jsonify({"error": "Username and password required"}), 400
        if role not in ("admin", "user"):
            return jsonify({"error": "Role must be 'admin' or 'user'"}), 400
        backend.add_user(username, password, role, fullName, badgeNumber)
        backend._audit_log("ADMIN_CREATE_USER", detail=f"username={username} role={role}", user=_current_user(), ip=_client_ip())
        return jsonify({"status": "ok", "username": username}), 201

    @app.route("/api/admin/users/<username>", methods=["DELETE"])
    @admin_required
    def api_admin_delete_user(username):
        if username == session.get("user"):
            return jsonify({"error": "Cannot delete your own account"}), 400
        if not backend.remove_user(username):
            return jsonify({"error": "User not found"}), 404
        backend._audit_log("ADMIN_DELETE_USER", detail=f"username={username}", user=_current_user(), ip=_client_ip())
        return jsonify({"status": "deleted", "username": username})

    @app.route("/api/admin/users/<username>/role", methods=["PATCH"])
    @admin_required
    def api_admin_update_role(username):
        data = request.get_json(silent=True) or {}
        role = data.get("role", "")
        backend.update_user_role(username, role)
        backend._audit_log("ADMIN_CHANGE_ROLE", detail=f"username={username} role={role}", user=_current_user(), ip=_client_ip())
        return jsonify({"status": "ok", "username": username, "role": role})

    @app.route("/api/admin/users/<username>/password", methods=["PATCH"])
    @admin_required
    def api_admin_reset_password(username):
        data = request.get_json(silent=True) or {}
        password = data.get("password", "")
        backend.reset_user_password(username, password)
        backend._audit_log("ADMIN_RESET_PW", detail=f"username={username}", user=_current_user(), ip=_client_ip())
        return jsonify({"status": "ok", "username": username})

    # ─────────────────────────────────────────────────
    # Admin — Customer Management
    # ─────────────────────────────────────────────────
    @app.route("/api/admin/customers", methods=["GET"])
    @admin_required
    def api_admin_list_customers():
        return jsonify(backend.list_customers())

    @app.route("/api/admin/customers/<cust_id>", methods=["PUT"])
    @admin_required
    def api_admin_save_customer(cust_id):
        data = request.get_json(silent=True) or {}
        result = backend.save_customer(cust_id, data)
        backend._audit_log("ADMIN_SAVE_CUSTOMER", detail=f"id={cust_id} label={data.get('label','')}", user=_current_user(), ip=_client_ip())
        return jsonify(result)

    @app.route("/api/admin/customers/<cust_id>", methods=["DELETE"])
    @admin_required
    def api_admin_delete_customer(cust_id):
        result = backend.delete_customer(cust_id)
        backend._audit_log("ADMIN_DELETE_CUSTOMER", detail=f"id={cust_id}", user=_current_user(), ip=_client_ip())
        return jsonify(result)

    # ─────────────────────────────────────────────────
    # Admin — Workflow Management
    # ─────────────────────────────────────────────────
    @app.route("/api/admin/workflows", methods=["GET"])
    @admin_required
    def api_admin_list_workflows():
        return jsonify(backend.list_workflows_config())

    @app.route("/api/admin/workflows/<wf_id>", methods=["PUT"])
    @admin_required
    def api_admin_save_workflow(wf_id):
        data = request.get_json(silent=True) or {}
        result = backend.save_workflow(wf_id, data)
        backend._audit_log("ADMIN_SAVE_WORKFLOW", detail=f"id={wf_id} label={data.get('label','')}", user=_current_user(), ip=_client_ip())
        return jsonify(result)

    @app.route("/api/admin/workflows/<wf_id>", methods=["DELETE"])
    @admin_required
    def api_admin_delete_workflow(wf_id):
        result = backend.delete_workflow(wf_id)
        backend._audit_log("ADMIN_DELETE_WORKFLOW", detail=f"id={wf_id}", user=_current_user(), ip=_client_ip())
        return jsonify(result)

    # ─────────────────────────────────────────────────
    # Admin — Stats
    # ─────────────────────────────────────────────────
    @app.route("/api/admin/stats", methods=["GET"])
    @admin_required
    def api_admin_stats():
        return jsonify(backend.get_admin_stats())

    # ─────────────────────────────────────────────────
    # Admin — Audit Log
    # ─────────────────────────────────────────────────
    @app.route("/api/admin/audit", methods=["GET"])
    @admin_required
    def api_admin_audit():
        limit = request.args.get("limit", 50, type=int)
        offset = request.args.get("offset", 0, type=int)
        action_filter = request.args.get("action", None)
        return jsonify(backend.read_audit_log(limit=limit, offset=offset, action_filter=action_filter))

    @app.route("/api/admin/audit/export", methods=["GET"])
    @admin_required
    def api_admin_audit_export():
        action_filter = request.args.get("action", None)
        csv_text = backend.export_audit_csv(action_filter=action_filter)
        from flask import Response
        return Response(csv_text, mimetype="text/csv",
                        headers={"Content-Disposition": "attachment; filename=audit_log.csv"})

    # ─────────────────────────────────────────────
    # Response compression + static cache headers
    # ─────────────────────────────────────────────
    @app.after_request
    def _optimize_response(response):
        path = request.path

        # Static asset cache headers
        if path.startswith("/static/"):
            response.headers["Cache-Control"] = "public, max-age=86400"

        # Gzip compression for JSON/text responses over 1KB
        if (response.status_code == 200
                and not response.direct_passthrough
                and "gzip" in request.headers.get("Accept-Encoding", "")
                and response.content_type
                and ("json" in response.content_type or "text" in response.content_type or "javascript" in response.content_type)
                and response.content_length is not None
                and response.content_length > 1024):
            data = response.get_data()
            compressed = gzip.compress(data, compresslevel=6)
            if len(compressed) < len(data):
                response.set_data(compressed)
                response.headers["Content-Encoding"] = "gzip"
                response.headers["Content-Length"] = str(len(compressed))

        return response

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
