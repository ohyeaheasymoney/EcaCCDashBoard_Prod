// ─────────────────────────────────────────────────────────────
// wizard.js — Ansible UI v4 (DellServerAuto_4)
// Entry point: wires sidebar nav, ESC handler, and boots app.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Navigation wiring
// ─────────────────────────────────────────────────────────────
function wireSidebarNav() {
  const buttons = qsa(".nav-item");
  if (!buttons.length) return;

  buttons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();

      const page = btn.dataset.page;
      if (!page) return;

      qsa(".page-view").forEach(view => view.classList.remove("active"));
      const target = qs(`[data-page-view="${page}"]`);
      if (target) target.classList.add("active");

      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      if (page === "jobs") loadJobs();
      if (page === "admin" && typeof switchAdminTab === "function") switchAdminTab("users");
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Sidebar clock
// ─────────────────────────────────────────────────────────────
function startSidebarClock() {
  function tick() {
    const now = new Date();
    const clockEl = $("sidebar-clock");
    const dateEl = $("sidebar-date");
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    }
  }
  tick();
  setInterval(tick, 1000);
}

// ─────────────────────────────────────────────────────────────
// Browser notifications
// ─────────────────────────────────────────────────────────────
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

window.notifyJobComplete = function (jobName, result) {
  if ("Notification" in window && Notification.permission === "granted") {
    const icon = result === "passed" ? "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text y='24' font-size='24'>✅</text></svg>" : "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text y='24' font-size='24'>❌</text></svg>";
    new Notification("ECA Command Center", {
      body: `${jobName} — ${result === "passed" ? "Completed successfully" : "Failed"}`,
      icon,
      tag: "eca-job-complete",
    });
  }

  // Sound alert if enabled
  if (window._soundAlertEnabled && result === "failed") {
    playSoundAlert();
  }
};

// ─────────────────────────────────────────────────────────────
// Sound alert
// ─────────────────────────────────────────────────────────────
window._soundAlertEnabled = localStorage.getItem("eca_sound_alert") === "true";

function playSoundAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.start();
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(520, ctx.currentTime + 0.15);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
  } catch { /* audio not available */ }
}

window.toggleSoundAlert = function () {
  window._soundAlertEnabled = !window._soundAlertEnabled;
  localStorage.setItem("eca_sound_alert", window._soundAlertEnabled);
  const label = $("sound-alert-label");
  if (label) label.textContent = window._soundAlertEnabled ? "Sound: On" : "Sound: Off";
  showToast(window._soundAlertEnabled ? "Sound alerts enabled" : "Sound alerts disabled", "info");
};

// ─────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ─────────────────────────────────────────────────────────────
function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
}

function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // ESC: close panels/modals
    if (e.key === "Escape") {
      const csvPreview = $("csv-preview-modal");
      if (csvPreview) { csvPreview.remove(); return; }
      if (currentJobId) { closeJobPanel(); return; }
      const wizModal = $("wizard-modal-root");
      if (wizModal) { closeWizardModal(); return; }
      return;
    }

    // Don't trigger shortcuts when typing
    if (isInputFocused()) return;

    // Panel tab shortcuts (1-4, 5/S for Status, R for run controls)
    if (currentJobId && $("job-panel")) {
      if (e.key === "1") { e.preventDefault(); activateTab("tab-overview"); return; }
      if (e.key === "2") { e.preventDefault(); activateTab("tab-upload"); return; }
      if (e.key === "3") { e.preventDefault(); activateTab("tab-inventory"); return; }
      if (e.key === "4") { e.preventDefault(); activateTab("tab-tasks"); return; }
      if (e.key === "5" || e.key === "s" || e.key === "S") { e.preventDefault(); activateTab("tab-status"); return; }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        activateTab("tab-tasks");
        const rc = qs(".run-controls");
        if (rc) rc.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

    // N: New job
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      launchWizard();
      return;
    }

    // J: Go to Jobs page
    if (e.key === "j" || e.key === "J") {
      e.preventDefault();
      const jobsBtn = qs('[data-page="jobs"]');
      if (jobsBtn) jobsBtn.click();
      return;
    }

    // D: Go to Dashboard
    if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      const dashBtn = qs('[data-page="dashboard"]');
      if (dashBtn) dashBtn.click();
      return;
    }

    // ?: Show shortcut help
    if (e.key === "?") {
      e.preventDefault();
      showShortcutHelp();
      return;
    }
  });
}

function showShortcutHelp() {
  const existing = $("shortcut-help-modal");
  if (existing) { existing.remove(); return; }

  const kbdIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><line x1="7" y1="16" x2="17" y2="16"/></svg>';

  const el = document.createElement("div");
  el.className = "wizard-modal-root";
  el.id = "shortcut-help-modal";
  el.innerHTML = `
    <div class="wizard-overlay" onclick="document.getElementById('shortcut-help-modal').remove()"></div>
    <div class="wizard-card" style="max-width:420px;" onclick="event.stopPropagation()">
      <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
        <div class="modal-title"><div class="title-main">${kbdIcon} Keyboard Shortcuts</div></div>
        <button class="modal-close" onclick="document.getElementById('shortcut-help-modal').remove()">&times;</button>
      </div>
      <div style="padding:12px 0;">
        <div style="font-size:11px;color:#3b82f6;padding:6px 12px 4px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid rgba(59,130,246,0.2);margin-bottom:4px;">Global</div>
        <div class="shortcut-row"><kbd>N</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> <span>New Job</span></div>
        <div class="shortcut-row"><kbd>J</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> <span>Jobs Page</span></div>
        <div class="shortcut-row"><kbd>D</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> <span>Dashboard</span></div>
        <div class="shortcut-row"><kbd>Esc</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span>Close Panel/Modal</span></div>
        <div class="shortcut-row"><kbd>?</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> <span>This Help</span></div>
        <div style="font-size:11px;color:#3b82f6;padding:10px 12px 4px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid rgba(59,130,246,0.2);margin-bottom:4px;">Job Panel</div>
        <div class="shortcut-row"><kbd>1</kbd>-<kbd>4</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg> <span>Switch Tabs</span></div>
        <div class="shortcut-row"><kbd>5</kbd> / <kbd>S</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> <span>Status Tab</span></div>
        <div class="shortcut-row"><kbd>R</kbd> <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;vertical-align:-2px;"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>Jump to Run Controls</span></div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
}

// ─────────────────────────────────────────────────────────────
// Focus trap for modals (Feature 12 — Accessibility)
// ─────────────────────────────────────────────────────────────
let _previousFocus = null;

window.trapFocusInModal = function (modalEl) {
  if (!modalEl) return;
  _previousFocus = document.activeElement;

  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusables = Array.from(modalEl.querySelectorAll(focusableSelector)).filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;

  // Focus first element
  setTimeout(() => focusables[0]?.focus(), 50);

  modalEl._focusTrapHandler = function (e) {
    if (e.key !== "Tab") return;
    const current = focusables.indexOf(document.activeElement);
    if (e.shiftKey) {
      if (current <= 0) {
        e.preventDefault();
        focusables[focusables.length - 1].focus();
      }
    } else {
      if (current >= focusables.length - 1) {
        e.preventDefault();
        focusables[0].focus();
      }
    }
  };
  modalEl.addEventListener("keydown", modalEl._focusTrapHandler);
};

window.releaseFocusTrap = function (modalEl) {
  if (modalEl && modalEl._focusTrapHandler) {
    modalEl.removeEventListener("keydown", modalEl._focusTrapHandler);
  }
  if (_previousFocus) {
    _previousFocus.focus();
    _previousFocus = null;
  }
};

// ─────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────
window.showLoginOverlay = function () {
  const overlay = $("login-overlay");
  if (overlay) overlay.style.display = "flex";
};

function hideLoginOverlay() {
  const overlay = $("login-overlay");
  if (overlay) overlay.style.display = "none";
}

// ─────────────────────────────────────────────────────────────
// Password change overlay (first-login / admin-reset)
// ─────────────────────────────────────────────────────────────
function showPasswordChangeOverlay() {
  const overlay = $("pw-change-overlay");
  if (overlay) overlay.style.display = "flex";
}

function hidePasswordChangeOverlay() {
  const overlay = $("pw-change-overlay");
  if (overlay) overlay.style.display = "none";
}

function wirePasswordChangeForm() {
  const form = $("pw-change-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const current = $("pw-current")?.value || "";
    const newPw = $("pw-new")?.value || "";
    const confirm = $("pw-confirm")?.value || "";
    const errEl = $("pw-change-error");
    const btn = $("pw-change-submit");

    if (!current || !newPw || !confirm) {
      if (errEl) { errEl.textContent = "All fields are required"; errEl.style.display = "block"; }
      return;
    }
    if (newPw !== confirm) {
      if (errEl) { errEl.textContent = "New passwords do not match"; errEl.style.display = "block"; }
      return;
    }
    if (newPw.length < 3) {
      if (errEl) { errEl.textContent = "Password must be at least 3 characters"; errEl.style.display = "block"; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "Updating..."; }
    if (errEl) errEl.style.display = "none";

    try {
      const res = await fetch("/api/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (errEl) { errEl.textContent = data.error || "Password change failed"; errEl.style.display = "block"; }
        if (btn) { btn.disabled = false; btn.textContent = "Update Password"; }
        return;
      }
      hidePasswordChangeOverlay();
      if (typeof showToast === "function") showToast("Password updated successfully", "success");
      initApp();
    } catch (err) {
      if (errEl) { errEl.textContent = "Connection error"; errEl.style.display = "block"; }
      if (btn) { btn.disabled = false; btn.textContent = "Update Password"; }
    }
  });
}

function wireLoginForm() {
  const form = $("login-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = ($("login-username")?.value || "").trim();
    const password = $("login-password")?.value || "";
    const errEl = $("login-error");
    const btn = $("login-submit");

    if (!username || !password) {
      if (errEl) { errEl.textContent = "Username and password are required"; errEl.style.display = "block"; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "Signing in..."; }
    if (errEl) errEl.style.display = "none";

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (errEl) { errEl.textContent = data.error || "Login failed"; errEl.style.display = "block"; }
        if (btn) { btn.disabled = false; btn.textContent = "Sign In"; }
        return;
      }
      hideLoginOverlay();
      if (typeof initAdminNav === "function") initAdminNav(data.role || "user", data.user || "");
      if (data.mustChangePassword) {
        showPasswordChangeOverlay();
        return;
      }
      initApp();
    } catch (err) {
      if (errEl) { errEl.textContent = "Connection error"; errEl.style.display = "block"; }
      if (btn) { btn.disabled = false; btn.textContent = "Sign In"; }
    }
  });
}

async function checkAuth() {
  try {
    const res = await fetch("/api/me");
    if (res.ok) {
      const data = await res.json();
      hideLoginOverlay();
      if (typeof initAdminNav === "function") initAdminNav(data.role || "user", data.user || "");
      if (data.mustChangePassword) {
        showPasswordChangeOverlay();
        return false; // don't proceed to initApp
      }
      return true;
    }
  } catch { /* network error */ }
  window.showLoginOverlay();
  return false;
}

// ─────────────────────────────────────────────────────────────
// Onboarding / First-Run Guide (Feature 11)
// ─────────────────────────────────────────────────────────────
window.showOnboardingGuide = function () {
  if (localStorage.getItem("eca_onboarded")) return;

  const steps = [
    {
      target: ".hero-actions .btn.primary",
      fallback: 'button[onclick="launchWizard()"]',
      text: "Start here to create your first job.",
      title: "New Job",
    },
    {
      target: "#saved-jobs-list",
      text: "Your jobs appear here with live status updates and progress.",
      title: "Recent Jobs",
    },
    {
      target: '[data-page="jobs"]',
      text: "View all jobs with filters, search, and bulk actions.",
      title: "Jobs Page",
    },
    {
      target: null,
      text: 'Press <kbd>?</kbd> anytime for keyboard shortcuts. Use <kbd>N</kbd> for New Job, <kbd>J</kbd> for Jobs.',
      title: "Keyboard Shortcuts",
      center: true,
    },
  ];

  let stepIdx = 0;

  function getTargetEl(step) {
    if (step.center) return null;
    let el = step.target ? qs(step.target) : null;
    if (!el && step.fallback) el = qs(step.fallback);
    return el;
  }

  function render() {
    let existing = $("onboard-overlay");
    if (existing) existing.remove();

    if (stepIdx >= steps.length) {
      localStorage.setItem("eca_onboarded", "1");
      return;
    }

    const step = steps[stepIdx];
    const targetEl = getTargetEl(step);

    const overlay = document.createElement("div");
    overlay.id = "onboard-overlay";
    overlay.className = "onboard-overlay";

    // Spotlight cutout
    let spotlightStyle = "";
    let tooltipPos = "";
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const pad = 8;
      spotlightStyle = `position:absolute;top:${rect.top - pad}px;left:${rect.left - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px;border-radius:12px;`;
      // Tooltip below target by default
      const tipTop = rect.bottom + pad + 12;
      const tipLeft = Math.max(16, Math.min(rect.left, window.innerWidth - 340));
      tooltipPos = `top:${tipTop}px;left:${tipLeft}px;`;
    } else {
      spotlightStyle = "display:none;";
      tooltipPos = "top:50%;left:50%;transform:translate(-50%,-50%);";
    }

    // Progress dots
    let dotsHtml = '<div class="onboard-progress">';
    for (let i = 0; i < steps.length; i++) {
      dotsHtml += `<span class="onboard-dot${i === stepIdx ? " active" : i < stepIdx ? " done" : ""}"></span>`;
    }
    dotsHtml += "</div>";

    overlay.innerHTML = `
      <div class="onboard-spotlight" style="${spotlightStyle}"></div>
      <div class="onboard-tooltip" style="${tooltipPos}">
        <div class="onboard-tooltip-title">${safeText(step.title)}</div>
        <div class="onboard-tooltip-text">${step.text}</div>
        ${dotsHtml}
        <div class="onboard-tooltip-actions">
          <button class="btn ghost" id="onboard-skip" style="font-size:12px;padding:6px 14px;">Skip</button>
          <button class="btn primary" id="onboard-next" style="font-size:12px;padding:6px 14px;">${stepIdx < steps.length - 1 ? "Next" : "Done"}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    $("onboard-next").addEventListener("click", () => { stepIdx++; render(); });
    $("onboard-skip").addEventListener("click", () => {
      localStorage.setItem("eca_onboarded", "1");
      const el = $("onboard-overlay");
      if (el) el.remove();
    });

    // Click on overlay outside tooltip also skips
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        localStorage.setItem("eca_onboarded", "1");
        overlay.remove();
      }
    });
  }

  render();
};

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
async function initApp() {
  ensureWizardContainer();
  wireSidebarNav();
  wireKeyboardShortcuts();

  window.launchWizard = launchWizard;
  window.loadJobs = loadJobs;
  window.openJobPanel = openJobPanel;
  window.closeJobPanel = closeJobPanel;

  startSidebarClock();
  requestNotificationPermission();

  // Load server-side config (customers/workflows) before rendering UI
  if (typeof loadConfigFromServer === "function") {
    try { await loadConfigFromServer(); } catch (e) { console.warn("Config load failed, using defaults:", e); }
  }

  loadJobs();
  pollHealth();
  startJobPolling();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    wireLoginForm();
    wirePasswordChangeForm();
    const authed = await checkAuth();
    if (authed) initApp();
  } catch (e) {
    console.error("wizard.js init failed:", e);
    const jobsTable = $("jobs-table");
    if (jobsTable) jobsTable.innerHTML = `<p class="error">wizard.js init failed: ${safeText(e.message)}</p>`;
  }
});
