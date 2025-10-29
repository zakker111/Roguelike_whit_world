/**
 * ConfirmModal: Simple confirm dialog split out from ui/ui.js
 *
 * Exports (ESM + window.ConfirmModal):
 * - show(text, pos, onOk, onCancel)
 * - hide()
 * - isOpen()
 * - cancel()
 */
let _panel = null;
let _okCb = null;
let _cancelCb = null;

function ensurePanel() {
  if (_panel) return _panel;

  const panel = document.createElement("div");
  panel.id = "confirm-panel";
  panel.style.position = "fixed";
  panel.style.left = "50%";
  panel.style.top = "50%";
  panel.style.transform = "translate(-50%, -50%)";
  panel.style.zIndex = "50001";
  panel.style.background = "rgba(20,24,33,0.98)";
  panel.style.border = "1px solid rgba(80,90,120,0.6)";
  panel.style.borderRadius = "8px";
  panel.style.padding = "12px";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
  panel.style.minWidth = "280px";
  panel.style.display = "none";

  const text = document.createElement("div");
  text.id = "confirm-text";
  text.style.color = "#e5e7eb";
  text.style.fontSize = "14px";
  text.style.marginBottom = "10px";
  text.textContent = "Are you sure?";

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.justifyContent = "flex-end";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.padding = "6px 10px";
  cancelBtn.style.background = "#111827";
  cancelBtn.style.color = "#9ca3af";
  cancelBtn.style.border = "1px solid #374151";
  cancelBtn.style.borderRadius = "4px";
  cancelBtn.style.cursor = "pointer";

  const okBtn = document.createElement("button");
  okBtn.textContent = "OK";
  okBtn.style.padding = "6px 12px";
  okBtn.style.background = "#1f2937";
  okBtn.style.color = "#e5e7eb";
  okBtn.style.border = "1px solid #334155";
  okBtn.style.borderRadius = "4px";
  okBtn.style.cursor = "pointer";

  row.appendChild(cancelBtn);
  row.appendChild(okBtn);
  panel.appendChild(text);
  panel.appendChild(row);

  document.body.appendChild(panel);

  // Button clicks
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hide();
    try { if (typeof _cancelCb === "function") _cancelCb(); } catch (_) {}
  });
  okBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hide();
    try { if (typeof _okCb === "function") _okCb(); } catch (_) {}
  });

  // Outside click cancels
  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      hide();
      try { if (typeof _cancelCb === "function") _cancelCb(); } catch (_) {}
      e.stopPropagation();
    }
  });

  _panel = panel;
  return panel;
}

export function show(text, pos, onOk, onCancel) {
  const panel = ensurePanel();
  _okCb = onOk || null;
  _cancelCb = onCancel || null;

  // Update text
  try {
    const t = document.getElementById("confirm-text");
    if (t) t.textContent = text || "Are you sure?";
  } catch (_) {}

  // Position (optional)
  try {
    const hasPos = pos && typeof pos === "object";
    const x = hasPos && typeof pos.x === "number" ? pos.x : undefined;
    const y = hasPos && typeof pos.y === "number" ? pos.y : undefined;
    if (typeof x === "number" && typeof y === "number") {
      const left = Math.max(10, Math.min(window.innerWidth - 300, Math.round(x)));
      const top = Math.max(10, Math.min(window.innerHeight - 120, Math.round(y)));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.transform = ""; // absolute position when pos provided
    } else {
      panel.style.left = "50%";
      panel.style.top = "50%";
      panel.style.transform = "translate(-50%, -50%)";
    }
  } catch (_) {}

  panel.style.display = "block";
}

export function hide() {
  if (_panel) _panel.style.display = "none";
  _okCb = null;
  _cancelCb = null;
}

export function cancel() {
  hide();
  try { if (typeof _cancelCb === "function") _cancelCb(); } catch (_) {}
}

export function isOpen() {
  try { return !!(_panel && _panel.style.display !== "none"); } catch (_) { return false; }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("ConfirmModal", { show, hide, isOpen, cancel });