// ─────────────────────────────────────────────────────────────
// job-panel-history.js — Run history, output reports, run comparison
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Run History
// ─────────────────────────────────────────────────────────────
async function loadRunHistory(jobId) {
  const el = $("run-history-table");
  if (!el) return;

  el.innerHTML = skeletonRows(3);

  try {
    const data = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/runs`);
    const runs = data.runs || [];

    if (!runs.length) {
      el.innerHTML = emptyStateHtml(SVG_PLAY_CIRCLE, "No runs yet", "Go to Tasks", "activateTab('tab-tasks')");
      return;
    }

    const LIMIT = 5;
    const hasMore = runs.length > LIMIT;

    let html = '<table class="host-picker-table"><thead><tr><th>Date/Time</th><th>Tasks</th><th>Result</th><th>Log Size</th><th></th></tr></thead><tbody>';
    runs.forEach((r, i) => {
      const sizeKB = r.logSize ? (r.logSize / 1024).toFixed(1) + " KB" : "\u2014";
      let badge = '<span class="muted">\u2014</span>';
      if (r.result === "passed") badge = '<span class="run-result run-result-passed">passed</span>';
      else if (r.result === "failed") badge = '<span class="run-result run-result-failed">failed</span>';
      const tagsStr = Array.isArray(r.tags) && r.tags.length ? safeText(r.tags.join(", ")) : '<span class="muted">full workflow</span>';
      const hidden = hasMore && i >= LIMIT ? ' class="run-history-extra" style="display:none;"' : "";

      html += `<tr${hidden}>
        <td title="${safeText(r.timestamp)}">${r.timestamp ? timeAgo(r.timestamp) : "\u2014"}</td>
        <td>${tagsStr}</td>
        <td>${badge}</td>
        <td class="muted">${sizeKB}</td>
        <td><button class="btn ghost" style="padding:4px 8px;font-size:11px;" onclick="window.open('/api/jobs/${encodeURIComponent(jobId)}/runs/${encodeURIComponent(r.runId)}/report','_blank')">View Report</button></td>
      </tr>`;
    });
    html += '</tbody></table>';

    if (hasMore) {
      html += `<button class="btn ghost" style="margin-top:8px;font-size:12px;" onclick="toggleRunHistoryExtra(this)">See more (${runs.length - LIMIT})</button>`;
    }

    el.innerHTML = html;

    // Render timeline for runs with parallel groups (Feature 10)
    renderRunTimeline(runs, el);
  } catch {
    el.innerHTML = '<span class="muted">Could not load run history.</span>';
  }
}

// ─────────────────────────────────────────────────────────────
// Timeline / Gantt View for Parallel Runs (Feature 10)
// ─────────────────────────────────────────────────────────────
function renderRunTimeline(runs, containerEl) {
  if (!containerEl || !runs || !runs.length) return;

  // Only show for runs that have 2+ groups
  const parallelRuns = runs.filter(r => Array.isArray(r.groups) && r.groups.length >= 2);
  if (!parallelRuns.length) return;

  // Render timeline for the most recent parallel run
  const run = parallelRuns[0];
  const groups = run.groups;

  // Parse timestamps to find global min/max
  function parseTs(ts) {
    if (!ts) return null;
    const d = new Date(ts.replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }

  let globalStart = Infinity;
  let globalEnd = 0;
  const parsed = groups.map(g => {
    const start = parseTs(g.startedAt);
    const end = parseTs(g.endedAt);
    if (start) globalStart = Math.min(globalStart, start.getTime());
    if (end) globalEnd = Math.max(globalEnd, end.getTime());
    else if (start) globalEnd = Math.max(globalEnd, start.getTime() + 60000); // default 1 min
    return { ...g, _start: start, _end: end };
  });

  if (globalStart === Infinity) return;
  const totalSpan = Math.max(globalEnd - globalStart, 1000); // at least 1s

  // Time axis labels
  const totalMins = Math.ceil(totalSpan / 60000);
  const axisMarks = [];
  const markCount = Math.min(totalMins + 1, 6);
  for (let i = 0; i < markCount; i++) {
    const t = Math.round((i / (markCount - 1)) * totalMins);
    axisMarks.push(t);
  }

  let rowsHtml = parsed.map(g => {
    const startMs = g._start ? g._start.getTime() - globalStart : 0;
    const endMs = g._end ? g._end.getTime() - globalStart : startMs + 60000;
    const leftPct = (startMs / totalSpan) * 100;
    const widthPct = Math.max(((endMs - startMs) / totalSpan) * 100, 2);

    const colorClass = g.result === "passed" ? "tl-passed" :
                       g.result === "failed" ? "tl-failed" : "tl-running";

    const durSecs = g._start && g._end ? Math.round((g._end.getTime() - g._start.getTime()) / 1000) : 0;
    const durStr = durSecs > 0 ? `${Math.floor(durSecs / 60)}m ${durSecs % 60}s` : "";
    const tagsStr = Array.isArray(g.tags) && g.tags.length ? g.tags.join(", ") : "full";
    const tooltip = `${safeText(g.label)}: ${tagsStr}${durStr ? " (" + durStr + ")" : ""}${g.result ? " — " + g.result : ""}`;

    return `<div class="run-timeline-row">
      <div class="run-timeline-label" title="${safeText(g.label)}">${safeText(g.label)}</div>
      <div class="run-timeline-track">
        <div class="run-timeline-bar ${colorClass}" style="left:${leftPct}%;width:${widthPct}%;" title="${tooltip}"></div>
      </div>
    </div>`;
  }).join("");

  // Axis
  const axisHtml = `<div class="run-timeline-axis">
    <div class="run-timeline-label"></div>
    <div class="run-timeline-track run-timeline-axis-track">
      ${axisMarks.map(m => {
        const pct = totalMins > 0 ? (m / totalMins) * 100 : 0;
        return `<span class="run-timeline-mark" style="left:${pct}%">${m}m</span>`;
      }).join("")}
    </div>
  </div>`;

  const timelineHtml = `<div class="run-timeline">
    <div class="run-timeline-header">Parallel Run Timeline</div>
    ${rowsHtml}
    ${axisHtml}
  </div>`;

  containerEl.insertAdjacentHTML("beforeend", timelineHtml);
}

window.toggleRunHistoryExtra = toggleRunHistoryExtra;
function toggleRunHistoryExtra(btn) {
  const container = btn.parentElement;
  const extras = qsa(".run-history-extra", container);
  const showing = extras[0] && extras[0].style.display !== "none";
  extras.forEach(tr => { tr.style.display = showing ? "none" : ""; });
  btn.textContent = showing ? `See more (${extras.length})` : "Show less";
}

// ─────────────────────────────────────────────────────────────
// Overview — Tasks Completed + Running Status
// ─────────────────────────────────────────────────────────────
async function updateOverviewRunHistory(jobId) {
  const el = $("overview-run-history");
  if (!el) return;

  try {
    const [runsData, job] = await Promise.all([
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}/runs`),
      apiGet(`/api/jobs/${encodeURIComponent(jobId)}`),
    ]);

    const runs = runsData.runs || [];
    const status = (job.status || "idle").toLowerCase();
    const lastRunTags = Array.isArray(job.lastRunTags) ? job.lastRunTags : [];

    // Update running status section
    const runSection = $("overview-running-status");
    const runDetail = $("overview-running-detail");
    if (runSection && runDetail) {
      if (status === "running") {
        runSection.style.display = "";
        const tagsStr = lastRunTags.length ? lastRunTags.join(", ") : "full workflow";
        runDetail.textContent = safeText(tagsStr);
      } else {
        runSection.style.display = "none";
      }
    }

    // Run history table (same format as Run History tab)
    if (!runs.length) {
      el.innerHTML = emptyStateHtml(SVG_PLAY_CIRCLE, "No runs yet", "Go to Tasks", "activateTab('tab-tasks')");
      return;
    }

    const LIMIT = 5;
    const hasMore = runs.length > LIMIT;

    let html = '<table class="host-picker-table"><thead><tr><th>Date/Time</th><th>Tasks</th><th>Result</th><th>Log Size</th><th></th></tr></thead><tbody>';
    runs.forEach((r, i) => {
      const sizeKB = r.logSize ? (r.logSize / 1024).toFixed(1) + " KB" : "\u2014";
      let badge = '<span class="muted">\u2014</span>';
      if (r.result === "passed") badge = '<span class="run-result run-result-passed">passed</span>';
      else if (r.result === "failed") badge = '<span class="run-result run-result-failed">failed</span>';
      const tagsStr = Array.isArray(r.tags) && r.tags.length ? safeText(r.tags.join(", ")) : '<span class="muted">full workflow</span>';
      const hidden = hasMore && i >= LIMIT ? ' class="run-history-extra" style="display:none;"' : "";

      html += `<tr${hidden}>
        <td title="${safeText(r.timestamp)}">${r.timestamp ? timeAgo(r.timestamp) : "\u2014"}</td>
        <td>${tagsStr}</td>
        <td>${badge}</td>
        <td class="muted">${sizeKB}</td>
        <td><button class="btn ghost" style="padding:4px 8px;font-size:11px;" onclick="window.open('/api/jobs/${encodeURIComponent(jobId)}/runs/${encodeURIComponent(r.runId)}/report','_blank')">View Report</button></td>
      </tr>`;
    });
    html += '</tbody></table>';

    if (hasMore) {
      html += `<button class="btn ghost overview-see-more" style="margin-top:8px;font-size:12px;" onclick="toggleRunHistoryExtra(this)">See more (${runs.length - LIMIT})</button>`;
    }

    // Run comparison button (Feature 8)
    if (runs.length >= 2) {
      html += `<button class="btn ghost" style="margin-top:8px;font-size:12px;" onclick="renderRunComparison()">Compare last 2 runs</button>`;
      html += '<div id="run-compare-container"></div>';
    }

    el.innerHTML = html;
  } catch {
    el.innerHTML = '<span class="muted">Could not load run history.</span>';
  }
}

// Run comparison (Feature 8)
window.renderRunComparison = async function () {
  const container = $("run-compare-container");
  if (!container || !currentJobId) return;

  // Toggle off if already showing
  if (container.innerHTML) { container.innerHTML = ""; return; }

  try {
    const runsData = await apiGet(`/api/jobs/${encodeURIComponent(currentJobId)}/runs`);
    const runs = runsData.runs || [];
    if (runs.length < 2) return;

    const r1 = runs[0]; // most recent
    const r2 = runs[1]; // second most recent

    function compRow(label, v1, v2) {
      const diff = v1 !== v2;
      return `<div class="run-compare-row"><span>${safeText(label)}</span><span${diff ? ' class="run-compare-diff"' : ''}>${safeText(String(v1))}</span></div>`;
    }

    function runCol(r, label) {
      const tagsStr = Array.isArray(r.tags) && r.tags.length ? r.tags.join(", ") : "full workflow";
      const sizeKB = r.logSize ? (r.logSize / 1024).toFixed(1) + " KB" : "\u2014";
      const resultDiff = r1.result !== r2.result;
      return `<div class="run-compare-col">
        <h5>${safeText(label)}</h5>
        <div class="run-compare-row"><span>Time</span><span>${r.timestamp ? timeAgo(r.timestamp) : "\u2014"}</span></div>
        <div class="run-compare-row"><span>Tasks</span><span>${safeText(tagsStr)}</span></div>
        <div class="run-compare-row"><span>Result</span><span${resultDiff ? ' class="run-compare-diff"' : ''}>${safeText(r.result || "\u2014")}</span></div>
        <div class="run-compare-row"><span>Log Size</span><span>${sizeKB}</span></div>
      </div>`;
    }

    container.innerHTML = `<div class="run-compare-grid">
      ${runCol(r1, "Latest Run")}
      ${runCol(r2, "Previous Run")}
    </div>`;
  } catch {
    container.innerHTML = '<span class="muted">Could not load runs for comparison.</span>';
  }
};

// ─────────────────────────────────────────────────────────────
// PDU & Device Reports
// ─────────────────────────────────────────────────────────────

function _buildReportTable(files, checkClass) {
  if (!files.length) return `<p class="muted" style="font-size:12px;">No report files found.</p>`;
  let rows = files.map(f => {
    const sizeKb = (f.size / 1024).toFixed(1);
    return `<tr>
      <td><input type="checkbox" class="${checkClass}" data-file="${safeText(f.filename)}" data-path="${safeText(f.path || "")}" /></td>
      <td style="font-size:12px;">${safeText(f.filename)}</td>
      <td class="muted" style="font-size:11px;">${sizeKb} KB</td>
      <td class="muted" style="font-size:11px;">${safeText(f.modified)}</td>
      <td><button class="btn ghost" style="padding:2px 8px;font-size:11px;" onclick="window._downloadSingleFile(this)" data-path="${safeText(f.path || "")}">Download</button></td>
    </tr>`;
  }).join("");
  return `<table class="tsr-status-table">
    <thead><tr><th><input type="checkbox" class="${checkClass}-all" title="Select all" /></th><th>File</th><th>Size</th><th>Modified</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _applyReportRowLimit(containerEl) {
  if (containerEl) applyTableRowLimit(containerEl);
}

function _wireReportCheckboxes(containerEl, checkClass, downloadBtn) {
  if (!containerEl) return;
  const selectAll = qs(`.${checkClass}-all`, containerEl);
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      qsa(`.${checkClass}`, containerEl).forEach(cb => { cb.checked = selectAll.checked; });
      if (downloadBtn) downloadBtn.disabled = !selectAll.checked;
    });
  }
  qsa(`.${checkClass}`, containerEl).forEach(cb => {
    cb.addEventListener("change", () => {
      const anyChecked = qsa(`.${checkClass}:checked`, containerEl).length > 0;
      if (downloadBtn) downloadBtn.disabled = !anyChecked;
    });
  });
}

window._downloadSingleFile = function (btn) {
  const fpath = btn.dataset.path;
  if (!fpath) return;
  const fname = fpath.split("/").pop();
  const jobId = _currentJobId;
  // Use a generic file download approach
  const a = document.createElement("a");
  a.href = `/api/jobs/${encodeURIComponent(jobId)}/download_output?path=${encodeURIComponent(fpath)}`;
  a.download = fname;
  a.click();
};

async function loadOutputReports(jobId) {
  // Load Diagnostics reports
  try {
    const diagData = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/outputs/diagnostics`);
    const diagFiles = diagData.files || [];
    const diagSection = $("diagnostics-reports-section");
    const diagTable = $("diagnostics-reports-table");
    const diagBadge = $("diagnostics-reports-badge");
    const diagDlBtn = $("btn_download_selected_diagnostics");

    if (diagFiles.length > 0 && diagSection) {
      diagSection.style.display = "";
      if (diagBadge) { diagBadge.textContent = diagFiles.length; diagBadge.className = "tsr-status-badge"; }
      if (diagTable) {
        diagTable.innerHTML = _buildReportTable(diagFiles, "diag-report-check");
        _wireReportCheckboxes(diagTable, "diag-report-check", diagDlBtn);
        _applyReportRowLimit(diagTable);
      }
      if (diagDlBtn) {
        diagDlBtn.onclick = () => _downloadCheckedFiles("diag-report-check", jobId, "diagnostics");
      }
    }
  } catch (e) { /* silent */ }

  // Load PDU reports
  try {
    const pduData = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/outputs/pdu`);
    const pduFiles = pduData.files || [];
    const pduSection = $("pdu-reports-section");
    const pduTable = $("pdu-reports-table");
    const pduBadge = $("pdu-reports-badge");
    const pduDlBtn = $("btn_download_selected_pdu");

    if (pduFiles.length > 0 && pduSection) {
      pduSection.style.display = "";
      if (pduBadge) { pduBadge.textContent = pduFiles.length; pduBadge.className = "tsr-status-badge"; }
      if (pduTable) {
        pduTable.innerHTML = _buildReportTable(pduFiles, "pdu-report-check");
        _wireReportCheckboxes(pduTable, "pdu-report-check", pduDlBtn);
        _applyReportRowLimit(pduTable);
      }
      if (pduDlBtn) {
        pduDlBtn.onclick = () => _downloadCheckedFiles("pdu-report-check", jobId, "pdu_reports");
      }
    }
  } catch (e) { /* silent */ }

  // Load device reports (switches, consoles)
  try {
    const devData = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/outputs/switches`);
    const devFiles = devData.files || [];
    const devSection = $("device-reports-section");
    const devTable = $("device-reports-table");
    const devBadge = $("device-reports-badge");
    const devDlBtn = $("btn_download_selected_device");

    if (devFiles.length > 0 && devSection) {
      devSection.style.display = "";
      if (devBadge) { devBadge.textContent = devFiles.length; devBadge.className = "tsr-status-badge"; }
      if (devTable) {
        devTable.innerHTML = _buildReportTable(devFiles, "device-report-check");
        _wireReportCheckboxes(devTable, "device-report-check", devDlBtn);
        _applyReportRowLimit(devTable);
      }
      if (devDlBtn) {
        devDlBtn.onclick = () => _downloadCheckedFiles("device-report-check", jobId, "device_reports");
      }
    }
  } catch (e) { /* silent */ }

  // Load run reports & logs grouped by workflow
  try {
    const runsData = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/runs`);
    const runs = runsData.runs || [];
    const reportsTable = $("run-reports-table");

    if (reportsTable) {
      if (!runs.length) {
        reportsTable.innerHTML = `<p class="muted" style="font-size:12px;">No run reports yet. Run a task to generate reports.</p>`;
      } else {
        // Group runs by workflow
        const groups = {};
        for (const r of runs) {
          const wf = r.workflow || "unknown";
          if (!groups[wf]) groups[wf] = [];
          groups[wf].push(r);
        }

        const workflowLabels = {
          configbuild: "Server Build & Configure",
          postprov: "Post-Provisioning",
          quickqc: "Quick QC Validation",
          cisco_switch: "Cisco Switch",
          juniper_switch: "Juniper Switch",
          console_switch: "Console Switch",
          pdu: "PDU Setup",
        };

        const reportIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;opacity:0.6;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        const logIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;opacity:0.6;"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';

        let html = "";
        for (const [wf, wfRuns] of Object.entries(groups)) {
          const label = workflowLabels[wf] || wf;
          const count = wfRuns.length;
          const lastResult = wfRuns[0].result;
          const resultDot = lastResult === "passed" ? '<span style="color:#22c55e;font-size:18px;line-height:1;vertical-align:middle;">&#8226;</span>'
            : lastResult === "failed" ? '<span style="color:#ef4444;font-size:18px;line-height:1;vertical-align:middle;">&#8226;</span>'
            : '<span style="color:var(--text-muted);font-size:18px;line-height:1;vertical-align:middle;">&#8226;</span>';
          const groupId = `run-group-${safeText(wf)}`;

          let rows = wfRuns.map(r => {
            const resultBadge = r.result === "passed" ? '<span style="color:#22c55e;font-size:11px;">passed</span>'
              : r.result === "failed" ? '<span style="color:#ef4444;font-size:11px;">failed</span>'
              : '<span class="muted" style="font-size:11px;">\u2014</span>';
            const logSizeKb = (r.logSize / 1024).toFixed(1);
            const tags = (r.tags || []).length ? r.tags.join(", ") : "full";
            return `<tr>
              <td style="font-size:12px;">${safeText(r.timestamp)}</td>
              <td style="font-size:11px;">${tags}</td>
              <td>${resultBadge}</td>
              <td class="muted" style="font-size:11px;">${logSizeKb} KB</td>
              <td style="white-space:nowrap;">
                <button class="btn ghost" style="padding:2px 8px;font-size:11px;" onclick="window.open('/api/jobs/${encodeURIComponent(jobId)}/runs/${encodeURIComponent(r.runId)}/report','_blank')">${reportIcon}Report</button>
                <button class="btn ghost" style="padding:2px 8px;font-size:11px;" onclick="window._downloadRunLog('${safeText(r.runId)}')">${logIcon}Log</button>
              </td>
            </tr>`;
          }).join("");

          html += `<div class="run-group" style="margin-bottom:6px;">
            <button class="live-output-toggle" type="button" onclick="toggleRunGroup('${groupId}')" style="width:100%;">
              <span class="toggle-chevron" id="${groupId}-chevron">&#9654;</span>
              ${resultDot} ${safeText(label)}
              <span class="tsr-status-badge" style="margin-left:auto;">${count} run${count !== 1 ? "s" : ""}</span>
            </button>
            <div class="live-output-content collapsed" id="${groupId}">
              <table class="tsr-status-table" style="margin-top:6px;">
                <thead><tr><th>Date</th><th>Tags</th><th>Result</th><th>Log Size</th><th>Actions</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>`;
        }

        reportsTable.innerHTML = html;
      }
    }
  } catch (e) { /* silent */ }
}

window.toggleRunGroup = function (groupId) {
  const content = $(groupId);
  const chevron = $(groupId + "-chevron");
  if (!content) return;
  content.classList.toggle("collapsed");
  if (chevron) chevron.classList.toggle("expanded");
};

window._downloadRunLog = function (runId) {
  const jobId = _currentJobId;
  if (!jobId || !runId) return;
  // Fetch log and download as text file
  apiGet(`/api/jobs/${encodeURIComponent(jobId)}/log`).then(data => {
    const logText = data.log || data.content || JSON.stringify(data, null, 2);
    const blob = new Blob([logText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `run_${runId}_log.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(e => showToast("Failed to download log: " + e.message, "error"));
};

async function _downloadCheckedFiles(checkClass, jobId, zipName) {
  const checked = qsa(`.${checkClass}:checked`);
  const paths = [...checked].map(cb => cb.dataset.path).filter(Boolean);
  if (!paths.length) {
    showToast("Select at least one file to download", "info");
    return;
  }
  try {
    const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/download_outputs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || "Download failed");
    }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${zipName}_${jobId}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Downloaded ${paths.length} file(s)`, "success");
  } catch (e) {
    showToast("Download failed: " + e.message, "error");
  }
}
