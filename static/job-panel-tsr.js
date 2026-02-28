// ─────────────────────────────────────────────────────────────
// job-panel-tsr.js — TSR status, download, delete, re-run
// ─────────────────────────────────────────────────────────────

// _currentJobId is declared in job-panel-core.js (shared state)
let _tsrStatusData = null;

async function loadTsrStatus(jobId) {
  const tableEl = $("tsr-status-table");
  const badge = $("tsr-status-badge");
  const rerunBtn = $("btn_rerun_missing_tsr");
  if (!tableEl) return;

  tableEl.innerHTML = skeletonRows(3);

  try {
    const data = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/tsr_status`);
    _tsrStatusData = data;
    const s = data.summary || {};
    const collected = data.collected || [];
    const missing = data.missing || [];
    const duplicateSerials = new Set((data.duplicates || []).map(d => d.serial));

    // Update badge
    if (badge) {
      if (s.total === 0 && collected.length === 0) {
        badge.textContent = "No TSR data";
        badge.className = "tsr-status-badge";
      } else if (s.missing === 0) {
        badge.textContent = `${s.collected}/${s.total} collected`;
        badge.className = "tsr-status-badge complete";
      } else {
        badge.textContent = `${s.collected}/${s.total} collected`;
        badge.className = "tsr-status-badge warning";
      }
    }

    // Build table
    if (collected.length === 0 && missing.length === 0) {
      tableEl.innerHTML = `<p class="muted" style="font-size:13px;">No TSR files found. Run the TSR collection task first.</p>`;
    } else {
      const checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      const xSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

      let rows = "";
      // Collected rows with download checkbox
      for (const c of collected) {
        const isDup = duplicateSerials.has(c.serial);
        const rowClass = isDup ? "tsr-row-duplicate" : "";
        const icon = isDup ? `<span class="tsr-icon-duplicate">${checkSvg}</span>` : `<span class="tsr-icon-collected">${checkSvg}</span>`;
        const filesData = safeText(JSON.stringify(c.files));
        // Show files with delete buttons
        const filesHtml = `<div style="display:flex;flex-direction:column;gap:3px;">` +
          c.files.map(f => `<div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;">${safeText(f)}</span>
            <button class="btn ghost tsr-delete-btn" data-file="${safeText(f)}" title="Delete this TSR file" style="padding:1px 5px;font-size:10px;color:#f87171;border-color:rgba(248,113,113,0.3);line-height:1;">&times;</button>
          </div>`).join("") + `</div>`;
        const dupBadge = isDup ? `<span class="tsr-file-badge" style="margin-left:4px;">${c.fileCount} files</span>` : "";
        rows += `<tr class="${rowClass}">
          <td><input type="checkbox" class="tsr-dl-check" data-files='${filesData}' /></td>
          <td>${safeText(c.name || "\u2014")}</td>
          <td>${safeText(c.serial)}${dupBadge}</td>
          <td>${_ipLink(c.ip)}</td>
          <td>${safeText(c.mac || "\u2014")}</td>
          <td>${safeText(c.part_number || "\u2014")}</td>
          <td>${safeText(c.rack_unit || "\u2014")}</td>
          <td>${icon}</td>
          <td>${filesHtml}</td>
        </tr>`;
      }
      // Missing rows with re-run checkbox
      for (const m of missing) {
        rows += `<tr class="tsr-row-missing">
          <td><input type="checkbox" class="tsr-rerun-check" data-serial="${safeText(m.serial)}" data-ip="${safeText(m.ip || "")}" checked /></td>
          <td>${safeText(m.name || "\u2014")}</td>
          <td>${safeText(m.serial)}</td>
          <td>${_ipLink(m.ip)}</td>
          <td>${safeText(m.mac || "\u2014")}</td>
          <td>${safeText(m.part_number || "\u2014")}</td>
          <td>${safeText(m.rack_unit || "\u2014")}</td>
          <td><span class="tsr-icon-missing">${xSvg}</span></td>
          <td class="muted">\u2014</td>
        </tr>`;
      }

      tableEl.innerHTML = `<table class="tsr-status-table">
        <thead><tr><th><input type="checkbox" id="tsr-select-all" title="Select all" /></th><th>Name</th><th>Serial</th><th>IP Address</th><th>MAC Address</th><th>Part Number</th><th>Rack U</th><th>Status</th><th>TSR File</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

      // Apply row limit
      applyTableRowLimit(tableEl);

      // Wire select-all checkbox
      const selectAll = $("tsr-select-all");
      if (selectAll) {
        selectAll.addEventListener("change", () => {
          qsa(".tsr-rerun-check, .tsr-dl-check", tableEl).forEach(cb => { cb.checked = selectAll.checked; });
          _updateTsrButtons();
        });
      }
      // Wire individual checkboxes
      qsa(".tsr-rerun-check, .tsr-dl-check", tableEl).forEach(cb => {
        cb.addEventListener("change", () => _updateTsrButtons());
      });
      // Wire delete buttons for duplicate TSR files
      qsa(".tsr-delete-btn", tableEl).forEach(btn => {
        btn.addEventListener("click", async () => {
          const fname = btn.dataset.file;
          if (!fname) return;
          const ok = await showConfirmAsync(`Delete TSR file?`, `Are you sure you want to delete <strong>${safeText(fname)}</strong>? This cannot be undone.`);
          if (!ok) return;
          try {
            await apiDelete(`/api/jobs/${encodeURIComponent(jobId)}/tsr/${encodeURIComponent(fname)}`);
            showToast("TSR file deleted", "success");
            loadTsrStatus(jobId);
          } catch (e) {
            showToast("Failed to delete TSR file: " + e.message, "error");
          }
        });
      });
    }

    // Enable/disable buttons
    // Reset Select All button text
    const selAllBtn = $("btn_tsr_select_all");
    if (selAllBtn) selAllBtn.textContent = "Select All";
    _updateTsrButtons();
  } catch (e) {
    if (tableEl) tableEl.innerHTML = `<p class="muted" style="font-size:13px;">Could not load TSR status.</p>`;
    if (badge) { badge.textContent = "error"; badge.className = "tsr-status-badge"; }
  }
}

function _getSelectedTsrSerials() {
  const checks = qsa(".tsr-rerun-check:checked");
  return checks.map(cb => ({ serial: cb.dataset.serial, ip: cb.dataset.ip })).filter(s => s.ip);
}

function _getSelectedTsrFiles() {
  const checks = qsa(".tsr-dl-check:checked");
  const files = [];
  checks.forEach(cb => {
    try { JSON.parse(cb.dataset.files).forEach(f => files.push(f)); } catch {}
  });
  return files;
}

function _updateTsrButtons() {
  const rerunBtn = $("btn_rerun_missing_tsr");
  if (rerunBtn) {
    const selected = _getSelectedTsrSerials();
    if (selected.length > 0) {
      rerunBtn.disabled = false;
      rerunBtn.textContent = `Re-run Selected (${selected.length})`;
    } else {
      rerunBtn.disabled = true;
      rerunBtn.textContent = "Re-run Selected";
    }
  }
  const dlBtn = $("btn_download_selected_tsr");
  const delBtn = $("btn_delete_selected_tsr");
  const files = _getSelectedTsrFiles();
  if (dlBtn) {
    if (files.length > 0) {
      dlBtn.disabled = false;
      dlBtn.textContent = `Download Selected TSR (${files.length})`;
    } else {
      dlBtn.disabled = true;
      dlBtn.textContent = "Download Selected TSR";
    }
  }
  if (delBtn) {
    if (files.length > 0) {
      delBtn.disabled = false;
      delBtn.textContent = `Delete Selected (${files.length})`;
    } else {
      delBtn.disabled = true;
      delBtn.textContent = "Delete Selected";
    }
  }
}

async function downloadSelectedTsr(jobId) {
  const files = _getSelectedTsrFiles();
  if (!files.length) {
    showToast("Select at least one collected TSR to download", "info");
    return;
  }
  try {
    const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/tsr_selected`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || "Download failed");
    }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TSR_${jobId}_selected.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Downloaded ${files.length} TSR file(s)`, "success");
  } catch (e) {
    showToast("TSR download failed: " + e.message, "error");
  }
}

async function deleteSelectedTsr(jobId) {
  const files = _getSelectedTsrFiles();
  if (!files.length) {
    showToast("Select at least one TSR file to delete", "info");
    return;
  }
  const ok = await showConfirmAsync(
    `Delete ${files.length} TSR file(s)?`,
    `This will permanently delete:<br><ul style="margin:6px 0;padding-left:20px;font-size:12px;">${files.map(f => `<li>${safeText(f)}</li>`).join("")}</ul>This cannot be undone.`
  );
  if (!ok) return;
  let deleted = 0;
  for (const fname of files) {
    try {
      await apiDelete(`/api/jobs/${encodeURIComponent(jobId)}/tsr/${encodeURIComponent(fname)}`);
      deleted++;
    } catch (e) { /* continue with remaining */ }
  }
  showToast(`Deleted ${deleted} of ${files.length} TSR file(s)`, deleted === files.length ? "success" : "info");
  loadTsrStatus(jobId);
}

async function rerunMissingTsr(jobId, runAll) {
  let targets;
  if (runAll) {
    // Re-run all missing
    if (!_tsrStatusData || !_tsrStatusData.missing || _tsrStatusData.missing.length === 0) {
      showToast("No missing serials to re-run", "info");
      return;
    }
    targets = _tsrStatusData.missing.filter(m => m.ip);
  } else {
    // Re-run only selected
    targets = _getSelectedTsrSerials();
  }

  if (targets.length === 0) {
    showToast("No hosts with IP addresses selected", "error");
    return;
  }

  const ips = targets.map(t => t.ip);
  const serials = targets.map(t => t.serial);

  const ok = await showConfirmAsync(
    `Re-run TSR collection for ${targets.length} serial(s)?\n\n${serials.join(", ")}`,
    { title: "Re-run TSR", confirmText: "Run TSR", danger: false }
  );
  if (!ok) return;

  try {
    // Set host limit to only the target IPs
    const hostLimit = ips.join(":");
    await apiPatch(`/api/jobs/${encodeURIComponent(jobId)}`, { hostLimit });

    // TSR collection lives in post_provisioning.yaml, not the configbuild playbooks
    // Use workflowOverride so the job's saved workflow is not changed
    await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/run`, { tags: ["tsr"], workflowOverride: "postprov" });

    showToast(`TSR collection started for ${targets.length} host(s)`, "success");

    // Auto-expand live output when job starts
    const content = $("live-output-content");
    const chevron = $("live-output-chevron");
    if (content && chevron) {
      content.classList.remove("collapsed");
      chevron.classList.add("expanded");
    }

    // Start polling
    _runStartTime = Date.now();
    startLogPolling(jobId);
  } catch (e) {
    showToast("Failed to start TSR re-run: " + e.message, "error");
  }
}

async function downloadTSR(jobId) {
  try {
    const url = `/api/jobs/${encodeURIComponent(jobId)}/tsr`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || "Download failed");
    }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TSR_${jobId}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("TSR downloaded", "success");
  } catch (e) {
    showToast("TSR download failed: " + e.message, "error");
  }
}

async function exportReport(jobId) {
  try {
    const job = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}`);
    const runId = job.lastRunId;
    if (!runId) {
      showToast("No run to export yet", "info");
      return;
    }
    window.open(`/api/jobs/${encodeURIComponent(jobId)}/runs/${encodeURIComponent(runId)}/report`, "_blank");
  } catch (e) {
    showToast("Export failed: " + e.message, "error");
  }
}
