/**
 * Dungeon movement and combat (Phase 3 extraction): tryMoveDungeon.
 */
import { getMod } from "../../utils/access.js";
import { maybeEnterMountainPass } from "./transitions.js";

export function tryMoveDungeon(ctx, dx, dy) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter")) return false;
  const advanceTurn = (ctx.mode === "dungeon"); // in encounter, the orchestrator advances the turn after syncing

  // Dazed: skip action if dazedTurns > 0
  try {
    if (ctx.player && ctx.player.dazedTurns && ctx.player.dazedTurns > 0) {
      ctx.player.dazedTurns -= 1;
      ctx.log && ctx.log("You are dazed and lose your action this turn.", "warn");
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  // Special: stepping on a mountain-pass portal (if present) transfers to a dungeon across the mountain
  try {
    if (maybeEnterMountainPass(ctx, nx, ny)) return true;
  } catch (_) {}

  // Is there an enemy at target tile?
  let enemy = null;
  try {
    const enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
    enemy = enemies.find(e => e && e.x === nx && e.y === ny) || null;
  } catch (_) { enemy = null; }

  if (enemy) {
    // Use shared Combat.playerAttackEnemy so dungeon/encounter attacks go through the
    // unified combat pipeline (crit, bleed/limp, torch fire, GOD status effects, etc.).
    const C = (ctx && ctx.Combat) || (typeof window !== "undefined" ? window.Combat : null);
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
    }
    if (advanceTurn && ctx.turn) ctx.turn();
    return true;
  }

  // Movement into empty tile
  try {
    const blockedByEnemy = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
    const walkable = ctx.inBounds(nx, ny) && (ctx.map[ny][nx] === ctx.TILES.FLOOR || ctx.map[ny][nx] === ctx.TILES.DOOR || ctx.map[ny][nx] === ctx.TILES.STAIRS);
    if (walkable && !blockedByEnemy) {
      ctx.player.x = nx; ctx.player.y = ny;
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  return false;
}