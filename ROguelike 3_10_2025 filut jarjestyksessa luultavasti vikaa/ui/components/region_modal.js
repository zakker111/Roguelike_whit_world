/**
 * RegionModal: Region Map modal split out from ui/ui.js
 *
 * Exports (ESM + window.RegionModal):
 * - show(ctx)
 * - hide()
 * - isOpen()
 */
let _panel = null;
let _canvas = null;

function ensurePanel() {
  if (_panel) return _panel;

  const panel = document.createElement("div");
  panel.id = "region-panel";
  panel.style.position = "fixed";
  panel.style.left = "50%";
  panel.style.top = "50%";
  panel.style.transform = "translate(-50%, -50%)";
  panel.style.zIndex = "40000";
  panel.style.background = "rgba(20,24,33,0.98)";
  panel.style.border = "1px solid rgba(80,90,120,0.6)";
  panel.style.borderRadius = "8px";
  panel.style.padding = "8px";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
  panel.style.minWidth = "420px";
  panel.style.minHeight = "300px";
  panel.style.maxWidth = "92vw";
  panel.style.maxHeight = "80vh";
  panel.style.display = "none";

  const close = document.createElement("div");
  close.textContent = "Close (Esc)";
  close.style.color = "#94a3b8";
  close.style.fontSize = "12px";
  close.style.margin = "4px 0 6px 0";

  const canvas = document.createElement("canvas");
  canvas.id = "region-canvas";
  // responsive size
  const vw = Math.max(640, Math.floor(window.innerWidth * 0.7));
  const vh = Math.max(360, Math.floor(window.innerHeight * 0.6));
  canvas.width = Math.min(vw, Math.floor(window.innerWidth * 0.92));
  canvas.height = Math.min(vh, Math.floor(window.innerHeight * 0.80));
  canvas.style.display = "block";
  canvas.style.background = "#0b0c10";
  canvas.style.border = "1px solid rgba(80,90,120,0.5)";
  canvas.style.borderRadius = "6px";

  panel.appendChild(close);
  panel.appendChild(canvas);
  document.body.appendChild(panel);

  // Click outside to close
  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      hide();
      e.stopPropagation();
    }
  });

  _panel = panel;
  _canvas = canvas;
  return panel;
}

export function show(ctx = null) {
  const panel = ensurePanel();
  panel.style.display = "block";
  // Draw contents via RegionMap if available
  try {
    const RM = (typeof window !== "undefined" ? window.RegionMap : null);
    if (RM && typeof RM.draw === "function") {
      RM.draw(ctx || (window.GameAPI && typeof window.GameAPI.getCtx === "function" ? window.GameAPI.getCtx() : null));
    }
  } catch (_) {}
}

export function hide() {
  if (_panel) _panel.style.display = "none";
}

export function isOpen() {
  try { return !!(_panel && _panel.style.display !== "none"); } catch (_) { return false; }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("RegionModal", { show, hide, isOpen });