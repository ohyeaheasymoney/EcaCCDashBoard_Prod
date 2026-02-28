// ─────────────────────────────────────────────────────────────
// wizard-modal.js — Multi-step job creation wizard (3 steps)
// ─────────────────────────────────────────────────────────────

let _wizStep = 1;
window._wizPendingCSV = null;

function ensureWizardContainer() {
  if ($("wizard-container")) return;
  const div = document.createElement("div");
  div.id = "wizard-container";
  document.body.appendChild(div);
}

function wizAutoName() {
  const custSel = $("wiz_customer");
  const rackInput = $("wiz_rack_id");
  const nameInput = $("wiz_job_name");
  if (!custSel || !nameInput) return;

  if (nameInput.dataset.manual === "true") return;

  const custDef = (window.CUSTOMER_DEFINITIONS || {})[custSel.value];
  const custLabel = custDef ? custDef.label : custSel.value;
  const rack = (rackInput?.value || "").trim();
  const wfSel = $("wiz_workflow");
  const wfVal = wfSel ? wfSel.value : "";
  const wfLabel = (window.WORKFLOW_LABELS || {})[wfVal] || "";
  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dateStr = months[now.getMonth()] + now.getDate();

  const parts = [custLabel];
  if (rack) parts.push(rack);
  if (wfLabel) parts.push(wfLabel.split(" ")[0]); // first word of workflow
  parts.push(dateStr);

  nameInput.value = parts.join("-");
}

function wizBuildCustomerOptions() {
  const defs = window.CUSTOMER_DEFINITIONS || {};
  return Object.entries(defs).map(([id, def]) =>
    `<option value="${id}">${def.label}</option>`
  ).join("");
}

function _wizBuildWorkflowOptions(customer) {
  const def = (window.CUSTOMER_DEFINITIONS || {})[customer];
  const wfs = def && def.workflows ? def.workflows : (window._WORKFLOWS_STANDARD || []);
  // Group by category using optgroups
  const categories = {};
  wfs.forEach(o => {
    const cat = o.category || "Other";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(o);
  });
  return Object.entries(categories).map(([cat, items]) =>
    `<optgroup label="${cat}">${items.map(o =>
      `<option value="${o.value}">${o.label}</option>`
    ).join("")}</optgroup>`
  ).join("");
}

function _wizStepIndicator(activeStep) {
  const stepDefs = [
    { num: 1, label: "Workflow", sub: "Choose automation type" },
    { num: 2, label: "Details", sub: "Name & identifiers" },
    { num: 3, label: "Upload", sub: "CSV workbook" },
  ];
  return `<div class="wizard-steps">${stepDefs.map((s, i) => {
    const cls = s.num < activeStep ? "done" : s.num === activeStep ? "active" : "";
    const checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    return (i > 0 ? `<div class="wizard-step-line${s.num <= activeStep ? " done" : ""}"></div>` : "") +
      `<div class="wizard-step ${cls}">
        <div class="wizard-step-num">${cls === "done" ? checkSvg : s.num}</div>
        <div class="wizard-step-label">${s.label}</div>
        <div class="wizard-step-sub">${s.sub}</div>
      </div>`;
  }).join("")}</div>`;
}

function _wizRenderStep() {
  const body = $("wiz-step-body");
  const backBtn = $("wiz-back-btn");
  const nextBtn = $("wiz-next-btn");
  const indicator = $("wiz-step-indicator");
  if (!body) return;

  // Update step indicator
  if (indicator) indicator.innerHTML = _wizStepIndicator(_wizStep);

  // Update step count text in footer
  const stepCount = $("wiz-step-count");
  if (stepCount) stepCount.textContent = `Step ${_wizStep} of 3`;

  // Show/hide back button
  if (backBtn) backBtn.style.display = _wizStep > 1 ? "" : "none";

  // Update next button text
  if (nextBtn) {
    if (_wizStep === 3) {
      const hasCSV = window._wizPendingCSV;
      nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>' + (hasCSV ? "Create & Upload" : "Create Job");
    } else {
      nextBtn.textContent = "Next";
    }
  }

  if (_wizStep === 1) {
    const customerOptionsHtml = wizBuildCustomerOptions();
    const custVal = $("wiz_customer") ? $("wiz_customer").value : "servicenow";
    const wfOptionsHtml = _wizBuildWorkflowOptions(custVal);
    const wfVal = $("wiz_workflow") ? $("wiz_workflow").value : "";
    const scVal = window._wizSavedFields?.serverClass || "J";

    // Icons for customer/workflow labels
    const custIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const wfIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;flex-shrink:0;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>';

    body.innerHTML = `
      <div class="section">
        <h4>${custIcon}Customer</h4>
        <p class="muted" style="margin-bottom:6px;font-size:11px;">Select the customer for this job.</p>
        <select id="wiz_customer" class="inp wiz-select-lg" style="width:100%;" onchange="wizOnCustomerChange()">
          ${customerOptionsHtml}
        </select>
      </div>
      <div class="section">
        <h4>${wfIcon}Workflow</h4>
        <p class="muted" style="margin-bottom:6px;font-size:11px;">Choose the automation workflow for this job.</p>
        <select id="wiz_workflow" class="inp wiz-select-lg" style="width:100%;" onchange="wizOnWorkflowChange()">
          ${wfOptionsHtml}
        </select>
      </div>
      <div class="section" id="wiz_server_class_section" style="display:none;">
        <h4>Server Class</h4>
        <p class="muted" style="margin-bottom:6px;font-size:11px;">Select the server class for the build.</p>
        <div class="wiz-radio-group">
          <label class="wiz-radio-card${scVal === 'J' ? ' wiz-radio-active' : ''}" tabindex="0">
            <input type="radio" name="wiz_server_class" value="J" ${scVal === 'J' ? 'checked' : ''} onchange="document.querySelectorAll('.wiz-radio-card').forEach(c=>c.classList.remove('wiz-radio-active'));this.closest('.wiz-radio-card').classList.add('wiz-radio-active');" />
            <span class="wiz-radio-label">J Class</span>
          </label>
          <label class="wiz-radio-card${scVal === 'I' ? ' wiz-radio-active' : ''}" tabindex="0">
            <input type="radio" name="wiz_server_class" value="I" ${scVal === 'I' ? 'checked' : ''} onchange="document.querySelectorAll('.wiz-radio-card').forEach(c=>c.classList.remove('wiz-radio-active'));this.closest('.wiz-radio-card').classList.add('wiz-radio-active');" />
            <span class="wiz-radio-label">I Class</span>
          </label>
        </div>
      </div>
      <div class="section wiz-template-collapsed" id="wiz-template-section">
        <button class="wiz-template-toggle" onclick="this.parentElement.classList.toggle('wiz-template-expanded')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="wiz-template-chevron"><path d="M6 9l6 6 6-6"/></svg>
          Start from Template
        </button>
        <div class="wiz-template-body">
          <p class="muted" style="margin-bottom:6px;font-size:11px;">Optionally select a saved template to pre-fill fields.</p>
          <select id="wiz_template" class="inp" style="width:100%;" onchange="wizApplyTemplate()">
            <option value="">No template (start fresh)</option>
          </select>
        </div>
      </div>
    `;

    // Restore saved values
    const custSel = $("wiz_customer");
    if (custSel) custSel.value = custVal;
    if (wfVal) {
      const wfSel = $("wiz_workflow");
      if (wfSel) wfSel.value = wfVal;
    }

    // Show server class if configbuild
    wizOnWorkflowChange();

    // Load templates
    wizLoadTemplates();

  } else if (_wizStep === 2) {
    body.innerHTML = `
      <div class="section wiz-section-name">
        <h4>Job Name</h4>
        <p class="muted" style="margin-bottom:8px;font-size:11px;">A descriptive name for this job.</p>
        <div class="wiz-name-input-wrap">
          <input id="wiz_job_name" class="inp wiz-name-input" placeholder="Auto-generated or type your own" oninput="this.dataset.manual='true'" />
          <button class="wiz-auto-btn" onclick="$('wiz_job_name').dataset.manual='false'; wizAutoName();" title="Auto-generate name">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
        </div>
      </div>
      <div class="section">
        <h4>Additional Details</h4>
        <p class="muted" style="margin-bottom:8px;font-size:11px;">Optional fields to help identify and track this job.</p>
        <div class="wizard-form-grid">
          <div class="field-group">
            <label>Rack ID</label>
            <input id="wiz_rack_id" class="inp" placeholder="e.g. R01" oninput="wizAutoName()" />
          </div>
          <div class="field-group">
            <label>SKU</label>
            <input id="wiz_sku" class="inp" placeholder="e.g. PowerEdge R760" />
          </div>
          <div class="field-group">
            <label>P.O.</label>
            <input id="wiz_po" class="inp" placeholder="e.g. PO-2026-0042" />
          </div>
        </div>
      </div>
    `;

    // Restore values if going back/forward
    const savedName = window._wizSavedFields?.jobName;
    const savedRack = window._wizSavedFields?.rackId;
    const savedSku = window._wizSavedFields?.sku;
    const savedPo = window._wizSavedFields?.po;
    if (savedName) { $("wiz_job_name").value = savedName; $("wiz_job_name").dataset.manual = "true"; }
    if (savedRack) $("wiz_rack_id").value = savedRack;
    if (savedSku) $("wiz_sku").value = savedSku;
    if (savedPo) $("wiz_po").value = savedPo;

    // Auto-generate name if not manually set
    if (!savedName) setTimeout(wizAutoName, 50);

    // Wire validation
    const wizNameInput = $("wiz_job_name");
    const wizRackInput = $("wiz_rack_id");
    function _wizValidate() {
      if (typeof validateField === "function" && typeof showFieldValidation === "function") {
        const nameResult = validateField("jobName", wizNameInput ? wizNameInput.value : "");
        if (wizNameInput) showFieldValidation(wizNameInput, nameResult);
        const rackResult = validateField("rackId", wizRackInput ? wizRackInput.value : "");
        if (wizRackInput) showFieldValidation(wizRackInput, rackResult);
      }
    }
    if (wizNameInput) wizNameInput.addEventListener("input", _wizValidate);
    if (wizRackInput) wizRackInput.addEventListener("input", _wizValidate);

  } else if (_wizStep === 3) {
    const csvInfo = window._wizPendingCSV
      ? `<div class="wiz-csv-info"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span style="color:#4ade80;font-weight:600;">${safeText(window._wizPendingCSV.name)}</span> <span class="muted">(${(window._wizPendingCSV.size / 1024).toFixed(1)} KB)</span> <button class="btn ghost" style="font-size:11px;padding:2px 8px;margin-left:auto;" onclick="window._wizPendingCSV=null;_wizRenderStep();">Remove</button></div>`
      : "";

    body.innerHTML = `
      <div class="section">
        <h4>Upload CSV Workbook</h4>
        <p class="muted" style="margin-bottom:10px;font-size:11px;">Optionally upload a CSV workbook now, or skip and upload later from the job panel.</p>
        ${csvInfo}
        <div class="wiz-drop-zone wiz-drop-zone-lg" id="wiz-drop-zone">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.35;margin-bottom:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="font-size:14px;font-weight:500;">Drop CSV file here or click to browse</div>
          <div class="muted" style="font-size:11px;margin-top:4px;">Accepts .csv, .xlsx workbook files</div>
          <input type="file" id="wiz-csv-input" accept=".csv,.xlsx,.xls" style="display:none;" />
        </div>
        <div class="wiz-skip-row">
          <a href="javascript:void(0)" class="wiz-skip-link" onclick="window._wizPendingCSV=null;_wizRenderStep();">Skip &mdash; I'll upload later</a>
        </div>
      </div>
    `;

    // Wire drop zone
    const dropZone = $("wiz-drop-zone");
    const fileInput = $("wiz-csv-input");
    if (dropZone && fileInput) {
      dropZone.addEventListener("click", () => fileInput.click());
      dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("wiz-drop-hover"); });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("wiz-drop-hover"));
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("wiz-drop-hover");
        if (e.dataTransfer.files.length) {
          window._wizPendingCSV = e.dataTransfer.files[0];
          _wizRenderStep();
        }
      });
      fileInput.addEventListener("change", () => {
        if (fileInput.files.length) {
          window._wizPendingCSV = fileInput.files[0];
          _wizRenderStep();
        }
      });
    }
  }

  // Update next button text after render
  if (nextBtn) {
    if (_wizStep === 3) {
      const hasCSV = window._wizPendingCSV;
      nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>' + (hasCSV ? "Create & Upload" : "Create Job");
    } else {
      nextBtn.textContent = "Next";
    }
  }
}

// Save fields from current step before navigating
function _wizSaveCurrentStep() {
  if (!window._wizSavedFields) window._wizSavedFields = {};
  if (_wizStep === 1) {
    const custSel = $("wiz_customer");
    const wfSel = $("wiz_workflow");
    const scRadio = document.querySelector('input[name="wiz_server_class"]:checked');
    if (custSel) window._wizSavedFields.customer = custSel.value;
    if (wfSel) window._wizSavedFields.workflow = wfSel.value;
    if (scRadio) window._wizSavedFields.serverClass = scRadio.value;
  } else if (_wizStep === 2) {
    const nameEl = $("wiz_job_name");
    const rackEl = $("wiz_rack_id");
    const skuEl = $("wiz_sku");
    const poEl = $("wiz_po");
    if (nameEl) window._wizSavedFields.jobName = nameEl.value;
    if (rackEl) window._wizSavedFields.rackId = rackEl.value;
    if (skuEl) window._wizSavedFields.sku = skuEl.value;
    if (poEl) window._wizSavedFields.po = poEl.value;
  }
}

window.wizOnCustomerChange = function () {
  const custSel = $("wiz_customer");
  const wfSel = $("wiz_workflow");
  if (!custSel || !wfSel) return;
  wfSel.innerHTML = _wizBuildWorkflowOptions(custSel.value);
  wizOnWorkflowChange();
  wizAutoName();
};

window.wizOnWorkflowChange = function () {
  const wfSel = $("wiz_workflow");
  const scSection = $("wiz_server_class_section");
  if (wfSel && scSection) {
    scSection.style.display = wfSel.value === "configbuild" ? "" : "none";
  }
  wizAutoName();
};

function launchWizard(presetCustomer, presetWorkflow) {
  ensureJobModalStyles();
  _wizStep = 1;
  window._wizPendingCSV = null;
  window._wizSavedFields = {
    customer: presetCustomer || "servicenow",
    workflow: presetWorkflow || "configbuild",
    serverClass: "J",
  };

  const html = `
    <div class="wizard-modal-root" id="wizard-modal-root">
      <div class="wizard-overlay" onclick="closeWizardModal()"></div>
      <div class="wizard-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title">
            <div class="title-main"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> New Job</div>
            <div class="title-sub muted">Create a new automation job in 3 easy steps.</div>
          </div>
          <button class="modal-close" onclick="closeWizardModal()" aria-label="Close">&times;</button>
        </div>

        <div id="wiz-step-indicator">${_wizStepIndicator(1)}</div>

        <div id="wiz-step-body"></div>

        <div class="section" id="wiz_out_section" style="display:none;">
          <pre id="wiz_out" class="output"></pre>
        </div>

        <div class="modal-footer wiz-footer">
          <button class="btn ghost" id="wiz-back-btn" style="display:none;" onclick="wizGoBack()">Back</button>
          <span class="wiz-step-count muted" id="wiz-step-count">Step 1 of 3</span>
          <div style="flex:1;"></div>
          <button class="btn ghost" onclick="closeWizardModal()">Cancel</button>
          <button class="btn primary wiz-next-btn" id="wiz-next-btn" onclick="wizGoNext()">Next</button>
        </div>
      </div>
    </div>
  `;

  ensureWizardContainer();
  $("wizard-container").innerHTML = html;

  _wizRenderStep();

  // Focus trap (Feature 12)
  const wizRoot = $("wizard-modal-root");
  if (wizRoot && window.trapFocusInModal) window.trapFocusInModal(wizRoot);
}

window.wizGoBack = function () {
  _wizSaveCurrentStep();
  if (_wizStep > 1) {
    _wizStep--;
    _wizRenderStep();
  }
};

window.wizGoNext = function () {
  _wizSaveCurrentStep();
  if (_wizStep < 3) {
    _wizStep++;
    _wizRenderStep();
  } else {
    wizCreateJob();
  }
};

function closeWizardModal() {
  const el = $("wizard-modal-root");
  if (el) {
    if (window.releaseFocusTrap) window.releaseFocusTrap(el);
    el.remove();
  }
  window._wizPendingCSV = null;
  window._wizSavedFields = null;
}

window.launchWizard = launchWizard;
window.closeWizardModal = closeWizardModal;
window._wizRenderStep = _wizRenderStep;

window.wizCreateJob = async function () {
  const out = $("wiz_out");
  const btn = $("wiz-next-btn");
  const fields = window._wizSavedFields || {};
  const jobName = safeText(fields.jobName || $("wiz_job_name")?.value || "").trim();
  const inventory = "target_hosts";
  const rackId = safeText(fields.rackId || "").trim();
  const sku = safeText(fields.sku || "").trim();
  const po = safeText(fields.po || "").trim();
  const customer = safeText(fields.customer || "servicenow");
  const workflow = safeText(fields.workflow || "configbuild");

  if (!jobName) {
    if (out) { out.textContent = "Job name is required."; $("wiz_out_section").style.display = ""; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Creating..."; }

  try {
    const payload = { jobName, inventory, rackId, sku, po, customer, workflow };
    const created = await apiPostJSON("/api/jobs", payload);
    const newId = created.jobId || created.id || created.job_id;

    // Upload CSV if pending
    if (window._wizPendingCSV && newId) {
      try {
        const formData = new FormData();
        formData.append("file", window._wizPendingCSV);
        const uploadRes = await fetch(`/api/jobs/${encodeURIComponent(newId)}/upload`, {
          method: "POST",
          body: formData,
        });
        if (uploadRes.ok) {
          showToast("Job created and file uploaded", "success");
        } else {
          showToast("Job created but file upload failed", "warn");
        }
      } catch {
        showToast("Job created but file upload failed", "warn");
      }
    } else {
      showToast("Job created successfully", "success");
    }

    await loadJobs();
    closeWizardModal();
    if (newId) openJobPanel(newId);
  } catch (e) {
    if (out) { out.textContent = "Error: " + e.message; $("wiz_out_section").style.display = ""; }
    if (btn) { btn.disabled = false; btn.textContent = "Create Job"; }
    showToast("Failed to create job", "error");
  }
};

// ─────────────────────────────────────────────────────────────
// Templates (#19)
// ─────────────────────────────────────────────────────────────
window._wizTemplates = [];

async function wizLoadTemplates() {
  const sel = $("wiz_template");
  if (!sel) return;
  try {
    const templates = await apiGet("/api/templates");
    window._wizTemplates = templates || [];
    if (!templates.length) {
      sel.parentElement.style.display = "none";
      return;
    }
    sel.innerHTML = '<option value="">No template (start fresh)</option>' +
      templates.map(t => `<option value="${safeText(t.templateId)}">${safeText(t.templateName)} (${safeText(t.workflow || "")})</option>`).join("");
  } catch {
    sel.parentElement.style.display = "none";
  }
}

window.wizApplyTemplate = function () {
  const sel = $("wiz_template");
  if (!sel || !sel.value) return;
  const template = window._wizTemplates.find(t => t.templateId === sel.value);
  if (!template) return;

  // Pre-fill customer
  const custSel = $("wiz_customer");
  if (custSel && template.customer) {
    custSel.value = template.customer;
    wizOnCustomerChange();
  }

  // Pre-fill workflow
  const wfSel = $("wiz_workflow");
  if (wfSel && template.workflow) wfSel.value = template.workflow;
  wizOnWorkflowChange();

  // Save to fields for step 2
  if (!window._wizSavedFields) window._wizSavedFields = {};
  if (template.customer) window._wizSavedFields.customer = template.customer;
  if (template.workflow) window._wizSavedFields.workflow = template.workflow;
  if (template.sku) window._wizSavedFields.sku = template.sku;
  if (template.po) window._wizSavedFields.po = template.po;

  showToast("Template applied", "info", 1500);
};
