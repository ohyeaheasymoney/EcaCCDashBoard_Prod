// ─────────────────────────────────────────────────────────────
// utils.js — Shared utilities
// ─────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function safeText(s) {
  return (s === null || s === undefined) ? "" : String(s);
}

function stripAnsi(text) {
  return safeText(text).replace(/\u001b\[[0-9;]*m/g, "");
}

function fileNameOnly(p) {
  const s = safeText(p);
  if (!s) return "";
  const parts = s.split("/");
  return parts[parts.length - 1] || s;
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function statusBadge(status, lastRunTime) {
  const s = safeText(status).toLowerCase() || "saved";
  const labels = { saved: "Ready", running: "Running", completed: "Passed", failed: "Failed", stopped: "Stopped" };
  let extra = "";
  if (lastRunTime && s !== "running") extra = ` <span class="badge-time">${timeAgo(lastRunTime)}</span>`;
  return `<span class="status-badge status-${s}" data-status="${s}">${labels[s] || s}${extra}</span>`;
}

// SVG icon constants for empty states (Feature 10)
const SVG_SERVER_RACK = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>';
const SVG_FOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
const SVG_PLAY_CIRCLE = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>';
const SVG_TERMINAL = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';

function emptyStateHtml(icon, message, actionLabel, actionOnclick) {
  let html = `<div class="empty-state-box">${icon}<div class="es-title">${safeText(message)}</div>`;
  if (actionLabel && actionOnclick) {
    html += `<button class="btn primary" onclick="${safeText(actionOnclick)}">${safeText(actionLabel)}</button>`;
  }
  html += '</div>';
  return html;
}

function helpToggleHtml(summary, details) {
  return `<details class="help-toggle"><summary>${safeText(summary)}</summary><div class="help-toggle-content">${details}</div></details>`;
}

function skeletonRows(count = 3) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton skeleton-row"></div>';
  }
  return html;
}

function skeletonText(count = 4) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton skeleton-text" style="width:' + (60 + Math.random() * 30) + '%;"></div>';
  }
  return html;
}

// ─── Table Row Limiter (Show N, See More) ───
const TABLE_ROW_LIMIT = 10;

/**
 * Apply row limiting to a table container. Hides rows beyond `limit` and adds
 * a "See more" / "Show less" toggle button. Call after setting innerHTML.
 *
 * @param {HTMLElement} container - element containing the <table> (or parent with <tbody>)
 * @param {number} [limit] - rows to show initially (default TABLE_ROW_LIMIT)
 * @param {string} [rowSelector] - CSS selector for data rows (default "tbody tr")
 */
function applyTableRowLimit(container, limit, rowSelector) {
  if (!container) return;
  limit = limit || TABLE_ROW_LIMIT;
  const sel = rowSelector || "tbody tr";
  const rows = qsa(sel, container);
  if (rows.length <= limit) return; // nothing to hide

  const extra = rows.length - limit;
  rows.forEach((tr, i) => {
    if (i >= limit) {
      tr.classList.add("table-row-extra");
      tr.style.display = "none";
    }
  });

  // Remove existing toggle if present (for re-renders)
  const existing = qs(".table-see-more-btn", container);
  if (existing) existing.remove();

  const btn = document.createElement("button");
  btn.className = "btn ghost table-see-more-btn";
  btn.style.cssText = "margin-top:6px;font-size:12px;";
  btn.textContent = `See more (${extra})`;
  btn.addEventListener("click", function () {
    const hidden = qsa(".table-row-extra", container);
    const isShowing = hidden[0] && hidden[0].style.display !== "none";
    hidden.forEach(tr => { tr.style.display = isShowing ? "none" : ""; });
    btn.textContent = isShowing ? `See more (${extra})` : "Show less";
  });
  container.appendChild(btn);
}

// ─── Help Tooltip (Feature 5) ───
function helpTip(text) {
  return `<span class="help-tip" tabindex="0">?<span class="help-tip-content">${text}</span></span>`;
}

// Position help tooltips using fixed positioning to avoid overflow clipping
(function () {
  function positionTip(tip) {
    const content = tip.querySelector(".help-tip-content");
    if (!content) return;
    const rect = tip.getBoundingClientRect();
    const tipW = 280;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: center on the ? icon, clamped to viewport
    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(left, vw - tipW - 8));
    content.style.left = left + "px";
    content.style.transform = "none";

    // Vertical: prefer above, fall back to below
    if (rect.top > 140) {
      // Show above
      content.style.bottom = (vh - rect.top + 8) + "px";
      content.style.top = "auto";
    } else {
      // Show below
      content.style.top = (rect.bottom + 8) + "px";
      content.style.bottom = "auto";
    }
  }

  document.addEventListener("mouseover", function (e) {
    const tip = e.target.closest(".help-tip");
    if (tip) positionTip(tip);
  });
  document.addEventListener("focusin", function (e) {
    const tip = e.target.closest(".help-tip");
    if (tip) positionTip(tip);
  });
})();

// ─── Field Validation (Feature 8) ───
const FIELD_VALIDATORS = {
  jobName:  { required: true,  minLength: 3, pattern: /^[a-zA-Z0-9\s\-_.()]+$/, message: "Min 3 chars, no special characters except - _ . ()" },
  rackId:   { required: false, pattern: /^[a-zA-Z0-9\-]*$/, message: "Alphanumeric and hyphens only" },
  sku:      { required: false, pattern: /^[a-zA-Z0-9\-\s]*$/, message: "Alphanumeric, hyphens, spaces only" },
  po:       { required: false, pattern: /^[a-zA-Z0-9\-]*$/, message: "Alphanumeric and hyphens only" },
};

function validateField(name, value) {
  const rule = FIELD_VALIDATORS[name];
  if (!rule) return { valid: true, message: "" };
  const v = (value || "").trim();
  if (!v) return rule.required ? { valid: false, message: "This field is required" } : { valid: true, message: "" };
  if (rule.minLength && v.length < rule.minLength) return { valid: false, message: rule.message };
  if (rule.pattern && !rule.pattern.test(v)) return { valid: false, message: rule.message };
  return { valid: true, message: "" };
}

function showFieldValidation(inputEl, result) {
  if (!inputEl) return;
  inputEl.classList.toggle("inp-valid", result.valid && inputEl.value.trim().length > 0);
  inputEl.classList.toggle("inp-invalid", !result.valid);
  let msg = inputEl.nextElementSibling;
  if (msg && msg.classList.contains("field-validation-msg")) {
    if (!result.valid) { msg.textContent = result.message; msg.style.display = ""; }
    else { msg.textContent = ""; msg.style.display = "none"; }
  } else if (!result.valid) {
    msg = document.createElement("span");
    msg.className = "field-validation-msg";
    msg.textContent = result.message;
    inputEl.parentNode.insertBefore(msg, inputEl.nextSibling);
  }
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return safeText(dateStr);
    const now = new Date();
    const secs = Math.floor((now - date) / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    const days = Math.floor(hrs / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[date.getMonth()] + " " + date.getDate();
  } catch {
    return safeText(dateStr);
  }
}
