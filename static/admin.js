// ─────────────────────────────────────────────────────────────
// admin.js — Admin page UI (Users, Customers, Workflows, Audit Log)
// All 16 improvements: skeleton loading, Enter key, relative timestamps,
// confirm disable, duplicate modal, clear filters, pw hints, search/filter
// on users+customers, sortable columns, workflow validation, audit CSV,
// audit admin actions, bulk user actions, lastModified, expandable audit
// ─────────────────────────────────────────────────────────────

var _adminTabLoaded = {};
var _auditPollTimer = null;
var _auditAutoRefresh = false;
var _auditOffset = 0;
var _auditActionFilter = "";
var _auditSearchText = "";
const _AUDIT_LIMIT = 50;

// Sort state per tab
var _sortState = { users: { col: null, dir: "asc" }, customers: { col: null, dir: "asc" }, workflows: { col: null, dir: "asc" } };

// ─────────────────────────────────────────────────────────────
// KPI Stats
// ─────────────────────────────────────────────────────────────
async function loadAdminStats() {
  try {
    const stats = await apiGet("/api/admin/stats");
    const el = (id, val) => { const e = $(id); if (e) e.textContent = val; };
    el("admin-kpi-users", stats.users ?? "--");
    el("admin-kpi-customers", stats.customers ?? "--");
    el("admin-kpi-workflows", stats.workflows ?? "--");
    el("admin-kpi-audit", stats.audit_entries ?? "--");
    el("admin-badge-users", stats.users || "");
    el("admin-badge-customers", stats.customers || "");
    el("admin-badge-workflows", stats.workflows || "");
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────
// Sortable table helper
// ─────────────────────────────────────────────────────────────
function _sortEntries(entries, col, dir) {
  if (!col) return entries;
  return entries.slice().sort((a, b) => {
    let va = a[col] ?? "", vb = b[col] ?? "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (typeof va === "number" && typeof vb === "number") return dir === "asc" ? va - vb : vb - va;
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

function _sortHeaderHtml(tab, col, label) {
  const s = _sortState[tab];
  let cls = "sortable";
  if (s && s.col === col) cls += s.dir === "asc" ? " sort-asc" : " sort-desc";
  return `<th class="${cls}" onclick="_toggleSort('${tab}','${col}')">${label}</th>`;
}

window._toggleSort = function (tab, col) {
  const s = _sortState[tab];
  if (s.col === col) { s.dir = s.dir === "asc" ? "desc" : "asc"; }
  else { s.col = col; s.dir = "asc"; }
  _adminTabLoaded[tab] = false;
  if (tab === "users") loadAdminUsers();
  else if (tab === "customers") loadAdminCustomers();
  else if (tab === "workflows") loadAdminWorkflows();
};

// ─────────────────────────────────────────────────────────────
// Tab switching
// ─────────────────────────────────────────────────────────────
window.switchAdminTab = function (tab) {
  qsa(".admin-tab").forEach(t => t.classList.toggle("active", t.dataset.adminTab === tab));
  qsa(".admin-panel").forEach(p => p.classList.toggle("active", p.id === "admin-panel-" + tab));
  loadAdminStats();
  if (tab === "audit") {
    if (_auditAutoRefresh && !_auditPollTimer) _startAuditPoll();
  } else {
    _stopAuditPoll();
  }
  if (!_adminTabLoaded[tab]) {
    _adminTabLoaded[tab] = true;
    if (tab === "users") loadAdminUsers();
    else if (tab === "customers") loadAdminCustomers();
    else if (tab === "workflows") loadAdminWorkflows();
    else if (tab === "audit") loadAdminAudit(0);
  }
};

// ─────────────────────────────────────────────────────────────
// initAdminNav
// ─────────────────────────────────────────────────────────────
window.initAdminNav = function (role, username) {
  window._userRole = role;
  window._userName = username || "";
  const navBtn = $("nav-admin");
  if (navBtn) navBtn.style.display = (role === "admin") ? "" : "none";
  const indicator = $("admin-user-indicator");
  if (indicator && username) {
    indicator.innerHTML = `Logged in as <strong>${safeText(username)}</strong> (${safeText(role)})`;
  }
};

// ─────────────────────────────────────────────────────────────
// USERS TAB
// ─────────────────────────────────────────────────────────────
var _usersFilterText = "";
var _usersFilterRole = "";
var _selectedUsers = new Set();

async function loadAdminUsers() {
  const panel = $("admin-panel-users");
  if (!panel) return;
  panel.innerHTML = skeletonRows(4);
  try {
    const users = await apiGet("/api/admin/users");
    let userEntries = Object.entries(users).map(([u, info]) => ({ username: u, role: info.role || "user", mustChangePassword: info.mustChangePassword || false, fullName: info.fullName || "", badgeNumber: info.badgeNumber || "" }));

    // Filter
    if (_usersFilterText) {
      const ft = _usersFilterText.toLowerCase();
      userEntries = userEntries.filter(u => u.username.toLowerCase().includes(ft));
    }
    if (_usersFilterRole) {
      userEntries = userEntries.filter(u => u.role === _usersFilterRole);
    }

    // Sort
    userEntries = _sortEntries(userEntries, _sortState.users.col, _sortState.users.dir);

    _selectedUsers.clear();

    if (!userEntries.length && !_usersFilterText && !_usersFilterRole) {
      panel.innerHTML = _usersHeaderHtml() + emptyStateHtml(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        "No users found", "Add User", "_addUser()"
      );
      return;
    }

    let rows = "";
    for (const u of userEntries) {
      const roleCls = u.role === "admin" ? "admin" : "user";
      const nextRole = u.role === "admin" ? "user" : "admin";
      const pwFlag = u.mustChangePassword ? ' <span style="font-size:10px;color:#f59e0b;" title="Must change password at next login">&#x26A0; pw change</span>' : '';
      const roleClickable = u.username === 'admin' ? '' : `role-badge-clickable" onclick="_toggleUserRole('${safeText(u.username)}','${nextRole}')`;
      const checkDisabled = u.username === 'admin' ? 'disabled' : '';
      rows += `<tr>
        <td><input type="checkbox" class="user-bulk-check" value="${safeText(u.username)}" ${checkDisabled} onchange="_updateBulkBar()" /></td>
        <td><strong>${safeText(u.username)}</strong>${pwFlag}</td>
        <td>${safeText(u.fullName)}</td>
        <td>${safeText(u.badgeNumber)}</td>
        <td><span class="role-badge ${roleCls} ${roleClickable}" title="${u.username === 'admin' ? 'Built-in admin' : 'Click to toggle role'}">${safeText(u.role)}</span></td>
        <td>
          <button class="btn btn-sm ghost" onclick="_showPasswordResetModal('${safeText(u.username)}')">Reset Password</button>
          ${u.username === 'admin' ? '' : `<button class="btn btn-sm ghost" style="color:#f87171;" onclick="_deleteUser('${safeText(u.username)}')">Delete</button>`}
        </td>
      </tr>`;
    }

    panel.innerHTML = _usersHeaderHtml() + `
      <div id="users-bulk-bar" class="admin-bulk-bar" style="display:none;">
        <span class="bulk-count" id="users-bulk-count">0</span> selected
        <button class="btn btn-sm ghost" style="color:#f87171;" onclick="_bulkDeleteUsers()">Delete Selected</button>
        <button class="btn btn-sm ghost" onclick="_bulkChangeRole('user')">Set User</button>
        <button class="btn btn-sm ghost" onclick="_bulkChangeRole('admin')">Set Admin</button>
      </div>
      <div class="table-responsive"><table class="admin-table">
        <thead><tr><th style="width:30px;"><input type="checkbox" onchange="_toggleAllUsers(this.checked)" /></th>${_sortHeaderHtml('users','username','Username')}<th>Full Name</th><th>Badge</th>${_sortHeaderHtml('users','role','Role')}<th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (e) {
    panel.innerHTML = `<div class="admin-empty" style="color:#f87171;">Failed to load users: ${safeText(e.message)}</div>`;
  }
}

function _usersHeaderHtml() {
  return `
    <div class="admin-section-header">
      <h3>Users</h3>
      <div class="admin-header-actions">
        <button class="btn btn-sm ghost" onclick="_adminTabLoaded.users=false;loadAdminUsers()">Refresh</button>
      </div>
    </div>
    <div class="admin-filter-bar">
      <input class="inp" id="admin-user-search" placeholder="Search username..." value="${safeText(_usersFilterText)}" style="font-size:12px;" onkeydown="if(event.key==='Enter')_applyUserFilter()" />
      <select id="admin-user-role-filter" style="padding:5px 10px;border-radius:6px;border:1px solid var(--card-border);background:var(--card-bg);color:var(--text-primary);font-size:12px;">
        <option value="" ${!_usersFilterRole ? 'selected' : ''}>All Roles</option>
        <option value="admin" ${_usersFilterRole === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="user" ${_usersFilterRole === 'user' ? 'selected' : ''}>User</option>
      </select>
      <button class="btn btn-sm ghost" onclick="_applyUserFilter()">Apply</button>
      ${(_usersFilterText || _usersFilterRole) ? '<button class="btn btn-sm ghost" onclick="_clearUserFilter()">Clear</button>' : ''}
    </div>
    <div class="admin-form-row">
      <input class="inp" id="admin-new-username" placeholder="Username" style="max-width:160px;" onkeydown="if(event.key==='Enter')_addUser()" />
      <input class="inp" id="admin-new-password" type="password" placeholder="Password (min 3 chars)" style="max-width:180px;" onkeydown="if(event.key==='Enter')_addUser()" />
      <input class="inp" id="admin-new-fullname" placeholder="Full Name" style="max-width:160px;" onkeydown="if(event.key==='Enter')_addUser()" />
      <input class="inp" id="admin-new-badge" placeholder="Badge Number" style="max-width:130px;" onkeydown="if(event.key==='Enter')_addUser()" />
      <select id="admin-new-role" style="padding:6px 10px;border-radius:6px;border:1px solid var(--card-border);background:var(--card-bg);color:var(--text-primary);font-size:13px;">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>
      <button class="btn btn-sm primary" onclick="_addUser()">Add User</button>
    </div>`;
}

window._applyUserFilter = function () {
  _usersFilterText = $("admin-user-search")?.value || "";
  _usersFilterRole = $("admin-user-role-filter")?.value || "";
  _adminTabLoaded.users = false;
  loadAdminUsers();
};

window._clearUserFilter = function () {
  _usersFilterText = "";
  _usersFilterRole = "";
  _adminTabLoaded.users = false;
  loadAdminUsers();
};

window._toggleAllUsers = function (checked) {
  qsa(".user-bulk-check").forEach(cb => { if (!cb.disabled) cb.checked = checked; });
  _updateBulkBar();
};

window._updateBulkBar = function () {
  const checked = qsa(".user-bulk-check:checked").map(cb => cb.value);
  _selectedUsers = new Set(checked);
  const bar = $("users-bulk-bar");
  const countEl = $("users-bulk-count");
  if (bar) bar.style.display = checked.length ? "" : "none";
  if (countEl) countEl.textContent = checked.length;
};

window._bulkDeleteUsers = async function () {
  const users = Array.from(_selectedUsers);
  if (!users.length) return;
  const ok = await showConfirmAsync(`Delete ${users.length} user(s)? This cannot be undone.\n\n${users.join(", ")}`, {
    title: "Bulk Delete Users", confirmText: "Delete All", danger: true,
  });
  if (!ok) return;
  let failed = 0;
  for (const u of users) {
    try { await apiDelete(`/api/admin/users/${encodeURIComponent(u)}`); }
    catch { failed++; }
  }
  showToast(`Deleted ${users.length - failed} user(s)${failed ? `, ${failed} failed` : ""}`, failed ? "error" : "success");
  _adminTabLoaded.users = false;
  loadAdminUsers();
  loadAdminStats();
};

window._bulkChangeRole = async function (role) {
  const users = Array.from(_selectedUsers);
  if (!users.length) return;
  let failed = 0;
  for (const u of users) {
    try { await apiPatch(`/api/admin/users/${encodeURIComponent(u)}/role`, { role }); }
    catch { failed++; }
  }
  showToast(`Set ${users.length - failed} user(s) to ${role}${failed ? `, ${failed} failed` : ""}`, failed ? "error" : "success");
  _adminTabLoaded.users = false;
  loadAdminUsers();
};

window._addUser = async function () {
  const username = ($("admin-new-username")?.value || "").trim();
  const password = $("admin-new-password")?.value || "";
  const fullName = ($("admin-new-fullname")?.value || "").trim();
  const badgeNumber = ($("admin-new-badge")?.value || "").trim();
  const role = $("admin-new-role")?.value || "user";
  if (!username || !password) { showToast("Username and password required", "error"); return; }
  if (password.length < 3) { showToast("Password must be at least 3 characters", "error"); return; }
  try {
    await apiPostJSON("/api/admin/users", { username, password, role, fullName, badgeNumber });
    showToast(`User '${username}' created`, "success");
    _adminTabLoaded.users = false;
    loadAdminUsers();
    loadAdminStats();
  } catch (e) { showToast("Create failed: " + e.message, "error"); }
};

window._toggleUserRole = async function (username, newRole) {
  try {
    await apiPatch(`/api/admin/users/${encodeURIComponent(username)}/role`, { role: newRole });
    showToast(`${username} role changed to ${newRole}`, "success");
    _adminTabLoaded.users = false;
    loadAdminUsers();
  } catch (e) { showToast("Role change failed: " + e.message, "error"); }
};

window._showPasswordResetModal = function (username) {
  const container = $("confirm-modal-container");
  if (!container) return;
  container.innerHTML = `
    <div class="confirm-overlay" id="pw-reset-overlay">
      <div class="confirm-card admin-pw-modal">
        <div class="confirm-title">Reset Password &mdash; ${safeText(username)}</div>
        <input class="inp" type="password" placeholder="New password (min 3 characters)" id="admin-pw-reset-input" autocomplete="new-password" onkeydown="if(event.key==='Enter')_submitPwReset('${safeText(username)}')" />
        <div class="confirm-actions">
          <button class="btn ghost" onclick="document.getElementById('pw-reset-overlay').remove()">Cancel</button>
          <button class="btn primary" onclick="_submitPwReset('${safeText(username)}')">Reset</button>
        </div>
      </div>
    </div>`;
  setTimeout(() => { const inp = $("admin-pw-reset-input"); if (inp) inp.focus(); }, 50);
};

window._submitPwReset = async function (username) {
  const pw = $("admin-pw-reset-input")?.value || "";
  if (!pw) { showToast("Password is required", "error"); return; }
  if (pw.length < 3) { showToast("Password must be at least 3 characters", "error"); return; }
  try {
    await apiPatch(`/api/admin/users/${encodeURIComponent(username)}/password`, { password: pw });
    showToast(`Password reset for ${username}`, "success");
    const overlay = $("pw-reset-overlay");
    if (overlay) overlay.remove();
  } catch (e) { showToast("Reset failed: " + e.message, "error"); }
};

window._deleteUser = async function (username) {
  const ok = await showConfirmAsync(`Delete user '${username}'? This cannot be undone.`, {
    title: "Delete User", confirmText: "Delete", danger: true,
  });
  if (!ok) return;
  try {
    await apiDelete(`/api/admin/users/${encodeURIComponent(username)}`);
    showToast(`User '${username}' deleted`, "success");
    _adminTabLoaded.users = false;
    loadAdminUsers();
    loadAdminStats();
  } catch (e) { showToast("Delete failed: " + e.message, "error"); }
};

// ─────────────────────────────────────────────────────────────
// CUSTOMERS TAB
// ─────────────────────────────────────────────────────────────
var _allWorkflowIds = [];
var _custFilterText = "";

async function loadAdminCustomers() {
  const panel = $("admin-panel-customers");
  if (!panel) return;
  panel.innerHTML = skeletonRows(4);
  try {
    const [customers, workflows] = await Promise.all([
      apiGet("/api/admin/customers"),
      apiGet("/api/admin/workflows"),
    ]);
    _allWorkflowIds = Object.keys(workflows);
    let custEntries = Object.entries(customers).map(([id, c]) => ({ id, ...c }));

    // Filter
    if (_custFilterText) {
      const ft = _custFilterText.toLowerCase();
      custEntries = custEntries.filter(c => c.id.toLowerCase().includes(ft) || (c.label || "").toLowerCase().includes(ft));
    }

    // Sort
    custEntries = _sortEntries(custEntries, _sortState.customers.col, _sortState.customers.dir);

    const headerHtml = `
      <div class="admin-section-header">
        <h3>Customers</h3>
        <div class="admin-header-actions">
          <button class="btn btn-sm ghost" onclick="_adminTabLoaded.customers=false;loadAdminCustomers()">Refresh</button>
          <button class="btn btn-sm primary" onclick="_editCustomer('')">+ Add Customer</button>
        </div>
      </div>
      <div class="admin-filter-bar">
        <input class="inp" id="admin-cust-search" placeholder="Search ID or label..." value="${safeText(_custFilterText)}" style="font-size:12px;" onkeydown="if(event.key==='Enter')_applyCustFilter()" />
        <button class="btn btn-sm ghost" onclick="_applyCustFilter()">Apply</button>
        ${_custFilterText ? '<button class="btn btn-sm ghost" onclick="_clearCustFilter()">Clear</button>' : ''}
      </div>`;

    if (!custEntries.length) {
      panel.innerHTML = headerHtml + emptyStateHtml(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
        _custFilterText ? "No customers match filter" : "No customers configured", "Add Customer", "_editCustomer('')"
      );
      return;
    }

    let rows = "";
    for (const c of custEntries) {
      const wfCount = (c.workflows || []).length;
      const modified = c.lastModified ? `<span title="${safeText(c.lastModified)}">${timeAgo(c.lastModified)}</span>` : '<span style="color:var(--text-muted);">—</span>';
      const enabledHtml = `<label class="admin-toggle"><input type="checkbox" ${c.enabled !== false ? "checked" : ""} onchange="_toggleCustomerEnabled('${safeText(c.id)}', this.checked)" /><span class="admin-toggle-slider"></span></label>`;
      const disabledBadge = c.enabled === false ? ' <span class="wf-disabled-badge">Disabled</span>' : "";
      rows += `<tr>
        <td><code>${safeText(c.id)}</code></td>
        <td><strong>${safeText(c.label)}</strong>${disabledBadge}</td>
        <td>${safeText(c.description || "").substring(0, 60)}${(c.description || "").length > 60 ? "..." : ""}</td>
        <td>${c.hasServerClass ? "Yes" : "No"}</td>
        <td>${wfCount} workflow${wfCount !== 1 ? "s" : ""}</td>
        <td>${enabledHtml}</td>
        <td style="font-size:11px;color:var(--text-muted);">${modified}</td>
        <td>
          <button class="btn btn-sm ghost" onclick="_editCustomer('${safeText(c.id)}')">Edit</button>
          <button class="btn btn-sm ghost" style="color:#f87171;" onclick="_deleteCustomer('${safeText(c.id)}','${safeText(c.label)}')">Delete</button>
        </td>
      </tr>`;
    }
    panel.innerHTML = headerHtml + `
      <div class="table-responsive"><table class="admin-table">
        <thead><tr>${_sortHeaderHtml('customers','id','ID')}${_sortHeaderHtml('customers','label','Label')}<th>Description</th><th>Server Class</th><th>Workflows</th><th>Enabled</th>${_sortHeaderHtml('customers','lastModified','Modified')}<th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (e) {
    panel.innerHTML = `<div class="admin-empty" style="color:#f87171;">Failed to load customers: ${safeText(e.message)}</div>`;
  }
}

window._applyCustFilter = function () {
  _custFilterText = $("admin-cust-search")?.value || "";
  _adminTabLoaded.customers = false;
  loadAdminCustomers();
};

window._clearCustFilter = function () {
  _custFilterText = "";
  _adminTabLoaded.customers = false;
  loadAdminCustomers();
};

window._toggleCustomerEnabled = async function (custId, enabled) {
  if (!enabled) {
    const ok = await showConfirmAsync(`Disable customer '${custId}'? It will no longer appear in the job wizard.`, {
      title: "Disable Customer", confirmText: "Disable", danger: true,
    });
    if (!ok) {
      _adminTabLoaded.customers = false;
      loadAdminCustomers();
      return;
    }
  }
  try {
    const all = await apiGet("/api/admin/customers");
    const cust = all[custId];
    if (!cust) return;
    cust.enabled = enabled;
    await apiPut(`/api/admin/customers/${encodeURIComponent(custId)}`, cust);
    showToast(`Customer '${custId}' ${enabled ? "enabled" : "disabled"}`, "success");
    _adminTabLoaded.customers = false;
    loadAdminCustomers();
  } catch (e) { showToast("Toggle failed: " + e.message, "error"); }
};

window._editCustomer = async function (custId) {
  let existing = {};
  if (custId) {
    try {
      const all = await apiGet("/api/admin/customers");
      existing = all[custId] || {};
    } catch { /* empty */ }
  }
  const container = $("confirm-modal-container");
  if (!container) return;

  const wfChecks = _allWorkflowIds.map(wfId => {
    const checked = (existing.workflows || []).includes(wfId) ? "checked" : "";
    return `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px;"><input type="checkbox" class="cust-wf-check" value="${safeText(wfId)}" ${checked}/>${safeText(wfId)}</label>`;
  }).join("");

  container.innerHTML = `
    <div class="confirm-overlay" id="cust-edit-overlay">
      <div class="confirm-card" style="max-width:480px;">
        <div class="confirm-title">${custId ? "Edit" : "Add"} Customer</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin:12px 0;">
          <div><label class="muted" style="font-size:11px;">ID (lowercase, no spaces)</label><input class="inp" id="cust-edit-id" value="${safeText(custId)}" ${custId ? "disabled" : ""} placeholder="e.g. acme_corp" style="width:100%;" /></div>
          <div><label class="muted" style="font-size:11px;">Label</label><input class="inp" id="cust-edit-label" value="${safeText(existing.label || "")}" placeholder="Display name" style="width:100%;" /></div>
          <div><label class="muted" style="font-size:11px;">Description</label><input class="inp" id="cust-edit-desc" value="${safeText(existing.description || "")}" placeholder="Short description" style="width:100%;" /></div>
          <div><label class="muted" style="font-size:11px;">Playbook Path</label><input class="inp" id="cust-edit-path" value="${safeText(existing.path || "")}" placeholder="/path/to/playbook/root" style="width:100%;" /></div>
          <div><label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" id="cust-edit-serverclass" ${existing.hasServerClass ? "checked" : ""}/> Has Server Class (I/J)</label></div>
          <div><label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" id="cust-edit-enabled" ${existing.enabled !== false ? "checked" : ""}/> Enabled</label></div>
          <div><label class="muted" style="font-size:11px;">Workflows</label><div style="max-height:120px;overflow-y:auto;">${wfChecks}</div></div>
        </div>
        <div class="confirm-actions">
          <button class="btn ghost" onclick="document.getElementById('cust-edit-overlay').remove()">Cancel</button>
          <button class="btn primary" onclick="_saveCustomerForm('${safeText(custId)}')">Save</button>
        </div>
      </div>
    </div>`;
  // Enter key support in customer modal
  setTimeout(() => {
    qsa("#cust-edit-overlay .inp").forEach(inp => {
      inp.addEventListener("keydown", e => { if (e.key === "Enter") _saveCustomerForm(custId); });
    });
  }, 50);
};

window._saveCustomerForm = async function (origId) {
  const id = origId || ($("cust-edit-id")?.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const label = $("cust-edit-label")?.value || "";
  const description = $("cust-edit-desc")?.value || "";
  const path = $("cust-edit-path")?.value || "";
  const hasServerClass = $("cust-edit-serverclass")?.checked || false;
  const workflows = Array.from(qsa(".cust-wf-check:checked")).map(el => el.value);
  if (!id || !label) { showToast("ID and Label are required", "error"); return; }
  try {
    const enabled = !!$("cust-edit-enabled")?.checked;
    await apiPut(`/api/admin/customers/${encodeURIComponent(id)}`, { label, description, path, hasServerClass, enabled, workflows });
    showToast(`Customer '${label}' saved`, "success");
    const overlay = $("cust-edit-overlay");
    if (overlay) overlay.remove();
    _adminTabLoaded.customers = false;
    loadAdminCustomers();
    loadAdminStats();
  } catch (e) { showToast("Save failed: " + e.message, "error"); }
};

window._deleteCustomer = async function (custId, custLabel) {
  const displayName = custLabel ? `${custId} (${custLabel})` : custId;
  const ok = await showConfirmAsync(`Delete customer '${displayName}'?`, { title: "Delete Customer", confirmText: "Delete", danger: true });
  if (!ok) return;
  try {
    await apiDelete(`/api/admin/customers/${encodeURIComponent(custId)}`);
    showToast("Customer deleted", "success");
    _adminTabLoaded.customers = false;
    loadAdminCustomers();
    loadAdminStats();
  } catch (e) { showToast("Delete failed: " + e.message, "error"); }
};

// ─────────────────────────────────────────────────────────────
// WORKFLOWS TAB
// ─────────────────────────────────────────────────────────────
async function loadAdminWorkflows() {
  const panel = $("admin-panel-workflows");
  if (!panel) return;
  panel.innerHTML = skeletonRows(4);
  try {
    const workflows = await apiGet("/api/admin/workflows");
    let wfEntries = Object.entries(workflows).map(([id, wf]) => ({
      id, label: wf.label || "", category: wf.category || "Server",
      playbookName: wf.playbookName || "", enabled: wf.enabled !== false,
      taskCount: Object.values(wf.tasks || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0),
      lastModified: wf.lastModified || "", _raw: wf,
    }));

    // Sort
    wfEntries = _sortEntries(wfEntries, _sortState.workflows.col, _sortState.workflows.dir);

    if (!wfEntries.length) {
      panel.innerHTML = `
        <div class="admin-section-header">
          <h3>Workflows</h3>
          <div class="admin-header-actions">
            <button class="btn btn-sm ghost" onclick="_adminTabLoaded.workflows=false;loadAdminWorkflows()">Refresh</button>
            <button class="btn btn-sm primary" onclick="_editWorkflow('')">+ Add Workflow</button>
          </div>
        </div>` +
        emptyStateHtml(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/></svg>',
          "No workflows configured", "Add Workflow", "_editWorkflow('')"
        );
      return;
    }
    let rows = "";
    for (const wf of wfEntries) {
      const enabledHtml = `<label class="admin-toggle"><input type="checkbox" ${wf.enabled ? "checked" : ""} onchange="_toggleWorkflowEnabled('${safeText(wf.id)}', this.checked)" /><span class="admin-toggle-slider"></span></label>`;
      const disabledBadge = wf.enabled ? "" : ' <span class="wf-disabled-badge">Disabled</span>';
      const modified = wf.lastModified ? `<span title="${safeText(wf.lastModified)}">${timeAgo(wf.lastModified)}</span>` : '<span style="color:var(--text-muted);">—</span>';
      rows += `<tr>
        <td><code>${safeText(wf.id)}</code></td>
        <td><strong>${safeText(wf.label)}</strong>${disabledBadge}</td>
        <td><span class="role-badge ${wf.category === 'Server' ? 'admin' : 'user'}">${safeText(wf.category)}</span></td>
        <td style="font-size:12px;color:var(--text-muted);">${safeText(wf.playbookName || "—")}</td>
        <td>${wf.taskCount} task${wf.taskCount !== 1 ? "s" : ""}</td>
        <td>${enabledHtml}</td>
        <td style="font-size:11px;color:var(--text-muted);">${modified}</td>
        <td>
          <button class="btn btn-sm ghost" onclick="_editWorkflow('${safeText(wf.id)}')">Edit</button>
          <button class="btn btn-sm ghost" onclick="_duplicateWorkflow('${safeText(wf.id)}')">Duplicate</button>
          <button class="btn btn-sm ghost" style="color:#f87171;" onclick="_deleteWorkflow('${safeText(wf.id)}')">Delete</button>
        </td>
      </tr>`;
    }
    panel.innerHTML = `
      <div class="admin-section-header">
        <h3>Workflows</h3>
        <div class="admin-header-actions">
          <button class="btn btn-sm ghost" onclick="_adminTabLoaded.workflows=false;loadAdminWorkflows()">Refresh</button>
          <button class="btn btn-sm primary" onclick="_editWorkflow('')">+ Add Workflow</button>
        </div>
      </div>
      <div class="table-responsive"><table class="admin-table">
        <thead><tr>${_sortHeaderHtml('workflows','id','ID')}${_sortHeaderHtml('workflows','label','Label')}${_sortHeaderHtml('workflows','category','Category')}<th>Playbook</th><th>Tasks</th><th>Enabled</th>${_sortHeaderHtml('workflows','lastModified','Modified')}<th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (e) {
    panel.innerHTML = `<div class="admin-empty" style="color:#f87171;">Failed to load workflows: ${safeText(e.message)}</div>`;
  }
}

window._toggleWorkflowEnabled = async function (wfId, enabled) {
  if (!enabled) {
    const ok = await showConfirmAsync(`Disable workflow '${wfId}'? It will no longer appear in the job wizard.`, {
      title: "Disable Workflow", confirmText: "Disable", danger: true,
    });
    if (!ok) {
      // Revert toggle
      _adminTabLoaded.workflows = false;
      loadAdminWorkflows();
      return;
    }
  }
  try {
    const all = await apiGet("/api/admin/workflows");
    const wf = all[wfId];
    if (!wf) return;
    wf.enabled = enabled;
    await apiPut(`/api/admin/workflows/${encodeURIComponent(wfId)}`, wf);
    showToast(`Workflow '${wfId}' ${enabled ? "enabled" : "disabled"}`, "success");
    _adminTabLoaded.workflows = false;
    loadAdminWorkflows();
  } catch (e) { showToast("Toggle failed: " + e.message, "error"); }
};

window._duplicateWorkflow = async function (wfId) {
  try {
    const all = await apiGet("/api/admin/workflows");
    const src = all[wfId];
    if (!src) { showToast("Workflow not found", "error"); return; }
    // Show modal instead of prompt()
    const container = $("confirm-modal-container");
    if (!container) return;
    container.innerHTML = `
      <div class="confirm-overlay" id="dup-wf-overlay">
        <div class="confirm-card" style="max-width:400px;">
          <div class="confirm-title">Duplicate Workflow</div>
          <div class="confirm-message">Enter a new ID for the copy of '${safeText(wfId)}':</div>
          <input class="inp" id="dup-wf-new-id" value="${safeText(wfId)}_copy" style="width:100%;margin-bottom:12px;" onkeydown="if(event.key==='Enter')_submitDuplicateWorkflow('${safeText(wfId)}')" />
          <div class="confirm-actions">
            <button class="btn ghost" onclick="document.getElementById('dup-wf-overlay').remove()">Cancel</button>
            <button class="btn primary" onclick="_submitDuplicateWorkflow('${safeText(wfId)}')">Duplicate</button>
          </div>
        </div>
      </div>`;
    setTimeout(() => { const inp = $("dup-wf-new-id"); if (inp) { inp.focus(); inp.select(); } }, 50);
  } catch (e) { showToast("Duplicate failed: " + e.message, "error"); }
};

window._submitDuplicateWorkflow = async function (srcId) {
  const newId = ($("dup-wf-new-id")?.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!newId) { showToast("Invalid ID", "error"); return; }
  try {
    const all = await apiGet("/api/admin/workflows");
    if (all[newId]) { showToast(`Workflow '${newId}' already exists`, "error"); return; }
    const src = all[srcId];
    if (!src) { showToast("Source workflow not found", "error"); return; }
    const copy = JSON.parse(JSON.stringify(src));
    copy.label = copy.label + " (Copy)";
    await apiPut(`/api/admin/workflows/${encodeURIComponent(newId)}`, copy);
    showToast(`Workflow duplicated as '${newId}'`, "success");
    const overlay = $("dup-wf-overlay");
    if (overlay) overlay.remove();
    _adminTabLoaded.workflows = false;
    loadAdminWorkflows();
    loadAdminStats();
  } catch (e) { showToast("Duplicate failed: " + e.message, "error"); }
};

// ─── Workflow edit modal with 5 collapsible sections ───

function _wfToggleSection(btn) {
  btn.classList.toggle("collapsed");
  const body = btn.nextElementSibling;
  if (body) body.classList.toggle("collapsed");
}

window._editWorkflow = async function (wfId) {
  let existing = {};
  if (wfId) {
    try {
      const all = await apiGet("/api/admin/workflows");
      existing = all[wfId] || {};
    } catch { /* empty */ }
  }
  const container = $("confirm-modal-container");
  if (!container) return;

  const tasks = existing.tasks || {};
  let taskGroupsHtml = "";
  for (const [groupKey, taskList] of Object.entries(tasks)) {
    const taskRows = (Array.isArray(taskList) ? taskList : []).map(t =>
      `<div class="admin-form-row" style="padding:4px 0;border:none;" data-task-group="${safeText(groupKey)}">
        <input class="inp" value="${safeText(t.id)}" placeholder="id" style="max-width:100px;" data-task-field="id" />
        <input class="inp" value="${safeText(t.label)}" placeholder="label" style="max-width:140px;" data-task-field="label" />
        <input class="inp" value="${safeText((t.tags || []).join(','))}" placeholder="tags (comma)" style="max-width:120px;" data-task-field="tags" />
        <button class="btn btn-xs ghost" style="color:#f87171;" onclick="this.parentElement.remove()">x</button>
      </div>`
    ).join("");
    taskGroupsHtml += `
      <div class="wf-task-group" data-group-key="${safeText(groupKey)}" style="margin:8px 0;padding:8px;border:1px solid var(--card-border);border-radius:6px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <strong style="font-size:12px;">Group: <input class="inp" value="${safeText(groupKey)}" style="width:120px;display:inline;" data-group-name /></strong>
          <button class="btn btn-xs ghost" onclick="_addTaskRow(this.closest('.wf-task-group'))">+ Task</button>
          <button class="btn btn-xs ghost" style="color:#f87171;" onclick="this.closest('.wf-task-group').remove()">Remove Group</button>
        </div>
        ${taskRows}
      </div>`;
  }

  const flagFields = [
    { key: "requiresInventory", label: "Requires Inventory" },
    { key: "requiresWorkbook", label: "Requires Workbook" },
    { key: "requiresFirmware", label: "Requires Firmware" },
    { key: "requiresBiosXml", label: "Requires BIOS XML" },
    { key: "supportsServerClass", label: "Supports Server Class" },
    { key: "supportsHostLimit", label: "Supports Host Limit" },
    { key: "hasTasks", label: "Has Selectable Tasks" },
  ];
  const flagsHtml = flagFields.map(f => {
    const isChecked = wfId ? (existing[f.key] ? "checked" : "") : (f.key === "hasTasks" ? "checked" : "");
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <label class="admin-toggle"><input type="checkbox" id="wf-flag-${f.key}" ${isChecked} /><span class="admin-toggle-slider"></span></label>
      <span style="font-size:12px;">${f.label}</span>
    </div>`;
  }).join("");

  container.innerHTML = `
    <div class="confirm-overlay" id="wf-edit-overlay">
      <div class="confirm-card" style="max-width:600px;max-height:85vh;overflow-y:auto;">
        <div class="confirm-title">${wfId ? "Edit" : "Add"} Workflow</div>
        <div style="display:flex;flex-direction:column;gap:4px;margin:12px 0;">
          <div class="admin-modal-section">
            <div class="admin-modal-section-title" onclick="_wfToggleSection(this)">Basic Info <span class="chevron">&#x25BC;</span></div>
            <div class="admin-modal-section-body">
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div><label class="muted" style="font-size:11px;">ID (lowercase, no spaces)</label><input class="inp" id="wf-edit-id" value="${safeText(wfId)}" ${wfId ? "disabled" : ""} placeholder="e.g. my_workflow" style="width:100%;" /></div>
                <div><label class="muted" style="font-size:11px;">Label</label><input class="inp" id="wf-edit-label" value="${safeText(existing.label || "")}" placeholder="Display name" style="width:100%;" /></div>
                <div><label class="muted" style="font-size:11px;">Category</label>
                  <select id="wf-edit-category" style="padding:6px 10px;border-radius:6px;border:1px solid var(--card-border);background:var(--card-bg);color:var(--text-primary);font-size:13px;width:100%;">
                    <option value="Server" ${(existing.category || "Server") === "Server" ? "selected" : ""}>Server</option>
                    <option value="Network" ${existing.category === "Network" ? "selected" : ""}>Network</option>
                    <option value="Power" ${existing.category === "Power" ? "selected" : ""}>Power</option>
                  </select>
                </div>
                <div><label class="muted" style="font-size:11px;">Description</label><textarea class="inp" id="wf-edit-desc" placeholder="Short description" style="width:100%;min-height:48px;resize:vertical;">${safeText(existing.description || "")}</textarea></div>
              </div>
            </div>
          </div>
          <div class="admin-modal-section">
            <div class="admin-modal-section-title" onclick="_wfToggleSection(this)">Playbook <span class="chevron">&#x25BC;</span></div>
            <div class="admin-modal-section-body">
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div><label class="muted" style="font-size:11px;">Playbook Filename</label><input class="inp" id="wf-edit-playbook" value="${safeText(existing.playbookName || "")}" placeholder="e.g. ConfigMain._I_class.yaml" style="width:100%;" /></div>
                <div><label class="muted" style="font-size:11px;">Card Instructions (help text in wizard)</label><textarea class="inp" id="wf-edit-instructions" placeholder="Optional help text" style="width:100%;min-height:36px;resize:vertical;">${safeText(existing.cardInstructions || "")}</textarea></div>
              </div>
            </div>
          </div>
          <div class="admin-modal-section">
            <div class="admin-modal-section-title" onclick="_wfToggleSection(this)">Flags <span class="chevron">&#x25BC;</span></div>
            <div class="admin-modal-section-body">
              <div><label style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                <label class="admin-toggle"><input type="checkbox" id="wf-flag-enabled" ${existing.enabled !== false ? "checked" : ""} /><span class="admin-toggle-slider"></span></label>
                <span style="font-size:12px;font-weight:600;">Enabled (visible in job wizard)</span>
              </label></div>
              ${flagsHtml}
            </div>
          </div>
          <div class="admin-modal-section">
            <div class="admin-modal-section-title" onclick="_wfToggleSection(this)">Task Groups <span class="chevron">&#x25BC;</span></div>
            <div class="admin-modal-section-body">
              <div id="wf-task-groups">${taskGroupsHtml}</div>
              <button class="btn ghost" style="font-size:12px;margin-top:4px;" onclick="_addTaskGroup()">+ Add Task Group</button>
            </div>
          </div>
          <div class="admin-modal-section">
            <div class="admin-modal-section-title collapsed" onclick="_wfToggleSection(this)">Preview (JSON) <span class="chevron">&#x25BC;</span></div>
            <div class="admin-modal-section-body collapsed">
              <pre id="wf-json-preview" style="font-size:11px;max-height:200px;overflow:auto;background:var(--bg-body);padding:8px;border-radius:6px;border:1px solid var(--card-border);"></pre>
              <button class="btn ghost" style="font-size:11px;margin-top:4px;" onclick="_refreshWfPreview()">Refresh Preview</button>
            </div>
          </div>
        </div>
        <div id="wf-validation-msg" style="color:#f87171;font-size:12px;padding:0 0 8px;display:none;"></div>
        <div class="confirm-actions">
          <button class="btn ghost" onclick="document.getElementById('wf-edit-overlay').remove()">Cancel</button>
          <button class="btn primary" onclick="_saveWorkflowForm('${safeText(wfId)}')">Save</button>
        </div>
      </div>
    </div>`;
};

window._refreshWfPreview = function () {
  const preview = $("wf-json-preview");
  if (!preview) return;
  const data = _collectWorkflowFormData("");
  preview.textContent = JSON.stringify(data, null, 2);
};

function _collectWorkflowFormData(origId) {
  const id = origId || ($("wf-edit-id")?.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const label = $("wf-edit-label")?.value || "";
  const category = $("wf-edit-category")?.value || "Server";
  const description = $("wf-edit-desc")?.value || "";
  const playbookName = $("wf-edit-playbook")?.value || "";
  const cardInstructions = $("wf-edit-instructions")?.value || "";
  const enabled = $("wf-flag-enabled")?.checked !== false;
  const flags = {};
  ["requiresInventory","requiresWorkbook","requiresFirmware","requiresBiosXml","supportsServerClass","supportsHostLimit","hasTasks"].forEach(k => {
    flags[k] = $("wf-flag-" + k)?.checked || false;
  });
  const tasks = {};
  qsa("#wf-task-groups .wf-task-group").forEach(groupEl => {
    const groupName = groupEl.querySelector("[data-group-name]")?.value || "";
    if (!groupName) return;
    const taskList = [];
    groupEl.querySelectorAll(".admin-form-row").forEach(row => {
      const tid = row.querySelector('[data-task-field="id"]')?.value || "";
      const tlabel = row.querySelector('[data-task-field="label"]')?.value || "";
      const ttags = (row.querySelector('[data-task-field="tags"]')?.value || "").split(",").map(s => s.trim()).filter(Boolean);
      if (tid) taskList.push({ id: tid, label: tlabel, tags: ttags });
    });
    tasks[groupName] = taskList;
  });
  return { id, label, category, description, playbookName, cardInstructions, enabled, ...flags, tasks };
}

function _validateWorkflowForm(data) {
  const warnings = [];
  if (!data.id) warnings.push("Workflow ID is required");
  if (!data.label) warnings.push("Label is required");
  if (data.hasTasks) {
    const taskCount = Object.values(data.tasks).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
    if (taskCount === 0) warnings.push("'Has Selectable Tasks' is enabled but no tasks are defined");
  }
  // Check for empty group names
  const groups = qsa("#wf-task-groups .wf-task-group");
  for (const g of groups) {
    const name = g.querySelector("[data-group-name]")?.value || "";
    if (!name) warnings.push("A task group has an empty name");
  }
  return warnings;
}

window._addTaskGroup = function () {
  const container = $("wf-task-groups");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "wf-task-group";
  div.style.cssText = "margin:8px 0;padding:8px;border:1px solid var(--card-border);border-radius:6px;";
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <strong style="font-size:12px;">Group: <input class="inp" value="" style="width:120px;display:inline;" data-group-name placeholder="group_key" /></strong>
      <button class="btn btn-xs ghost" onclick="_addTaskRow(this.closest('.wf-task-group'))">+ Task</button>
      <button class="btn btn-xs ghost" style="color:#f87171;" onclick="this.closest('.wf-task-group').remove()">Remove Group</button>
    </div>`;
  container.appendChild(div);
};

window._addTaskRow = function (groupEl) {
  if (!groupEl) return;
  const row = document.createElement("div");
  row.className = "admin-form-row";
  row.style.cssText = "padding:4px 0;border:none;";
  row.innerHTML = `
    <input class="inp" value="" placeholder="id" style="max-width:100px;" data-task-field="id" />
    <input class="inp" value="" placeholder="label" style="max-width:140px;" data-task-field="label" />
    <input class="inp" value="" placeholder="tags (comma)" style="max-width:120px;" data-task-field="tags" />
    <button class="btn btn-xs ghost" style="color:#f87171;" onclick="this.parentElement.remove()">x</button>`;
  groupEl.appendChild(row);
};

window._saveWorkflowForm = async function (origId) {
  const data = _collectWorkflowFormData(origId);
  const warnings = _validateWorkflowForm(data);
  const msgEl = $("wf-validation-msg");

  if (!data.id || !data.label) {
    if (msgEl) { msgEl.textContent = "ID and Label are required"; msgEl.style.display = ""; }
    showToast("ID and Label are required", "error");
    return;
  }

  // Show warnings but allow save
  if (warnings.length && msgEl) {
    msgEl.innerHTML = warnings.map(w => safeText(w)).join("<br>");
    msgEl.style.display = "";
  }

  try {
    await apiPut(`/api/admin/workflows/${encodeURIComponent(data.id)}`, data);
    showToast(`Workflow '${data.label}' saved`, "success");
    const overlay = $("wf-edit-overlay");
    if (overlay) overlay.remove();
    _adminTabLoaded.workflows = false;
    loadAdminWorkflows();
    loadAdminStats();
  } catch (e) { showToast("Save failed: " + e.message, "error"); }
};

window._deleteWorkflow = async function (wfId) {
  const ok = await showConfirmAsync(`Delete workflow '${wfId}'?`, { title: "Delete Workflow", confirmText: "Delete", danger: true });
  if (!ok) return;
  try {
    await apiDelete(`/api/admin/workflows/${encodeURIComponent(wfId)}`);
    showToast("Workflow deleted", "success");
    _adminTabLoaded.workflows = false;
    loadAdminWorkflows();
    loadAdminStats();
  } catch (e) { showToast("Delete failed: " + e.message, "error"); }
};

// ─────────────────────────────────────────────────────────────
// AUDIT LOG TAB
// ─────────────────────────────────────────────────────────────
async function loadAdminAudit(offset) {
  const panel = $("admin-panel-audit");
  if (!panel) return;
  _auditOffset = offset || 0;

  const existingViewer = panel.querySelector(".audit-log-viewer");
  if (!existingViewer) {
    panel.innerHTML = `
      <div class="admin-section-header">
        <h3>Audit Log</h3>
        <div class="admin-header-actions">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
            <label class="admin-toggle"><input type="checkbox" id="audit-auto-refresh" ${_auditAutoRefresh ? "checked" : ""} onchange="_toggleAuditAutoRefresh(this.checked)" /><span class="admin-toggle-slider"></span></label>
            Auto-refresh
          </label>
          <button class="btn btn-sm ghost" onclick="_exportAuditCSV()">Export CSV</button>
          <button class="btn btn-sm ghost" onclick="loadAdminAudit(0)">Refresh</button>
        </div>
      </div>
      <div class="admin-filter-bar">
        <select id="audit-action-filter" style="padding:5px 10px;border-radius:6px;border:1px solid var(--card-border);background:var(--card-bg);color:var(--text-primary);font-size:12px;">
          <option value="">All Actions</option>
          <option value="CREATE">CREATE</option>
          <option value="RUN">RUN</option>
          <option value="DELETE">DELETE</option>
          <option value="STOP">STOP</option>
          <option value="LOGIN">LOGIN</option>
          <option value="UPLOAD">UPLOAD</option>
          <option value="CLONE">CLONE</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <input class="inp" id="audit-search-input" placeholder="Search user, job, detail..." style="font-size:12px;" onkeydown="if(event.key==='Enter')_applyAuditFilters()" />
        <button class="btn btn-sm ghost" onclick="_applyAuditFilters()">Apply</button>
        <button class="btn btn-sm ghost" onclick="_clearAuditFilters()">Clear</button>
      </div>
      <div class="audit-content-area">${skeletonRows(5)}</div>`;
  }

  const actionSelect = $("audit-action-filter");
  const searchInput = $("audit-search-input");
  if (actionSelect) _auditActionFilter = actionSelect.value;
  if (searchInput) _auditSearchText = searchInput.value.toLowerCase();

  const contentArea = panel.querySelector(".audit-content-area") || panel;
  contentArea.innerHTML = skeletonRows(5);

  try {
    let url = `/api/admin/audit?limit=${_AUDIT_LIMIT}&offset=${_auditOffset}`;
    if (_auditActionFilter) url += `&action=${encodeURIComponent(_auditActionFilter)}`;
    const result = await apiGet(url);
    let entries = result.entries || [];
    const total = result.total || 0;

    if (_auditSearchText) {
      entries = entries.filter(e => {
        const text = ((e.user || "") + " " + (e.job || "") + " " + (e.detail || "") + " " + (e.raw || "")).toLowerCase();
        return text.includes(_auditSearchText);
      });
    }

    if (!entries.length) {
      contentArea.innerHTML = '<div class="admin-empty">No audit log entries match the current filters.</div>';
      return;
    }
    let rows = "";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const action = (e.action || "").toUpperCase();
      let actionCls = "";
      if (action.includes("CREATE") || action.includes("CLONE")) actionCls = "create";
      else if (action.includes("RUN")) actionCls = "run";
      else if (action.includes("DELETE")) actionCls = "delete";
      else if (action.includes("STOP")) actionCls = "stop";
      else if (action.includes("LOGIN")) actionCls = "login";
      else if (action.startsWith("ADMIN")) actionCls = "admin";
      const ts = e.timestamp || "";
      const relTs = timeAgo(ts);
      const fullDetail = [e.user ? "user=" + e.user : "", e.job ? "job=" + e.job : "", e.detail || ""].filter(Boolean).join(" ");
      const detailTrunc = fullDetail.length > 80 ? fullDetail.substring(0, 80) + "..." : fullDetail;
      const rowId = "audit-detail-" + i;
      rows += `<div class="audit-entry" onclick="var d=document.getElementById('${rowId}');d.classList.toggle('expanded');">
        <span class="audit-ts" title="${safeText(ts)}">${safeText(relTs)}</span>
        <span class="audit-action ${actionCls}">${safeText(action)}</span>
        <span class="audit-detail">${safeText(detailTrunc)}</span>
      </div>
      <div class="audit-detail-full" id="${rowId}">${safeText(ts)} &mdash; ${safeText(fullDetail)}</div>`;
    }
    const hasPrev = _auditOffset > 0;
    const hasNext = _auditOffset + _AUDIT_LIMIT < total;
    const filteredNote = _auditSearchText ? " (client-filtered)" : "";
    contentArea.innerHTML = `
      <div style="padding:4px 0 8px;font-size:12px;color:var(--text-muted);">Showing ${_auditOffset + 1}-${Math.min(_auditOffset + entries.length, total)} of ${total} entries${_auditActionFilter ? ` (action: ${_auditActionFilter})` : ""}${filteredNote}</div>
      <div class="audit-log-viewer">${rows}</div>
      <div class="admin-pagination">
        <button class="btn ghost" style="font-size:12px;" ${hasPrev ? "" : "disabled"} onclick="loadAdminAudit(${_auditOffset - _AUDIT_LIMIT})">Previous</button>
        <button class="btn ghost" style="font-size:12px;" ${hasNext ? "" : "disabled"} onclick="loadAdminAudit(${_auditOffset + _AUDIT_LIMIT})">Next</button>
      </div>`;
  } catch (e) {
    contentArea.innerHTML = `<div class="admin-empty" style="color:#f87171;">Failed to load audit log: ${safeText(e.message)}</div>`;
  }
}

window._applyAuditFilters = function () {
  _auditOffset = 0;
  loadAdminAudit(0);
};

window._clearAuditFilters = function () {
  const actionSelect = $("audit-action-filter");
  const searchInput = $("audit-search-input");
  if (actionSelect) actionSelect.value = "";
  if (searchInput) searchInput.value = "";
  _auditActionFilter = "";
  _auditSearchText = "";
  _auditOffset = 0;
  loadAdminAudit(0);
};

window._exportAuditCSV = function () {
  let url = "/api/admin/audit/export";
  if (_auditActionFilter) url += `?action=${encodeURIComponent(_auditActionFilter)}`;
  window.open(url, "_blank");
};

window._toggleAuditAutoRefresh = function (enabled) {
  _auditAutoRefresh = enabled;
  const liveBadge = $("admin-audit-live");
  if (liveBadge) liveBadge.style.display = enabled ? "" : "none";
  if (enabled) _startAuditPoll();
  else _stopAuditPoll();
};

function _startAuditPoll() {
  _stopAuditPoll();
  _auditPollTimer = setInterval(() => { loadAdminAudit(_auditOffset); }, 10000);
}

function _stopAuditPoll() {
  if (_auditPollTimer) { clearInterval(_auditPollTimer); _auditPollTimer = null; }
}
