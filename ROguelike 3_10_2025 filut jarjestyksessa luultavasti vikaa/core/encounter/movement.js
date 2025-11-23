/**
 * Encounter movement (Phase 4 extraction): reuse Dungeon movement/attack, with encounter rules.
 */
import { getMod } from "../../utils/access.js";

export function tryMoveEncounter(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "encounter") return false;
  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!(ctx.inBounds && ctx.inBounds(nx, ny))) return false;

  // If bumping into a caravan master (merchant prop), open the escort dialog instead of moving/attacking.
  try {
    const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : [];
    if (props.length) {
      const p = props.find(pr => pr && pr.x === nx && pr.y === ny && String(pr.type || "").toLowerCase() === "merchant");
      if (p) {
        const EI = ctx.EncounterInteractions || (typeof window !== "undefined" ? window.EncounterInteractions : null);
        if (EI && typeof EI.interactHere === "function") {
          EI.interactHere(ctx);
          return true;
        }
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

  // Fallback attack if enemy occupies target
  let enemy = null;
  try { enemy = Array.isArray(ctx.enemies) ? ctx.enemies.find(e => e && e.x === nx && e.y === ny) : null; } catch (_) { enemy = null; }
  if (enemy) {
    const C = ctx.Combat || (typeof window !== "undefined" ? window.Combat : null);
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
      return true;
    }
    try {
      const loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
      const blockChance = (typeof ctx.getEnemyBlockChance === "function") ? ctx.getEnemyBlockChance(enemy, loc) : 0;
      const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
      const rfn = (RU && typeof RU.getRng === "function")
        ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((typeof ctx.rng === "function") ? ctx.rng : null);
      const didBlock = (RU && typeof RU.chance === "function" && typeof rfn === "function")
        ? RU.chance(blockChance, rfn)
        : ((typeof rfn === "function") ? (rfn() < blockChance) : (0.5 < blockChance));
      if (didBlock) {
        ctx.log && ctx.log(`${(enemy.type || "enemy")} blocks your attack.`, "block");
      } else {
        const atk = (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : 1;
        const dmg = Math.max(0.1, Math.round(atk * 10) / 10);
        enemy.hp -= dmg;
        ctx.log && ctx.log(`You hit the ${(enemy.type || "enemy")} for ${dmg}.`);
        if (enemy.hp <= 0 && typeof ctx.onEnemyDied === "function") ctx.onEnemyDied(enemy);
      }
    } catch (_) {}
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