// ─────────────────────────────────────────────────────────────
// job-panel-tasks.js — Task presets, checkboxes, preflight checks, run summary
// ─────────────────────────────────────────────────────────────

function getActiveTaskKey(workflow, serverClass) {
  if (workflow === "configbuild") {
    const sc = (serverClass || "J").toUpperCase();
    return sc === "I" ? "configbuild_i" : "configbuild_j";
  }
  return workflow;
}

// ─── Task Presets (Feature 4) ───
const TASK_PRESETS = {
  configbuild_i: [
    { id: "full",  label: "Full Stack",   desc: "All 7 tasks", detail: "PowerUp \u2192 LLDP \u2192 RackSlot \u2192 Asset Tag \u2192 Firmware \u2192 Power Cycle \u2192 Import XML", taskIds: null },
    { id: "quick", label: "Quick Deploy", desc: "RackSlot + Asset Tag + Firmware", taskIds: ["rackslot","assettag","firmware"] },
    { id: "custom",label: "Custom",       desc: "Pick your own", taskIds: "custom" },
  ],
  configbuild_j: [
    { id: "full",  label: "Full Stack",   desc: "All 7 tasks", detail: "PowerUp \u2192 LLDP \u2192 RackSlot \u2192 Asset Tag \u2192 Firmware \u2192 Power Cycle \u2192 Configure iDRAC", taskIds: null },
    { id: "quick", label: "Quick Deploy", desc: "RackSlot + Asset Tag + Firmware", taskIds: ["rackslot","assettag","firmware"] },
    { id: "custom",label: "Custom",       desc: "Pick your own", taskIds: "custom" },
  ],
  postprov: [
    { id: "full",  label: "Full Stack",   desc: "All 5 tasks", detail: "Diagnostics \u2192 Disable LLDP \u2192 Collect TSR \u2192 CleanUp \u2192 PowerDown", taskIds: null },
    { id: "quick", label: "Quick Deploy", desc: "TSR + CleanUp + PowerDown", taskIds: ["tsr","cleanup","powerdown"] },
    { id: "custom",label: "Custom",       desc: "Pick your own", taskIds: "custom" },
  ],
};

window.applyTaskPreset = function (presetId, activeKey) {
  const presets = TASK_PRESETS[activeKey];
  if (!presets) return;

  // Update active button
  qsa(".task-preset-btn").forEach(b => b.classList.toggle("active", b.dataset.preset === presetId));

  // Show/hide detail line
  const detailEl = $("preset-detail");
  if (detailEl) {
    const active = presets.find(p => p.id === presetId);
    detailEl.textContent = active && active.detail ? active.detail : "";
  }

  const customArea = qs(".task-custom-area");
  const preset = presets.find(p => p.id === presetId);
  if (!preset) return;

  const cbs = qsa(".task-cb");

  if (preset.taskIds === "custom") {
    // Show custom area, uncheck all tasks so user picks their own
    cbs.forEach(cb => { cb.checked = false; });
    if (customArea) customArea.classList.remove("hidden");
  } else {
    // Hide custom area
    if (customArea) customArea.classList.add("hidden");
    if (preset.taskIds === null) {
      // Full stack: check all
      cbs.forEach(cb => { cb.checked = true; });
    } else {
      // Named preset: check only matching
      cbs.forEach(cb => {
        const cbId = cb.dataset.taskid || "";
        cb.checked = preset.taskIds.includes(cbId);
      });
    }
  }
  _updateRunBtnLabel();
};

function buildTaskCheckboxes(activeKey, projectId, filterIds) {
  const taskDefs = getTaskDefs(projectId);
  let tasks = taskDefs[activeKey] || [];
  if (filterIds) {
    tasks = tasks.filter(t => filterIds.includes(t.id));
  }

  const noTaskMessages = {
    quickqc:  { title: "Quick QC Validation", desc: "Runs entire playbook. No individual task selection needed." },
    pdu:      { title: "PDU Configuration", desc: "Runs PDU configuration script. No individual task selection needed." },
  };

  if (!tasks.length) {
    const info = noTaskMessages[activeKey];
    if (info) {
      return `<div class="task-group-active" data-task-group="${activeKey}">
        <div class="task-info-card">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <div>
            <div class="task-info-title">${info.title}</div>
            <div class="task-info-desc">${info.desc}</div>
          </div>
        </div>
      </div>`;
    }
    return `<div class="task-group-active" data-task-group="${activeKey}">
      <span class="muted" style="font-size:12px;">No individual tasks \u2014 runs entire workflow</span>
    </div>`;
  }

  const presets = TASK_PRESETS[activeKey];
  let presetsHtml = "";
  if (presets) {
    const fullPreset = presets.find(p => p.id === "full");
    const detailText = fullPreset && fullPreset.detail ? fullPreset.detail : "";
    presetsHtml = `<div class="task-presets">${helpTip("Choose which playbook steps to run. Full Stack runs all.")}<br/>${presets.map(p =>
      `<button class="task-preset-btn${p.id === "full" ? " active" : ""}" data-preset="${p.id}" onclick="applyTaskPreset('${p.id}','${activeKey}')">
        ${p.label} <span class="task-preset-desc">${p.desc}</span>
      </button>`
    ).join("")}</div>
    <div class="task-preset-detail muted" id="preset-detail" style="font-size:11px;margin:6px 0 2px;padding:0 2px;">${detailText}</div>`;
  }

  const checkboxHtml = `<div class="task-custom-area${presets ? " hidden" : ""}">
    <div class="task-toolbar">
      <button class="btn ghost" style="padding:4px 10px;font-size:11px;" onclick="toggleAllTasks(this)">Select All</button>
      <input type="text" class="inp task-search" placeholder="Filter tasks..." oninput="filterTaskChips(this.value)" />
    </div>
    <div class="tasks">
      ${tasks.map(t => `<label class="task-chip">
        <input type="checkbox" class="task-cb" data-tags="${t.tags.join(",")}" data-group="${activeKey}" data-taskid="${t.id}" checked /> ${t.label}
      </label>`).join("")}
    </div>
  </div>`;

  return `<div class="task-group-active" data-task-group="${activeKey}">
    ${presetsHtml}
    ${checkboxHtml}
  </div>`;
}

// Toggle all task checkboxes
window.toggleAllTasks = function (btn) {
  const cbs = qsa('.task-cb');
  const allChecked = cbs.length > 0 && [...cbs].every(cb => cb.checked);
  cbs.forEach(cb => cb.checked = !allChecked);
  if (btn) btn.textContent = allChecked ? "Select All" : "Deselect All";
  _updateRunBtnLabel();
};

// Task filter (#8)
window.filterTaskChips = function (query) {
  const q = (query || "").toLowerCase().trim();
  qsa(".task-chip").forEach(chip => {
    const label = chip.textContent.toLowerCase();
    chip.classList.toggle("task-chip-hidden", q && !label.includes(q));
  });
};

function collectSelectedTags() {
  const cbs = qsa(".task-cb:checked:not([disabled])");
  const tags = cbs.flatMap(cb => safeText(cb.dataset.tags).split(",").map(s => s.trim()).filter(Boolean));
  return Array.from(new Set(tags));
}

// ─────────────────────────────────────────────────────────────
// Pre-flight checks
// ─────────────────────────────────────────────────────────────
async function runPreflightChecks(jobId) {
  const warnings = [];
  const blockers = [];

  try {
    const inv = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/inventory_hosts`);
    if (!inv.hosts || inv.hosts.length === 0) {
      blockers.push("No inventory hosts found. Generate inventory first.");
    }

    const job = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}`);
    const files = job.files || [];
    const workflow = (job.workflow || "configbuild").toLowerCase();

    const hasWorkbook = files.some(f => f.role === "workbook");
    if (!hasWorkbook) {
      warnings.push("No workbook uploaded.");
    }

    if (workflow === "configbuild") {
      const hasBiosXml = files.some(f => f.role === "bios_xml");
      const hasFirmware = files.some(f => f.role === "firmware");
      if (!hasBiosXml) warnings.push("No BIOS XML config uploaded.");
      if (!hasFirmware) warnings.push("No firmware files uploaded.");
    }
  } catch (e) {
    warnings.push("Could not complete pre-flight checks: " + e.message);
  }

  if (blockers.length === 0 && warnings.length === 0) {
    // Clear any previous banner
    const pfBanner = $("preflight-banner");
    if (pfBanner) { pfBanner.className = "preflight-banner"; pfBanner.innerHTML = ""; }
    return true;
  }

  // Show persistent banner in Tasks tab (#1)
  const pfBanner = $("preflight-banner");
  if (pfBanner) {
    const isBlocker = blockers.length > 0;
    const items = isBlocker ? blockers : warnings;
    const fixLinks = [];
    items.forEach(msg => {
      let fix = "";
      if (msg.toLowerCase().includes("inventory") || msg.toLowerCase().includes("hosts")) {
        fix = `<button class="pf-fix-link" onclick="activateTab('tab-inventory')">Go to Inventory</button>`;
      } else if (msg.toLowerCase().includes("workbook") || msg.toLowerCase().includes("uploaded") || msg.toLowerCase().includes("firmware") || msg.toLowerCase().includes("bios")) {
        fix = `<button class="pf-fix-link" onclick="activateTab('tab-upload')">Go to Upload</button>`;
      }
      fixLinks.push(`<li>${safeText(msg)} ${fix}</li>`);
    });

    pfBanner.className = `preflight-banner ${isBlocker ? "preflight-banner-error" : "preflight-banner-warn"}`;
    pfBanner.innerHTML = `<button class="pf-dismiss" onclick="this.parentElement.className='preflight-banner'">&times;</button>
      <strong>${isBlocker ? "Cannot run" : "Warnings"}</strong>
      <ul>${fixLinks.join("")}</ul>`;
    pfBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (blockers.length > 0) {
    return false;
  }

  return showConfirmAsync("Pre-flight warnings:\n\n" + warnings.join("\n") + "\n\nProceed anyway?", {
    title: "Pre-flight Warnings", confirmText: "Proceed Anyway",
  });
}

// ─────────────────────────────────────────────────────────────
// Tasks Completed — shows run history summary
// ─────────────────────────────────────────────────────────────
async function updatePreflightChecklist(jobId) {
  const results = $("preflight-results");
  if (!results) return;

  try {
    const [runsData, job] = await Promise.all([
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}/runs`),
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}`),
    ]);

    const runs = runsData.runs || [];
    const lastRunTags = Array.isArray(job.lastRunTags) ? job.lastRunTags : [];
    const status = (job.status || "idle").toLowerCase();

    if (!runs.length && status !== "running") {
      results.innerHTML = '<span class="muted">No tasks run yet.</span>';
      return;
    }

    let html = "";

    // Show current run if running
    if (status === "running") {
      const tagsStr = lastRunTags.length ? lastRunTags.join(", ") : "full workflow";
      html += `<div class="preflight-item"><span class="preflight-ok" style="color:#60a5fa;">\u25B6</span> <strong>Running:</strong> ${safeText(tagsStr)}</div>`;
    }

    // Show completed runs (most recent first, limit 5)
    const completedRuns = runs.filter(r => r.result);
    completedRuns.slice(0, 5).forEach(r => {
      const isPassed = r.result === "passed";
      const icon = isPassed ? "\u2714" : "\u2718";
      const cls = isPassed ? "preflight-ok" : "preflight-miss";
      const when = r.timestamp ? timeAgo(r.timestamp) : "";
      const runTags = Array.isArray(r.tags) && r.tags.length ? r.tags.join(", ") : "full workflow";
      const reportUrl = `/api/jobs/${encodeURIComponent(jobId)}/runs/${encodeURIComponent(r.runId)}/report`;
      html += `<div class="preflight-item" style="display:flex;align-items:center;gap:8px;">
        <span class="${cls}">${icon}</span>
        <span style="flex:1;">${safeText(runTags)} — ${safeText(r.result)} — ${safeText(when)}</span>
        <button class="btn ghost" style="padding:2px 8px;font-size:11px;" onclick="window.open('${reportUrl}','_blank')">View Report</button>
      </div>`;
    });

    if (!completedRuns.length && status !== "running") {
      html += '<span class="muted">No completed runs yet.</span>';
    }

    results.innerHTML = html;
  } catch {
    results.innerHTML = '<span class="muted">Could not load task history.</span>';
  }
}

window._updateRunBtnLabel = _updateRunBtnLabel;
function _updateRunBtnLabel() {
  const btn = $("btn_run_tasks");
  if (!btn) return;
  const checked = qsa('.task-cb:checked');
  const total = qsa('.task-cb');
  const playSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  if (checked.length > 0 && checked.length < total.length) {
    btn.innerHTML = `${playSvg}Yeet ${checked.length} Task${checked.length !== 1 ? "s" : ""} <kbd>R</kbd>`;
  } else {
    btn.innerHTML = `${playSvg}Send It <kbd>R</kbd>`;
  }
}

async function buildRunSummaryHtml(jobId, tags) {
  const checkedHosts = qsa(".host-cb:checked");
  const allHosts = qsa(".host-cb");
  const totalHosts = allHosts.length;
  const hostStr = (!checkedHosts.length || checkedHosts.length === allHosts.length)
    ? `All ${totalHosts}` : `${checkedHosts.length} of ${totalHosts}`;

  const wfVal = safeText($("modal_workflow")?.value || "configbuild").toLowerCase();
  const scVal = safeText($("modal_server_class")?.value || "").trim();
  const wfOptions = getWorkflowOptions(_activeCustomer);
  const wfOption = wfOptions.find(o => o.value === wfVal);
  let wfLabel = wfOption ? wfOption.label : wfVal;
  if (wfVal === "configbuild" && scVal) wfLabel += ` (${scVal.toUpperCase()})`;

  const tagsStr = tags.length ? tags.join(", ") : "Full workflow";

  // Collect warnings
  const warnings = [];
  try {
    const job = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}`);
    const rawFiles = job.files || [];
    const workflow = (job.workflow || "configbuild").toLowerCase();
    if (!rawFiles.some(f => f.role === "workbook")) warnings.push("No workbook");
    if (workflow === "configbuild") {
      if (!rawFiles.some(f => f.role === "firmware")) warnings.push("No firmware");
      if (!rawFiles.some(f => f.role === "bios_xml")) warnings.push("No BIOS XML");
    }
  } catch { /* silent */ }

  let html = `<div class="run-summary">
    <div class="run-summary-grid">
      <span class="run-summary-label">Workflow</span><span class="run-summary-value">${safeText(wfLabel)}</span>
      <span class="run-summary-label">Tasks</span><span class="run-summary-value">${safeText(tagsStr)}</span>
      <span class="run-summary-label">Hosts</span><span class="run-summary-value">${safeText(hostStr)}</span>
    </div>`;

  if (warnings.length) {
    html += `<div class="run-summary-warnings">${warnings.map(w =>
      `<span class="run-summary-warn">${safeText(w)}</span>`
    ).join("")}</div>`;
  }

  html += `</div>`;
  return html;
}
