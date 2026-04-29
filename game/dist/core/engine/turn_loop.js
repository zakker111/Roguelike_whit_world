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

import { getMod } from "../../utils/access.js";

function nowMs() {
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      return performance.now();
    }
  } catch (_) {
    return Date.now();
  }
  return Date.now();
}

function shouldLogWorldTurnPerf(dtMs) {
  if (dtMs >= 8) return true;
  try {
    if (typeof window !== "undefined" && window.DEV) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("DEV") === "1") return true;
  } catch (_) {
    return false;
  }
  return false;
}

function logWorldTurnPerf(details) {
  try {
    if (!shouldLogWorldTurnPerf(details.dtMs)) return;
    const LG = (typeof window !== "undefined") ? window.Logger : null;
    const message = `[TurnLoop] world total=${details.dtMs.toFixed(1)}ms worldRuntime=${details.worldRuntimeMs.toFixed(1)}ms status=${details.statusMs.toFixed(1)}ms gm=${details.gmMs.toFixed(1)}ms sync=${details.syncMs.toFixed(1)}ms`;
    if (LG && typeof LG.log === "function") {
      LG.log(message, "notice", Object.assign({ category: "TurnLoop", perf: "world-turn" }, details));
    } else if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(message, details);
    }
  } catch (_) {}
}

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
  const isWorld = ctx.mode === "world";
  const t0 = isWorld ? nowMs() : 0;
  let worldRuntimeMs = 0;
  let statusMs = 0;
  let gmMs = 0;
  let syncMs = 0;

  // Injury healing: healable injuries tick down and disappear when reaching 0
  try {
    const player = ctx.player || null;
    let anyChanged = false;

    // Player injuries
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
      if (changed) anyChanged = true;
    }

    // Follower injuries (mirror player injury behavior on their records)
    if (player && Array.isArray(player.followers) && player.followers.length) {
      for (let i = 0; i < player.followers.length; i++) {
        const f = player.followers[i];
        if (!f || !Array.isArray(f.injuries) || !f.injuries.length) continue;
        let changedF = false;
        f.injuries = f.injuries.map((inj) => {
          if (!inj) return null;
          if (typeof inj === "string") {
            const name = inj;
            const permanent = /scar|missing finger/i.test(name);
            return { name, healable: !permanent, durationTurns: permanent ? 0 : 40 };
          }
          if (inj.healable && (inj.durationTurns | 0) > 0) {
            inj.durationTurns = (inj.durationTurns | 0) - 1;
            changedF = true;
          }
          return (inj.healable && inj.durationTurns <= 0) ? null : inj;
        }).filter(Boolean);
        if (changedF) anyChanged = true;
      }
    }

    if (anyChanged) {
      try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    }
  } catch (_) {}

  // Mode-specific progression
  try {
    if (ctx.mode === "dungeon" || ctx.mode === "sandbox") {
      const DR = modHandle(ctx, "DungeonRuntime");
      if (DR && typeof DR.tick === "function") DR.tick(ctx);
    } else if (ctx.mode === "town") {
      const TR = modHandle(ctx, "TownRuntime");
      if (TR && typeof TR.tick === "function") TR.tick(ctx);
    } else if (ctx.mode === "world") {
      const WR = modHandle(ctx, "WorldRuntime");
      if (WR && typeof WR.tick === "function") {
        const t = isWorld ? nowMs() : 0;
        WR.tick(ctx);
        if (isWorld) worldRuntimeMs = nowMs() - t;
      }
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
      const t = isWorld ? nowMs() : 0;
      ST.tick(ctx);
      if (isWorld) statusMs = nowMs() - t;
    }
  } catch (_) {}

  // GM runtime (Phase 0–1: read-only, ctx.gm-only updates; no gameplay side effects)
  try {
    const GM = modHandle(ctx, "GMRuntime");
    if (GM && typeof GM.tick === "function") {
      const t = isWorld ? nowMs() : 0;
      GM.tick(ctx);
      if (isWorld) gmMs = nowMs() - t;
    }
  } catch (_) {}

  // Visual updates via StateSync (mandatory)
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      const t = isWorld ? nowMs() : 0;
      SS.applyAndRefresh(ctx, {});
      if (isWorld) syncMs = nowMs() - t;
    }
  } catch (_) {}

  if (isWorld) {
    logWorldTurnPerf({
      dtMs: nowMs() - t0,
      worldRuntimeMs,
      statusMs,
      gmMs,
      syncMs
    });
  }

  // If external modules mutated ctx.mode/map (e.g., EncounterRuntime.complete), orchestrator may re-sync.
  return true;
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("TurnLoop", { tick });
