// ─────────────────────────────────────────────────────────────
// theme.js — Theme toggle + toast notifications
// ─────────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const sun  = $("theme-icon-sun");
  const moon = $("theme-icon-moon");
  const lbl  = $("theme-label");
  if (sun)  sun.style.display  = theme === "dark" ? "inline" : "none";
  if (moon) moon.style.display = theme === "light" ? "inline" : "none";
  if (lbl)  lbl.textContent    = theme === "dark" ? "Light Mode" : "Dark Mode";
}

window.toggleTheme = function () {
  const current = localStorage.getItem("theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.body.classList.add("theme-transitioning");
  localStorage.setItem("theme", next);
  applyTheme(next);
  setTimeout(() => document.body.classList.remove("theme-transitioning"), 350);
};

// Apply saved theme immediately
(function () {
  const saved = localStorage.getItem("theme") || "dark";
  applyTheme(saved);
})();

function showToast(message, type = "info", duration = 3500, opts = {}) {
  const container = $("toast-container");
  if (!container) return;

  const { actionLabel, onAction } = opts;
  const hasAction = actionLabel && onAction;
  if (hasAction && duration < 8000) duration = 8000;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  if (hasAction) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toast.classList.remove("toast-visible");
      toast.addEventListener("transitionend", () => toast.remove());
      onAction();
    });
    toast.appendChild(btn);
  }

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));

  const timer = setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.addEventListener("transitionend", () => toast.remove());
  }, duration);

  toast.addEventListener("click", () => {
    clearTimeout(timer);
    toast.classList.remove("toast-visible");
    toast.addEventListener("transitionend", () => toast.remove());
  });
}
