// ─────────────────────────────────────────────────────────────
// job-panel-core.js — Shared state, panel open/close, renderJobPanel, tab management
// ─────────────────────────────────────────────────────────────

var currentJobId = null;
var logPollTimer = null;
var _runStartTime = null;
var _lastPreflightRefresh = 0;
var _lastFailedTasks = [];
var _dirtyFields = new Set();
var _currentJobId = null;

// ─────────────────────────────────────────────────────────────
// Save job field
// ─────────────────────────────────────────────────────────────
window.saveJobField = async function (jobId, field, value) {
  const input = qs(`.ie-field[data-field="${field}"]`);
  const previousValue = input ? input.defaultValue : undefined;

  // ── Optimistic: flash green + update cache + header immediately ──
  if (input) {
    input.defaultValue = value;
    input.classList.remove("save-flash");
    void input.offsetWidth;
    input.classList.add("save-flash");
    setTimeout(() => input.classList.remove("save-flash"), 1500);
  }
  const decodedId = decodeURIComponent(jobId);
  if (window._allJobs) {
    const cached = window._allJobs.find(j => (j.jobId || j.id || j.job_id) === decodedId);
    if (cached) cached[field] = value;
  }
  if (field === "jobName") {
    const titleEl = qs(".title-main");
    if (titleEl) {
      const badge = titleEl.querySelector(".status-badge");
      titleEl.textContent = "";
      titleEl.appendChild(document.createTextNode(value + " "));
      if (badge) titleEl.appendChild(badge);
    }
  } else if (field === "rackId") {
    const subEl = qs(".title-sub");
    if (subEl) subEl.textContent = value ? "Rack " + value : "";
  }

  // ── Background API call — rollback on failure ──
  try {
    await apiPatch(`/api/jobs/${encodeURIComponent(jobId)}`, { [field]: value });
  } catch (e) {
    // Rollback optimistic changes
    if (input && previousValue !== undefined) {
      input.value = previousValue;
      input.defaultValue = previousValue;
    }
    if (window._allJobs) {
      const cached = window._allJobs.find(j => (j.jobId || j.id || j.job_id) === decodedId);
      if (cached && previousValue !== undefined) cached[field] = previousValue;
    }
    if (field === "jobName" && previousValue !== undefined) {
      const titleEl = qs(".title-main");
      if (titleEl) {
        const badge = titleEl.querySelector(".status-badge");
        titleEl.textContent = "";
        titleEl.appendChild(document.createTextNode(previousValue + " "));
        if (badge) titleEl.appendChild(badge);
      }
    } else if (field === "rackId" && previousValue !== undefined) {
      const subEl = qs(".title-sub");
      if (subEl) subEl.textContent = previousValue ? "Rack " + previousValue : "";
    }
    showToast(`Save failed: ${e.message}`, "error");
  }
};

// ─────────────────────────────────────────────────────────────
// Copy Job ID (Feature 9)
// ─────────────────────────────────────────────────────────────
window.copyJobId = function (jobId) {
  const text = jobId || "";
  function _showCopySuccess() {
    const btn = qs(".copy-id-btn");
    if (btn) { btn.classList.add("copy-id-success"); setTimeout(() => btn.classList.remove("copy-id-success"), 1500); }
    showToast("Job ID copied", "success", 1500);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(_showCopySuccess).catch(() => { _fallbackCopy(text); _showCopySuccess(); });
  } else {
    _fallbackCopy(text);
    _showCopySuccess();
  }
};

function _fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

// ─────────────────────────────────────────────────────────────
// Delete job
// ─────────────────────────────────────────────────────────────
window.deleteJobConfirm = async function (jobId) {
  const ok = await showConfirmAsync("Delete this job permanently? This will remove all files, runs, and data. This cannot be undone.", {
    title: "Delete Job", confirmText: "Delete", danger: true,
  });
  if (!ok) return;
  try {
    await apiDelete(`/api/jobs/${encodeURIComponent(jobId)}`);
    showToast("Job deleted", "success");
    closeJobPanel();
    await loadJobs();
  } catch (e) {
    showToast("Delete failed: " + e.message, "error");
  }
};

// ─────────────────────────────────────────────────────────────
// Clone job — show form for editable details
// ─────────────────────────────────────────────────────────────
window.cloneJob = function (jobId) {
  // Get source job data for defaults
  const source = (window._allJobs || []).find(j => (j.jobId || j.id || j.job_id) === decodeURIComponent(jobId));
  const srcName = source ? (source.jobName || source.name || "") : "";
  const srcRack = source ? (source.rackId || "") : "";
  const srcSku = source ? (source.sku || "") : "";
  const srcPo = source ? (source.po || "") : "";

  const container = $("confirm-modal-container");
  if (!container) return;

  container.innerHTML = `
    <div class="confirm-overlay" id="clone-overlay" role="dialog" aria-modal="true">
      <div class="confirm-card" style="max-width:420px;">
        <div class="confirm-title">Clone Job</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin:12px 0;">
          <div><label class="muted" style="font-size:11px;display:block;margin-bottom:2px;">Job Name</label><input class="inp" id="clone-name" value="${safeText(srcName)} (copy)" style="width:100%;" /></div>
          <div><label class="muted" style="font-size:11px;display:block;margin-bottom:2px;">Rack ID</label><input class="inp" id="clone-rack" value="${safeText(srcRack)}" placeholder="e.g. A01" style="width:100%;" /></div>
          <div><label class="muted" style="font-size:11px;display:block;margin-bottom:2px;">SKU</label><input class="inp" id="clone-sku" value="${safeText(srcSku)}" placeholder="e.g. R760" style="width:100%;" /></div>
          <div><label class="muted" style="font-size:11px;display:block;margin-bottom:2px;">P.O. Number</label><input class="inp" id="clone-po" value="${safeText(srcPo)}" placeholder="e.g. PO-12345" style="width:100%;" /></div>
        </div>
        <div class="confirm-actions">
          <button class="btn ghost" id="clone-cancel">Cancel</button>
          <button class="btn primary" id="clone-ok">Clone</button>
        </div>
      </div>
    </div>
  `;

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    const overlay = $("clone-overlay");
    if (overlay) {
      overlay.classList.add("closing");
      const clear = () => { container.innerHTML = ""; };
      overlay.addEventListener("animationend", clear, { once: true });
      setTimeout(clear, 300);
    } else container.innerHTML = "";
  };
  $("clone-cancel").addEventListener("click", dismiss);
  $("clone-overlay").addEventListener("click", (e) => { if (e.target.id === "clone-overlay") dismiss(); });
  $("clone-ok").addEventListener("click", async () => {
    const overrides = {
      jobName: $("clone-name").value.trim(),
      rackId: $("clone-rack").value.trim(),
      sku: $("clone-sku").value.trim(),
      po: $("clone-po").value.trim(),
    };
    dismiss();
    try {
      const newJob = await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/clone`, overrides);
      showToast("Job cloned", "success");
      await loadJobs();
      const newId = newJob.jobId || newJob.id || newJob.job_id;
      if (newId) openJobPanel(newId);
    } catch (e) {
      showToast("Clone failed: " + e.message, "error");
    }
  });
};

// ─────────────────────────────────────────────────────────────
// Open / close panel
// ─────────────────────────────────────────────────────────────
async function openJobPanel(jobId) {
  ensureWizardContainer();
  ensureJobModalStyles();

  currentJobId = jobId;
  _runStartTime = null;

  $("wizard-container").innerHTML = `
    <div class="job-panel-root" id="job-panel-root">
      <div class="panel-backdrop" onclick="closeJobPanel()"></div>
      <div class="job-panel" id="job-panel" onclick="event.stopPropagation()">
        <div class="panel-header">
          <div class="modal-title">
            <div class="title-main">Loading...</div>
            <div class="title-sub muted">Job ID: ${safeText(jobId)}</div>
          </div>
          <button class="modal-close" onclick="closeJobPanel()" aria-label="Close panel">&times;</button>
        </div>
        <div class="section" style="padding:20px;">
          ${skeletonRows(5)}
        </div>
      </div>
    </div>
  `;

  try {
    const job = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}`);
    renderJobPanel(job);
    startLogPolling(jobId);
  } catch (e) {
    const panel = $("job-panel");
    if (panel) panel.innerHTML = `<div class="section" style="padding:20px;"><pre class="output">ERROR: ${safeText(e.message)}</pre></div>`;
  }
}

function closeJobPanel(force) {
  if (!force && _dirtyFields.size > 0) {
    const fields = Array.from(_dirtyFields).join(", ");
    showConfirm(
      `You have unsaved changes (${fields}). Close anyway?`,
      () => closeJobPanel(true),
      { confirmLabel: "Discard & Close", cancelLabel: "Go Back" }
    );
    return;
  }
  if (logPollTimer) clearTimeout(logPollTimer);
  logPollTimer = null;
  currentJobId = null;
  _runStartTime = null;
  _dirtyFields.clear();

  const container = $("wizard-container");
  if (!container) return;
  const panel = container.querySelector(".job-panel");
  const backdrop = container.querySelector(".panel-backdrop");
  if (panel) {
    panel.classList.add("panel-closing");
    if (backdrop) backdrop.classList.add("backdrop-closing");
    const clear = () => { container.innerHTML = ""; };
    panel.addEventListener("animationend", clear, { once: true });
    setTimeout(clear, 250); // safety timeout
  } else {
    container.innerHTML = "";
  }
}

window.openJobPanel = openJobPanel;
window.closeJobPanel = closeJobPanel;

// ─────────────────────────────────────────────────────────────
// Combined readiness check (tab indicators + run button state)
// Single Promise.all instead of 4 redundant API calls
// ─────────────────────────────────────────────────────────────
async function updateJobReadiness(jobId) {
  if (!jobId || !$("job-panel")) return;
  try {
    const [inv, job] = await Promise.all([
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}/inventory_hosts`).catch(() => ({ hosts: [] })),
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}`).catch(() => ({})),
    ]);
    const hasHosts = (inv.hosts || []).length > 0;
    const files = normalizeFiles(job);
    const hasWorkbook = files.some(f => f.role === "workbook");

    // ── Tab completion indicators (count badges) ──
    const hostCount = (inv.hosts || []).length;
    const fileCount = files.length;
    const invTab = qs('.modal-tab[data-tab="tab-inventory"]');
    const uplTab = qs('.modal-tab[data-tab="tab-upload"]');
    if (invTab) {
      let check = invTab.querySelector(".tab-check");
      if (hasHosts) {
        if (!check) { check = document.createElement("span"); check.className = "tab-check"; invTab.appendChild(check); }
        check.textContent = hostCount;
      } else if (check) { check.remove(); }
    }
    if (uplTab) {
      let check = uplTab.querySelector(".tab-check");
      if (fileCount > 0) {
        if (!check) { check = document.createElement("span"); check.className = "tab-check"; uplTab.appendChild(check); }
        check.textContent = fileCount;
      } else if (check) { check.remove(); }
    }

    // ── Run button state ──
    const reasons = [];
    if (!hasHosts) reasons.push("No inventory generated");
    if (!hasWorkbook) reasons.push("No workbook uploaded");

    const ids = ["btn_run_tasks"];
    ids.forEach(id => {
      const btn = $(id);
      if (!btn) return;
      if (reasons.length > 0 && (job.status || "saved") !== "running") {
        btn.disabled = true;
        btn.title = "";
      } else {
        btn.disabled = false;
        btn.title = "";
      }
    });

    let reasonEl = $("run-disabled-reason");
    if (reasons.length > 0 && (job.status || "saved") !== "running") {
      if (!reasonEl) {
        reasonEl = document.createElement("div");
        reasonEl.id = "run-disabled-reason";
        reasonEl.className = "disabled-reason";
        const runControls = qs(".run-controls");
        if (runControls) runControls.parentElement.insertBefore(reasonEl, runControls.nextSibling);
      }
      const warnSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      reasonEl.innerHTML = warnSvg + reasons.join(" &bull; ");
      reasonEl.style.display = "";
    } else if (reasonEl) {
      reasonEl.style.display = "none";
    }
  } catch { /* silent */ }
}

// Backward-compatible aliases for call sites in other files
function updateTabChecks(jobId) { return updateJobReadiness(jobId); }
function updateRunButtonState(jobId) { /* no-op: merged into updateJobReadiness */ }

// ─────────────────────────────────────────────────────────────
// Job status timeline (Overview tab)
// ─────────────────────────────────────────────────────────────
async function updateJobTimeline(jobId) {
  const container = $("job-timeline-container");
  if (!container || !jobId) return;
  try {
    const [inv, job] = await Promise.all([
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}/inventory_hosts`).catch(() => ({ hosts: [] })),
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}`).catch(() => ({})),
    ]);
    const hosts = inv.hosts || [];
    const hasHosts = hosts.length > 0;
    const files = normalizeFiles(job);
    const hasFiles = files.length > 0;
    const status = (job.status || "saved").toLowerCase();
    const hasRun = !!job.lastRunId;
    const lastResult = (job.lastRunResult || "").toLowerCase();
    const createdAt = job.createdAt || "";
    const tsrCount = job.tsrCount || 0;

    // Count files by type
    const workbookCount = files.filter(f => f.role === "workbook").length;
    const firmwareCount = files.filter(f => f.role === "firmware" || f.role === "bios_xml").length;

    const steps = [
      {
        label: "Created",
        detail: createdAt ? timeAgo(createdAt) : "Just now",
        done: true,
      },
      {
        label: "Files",
        detail: hasFiles ? `${files.length} file${files.length !== 1 ? "s" : ""}` : "None",
        done: hasFiles,
      },
      {
        label: "Inventory",
        detail: hasHosts ? `${hosts.length} host${hosts.length !== 1 ? "s" : ""}` : "Not scanned",
        done: hasHosts,
      },
      {
        label: "Run",
        detail: status === "running" ? "Running..." : (hasRun ? safeText(job.workflow || "Done") : "Idle"),
        done: status === "running" || hasRun,
        active: status === "running",
      },
      {
        label: "Done",
        detail: lastResult === "passed" ? "Passed" : lastResult === "failed" ? "Failed" : (hasRun && status !== "running" ? "Complete" : "\u2014"),
        done: hasRun && status !== "running",
        failed: lastResult === "failed",
      },
    ];

    const tlCheck = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const tlPlay = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    const tlFail = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    container.innerHTML = `<div class="job-timeline">${steps.map((s, i) => {
      let dot = i + 1;
      if (s.active) dot = tlPlay;
      else if (s.failed && s.done) dot = tlFail;
      else if (s.done) dot = tlCheck;

      const cls = [
        "timeline-step",
        s.done ? "timeline-done" : "",
        s.active ? "timeline-active" : "",
        s.failed && s.done ? "timeline-failed" : "",
      ].filter(Boolean).join(" ");

      const line = i < steps.length - 1
        ? `<div class="timeline-line${s.done ? " timeline-line-done" : ""}${s.failed && s.done ? " timeline-line-failed" : ""}"></div>`
        : "";

      return `<div class="${cls}"><div class="timeline-dot">${dot}</div><div class="timeline-label">${s.label}</div><div class="timeline-detail">${s.detail || ""}</div></div>${line}`;
    }).join("")}</div>`;
  } catch { /* silent */ }
}

// parseFailedTasksFromLog and parseFailedSnippets are defined in job-panel-status.js

// ─────────────────────────────────────────────────────────────
// Render job panel
// ─────────────────────────────────────────────────────────────
function renderJobPanel(job) {
  const jobId = job.jobId || job.id || job.job_id || currentJobId;
  const jobName = job.jobName || job.name || "(unnamed)";
  const workflow = safeText(job.workflow || "configbuild").toLowerCase();
  const serverClass = safeText(job.serverClass || "J");
  const status = safeText(job.status || "saved");

  const customer = safeText(job.customer || "servicenow");
  _activeCustomer = customer;
  _currentJobId = jobId;
  const customerDef = getCustomerDef(customer);

  const activeKey = getActiveTaskKey(workflow, serverClass);
  const tasksHtml = buildTaskCheckboxes(activeKey, customer);

  const isRunning = status === "running";
  if (isRunning) _runStartTime = _runStartTime || Date.now();

  const fileCount = normalizeFiles(job).length;
  const rackId = safeText(job.rackId || "");
  const sku = safeText(job.sku || "");
  const po = safeText(job.po || "");
  const notes = safeText(job.notes || "");
  const lastRunTags = Array.isArray(job.lastRunTags) ? job.lastRunTags : [];
  const lastRunStr = lastRunTags.length ? lastRunTags.join(", ") : "full workflow";
  const lastRunDisplay = job.lastRunId ? `${lastRunStr} — ${status}` : "\u2014";

  const customerOptionsHtml = buildCustomerSelectHtml(customer);
  const workflowOptionsHtml = buildWorkflowSelectHtml(workflow, customer);
  const descriptions = getWorkflowDescriptions(customer);
  const workflowDescHtml = descriptions[workflow] ? `<p>${descriptions[workflow]}</p>` : "";
  const workflowExtraOptionsHtml = buildWorkflowExtraOptions(workflow);

  const panel = $("job-panel");
  if (!panel) return;

  const ej = encodeURIComponent(jobId);

  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-header-spacer"></div>
      <div class="modal-title">
        <div class="title-main">${safeText(jobName)} ${statusBadge(status)}</div>
        <div class="title-sub muted">${rackId ? "Rack " + rackId : ""}</div>
      </div>
      <div class="panel-header-spacer">
        <div class="panel-header-actions">
          <button class="btn-icon" onclick="copyJobId('${safeText(jobId)}')" title="Copy Job ID" aria-label="Copy Job ID"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          <button class="btn-icon" onclick="cloneJob('${ej}')" title="Clone Job" aria-label="Clone Job"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          ${window._userRole === "admin" ? `<button class="btn-icon btn-icon-danger" onclick="deleteJobConfirm('${ej}')" title="Delete Job" aria-label="Delete Job"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ""}
        </div>
        <button class="modal-close" onclick="closeJobPanel()" aria-label="Close panel">&times;</button>
      </div>
    </div>

    <!-- Modal Tabs (Step 1-4 + Status) -->
    <div class="modal-tabs" role="tablist">
      <button class="modal-tab active" data-tab="tab-overview" role="tab" aria-selected="true" aria-controls="tab-overview"><span class="tab-step">1</span> Overview <kbd class="tab-kbd">1</kbd></button>
      <button class="modal-tab" data-tab="tab-upload" role="tab" aria-selected="false" aria-controls="tab-upload"><span class="tab-step">2</span> Upload <kbd class="tab-kbd">2</kbd></button>
      <button class="modal-tab" data-tab="tab-inventory" role="tab" aria-selected="false" aria-controls="tab-inventory"><span class="tab-step">3</span> Inventory <kbd class="tab-kbd">3</kbd></button>
      <button class="modal-tab" data-tab="tab-tasks" role="tab" aria-selected="false" aria-controls="tab-tasks"><span class="tab-step">4</span> Tasks <kbd class="tab-kbd">4</kbd></button>
      <button class="modal-tab" data-tab="tab-status" role="tab" aria-selected="false" aria-controls="tab-status">Status <kbd class="tab-kbd">5</kbd>${isRunning ? ' <span class="tab-badge tab-badge-running">Live</span>' : ""}</button>
    </div>

    <div class="panel-body">

      <!-- Tab 1: Overview -->
      <div class="tab-panel active" id="tab-overview" role="tabpanel">
        <div id="job-timeline-container" style="margin:12px 0 16px;"></div>

        <!-- Current Status (visible when running) -->
        <div class="ov-live-card" id="overview-running-status" style="${isRunning ? "" : "display:none;"}">
          <div class="ov-live-top">
            <span class="ov-live-dot"></span>
            <span class="ov-live-label">Live</span>
            <span class="ov-live-workflow" id="overview-running-detail">${isRunning ? safeText(lastRunStr) : ""}</span>
            <span class="ov-live-elapsed" id="overview-running-elapsed"></span>
          </div>
          <div class="ov-live-task" id="overview-running-task"></div>
          <div class="ov-live-bar"><div class="ov-live-bar-fill" id="ov-live-progress"></div></div>
        </div>

        <div class="section">
          ${helpToggleHtml("How the Overview tab works", "Review your job details below. Click any editable field to update it. Once everything looks correct, proceed to the <strong>Upload</strong> tab.")}
          <div class="stat-row"><div class="stat-label">Customer</div><div class="stat-value" style="opacity:0.7;">${safeText(customerDef.label)}</div></div>
          <div class="stat-row"><div class="stat-label">Job Name</div><div class="stat-value"><input class="inp inp-inline ie-field" data-field="jobName" data-jobid="${ej}" value="${safeText(jobName)}" />${PENCIL_ICON}<span class="inline-edit-actions" id="ie-jobName"><button class="ie-save" title="Save">\u2714</button><button class="ie-cancel" title="Cancel">\u2718</button></span></div></div>
          <div class="stat-row"><div class="stat-label">Rack ID</div><div class="stat-value"><input class="inp inp-inline ie-field" data-field="rackId" data-jobid="${ej}" value="${rackId}" placeholder="\u2014" />${PENCIL_ICON}<span class="inline-edit-actions" id="ie-rackId"><button class="ie-save" title="Save">\u2714</button><button class="ie-cancel" title="Cancel">\u2718</button></span></div></div>
          <div class="stat-row"><div class="stat-label">SKU</div><div class="stat-value"><input class="inp inp-inline ie-field" data-field="sku" data-jobid="${ej}" value="${sku}" placeholder="\u2014" />${PENCIL_ICON}<span class="inline-edit-actions" id="ie-sku"><button class="ie-save" title="Save">\u2714</button><button class="ie-cancel" title="Cancel">\u2718</button></span></div></div>
          <div class="stat-row"><div class="stat-label">P.O.</div><div class="stat-value"><input class="inp inp-inline ie-field" data-field="po" data-jobid="${ej}" value="${po}" placeholder="\u2014" />${PENCIL_ICON}<span class="inline-edit-actions" id="ie-po"><button class="ie-save" title="Save">\u2714</button><button class="ie-cancel" title="Cancel">\u2718</button></span></div></div>
          <div class="stat-row"><div class="stat-label">Created</div><div class="stat-value" title="${safeText(job.createdAt || "")}">${job.createdAt ? timeAgo(job.createdAt) : "\u2014"}</div></div>
          <div class="stat-row"><div class="stat-label">Last Run</div><div class="stat-value">${lastRunDisplay}</div></div>
          <div class="stat-row"><div class="stat-label">Hosts</div><div class="stat-value" id="overview-host-count">...</div></div>
        </div>
        <div class="section">
          <h4>Notes <span class="notes-saved-indicator" id="notes-saved">Saved</span></h4>
          <textarea class="job-notes-area" id="job-notes" placeholder="Add notes about this job...">${safeText(notes)}</textarea>
        </div>



        <div class="section" style="border-top:1px solid var(--card-border);padding-top:12px;margin-top:16px;">
          <h4>Job Actions</h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <button class="btn ghost" onclick="cloneJob('${ej}')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Clone Job</button>
            <button class="btn ghost" onclick="saveAsTemplate('${ej}')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save as Template</button>
            <div style="flex:1;"></div>
            ${window._userRole === "admin" ? `<button class="btn danger" onclick="deleteJobConfirm('${ej}')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete Job</button>` : ""}
          </div>
        </div>
      </div>

      <!-- Tab 2: Upload -->
      <div class="tab-panel" id="tab-upload" role="tabpanel">
        <div class="section">
          ${helpToggleHtml("Upload requirements", "Upload the required files for this job. You need a <strong>workbook CSV</strong> (contains MAC addresses and server details), a <strong>BIOS XML config</strong> (server configuration template), and <strong>firmware files</strong> (.exe/.bin) for iDRAC and BIOS updates. After uploading firmware, generate the catalog below.")}
          <h4>Upload File ${helpTip("Upload workbook CSV (MAC/serial data), BIOS XML config, and firmware .exe/.bin files.")}</h4>
          <p class="muted" style="margin-bottom:8px;">Drag and drop files or click to browse. You can upload multiple files at once. Files are automatically categorized by extension.</p>
          <div class="upload-zone" id="upload-zone">
            <div class="upload-zone-inner">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;margin-bottom:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <div class="upload-zone-label">Drop files here or click to browse</div>
              <a href="#" class="csv-template-link" onclick="event.preventDefault();event.stopPropagation();downloadCsvTemplate()"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download blank CSV template</a>
              <div class="row" style="margin-top:10px;">
                <input id="job_upload_file" type="file" class="upload-file-input" multiple />
                <button class="btn primary" id="job_upload_btn">Upload</button>
              </div>
              <span class="muted" id="job_upload_status">Ready</span>
            </div>
          </div>
        </div>
        <div class="section">
          <h4>Uploaded Files</h4>
          <p class="muted" style="margin-bottom:8px;">Files currently attached to this job. You can delete files you no longer need.</p>
          <div id="all-files-list">${skeletonRows(3)}</div>
        </div>
        <div class="section catalog-section">
          <div class="catalog-header">
            <div>
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;opacity:0.6;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Firmware Catalog ${helpTip("Catalog.xml is auto-generated from firmware files. Required by iDRAC for firmware updates.")}</h4>
              <p class="muted" style="margin-top:4px;font-size:11px;">Build Catalog.xml from uploaded firmware. Required by iDRAC for firmware updates.</p>
            </div>
            <div class="catalog-actions">
              <button class="btn primary" id="btn_generate_catalog" style="padding:8px 16px;font-size:12px;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Build Catalog</button>
              <span class="muted catalog-status" id="catalog_status">Ready</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 3: Inventory -->
      <div class="tab-panel" id="tab-inventory" role="tabpanel">
        <div class="section">
          <h4 style="margin-bottom:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            Network Discovery ${helpTip("Scans local network via ARP to match MAC addresses from your CSV workbook.")}
          </h4>
          <p class="muted" style="margin-bottom:10px;font-size:12px;">Scan the local network to discover devices by matching MAC addresses from your uploaded CSV workbook. Ensure devices are powered on and connected before scanning.</p>
          <div class="inv-scan-options" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <label class="inv-scan-chip" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);cursor:pointer;font-size:12px;transition:border-color 0.15s,background 0.15s;">
              <input type="radio" name="inv_scan_type" value="all" checked style="accent-color:#3b82f6;" />
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span><strong>All Devices</strong><br/><span class="muted" style="font-size:10px;">Servers, PDUs, switches, and more</span></span>
            </label>
            <label class="inv-scan-chip" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);cursor:pointer;font-size:12px;transition:border-color 0.15s,background 0.15s;">
              <input type="radio" name="inv_scan_type" value="servers" style="accent-color:#3b82f6;" />
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              <span><strong>Servers Only</strong><br/><span class="muted" style="font-size:10px;">iDRAC management interfaces</span></span>
            </label>
            <label class="inv-scan-chip" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);cursor:pointer;font-size:12px;transition:border-color 0.15s,background 0.15s;">
              <input type="radio" name="inv_scan_type" value="pdu" style="accent-color:#3b82f6;" />
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>
              <span><strong>PDUs Only</strong><br/><span class="muted" style="font-size:10px;">Power distribution units</span></span>
            </label>
            <label class="inv-scan-chip" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);cursor:pointer;font-size:12px;transition:border-color 0.15s,background 0.15s;">
              <input type="radio" name="inv_scan_type" value="network" style="accent-color:#3b82f6;" />
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              <span><strong>Network Devices</strong><br/><span class="muted" style="font-size:10px;">Switches, consoles, RCON</span></span>
            </label>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <button class="btn primary" id="btn_generate_inventory">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Scan Network
            </button>
            ${helpTip("Discovers servers on the local network via ARP scan")}
            <span class="muted" id="inv_status" style="font-size:12px;">Ready to scan</span>
          </div>
          <pre class="output" id="inv_gen_output" style="margin-top:10px; max-height:200px; display:none;" hidden></pre>
        </div>
        <div class="section">
          <h4>Hosts <span class="muted" id="inv-host-count"></span></h4>
          <p class="muted" style="margin-bottom:8px;">Review the discovered hosts below. Any MAC addresses from your CSV that were <strong>not found</strong> during the ARP scan will be listed as missing. Missing hosts may be powered off, disconnected, or on a different network segment.</p>
          <div id="inv-hosts-table">${skeletonRows(3)}</div>
        </div>
      </div>

      <!-- Tab 4: Tasks -->
      <div class="tab-panel" id="tab-tasks" role="tabpanel">
        ${helpToggleHtml("How task selection works", "Configure and run your automation tasks. Select a workflow, choose which hosts to target, pick individual tasks or run the full workflow, then click <strong>Run</strong>. Monitor progress in the <strong>Status</strong> tab.")}

        <!-- Card 1+2: Customer & Workflow -->
        <input type="hidden" id="modal_customer" value="${safeText(customer)}" />
        <div class="task-card">
          <h4><span class="step-num">1</span> Workflow <span class="muted" style="font-weight:400;font-size:12px;margin-left:8px;">${safeText(customerDef.label)}</span></h4>
          <p class="muted" id="card1-instructions" style="margin-bottom:6px;font-size:11px;">Select the automation workflow to run. Server Class is only required for Server Build &amp; Configure (J Class = standard rack servers, I Class = high-density/blade servers).</p>
          <div class="workflow-grid">
            <div class="field-group">
              <label>Workflow ${helpTip("Choose the automation workflow. Server Build handles provisioning, Post-Prov handles cleanup and TSR collection.")}</label>
              <select id="modal_workflow" class="inp" onchange="modalWorkflowChanged()">
                ${workflowOptionsHtml}
              </select>
            </div>
            <div class="field-group ${workflow !== "configbuild" ? "field-disabled" : ""}" id="modal_server_class_wrap">
              <label>Server Class ${helpTip("J Class = standard rack servers (R760, R660). I Class = high-density/blade servers (MX). Each uses a separate playbook.")}</label>
              <select id="modal_server_class" class="inp" ${workflow !== "configbuild" ? "disabled" : ""} onchange="modalWorkflowChanged()">
                <option value="J" ${serverClass === "J" ? "selected" : ""}>J Class</option>
                <option value="I" ${serverClass === "I" ? "selected" : ""}>I Class</option>
              </select>
            </div>
          </div>
          <div id="workflow-description" class="workflow-desc">${workflowDescHtml}</div>
          <div id="workflow-extra-options">${workflowExtraOptionsHtml}</div>
        </div>

        <!-- Card 3: Target Hosts / Network Hosts -->
        <div class="task-card" id="card2-wrap">
          <h4><span class="step-num">2</span> <span id="card2-title">Target Hosts</span> <span class="muted" id="host-picker-count"></span></h4>
          <p class="muted" id="card2-instructions" style="margin-bottom:6px;font-size:11px;">Select which hosts to target. Toggle selection with the button below. If none are selected, all hosts will be used.</p>
          <div id="host-picker-container" style="margin-top:6px;">
            ${skeletonRows(2)}
          </div>
          <div id="network-fw-upload"></div>
        </div>

        <!-- Card 4: Run Tasks -->
        <div class="task-card">
          <h4><span class="step-num">3</span> Run Tasks</h4>
          <p class="muted" id="card3-instructions" style="margin-bottom:6px;font-size:11px;">Pick your tasks and let it rip. Use <strong>Stop</strong> to abort. Results appear in the <strong>Status</strong> tab.</p>
          <div id="network-run-summary" style="display:none;"></div>
          <div class="preflight-banner" id="preflight-banner"></div>
          <div id="task-checkboxes-container">${tasksHtml}</div>
          <label class="parallel-mode-label" style="display:flex;align-items:center;gap:6px;font-size:12px;margin:8px 0;cursor:pointer;">
            <input type="checkbox" id="parallel-mode-toggle" onchange="toggleParallelMode(this.checked)" /> Parallel Mode
            <span class="muted" style="font-size:11px;">Split hosts/tasks into groups that run simultaneously</span>
          </label>
          <div id="run-groups-container"></div>
          <button class="btn ghost" id="btn-add-run-group" style="display:none;margin:8px 0;" onclick="addRunGroup()">+ Add Run Group</button>
          <div class="run-controls" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
            <button class="btn primary btn-lg" id="btn_run_tasks"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>Send It <kbd>R</kbd></button>
            <div class="run-spacer"></div>
            <button class="btn danger btn-sm" id="btn_stop_now"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>Stop</button>
            <span class="muted" id="run_status" style="font-size:12px;">Idle</span>
          </div>
        </div>

      </div>

      <!-- Tab: Status -->
      <div class="tab-panel" id="tab-status" role="tabpanel">
        <div class="section">
          ${helpToggleHtml("Live monitoring help", "Monitor your job's progress here. The progress bar shows the current task, elapsed time, and estimated completion. Use <strong>Stop Job</strong> to abort a running job. The <strong>TSR Collection Status</strong> section below shows which servers have diagnostic logs collected. Use <strong>Live Output</strong> at the bottom to view raw Ansible output in real time.")}
          <div id="status-result-banner" class="status-result-banner" style="display:none;"></div>
          <div id="status-progress-bar" class="status-progress-bar" style="display:none;">
            <div class="status-progress-info">
              <span id="status-current-task">Idle</span>
              <span id="status-elapsed" class="muted">\u2014</span>
            </div>
            <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-bar-inner" id="status-progress-fill"></div></div>
          </div>
          <div style="display:flex; gap:8px; align-items:center; margin-top:10px; justify-content:flex-end;">
            <button class="btn danger" id="btn_status_stop"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>Stop Job</button>
          </div>
        </div>

        <div id="host-status-section" class="section" style="display:none;">
          <h4>Per-Host Results</h4>
          <div id="host-status-table"></div>
        </div>

        <div class="section tsr-status-section" id="tsr-status-section">
          <div class="tsr-status-header">
            <h4>TSR Collection Status</h4>
            <span class="tsr-status-badge" id="tsr-status-badge"><span class="skeleton skeleton-inline"></span></span>
          </div>
          <p class="muted" style="margin-bottom:8px;font-size:11px;">TSR (Tech Support Report) files are diagnostic logs collected from each server's iDRAC. Green = collected, red = missing. Check the boxes to select files for download or re-run collection on missing hosts.</p>
          <div id="tsr-status-table"></div>
          <div class="tsr-actions" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-sm ghost" id="btn_tsr_select_all">Select All</button>
            <button class="btn btn-sm ghost" id="btn_refresh_tsr">Refresh</button>
            <div class="run-spacer"></div>
            <button class="btn btn-sm primary" id="btn_rerun_missing_tsr" disabled>Re-run Selected</button>
            <button class="btn btn-sm ghost" id="btn_download_selected_tsr" disabled>Download Selected</button>
            <button class="btn btn-sm ghost" id="btn_delete_selected_tsr" disabled style="color:#f87171;border-color:rgba(248,113,113,0.3);">Delete Selected</button>
          </div>
        </div>

        <div class="section" id="diagnostics-reports-section" style="display:none;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <h4 style="margin:0;display:flex;align-items:center;gap:6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Diagnostics
              <span class="tsr-status-badge" id="diagnostics-reports-badge">0</span>
            </h4>
            <button class="btn ghost" id="btn_download_selected_diagnostics" disabled style="font-size:11px;padding:4px 10px;">Download Selected</button>
          </div>
          <p class="muted" style="margin-bottom:8px;font-size:11px;">Diagnostic reports collected from servers. SupportAssist bundles and hardware diagnostic results.</p>
          <div id="diagnostics-reports-table"></div>
        </div>

        <div class="section" id="pdu-reports-section" style="display:none;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <h4 style="margin:0;display:flex;align-items:center;gap:6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>
              PDU Reports
              <span class="tsr-status-badge" id="pdu-reports-badge">0</span>
            </h4>
            <button class="btn ghost" id="btn_download_selected_pdu" disabled style="font-size:11px;padding:4px 10px;">Download Selected</button>
          </div>
          <p class="muted" style="margin-bottom:8px;font-size:11px;">Output files from PDU configuration and setup tasks.</p>
          <div id="pdu-reports-table"></div>
        </div>

        <div class="section" id="device-reports-section" style="display:none;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <h4 style="margin:0;display:flex;align-items:center;gap:6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
              Other Device Reports
              <span class="tsr-status-badge" id="device-reports-badge">0</span>
            </h4>
            <button class="btn ghost" id="btn_download_selected_device" disabled style="font-size:11px;padding:4px 10px;">Download Selected</button>
          </div>
          <p class="muted" style="margin-bottom:8px;font-size:11px;">Output files from switch, console, and other device tasks.</p>
          <div id="device-reports-table"></div>
        </div>

        <div class="section" id="run-reports-section">
          <h4 style="margin-bottom:4px;display:flex;align-items:center;gap:6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Run Reports &amp; Logs
          </h4>
          <p class="muted" style="margin-bottom:10px;font-size:11px;">Run history grouped by workflow. Expand each section to view or download reports and logs.</p>
          <div id="run-reports-table"></div>
        </div>

        <div class="section">
          <button class="live-output-toggle" id="live-output-toggle" type="button">
            <span class="toggle-chevron" id="live-output-chevron">&#9654;</span>
            Live Output
          </button>
          <div class="live-output-content collapsed" id="live-output-content">
            <div class="log-toolbar">
              <input type="text" class="inp log-search-input" id="log-search-input" placeholder="Search logs..." oninput="filterLogOutput()" />
              <select class="inp log-host-filter" id="log-host-filter" onchange="filterLogOutput()">
                <option value="">All Hosts</option>
              </select>
              <button class="btn ghost" onclick="toggleLogCollapse()" id="btn-log-collapse" title="Collapse/expand TASK sections">Collapse</button>
              <button class="btn ghost" onclick="downloadLogOutput()" title="Download current log view">Download</button>
            </div>
            <pre class="output status-log-output" id="job_log_output">No log yet.</pre>
          </div>
        </div>

      </div>

    </div>
  `;

  // Wire tabs via event delegation (single listener instead of N)
  const tabContainer = qs(".modal-tabs", panel);
  if (tabContainer) {
    tabContainer.addEventListener("click", (e) => {
      const tab = e.target.closest(".modal-tab");
      if (!tab) return;
      qsa(".modal-tab", panel).forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      qsa(".tab-panel", panel).forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const target = $(tab.dataset.tab);
      if (target) target.classList.add("active");
    });
  }

  // Wire actions
  const uploadBtn = $("job_upload_btn");
  if (uploadBtn) uploadBtn.addEventListener("click", () => uploadJobFile(jobId));

  const catalogBtn = $("btn_generate_catalog");
  if (catalogBtn) catalogBtn.addEventListener("click", () => generateCatalog(jobId));

  const invBtn = $("btn_generate_inventory");
  if (invBtn) invBtn.addEventListener("click", () => generateInventory(jobId));

  const runTasksBtn = $("btn_run_tasks");
  if (runTasksBtn) runTasksBtn.addEventListener("click", () => {
    const checked = qsa('.task-cb:checked');
    const total = qsa('.task-cb');
    if (checked.length > 0 && checked.length < total.length) {
      runSelected(jobId);
    } else {
      runFullWorkflow(jobId);
    }
  });

  // Update run button label when checkboxes change
  const taskContainer = $("task-checkboxes-container");
  if (taskContainer) {
    taskContainer.addEventListener("change", () => _updateRunBtnLabel());
  }


  const stopBtn = $("btn_stop_now");
  if (stopBtn) stopBtn.addEventListener("click", () => stopTaskNow(jobId));

  const statusStopBtn = $("btn_status_stop");
  if (statusStopBtn) statusStopBtn.addEventListener("click", () => stopTaskNow(jobId));

  const tsrBtn = $("btn_download_tsr");
  if (tsrBtn) tsrBtn.addEventListener("click", () => downloadTSR(jobId));


  const tsrSelectAllBtn = $("btn_tsr_select_all");
  if (tsrSelectAllBtn) tsrSelectAllBtn.addEventListener("click", () => {
    const allCbs = qsa(".tsr-dl-check, .tsr-rerun-check");
    const allChecked = allCbs.length > 0 && [...allCbs].every(cb => cb.checked);
    allCbs.forEach(cb => { cb.checked = !allChecked; });
    const headerCb = $("tsr-select-all");
    if (headerCb) headerCb.checked = !allChecked;
    tsrSelectAllBtn.textContent = allChecked ? "Select All" : "Deselect All";
    _updateTsrButtons();
  });

  const rerunTsrBtn = $("btn_rerun_missing_tsr");
  if (rerunTsrBtn) rerunTsrBtn.addEventListener("click", () => rerunMissingTsr(jobId, false));

  const refreshTsrBtn = $("btn_refresh_tsr");
  if (refreshTsrBtn) refreshTsrBtn.addEventListener("click", () => loadTsrStatus(jobId));

  const dlSelectedTsrBtn = $("btn_download_selected_tsr");
  if (dlSelectedTsrBtn) dlSelectedTsrBtn.addEventListener("click", () => downloadSelectedTsr(jobId));

  const delSelectedTsrBtn = $("btn_delete_selected_tsr");
  if (delSelectedTsrBtn) delSelectedTsrBtn.addEventListener("click", () => deleteSelectedTsr(jobId));

  const liveOutputToggle = $("live-output-toggle");
  if (liveOutputToggle) liveOutputToggle.addEventListener("click", () => {
    const content = $("live-output-content");
    const chevron = $("live-output-chevron");
    if (content && chevron) {
      const isCollapsed = content.classList.toggle("collapsed");
      chevron.classList.toggle("expanded", !isCollapsed);
    }
  });

  loadAllFiles(job);
  loadInventoryHosts(jobId);
  loadRunHistory(jobId);
  loadTsrStatus(jobId);
  loadOutputReports(jobId);
  updatePreflightChecklist(jobId);
  updateOverviewRunHistory(jobId);
  updateJobReadiness(jobId);
  updateJobTimeline(jobId);

  if (isRunning) {
    updateStatusBar(status);
  }

  // Wire notes auto-save (Feature 5)
  const notesEl = $("job-notes");
  if (notesEl) {
    notesEl.addEventListener("blur", async () => {
      try {
        await apiPatch(`/api/jobs/${encodeURIComponent(jobId)}`, { notes: notesEl.value });
        const indicator = $("notes-saved");
        if (indicator) {
          indicator.classList.add("visible");
          setTimeout(() => indicator.classList.remove("visible"), 2000);
        }
      } catch { /* silent */ }
    });
  }

  // Wire inline edit confirm buttons (Feature 9)
  wireInlineEditConfirm(panel, jobId);

  // Wire drag-and-drop on upload zones
  wireDropZone("upload-zone", "job_upload_file", () => uploadJobFile(jobId));
}

// ─────────────────────────────────────────────────────────────
// Activate tab
// ─────────────────────────────────────────────────────────────
window.activateTab = activateTab;
function activateTab(tabId) {
  const panel = $("job-panel");
  if (!panel) return;
  qsa(".modal-tab", panel).forEach(t => {
    const isActive = t.dataset.tab === tabId;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  qsa(".tab-panel", panel).forEach(p => {
    p.classList.toggle("active", p.id === tabId);
  });
}

// ─────────────────────────────────────────────────────────────
// Inline edit confirm (Feature 9)
// ─────────────────────────────────────────────────────────────
function wireInlineEditConfirm(panel, jobId) {
  qsa(".ie-field", panel).forEach(input => {
    let originalValue = input.value;
    const field = input.dataset.field;
    const actionsEl = $(`ie-${field}`);

    input.addEventListener("focus", () => {
      originalValue = input.value;
      if (actionsEl) actionsEl.classList.add("visible");
    });

    input.addEventListener("input", () => {
      if (input.value !== originalValue) _dirtyFields.add(field);
      else _dirtyFields.delete(field);
      // Real-time validation (Feature 8)
      if (FIELD_VALIDATORS[field]) {
        const result = validateField(field, input.value);
        showFieldValidation(input, result);
        const saveBtn = actionsEl ? actionsEl.querySelector(".ie-save") : null;
        if (saveBtn) saveBtn.disabled = !result.valid;
      }
    });

    // Save button
    if (actionsEl) {
      const saveBtn = actionsEl.querySelector(".ie-save");
      const cancelBtn = actionsEl.querySelector(".ie-cancel");

      if (saveBtn) {
        saveBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          await saveJobField(encodeURIComponent(jobId), field, input.value);
          _dirtyFields.delete(field);
          actionsEl.classList.remove("visible");
          input.blur();
        });
      }

      if (cancelBtn) {
        cancelBtn.addEventListener("click", (e) => {
          e.preventDefault();
          input.value = originalValue;
          _dirtyFields.delete(field);
          actionsEl.classList.remove("visible");
          input.blur();
        });
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Styles (injected once)
// ─────────────────────────────────────────────────────────────
function ensureJobModalStyles() {
  if (document.getElementById("job-modal-styles")) return;

  const style = document.createElement("style");
  style.id = "job-modal-styles";
  style.textContent = `
    /* === Right-side drawer panel === */
    .job-panel-root { position: fixed; inset: 0; z-index: 9999; pointer-events: none; }
    .panel-backdrop  { position: fixed; inset: 0; background: rgba(0,0,0,0.25); pointer-events: auto; }
    .job-panel       { position: fixed; right: 0; top: 0; bottom: 0;
                       width: min(1400px, calc(100vw - 260px));
                       background: var(--bg-body);
                       border-left: 1px solid var(--tab-border);
                       box-shadow: -20px 0 60px rgba(0,0,0,0.5);
                       pointer-events: auto; display: flex; flex-direction: column;
                       animation: slideInRight 0.2s ease-out; }
    @keyframes slideInRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to   { transform: translateX(100%); opacity: 0; }
    }
    .panel-closing { animation: slideOutRight 0.2s ease-in forwards !important; }
    .backdrop-closing { animation: modalFadeIn 0.2s ease-in reverse forwards; }
    .panel-header   { display:flex; align-items:center; justify-content:space-between; gap:12px;
                      padding: 18px 20px; border-bottom:1px solid var(--tab-border); border-top: 3px solid #3b82f6;
                      background: linear-gradient(180deg, rgba(59,130,246,0.06), transparent); flex-shrink: 0; }
    .panel-header-spacer { flex: 1; display: flex; justify-content: flex-end; min-width: 36px; }
    .panel-body     { flex: 1; overflow: auto; padding: 0 20px 20px; }
    .panel-body .modal-tabs { position: sticky; top: 0; z-index: 2; background: var(--bg-body); }

    .modal-title { text-align: center; }
    .modal-title .title-main { font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .modal-title .title-sub  { margin-top: 4px; opacity: 0.75; font-size: 12px; }
    .modal-close    { background: transparent; border: 0; color: var(--text-primary);
                      font-size: 22px; cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 10px; flex-shrink: 0; }
    .modal-close:hover { background: var(--btn-ghost-hover); }

    .section { margin: 12px 0 14px; }
    .section h4 { margin: 0 0 8px; font-size: 14px; opacity: 0.9; }
    .file-list { margin: 0; padding-left: 18px; }
    .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }

    .inp { padding:8px 10px; border-radius:10px; border:1px solid var(--input-border);
           background:var(--input-bg); color:var(--text-primary); min-width: 180px; }

    .inp-inline { padding:4px 8px; border-radius:8px; min-width:0; width:100%; max-width:300px;
                  border:1px solid transparent; background:transparent; font-size:13px; font-weight:500; }
    .inp-inline:hover { border-color:var(--input-border); background:var(--input-bg); }
    .inp-inline:focus { border-color:var(--toggle-checked-border); background:var(--input-bg); outline:none; }

    .output { background: var(--output-bg); border: 1px solid var(--card-border);
              border-radius: 12px; padding: 12px; white-space: pre-wrap; overflow: auto; max-height: 240px;
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }

    .status-log-output { max-height: calc(100vh - 280px); min-height: 300px; }

    .tasks { display:flex; flex-wrap:wrap; gap:10px; }
    .task-chip { display:inline-flex; align-items:center; gap:6px; padding: 6px 12px; border-radius: 999px;
                 border: 1px solid var(--toggle-border); background: var(--toggle-bg);
                 font-size: 12px; cursor: pointer; user-select: none; transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease; }
    .task-chip:hover { border-color: var(--toggle-hover-border); background: var(--toggle-hover-bg); }
    .task-chip:has(input:checked) { border-color: var(--toggle-checked-border); background: var(--toggle-checked-bg); color: var(--toggle-checked-text); }

    .task-chip-disabled { opacity: 0.35; pointer-events: none; cursor: default; }
    .task-chip-disabled:hover { border-color: var(--toggle-border); background: var(--toggle-bg); }
    .task-group-disabled { opacity: 0.4; }

    .modal-footer { display:flex; flex-wrap:wrap; gap:10px; justify-content:flex-end; margin-top: 14px;
                    border-top:1px solid var(--tab-border); padding-top:12px; }

    .muted { opacity: 0.72; font-size: 12px; }
    .error { color: #ff6b6b; }

    .status-progress-bar { background: var(--toggle-bg); border: 1px solid var(--card-border);
                           border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }
    .status-progress-info { display: flex; justify-content: space-between; align-items: center;
                            margin-bottom: 8px; font-size: 13px; }

    .downloads-section { padding: 8px 0; }
    .downloads-list { margin-top: 8px; }

    .wizard-modal-root { position: fixed; inset: 0; z-index: 10000; pointer-events: none; }
    .wizard-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.72); backdrop-filter: blur(2px); pointer-events: auto; animation: modalFadeIn 0.2s ease-out; }
    .wizard-card { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
                   width: min(640px, calc(100vw - 48px)); max-height: min(85vh, 740px);
                   overflow: auto; background: var(--bg-body);
                   border: 1px solid var(--card-border); border-top: 4px solid #3b82f6; border-radius: 16px;
                   box-shadow: 0 20px 80px rgba(0,0,0,0.6); pointer-events: auto; padding: 24px; animation: modalScaleIn 0.2s ease-out; }
    @keyframes modalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes modalScaleIn {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    .confirm-overlay.closing { animation: modalFadeIn 0.15s ease-in reverse forwards; }
    .confirm-overlay.closing .confirm-card { animation: modalScaleIn 0.15s ease-in reverse forwards; }
  `;
  document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────
// Retry failed tasks
// ─────────────────────────────────────────────────────────────
window.retryFailedTasks = function () {
  if (!_lastFailedTasks.length) {
    showToast("No failed tasks to retry", "info");
    return;
  }

  activateTab("tab-tasks");

  // Uncheck all, then check tasks whose labels match failed task names
  const cbs = qsa(".task-cb");
  cbs.forEach(cb => { cb.checked = false; });

  const taskChips = qsa(".task-chip");
  let matched = 0;
  taskChips.forEach(chip => {
    const label = chip.textContent.trim();
    const cb = chip.querySelector(".task-cb");
    if (cb && _lastFailedTasks.some(ft => label.toLowerCase().includes(ft.toLowerCase()) || ft.toLowerCase().includes(label.toLowerCase()))) {
      cb.checked = true;
      matched++;
    }
  });

  // Scroll to run controls
  const runControls = qs(".run-controls");
  if (runControls) runControls.scrollIntoView({ behavior: "smooth", block: "center" });

  if (matched > 0) {
    showToast(`${matched} failed task(s) pre-selected for retry`, "info");
  } else {
    // If we couldn't match by name, check all and let user pick
    cbs.forEach(cb => { cb.checked = true; });
    showToast("Could not match specific tasks \u2014 all tasks selected", "info");
  }
};

// ─────────────────────────────────────────────────────────────
// Save as Template (#19)
// ─────────────────────────────────────────────────────────────
window.saveAsTemplate = async function (jobId) {
  const container = $("confirm-modal-container");
  if (!container) return;
  container.innerHTML = `
    <div class="confirm-overlay" id="template-overlay" role="dialog" aria-modal="true">
      <div class="confirm-card" style="max-width:380px;">
        <div class="confirm-title">Save as Template</div>
        <div style="margin:10px 0;">
          <label class="muted" style="font-size:11px;display:block;margin-bottom:4px;">Template Name</label>
          <input class="inp" id="template-name" placeholder="e.g. Standard R760 Build" style="width:100%;" autofocus />
        </div>
        <div class="confirm-actions">
          <button class="btn ghost" id="template-cancel">Cancel</button>
          <button class="btn primary" id="template-ok">Save Template</button>
        </div>
      </div>
    </div>
  `;
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    const overlay = $("template-overlay");
    if (overlay) {
      overlay.classList.add("closing");
      const clear = () => { container.innerHTML = ""; };
      overlay.addEventListener("animationend", clear, { once: true });
      setTimeout(clear, 300);
    } else container.innerHTML = "";
  };
  $("template-cancel").addEventListener("click", dismiss);
  $("template-overlay").addEventListener("click", (e) => { if (e.target.id === "template-overlay") dismiss(); });
  $("template-ok").addEventListener("click", async () => {
    const name = ($("template-name")?.value || "").trim();
    if (!name) { showToast("Template name is required", "error"); return; }
    dismiss();
    try {
      await apiPostJSON("/api/templates", { jobId: decodeURIComponent(jobId), templateName: name });
      showToast("Template saved", "success");
    } catch (e) {
      showToast("Save template failed: " + e.message, "error");
    }
  });
};
