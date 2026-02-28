// ─────────────────────────────────────────────────────────────
// job-panel-files.js — File upload, preview, delete, catalog generation
// ─────────────────────────────────────────────────────────────

function detectUploadRole(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (ext === "csv") return { role: "workbook", label: "Workbook (CSV)" };
  if (ext === "xml") return { role: "bios_xml", label: "BIOS Config (XML)" };
  if (ext === "exe" || ext === "bin" || ext === "img" || ext === "tgz") return { role: "firmware", label: "Firmware" };
  if (ext === "yml" || ext === "yaml") return { role: "supporting", label: "YAML Config" };
  return null;
}

function normalizeFiles(job) {
  const files = job.files || job.uploads || job.jobFiles || [];
  if (!Array.isArray(files)) return [];
  return files.map(f => {
    const role = safeText(f.role || f.file_role || f.kind || "file");
    const name = safeText(f.name || f.filename || fileNameOnly(f.path || f.filepath || ""));
    const size = f.size || 0;
    return { role, name, size };
  }).filter(x => x.name);
}

function wireDropZone(zoneId, inputId, uploadFn) {
  const zone = $(zoneId);
  const fileInput = $(inputId);
  if (!zone || !fileInput) return;

  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("upload-zone-dragover"); });
  zone.addEventListener("dragenter", (e) => { e.preventDefault(); zone.classList.add("upload-zone-dragover"); });
  zone.addEventListener("dragleave", () => { zone.classList.remove("upload-zone-dragover"); });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("upload-zone-dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      uploadFn();
    }
  });
  zone.addEventListener("click", (e) => {
    // Don't re-trigger if clicking the file input itself or any button
    if (e.target.closest("input[type=file]") || e.target.closest("button") || e.target.closest("a")) return;
    fileInput.click();
  });

  // Auto-upload when a file is selected via browse dialog
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length) {
      uploadFn();
    }
  });
}

// ─────────────────────────────────────────────────────────────
// CSV template download (#9)
// ─────────────────────────────────────────────────────────────
window.downloadCsvTemplate = function () {
  const header = "line_id,rack_id,quantity,po_number,rack_unit,part_number,asset_name,dc_code,asset_number,serial_number,additional_serial_number,mac_address,external_correlation_id,extradata_correlation_id,internal_purchase_request";
  const csv = header + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "RID0002051.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Blank template downloaded", "info");
};

// ─────────────────────────────────────────────────────────────
// Upload actions
// ─────────────────────────────────────────────────────────────
async function uploadJobFile(jobId) {
  const fileInput = $("job_upload_file");
  const status = $("job_upload_status");

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    if (status) status.textContent = "Pick a file first.";
    return;
  }

  const allFiles = Array.from(fileInput.files);
  const total = allFiles.length;
  let uploaded = 0;
  let failed = 0;
  let hadFirmware = false;

  // File size warnings (#5)
  const largeFiles = allFiles.filter(f => f.size > 100 * 1024 * 1024);
  if (largeFiles.length > 0) {
    const warnEl = $("file-size-warn") || document.createElement("div");
    warnEl.id = "file-size-warn";
    warnEl.className = "file-size-warn";
    warnEl.innerHTML = `\u26A0 ${largeFiles.length} large file(s) detected (>100MB). Upload may take several minutes. ${largeFiles.map(f => safeText(f.name) + " (" + (f.size / (1024*1024)).toFixed(0) + "MB)").join(", ")}`;
    const statusParent = status ? status.parentElement : null;
    if (statusParent && !$("file-size-warn")) statusParent.insertBefore(warnEl, statusParent.firstChild);
  }

  // Build upload summary bar (#10)
  let summaryEl = $("upload-summary");
  if (!summaryEl) {
    summaryEl = document.createElement("div");
    summaryEl.id = "upload-summary";
    summaryEl.className = "upload-summary";
    const statusParent = status ? status.parentElement : null;
    if (statusParent) statusParent.insertBefore(summaryEl, status);
  }
  summaryEl.innerHTML = `<span>Uploading 0 of ${total} files</span><div class="upload-summary-bar"><div class="upload-summary-fill" id="upload-summary-fill" style="width:0%"></div></div>`;
  summaryEl.style.display = "";

  // Build upload queue UI (Feature 7)
  let queueEl = $("upload-queue");
  if (!queueEl) {
    queueEl = document.createElement("div");
    queueEl.id = "upload-queue";
    const statusParent = status ? status.parentElement : null;
    if (statusParent) statusParent.appendChild(queueEl);
  }
  queueEl.innerHTML = allFiles.map((file, i) => {
    const sizeStr = (file.size / 1024).toFixed(1) + " KB";
    return `<div class="upload-queue-item" id="uq-${i}">
      <span class="uq-status" id="uq-icon-${i}">\u23F3</span>
      <span class="uq-name">${safeText(file.name)}</span>
      <span class="uq-size">${sizeStr}</span>
      <div class="upload-item-bar"><div class="upload-item-bar-fill" id="uq-bar-${i}" style="width:0%"></div></div>
    </div>`;
  }).join("");

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const detected = detectUploadRole(file.name);
    if (!detected) {
      showToast(`Skipped ${file.name} — unsupported type`, "error");
      failed++;
      const icon = $(`uq-icon-${i}`);
      if (icon) { icon.textContent = "\u2718"; icon.style.color = "#f87171"; }
      continue;
    }

    const role = detected.role;
    if (role === "firmware") hadFirmware = true;

    try {
      if (status) status.innerHTML = `<span style="color:#60a5fa;"><span class="spinner"></span> Uploading (${uploaded + 1}/${total})...</span>`;

      const fd = new FormData();
      fd.append("file", file);
      fd.append("role", role);
      await apiPostFormWithProgress(`/api/jobs/${encodeURIComponent(jobId)}/files`, fd, (pct) => {
        const bar = $(`uq-bar-${i}`);
        if (bar) bar.style.width = pct + "%";
      });

      uploaded++;
      const icon = $(`uq-icon-${i}`);
      if (icon) { icon.textContent = "\u2714"; icon.style.color = "#4ade80"; }
      const bar = $(`uq-bar-${i}`);
      if (bar) bar.style.width = "100%";
      // Update aggregate summary (#10)
      const summarySpan = summaryEl ? summaryEl.querySelector("span") : null;
      if (summarySpan) summarySpan.textContent = `Uploading ${uploaded} of ${total} files`;
      const summaryFill = $("upload-summary-fill");
      if (summaryFill) summaryFill.style.width = Math.round((uploaded / total) * 100) + "%";
    } catch (e) {
      failed++;
      const icon = $(`uq-icon-${i}`);
      if (icon) { icon.textContent = "\u2718"; icon.style.color = "#f87171"; }
      const reason = e.message || "Unknown error";
      const networkHint = (e.retryable || e.status === 0) ? " Check connection." : "";
      showToast(`Upload failed for ${file.name}: ${reason}.${networkHint}`, "error", 6000, {
        actionLabel: "Retry",
        onAction: () => uploadJobFile(jobId),
      });
    }
  }

  // Clear file input
  fileInput.value = "";

  // Show final status
  if (failed === 0) {
    if (status) status.innerHTML = `<span style="color:#4ade80;font-weight:600;">\u2714 ${uploaded} file${uploaded !== 1 ? "s" : ""} uploaded</span>`;
    showToast(`\u2714 ${uploaded} file${uploaded !== 1 ? "s" : ""} uploaded successfully`, "success");
  } else {
    if (status) status.innerHTML = `<span style="color:#fbbf24;font-weight:600;">\u2714 ${uploaded} uploaded, \u2718 ${failed} failed</span>`;
  }

  // Clear queue and summary after a delay
  setTimeout(() => {
    if (queueEl) queueEl.innerHTML = "";
    if (summaryEl) summaryEl.style.display = "none";
  }, 3000);

  if (hadFirmware) {
    try { await generateCatalog(jobId); } catch { /* silent */ }
  }

  // Refresh file list with highlight
  const job = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}`);
  loadAllFiles(job);
  updatePreflightChecklist(jobId);
  updateJobReadiness(jobId);
  updateJobTimeline(jobId);

  showToast("Files uploaded successfully", "success");

  const filesEl = $("all-files-list");
  if (filesEl) {
    filesEl.style.transition = "background 0.3s";
    filesEl.style.background = "rgba(74, 222, 128, 0.15)";
    setTimeout(() => { filesEl.style.background = ""; }, 1500);
  }

  const uploadTab = qs('.modal-tab[data-tab="tab-upload"]');
  if (uploadTab) {
    const files = normalizeFiles(job);
    const badge = uploadTab.querySelector(".tab-badge");
    if (badge) {
      badge.textContent = files.length;
    } else {
      uploadTab.innerHTML = `Upload <span class="tab-badge">${files.length}</span>`;
    }
  }
}

function loadAllFiles(job) {
  const el = $("all-files-list");
  if (!el) return;
  if (!job) { el.innerHTML = '<span class="inline-error">(Could not load files)</span>'; return; }
  if (el.innerHTML.includes("Loading")) el.innerHTML = skeletonRows(3);

  const jobId = job.jobId || job.id || job.job_id;
  const files = normalizeFiles(job);
  if (!files.length) {
    el.innerHTML = emptyStateHtml(SVG_FOLDER, "No files uploaded", "Upload Files", "document.getElementById('job_upload_file')?.click()");
    return;
  }

  let html = '<table class="host-picker-table"><thead><tr><th>Role</th><th>Filename</th><th>Size</th><th></th></tr></thead><tbody>';
  files.forEach(f => {
    const sizeStr = f.size ? (f.size / 1024).toFixed(1) + " KB" : "\u2014";
    const isCSV = f.name.toLowerCase().endsWith(".csv");
    const previewBtn = isCSV ? `<button class="btn ghost" style="padding:4px 8px;font-size:11px;" onclick="previewCSV('${safeText(jobId)}','${safeText(f.role)}','${safeText(f.name)}')">Preview</button>` : "";
    html += `<tr>
      <td>${safeText(f.role)}</td>
      <td>${safeText(f.name)}</td>
      <td class="muted">${sizeStr}</td>
      <td style="white-space:nowrap;">
        ${previewBtn}
        <button class="btn ghost" style="padding:4px 8px;font-size:11px;color:#f87171;" onclick="deleteJobFile('${safeText(jobId)}','${safeText(f.role)}','${safeText(f.name)}')">Delete</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
  applyTableRowLimit(el);
}

// ─────────────────────────────────────────────────────────────
// CSV Preview (editable)
// ─────────────────────────────────────────────────────────────

/** Parse a CSV line respecting quoted fields */
function _csvParseLine(line) {
  const cells = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { cells.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells;
}

/** Quote a CSV value if it contains special characters */
function _csvQuote(val) {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

window.previewCSV = async function (jobId, role, filename) {
  try {
    const url = `${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(role)}/${encodeURIComponent(filename)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Failed to fetch file");
    const text = await resp.text();

    const lines = text.split("\n").filter(l => l.trim());
    if (!lines.length) { showToast("File is empty", "info"); return; }

    const rows = lines.map(l => _csvParseLine(l));
    const colCount = rows[0].length;
    const dataRows = rows.length - 1;

    // Build header row (read-only)
    let tableHtml = '<table class="host-picker-table csv-edit-table" id="csv-edit-table"><thead><tr><th class="csv-row-num">#</th>';
    rows[0].forEach(h => { tableHtml += `<th>${safeText(h)}</th>`; });
    tableHtml += '<th class="csv-row-action"></th></tr></thead><tbody>';

    // Build data rows (editable)
    for (let i = 1; i < rows.length; i++) {
      tableHtml += `<tr><td class="csv-row-num muted">${i}</td>`;
      rows[i].forEach(c => { tableHtml += `<td contenteditable="true" class="csv-cell">${safeText(c)}</td>`; });
      // Pad if fewer cols
      for (let p = rows[i].length; p < colCount; p++) { tableHtml += '<td contenteditable="true" class="csv-cell"></td>'; }
      tableHtml += '<td class="csv-row-action"><button class="csv-del-row-btn" title="Delete row">&times;</button></td></tr>';
    }
    tableHtml += '</tbody></table>';

    ensureWizardContainer();
    const previewEl = document.createElement("div");
    previewEl.className = "wizard-modal-root";
    previewEl.id = "csv-preview-modal";
    previewEl.innerHTML = `
      <div class="wizard-overlay" onclick="document.getElementById('csv-preview-modal').remove()"></div>
      <div class="wizard-card" style="max-width:95vw;width:1200px;max-height:90vh;" onclick="event.stopPropagation()">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;">
          <div class="modal-title">
            <div class="title-main">${safeText(filename)}</div>
            <div class="title-sub muted"><span id="csv-row-count">${dataRows}</span> row${dataRows !== 1 ? "s" : ""}<span id="csv-dirty-dot" class="csv-dirty-dot" style="display:none;"> &bull; unsaved</span></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn primary" id="csv-save-btn" disabled style="font-size:12px;padding:6px 14px;">Save</button>
            <button class="modal-close" onclick="document.getElementById('csv-preview-modal').remove()">&times;</button>
          </div>
        </div>
        <div style="overflow:auto;max-height:calc(90vh - 120px);padding:0 18px 12px;">
          ${tableHtml}
        </div>
        <div style="padding:0 18px 14px;">
          <button class="btn ghost csv-add-row-btn" id="csv-add-row-btn" style="width:100%;font-size:12px;">+ Add Row</button>
        </div>
      </div>
    `;
    document.body.appendChild(previewEl);

    // --- Wire up interactivity ---
    const table = document.getElementById("csv-edit-table");
    const saveBtn = document.getElementById("csv-save-btn");
    const dirtyDot = document.getElementById("csv-dirty-dot");
    const rowCountEl = document.getElementById("csv-row-count");
    let dirty = false;

    function markDirty() {
      if (!dirty) {
        dirty = true;
        saveBtn.disabled = false;
        dirtyDot.style.display = "";
      }
    }

    function updateRowCount() {
      const count = table.querySelectorAll("tbody tr").length;
      rowCountEl.textContent = count;
    }

    function renumberRows() {
      table.querySelectorAll("tbody tr").forEach((tr, idx) => {
        const num = tr.querySelector(".csv-row-num");
        if (num) num.textContent = idx + 1;
      });
    }

    // Mark cells dirty on input
    table.addEventListener("input", (e) => {
      if (e.target.classList.contains("csv-cell")) {
        e.target.classList.add("csv-cell-dirty");
        markDirty();
      }
    });

    // Delete row buttons
    table.addEventListener("click", (e) => {
      const delBtn = e.target.closest(".csv-del-row-btn");
      if (delBtn) {
        delBtn.closest("tr").remove();
        renumberRows();
        updateRowCount();
        markDirty();
      }
    });

    // Add row
    document.getElementById("csv-add-row-btn").addEventListener("click", () => {
      const tbody = table.querySelector("tbody");
      const rowNum = tbody.querySelectorAll("tr").length + 1;
      let newRow = `<tr><td class="csv-row-num muted">${rowNum}</td>`;
      for (let c = 0; c < colCount; c++) { newRow += '<td contenteditable="true" class="csv-cell csv-cell-dirty"></td>'; }
      newRow += '<td class="csv-row-action"><button class="csv-del-row-btn" title="Delete row">&times;</button></td></tr>';
      tbody.insertAdjacentHTML("beforeend", newRow);
      updateRowCount();
      markDirty();
      // Focus first cell of new row
      const lastRow = tbody.lastElementChild;
      const firstCell = lastRow.querySelector(".csv-cell");
      if (firstCell) firstCell.focus();
    });

    // Save
    saveBtn.addEventListener("click", async () => {
      // Reconstruct CSV from DOM
      const headerCells = table.querySelectorAll("thead th");
      const headers = [];
      headerCells.forEach(th => {
        if (th.classList.contains("csv-row-num") || th.classList.contains("csv-row-action")) return;
        headers.push(_csvQuote(th.textContent));
      });
      const csvLines = [headers.join(",")];

      table.querySelectorAll("tbody tr").forEach(tr => {
        const vals = [];
        tr.querySelectorAll(".csv-cell").forEach(td => {
          vals.push(_csvQuote(td.textContent));
        });
        csvLines.push(vals.join(","));
      });

      const csvText = csvLines.join("\n") + "\n";

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      try {
        const putUrl = `${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(role)}/${encodeURIComponent(filename)}`;
        const putResp = await fetch(putUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: csvText })
        });
        if (!putResp.ok) throw new Error("Save failed");
        showToast("File saved", "success");
        dirty = false;
        dirtyDot.style.display = "none";
        // Reset dirty indicators on cells
        table.querySelectorAll(".csv-cell-dirty").forEach(c => c.classList.remove("csv-cell-dirty"));
      } catch (err) {
        showToast("Save failed: " + err.message, "error");
      } finally {
        saveBtn.disabled = !dirty;
        saveBtn.textContent = "Save";
      }
    });
  } catch (e) {
    showToast("Preview failed: " + e.message, "error");
  }
};

window.deleteJobFile = async function (jobId, role, filename) {
  const ok = await showConfirmAsync(`Delete ${filename}?`, { title: "Delete File", confirmText: "Delete", danger: true });
  if (!ok) return;
  try {
    await apiDelete(`/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(role)}/${encodeURIComponent(filename)}`);
    showToast("File deleted", "success");
    const job = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}`);
    loadAllFiles(job);
    updateJobReadiness(jobId);
    updateJobTimeline(jobId);
  } catch (e) {
    showToast("Delete failed: " + e.message, "error");
  }
};

async function uploadWorkbook(jobId) {
  const fileInput = $("inv_upload_file");
  const status = $("inv_upload_status");

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    if (status) status.textContent = "Pick a CSV file first.";
    return;
  }

  try {
    const file = fileInput.files[0];
    if (status) status.textContent = "Uploading...";

    const fd = new FormData();
    fd.append("file", file);
    fd.append("role", "workbook");

    await apiPostFormWithProgress(`/api/jobs/${encodeURIComponent(jobId)}/files`, fd, (pct) => {
      if (status) status.textContent = `Uploading ${file.name}... ${pct}%`;
    });

    if (status) status.textContent = "Uploaded";
    showToast("Workbook uploaded", "success");

    const job = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}`);
    loadAllFiles(job);
  } catch (e) {
    if (status) status.textContent = "Error";
    showToast("Upload failed: " + e.message, "error");
  }
}

async function generateCatalog(jobId) {
  const status = $("catalog_status");
  const btn = $("btn_generate_catalog");

  try {
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Generating...";

    const result = await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/generate_catalog`, {});
    if (status) status.textContent = `Done \u2014 ${result.firmwareCount} file(s)`;
    showToast("Catalog.xml generated", "success");
  } catch (e) {
    if (status) status.textContent = "Error";
    showToast("Catalog generation failed: " + e.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
