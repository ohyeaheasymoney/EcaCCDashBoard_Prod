// ─────────────────────────────────────────────────────────────
// dashboard.js — Job list, dashboard KPIs, health polling
// ─────────────────────────────────────────────────────────────

// Connection state (shared with job-panel.js)
let _connectionLost = false;
let _reconnectAttempts = 0;

// ─── Centralized Poll Manager (Issue #8) ───
const _pollManager = {
  _timers: {},
  start(name, fn, ms) {
    this.stop(name);
    this._timers[name] = setInterval(fn, ms);
  },
  startOnce(name, fn, ms) {
    this.stop(name);
    this._timers[name] = setTimeout(() => { delete this._timers[name]; fn(); }, ms);
  },
  stop(name) {
    if (this._timers[name]) {
      clearInterval(this._timers[name]);
      clearTimeout(this._timers[name]);
      delete this._timers[name];
    }
  },
  stopAll() {
    Object.keys(this._timers).forEach(n => this.stop(n));
  },
};
// Stop all polls on page unload / tab switch
window.addEventListener("beforeunload", () => _pollManager.stopAll());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) _pollManager.stopAll();
});

var _retryCountdownTimer = null;

function showConnectionBanner(lost) {
  let banner = $("connection-banner");
  if (lost) {
    if (_retryCountdownTimer) { clearInterval(_retryCountdownTimer); _retryCountdownTimer = null; }
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "connection-banner";
      document.body.appendChild(banner);
    }
    banner.className = "connection-banner connection-lost";
    banner.style.display = "block";

    let countdown = 15;
    banner.innerHTML = 'Connection lost &mdash; retrying in <span class="retry-countdown">' + countdown + 's</span>';
    _retryCountdownTimer = setInterval(() => {
      countdown--;
      const span = banner.querySelector(".retry-countdown");
      if (span) span.textContent = countdown + "s";
      if (countdown <= 0) {
        clearInterval(_retryCountdownTimer);
        _retryCountdownTimer = null;
        banner.innerHTML = 'Connection lost &mdash; retrying now...';
      }
    }, 1000);

    // (#12) Disable panel close button during disconnect
    const closeBtn = qs(".job-panel .panel-header .modal-close");
    if (closeBtn) { closeBtn.disabled = true; closeBtn.title = "Reconnecting..."; }
  } else {
    if (_retryCountdownTimer) { clearInterval(_retryCountdownTimer); _retryCountdownTimer = null; }
    if (banner) {
      banner.className = "connection-banner connection-ok";
      banner.innerHTML = "Reconnected";
      banner.style.display = "block";
      setTimeout(() => { if (banner) banner.style.display = "none"; }, 3000);
    }
    // (#12) Re-enable panel close button
    const closeBtn = qs(".job-panel .panel-header .modal-close");
    if (closeBtn) { closeBtn.disabled = false; closeBtn.title = ""; }
  }
}

const debouncedSearchJobs = debounce(function (val) {
  saveFilterState();
  renderJobsFiltered(val, window._activeJobFilter || "all");
}, 300);

window.debouncedSearchJobs = debouncedSearchJobs;
window._activeJobFilter = "all";
window._sortCol = "created";
window._sortDir = "desc";
window._workflowFilter = "all";
window._customerFilter = "all";

// ─── Filter Persistence (Feature 6) ───
function saveFilterState() {
  try {
    const searchInput = $("job-search-input");
    const dateFrom = $("job-date-from");
    const dateTo = $("job-date-to");
    const state = {
      status: window._activeJobFilter || "all",
      sortCol: window._sortCol || "created",
      sortDir: window._sortDir || "desc",
      text: searchInput ? searchInput.value : "",
      dateFrom: dateFrom ? dateFrom.value : "",
      dateTo: dateTo ? dateTo.value : "",
      workflow: window._workflowFilter || "all",
      customer: window._customerFilter || "all",
    };
    localStorage.setItem("eca_job_filters", JSON.stringify(state));
  } catch { /* localStorage may be full */ }
}

function loadFilterState() {
  try {
    const raw = localStorage.getItem("eca_job_filters");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// Favorites (localStorage)
// ─────────────────────────────────────────────────────────────
window._favorites = JSON.parse(localStorage.getItem("eca_favorites") || "[]");

window.toggleFavorite = function (jobId) {
  const idx = window._favorites.indexOf(jobId);
  if (idx >= 0) {
    window._favorites.splice(idx, 1);
  } else {
    window._favorites.push(jobId);
  }
  localStorage.setItem("eca_favorites", JSON.stringify(window._favorites));
  loadJobs();
};

function isFavorite(jobId) {
  return window._favorites.includes(jobId);
}

// ─────────────────────────────────────────────────────────────
// Styled Confirm Modal (replaces browser confirm)
// ─────────────────────────────────────────────────────────────
window.showConfirm = function (message, onConfirm, options = {}) {
  const container = $("confirm-modal-container");
  if (!container) { if (confirm(message)) onConfirm(); return; }

  const title = options.title || "Confirm";
  const confirmText = options.confirmText || "Confirm";
  const cancelText = options.cancelText || "Cancel";
  const danger = options.danger || false;
  const onCancel = options.onCancel || null;

  container.innerHTML = `
    <div class="confirm-overlay" id="confirm-overlay" role="dialog" aria-modal="true">
      <div class="confirm-card">
        <div class="confirm-title">${safeText(title)}</div>
        <div class="confirm-message">${options.html ? message : safeText(message)}</div>
        <div class="confirm-actions">
          <button class="btn ghost" id="confirm-cancel">${cancelText}</button>
          <button class="btn ${danger ? "danger" : "primary"}" id="confirm-ok">${confirmText}</button>
        </div>
      </div>
    </div>
  `;

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    const overlay = $("confirm-overlay");
    if (overlay) {
      overlay.classList.add("closing");
      const clear = () => { container.innerHTML = ""; };
      overlay.addEventListener("animationend", clear, { once: true });
      setTimeout(clear, 300);
    } else container.innerHTML = "";
  };
  $("confirm-cancel").addEventListener("click", () => { dismiss(); if (onCancel) onCancel(); });
  $("confirm-overlay").addEventListener("click", (e) => { if (e.target.id === "confirm-overlay") { dismiss(); if (onCancel) onCancel(); } });
  $("confirm-ok").addEventListener("click", () => { dismiss(); onConfirm(); });
};

// Promise-based wrapper for use in async flows
window.showConfirmAsync = function (message, options = {}) {
  return new Promise((resolve) => {
    showConfirm(message, () => resolve(true), { ...options, onCancel: () => resolve(false) });
  });
};

// ─────────────────────────────────────────────────────────────
// Nav Badges
// ─────────────────────────────────────────────────────────────
function updateNavBadges(jobs) {
  const badge = $("nav-badge-jobs");
  if (!badge) return;
  const running = jobs.filter(j => j.status === "running").length;
  if (running > 0) {
    badge.textContent = running;
    badge.className = "nav-badge";
    badge.style.display = "inline-flex";
  } else if (jobs.length > 0) {
    badge.textContent = jobs.length;
    badge.className = "nav-badge-total";
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

// ─────────────────────────────────────────────────────────────
// Export Jobs to CSV
// ─────────────────────────────────────────────────────────────
window.exportJobsCSV = function () {
  const jobs = window._allJobs || [];
  if (!jobs.length) { showToast("No jobs to export", "info"); return; }

  const headers = ["Job Name", "Workflow", "Project", "Rack ID", "SKU", "P.O.", "Hosts", "Status", "Last Result", "Created"];
  const wfLabels = window.WORKFLOW_LABELS || {};
  const rows = jobs.map(j => [
    j.jobName || j.name || "",
    wfLabels[(j.workflow || "").toLowerCase()] || j.workflow || "",
    j.customer || "",
    j.rackId || "",
    j.sku || "",
    j.po || "",
    j.hostCount || 0,
    j.status || "",
    j.lastRunResult || "",
    j.createdAt || "",
  ]);

  let csv = headers.join(",") + "\n";
  rows.forEach(row => {
    csv += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",") + "\n";
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `eca-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Jobs exported to CSV", "success");
};


// ─────────────────────────────────────────────────────────────
// Ops Banner (greeting + live status)
// ─────────────────────────────────────────────────────────────
// Static idle status message
const _idleQuip = "All systems operational";

function renderOpsBanner(jobs) {
  const banner = $("ops-banner");
  if (!banner) return;

  const running = jobs.filter(j => j.status === "running").length;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = jobs.filter(j => j.createdAt && new Date(j.createdAt) >= todayStart).length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const statusText = running > 0
    ? `${running} job${running > 1 ? "s" : ""} running`
    : _idleQuip;

  let statsHtml = "";
  if (running > 0) statsHtml += `<span class="ops-stat">${running} running</span>`;
  statsHtml += `<span class="ops-stat">${todayCount} today</span>`;
  statsHtml += `<span class="ops-stat">${jobs.length} total</span>`;

  banner.className = running > 0 ? "ops-banner ops-banner-active" : "ops-banner";
  // Time-of-day icon: sun 6am–5pm, moon 6pm–5am (idle only; pulse dot when running)
  const isDaytime = hour >= 6 && hour < 18;
  const todIcon = isDaytime
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  // Running → keep the pulse dot for visibility; idle → show sun/moon icon
  const iconHtml = running > 0
    ? '<div class="ops-pulse"></div>'
    : `<div class="ops-tod-icon">${todIcon}</div>`;

  banner.innerHTML = `
    <div class="ops-banner-left">
      ${iconHtml}
      <div>
        <div class="ops-banner-text">${greeting}</div>
        <div class="ops-stat" style="margin-top:2px;">${statusText}</div>
      </div>
    </div>
    <div class="ops-banner-right">${statsHtml}</div>
  `;
}

// ─────────────────────────────────────────────────────────────
// KPI Summary Cards (clickable, 4 cards)
// ─────────────────────────────────────────────────────────────
function renderDashboardKPIs(jobs) {
  const grid = $("kpi-grid");
  if (!grid) return;

  const total = jobs.length;
  const running = jobs.filter(j => j.status === "running").length;
  const completed = jobs.filter(j => j.status === "completed").length;
  const failed = jobs.filter(j => j.lastRunResult === "failed" || j.status === "failed").length;
  const saved = jobs.filter(j => j.status === "saved").length;
  const successRate = total > 0 ? Math.round(((completed) / total) * 100) : 0;

  grid.innerHTML = `
    <div class="kpi-card kpi-card-clickable kpi-card-blue" tabindex="0" onclick="navigateToJobs('running')" title="View active jobs">
      <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg></div>
      <div class="kpi-label">Active Jobs</div>
      <div class="kpi-value" style="color:#60a5fa;">${running}</div>
      <div class="kpi-sub">${saved} ready to run</div>
    </div>
    <div class="kpi-card kpi-card-clickable kpi-card-green" tabindex="0" onclick="navigateToJobs('completed')" title="View completed jobs">
      <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <div class="kpi-label">Completed</div>
      <div class="kpi-value" style="color:#4ade80;">${completed}</div>
      <div class="kpi-sub">${successRate}% success rate</div>
    </div>
    <div class="kpi-card kpi-card-clickable kpi-card-red" tabindex="0" onclick="navigateToJobs('failed')" title="View failed jobs">
      <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div class="kpi-label">Failed</div>
      <div class="kpi-value" style="color:#f87171;">${failed}</div>
      <div class="kpi-sub">${failed > 0 ? "Needs attention" : "All clear"}</div>
    </div>
    <div class="kpi-card kpi-card-clickable kpi-card-default" tabindex="0" onclick="navigateToJobs('all')" title="View all jobs">
      <div class="kpi-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
      <div class="kpi-label">Total Jobs</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-sub">${saved} saved &bull; ${running} active</div>
    </div>
  `;
}

// Navigate to Jobs page with optional filter
window.navigateToJobs = function (filter) {
  const jobsNav = qs('[data-page="jobs"]');
  if (jobsNav) jobsNav.click();
  setTimeout(() => {
    window._activeJobFilter = filter || "all";
    const filterBtn = qs(`.filter-tab[data-filter="${filter}"]`);
    if (filterBtn) filterBtn.click();
  }, 100);
};

// ─────────────────────────────────────────────────────────────
// Dashboard job row — card-style row
// ─────────────────────────────────────────────────────────────
window._dashProgress = {};

function buildDashJobCard(job) {
  const jobId = job.jobId || job.id || job.job_id;
  const jobName = safeText(job.jobName || job.name || "(unnamed)");
  const workflow = (job.workflow || "").toLowerCase();
  const wfLabel = safeText((window.WORKFLOW_LABELS && window.WORKFLOW_LABELS[workflow]) || workflow || "\u2014");
  const hostCount = job.hostCount || 0;
  const createdAgo = job.createdAt ? timeAgo(job.createdAt) : "\u2014";
  const status = (job.status || "saved").toLowerCase();
  const customer = (job.customer || "").toLowerCase();
  const custDef = (window.CUSTOMER_DEFINITIONS || {})[customer];
  const custLabel = custDef ? custDef.label : "";
  const wfIcon = _wfCategoryIcon(workflow, 11);

  let progressHtml = "";
  if (status === "running") {
    const prog = window._dashProgress[jobId];
    const pct = prog && prog.pct > 0 ? prog.pct : 0;
    const taskName = prog && prog.lastTask ? prog.lastTask : "";
    const elapsed = prog && prog.elapsed ? prog.elapsed : "";
    const fillClass = pct > 0 ? "" : " inline-progress-indeterminate";

    // Running tags pills (Feature 7)
    let tagsHtml = "";
    const tags = job.lastRunTags || [];
    if (tags.length) {
      tagsHtml = `<div class="dash-running-tags">${tags.map(t =>
        `<span class="dash-tag-pill">${safeText(t)}</span>`
      ).join("")}</div>`;
    }

    // Elapsed + task name
    const taskDisplay = (elapsed ? elapsed + " — " : "") + safeText(taskName || (pct > 0 ? pct + "%" : "Running..."));

    progressHtml = `<div class="job-row-progress" id="dash-prog-${safeText(jobId)}">
      ${tagsHtml}
      <div class="inline-progress"><div class="inline-progress-fill${fillClass}" style="width:${pct}%"></div></div>
      <div class="dash-task-name">${taskDisplay}</div>
    </div>`;
  }

  const custBadge = custLabel ? `<span class="dash-customer-badge">${safeText(custLabel)}</span>` : "";
  const hostChip = hostCount
    ? `<span class="dash-host-chip">${hostCount} hosts</span>`
    : `<span class="muted" style="font-size:11px;">No hosts</span>`;

  return `<div class="job-row-card job-row-card-${status}" data-jobid="${safeText(jobId)}">
    <div class="job-row-content">
      <div class="job-row-top">
        <span class="status-dot status-dot-${status}" title="${status}"></span>
        <span class="job-row-name">${jobName}</span>
        ${custBadge}
        ${statusBadge(status, job.updatedAt || job.createdAt)}
      </div>
      <div class="job-row-meta">
        ${wfIcon}<span>${wfLabel}</span>
        <span class="meta-dot"></span>
        ${hostChip}
        <span class="meta-dot"></span>
        <span>${safeText(createdAgo)}</span>
      </div>
      ${progressHtml}
    </div>
    <div class="job-row-actions">
      <button class="btn ghost" data-jobid="${safeText(jobId)}">View</button>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────
// Running-job dashboard poll (lightweight progress updates)
// ─────────────────────────────────────────────────────────────
async function pollRunningDashboard() {
  const jobs = window._allJobs || [];
  const running = jobs.filter(j => j.status === "running");

  if (!running.length) {
    _pollManager.stop("dashProgress");
    return;
  }

  // Fetch all running job logs in parallel instead of sequentially
  await Promise.all(running.map(async (job) => {
    const jobId = job.jobId || job.id || job.job_id;
    try {
      const log = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/log`);
      let txt = "";
      if (typeof log === "string") txt = log;
      else if (log && log.log) txt = log.log;
      else if (log && log.text) txt = log.text;
      else txt = "";

      const cleanTxt = stripAnsi(txt);
      const progress = parseLogForProgress(cleanTxt);

      const taskCount = progress.taskCount || 0;
      const completed = progress.completedTasks || 0;
      const pct = taskCount > 0 ? Math.round((completed / taskCount) * 100) : 0;

      // Elapsed from first TASK line
      const startMatch = cleanTxt.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/m);
      let elapsed = "";
      if (startMatch) {
        const startTime = new Date(startMatch[1]);
        const secs = Math.round((Date.now() - startTime.getTime()) / 1000);
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        elapsed = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }

      window._dashProgress[jobId] = {
        lastTask: progress.lastTask || "Running...",
        pct, taskCount, completed, elapsed,
      };

      // Update inline progress bar for running jobs
      const progEl = $(`dash-prog-${jobId}`);
      if (progEl) {
        const fill = progEl.querySelector('.inline-progress-fill');
        if (fill) {
          fill.style.width = pct + '%';
          fill.classList.toggle('inline-progress-indeterminate', pct === 0);
        }
        const taskEl = progEl.querySelector('.dash-task-name');
        if (taskEl) taskEl.textContent = (elapsed ? elapsed + " — " : "") + (progress.lastTask || (pct > 0 ? pct + '%' : 'Running...'));
      }
    } catch {
      // silent — job may have finished
    }
  }));

  _pollManager.startOnce("dashProgress", pollRunningDashboard, 5000);
}

// ─────────────────────────────────────────────────────────────
// Load and render jobs
// ─────────────────────────────────────────────────────────────
async function loadJobs() {
  const jobsTable = $("jobs-table");
  const savedList = $("saved-jobs-list");

  if (!jobsTable && !savedList) return;

  if (jobsTable) jobsTable.innerHTML = skeletonRows(3);
  if (savedList) savedList.innerHTML = skeletonRows(3);

  try {
    const jobs = await apiGet("/api/jobs");
    window._allJobs = jobs;

    // Render KPIs + nav badges + ops banner
    if (Array.isArray(jobs)) {
      renderOpsBanner(jobs);
      renderDashboardKPIs(jobs);
      updateNavBadges(jobs);
    }

    // Jobs table (full list page)
    if (jobsTable) {
      if (!Array.isArray(jobs) || jobs.length === 0) {
        jobsTable.innerHTML = `<p class="muted">No jobs yet. Create your first job.</p>`;
      } else {
        const running = jobs.filter(j => j.status === "running").length;
        const completed = jobs.filter(j => j.status === "completed").length;
        const failed = jobs.filter(j => j.lastRunResult === "failed" || j.status === "failed").length;
        const saved = jobs.filter(j => j.status === "saved").length;

        jobsTable.innerHTML = `
          <div class="filter-tabs" id="job-filter-tabs">
            <button class="filter-tab active" data-filter="all" onclick="setJobFilter('all')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>All <span class="filter-count">${jobs.length}</span></button>
            <button class="filter-tab" data-filter="running" onclick="setJobFilter('running')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Running <span class="filter-count">${running}</span></button>
            <button class="filter-tab" data-filter="completed" onclick="setJobFilter('completed')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><polyline points="20 6 9 17 4 12"/></svg>Completed <span class="filter-count">${completed}</span></button>
            <button class="filter-tab" data-filter="failed" onclick="setJobFilter('failed')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Failed <span class="filter-count">${failed}</span></button>
            <button class="filter-tab" data-filter="saved" onclick="setJobFilter('saved')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>Ready <span class="filter-count">${saved}</span></button>
          </div>
          <div class="jobs-toolbar jobs-toolbar-row1">
            <div style="position:relative;flex:1;max-width:300px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:0.4;pointer-events:none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="job-search-input" class="inp" placeholder="Search by name, rack ID, workflow, or SKU..."
                aria-label="Search jobs"
                style="width:100%;padding-left:32px;"
                oninput="debouncedSearchJobs(this.value)" />
            </div>
            <div class="filter-preset-container" id="filter-preset-container"></div>
            <button class="btn-secondary" onclick="launchWizard()" style="margin-left:auto;white-space:nowrap;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>New Job</button>
          </div>
          <div class="jobs-toolbar jobs-toolbar-row2">
            <select id="job-workflow-filter" class="inp filter-select" onchange="window._workflowFilter=this.value;saveFilterState();applyDateFilter()">
              <option value="all">All Workflows</option>
              ${_WORKFLOWS_STANDARD.map(w => `<option value="${w.value}">${w.label}</option>`).join("")}
            </select>
            <select id="job-customer-filter" class="inp filter-select" onchange="window._customerFilter=this.value;saveFilterState();applyDateFilter()">
              <option value="all">All Customers</option>
              ${Object.entries(CUSTOMER_DEFINITIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}
            </select>
            <input type="date" id="job-date-from" class="inp" style="max-width:140px;font-size:12px;" title="From date" onchange="applyDateFilter()" />
            <input type="date" id="job-date-to" class="inp" style="max-width:140px;font-size:12px;" title="To date" onchange="applyDateFilter()" />
            <div class="bulk-actions" id="bulk-actions" style="display:none;">
              <span class="muted" id="bulk-count">0 selected</span>
              <button class="btn ghost" style="color:#4ade80;border-color:rgba(74,222,128,0.3);" onclick="bulkRunJobs()" title="Run selected jobs with workflow choice">Run</button>
              <button class="btn ghost" style="color:#fbbf24;border-color:rgba(251,191,36,0.3);" onclick="bulkStopJobs()" title="Stop all selected running jobs">Stop</button>
              <button class="btn ghost" onclick="bulkCloneJobs()" title="Duplicate selected jobs with the same files and settings">Clone</button>
              <button class="btn ghost" style="color:#f87171;border-color:rgba(248,113,113,0.3);" onclick="bulkDeleteJobs()" title="Permanently delete selected jobs and all their data">Delete</button>
            </div>
          </div>
          <div class="jobs-sort-row">
            <label class="muted" style="font-size:12px;margin-right:4px;">Sort:</label>
            <select id="job-sort-select" class="inp filter-select" style="max-width:150px;font-size:12px;" onchange="window._sortCol=this.value;saveFilterState();applyDateFilter()">
              <option value="created"${window._sortCol === 'created' ? ' selected' : ''}>Created</option>
              <option value="name"${window._sortCol === 'name' ? ' selected' : ''}>Name</option>
              <option value="workflow"${window._sortCol === 'workflow' ? ' selected' : ''}>Workflow</option>
              <option value="hosts"${window._sortCol === 'hosts' ? ' selected' : ''}>Hosts</option>
            </select>
            <button class="btn ghost" style="padding:4px 8px;font-size:12px;" onclick="window._sortDir=window._sortDir==='asc'?'desc':'asc';saveFilterState();applyDateFilter()" title="Toggle sort direction" id="sort-dir-btn">${window._sortDir === 'asc' ? '\u25B2 Asc' : '\u25BC Desc'}</button>
            <span style="flex:1;"></span>
            <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;" class="muted"><input type="checkbox" id="bulk-select-all" onchange="toggleBulkSelectAll(this.checked)" style="margin:0;" /> Select all</label>
          </div>
          <div id="job-card-list" class="job-card-list"></div>
          <div class="jobs-table-footer" id="jobs-table-footer"></div>
        `;
        // Restore saved filter state (Feature 6)
        const savedFilters = loadFilterState();
        if (savedFilters) {
          window._activeJobFilter = savedFilters.status || "all";
          window._sortCol = savedFilters.sortCol || "created";
          window._sortDir = savedFilters.sortDir || "desc";
          window._workflowFilter = savedFilters.workflow || "all";
          window._customerFilter = savedFilters.customer || "all";

          const searchInput = $("job-search-input");
          if (searchInput && savedFilters.text) searchInput.value = savedFilters.text;
          const dateFrom = $("job-date-from");
          if (dateFrom && savedFilters.dateFrom) dateFrom.value = savedFilters.dateFrom;
          const dateTo = $("job-date-to");
          if (dateTo && savedFilters.dateTo) dateTo.value = savedFilters.dateTo;
          const wfSelect = $("job-workflow-filter");
          if (wfSelect && savedFilters.workflow) wfSelect.value = savedFilters.workflow;
          const custSelect = $("job-customer-filter");
          if (custSelect && savedFilters.customer) custSelect.value = savedFilters.customer;

          qsa(".filter-tab").forEach(t => t.classList.toggle("active", t.dataset.filter === window._activeJobFilter));
        }

        renderJobsFiltered(
          savedFilters ? (savedFilters.text || "") : "",
          window._activeJobFilter || "all"
        );
        _renderPresetDropdown();
      }
    }

    // Dashboard recent jobs (card rows)
    if (savedList) {
      if (!Array.isArray(jobs) || jobs.length === 0) {
        savedList.innerHTML = `
          <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.25;margin-bottom:10px;"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            <div style="font-size:14px;font-weight:600;margin-bottom:4px;">No jobs yet</div>
            <div class="muted" style="margin-bottom:12px;">Create your first job to get started with automation.</div>
            <button class="btn primary" onclick="launchWizard()">New Job</button>
          </div>`;
      } else {
        const DASH_LIMIT = 10;
        const hasMore = jobs.length > DASH_LIMIT;

        // New Job quick-action button at top of list
        const newJobBtn = `<div class="dash-new-job-row"><button class="btn ghost dash-new-job-btn" onclick="launchWizard()"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>New Job</button></div>`;

        savedList.innerHTML = newJobBtn + jobs.map((job, i) => {
          const extra = hasMore && i >= DASH_LIMIT ? ' style="display:none;"' : "";
          return `<div class="dash-job-wrapper"${extra}>${buildDashJobCard(job)}</div>`;
        }).join("");

        if (hasMore) {
          savedList.innerHTML += `<button class="btn ghost" id="dash-see-more-jobs" style="margin-top:8px;font-size:12px;width:100%;text-align:center;">See more (${jobs.length - DASH_LIMIT} more)</button>`;
          const seeMoreBtn = document.getElementById("dash-see-more-jobs");
          if (seeMoreBtn) {
            seeMoreBtn.addEventListener("click", () => {
              const extras = qsa('.dash-job-wrapper[style*="display:none"]', savedList);
              const showing = extras.length === 0;
              qsa('.dash-job-wrapper', savedList).forEach((el, i) => {
                el.style.display = (showing && i >= DASH_LIMIT) ? "none" : "";
              });
              seeMoreBtn.textContent = showing ? `See more (${jobs.length - DASH_LIMIT} more)` : "Show less";
            });
          }
        }

        // Wire click handlers on entire card row
        qsa('.job-row-card[data-jobid]', savedList).forEach(card => {
          card.addEventListener("click", (e) => {
            if (e.target.closest("button")) return;
            openJobPanel(card.getAttribute("data-jobid"));
          });
        });

        // Wire View buttons
        qsa('button[data-jobid]', savedList).forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openJobPanel(btn.getAttribute("data-jobid"));
          });
        });
      }
    }

    // Start running-job polling if any jobs are running
    const hasRunning = Array.isArray(jobs) && jobs.some(j => j.status === "running");
    if (hasRunning) {
      _pollManager.startOnce("dashProgress", pollRunningDashboard, 2000);
    }

    // Onboarding guide (Feature 11) — trigger on first visit
    if (!localStorage.getItem("eca_onboarded")) {
      setTimeout(() => { if (typeof showOnboardingGuide === "function") showOnboardingGuide(); }, 500);
    }

  } catch (e) {
    const msg = `<p class="error">Error loading jobs: ${safeText(e.message)}</p>`;
    if (jobsTable) jobsTable.innerHTML = msg;
    if (savedList) savedList.innerHTML = msg;
  }
}

// ─────────────────────────────────────────────────────────────
// Jobs table (filtered view)
// ─────────────────────────────────────────────────────────────
window.setJobFilter = function (filter) {
  window._activeJobFilter = filter;
  qsa(".filter-tab").forEach(t => t.classList.toggle("active", t.dataset.filter === filter));
  const searchInput = $("job-search-input");
  const q = searchInput ? searchInput.value : "";
  saveFilterState();
  renderJobsFiltered(q, filter);
};

window.applyDateFilter = function () {
  const searchInput = $("job-search-input");
  const q = searchInput ? searchInput.value : "";
  saveFilterState();
  renderJobsFiltered(q, window._activeJobFilter || "all");
};

// ─── Job Card Helpers (Issue #9: DOM reconciliation) ───
function _buildJobCardHtml(job) {
  const jobId = job.jobId || job.id || job.job_id;
  const jobName = safeText(job.jobName || job.name || "(unnamed)");
  const workflow = (job.workflow || "").toLowerCase();
  const wfLabel = safeText((window.WORKFLOW_LABELS && window.WORKFLOW_LABELS[workflow]) || workflow || "\u2014");
  const hostCount = job.hostCount || 0;
  const createdAgo = job.createdAt ? timeAgo(job.createdAt) : "\u2014";
  const status = (job.status || "saved").toLowerCase();
  const customer = (job.customer || "").toLowerCase();
  const custDef = (window.CUSTOMER_DEFINITIONS || {})[customer];
  const custLabel = custDef ? custDef.label : "";
  const wfIcon = _wfCategoryIcon(workflow, 11);

  // Last run result badge
  const lastResult = job.lastRunResult || "";
  const lastTags = Array.isArray(job.lastRunTags) && job.lastRunTags.length ? job.lastRunTags.join(", ") : "full";
  let lastRunHtml = "";
  if (lastResult === "passed") {
    lastRunHtml = `<span class="run-result run-result-passed" style="font-size:11px;"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><polyline points="20 6 9 17 4 12"/></svg>${safeText(lastTags)} \u2014 passed</span>`;
  } else if (lastResult === "failed") {
    lastRunHtml = `<span class="run-result run-result-failed" style="font-size:11px;"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>${safeText(lastTags)} \u2014 failed</span>`;
  } else if (job.lastRunId) {
    lastRunHtml = `<span class="muted" style="font-size:11px;">${safeText(lastTags)}</span>`;
  }

  // Progress bar for running jobs
  let progressHtml = "";
  if (status === "running") {
    const prog = window._dashProgress[jobId];
    const pct = prog && prog.pct > 0 ? prog.pct : 0;
    const taskName = prog && prog.lastTask ? prog.lastTask : "";
    const elapsed = prog && prog.elapsed ? prog.elapsed : "";
    const fillClass = pct > 0 ? "" : " inline-progress-indeterminate";
    const taskDisplay = (elapsed ? elapsed + " \u2014 " : "") + safeText(taskName || (pct > 0 ? pct + "%" : "Running..."));
    progressHtml = `<div class="job-row-progress" id="jobs-prog-${safeText(jobId)}">
      <div class="inline-progress"><div class="inline-progress-fill${fillClass}" style="width:${pct}%"></div></div>
      <div class="dash-task-name">${taskDisplay}</div>
    </div>`;
  }

  const custBadge = custLabel ? `<span class="dash-customer-badge">${safeText(custLabel)}</span>` : "";
  const hostChip = hostCount
    ? `<span class="dash-host-chip">${hostCount} hosts</span>`
    : `<span class="muted" style="font-size:11px;">No hosts</span>`;

  return {
    jobId,
    html: `<div class="job-card-item" data-jobid="${safeText(jobId)}">
      <input type="checkbox" class="bulk-cb job-card-cb" data-jobid="${safeText(jobId)}" onchange="updateBulkCount()" />
      <div class="job-row-card job-row-card-${status}">
        <div class="job-row-content">
          <div class="job-row-top">
            <span class="status-dot status-dot-${status}" title="${status}"></span>
            <span class="job-row-name">${jobName}</span>
            ${custBadge}
            ${statusBadge(status, job.updatedAt || job.createdAt)}
          </div>
          <div class="job-row-meta">
            ${wfIcon}<span>${wfLabel}</span>
            <span class="meta-dot"></span>
            ${hostChip}
            <span class="meta-dot"></span>
            <span>${safeText(createdAgo)}</span>
            ${lastRunHtml ? `<span class="meta-dot"></span>${lastRunHtml}` : ""}
          </div>
          ${progressHtml}
        </div>
        <div class="job-row-actions">
          <button class="btn ghost" data-jobid="${safeText(jobId)}">View</button>
        </div>
      </div>
    </div>`,
  };
}

function _wireJobCard(el) {
  const btn = el.querySelector('button[data-jobid]');
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openJobPanel(btn.getAttribute("data-jobid"));
    });
  }
  // Click on card (not checkbox) opens panel
  const card = el.querySelector('.job-row-card');
  if (card) {
    card.addEventListener("click", (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      const jid = el.dataset.jobid;
      if (jid) openJobPanel(jid);
    });
  }
}

function _createJobCard(job) {
  const { jobId, html } = _buildJobCardHtml(job);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const el = wrap.firstElementChild;
  _wireJobCard(el);
  return el;
}

function _updateJobCard(el, job) {
  const { html } = _buildJobCardHtml(job);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const newEl = wrap.firstElementChild;
  // Preserve checkbox state
  const oldCb = el.querySelector('.bulk-cb');
  const wasChecked = oldCb && oldCb.checked;
  el.innerHTML = newEl.innerHTML;
  el.className = newEl.className;
  // Restore data-jobid on outer element
  el.setAttribute("data-jobid", newEl.dataset.jobid);
  const newCb = el.querySelector('.bulk-cb');
  if (newCb && wasChecked) newCb.checked = true;
  _wireJobCard(el);
}

function reconcileJobCards(container, filtered) {
  const existing = new Map();
  container.querySelectorAll(".job-card-item[data-jobid]").forEach(el => existing.set(el.dataset.jobid, el));
  const seen = new Set();
  filtered.forEach((job) => {
    const id = job.jobId || job.id || job.job_id;
    seen.add(id);
    if (existing.has(id)) {
      const el = existing.get(id);
      _updateJobCard(el, job);
      container.appendChild(el);
    } else {
      container.appendChild(_createJobCard(job));
    }
  });
  existing.forEach((el, id) => { if (!seen.has(id)) el.remove(); });
}

window.renderJobsFiltered = function (textFilter, statusFilter) {
  const cardList = $("job-card-list");
  if (!cardList) return;
  const tbody = cardList; // alias for compatibility
  const jobs = window._allJobs || [];
  const q = (textFilter || "").toLowerCase().trim();
  const sf = (statusFilter || "all").toLowerCase();

  let filtered = jobs;

  // Status filter
  if (sf === "running") filtered = filtered.filter(j => j.status === "running");
  else if (sf === "completed") filtered = filtered.filter(j => j.status === "completed");
  else if (sf === "failed") filtered = filtered.filter(j => j.lastRunResult === "failed" || j.status === "failed");
  else if (sf === "saved") filtered = filtered.filter(j => j.status === "saved");

  // Text filter
  if (q) {
    filtered = filtered.filter(j => {
      const name = safeText(j.jobName || j.name).toLowerCase();
      const rack = safeText(j.rackId || "").toLowerCase();
      const sku  = safeText(j.sku || "").toLowerCase();
      const po   = safeText(j.po || "").toLowerCase();
      const wf   = safeText(j.workflow || "").toLowerCase();
      return name.includes(q) || rack.includes(q) || sku.includes(q) || po.includes(q) || wf.includes(q);
    });
  }

  // Workflow filter (Feature 6)
  const wfFilter = window._workflowFilter || "all";
  if (wfFilter && wfFilter !== "all") {
    filtered = filtered.filter(j => (j.workflow || "").toLowerCase() === wfFilter);
  }

  // Customer filter (Feature 6)
  const custFilter = window._customerFilter || "all";
  if (custFilter && custFilter !== "all") {
    filtered = filtered.filter(j => (j.customer || "").toLowerCase() === custFilter);
  }

  // Date filter
  const dateFrom = $("job-date-from")?.value;
  const dateTo = $("job-date-to")?.value;
  if (dateFrom) {
    const from = new Date(dateFrom);
    filtered = filtered.filter(j => j.createdAt && new Date(j.createdAt) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setDate(to.getDate() + 1);
    filtered = filtered.filter(j => j.createdAt && new Date(j.createdAt) < to);
  }

  // Sort: favorites first (primary), then column sort (secondary)
  filtered.sort((a, b) => {
    const aFav = isFavorite(a.jobId || a.id || a.job_id) ? 0 : 1;
    const bFav = isFavorite(b.jobId || b.id || b.job_id) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return sortJobs(a, b, window._sortCol, window._sortDir);
  });

  // DOM reconciliation: update existing cards, add new, remove stale
  reconcileJobCards(tbody, filtered);

  // Update "Showing X of Y" footer
  const footer = $("jobs-table-footer");
  if (footer) {
    const total = jobs.length;
    if (filtered.length < total) {
      footer.innerHTML = `<span class="muted" style="font-size:12px;">Showing ${filtered.length} of ${total} jobs</span>`;
    } else {
      footer.innerHTML = `<span class="muted" style="font-size:12px;">${total} job${total !== 1 ? "s" : ""} total</span>`;
    }
  }
};

// ─────────────────────────────────────────────────────────────
// Polling
// ─────────────────────────────────────────────────────────────
function startJobPolling() {
  _pollManager.start("jobRefresh", loadJobs, 30000);
}

async function pollHealth() {
  const dot = $("health-dot");
  try {
    await apiGet("/api/health");
    if (dot) { dot.className = "health-dot health-ok"; dot.title = "Backend connected"; }
    if (_connectionLost) {
      _connectionLost = false;
      _reconnectAttempts = 0;
      showConnectionBanner(false);
      showToast("Connection restored", "success");
    }
  } catch {
    if (dot) { dot.className = "health-dot health-err"; dot.title = "Backend unreachable"; }
    if (!_connectionLost) {
      _connectionLost = true;
      showConnectionBanner(true);
    }
    _reconnectAttempts++;
  }
  _pollManager.startOnce("health", pollHealth, 15000);
}

// ─────────────────────────────────────────────────────────────
// Bulk actions
// ─────────────────────────────────────────────────────────────
window.toggleBulkSelectAll = function (checked) {
  qsa(".bulk-cb").forEach(cb => { cb.checked = checked; });
  updateBulkCount();
};

window.updateBulkCount = function () {
  const selected = qsa(".bulk-cb:checked");
  const bulkBar = $("bulk-actions");
  const countEl = $("bulk-count");
  if (bulkBar) bulkBar.style.display = selected.length > 0 ? "flex" : "none";
  if (countEl) countEl.textContent = `${selected.length} selected`;
};

window.bulkDeleteJobs = async function () {
  const selected = qsa(".bulk-cb:checked");
  if (!selected.length) return;
  const ok = await showConfirmAsync(`Delete ${selected.length} job(s) permanently? This cannot be undone.`, {
    title: "Bulk Delete", confirmText: "Delete All", danger: true,
  });
  if (!ok) return;

  let deleted = 0;
  for (const cb of selected) {
    try {
      await apiDelete(`/api/jobs/${encodeURIComponent(cb.dataset.jobid)}`);
      deleted++;
    } catch { /* skip */ }
  }
  showToast(`${deleted} job(s) deleted`, "success");
  loadJobs();
};

window.bulkCloneJobs = async function () {
  const selected = qsa(".bulk-cb:checked");
  if (!selected.length) return;
  const ok = await showConfirmAsync(`Clone ${selected.length} job(s)?`, {
    title: "Bulk Clone", confirmText: "Clone All",
  });
  if (!ok) return;

  let cloned = 0;
  for (const cb of selected) {
    try {
      await apiPostJSON(`/api/jobs/${encodeURIComponent(cb.dataset.jobid)}/clone`, {});
      cloned++;
    } catch { /* skip */ }
  }
  showToast(`${cloned} job(s) cloned`, "success");
  loadJobs();
};

// ─────────────────────────────────────────────────────────────
// Workflow Category Icons (shared across dashboard + jobs table)
// ─────────────────────────────────────────────────────────────
function _wfCategoryIcon(workflow, size) {
  size = size || 12;
  const wf = (workflow || "").toLowerCase();
  const cat = _WORKFLOWS_STANDARD.find(w => w.value === wf);
  const category = cat ? cat.category : "";
  if (category === "Server") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;opacity:0.5;flex-shrink:0;"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
  } else if (category === "Network") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;opacity:0.5;flex-shrink:0;"><rect x="1" y="6" width="22" height="12" rx="2"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/></svg>`;
  } else if (category === "Power") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;opacity:0.5;flex-shrink:0;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  }
  return "";
}

// ─────────────────────────────────────────────────────────────
// Bulk Run / Bulk Stop
// ─────────────────────────────────────────────────────────────
window.bulkRunJobs = async function () {
  const selected = qsa(".bulk-cb:checked");
  if (!selected.length) return;
  const jobs = window._allJobs || [];
  const ids = [...selected].map(cb => cb.dataset.jobid);
  const eligible = ids.filter(id => {
    const j = jobs.find(j => (j.jobId || j.id || j.job_id) === id);
    return j && j.status !== "running";
  });
  const skipped = ids.length - eligible.length;

  if (!eligible.length) {
    showToast("All selected jobs are already running", "info");
    return;
  }

  const names = eligible.map(id => {
    const j = jobs.find(j => (j.jobId || j.id || j.job_id) === id);
    return safeText(j ? (j.jobName || j.name || id) : id);
  });

  // Build custom modal with workflow selector
  const container = $("confirm-modal-container");
  if (!container) return;

  const listHtml = names.map(n => `<div style="padding:2px 0;">&bull; ${n}</div>`).join("");
  const skipMsg = skipped > 0 ? `<p class="muted" style="margin-top:8px;">${skipped} already-running job(s) will be skipped.</p>` : "";

  // Build workflow options from _WORKFLOWS_STANDARD
  const wfCategories = {};
  _WORKFLOWS_STANDARD.forEach(w => {
    const cat = w.category || "Other";
    if (!wfCategories[cat]) wfCategories[cat] = [];
    wfCategories[cat].push(w);
  });
  let wfOptionsHtml = '<option value="">Each job\'s own workflow</option>';
  Object.entries(wfCategories).forEach(([cat, items]) => {
    wfOptionsHtml += `<optgroup label="${cat}">`;
    items.forEach(w => { wfOptionsHtml += `<option value="${w.value}">${w.label}</option>`; });
    wfOptionsHtml += '</optgroup>';
  });

  container.innerHTML = `
    <div class="confirm-overlay" id="bulk-run-overlay" role="dialog" aria-modal="true">
      <div class="confirm-card" style="max-width:440px;">
        <div class="confirm-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Bulk Run
        </div>
        <div style="margin:10px 0 12px;">
          <label class="muted" style="font-size:11px;display:block;margin-bottom:4px;">Workflow Override</label>
          <select class="inp" id="bulk-run-wf-select" style="width:100%;">
            ${wfOptionsHtml}
          </select>
          <p class="muted" style="font-size:10px;margin-top:4px;line-height:1.4;">Choose a workflow to run on all selected jobs, or leave default to use each job's assigned workflow.</p>
        </div>
        <div class="confirm-message" style="max-height:200px;overflow-y:auto;">
          <p>Run <strong>${eligible.length}</strong> job(s):</p>
          ${listHtml}
          ${skipMsg}
        </div>
        <div class="confirm-actions">
          <button class="btn ghost" id="bulk-run-cancel">Cancel</button>
          <button class="btn primary" id="bulk-run-ok">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Run All
          </button>
        </div>
      </div>
    </div>
  `;

  // Modal result promise
  const result = await new Promise((resolve) => {
    let dismissed = false;
    const dismiss = (val) => {
      if (dismissed) return;
      dismissed = true;
      const overlay = $("bulk-run-overlay");
      if (overlay) {
        overlay.classList.add("closing");
        const clear = () => { container.innerHTML = ""; };
        overlay.addEventListener("animationend", clear, { once: true });
        setTimeout(clear, 300);
      } else container.innerHTML = "";
      resolve(val);
    };
    $("bulk-run-cancel").addEventListener("click", () => dismiss(null));
    $("bulk-run-overlay").addEventListener("click", (e) => { if (e.target.id === "bulk-run-overlay") dismiss(null); });
    $("bulk-run-ok").addEventListener("click", () => {
      const wfSel = $("bulk-run-wf-select");
      dismiss({ workflow: wfSel ? wfSel.value : "" });
    });
  });

  if (!result) return;

  let started = 0, failed = 0;
  for (const id of eligible) {
    try {
      const payload = { tags: [] };
      if (result.workflow) payload.workflowOverride = result.workflow;
      await apiPostJSON(`/api/jobs/${encodeURIComponent(id)}/run`, payload);
      started++;
    } catch { failed++; }
  }
  const wfLabel = result.workflow
    ? ((window.WORKFLOW_LABELS && window.WORKFLOW_LABELS[result.workflow]) || result.workflow)
    : "own workflow";
  showToast(`${started} job(s) started with ${wfLabel}${failed ? `, ${failed} failed` : ""}`, started ? "success" : "error");
  loadJobs();
};

window.bulkStopJobs = async function () {
  const selected = qsa(".bulk-cb:checked");
  if (!selected.length) return;
  const jobs = window._allJobs || [];
  const ids = [...selected].map(cb => cb.dataset.jobid);
  const running = ids.filter(id => {
    const j = jobs.find(j => (j.jobId || j.id || j.job_id) === id);
    return j && j.status === "running";
  });

  if (!running.length) {
    showToast("No selected jobs are currently running", "info");
    return;
  }

  const ok = await showConfirmAsync(
    `Stop <strong>${running.length}</strong> running job(s)? This will abort their current playbook execution.`,
    { title: "Bulk Stop", confirmText: "Stop All", danger: true, html: true }
  );
  if (!ok) return;

  let stopped = 0;
  for (const id of running) {
    try {
      await apiPostJSON(`/api/jobs/${encodeURIComponent(id)}/stop`, {});
      stopped++;
    } catch { /* skip */ }
  }
  showToast(`${stopped} job(s) stopped`, "success");
  loadJobs();
};

// ─────────────────────────────────────────────────────────────
// Sortable column headers (Feature 3)
// ─────────────────────────────────────────────────────────────
function sortJobs(a, b, col, dir) {
  const mult = dir === "asc" ? 1 : -1;
  switch (col) {
    case "name": {
      const an = safeText(a.jobName || a.name).toLowerCase();
      const bn = safeText(b.jobName || b.name).toLowerCase();
      return mult * an.localeCompare(bn);
    }
    case "workflow": {
      const aw = safeText(a.workflow || "").toLowerCase();
      const bw = safeText(b.workflow || "").toLowerCase();
      return mult * aw.localeCompare(bw);
    }
    case "hosts":
      return mult * ((a.hostCount || 0) - (b.hostCount || 0));
    case "created": {
      const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return mult * (ad - bd);
    }
    default:
      return 0;
  }
}

window.toggleJobSort = function (col) {
  if (window._sortCol === col) {
    window._sortDir = window._sortDir === "asc" ? "desc" : "asc";
  } else {
    window._sortCol = col;
    window._sortDir = col === "name" || col === "workflow" ? "asc" : "desc";
  }
  const searchInput = $("job-search-input");
  const q = searchInput ? searchInput.value : "";
  saveFilterState();
  renderJobsFiltered(q, window._activeJobFilter || "all");
};

// ─────────────────────────────────────────────────────────────
// Filter Presets — save & recall filter combos (max 5)
//
// A "preset" captures the current state of ALL filter controls:
//   - Status tab (All / Running / Completed / Failed / Ready)
//   - Search text
//   - Workflow dropdown
//   - Customer dropdown
//   - Date range (from / to)
//
// Presets are stored in localStorage under key "eca_filter_presets".
// The active preset name is tracked so the user can see which one
// is applied, and a "Clear Filters" button resets everything.
// ─────────────────────────────────────────────────────────────

// Currently loaded preset name (null = no preset active)
window._activePresetName = null;

function _getFilterPresets() {
  try {
    return JSON.parse(localStorage.getItem("eca_filter_presets") || "[]");
  } catch { return []; }
}

function _saveFilterPresets(presets) {
  try { localStorage.setItem("eca_filter_presets", JSON.stringify(presets)); } catch { /* full */ }
}

// Snapshot every filter control into a plain object
function _captureCurrentFilters() {
  const searchInput = $("job-search-input");
  const dateFrom = $("job-date-from");
  const dateTo = $("job-date-to");
  return {
    status: window._activeJobFilter || "all",
    text: searchInput ? searchInput.value : "",
    workflow: window._workflowFilter || "all",
    customer: window._customerFilter || "all",
    dateFrom: dateFrom ? dateFrom.value : "",
    dateTo: dateTo ? dateTo.value : "",
  };
}

// Build a short human-readable summary of what a preset filters
// e.g. "Running | configbuild | search: rack-12"
function _presetSummary(filters) {
  const parts = [];
  if (filters.status && filters.status !== "all") parts.push(filters.status);
  if (filters.workflow && filters.workflow !== "all") {
    const label = (window.WORKFLOW_LABELS && window.WORKFLOW_LABELS[filters.workflow]) || filters.workflow;
    parts.push(label);
  }
  if (filters.customer && filters.customer !== "all") parts.push(filters.customer);
  if (filters.text) parts.push("\"" + filters.text + "\"");
  if (filters.dateFrom || filters.dateTo) {
    parts.push((filters.dateFrom || "...") + " \u2192 " + (filters.dateTo || "..."));
  }
  return parts.length ? parts.join(" \u2022 ") : "No filters";
}

// ── Save: uses a styled inline form instead of browser prompt() ──
window.saveFilterPreset = function () {
  const presets = _getFilterPresets();
  if (presets.length >= 5) {
    showToast("Maximum 5 presets reached. Delete one first to make room.", "info", 4000);
    return;
  }

  // Show a styled modal for naming (matches app confirm-card style)
  const container = $("confirm-modal-container");
  if (!container) return;

  const currentSummary = _presetSummary(_captureCurrentFilters());

  container.innerHTML = `
    <div class="confirm-overlay" id="preset-save-overlay" role="dialog" aria-modal="true">
      <div class="confirm-card" style="max-width:380px;">
        <div class="confirm-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save Filter Preset
        </div>
        <p class="muted" style="margin:8px 0 4px;font-size:11px;">Save your current filter combination so you can quickly switch back to it later. You can save up to 5 presets.</p>
        <div style="margin:10px 0;">
          <label class="muted" style="font-size:11px;display:block;margin-bottom:4px;">Preset Name</label>
          <input class="inp" id="preset-save-name" placeholder="e.g. Running ConfigBuild, Failed PostProv" style="width:100%;" maxlength="40" autofocus />
        </div>
        <div style="margin:6px 0 12px;padding:8px 10px;border-radius:8px;background:var(--toggle-bg);border:1px solid var(--card-border);">
          <div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Filters being saved</div>
          <div style="font-size:12px;color:var(--text-primary);">${currentSummary}</div>
        </div>
        <div class="confirm-actions">
          <button class="btn ghost" id="preset-save-cancel">Cancel</button>
          <button class="btn primary" id="preset-save-ok">Save Preset</button>
        </div>
      </div>
    </div>
  `;

  // Focus the name input
  setTimeout(() => { const inp = $("preset-save-name"); if (inp) inp.focus(); }, 50);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    const overlay = $("preset-save-overlay");
    if (overlay) {
      overlay.classList.add("closing");
      const clear = () => { container.innerHTML = ""; };
      overlay.addEventListener("animationend", clear, { once: true });
      setTimeout(clear, 300);
    } else container.innerHTML = "";
  };

  $("preset-save-cancel").addEventListener("click", dismiss);
  $("preset-save-overlay").addEventListener("click", (e) => { if (e.target.id === "preset-save-overlay") dismiss(); });

  // Allow Enter key to submit
  $("preset-save-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("preset-save-ok").click(); }
  });

  $("preset-save-ok").addEventListener("click", () => {
    const name = ($("preset-save-name")?.value || "").trim();
    if (!name) {
      showToast("Please enter a name for your preset", "error");
      return;
    }
    // Check for duplicate name
    const existing = _getFilterPresets();
    if (existing.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      showToast("A preset with that name already exists", "error");
      return;
    }
    dismiss();
    existing.push({ name, filters: _captureCurrentFilters() });
    _saveFilterPresets(existing);
    window._activePresetName = name;
    _renderPresetDropdown();
    showToast("Preset \"" + name + "\" saved", "success");
  });
};

// ── Load: apply a preset's filters to all controls ──
window.loadFilterPreset = function (idx) {
  const presets = _getFilterPresets();
  const p = presets[idx];
  if (!p) return;
  const f = p.filters;

  // Restore every filter control
  window._activeJobFilter = f.status || "all";
  window._workflowFilter = f.workflow || "all";
  window._customerFilter = f.customer || "all";

  const searchInput = $("job-search-input");
  if (searchInput) searchInput.value = f.text || "";
  const dateFrom = $("job-date-from");
  if (dateFrom) dateFrom.value = f.dateFrom || "";
  const dateTo = $("job-date-to");
  if (dateTo) dateTo.value = f.dateTo || "";
  const wfSelect = $("job-workflow-filter");
  if (wfSelect) wfSelect.value = f.workflow || "all";
  const custSelect = $("job-customer-filter");
  if (custSelect) custSelect.value = f.customer || "all";

  qsa(".filter-tab").forEach(t => t.classList.toggle("active", t.dataset.filter === window._activeJobFilter));
  window._activePresetName = p.name;
  saveFilterState();
  renderJobsFiltered(f.text || "", window._activeJobFilter);
  _renderPresetDropdown();
  showToast("Loaded preset \"" + safeText(p.name) + "\"", "success", 1500);
};

// ── Clear: reset ALL filters back to defaults ──
window.clearAllFilters = function () {
  window._activeJobFilter = "all";
  window._workflowFilter = "all";
  window._customerFilter = "all";
  window._activePresetName = null;

  const searchInput = $("job-search-input");
  if (searchInput) searchInput.value = "";
  const dateFrom = $("job-date-from");
  if (dateFrom) dateFrom.value = "";
  const dateTo = $("job-date-to");
  if (dateTo) dateTo.value = "";
  const wfSelect = $("job-workflow-filter");
  if (wfSelect) wfSelect.value = "all";
  const custSelect = $("job-customer-filter");
  if (custSelect) custSelect.value = "all";

  qsa(".filter-tab").forEach(t => t.classList.toggle("active", t.dataset.filter === "all"));
  saveFilterState();
  renderJobsFiltered("", "all");
  _renderPresetDropdown();
  showToast("All filters cleared", "info", 1500);
};

// ── Delete: remove a preset with confirmation ──
window.deleteFilterPreset = function (idx) {
  const presets = _getFilterPresets();
  const p = presets[idx];
  if (!p) return;

  // If deleting the active preset, deactivate it
  if (window._activePresetName === p.name) {
    window._activePresetName = null;
  }
  presets.splice(idx, 1);
  _saveFilterPresets(presets);
  _renderPresetDropdown();
  showToast("Preset \"" + safeText(p.name) + "\" deleted", "info", 1500);
};

// ── Render the full preset toolbar UI ──
function _renderPresetDropdown() {
  const container = $("filter-preset-container");
  if (!container) return;
  const presets = _getFilterPresets();
  const hasActive = !!window._activePresetName;

  // Save icon SVG
  const saveSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
  // Chevron SVG
  const chevSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M6 9l6 6 6-6"/></svg>';
  // Bookmark SVG
  const bookSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

  let html = '<div class="preset-group">';

  // Active preset indicator badge (shows which preset is loaded)
  if (hasActive) {
    html += '<span class="preset-active-badge" title="Active filter preset">' + bookSvg + safeText(window._activePresetName) + '</span>';
    html += '<button class="btn ghost btn-sm preset-clear-btn" onclick="clearAllFilters()" title="Clear all filters and remove active preset">Clear</button>';
  }

  // Save button
  html += '<button class="btn ghost btn-sm" onclick="saveFilterPreset()" title="Save current filters as a reusable preset (max 5)">' + saveSvg + 'Save</button>';

  // Presets dropdown (only if presets exist)
  if (presets.length > 0) {
    html += '<div class="preset-dropdown-wrap">';
    html += '<button class="btn ghost btn-sm preset-dropdown-toggle" id="preset-dropdown-btn" onclick="_togglePresetDropdown()">' + chevSvg + 'Presets <span class="filter-count">' + presets.length + '</span></button>';
    html += '<div class="preset-dropdown" id="preset-dropdown" style="display:none;">';

    // Dropdown header with help text
    html += '<div class="preset-dropdown-header">';
    html += '<span class="preset-dropdown-title">' + bookSvg + 'Saved Presets</span>';
    html += '<span class="muted" style="font-size:10px;">' + presets.length + ' of 5</span>';
    html += '</div>';
    html += '<p class="preset-dropdown-help">Click a preset to apply its filters. Use the trash icon to remove it.</p>';

    presets.forEach((p, i) => {
      const isActive = window._activePresetName === p.name;
      const summary = _presetSummary(p.filters);
      html += '<div class="preset-item' + (isActive ? ' preset-item-active' : '') + '">';
      html += '<button class="preset-item-name" onclick="loadFilterPreset(' + i + ');_togglePresetDropdown()" title="Click to apply: ' + safeText(summary) + '">';
      if (isActive) html += '<span class="preset-active-dot"></span>';
      html += '<span class="preset-item-label">' + safeText(p.name) + '</span>';
      html += '<span class="preset-item-summary">' + safeText(summary) + '</span>';
      html += '</button>';
      html += '<button class="preset-item-delete" onclick="event.stopPropagation();deleteFilterPreset(' + i + ')" title="Delete preset \'' + safeText(p.name) + '\'">';
      html += '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      html += '</button>';
      html += '</div>';
    });

    // Footer: Clear All Presets link
    html += '<div class="preset-dropdown-footer">';
    html += '<button class="preset-clear-all" onclick="clearAllPresets();_togglePresetDropdown()">Delete all presets</button>';
    html += '</div>';

    html += '</div></div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

window._togglePresetDropdown = function () {
  const dd = $("preset-dropdown");
  if (dd) dd.style.display = dd.style.display === "none" ? "block" : "none";
};

// Delete ALL saved presets
window.clearAllPresets = function () {
  _saveFilterPresets([]);
  window._activePresetName = null;
  _renderPresetDropdown();
  showToast("All presets deleted", "info", 1500);
};

// Close preset dropdown on outside click
document.addEventListener("click", (e) => {
  const dd = $("preset-dropdown");
  if (dd && dd.style.display !== "none" && !e.target.closest(".preset-dropdown-wrap")) {
    dd.style.display = "none";
  }
});
