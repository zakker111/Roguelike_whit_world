/**
 * Encounter transitions (Phase 4 extraction): completing encounters and return to overworld.
 */
import { getMod } from "../../utils/access.js";
import { getCurrentQuestInstanceId, resetSessionFlags, getClearAnnounced, setClearAnnounced, getVictoryNotified, setVictoryNotified } from "./session_state.js";

/**
 * Auto-escort travel: after resolving a caravan ambush encounter and choosing to continue
 * guarding the caravan, automatically advance overworld turns with a small delay so the
 * caravan (and player) visibly travel toward their destination.
 */
function startEscortAutoTravel(ctx) {
  try {
    if (!ctx || !ctx.world) return;
    const world = ctx.world;
    // Guard against multiple concurrent auto-travel loops.
    world._escortAutoTravel = world._escortAutoTravel || { running: false };
    const state = world._escortAutoTravel;
    if (state.running) return;
    state.running = true;

    let steps = 0;
    const maxSteps = 2000; // safety cap
    const delayMs = 140;

    function step() {
      try {
        const w = ctx.world;
        if (!w) { state.running = false; return; }
        const escort = w.caravanEscort;
        // Stop if escort job ended or mode changed away from world.
        if (!escort || !escort.active || ctx.mode !== "world") {
          state.running = false;
          return;
        }
        // Advance one global turn (WorldRuntime.tick will move caravans and player with them).
        if (typeof ctx.turn === "function") ctx.turn();
      } catch (_) {}
      steps++;
      if (steps >= maxSteps) { state.running = false; return; }
      setTimeout(step, delayMs);
    }

    setTimeout(step, delayMs);
  } catch (_) {}
}

export function complete(ctx, outcome = "victory") {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Reset guard for next encounter session
  resetSessionFlags();
  // Capture encounter id before we clear encounterInfo so we can trigger escort flows.
  const encounterId = String(ctx.encounterInfo && ctx.encounterInfo.id || "").toLowerCase();

  // Return to the overworld
  ctx.mode = "world";
  if (ctx.world && ctx.world.map) {
    ctx.map = ctx.world.map;
    const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    if (Array.isArray(ctx.world.seenRef) && Array.isArray(ctx.world.visibleRef)) {
      ctx.seen = ctx.world.seenRef;
      ctx.visible = ctx.world.visibleRef;
    } else {
      ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(false));
      ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(false));
      try {
        if (typeof ctx.inBounds === "function" && ctx.inBounds(ctx.player.x, ctx.player.y)) {
          ctx.seen[ctx.player.y][ctx.player.x] = true;
          ctx.visible[ctx.player.y][ctx.player.x] = true;
        }
      } catch (_) {}
    }
  }
  try {
    const pos = ctx.worldReturnPos || null;
    if (pos && typeof pos.x === "number" && typeof pos.y === "number" && ctx.world) {
      const rx = pos.x | 0, ry = pos.y | 0;
      const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
      if (WR && typeof WR.ensureInBounds === "function") {
        ctx._suspendExpandShift = true;
        try {
          let lx = rx - (ctx.world.originX | 0);
          let ly = ry - (ctx.world.originY | 0);
          WR.ensureInBounds(ctx, lx, ly, 32);
        } finally {
          ctx._suspendExpandShift = false;
        }
        const lx2 = rx - (ctx.world.originX | 0);
        const ly2 = ry - (ctx.world.originY | 0);
        ctx.player.x = lx2; ctx.player.y = ly2;
      } else {
        const lx = rx - (ctx.world.originX | 0);
        const ly = ry - (ctx.world.originY | 0);
        const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
        const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
        ctx.player.x = Math.max(0, Math.min((cols ? cols - 1 : 0), lx));
        ctx.player.y = Math.max(0, Math.min((rows ? rows - 1 : 0), ly));
      }
    }
  } catch (_) {}

  // If the player chose to travel with a caravan (escort.active), snap them onto that caravan
  // on returning to the overworld so following starts immediately.
  try {
    const world = ctx.world || null;
    const escort = world && world.caravanEscort;
    if (world && escort && escort.active && Array.isArray(world.caravans) && world.caravans.length) {
      const caravans = world.caravans;
      let cv = null;

      // Prefer the caravan whose id matches escort.id
      if (typeof escort.id !== "undefined" && escort.id !== null) {
        cv = caravans.find(c => c && c.id === escort.id) || null;
      }

      // Fallback: if no id match, attach to the closest caravan to the player
      if (!cv) {
        const baseWx = (world.originX | 0) + (ctx.player.x | 0);
        const baseWy = (world.originY | 0) + (ctx.player.y | 0);
        let best = null;
        let bestDist = Infinity;
        for (const c of caravans) {
          if (!c) continue;
          const dx = (c.x | 0) - baseWx;
          const dy = (c.y | 0) - baseWy;
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < bestDist) {
            bestDist = dist;
            best = c;
          }
        }
        cv = best;
        if (cv && typeof cv.id !== "undefined") {
          escort.id = cv.id;
        }
      }

      if (cv) {
        const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
        const wx = cv.x | 0;
        const wy = cv.y | 0;
        if (WR && typeof WR.ensureInBounds === "function") {
          ctx._suspendExpandShift = true;
          try {
            let lx = wx - (world.originX | 0);
            let ly = wy - (world.originY | 0);
            WR.ensureInBounds(ctx, lx, ly, 32);
          } finally {
            ctx._suspendExpandShift = false;
          }
        }
        const lx2 = wx - (world.originX | 0);
        const ly2 = wy - (world.originY | 0);
        const rows2 = Array.isArray(ctx.map) ? ctx.map.length : 0;
        const cols2 = rows2 && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
        if (lx2 >= 0 && ly2 >= 0 && lx2 < cols2 && ly2 < rows2) {
          ctx.player.x = lx2;
          ctx.player.y = ly2;
        }
      }
    }
  } catch (_) {}
  try {
    if (outcome === "victory") ctx.log && ctx.log("You prevail and return to the overworld.", "good");
    else ctx.log && ctx.log("You withdraw and return to the overworld.", "info");
  } catch (_) {}
  try {
    const QS = ctx.QuestService || (typeof window !== "undefined" ? window.QuestService : null);
    if (QS && typeof QS.onEncounterComplete === "function") {
      const enemiesRemaining = Array.isArray(ctx.enemies) ? (ctx.enemies.length | 0) : 0;
      const qid = ctx._questInstanceId || getCurrentQuestInstanceId() || null;
      QS.onEncounterComplete(ctx, { questInstanceId: qid, enemiesRemaining });
    }
  } catch (_) {}
  try { ctx._questInstanceId = null; } catch (_) {}
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  // If we just resolved a caravan ambush and an escort job is active, auto-run
  // overworld turns so the caravan visibly travels with the player.
  try {
    const world = ctx.world || null;
    const escort = world && world.caravanEscort;
    if (encounterId === "caravan_ambush" && world && escort && escort.active) {
      startEscortAutoTravel(ctx);
    }
  } catch (_) {}

  ctx.encounterInfo = null;
  return true;
}