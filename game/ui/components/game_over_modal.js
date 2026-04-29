/**
 * GameOverModal: Game Over panel split out from ui/ui.js
 *
 * Exports (ESM + window.GameOverModal):
 * - show(player, floor)
 * - hide()
 * - isOpen()
 */
function panel() {
  try { return document.getElementById("gameover-panel"); } catch (_) { return null; }
}
function summaryEl() {
  try { return document.getElementById("gameover-summary"); } catch (_) { return null; }
}

export function show(player, floor) {
  const p = panel();
  if (!p) return;
  try {
    const gold = (Array.isArray(player?.inventory) ? (player.inventory.find(i => i.kind === "gold")?.amount) : 0) || 0;
    const s = summaryEl();
    if (s) s.textContent = `You died on floor ${floor} (Lv ${player.level}). Gold: ${gold}. XP: ${player.xp}/${player.xpNext}.`;
  } catch (_) {}
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
attachGlobal("GameOverModal", { show, hide, isOpen });