/**
 * HelpModal: Help/Controls panel (no Character Sheet content)
 *
 * Exports (ESM + window.HelpModal):
 * - show(ctx)
 * - hide()
 * - isOpen()
 */
let _panel = null;
let _content = null;

function ensurePanel() {
  if (_panel) return _panel;

  const panel = document.createElement("div");
  panel.id = "help-panel";
  panel.style.position = "fixed";
  panel.style.left = "50%";
  panel.style.top = "50%";
  panel.style.transform = "translate(-50%, -50%)";
  panel.style.zIndex = "40000";
  panel.style.background = "rgba(20,24,33,0.98)";
  panel.style.border = "1px solid rgba(80,90,120,0.6)";
  panel.style.borderRadius = "8px";
  panel.style.padding = "12px";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
  panel.style.minWidth = "520px";
  panel.style.maxWidth = "92vw";
  panel.style.maxHeight = "80vh";
  panel.style.overflow = "auto";
  panel.style.display = "none";

  const close = document.createElement("div");
  close.textContent = "Close (Esc)";
  close.style.color = "#94a3b8";
  close.style.fontSize = "12px";
  close.style.margin = "0 0 10px 0";

  const content = document.createElement("div");
  content.id = "help-content";
  content.style.color = "#e5e7eb";
  content.style.fontSize = "13px";
  content.style.lineHeight = "1.45";

  panel.appendChild(close);
  panel.appendChild(content);
  document.body.appendChild(panel);

  // Click outside to close
  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      hide();
      e.stopPropagation();
    }
  });

  _panel = panel;
  _content = content;
  return panel;
}

function buildContent(ctx) {
  const html = [
    "<div style='font-size:16px; font-weight:600; margin-bottom:8px;'>Controls</div>",
    "<div style='display:grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin-bottom: 10px;'>",
    "<div>Move: Arrow keys / Numpad (8-dir)</div><div>Wait: Numpad5</div>",
    "<div>Action/Interact: G</div><div>Inventory: I</div>",
    "<div>GOD panel: P</div><div>FOV: [ and ] (or +/-)</div>",
    "<div>Help: F1</div><div>Character Sheet: C</div>",
    "<div>Brace (dungeon): B</div><div>Local Region Map: G (overworld/RUINS; M disabled)</div>",
    "</div>"
  ].join("");

  return html;
}

export function show(ctx = null) {
  const panel = ensurePanel();
  try {
    const html = buildContent(ctx);
    if (_content) _content.innerHTML = html;
  } catch (_) {}
  panel.style.display = "block";
}

export function hide() {
  if (_panel) _panel.style.display = "none";
}

export function isOpen() {
  try { return !!(_panel && _panel.style.display !== "none"); } catch (_) { return false; }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("HelpModal", { show, hide, isOpen });