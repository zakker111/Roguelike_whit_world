/**
 * Encounter tick (Phase 4 extraction): reuse dungeon tick and manage objectives and session flags.
 */
import { getVictoryNotified, setVictoryNotified, getClearAnnounced, setClearAnnounced, getCurrentQuestInstanceId } from "./session_state.js";

export function tick(ctx) {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Reuse DungeonRuntime.tick so AI/status/decals behave exactly like dungeon mode
  try {
    const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
    if (DR && typeof DR.tick === "function") {
      DR.tick(ctx);
    } else {
      const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
      if (AIH && typeof AIH.enemiesAct === "function") AIH.enemiesAct(ctx);
    }
  } catch (_) {}

  // Objectives processing (non-blocking; does not auto-exit)
  try {
    const obj = ctx.encounterObjective || null;
    if (obj && obj.status !== "success") {
      const here = (ctx.inBounds && ctx.inBounds(ctx.player.x, ctx.player.y)) ? ctx.map[ctx.player.y][ctx.player.x] : null;
      if (obj.type === "surviveTurns" && typeof obj.turnsRemaining === "number") {
        obj.turnsRemaining = Math.max(0, (obj.turnsRemaining | 0) - 1);
        if (obj.turnsRemaining === 0) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: You survived. Step onto an exit (>) to leave.", "good");
        } else {
          if ((obj.turnsRemaining % 3) === 0) {
            ctx.log && ctx.log(`Survive ${obj.turnsRemaining} more turn(s)...`, "info");
          }
        }
      } else if (obj.type === "reachExit") {
        if (here === ctx.TILES.STAIRS) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: Reached exit. Press G to leave.", "good");
        }
      } else if (obj.type === "rescueTarget") {
        const rescued = !!obj.rescued;
        if (!rescued && obj.target && obj.target.x === ctx.player.x && obj.target.y === ctx.player.y) {
          obj.rescued = true;
          ctx.log && ctx.log("You free the captive! Now reach an exit (>) to leave.", "good");
        } else if (rescued && here === ctx.TILES.STAIRS) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: Escorted the captive to safety.", "good");
        }
      }
    }
  } catch (_) {}

  // Clear announcement + proactive quest victory notification
  try {
    if (Array.isArray(ctx.enemies) && ctx.enemies.length === 0) {
      if (!getClearAnnounced()) {
        setClearAnnounced(true);
        try { ctx.log && ctx.log("Area clear. Step onto an exit (>) to leave when ready.", "info"); } catch (_) {}
      }
      if (!getVictoryNotified()) {
        setVictoryNotified(true);
        try {
          const QS = ctx.QuestService || (typeof window !== "undefined" ? window.QuestService : null);
          const qid = ctx._questInstanceId || getCurrentQuestInstanceId() || null;
          if (QS && typeof QS.onEncounterComplete === "function" && qid) {
            QS.onEncounterComplete(ctx, { questInstanceId: qid, enemiesRemaining: 0 });
          }
        } catch (_) {}
      }
    } else {
      setClearAnnounced(false);
      setVictoryNotified(false);
    }
  } catch (_) {}
  return true;
}