// ─────────────────────────────────────────────────────────────
// job-panel-execution.js — Run/stop workflows, save workflow settings
// ─────────────────────────────────────────────────────────────

async function saveModalWorkflow(jobId) {
  const wf = safeText($("modal_workflow")?.value || "configbuild").toLowerCase();
  const sc = safeText($("modal_server_class")?.value || "").trim();
  const proj = safeText($("modal_customer")?.value || _activeCustomer || "servicenow");
  const updates = { workflow: wf, customer: proj };
  if (wf === "configbuild") updates.serverClass = sc || "J";
  await apiPatch(`/api/jobs/${encodeURIComponent(jobId)}`, updates);
}

function setRunButtonsDisabled(disabled) {
  const btn = $("btn_run_tasks");
  if (btn) btn.disabled = disabled;
}

async function runSelected(jobId) {
  const runStatus = $("run_status");

  // Check for parallel mode groups
  const groups = typeof collectRunGroups === "function" ? collectRunGroups() : null;

  if (groups) {
    // ── Multi-group parallel run ──
    // Validate each group has at least hosts or tasks
    const emptyGroups = groups.filter(g => !g.tags.length && !g.hosts);
    if (emptyGroups.length === groups.length) {
      showToast("Add at least one task or host to each group", "info");
      return;
    }

    const ok = await runPreflightChecks(jobId);
    if (!ok) return;

    // Build multi-group summary with per-group workflow info
    const wfOptions = typeof getWorkflowOptions === "function" ? getWorkflowOptions(_activeCustomer) : [];
    let summaryHtml = '<div class="run-summary"><div class="run-summary-section">';
    summaryHtml += `<div class="run-summary-row"><span class="run-summary-label">Mode</span><span class="run-summary-value">Parallel (${groups.length} groups)</span></div>`;
    groups.forEach(g => {
      const tagsStr = g.tags.length ? g.tags.join(", ") : "full workflow";
      const hostList = g.hosts ? g.hosts.split(":") : [];
      const hostsStr = hostList.length ? `${hostList.length} host(s)` : "all hosts";
      const wfOpt = wfOptions.find(w => w.value === g.workflow);
      let wfStr = wfOpt ? wfOpt.label : (g.workflow || "default");
      if (g.workflow === "configbuild" && g.serverClass) wfStr += ` (${g.serverClass} Class)`;
      summaryHtml += `<div class="run-summary-row" style="border-top:1px solid rgba(255,255,255,0.05);padding-top:4px;margin-top:4px;">
        <span class="run-summary-label">${safeText(g.label)}</span>
        <span class="run-summary-value">${safeText(wfStr)}<br/>${safeText(tagsStr)}<br/><span class="muted">${safeText(hostsStr)}</span></span>
      </div>`;
    });
    summaryHtml += '</div></div>';

    const confirmed = await showConfirmAsync(summaryHtml, {
      title: "Run Parallel Groups", confirmText: `Run ${groups.length} Groups`, html: true,
    });
    if (!confirmed) return;

    _runStartTime = Date.now();
    setRunButtonsDisabled(true);

    try {
      if (runStatus) runStatus.textContent = "Saving workflow...";
      await saveModalWorkflow(jobId);

      if (runStatus) runStatus.innerHTML = '<span class="spinner"></span> Running ' + groups.length + ' groups...';
      updateStatusBar("running", "Starting " + groups.length + " parallel groups");

      await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/run`, { groups });
      showToast(`${groups.length} groups started in parallel`, "success");
      setRunButtonsDisabled(false);
    } catch (e) {
      updateStatusBar("error", "Failed: " + e.message);
      showToast("Could not start groups: " + e.message, "error", 6000, {
        actionLabel: "Retry",
        onAction: () => runSelected(jobId),
      });
      setRunButtonsDisabled(false);
    } finally {
      if (runStatus) runStatus.textContent = "Idle";
    }
    return;
  }

  // ── Single-run mode (unchanged) ──
  const tags = collectSelectedTags();

  if (!tags.length) {
    showToast("Pick at least one task", "info");
    return;
  }

  const ok2 = await runPreflightChecks(jobId);
  if (!ok2) return;

  const summaryHtml = await buildRunSummaryHtml(jobId, tags);
  const confirmText = tags.length ? `Run ${tags.length} Task${tags.length !== 1 ? "s" : ""}` : "Run";
  const confirmed = await showConfirmAsync(summaryHtml, {
    title: "Run Summary", confirmText, html: true,
  });
  if (!confirmed) return;

  _runStartTime = Date.now();
  setRunButtonsDisabled(true);

  try {
    if (runStatus) runStatus.textContent = "Saving workflow...";
    await saveModalWorkflow(jobId);
    await applyHostLimit(jobId);

    if (runStatus) runStatus.innerHTML = '<span class="spinner"></span> Running...';
    updateStatusBar("running", "Starting: " + tags.join(", "));

    await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/run`, { tags });
    showToast("Job started", "success");
    setRunButtonsDisabled(false);
  } catch (e) {
    updateStatusBar("error", "Failed: " + e.message);
    let msg = "Could not start job: " + e.message;
    if (e.status === 429) msg = "Run queue full \u2014 wait for a running job to finish or stop one first";
    showToast(msg, "error", 6000, {
      actionLabel: "Retry",
      onAction: () => runSelected(jobId),
    });
    setRunButtonsDisabled(false);
  } finally {
    if (runStatus) runStatus.textContent = "Idle";
  }
}

async function runFullWorkflow(jobId) {
  const runStatus = $("run_status");

  const ok = await runPreflightChecks(jobId);
  if (!ok) return;

  const summaryHtml = await buildRunSummaryHtml(jobId, []);
  const confirmed = await showConfirmAsync(summaryHtml, {
    title: "Run Summary", confirmText: "Send It", html: true,
  });
  if (!confirmed) return;

  _runStartTime = Date.now();
  setRunButtonsDisabled(true);

  try {
    if (runStatus) runStatus.textContent = "Saving workflow...";
    await saveModalWorkflow(jobId);
    await applyHostLimit(jobId);

    if (runStatus) runStatus.innerHTML = '<span class="spinner"></span> Running full workflow...';
    updateStatusBar("running", "Full workflow starting...");

    await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/run`, { tags: [] });
    showToast("Full workflow started", "success");
    setRunButtonsDisabled(false);
  } catch (e) {
    updateStatusBar("error", "Failed: " + e.message);
    let msg = "Could not start workflow: " + e.message;
    if (e.status === 429) msg = "5 jobs already running \u2014 wait for one to finish or stop one first";
    showToast(msg, "error", 6000, {
      actionLabel: "Retry",
      onAction: () => runFullWorkflow(jobId),
    });
    setRunButtonsDisabled(false);
  } finally {
    if (runStatus) runStatus.textContent = "Idle";
  }
}

async function stopTaskNow(jobId, groupId) {
  const label = groupId ? `group "${groupId}"` : "this job";
  const ok = await showConfirmAsync(`Stop ${label}? This will terminate the running playbook immediately.`, {
    title: groupId ? "Stop Group" : "Stop Job", confirmText: "Stop", danger: true,
  });
  if (!ok) return;

  const runStatus = $("run_status");

  try {
    if (runStatus) runStatus.textContent = "Stopping...";
    updateStatusBar("stopping", "Sending stop signal...");

    const payload = groupId ? { groupId } : {};
    await apiPostJSON(`/api/jobs/${encodeURIComponent(jobId)}/stop`, payload);
    updateStatusBar("stopped", groupId ? `Group ${groupId} stopped` : "Job stopped");
    showToast(groupId ? `Group stopped` : "Job stopped", "info");
  } catch (e) {
    updateStatusBar("error", "Stop failed: " + e.message);
    showToast("Stop signal failed: " + (e.message || "Unknown error") + ". Process may have already exited.", "error", 6000);
  } finally {
    if (runStatus) runStatus.textContent = "Idle";
  }
}
