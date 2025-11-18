/**
 * Encounter transitions (Phase 4 extraction): completing encounters and return to overworld.
 */
import { getMod } from "../../utils/access.js";
import { getCurrentQuestInstanceId, resetSessionFlags, getClearAnnounced, setClearAnnounced, getVictoryNotified, setVictoryNotified } from "./session_state.js";

export function complete(ctx, outcome = "victory") {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Reset guard for next encounter session
  resetSessionFlags();

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
  ctx.encounterInfo = null;
  return true;
}