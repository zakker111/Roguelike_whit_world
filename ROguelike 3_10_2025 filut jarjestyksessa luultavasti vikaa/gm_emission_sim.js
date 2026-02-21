import "./core/modes/modes.js";
import { runGmEmissionSim } from "./core/gm/emission_sim.js";

const report = runGmEmissionSim({
  gmEvent: window.Modes && window.Modes.__gmEvent,
});

window.__GM_EMISSION_SIM_RESULT__ = report;

const statusEl = document.getElementById("gm-emission-status");
const checklistEl = document.getElementById("gm-emission-checklist");
const reportEl = document.getElementById("gm-emission-report");

if (statusEl) {
  const isWarn = !!(report && report.warning);
  statusEl.textContent = report.ok ? "PASS" : (isWarn ? "WARN" : "FAIL");
  statusEl.classList.toggle("pass", report.ok);
  statusEl.classList.toggle("fail", !report.ok && !isWarn);
  statusEl.classList.toggle("warn", isWarn);
}

if (checklistEl) {
  checklistEl.innerHTML = "";

  if (report && report.warning) {
    const li = document.createElement("li");
    li.textContent = `WARN: ${report.warning}`;
    li.style.color = "#f59e0b";
    checklistEl.appendChild(li);
  }

  for (const s of report.scenarios) {
    const li = document.createElement("li");
    li.textContent = `${s.ok ? "PASS" : "FAIL"}: [${s.id}] ${s.label}${typeof s.ms === "number" ? ` (${s.ms}ms)` : ""}`;
    if (!s.ok) li.style.color = "#ef4444";
    checklistEl.appendChild(li);
  }
}

if (reportEl) {
  reportEl.textContent = JSON.stringify(report, null, 2);
}
