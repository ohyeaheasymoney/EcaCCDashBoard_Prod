// ─────────────────────────────────────────────────────────────
// job-panel-groups.js — Run Groups: parallel host/task subsets
// Each group has its own workflow, server class, hosts, and tasks.
// ─────────────────────────────────────────────────────────────

window._runGroups = [];
window._parallelMode = false;
window._nextGroupNum = 1;

function initRunGroups() {
  window._runGroups = [];
  window._parallelMode = false;
  window._nextGroupNum = 1;
  const toggle = $("parallel-mode-toggle");
  if (toggle) toggle.checked = false;
  _hideGroupUI();
}

function _hideGroupUI() {
  const container = $("run-groups-container");
  const addBtn = $("btn-add-run-group");
  if (container) container.innerHTML = "";
  if (addBtn) addBtn.style.display = "none";
}

function toggleParallelMode(on) {
  window._parallelMode = on;
  const addBtn = $("btn-add-run-group");
  const existingTasks = $("task-checkboxes-container");

  if (on) {
    if (window._runGroups.length === 0) _addDefaultGroup();
    if (existingTasks) existingTasks.style.display = "none";
    if (addBtn) addBtn.style.display = "";
    renderRunGroups();
  } else {
    if (existingTasks) existingTasks.style.display = "";
    if (addBtn) addBtn.style.display = "none";
    const container = $("run-groups-container");
    if (container) container.innerHTML = "";
    window._runGroups = [];
    window._nextGroupNum = 1;
  }
}

// ─────────────────────────────────────────────────────────────
// Group data model
// ─────────────────────────────────────────────────────────────

function _createGroupObj() {
  // Default workflow/serverClass from the job-level selectors
  const wf = ($("modal_workflow")?.value || "configbuild").toLowerCase();
  const sc = ($("modal_server_class")?.value || "J").toUpperCase();
  const num = window._nextGroupNum++;
  return {
    groupId: "g" + num,
    label: "Group " + num,
    workflow: wf,
    serverClass: sc,
    hosts: new Set(),   // Set of IP strings
    tags: new Set(),    // Set of tag strings
    collapsed: false,
  };
}

function _addDefaultGroup() {
  const g = _createGroupObj();
  // Seed hosts from Card 2 picker
  const checkedHosts = qsa(".host-cb:checked");
  const hostSource = checkedHosts.length ? checkedHosts : qsa(".host-cb");
  hostSource.forEach(cb => { if (cb.dataset.ip) g.hosts.add(cb.dataset.ip); });
  // Seed tags from current task checkboxes
  qsa(".task-cb:checked").forEach(cb => {
    (cb.dataset.tags || "").split(",").map(s => s.trim()).filter(Boolean).forEach(t => g.tags.add(t));
  });
  window._runGroups.push(g);
}

function addRunGroup() {
  const g = _createGroupObj();
  window._runGroups.push(g);
  renderRunGroups();
  const card = $("run-group-" + g.groupId);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function removeRunGroup(gid) {
  if (window._runGroups.length <= 1) return;
  window._runGroups = window._runGroups.filter(g => g.groupId !== gid);
  renderRunGroups();
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function _getHostObjects() { return window._inventoryHosts || []; }
function _hostIp(h) { return typeof h === "string" ? h : (h.ip || ""); }

/** Resolve taskKey from a group's workflow + serverClass */
function _groupTaskKey(g) {
  if (g.workflow === "configbuild") {
    return (g.serverClass || "J").toUpperCase() === "I" ? "configbuild_i" : "configbuild_j";
  }
  return g.workflow;
}

/** Get task definitions for a group */
function _groupTasks(g) {
  const projectId = _activeCustomer || "servicenow";
  const taskDefs = getTaskDefs(projectId);
  return taskDefs[_groupTaskKey(g)] || [];
}

/** Get the available workflows for the active customer */
function _availableWorkflows() {
  const projectId = _activeCustomer || "servicenow";
  return getWorkflowOptions(projectId);
}

/** Does the selected workflow need a server class selector? */
function _needsServerClass(wf) {
  return wf === "configbuild";
}

// ─────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────

function renderRunGroups() {
  const container = $("run-groups-container");
  if (!container) return;

  const hostObjs = _getHostObjects();
  const workflows = _availableWorkflows();

  let html = "";
  window._runGroups.forEach((g, idx) => {
    const canRemove = window._runGroups.length > 1;
    const tasks = _groupTasks(g);
    const hostCount = g.hosts.size;
    const tagCount = g.tags.size;
    const isCollapsed = g.collapsed;

    // Workflow label for badge
    const wfOpt = workflows.find(w => w.value === g.workflow);
    const wfLabel = wfOpt ? wfOpt.label : g.workflow;
    const scLabel = _needsServerClass(g.workflow) ? ` (${g.serverClass || "J"})` : "";

    // Header badges
    const isPduGroup = g.workflow === "pdu";
    const wfBadge = `<span class="rg-badge rg-badge-blue">${safeText(wfLabel)}${safeText(scLabel)}</span>`;
    let hostBadge, taskBadge;
    if (isPduGroup) {
      const hasIps = (g.pduIp1 || "").trim() || (g.pduIp2 || "").trim();
      hostBadge = hasIps
        ? '<span class="rg-badge rg-badge-ok">PDU IPs set</span>'
        : '<span class="rg-badge rg-badge-warn">No PDU IPs</span>';
      taskBadge = '<span class="rg-badge rg-badge-neutral">Full workflow</span>';
    } else {
      hostBadge = hostCount === 0
        ? '<span class="rg-badge rg-badge-warn">No hosts</span>'
        : hostCount === hostObjs.length
          ? `<span class="rg-badge rg-badge-ok">All ${hostCount} hosts</span>`
          : `<span class="rg-badge rg-badge-ok">${hostCount} host${hostCount !== 1 ? "s" : ""}</span>`;
      taskBadge = tagCount === 0
        ? '<span class="rg-badge rg-badge-neutral">Full workflow</span>'
        : `<span class="rg-badge rg-badge-ok">${tagCount} task${tagCount !== 1 ? "s" : ""}</span>`;
    }

    const chevronSvg = isCollapsed
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

    html += `<div class="run-group${isCollapsed ? " run-group-collapsed" : ""}" id="run-group-${g.groupId}">
      <div class="run-group-header" onclick="toggleGroupCollapse('${g.groupId}')">
        <span class="run-group-chevron">${chevronSvg}</span>
        <input type="text" class="inp run-group-label" value="${safeText(g.label)}"
          onclick="event.stopPropagation()" onchange="window._runGroups[${idx}].label=this.value" />
        <div class="run-group-badges">${wfBadge} ${hostBadge} ${taskBadge}</div>
        ${canRemove ? `<button class="btn ghost btn-xs run-group-remove" onclick="event.stopPropagation();removeRunGroup('${g.groupId}')" title="Remove group">&times;</button>` : ""}
      </div>`;

    if (!isCollapsed) {
      html += '<div class="run-group-body">';

      const isPdu = g.workflow === "pdu";

      // ── WORKFLOW SECTION ──
      html += `<div class="run-group-section rg-workflow-section">
        <div class="rg-section-header">
          <span class="rg-section-label">Workflow</span>
        </div>
        <div class="rg-workflow-row">
          <select class="inp rg-wf-select" data-gid="${g.groupId}" onchange="changeGroupWorkflow('${g.groupId}',this.value)">`;
      // Group workflows by category
      const cats = {};
      workflows.forEach(w => {
        const cat = w.category || "Other";
        if (!cats[cat]) cats[cat] = [];
        cats[cat].push(w);
      });
      Object.keys(cats).forEach(cat => {
        html += `<optgroup label="${safeText(cat)}">`;
        cats[cat].forEach(w => {
          html += `<option value="${w.value}" ${w.value === g.workflow ? "selected" : ""}>${safeText(w.label)}</option>`;
        });
        html += '</optgroup>';
      });
      html += `</select>`;

      // Server class selector (only for configbuild)
      if (_needsServerClass(g.workflow)) {
        html += `<select class="inp rg-sc-select" data-gid="${g.groupId}" onchange="changeGroupServerClass('${g.groupId}',this.value)">
          <option value="J" ${g.serverClass === "J" ? "selected" : ""}>J Class</option>
          <option value="I" ${g.serverClass === "I" ? "selected" : ""}>I Class</option>
        </select>`;
      }

      html += `</div></div>`;

      if (isPdu) {
        // ── PDU IP SECTION ──
        const pduIp1 = g.pduIp1 || "";
        const pduIp2 = g.pduIp2 || "";
        const pduVendor = g.pduVendor || "gelu";
        const pduDeploy = g.pduDeploy || "single_server";
        html += `<div class="run-group-section">
          <div class="rg-section-header"><span class="rg-section-label">PDU Configuration</span></div>
          <div class="rg-pdu-fields">
            <div class="rg-pdu-field">
              <label class="rg-pdu-label">PDU IP Address #PDU-B1</label>
              <input class="inp rg-pdu-ip" data-gid="${g.groupId}" data-field="pduIp1" value="${safeText(pduIp1)}"
                placeholder="e.g. 10.0.0.1" onchange="updateGroupPdu('${g.groupId}','pduIp1',this.value)" />
            </div>
            <div class="rg-pdu-field">
              <label class="rg-pdu-label">PDU IP Address #PDU-B2</label>
              <input class="inp rg-pdu-ip" data-gid="${g.groupId}" data-field="pduIp2" value="${safeText(pduIp2)}"
                placeholder="e.g. 10.0.0.2" onchange="updateGroupPdu('${g.groupId}','pduIp2',this.value)" />
            </div>
            <div class="rg-pdu-field">
              <label class="rg-pdu-label">Vendor</label>
              <select class="inp rg-pdu-select" data-gid="${g.groupId}" onchange="updateGroupPdu('${g.groupId}','pduVendor',this.value)">
                <option value="gelu" ${pduVendor === "gelu" ? "selected" : ""}>Gelu</option>
                <option value="raritan" ${pduVendor === "raritan" ? "selected" : ""}>Raritan</option>
              </select>
            </div>
            <div class="rg-pdu-field">
              <label class="rg-pdu-label">Deployment Type</label>
              <select class="inp rg-pdu-select" data-gid="${g.groupId}" onchange="updateGroupPdu('${g.groupId}','pduDeploy',this.value)">
                <option value="single_server" ${pduDeploy === "single_server" ? "selected" : ""}>Single Server</option>
                <option value="chassis" ${pduDeploy === "chassis" ? "selected" : ""}>Chassis</option>
              </select>
            </div>
          </div>
          <div class="rg-empty-msg" style="margin-top:6px;">No individual tasks — runs entire PDU configuration.</div>
        </div>`;
      } else {
        // ── HOSTS SECTION ──
        html += `<div class="run-group-section">
          <div class="rg-section-header">
            <span class="rg-section-label">Hosts</span>
            <div class="rg-section-actions">`;
        if (hostObjs.length > 0) {
          const allSel = hostObjs.every(h => g.hosts.has(_hostIp(h)));
          html += `<button class="btn ghost btn-xs" onclick="toggleAllGroupHosts('${g.groupId}')">${allSel ? "Deselect All" : "Select All"}</button>`;
        }
        html += '</div></div>';

        if (!hostObjs.length) {
          html += '<div class="rg-empty-msg">No inventory hosts loaded. Generate inventory first.</div>';
        } else {
          html += '<table class="rg-host-table"><thead><tr><th></th><th>IP Address</th><th>Serial</th></tr></thead><tbody>';
          hostObjs.forEach(h => {
            const ip = _hostIp(h);
            const serial = h.serial || "\u2014";
            const isChecked = g.hosts.has(ip);
            html += `<tr class="rg-host-row${isChecked ? " rg-host-selected" : ""}" onclick="toggleGroupHostRow('${g.groupId}','${safeText(ip)}')">
              <td class="rg-host-cb-cell"><input type="checkbox" class="rg-host-cb" data-gid="${g.groupId}" data-ip="${safeText(ip)}"
                ${isChecked ? "checked" : ""} onclick="event.stopPropagation()"
                onchange="toggleGroupHost('${g.groupId}','${safeText(ip)}',this.checked)" /></td>
              <td class="rg-host-ip-cell">${safeText(ip)}</td>
              <td class="rg-host-serial-cell">${safeText(serial)}</td>
            </tr>`;
          });
          html += '</tbody></table>';
        }
        html += '</div>';

        // ── TASKS SECTION ──
        html += `<div class="run-group-section">
          <div class="rg-section-header">
            <span class="rg-section-label">Tasks</span>
            <div class="rg-section-actions">`;
        if (tasks.length > 1) {
          const allTaskTags = new Set();
          tasks.forEach(t => t.tags.forEach(tag => allTaskTags.add(tag)));
          const allSel = allTaskTags.size > 0 && [...allTaskTags].every(t => g.tags.has(t));
          html += `<button class="btn ghost btn-xs" onclick="toggleAllGroupTasks('${g.groupId}')">${allSel ? "Deselect All" : "Select All"}</button>`;
        }
        html += '</div></div>';

        if (!tasks.length) {
          html += '<div class="rg-empty-msg">No individual tasks — runs entire workflow.</div>';
        } else {
          html += '<div class="rg-task-list">';
          tasks.forEach(t => {
            const isChecked = t.tags.some(tag => g.tags.has(tag));
            html += `<label class="rg-task-item${isChecked ? " rg-task-selected" : ""}">
              <input type="checkbox" class="rg-task-cb" data-gid="${g.groupId}" data-tags="${t.tags.join(",")}" data-taskid="${t.id}"
                ${isChecked ? "checked" : ""}
                onchange="toggleGroupTask('${g.groupId}','${t.tags.join(",")}',this.checked)" />
              <span class="rg-task-name">${safeText(t.label)}</span>
            </label>`;
          });
          html += '</div>';
        }
        html += '</div>';
      }

      html += '</div>'; // .run-group-body
    }

    html += '</div>'; // .run-group
  });

  container.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────
// Event handlers
// ─────────────────────────────────────────────────────────────

window.toggleGroupCollapse = function (gid) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  g.collapsed = !g.collapsed;
  renderRunGroups();
};

window.changeGroupWorkflow = function (gid, wf) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  g.workflow = wf;
  // Reset server class default when switching to configbuild
  if (wf === "configbuild" && !g.serverClass) g.serverClass = "J";
  // Auto-fill PDU IPs from inventory data
  if (wf === "pdu" && window._pduAutoFill) {
    if (!g.pduIp1 && window._pduAutoFill["PDU-B1"]) g.pduIp1 = window._pduAutoFill["PDU-B1"];
    if (!g.pduIp2 && window._pduAutoFill["PDU-B2"]) g.pduIp2 = window._pduAutoFill["PDU-B2"];
  }
  // Clear tags — task definitions change with workflow
  g.tags.clear();
  renderRunGroups();
};

window.changeGroupServerClass = function (gid, sc) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  g.serverClass = sc.toUpperCase();
  // Clear tags — task definitions change with class
  g.tags.clear();
  renderRunGroups();
};

window.toggleGroupHostRow = function (gid, ip) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  if (g.hosts.has(ip)) g.hosts.delete(ip); else g.hosts.add(ip);
  // Update the row visually without full re-render
  const card = $("run-group-" + gid);
  if (card) {
    const cb = card.querySelector(`.rg-host-cb[data-ip="${ip}"]`);
    if (cb) {
      cb.checked = g.hosts.has(ip);
      const row = cb.closest(".rg-host-row");
      if (row) row.classList.toggle("rg-host-selected", g.hosts.has(ip));
    }
    _updateGroupBadges(card, g);
  }
};

window.toggleGroupHost = function (gid, ip, checked) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  if (checked) g.hosts.add(ip); else g.hosts.delete(ip);
  const card = $("run-group-" + gid);
  if (card) {
    const row = card.querySelector(`.rg-host-cb[data-ip="${ip}"]`)?.closest(".rg-host-row");
    if (row) row.classList.toggle("rg-host-selected", checked);
    _updateGroupBadges(card, g);
  }
};

window.toggleGroupTask = function (gid, tagsStr, checked) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  const tags = tagsStr.split(",").map(s => s.trim()).filter(Boolean);
  if (checked) tags.forEach(t => g.tags.add(t));
  else tags.forEach(t => g.tags.delete(t));
  const card = $("run-group-" + gid);
  if (card) {
    const item = card.querySelector(`.rg-task-cb[data-tags="${tagsStr}"]`);
    if (item) {
      const label = item.closest(".rg-task-item");
      if (label) label.classList.toggle("rg-task-selected", checked);
    }
    _updateGroupBadges(card, g);
  }
};

function _updateGroupBadges(card, g) {
  const wrap = card.querySelector(".run-group-badges");
  if (!wrap) return;
  const hostObjs = _getHostObjects();
  const workflows = _availableWorkflows();
  const hc = g.hosts.size;
  const tc = g.tags.size;

  const wfOpt = workflows.find(w => w.value === g.workflow);
  const wfLabel = wfOpt ? wfOpt.label : g.workflow;
  const scLabel = _needsServerClass(g.workflow) ? ` (${g.serverClass || "J"})` : "";
  const wfBadge = `<span class="rg-badge rg-badge-blue">${safeText(wfLabel)}${safeText(scLabel)}</span>`;

  let hostBadge, taskBadge;
  if (g.workflow === "pdu") {
    const hasIps = (g.pduIp1 || "").trim() || (g.pduIp2 || "").trim();
    hostBadge = hasIps
      ? '<span class="rg-badge rg-badge-ok">PDU IPs set</span>'
      : '<span class="rg-badge rg-badge-warn">No PDU IPs</span>';
    taskBadge = '<span class="rg-badge rg-badge-neutral">Full workflow</span>';
  } else {
    hostBadge = hc === 0
      ? '<span class="rg-badge rg-badge-warn">No hosts</span>'
      : hc === hostObjs.length
        ? `<span class="rg-badge rg-badge-ok">All ${hc} hosts</span>`
        : `<span class="rg-badge rg-badge-ok">${hc} host${hc !== 1 ? "s" : ""}</span>`;
    taskBadge = tc === 0
      ? '<span class="rg-badge rg-badge-neutral">Full workflow</span>'
      : `<span class="rg-badge rg-badge-ok">${tc} task${tc !== 1 ? "s" : ""}</span>`;
  }

  wrap.innerHTML = wfBadge + " " + hostBadge + " " + taskBadge;
}

window.toggleAllGroupHosts = function (gid) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  const hostObjs = _getHostObjects();
  const allSelected = hostObjs.length > 0 && hostObjs.every(h => g.hosts.has(_hostIp(h)));
  if (allSelected) g.hosts.clear();
  else hostObjs.forEach(h => g.hosts.add(_hostIp(h)));
  renderRunGroups();
};

window.updateGroupPdu = function (gid, field, value) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  g[field] = value;
  const card = $("run-group-" + gid);
  if (card) _updateGroupBadges(card, g);
};

window.toggleAllGroupTasks = function (gid) {
  const g = window._runGroups.find(x => x.groupId === gid);
  if (!g) return;
  const tasks = _groupTasks(g);
  const allTags = new Set();
  tasks.forEach(t => t.tags.forEach(tag => allTags.add(tag)));
  const allSelected = allTags.size > 0 && [...allTags].every(t => g.tags.has(t));
  if (allSelected) g.tags.clear();
  else allTags.forEach(t => g.tags.add(t));
  renderRunGroups();
};

// ─────────────────────────────────────────────────────────────
// Collect for API
// ─────────────────────────────────────────────────────────────

function collectRunGroups() {
  if (!window._parallelMode || window._runGroups.length < 2) return null;

  return window._runGroups.map(g => {
    const obj = {
      groupId: g.groupId,
      label: g.label,
      tags: Array.from(g.tags),
      hosts: Array.from(g.hosts).join(":"),
      workflow: g.workflow,
      serverClass: g.serverClass || "",
    };
    if (g.workflow === "pdu") {
      obj.pduIp1 = g.pduIp1 || "";
      obj.pduIp2 = g.pduIp2 || "";
      obj.pduVendor = g.pduVendor || "gelu";
      obj.pduDeploy = g.pduDeploy || "single_server";
    }
    return obj;
  });
}

// Expose
window.initRunGroups = initRunGroups;
window.toggleParallelMode = toggleParallelMode;
window.addRunGroup = addRunGroup;
window.removeRunGroup = removeRunGroup;
window.renderRunGroups = renderRunGroups;
window.collectRunGroups = collectRunGroups;
