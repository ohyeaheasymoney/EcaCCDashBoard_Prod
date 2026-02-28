// ─────────────────────────────────────────────────────────────
// job-panel-customer.js — Customer definitions, workflow/customer selects, modal change handlers
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Customer definitions — per-customer tasks, workflows, descriptions
// ─────────────────────────────────────────────────────────────
// ─── Shared task/workflow templates ───
const _TASKS_STANDARD = {
  configbuild_i: [
    { id: "powerup",      label: "PowerUp",              tags: ["powerup"] },
    { id: "lldp",         label: "Enable LLDP",          tags: ["lldp"] },
    { id: "rackslot",     label: "RackSlot",             tags: ["rackslot"] },
    { id: "assettag",     label: "Asset Tag",            tags: ["assettag"] },
    { id: "firmware",     label: "Firmware",             tags: ["update"] },
    { id: "powercycle1",  label: "Power Cycle",          tags: ["reboot"] },
    { id: "importxml",    label: "Import XML",           tags: ["xml"] },
  ],
  configbuild_j: [
    { id: "powerup_j",    label: "PowerUp",              tags: ["powerup"] },
    { id: "lldp_j",       label: "Enable LLDP",          tags: ["lldp"] },
    { id: "rackslot_j",   label: "RackSlot",             tags: ["rackslot"] },
    { id: "assettag_j",   label: "Asset Tag",            tags: ["assettag"] },
    { id: "firmware_j",   label: "Firmware",             tags: ["update"] },
    { id: "powercycle1_j",label: "Power Cycle",          tags: ["reboot"] },
    { id: "idrac_j",      label: "Configure iDRAC",     tags: ["xml"] },
  ],
  postprov: [
    { id: "diagnostics",  label: "Diagnostics",          tags: ["diagnostics"] },
    { id: "disablelldp",  label: "Disable LLDP",         tags: ["disablelld"] },
    { id: "tsr",          label: "Collect/Export TSR",    tags: ["tsr"] },
    { id: "cleanup",      label: "CleanUp",              tags: ["cleanup"] },
    { id: "powerdown",    label: "PowerDown",            tags: ["shutdown"] },
  ],
  quickqc: [],
  cisco_switch: [
    { id: "fw_update",    label: "Firmware Update",        tags: ["firmware"] },
    { id: "basic_config", label: "Basic Config Setup",    tags: ["dhcp"] },
  ],
  juniper_switch: [
    { id: "fw_update_j",    label: "Firmware Update",      tags: ["firmware"] },
    { id: "basic_config_j", label: "Basic Config Setup",  tags: ["dhcp"] },
    { id: "enable_lldp_j",  label: "Enable LLDP",          tags: ["lldp"] },
  ],
  console_switch: [
    { id: "fw_update_c",    label: "Firmware Update",      tags: ["firmware"] },
    { id: "basic_config_c", label: "Basic Config Setup",  tags: ["dhcp"] },
    { id: "enable_lldp_c",  label: "Enable LLDP",          tags: ["lldp"] },
  ],
  pdu: [],
};

const _WORKFLOWS_STANDARD = [
  { value: "configbuild",    label: "Server Build & Configure",    category: "Server" },
  { value: "postprov",       label: "Post-Provisioning Setup",     category: "Server" },
  { value: "quickqc",        label: "Quick QC Validation",         category: "Server" },
  { value: "cisco_switch",   label: "Cisco Switch Automation",     category: "Network" },
  { value: "juniper_switch", label: "Juniper Switch Automation",   category: "Network" },
  { value: "console_switch", label: "Console Switch Setup",        category: "Network" },
  { value: "pdu",            label: "PDU Setup",                   category: "Power" },
];

const _DESCRIPTIONS_STANDARD = {
  configbuild:    "Builds and configures the server based on the selected build standard, including baseline provisioning tasks and configuration prep (BIOS/iDRAC settings, LLDP, firmware readiness).",
  postprov:       "Executes post-provisioning automation after the base build is complete, including cleanup tasks, collecting/exporting TSRs or SupportAssist bundles, running diagnostics, and final power actions.",
  quickqc:        "Performs quick validation checks to confirm configuration compliance and readiness (inventory validation, firmware checks, and pass/fail indicators).",
  cisco_switch:   "Performs Cisco switch automation setup and firmware updates for deployment readiness.",
  juniper_switch: "Performs Juniper switch automation setup using workbook-driven mappings and selected port ranges.",
  console_switch: "Configures 8-port console switches (ACS8008MDAC-400) for serial console access to rack equipment.",
  pdu:            "Configures rack PDUs using a power cable mapping file to ensure correct outlet assignments for servers or chassis builds.",
};

const CUSTOMER_DEFINITIONS = {
  servicenow: {
    label: "ServiceNow",
    description: "Full server deployment, provisioning, QC, network, and power automation.",
    path: "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
    hasServerClass: true,
    tasks: _TASKS_STANDARD,
    workflows: _WORKFLOWS_STANDARD,
    descriptions: _DESCRIPTIONS_STANDARD,
  },
  openai: {
    label: "OpenAI",
    description: "Network switch automation — Cisco, Juniper, and console switch setup and firmware.",
    path: "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
    hasServerClass: false,
    tasks: {
      cisco_switch:   _TASKS_STANDARD.cisco_switch,
      juniper_switch: _TASKS_STANDARD.juniper_switch,
      console_switch: _TASKS_STANDARD.console_switch,
    },
    workflows: [
      { value: "cisco_switch",   label: "Cisco Switch Automation",     category: "Network" },
      { value: "juniper_switch", label: "Juniper Switch Automation",   category: "Network" },
      { value: "console_switch", label: "Console Switch Setup",        category: "Network" },
    ],
    descriptions: {
      cisco_switch:   "Performs Cisco switch automation setup and firmware updates for deployment readiness.",
      juniper_switch: "Performs Juniper switch automation setup using workbook-driven mappings and selected port ranges.",
      console_switch: "Configures 8-port console switches (ACS8008MDAC-400) for serial console access to rack equipment.",
    },
  },
  aes: {
    label: "AES",
    description: "Network switch automation — Cisco, Juniper, and console switch setup and firmware.",
    path: "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
    hasServerClass: false,
    tasks: {
      cisco_switch:   _TASKS_STANDARD.cisco_switch,
      juniper_switch: _TASKS_STANDARD.juniper_switch,
      console_switch: _TASKS_STANDARD.console_switch,
    },
    workflows: [
      { value: "cisco_switch",   label: "Cisco Switch Automation",     category: "Network" },
      { value: "juniper_switch", label: "Juniper Switch Automation",   category: "Network" },
      { value: "console_switch", label: "Console Switch Setup",        category: "Network" },
    ],
    descriptions: {
      cisco_switch:   "Performs Cisco switch automation setup and firmware updates for deployment readiness.",
      juniper_switch: "Performs Juniper switch automation setup using workbook-driven mappings and selected port ranges.",
      console_switch: "Configures 8-port console switches (ACS8008MDAC-400) for serial console access to rack equipment.",
    },
  },
  traderjoes: {
    label: "Trader Joe's",
    description: "Network switch automation — Cisco, Juniper, and console switch setup and firmware.",
    path: "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
    hasServerClass: false,
    tasks: {
      cisco_switch:   _TASKS_STANDARD.cisco_switch,
      juniper_switch: _TASKS_STANDARD.juniper_switch,
      console_switch: _TASKS_STANDARD.console_switch,
    },
    workflows: [
      { value: "cisco_switch",   label: "Cisco Switch Automation",     category: "Network" },
      { value: "juniper_switch", label: "Juniper Switch Automation",   category: "Network" },
      { value: "console_switch", label: "Console Switch Setup",        category: "Network" },
    ],
    descriptions: {
      cisco_switch:   "Performs Cisco switch automation setup and firmware updates for deployment readiness.",
      juniper_switch: "Performs Juniper switch automation setup using workbook-driven mappings and selected port ranges.",
      console_switch: "Configures 8-port console switches (ACS8008MDAC-400) for serial console access to rack equipment.",
    },
  },
};

// Active customer state
var _activeCustomer = "servicenow";

function getCustomerDef(projectId) {
  return CUSTOMER_DEFINITIONS[projectId || _activeCustomer] || CUSTOMER_DEFINITIONS.servicenow;
}

function getTaskDefs(projectId) {
  return getCustomerDef(projectId).tasks;
}

function getWorkflowOptions(projectId) {
  return getCustomerDef(projectId).workflows;
}

function getWorkflowDescriptions(projectId) {
  return getCustomerDef(projectId).descriptions;
}

const _NETWORK_WORKFLOWS = ["cisco_switch", "juniper_switch", "console_switch"];

// Cisco network automation operations (same for all models)
const _CISCO_OPS = [
  { value: "firmware",     label: "Firmware Update" },
  { value: "basic_config", label: "Basic Config Setup" },
];

// Network Automation dropdown value → task ID per workflow
const _NET_AUTO_TO_TASK = {
  cisco_switch:   { firmware: "fw_update",   basic_config: "basic_config" },
  juniper_switch: { firmware: "fw_update_j", basic_config: "basic_config_j", lldp: "enable_lldp_j" },
  console_switch: { firmware: "fw_update_c", basic_config: "basic_config_c", lldp: "enable_lldp_c" },
};

// Build <option> HTML for the Network Automation dropdown
function _buildNetworkAutoOptions(wf) {
  if (wf === "cisco_switch") {
    return _CISCO_OPS.map(o =>
      `<option value="${o.value}">${o.label}</option>`
    ).join("");
  }
  // Juniper / Console: show all operations
  return `<option value="firmware">Firmware Update</option>
          <option value="basic_config">Basic Config Setup</option>
          <option value="lldp">Enable LLDP</option>`;
}

// Enable/disable port selector + Card 2 based on current Network Automation value
function _updateNetworkPortState() {
  const autoVal = $("modal_server_class")?.value;
  const portWrap = $("modal_port")?.closest(".field-group");
  const portEl = $("modal_port");
  const portLabel = $("port-label");

  // Firmware Update → no port needed (SSH to hosts), Basic Config → console port
  if (portEl && portWrap) {
    if (autoVal === "firmware") {
      portEl.disabled = true;
      portWrap.classList.add("field-disabled");
    } else {
      portEl.disabled = false;
      portWrap.classList.remove("field-disabled");
    }
  }
  if (portLabel) {
    portLabel.textContent = autoVal === "basic_config" ? "Console Port" : "Port";
  }

  // Basic Config Setup → grey out Network Hosts (uses console port, not SSH)
  const card2Wrap = $("card2-wrap");
  if (card2Wrap) {
    if (autoVal === "basic_config") {
      card2Wrap.classList.add("field-disabled");
      card2Wrap.style.opacity = "0.45";
      card2Wrap.style.pointerEvents = "none";
    } else {
      card2Wrap.classList.remove("field-disabled");
      card2Wrap.style.opacity = "";
      card2Wrap.style.pointerEvents = "";
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Workflow/customer select builders and helpers
// ─────────────────────────────────────────────────────────────

// Legacy compat — used by other files
const WORKFLOW_DESCRIPTIONS = _DESCRIPTIONS_STANDARD;
window.CUSTOMER_DEFINITIONS = CUSTOMER_DEFINITIONS;

function buildWorkflowSelectHtml(selectedValue, projectId) {
  const opts = getWorkflowOptions(projectId);
  const categories = {};
  opts.forEach(o => {
    if (!categories[o.category]) categories[o.category] = [];
    categories[o.category].push(o);
  });
  return Object.entries(categories).map(([cat, items]) =>
    `<optgroup label="${cat}">${items.map(o =>
      `<option value="${o.value}" ${selectedValue === o.value ? "selected" : ""}>${o.label}</option>`
    ).join("")}</optgroup>`
  ).join("");
}

function buildCustomerSelectHtml(selectedCustomer) {
  return Object.entries(CUSTOMER_DEFINITIONS).map(([id, def]) =>
    `<option value="${id}" ${selectedCustomer === id ? "selected" : ""}>${def.label}</option>`
  ).join("");
}

function buildPortOptions(count) {
  return Array.from({length: count}, (_, i) =>
    `<option value="${i+1}">Port ${i+1}</option>`
  ).join("");
}

function buildWorkflowExtraOptions(workflow) {
  if (workflow === "cisco_switch") {
    return `<p class="muted" style="margin-top:8px;font-size:11px;">Select the Cisco switch model and starting port number.</p>
    <div class="workflow-grid" style="margin-top:10px;">
      <div class="field-group">
        <label>Switch Model</label>
        <select id="modal_cisco_model" class="inp" onchange="ciscoModelChanged()">
          <option value="N9K-C93180YC-FX3">Nexus 9300 (N9K-C93180YC-FX3)</option>
          <option value="N9K-C9336C-FX2">Nexus 9300 (N9K-C9336C-FX2)</option>
          <option value="N9K-C9348GC-FX3">Nexus 9300 (N9K-C9348GC-FX3)</option>
          <option value="N9K-C9504">Nexus 9500 (N9K-C9504)</option>
        </select>
      </div>
      <div class="field-group">
        <label id="port-label">Port</label>
        <select id="modal_port" class="inp">${buildPortOptions(48)}</select>
      </div>
    </div>`;
  }
  if (workflow === "juniper_switch") {
    return `<p class="muted" style="margin-top:8px;font-size:11px;">Select the starting port number for the Juniper switch.</p>
    <div class="workflow-grid" style="margin-top:10px;">
      <div class="field-group">
        <label id="port-label">Port</label>
        <select id="modal_port" class="inp">${buildPortOptions(48)}</select>
      </div>
    </div>`;
  }
  if (workflow === "console_switch") {
    return `<p class="muted" style="margin-top:8px;font-size:11px;">Select the console server model and port number for serial console configuration.</p>
    <div class="workflow-grid" style="margin-top:10px;">
      <div class="field-group">
        <label>Console Model</label>
        <select id="modal_console_model" class="inp">
          <option value="ACS8008MDAC-400">8-Port ACS Dual AC w/ Analog Modem (ACS8008MDAC-400)</option>
        </select>
      </div>
      <div class="field-group">
        <label id="port-label">Port</label>
        <select id="modal_port" class="inp">${buildPortOptions(8)}</select>
      </div>
    </div>`;
  }
  if (workflow === "pdu") {
    return `<p class="muted" style="margin-top:8px;font-size:11px;">Enter the management IP addresses for each PDU in the rack. Select the vendor (Gelu or Raritan) and deployment type. Upload the Powercable.csv mapping file.</p>
    <div class="workflow-grid" style="margin-top:10px;">
      <div class="field-group">
        <label>PDU IP Address #PDU-B1</label>
        <input id="modal_pdu_ip1" class="inp" placeholder="e.g. 10.0.0.1" title="Auto-filled from inventory if available" />
      </div>
      <div class="field-group">
        <label>PDU IP Address #PDU-B2</label>
        <input id="modal_pdu_ip2" class="inp" placeholder="e.g. 10.0.0.2" title="Auto-filled from inventory if available" />
      </div>
      <div class="field-group">
        <label>Vendor</label>
        <select id="modal_pdu_vendor" class="inp">
          <option value="gelu">Gelu</option>
          <option value="raritan">Raritan</option>
        </select>
      </div>
      <div class="field-group">
        <label>Deployment Type</label>
        <select id="modal_pdu_deploy" class="inp">
          <option value="single_server">Single Server</option>
          <option value="chassis">Chassis</option>
        </select>
      </div>
    </div>
    <div class="inline-upload-row">
      <input type="file" id="inline_fw_file" class="upload-file-input" accept=".csv" />
      <button class="btn ghost" onclick="inlineWorkflowUpload('inline_fw_file','workbook')">Upload Powercable.csv</button>
      <span class="muted" id="inline_upload_status"></span>
    </div>`;
  }
  return "";
}

window.inlineWorkflowUpload = async function(inputId, role) {
  const fileInput = $(inputId);
  const statusEl = $("inline_upload_status");
  if (!fileInput || !fileInput.files.length) {
    showToast("Select a file first", "info");
    return;
  }
  if (!currentJobId) {
    showToast("No job open", "error");
    return;
  }
  const file = fileInput.files[0];
  try {
    if (statusEl) statusEl.textContent = `Uploading ${file.name}...`;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("role", role);
    await apiPostFormWithProgress(`/api/jobs/${encodeURIComponent(currentJobId)}/files`, fd, (pct) => {
      if (statusEl) statusEl.textContent = `${pct}%`;
    });
    if (statusEl) statusEl.textContent = "Uploaded";
    showToast(`${file.name} uploaded`, "success");
    updatePreflightChecklist(currentJobId);
  } catch (e) {
    if (statusEl) statusEl.textContent = "Error";
    showToast("Upload failed: " + e.message, "error");
  }
};

const PENCIL_ICON = '<svg class="edit-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';

// ─────────────────────────────────────────────────────────────
// Modal change handlers
// ─────────────────────────────────────────────────────────────

// Customer changed — rebuild workflows, tasks, and description
window.modalCustomerChanged = function () {
  const proj = safeText($("modal_customer")?.value) || "servicenow";
  _activeCustomer = proj;
  const customerDef = getCustomerDef(proj);

  // Update project description
  const projDescEl = $("customer-description");
  if (projDescEl) {
    projDescEl.innerHTML = `<p>${safeText(customerDef.description)}</p>`;
  }

  // Rebuild workflow select — default to first available workflow for this project
  const wfSelect = $("modal_workflow");
  if (wfSelect) {
    const firstWf = customerDef.workflows[0]?.value || "configbuild";
    wfSelect.innerHTML = buildWorkflowSelectHtml(firstWf, proj);
    wfSelect.value = firstWf;
  }

  // Trigger workflow changed to refresh everything downstream
  modalWorkflowChanged();

  // Save customer to job
  if (currentJobId) {
    saveJobField(encodeURIComponent(currentJobId), "customer", proj);
  }
};

window.modalWorkflowChanged = function () {
  const wf = safeText($("modal_workflow")?.value).toLowerCase();
  const proj = _activeCustomer;
  const descriptions = getWorkflowDescriptions(proj);

  const isNetwork = _NETWORK_WORKFLOWS.includes(wf);
  const scWrap = $("modal_server_class_wrap");
  const scSelect = $("modal_server_class");
  const scLabel = scWrap ? scWrap.querySelector("label") : null;
  if (scWrap) {
    if (wf === "configbuild") {
      scWrap.classList.remove("field-disabled");
      if (scSelect) {
        scSelect.disabled = false;
        // Only rebuild options if not already showing J/I class (preserve current selection)
        const alreadyServerClass = scSelect.querySelector('option[value="J"]');
        if (!alreadyServerClass) {
          scSelect.innerHTML = `<option value="J" selected>J Class</option><option value="I">I Class</option>`;
        }
      }
      if (scLabel) scLabel.textContent = "Server Class";
    } else if (isNetwork) {
      scWrap.classList.remove("field-disabled");
      if (scSelect) {
        scSelect.disabled = false;
        // Only rebuild options when entering network mode (not on every dropdown change)
        const alreadyNetwork = scSelect.querySelector('option[value="firmware"]') || scSelect.querySelector('option[value="basic_config"]') || scSelect.querySelector('option[value="lldp"]');
        if (!alreadyNetwork) {
          scSelect.innerHTML = _buildNetworkAutoOptions(wf);
        }
      }
      if (scLabel) scLabel.textContent = "Network Automation";
    } else {
      scWrap.classList.add("field-disabled");
      if (scSelect) scSelect.disabled = true;
      if (scLabel) scLabel.textContent = "Server Class";
    }
  }

  const descEl = $("workflow-description");
  if (descEl) {
    descEl.innerHTML = descriptions[wf]
      ? `<p>${descriptions[wf]}</p>`
      : "";
  }

  const extraEl = $("workflow-extra-options");
  if (extraEl) {
    // Only rebuild extra options when workflow changes (not on network automation change)
    const currentWf = extraEl.getAttribute("data-wf");
    if (currentWf !== wf) {
      extraEl.innerHTML = buildWorkflowExtraOptions(wf);
      extraEl.setAttribute("data-wf", wf);
      // After rebuilding Cisco options, sync the automation dropdown
      if (wf === "cisco_switch") {
        if (scSelect) scSelect.innerHTML = _buildNetworkAutoOptions(wf);
      }
    }
  }

  // Card 1: dynamic instruction text
  const card1Inst = $("card1-instructions");
  if (card1Inst) {
    if (isNetwork) {
      card1Inst.innerHTML = "Select the network automation workflow. Choose the operation type from <strong>Network Automation</strong> — available options depend on the switch model.";
    } else {
      card1Inst.innerHTML = "Select the automation workflow to run. Server Class is only required for Server Build &amp; Configure (J Class = standard rack servers, I Class = high-density/blade servers).";
    }
  }

  // Card 2: dynamic title, instructions, host picker content, firmware upload
  const card2Title = $("card2-title");
  if (card2Title) card2Title.textContent = isNetwork ? "Network Hosts" : "Target Hosts";

  const card2Inst = $("card2-instructions");
  if (card2Inst) {
    if (isNetwork) {
      card2Inst.innerHTML = "Network devices discovered from inventory. Firmware Update and Enable LLDP connect via SSH to the selected hosts. Basic Config Setup uses a direct console port connection (no host selection needed).";
    } else {
      card2Inst.innerHTML = "Select which hosts to target. Toggle selection with the button below. If none are selected, all hosts will be used.";
    }
  }

  // Rebuild host picker — network workflows show only network devices with full detail
  const pickerEl = $("host-picker-container");
  if (pickerEl && window._inventoryHosts) {
    _rebuildHostPicker(pickerEl, window._inventoryHosts, isNetwork);
  }

  const fwUploadEl = $("network-fw-upload");
  if (fwUploadEl) {
    if (isNetwork && wf !== "console_switch") {
      const acceptTypes = wf === "juniper_switch" ? ".bin,.tgz,.img" : ".bin,.exe,.img";
      fwUploadEl.innerHTML = `<div class="inline-upload-row" style="margin-top:10px;">
        <input type="file" id="inline_fw_file" class="upload-file-input" accept="${acceptTypes}" />
        <button class="btn ghost" onclick="inlineWorkflowUpload('inline_fw_file','firmware')">Upload Firmware</button>
        <span class="muted" id="inline_upload_status"></span>
      </div>`;
    } else {
      fwUploadEl.innerHTML = "";
    }
  }

  // Update port state + Card 2 greying for network workflows and PDU
  if (isNetwork) {
    _updateNetworkPortState();
  } else if (wf === "pdu") {
    // PDU uses IP addresses from extra options, no host selection needed
    const card2Wrap = $("card2-wrap");
    if (card2Wrap) {
      card2Wrap.classList.add("field-disabled");
      card2Wrap.style.opacity = "0.45";
      card2Wrap.style.pointerEvents = "none";
    }
  } else {
    // Ensure Card 2 is not greyed when switching back to server workflows
    const card2Wrap = $("card2-wrap");
    if (card2Wrap) {
      card2Wrap.classList.remove("field-disabled");
      card2Wrap.style.opacity = "";
      card2Wrap.style.pointerEvents = "";
    }
  }

  // Auto-fill PDU IPs from inventory data
  if (wf === "pdu" && window._pduAutoFill) {
    const pduData = window._pduAutoFill;
    const ip1 = $("modal_pdu_ip1");
    const ip2 = $("modal_pdu_ip2");
    if (ip1 && pduData["PDU-B1"]) ip1.value = pduData["PDU-B1"];
    if (ip2 && pduData["PDU-B2"]) ip2.value = pduData["PDU-B2"];
  }

  const sc = safeText($("modal_server_class")?.value || "J").toUpperCase();
  const activeKey = getActiveTaskKey(wf, sc);

  // For network workflows, only show the task matching the selected automation type
  let filterIds = null;
  const autoVal = isNetwork ? ($("modal_server_class")?.value || "") : "";
  if (isNetwork) {
    const taskMap = _NET_AUTO_TO_TASK[wf];
    if (taskMap && autoVal && taskMap[autoVal]) {
      filterIds = [taskMap[autoVal]];
    }
  }

  // Card 3: dynamic instructions
  const card3Inst = $("card3-instructions");
  if (card3Inst) {
    if (isNetwork) {
      card3Inst.innerHTML = autoVal === "firmware"
        ? "Firmware will be pushed via SSH to the selected network hosts. Ensure firmware is uploaded in the section above."
        : autoVal === "basic_config"
        ? "Configuration will be applied via direct console port connection. No host selection needed."
        : "Select the task below and run. Use <strong>Stop</strong> to abort. Results appear in the <strong>Status</strong> tab.";
    } else {
      card3Inst.innerHTML = "Pick your tasks and let it rip. Use <strong>Stop</strong> to abort. Results appear in the <strong>Status</strong> tab.";
    }
  }

  // Network run summary — shows model + automation type at a glance
  const summaryEl = $("network-run-summary");
  if (summaryEl) {
    if (isNetwork) {
      const modelNames = {
        cisco_switch: $("modal_cisco_model")?.value || "",
        juniper_switch: "Juniper Switch",
        console_switch: $("modal_console_model")?.value || "Console Switch",
      };
      const autoLabels = { firmware: "Firmware Update", basic_config: "Basic Config Setup", lldp: "Enable LLDP" };
      const modelDisplay = modelNames[wf] || wf;
      const autoDisplay = autoLabels[autoVal] || autoVal;
      const icon = autoVal === "firmware"
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;opacity:0.7;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;opacity:0.7;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
      summaryEl.style.display = "";
      summaryEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);margin-bottom:8px;font-size:12px;">
        ${icon}<strong>${safeText(modelDisplay)}</strong><span style="opacity:0.4;">|</span><span>${safeText(autoDisplay)}</span>
      </div>`;
    } else {
      summaryEl.style.display = "none";
      summaryEl.innerHTML = "";
    }
  }

  const container = $("task-checkboxes-container");
  if (container) {
    container.innerHTML = buildTaskCheckboxes(activeKey, proj, filterIds);
    // Auto-check the single task for network workflows
    if (isNetwork && filterIds && filterIds.length === 1) {
      const cb = container.querySelector(".task-cb");
      if (cb) cb.checked = true;
    }
  }

  // Persist workflow change to backend
  if (currentJobId && typeof saveModalWorkflow === "function") {
    saveModalWorkflow(currentJobId).catch(() => {});
  }
};

// Cisco model changed — same automation options for all models, just refresh state
window.ciscoModelChanged = function () {
  _updateNetworkPortState();
};

// ─────────────────────────────────────────────────────────────
// Dynamic config loading from server
// ─────────────────────────────────────────────────────────────
window.loadConfigFromServer = async function () {
  try {
    const [customers, workflows] = await Promise.all([
      apiGet("/api/config/customers"),
      apiGet("/api/config/workflows"),
    ]);
    // Rebuild CUSTOMER_DEFINITIONS from server data
    for (const [id, cust] of Object.entries(customers)) {
      const custWorkflows = (cust.workflows || []);
      // Build workflows array for this customer from server workflow defs
      const wfArray = [];
      const taskMap = {};
      const descMap = {};
      for (const wfId of custWorkflows) {
        const wfDef = workflows[wfId];
        if (!wfDef) continue;
        wfArray.push({ value: wfId, label: wfDef.label, category: wfDef.category || "Server" });
        descMap[wfId] = wfDef.description || "";
        // Merge task groups from workflow into customer task map
        for (const [groupKey, taskList] of Object.entries(wfDef.tasks || {})) {
          taskMap[groupKey] = (Array.isArray(taskList) ? taskList : []).map(t => ({
            id: t.id, label: t.label, tags: t.tags || [],
          }));
        }
      }
      CUSTOMER_DEFINITIONS[id] = {
        label: cust.label || id,
        description: cust.description || "",
        path: cust.path || "",
        hasServerClass: !!cust.hasServerClass,
        tasks: taskMap,
        workflows: wfArray,
        descriptions: descMap,
      };
    }
    // Remove any local customers not present on server
    for (const localId of Object.keys(CUSTOMER_DEFINITIONS)) {
      if (!customers[localId]) delete CUSTOMER_DEFINITIONS[localId];
    }
    window.CUSTOMER_DEFINITIONS = CUSTOMER_DEFINITIONS;
  } catch (e) {
    console.warn("[config] Server config load failed, using local defaults:", e);
  }
};
