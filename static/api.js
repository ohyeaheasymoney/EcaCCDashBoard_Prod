// ─────────────────────────────────────────────────────────────
// api.js — API helpers
// ─────────────────────────────────────────────────────────────

const API_BASE = "";

class ApiError extends Error {
  constructor(message, { status, type, detail, retryable } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.detail = detail;
    this.retryable = retryable;
  }
}

function _parseApiError(res, data) {
  const status = res.status;
  const message = data.error || res.statusText || "Request failed";
  const type = data.type || undefined;
  const detail = data.detail || undefined;
  const retryable = status >= 500 || status === 0 || status === 429;
  const err = new ApiError(message, { status, type, detail, retryable });
  // Show login overlay on 401 Unauthorized
  if (status === 401 && typeof window.showLoginOverlay === "function") {
    window.showLoginOverlay();
  }
  return err;
}

async function apiGet(path) {
  let res;
  try {
    res = await fetch(API_BASE + path);
  } catch (e) {
    throw new ApiError("Network error — check your connection", { status: 0, retryable: true });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw _parseApiError(res, data);
  return data;
}

async function apiPostJSON(path, payload) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  } catch (e) {
    throw new ApiError("Network error — check your connection", { status: 0, retryable: true });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw _parseApiError(res, data);
  return data;
}

async function apiPostForm(path, formData) {
  let res;
  try {
    res = await fetch(API_BASE + path, { method: "POST", body: formData });
  } catch (e) {
    throw new ApiError("Network error — check your connection", { status: 0, retryable: true });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw _parseApiError(res, data);
  return data;
}

async function apiDelete(path) {
  let res;
  try {
    res = await fetch(API_BASE + path, { method: "DELETE" });
  } catch (e) {
    throw new ApiError("Network error — check your connection", { status: 0, retryable: true });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw _parseApiError(res, data);
  return data;
}

async function apiPatch(path, payload) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  } catch (e) {
    throw new ApiError("Network error — check your connection", { status: 0, retryable: true });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw _parseApiError(res, data);
  return data;
}

async function apiPut(path, payload) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
  } catch (e) {
    throw new ApiError("Network error — check your connection", { status: 0, retryable: true });
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw _parseApiError(res, data);
  return data;
}

function apiPostFormWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_BASE + path);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.onload = function () {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = { raw: xhr.responseText }; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || "Upload failed", {
        status: xhr.status,
        type: data.type,
        detail: data.trace || data.detail,
        retryable: xhr.status >= 500,
      }));
    };
    xhr.onerror = function () {
      reject(new ApiError("Network error — check your connection", { status: 0, retryable: true }));
    };
    xhr.send(formData);
  });
}

async function apiWithRetry(fn, maxRetries = 2, delay = 1000) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!e.retryable || attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, delay * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}
