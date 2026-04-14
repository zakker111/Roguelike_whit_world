/**
 * SmokeModal: Smoke Test Configuration modal wrapper split out from ui/ui.js
 *
 * Exports (ESM + window.SmokeModal):
 * - show()
 * - hide()
 * - isOpen()
 * - renderOptions(scenarios, { selectedIds, filterText })
 * - getSelectedScenarioIds()
 * - setSelectedScenarioIds(ids)
 * - getFilterText()
 * - updateSelectionSummary()
 * Notes:
 * - Uses existing DOM element with id "smoke-panel" created in HTML.
 * - Rendering now lives here so ui/ui.js stays focused on orchestration.
 */

function getPanel() {
  try { return document.getElementById("smoke-panel"); } catch (_) { return null; }
}

function getList() {
  try { return document.getElementById("smoke-scenarios"); } catch (_) { return null; }
}

function getSummaryEl() {
  try { return document.getElementById("smoke-selection-summary"); } catch (_) { return null; }
}

function getSearchInput() {
  try { return document.getElementById("smoke-search"); } catch (_) { return null; }
}

let selectedScenarioIds = new Set();

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function show() {
  const panel = getPanel();
  if (panel) panel.hidden = false;
}

export function hide() {
  const panel = getPanel();
  if (panel) panel.hidden = true;
}

export function isOpen() {
  const panel = getPanel();
  return !!(panel && !panel.hidden);
}

export function getFilterText() {
  try {
    const inp = getSearchInput();
    return inp ? String(inp.value || "").trim().toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

export function getSelectedScenarioIds() {
  try {
    return Array.from(selectedScenarioIds);
  } catch (_) {
    return [];
  }
}

export function updateSelectionSummary() {
  try {
    const summary = getSummaryEl();
    if (!summary) return;
    const container = getList();
    const total = container ? container.querySelectorAll("input.smoke-sel").length : 0;
    const selected = getSelectedScenarioIds().length;
    summary.textContent = selected
      ? `${selected} selected • ${total} shown`
      : `No explicit selection • ${total} shown (Run uses defaults)`;
  } catch (_) {}
}

export function setSelectedScenarioIds(ids) {
  try {
    const want = new Set(Array.isArray(ids) ? ids.map((v) => String(v)) : []);
    selectedScenarioIds = want;
    const container = getList();
    if (!container) return;
    Array.from(container.querySelectorAll("input.smoke-sel")).forEach((inp) => {
      if (!inp || !inp.value) return;
      inp.checked = want.has(String(inp.value));
    });
    updateSelectionSummary();
  } catch (_) {}
}

export function renderOptions(scenarios, opts = {}) {
  try {
    const container = getList();
    if (!container) return;
    const arr = Array.isArray(scenarios) ? scenarios : [];
    if (Array.isArray(opts.selectedIds)) {
      selectedScenarioIds = new Set(opts.selectedIds.map((id) => String(id)));
    }
    const selectedIds = new Set(selectedScenarioIds);
    const filterText = String(opts.filterText || "").trim().toLowerCase();
    const filtered = arr.filter((s) => {
      const id = String((s && s.id) || "");
      const label = String((s && s.label) || id);
      const group = String((s && s.group) || "");
      if (!filterText) return true;
      return id.toLowerCase().includes(filterText)
        || label.toLowerCase().includes(filterText)
        || group.toLowerCase().includes(filterText)
        || (s && s.phase0 ? "phase0".includes(filterText) : false);
    });
    const html = filtered.map((s) => {
      const id = String((s && s.id) || "");
      if (!id) return "";
      const label = String((s && s.label) || id);
      const group = String((s && s.group) || "misc");
      const checked = selectedIds.has(id) ? " checked" : "";
      const phaseBadge = s && s.phase0
        ? `<span class="smoke-scenario-badge smoke-scenario-badge--phase0">Phase 0</span>`
        : "";
      return `
        <label class="smoke-scenario" title="${escapeHtml(id)}">
          <input type="checkbox" class="smoke-sel" value="${escapeHtml(id)}"${checked} />
          <span class="smoke-scenario-main">
            <span class="smoke-scenario-title">${escapeHtml(label)}</span>
            <span class="smoke-scenario-meta">
              <span class="smoke-scenario-badge">${escapeHtml(group)}</span>
              ${phaseBadge}
              <span class="smoke-scenario-id">${escapeHtml(id)}</span>
            </span>
          </span>
        </label>
      `;
    }).join("");
    container.innerHTML = html || `<div class="help">No scenarios match the current filter.</div>`;
    Array.from(container.querySelectorAll("input.smoke-sel")).forEach((inp) => {
      inp.addEventListener("change", () => {
        try {
          const id = String(inp.value || "");
          if (!id) return;
          if (inp.checked) selectedScenarioIds.add(id);
          else selectedScenarioIds.delete(id);
        } catch (_) {}
        updateSelectionSummary();
      });
    });
    updateSelectionSummary();
  } catch (_) {}
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("SmokeModal", {
  show,
  hide,
  isOpen,
  renderOptions,
  getSelectedScenarioIds,
  setSelectedScenarioIds,
  getFilterText,
  updateSelectionSummary,
});
