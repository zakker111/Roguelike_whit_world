import { runGmSim } from "./core/gm/sim/gm_sim_core.js";

const report = runGmSim();

window.__GM_SIM_RESULT__ = report;

const statusEl = document.getElementById("gm-sim-status");
const checklistEl = document.getElementById("gm-sim-checklist");
const reportEl = document.getElementById("gm-sim-report");

statusEl.textContent = report.ok ? "PASS" : "FAIL";
statusEl.classList.toggle("pass", report.ok);
statusEl.classList.toggle("fail", !report.ok);

checklistEl.innerHTML = "";
for (const c of report.checks) {
  const li = document.createElement("li");
  li.textContent = `${c.ok ? "PASS" : "FAIL"}: ${c.name}${typeof c.ms === "number" ? ` (${c.ms}ms)` : ""}`;
  if (!c.ok) li.style.color = "#ef4444";
  checklistEl.appendChild(li);
}

reportEl.textContent = JSON.stringify(report, null, 2);
