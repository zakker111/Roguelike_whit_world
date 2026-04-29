/**
 * HandChooser: Equip-to-hand chooser split out from ui/ui.js
 *
 * Exports (ESM + window.HandChooser):
 * - show(x, y, cb)
 * - hide()
 * - isOpen()
 */
let _panel = null;
let _cb = null;

function ensurePanel() {
  if (_panel) return _panel;

  const panel = document.createElement("div");
  panel.id = "hand-chooser";
  panel.style.position = "fixed";
  panel.style.display = "none";
  panel.style.zIndex = "50000";
  panel.style.background = "rgba(20,24,33,0.98)";
  panel.style.border = "1px solid rgba(80,90,120,0.6)";
  panel.style.borderRadius = "6px";
  panel.style.padding = "8px";
  panel.style.boxShadow = "0 8px 28px rgba(0,0,0,0.4)";

  panel.innerHTML = `
    <div style="color:#cbd5e1; font-size:12px; margin-bottom:6px;">Equip to:</div>
    <div style="display:flex; gap:6px;">
      <button data-hand="left" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Left</button>
      <button data-hand="right" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Right</button>
      <button data-hand="cancel" style="padding:6px 10px; background:#111827; color:#9ca3af; border:1px solid #374151; border-radius:4px; cursor:pointer;">Cancel</button>
    </div>
  `;

  document.body.appendChild(panel);

  // Button clicks
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    const hand = btn.dataset.hand;
    const cb = _cb;
    hide();
    if (typeof cb === "function") cb(hand);
  });

  // Outside click hides (no callback)
  document.addEventListener("click", (e) => {
    if (_panel && _panel.style.display !== "none" && !_panel.contains(e.target)) {
      hide();
    }
  });

  _panel = panel;
  return panel;
}

export function show(x, y, cb) {
  const panel = ensurePanel();
  _cb = cb || null;
  panel.style.left = `${Math.round(x)}px`;
  panel.style.top = `${Math.round(y)}px`;
  panel.style.display = "block";
}

export function hide() {
  if (_panel) _panel.style.display = "none";
  _cb = null;
}

export function isOpen() {
  try { return !!(_panel && _panel.style.display !== "none"); } catch (_) { return false; }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("HandChooser", { show, hide, isOpen });