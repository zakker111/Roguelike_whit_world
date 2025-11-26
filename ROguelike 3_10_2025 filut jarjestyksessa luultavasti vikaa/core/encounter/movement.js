/**
 * Encounter movement (Phase 4 extraction): reuse Dungeon movement/attack, with encounter rules.
 */
import { getMod } from "../../utils/access.js";

export function tryMoveEncounter(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "encounter") return false;
  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!(ctx.inBounds && ctx.inBounds(nx, ny))) return false;

  // If bumping into a caravan master (merchant prop), step onto them and open the escort dialog instead of attacking.
  try {
    const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : [];
    if (props.length) {
      const p = props.find(pr => pr && pr.x === nx && pr.y === ny && String(pr.type || "").toLowerCase() === "merchant");
      if (p && String(p.vendor || "").toLowerCase() === "caravan") {
        // Move player onto the Caravan master tile
        ctx.player.x = nx;
        ctx.player.y = ny;
        try {
          const SS = ctx.StateSync || getMod(ctx, "StateSync");
          if (SS && typeof SS.applyAndRefresh === "function") {
            SS.applyAndRefresh(ctx, {});
          }
        } catch (_) {}
        // Trigger the generic encounter interaction (will show escort/continue dialog for caravan masters)
        try {
          const EI = ctx.EncounterInteractions || (typeof window !== "undefined" ? window.EncounterInteractions : null);
          if (EI && typeof EI.interactHere === "function") {
            EI.interactHere(ctx);
          }
        } catch (_) {}
        return true;
      }
    }
  } catch (_) {}

  // Prefer to reuse DungeonRuntime movement/attack so encounters behave exactly like dungeon
  const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
  if (DR && typeof DR.tryMoveDungeon === "function") {
    const ok = !!DR.tryMoveDungeon(ctx, dx, dy); // does not call ctx.turn() in encounter mode
    if (ok) {
      // No auto-exit on stairs; exiting requires pressing G on the exit tile.
      return true;
    }
    // If DR didn't handle, fall through to minimal fallback below
  }

  // Fallback attack if enemy occupies target (shared combat pipeline only)
  let enemy = null;
  try { enemy = Array.isArray(ctx.enemies) ? ctx.enemies.find(e => e && e.x === nx && e.y === ny) : null; } catch (_) { enemy = null; }
  if (enemy) {
    const C = ctx.Combat || (typeof window !== "undefined" ? window.Combat : null);
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
    } else {
      const msg = "ERROR: Combat.playerAttackEnemy missing; combat fallback path would be used (encounter).";
      try { ctx.log && ctx.log(msg, "bad"); } catch (_) {}
      try { console.error(msg); } catch (_) {}
    }
    return true;
  }

  // Fallback movement (no auto-exit)
  const walkable = (ctx.isWalkable ? ctx.isWalkable(nx, ny) : true);
  const blocked = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
  if (walkable && !blocked) {
    ctx.player.x = nx; ctx.player.y = ny;
    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    return true;
  }
  return false;
}