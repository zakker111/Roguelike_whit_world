/**
 * TurnLoop: centralized per-turn processing using ctx-first handles.
 *
 * Exports (ESM + window.TurnLoop):
 * - tick(ctx): advances game state by one turn (without local perf timing)
 *
 * Notes:
 * - This module is ctx-first and does not rely on core/game.js globals.
 * - It prefers ctx.* handles and falls back to window.* when necessary.
 * - Orchestrator remains responsible for perf timing and final sync.
 */

function modHandle(ctx, name) {
  try {
    if (ctx && ctx[name]) return ctx[name];
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window[name]) return window[name];
  } catch (_) {}
  return null;
}

export function tick(ctx) {
  if (!ctx) return true;

  // Injury healing: healable injuries tick down and disappear when reaching 0
  try {
    const player = ctx.player || null;
    if (player && Array.isArray(player.injuries) && player.injuries.length) {
      let changed = false;
      player.injuries = player.injuries.map((inj) => {
        if (!inj) return null;
        if (typeof inj === "string") {
          // Convert legacy string format to object
          const name = inj;
          const permanent = /scar|missing finger/i.test(name);
          return { name, healable: !permanent, durationTurns: permanent ? 0 : 40 };
        }
        if (inj.healable && (inj.durationTurns | 0) > 0) {
          inj.durationTurns = (inj.durationTurns | 0) - 1;
          changed = true;
        }
        return (inj.healable && inj.durationTurns <= 0) ? null : inj;
      }).filter(Boolean);
      if (changed) {
        try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
      }
    }
  } catch (_) {}

  // Mode-specific progression
  try {
    if (ctx.mode === "dungeon") {
      const DR = modHandle(ctx, "DungeonRuntime");
      if (DR && typeof DR.tick === "function") DR.tick(ctx);
    } else if (ctx.mode === "town") {
      const TR = modHandle(ctx, "TownRuntime");
      if (TR && typeof TR.tick === "function") TR.tick(ctx);
    } else if (ctx.mode === "world") {
      const WR = modHandle(ctx, "WorldRuntime");
      if (WR && typeof WR.tick === "function") WR.tick(ctx);
    } else if (ctx.mode === "encounter") {
      const ER = modHandle(ctx, "EncounterRuntime");
      if (ER && typeof ER.tick === "function") {
        ER.tick(ctx);
        // Merge enemy/corpse/decals mutations synced through callbacks if orchestrator keeps separate refs
        try {
          const enemies = ctx.enemies || [];
          const corpses = ctx.corpses || [];
          const decals = ctx.decals || [];
          ctx.enemies = Array.isArray(enemies) ? enemies : (ctx.enemies || []);
          ctx.corpses = Array.isArray(corpses) ? corpses : (ctx.corpses || []);
          ctx.decals = Array.isArray(decals) ? decals : (ctx.decals || []);
        } catch (_) {}
      }
    } else if (ctx.mode === "region") {
      const RM = modHandle(ctx, "RegionMapRuntime");
      if (RM && typeof RM.tick === "function") RM.tick(ctx);
    }
  } catch (_) {}

  // Global status effects (bleed, dazed)
  try {
    const ST = modHandle(ctx, "Status");
    if (ST && typeof ST.tick === "function") {
      ST.tick(ctx);
    }
  } catch (_) {}

  // Visual updates via StateSync (mandatory)
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  // If external modules mutated ctx.mode/map (e.g., EncounterRuntime.complete), orchestrator may re-sync.
  return true;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("TurnLoop", { tick });