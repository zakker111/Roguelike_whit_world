/**
 * LootPanel: Loot list modal extracted from ui/ui.js
 *
 * Exports (ESM + window.LootPanel):
 * - init()
 * - show(list)
 * - hide()
 * - isOpen()
 */
function panel() {
  try { return document.getElementById("loot-panel"); } catch (_) { return null; }
}
function listEl() {
  try { return document.getElementById("loot-list"); } catch (_) { return null; }
}

let _bound = false;

export function init() {
  // Bind click-to-close once
  try {
    const p = panel();
    if (p && !_bound) {
      p.addEventListener("click", () => {
        try { hide(); } catch (_) {}
      });
      _bound = true;
    }
  } catch (_) {}
}

export function show(list) {
  const p = panel();
  const listNode = listEl();
  if (!p || !listNode) return;
  listNode.innerHTML = "";
  (list || []).forEach((name) => {
    const li = document.createElement("li");
    li.textContent = String(name || "");
    listNode.appendChild(li);
  });
  p.hidden = false;
}

export function hide() {
  const p = panel();
  if (p) p.hidden = true;
}

export function isOpen() {
  const p = panel();
  return !!(p && !p.hidden);
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("LootPanel", { init, show, hide, isOpen });