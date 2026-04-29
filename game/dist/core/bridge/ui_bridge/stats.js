import { hasUI } from "./shared.js";

export function updateStats(ctx) {
  if (!hasUI() || typeof window.UI.updateStats !== "function") return;

  const atk = function () {
    try {
      return (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : (ctx.player.atk || 1);
    } catch (_) {
      return ctx.player && ctx.player.atk || 1;
    }
  };

  const def = function () {
    try {
      return (typeof ctx.getPlayerDefense === "function") ? ctx.getPlayerDefense() : 0;
    } catch (_) {
      return 0;
    }
  };

  const perf = (typeof ctx.getPerfStats === "function") ? ctx.getPerfStats() : null;
  const weather = (ctx && ctx.weather) ? ctx.weather : null;

  try {
    window.UI.updateStats(ctx.player, ctx.floor, atk, def, ctx.time, perf, weather, ctx);
  } catch (_) {}
}
