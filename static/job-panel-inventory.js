// ─────────────────────────────────────────────────────────────
// job-panel-inventory.js — Inventory loading, host picker, network discovery
// ─────────────────────────────────────────────────────────────

// Make an IP address a clickable link (opens in new tab)
function _ipLink(ip) {
  const safe = safeText(ip);
  if (!safe) return "\u2014";
  return `<a href="https://${safe}" target="_blank" rel="noopener noreferrer" title="Open ${safe} in new tab" style="color:#60a5fa;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${safe}</a>`;
}

// Rebuild host-picker-container: network mode shows only network devices with full detail
const _NET_PREFIXES = ["RCON", "SWITCH", "CONSOLE", "MSW", "N9K"];
const _isNetworkDevice = n => _NET_PREFIXES.some(p => (n || "").toUpperCase().startsWith(p));

function _rebuildHostPicker(pickerEl, allHosts, networkOnly) {
  const hosts = networkOnly ? allHosts.filter(h => _isNetworkDevice(h.name)) : allHosts;
  const HOST_LIMIT = 10;
  const hasMore = hosts.length > HOST_LIMIT;
  const countEl = $("host-picker-count");

  if (!hosts.length) {
    const emptyMsg = networkOnly
      ? "No network devices in inventory"
      : "No hosts discovered yet";
    const emptyAction = networkOnly
      ? "Upload a CSV and scan the network"
      : "Go to Inventory tab to scan";
    pickerEl.innerHTML = `<div class="host-picker-empty">
      ${SVG_SERVER_RACK}
      <div class="es-title">${emptyMsg}</div>
      <button class="btn ghost" onclick="activateTab('tab-inventory')">${emptyAction}</button>
    </div>`;
    if (countEl) countEl.textContent = "(0)";
    return;
  }

  if (countEl) countEl.textContent = `(${hosts.length})`;

  let html = `<div class="info-banner"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Select specific hosts to limit the run, or leave all selected to run on every host.</div>`;
  html += `<button class="btn ghost" style="padding:4px 10px;font-size:11px;margin-bottom:6px;" onclick="toggleAllHosts(this)">Select All</button>`;

  // Unified host picker table — same columns for all modes
  html += `<table class="host-picker-table">
    <thead><tr><th style="width:30px;"></th><th>Name</th><th>Serial</th><th>IP Address</th><th>MAC Address</th><th>Part Number</th><th>Rack U</th><th>Status</th></tr></thead><tbody>`;
  hosts.forEach((h, i) => {
    const hidden = hasMore && i >= HOST_LIMIT ? ' class="host-picker-extra" style="display:none;"' : "";
    const status = h.name
      ? '<span style="color:#22c55e;" title="Matched to CSV">&#10003;</span>'
      : '<span style="color:#f59e0b;" title="No CSV match">&#9679;</span>';
    html += `<tr${hidden}>
      <td><input type="checkbox" class="host-cb" data-ip="${safeText(h.ip)}" /></td>
      <td>${safeText(h.name) || "\u2014"}</td>
      <td>${safeText(h.serial) || "\u2014"}</td>
      <td>${_ipLink(h.ip)}</td>
      <td style="font-family:monospace;">${safeText(h.mac) || "\u2014"}</td>
      <td>${safeText(h.part_number) || "\u2014"}</td>
      <td>${safeText(h.rack_unit) || "\u2014"}</td>
      <td>${status}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  if (hasMore) {
    html += `<button class="btn ghost" style="margin-top:6px;font-size:12px;" onclick="toggleHostPickerExtra(this)">See all (${hosts.length - HOST_LIMIT} more)</button>`;
  }
  pickerEl.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────
async function loadInventoryHosts(jobId) {
  const pickerEl = $("host-picker-container");
  const countEl = $("overview-host-count");
  const pickerCountEl = $("host-picker-count");
  const invTableEl = $("inv-hosts-table");
  const invCountEl = $("inv-host-count");

  if (invTableEl) invTableEl.innerHTML = skeletonRows(3);

  try {
    const data = await apiGet(`/api/jobs/${encodeURIComponent(jobId)}/inventory_hosts`);
    const hosts = data.hosts || [];

    if (countEl) countEl.textContent = `${hosts.length} host(s) in inventory`;
    if (pickerCountEl) pickerCountEl.textContent = `(${hosts.length})`;
    if (invCountEl) invCountEl.textContent = `\u2014 ${hosts.length} host(s)`;

    if (invTableEl) {
      if (!hosts.length) {
        invTableEl.innerHTML = emptyStateHtml(SVG_SERVER_RACK, "No hosts discovered yet", "Scan Network", "document.getElementById('btn_generate_inventory')?.click()");
      } else {
        let invHtml = "";

        const missingMacs = data.missingMacs || [];

        // Categorize devices by name prefix — single pass each
        const _isPdu = n => (n || "").toUpperCase().startsWith("PDU-");
        const _INV_NET_PREFIXES = ["RCON", "SWITCH", "CONSOLE", "MSW", "N9K"];
        const _isNetwork = n => _INV_NET_PREFIXES.some(p => (n || "").toUpperCase().startsWith(p));

        const serverHosts = [], pduHosts = [], networkHosts = [];
        for (const h of hosts) {
          if (_isPdu(h.name)) pduHosts.push(h);
          else if (_isNetwork(h.name)) networkHosts.push(h);
          else serverHosts.push(h);
        }

        const missingServers = [], missingPdus = [], missingNetwork = [];
        for (const m of missingMacs) {
          if (_isPdu(m.name)) missingPdus.push(m);
          else if (_isNetwork(m.name)) missingNetwork.push(m);
          else missingServers.push(m);
        }

        // Servers section
        if (serverHosts.length || missingServers.length) {
          invHtml += `<div style="margin-bottom:16px;">
            <h4 style="margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              Servers (${serverHosts.length})
            </h4>`;
          if (serverHosts.length) {
            invHtml += `<table class="host-picker-table">
              <thead><tr><th>#</th><th>Name</th><th>Serial</th><th>IP Address</th><th>MAC Address</th><th>Part Number</th><th>Rack U</th></tr></thead><tbody>`;
            serverHosts.forEach((h, i) => {
              invHtml += `<tr>
                <td>${i + 1}</td>
                <td>${safeText(h.name) || "\u2014"}</td>
                <td>${safeText(h.serial) || "\u2014"}</td>
                <td>${_ipLink(h.ip)}</td>
                <td style="font-family:monospace;">${safeText(h.mac) || "\u2014"}</td>
                <td>${safeText(h.part_number) || "\u2014"}</td>
                <td>${safeText(h.rack_unit) || "\u2014"}</td>
              </tr>`;
            });
            invHtml += `</tbody></table>`;
          }
          if (missingServers.length) {
            invHtml += `<div style="background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:6px;padding:8px 12px;margin-top:8px;">
              <div style="font-weight:600;color:#fbbf24;margin-bottom:4px;font-size:12px;">Missing from scan (${missingServers.length})</div>
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="text-align:left;border-bottom:1px solid rgba(251,191,36,0.3);">
                  <th style="padding:3px 8px;color:#fbbf24;font-size:11px;">Name</th>
                  <th style="padding:3px 8px;color:#fbbf24;font-size:11px;">Serial</th>
                  <th style="padding:3px 8px;color:#fbbf24;font-size:11px;">MAC Address</th>
                  <th style="padding:3px 8px;color:#fbbf24;font-size:11px;">Part Number</th>
                  <th style="padding:3px 8px;color:#fbbf24;font-size:11px;">Rack U</th>
                </tr></thead><tbody>
                ${missingServers.map(m => `<tr style="border-bottom:1px solid rgba(251,191,36,0.1);">
                  <td style="padding:3px 8px;color:var(--text-muted);">${safeText(m.name || "") || "\u2014"}</td>
                  <td style="padding:3px 8px;color:var(--text-muted);">${safeText(m.serial || "") || "\u2014"}</td>
                  <td style="padding:3px 8px;color:var(--text-muted);font-family:monospace;">${safeText(m.mac || m)}</td>
                  <td style="padding:3px 8px;color:var(--text-muted);">${safeText(m.part_number || "") || "\u2014"}</td>
                  <td style="padding:3px 8px;color:var(--text-muted);">${safeText(m.rack_unit || "") || "\u2014"}</td>
                </tr>`).join("")}
                </tbody></table>
            </div>`;
          }
          invHtml += `</div>`;
        }

        // PDU section
        const allPdus = [...pduHosts.map(h => ({...h, found: true})), ...missingPdus.map(m => ({ip: m.ip || "", mac: m.mac, name: m.name, serial: m.serial, part_number: m.part_number, rack_unit: m.rack_unit, found: false}))];
        if (allPdus.length) {
          invHtml += `<div style="margin-bottom:16px;">
            <h4 style="margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>
              PDUs (${allPdus.length})
            </h4>
            <table class="host-picker-table">
              <thead><tr><th>Name</th><th>Serial</th><th>IP Address</th><th>MAC Address</th><th>Part Number</th><th>Rack U</th><th>Status</th></tr></thead><tbody>`;
          allPdus.forEach(p => {
            const statusIcon = p.found
              ? '<span style="color:#22c55e;" title="Found in scan">&#10003;</span>'
              : '<span style="color:#f59e0b;" title="Missing from scan">&#10007;</span>';
            invHtml += `<tr${!p.found ? ' style="background:rgba(251,191,36,0.06);"' : ''}>
              <td>${safeText(p.name) || "\u2014"}</td>
              <td>${safeText(p.serial) || "\u2014"}</td>
              <td>${_ipLink(p.ip)}</td>
              <td style="font-family:monospace;">${safeText(p.mac) || "\u2014"}</td>
              <td>${safeText(p.part_number) || "\u2014"}</td>
              <td>${safeText(p.rack_unit) || "\u2014"}</td>
              <td>${statusIcon}</td>
            </tr>`;
          });
          invHtml += `</tbody></table></div>`;

          // Store PDU IPs for auto-fill in Tasks tab
          window._pduAutoFill = allPdus.filter(p => p.name).reduce((acc, p) => {
            acc[p.name.toUpperCase()] = p.ip || "";
            return acc;
          }, {});
        }

        // Network Devices (switches, consoles, RCON)
        const allNetwork = [...networkHosts.map(h => ({...h, found: true})), ...missingNetwork.map(m => ({ip: m.ip || "", mac: m.mac, name: m.name, serial: m.serial, part_number: m.part_number, rack_unit: m.rack_unit, found: false}))];
        if (allNetwork.length) {
          invHtml += `<div style="margin-bottom:16px;">
            <h4 style="margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Network Devices (${allNetwork.length})
            </h4>
            <table class="host-picker-table">
              <thead><tr><th>Name</th><th>Serial</th><th>IP Address</th><th>MAC Address</th><th>Part Number</th><th>Rack U</th><th>Status</th></tr></thead><tbody>`;
          allNetwork.forEach(d => {
            const statusIcon = d.found
              ? '<span style="color:#22c55e;" title="Found in scan">&#10003;</span>'
              : '<span style="color:#f59e0b;" title="Missing from scan">&#10007;</span>';
            invHtml += `<tr${!d.found ? ' style="background:rgba(251,191,36,0.06);"' : ''}>
              <td>${safeText(d.name) || "\u2014"}</td>
              <td>${safeText(d.serial) || "\u2014"}</td>
              <td>${_ipLink(d.ip)}</td>
              <td style="font-family:monospace;">${safeText(d.mac) || "\u2014"}</td>
              <td>${safeText(d.part_number) || "\u2014"}</td>
              <td>${safeText(d.rack_unit) || "\u2014"}</td>
              <td>${statusIcon}</td>
            </tr>`;
          });
          invHtml += `</tbody></table></div>`;
        }

        // If no categorized hosts, show flat table as fallback
        if (!serverHosts.length && !allPdus.length && !allNetwork.length && !missingServers.length) {
          invHtml += `<table class="host-picker-table">
            <thead><tr><th>#</th><th>Name</th><th>Serial</th><th>IP Address</th><th>MAC Address</th><th>Part Number</th><th>Rack U</th></tr></thead><tbody>`;
          hosts.forEach((h, i) => {
            invHtml += `<tr>
              <td>${i + 1}</td>
              <td>${safeText(h.name) || "\u2014"}</td>
              <td>${safeText(h.serial) || "\u2014"}</td>
              <td>${_ipLink(h.ip)}</td>
              <td style="font-family:monospace;">${safeText(h.mac) || "\u2014"}</td>
              <td>${safeText(h.part_number) || "\u2014"}</td>
              <td>${safeText(h.rack_unit) || "\u2014"}</td>
            </tr>`;
          });
          invHtml += `</tbody></table>`;
        }

        invTableEl.innerHTML = invHtml;

        // Apply row limits to each inventory sub-table
        qsa("table.host-picker-table", invTableEl).forEach(tbl => {
          applyTableRowLimit(tbl.parentElement, TABLE_ROW_LIMIT);
        });
      }
    }

    if (pickerEl) {
      window._inventoryHosts = hosts;
      const wf = safeText($("modal_workflow")?.value).toLowerCase();
      const networkOnly = _NETWORK_WORKFLOWS.includes(wf);
      _rebuildHostPicker(pickerEl, hosts, networkOnly);
    }
  } catch (e) {
    if (countEl) countEl.textContent = "0 host(s) in inventory";
    if (invCountEl) invCountEl.textContent = "";
    if (pickerEl) pickerEl.innerHTML = '<span class="inline-error">(Could not load hosts)</span>';
    if (invTableEl) invTableEl.innerHTML = '<span class="inline-error">(Could not load hosts)</span>';
  }
}

window.toggleAllHosts = function (btn) {
  const cbs = qsa(".host-cb");
  const allChecked = cbs.length > 0 && cbs.every(cb => cb.checked);
  cbs.forEach(cb => cb.checked = !allChecked);
  if (btn) btn.textContent = allChecked ? "Select All" : "Deselect All";
};

window.toggleHostPickerExtra = function (btn) {
  const container = btn.parentElement;
  const extras = qsa(".host-picker-extra", container);
  const showing = extras[0] && extras[0].style.display !== "none";
  extras.forEach(tr => { tr.style.display = showing ? "none" : ""; });
  btn.textContent = showing ? `See all (${extras.length} more)` : "Show less";
};

let _invTimerHandle = null;

async function generateInventory(jobId) {
  const invStatus = $("inv_status");
  const out = $("inv_gen_output");
  const btn = $("btn_generate_inventory");

  // Get scan type from radio selection
  const scanTypeEl = qs('input[name="inv_scan_type"]:checked');
  const scanType = scanTypeEl ? scanTypeEl.value : "all";
  const scanLabels = { all: "all devices", servers: "servers", pdu: "PDUs", network: "network devices" };

  // Add pulsing indicator on Inventory tab badge
  const invTab = qs('.modal-tab[data-tab="tab-inventory"]');
  if (invTab) invTab.classList.add("inv-tab-pulse");

  try {
    if (btn) btn.disabled = true;

    // Show elapsed timer
    let elapsed = 0;
    if (invStatus) {
      invStatus.innerHTML = `<span class="inv-progress-wrap"><span class="spinner"></span><span class="inv-timer" id="inv-timer">0s</span> Scanning for ${scanLabels[scanType] || "devices"}... <button class="btn ghost" style="padding:2px 8px;font-size:11px;" id="inv-cancel-btn">Cancel (UI only \u2014 server scan continues)</button></span>`;
      _invTimerHandle = setInterval(() => {
        elapsed++;
        const timerEl = $("inv-timer");
        if (timerEl) timerEl.textContent = elapsed + "s";
      }, 1000);
      const cancelBtn = $("inv-cancel-btn");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          if (_invTimerHandle) { clearInterval(_invTimerHandle); _invTimerHandle = null; }
          if (invStatus) invStatus.textContent = "Cancelled (request still running on server)";
          if (btn) btn.disabled = false;
        });
      }
    }
    if (out) { out.textContent = ""; out.style.display = "none"; }

    const result = await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/generate_inventory`, { scanType });

    const stdout = stripAnsi(result.stdout || "");
    const stderr = stripAnsi(result.stderr || "");

    let msg = "Inventory generation finished.\n\n";
    msg += `CSV: ${safeText(result.csvUsed || "")}\n`;
    msg += `Inventory: ${safeText(result.inventoryPath || "")}\n`;
    if (result.sourceUsed) msg += `Source Used: ${safeText(result.sourceUsed)}\n`;
    if (result.logPath) msg += `Log: ${safeText(result.logPath)}\n`;
    msg += "\n--- STDOUT ---\n" + (stdout || "(none)") + "\n";
    msg += "\n--- STDERR ---\n" + (stderr || "(none)") + "\n";

    if (_invTimerHandle) { clearInterval(_invTimerHandle); _invTimerHandle = null; }
    if (out) { out.textContent = msg; out.style.display = "none"; }
    if (invStatus) invStatus.textContent = "Done";
    showToast("Inventory generated", "success");

    loadInventoryHosts(jobId);
    updatePreflightChecklist(jobId);
    updateJobReadiness(jobId);
    updateJobTimeline(jobId);

    showToast("Inventory scan complete", "success");
  } catch (e) {
    if (_invTimerHandle) { clearInterval(_invTimerHandle); _invTimerHandle = null; }
    if (invStatus) invStatus.textContent = "Error";
    if (out) { out.textContent = "ERROR: " + e.message; out.style.display = "block"; }
    const reason = e.message || "Unknown error";
    const hint = (e.retryable || e.status === 0)
      ? "Check network connectivity to switches."
      : "";
    showToast(`Inventory scan failed: ${reason}. ${hint}`.trim(), "error", 8000, {
      actionLabel: "Retry",
      onAction: () => generateInventory(jobId),
    });
  } finally {
    if (btn) btn.disabled = false;
    if (invTab) invTab.classList.remove("inv-tab-pulse");
  }
}

function collectHostLimit() {
  const checked = qsa(".host-cb:checked");
  const all = qsa(".host-cb");
  // If none selected or all selected, run all hosts
  if (!checked.length || checked.length === all.length) return "";
  return checked.map(cb => cb.dataset.ip).filter(Boolean).join(":");
}

async function applyHostLimit(jobId) {
  const hostLimit = collectHostLimit();
  await apiPatch(`/api/jobs/${encodeURIComponent(jobId)}`, { hostLimit });
}
