import { hasUI } from "./shared.js";

export function showGameOver(ctx) {
  if (!hasUI()) return;
  try { window.UI.showGameOver && window.UI.showGameOver(ctx.player, ctx.floor); } catch (_) {}
}

export function hideGameOver(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideGameOver && window.UI.hideGameOver(); } catch (_) {}
}

export function showGod(ctx) {
  if (!hasUI()) return;
  try { window.UI.showGod && window.UI.showGod(); } catch (_) {}
}

export function hideGod(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideGod && window.UI.hideGod(); } catch (_) {}
}

export function isGodOpen() {
  try { return !!(hasUI() && window.UI.isGodOpen && window.UI.isGodOpen()); } catch (_) { return false; }
}

export function showHelp(ctx) {
  if (!hasUI()) return;
  try { window.UI.showHelp && window.UI.showHelp(ctx); } catch (_) {}
}

export function hideHelp(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideHelp && window.UI.hideHelp(); } catch (_) {}
}

export function isHelpOpen() {
  try { return !!(hasUI() && window.UI.isHelpOpen && window.UI.isHelpOpen()); } catch (_) { return false; }
}

export function showCharacter(ctx) {
  if (!hasUI()) return;
  try { window.UI.showCharacter && window.UI.showCharacter(ctx); } catch (_) {}
}

export function hideCharacter(ctx) {
  if (!hasUI()) return;
  try { window.UI.hideCharacter && window.UI.hideCharacter(); } catch (_) {}
}

export function isCharacterOpen() {
  try { return !!(hasUI() && window.UI.isCharacterOpen && window.UI.isCharacterOpen()); } catch (_) { return false; }
}
