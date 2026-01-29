/**
 * Dungeon tick (Phase 3 extraction): per-turn processing in dungeon/encounter.
 */
export function tick(ctx) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter" && ctx.mode !== "sandbox")) return false;
  // Enemies act via AI
  try {
    const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
    if (AIH && typeof AIH.enemiesAct === "function") {
      AIH.enemiesAct(ctx);
    }
  } catch (_) {}
  // Ensure occupancy reflects enemy movement/deaths this turn
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}
  // Status effects tick (bleed, dazed, etc.)
  try {
    const ST = ctx.Status || (typeof window !== "undefined" ? window.Status : null);
    if (ST && typeof ST.tick === "function") {
      ST.tick(ctx);
    }
  } catch (_) {}

  // Cleanup: if any enemy died from status effects this turn, handle corpse + flavor
  try {
    const list = Array.isArray(ctx.enemies) ? ctx.enemies.slice(0) : [];
    for (const enemy of list) {
      if (!enemy) continue;
      if (typeof enemy.hp === "number" && enemy.hp <= 0) {
        // Ensure last-hit meta indicates status-based kill if none recorded
        if (!enemy._lastHit) {
          enemy._lastHit = { by: "status", part: "torso", crit: false, dmg: 0, weapon: null, via: "bleed" };
        }
        if (typeof ctx.onEnemyDied === "function") {
          ctx.onEnemyDied(enemy);
        } else {
          // Fallback removal
          try {
            const loot = (ctx.Loot && typeof ctx.Loot.generate === "function") ? (ctx.Loot.generate(ctx, enemy) || []) : [];
            ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
            ctx.corpses.push({ x: enemy.x, y: enemy.y, loot, looted: loot.length === 0, meta: null });
          } catch (_) {}
          try {
            ctx.enemies = ctx.enemies.filter(e => e !== enemy);
            if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") ctx.occupancy.clearEnemy(enemy.x, enemy.y);
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  // Visual: decals fade each turn
  try {
    const DC = ctx.Decals || (typeof window !== "undefined" ? window.Decals : null);
    if (DC && typeof DC.tick === "function") {
      DC.tick(ctx);
    } else if (Array.isArray(ctx.decals) && ctx.decals.length) {
      for (let i = 0; i < ctx.decals.length; i++) {
        ctx.decals[i].a *= 0.92;
      }
      ctx.decals = ctx.decals.filter(d => d.a > 0.04);
    }
  } catch (_) {}
  // End of turn: brace stance lasts only for this enemy round
  try {
    if (ctx.player && typeof ctx.player.braceTurns === "number" && ctx.player.braceTurns > 0) {
      ctx.player.braceTurns = 0;
    }
  } catch (_) {}
  // Clamp corpse list length
  try {
    if (Array.isArray(ctx.corpses) && ctx.corpses.length > 50) {
      ctx.corpses = ctx.corpses.slice(-50);
    }
  } catch (_) {}
  return true;
}