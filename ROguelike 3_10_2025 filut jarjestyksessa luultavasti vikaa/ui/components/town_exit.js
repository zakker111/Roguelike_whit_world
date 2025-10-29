/**
 * TownExit: floating Exit Town button split out from ui/ui.js
 *
 * Exports (ESM + window.TownExit):
 * - show()
 * - hide()
 * - isVisible()
 * - setHandler(fn)     // called when button clicked
 */
let _btn = null;
let _handler = null;

function ensureButton() {
  if (_btn) return _btn;
  const b = document.createElement("button");
  b.id = "town-exit-btn";
  b.textContent = "Exit Town";
  b.style.position = "fixed";
  b.style.right = "16px";
  b.style.bottom = "16px";
  b.style.padding = "8px 12px";
  b.style.fontSize = "14px";
  b.style.background = "#1f2937";
  b.style.color = "#e5e7eb";
  b.style.border = "1px solid #334155";
  b.style.borderRadius = "6px";
  b.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
  b.style.cursor = "pointer";
  b.style.display = "none";
  b.title = "Leave the town";
  document.body.appendChild(b);

  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof _handler === "function") {
      try { _handler(); } catch (_) {}
    }
  });

  _btn = b;
  return _btn;
}

export function setHandler(fn) {
  _handler = (typeof fn === "function") ? fn : null;
}

export function show() {
  const b = ensureButton();
  b.style.display = "block";
}

export function hide() {
  if (_btn) _btn.style.display = "none";
}

export function isVisible() {
  return !!(_btn && _btn.style.display !== "none");
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("TownExit", { setHandler, show, hide, isVisible });