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
lfunction ensurePanel() {
  if (_pafunction ensurePanel
  const panel = document.createEl
  const panel = document.createElement("div  pa  panel.id = "confirm-panel";
  panel.style.position = "fi  pane  panel.style.left =   panel  panel.style.top = "50%";
  panel.style.transform = "translate(-50%, -50%)"    panel.style.zIndex = "50001";
  // Palette-driv    try {
      const pal = (typeo    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.      const bg = pal && pal.panelB      const bg = pal && pal.panelBg ? pal      const bd = pal && pal.panelB      const bd = pal && pal.panelBorder ? pal.panelBorder :      const sh = pal && pal.panelS      const sh = pal && pal.panelShadow ? pal.panelShadow      panel.style.background = bg;       panel.style.border = bd;
      panel.style.boxShadow = sh;
    } catch (_) {
      panel.style.background = "rg      panel.style.ba      panel.style.border = "1px so      panel.style.border =      panel.style.boxShadow = "0 1      panel.style.boxShadow    }
  })();
  panel.style.borderRadius = "8px"    panel.style.padding = "12px";
  panel.style.minWidth = "280px";
  panel.style.display = "none";

  const text = document  const text = document  text.id = "confirm-te  tex  text.style.color = "#  text.st  text.style.fontSize =  text.st  text.style.marginBott  text.styl    text.textContent = "A  text.text  te
  const row = document.  const row  const row  row.style.display = "  row.s  row.style.gap = "8px"    row.style.justifyCont  row.style  row.s
  const cancelBtn = doc  const can  const cancelBtn = document.createElement(  cancelBtn  cancelBtn.textContent =  cancelBtn  cancelBtn.style.padding = "  cancelBtn  cancelBtn.style.background =   cancelBtn  cancelBtn.style.color =   cancelBtn  cancelBtn.style.border = "1px solid  cancelBtn  cancelBtn.style.borderRadiu  cancelBtn  can  const okBtn = docume
  const okB  const okBtn = document.createElement(  okB  okBt  okBtn.textConte  okBtn.sty  okBtn.style.padding = "  okBtn.sty  okBtn.style.background =   okBtn.st   okBtn.style.color =   okBtn.sty  okBtn.style.border = "1px solid  okBtn.sty  okBtn.style.borderRadiu  okBtn.sty   row.appendChild(cance  row.a  ro  row.appendChild(c  r  panel.  row.appendChi  pa  panel  panel.appendCh  p
  document.body.appendC  document.  d  // Button clicks
  cancelBtn.add  // But  cancelBtn  cancelBtn.addEventListener("click"      const    e.stopProp       hide        try { if (typeof c    hide();
    try { if (typeof cb === "func  okBtn.addEventListene  okB  });
  okBtn.addEventListener("click",     const    e.stopPro    hide();
    try { if (typeof c    hide();
    try { if (typeof cb === "func
  // Outside click cancels
  panel.addEventListener("click",   panel.a    if (e.target === panel) {
      const cb = _cancelCb;
      hide();
      try { if (typeof cb === "fun      try { if (typeof cb ===      e.stopPropagation();
    }
  });

  // Keyboard shortcuts (for acces  _panel = panel;
  retur
export fun
export function show(text, pos, onOk, onCancel) {
  const panel = ensurePanel();
  _okCb = onOk || null;
  _cancelCb = onCancel  // Updat
  // Update text
  try {
    const t = document.getElementById("confirm-text");
    if (t) t.textContent = text || "Are y  } catch (_) {}

  // Positi  // Position (optiona     try {
    const hasPos = pos && typeof pos === "object";
    const x = hasPos && typeof pos.x === "number" ? pos.x : undefined;
    const y = hasPos && typeof pos.y === "number" ? pos.y : undefined;
    if (typeof x === "number" && typeof y === "number") {
      const left = Math.max(10, Math.min(window.innerWidth - 300, Math.round(x)));
      
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
    const y = hasPos && typeof pos.y === "number" ? pos.y : undefined;     if (typeof x === "n  hide();
  try { if (typeof cb === "function") cb(); } catc
export fun
export function isOpen() {
  try { return !!(_panel && _panel.style.display !== "none"); } catch (_) { return 
import { a
import { attachGlobal } from "/utils/global.js";
attachGlobal("ConfirmModal", { show, hide, isOpen, cancel }); ""; // absolute position when pos provided
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
  const cb = _cancelCb;
  hide();
  try { if (typeof cb === "function") cb(); } catch (_) {}
}

export function isOpen() {
  try { return !!(_panel && _panel.style.display !== "none"); } catch (_) { return false; }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("ConfirmModal", { show, hide, isOpen, cancel });