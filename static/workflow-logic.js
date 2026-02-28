// static/workflow-logic.js — Minimal utilities for workflow logic
(function () {
  const WORKFLOW_LABELS = {
    configbuild:    "Server Build & Configure",
    postprov:       "Post-Provisioning Setup",
    quickqc:        "Quick QC Validation",
    cisco_switch:   "Cisco Switch",
    juniper_switch: "Juniper Switch",
    console_switch: "Console Switch",
    pdu:            "PDU Setup",
  };

  function deriveRackFromJobName(jobName) {
    if (!jobName) return null;
    const parts = jobName.split(/[-–]/);
    const last = (parts[parts.length - 1] || "").trim();
    if (!last) return null;
    const toks = last.split(/\s+/);
    return toks[toks.length - 1].toUpperCase();
  }

  window.WORKFLOW_LABELS = WORKFLOW_LABELS;
  window.deriveRackFromJobName = deriveRackFromJobName;
})();
