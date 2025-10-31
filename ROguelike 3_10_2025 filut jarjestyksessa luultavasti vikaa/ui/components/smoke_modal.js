/**
 * SmokeModal: Smoke Test Configuration modal wrapper split out from ui/ui.js
 *
 * Exports (ESM + window.SmokeModal):
 * - show()
 * - hide()
 * - isOpen()
 * Notes:
 * - Uses existing DOM element with id "smoke-panel" created in HTML.
 * - UI.renderSmokeOptions() remains in ui/ui.js and is called by UI before show().
 */

function getPanel() {
  try { return document.getElementById("smoke-panel"); } catch (_) { return null; }
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

import { attachGlobal } from "/utils/global.js";
attachGlobal("SmokeModal", { show, hide, isOpen });