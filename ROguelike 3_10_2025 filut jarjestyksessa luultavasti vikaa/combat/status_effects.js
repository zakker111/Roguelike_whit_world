/**
 * Status effects: small, short-lived combat statuses.
 *
 * Exports (ESM + window.Status):
 * - applyLimpToEnemy(ctx, enemy, durationTurns)
 * - applyDazedToPlayer(ctx, durationTurns)
 * - applyBleedToEnemy(ctx, enemy, durationTurns)
 * - applyBleedToPlayer(ctx, durationTurns)
 * - tick(ctx): per-turn updates (dazed, bleed)
 *
 * Notes:
 * - Limp is applied to enemies by setting enemy.immobileTurns (AI respects it).
 * - Dazed is applied to the player by setting ctx.player.dazedTurns; the player's action checks this and may skip a turn.
 * - Bleed applies 1 damage per turn and can kill; leaves a blood decal if available (ctx.addBloodDecal).
 */

function Cap(ctx, s) {
  const cap = (ctx && ctx.utils && typeof ctx.utils.capitalize === "function")
    ? ctx.utils.capitalize
    : (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  return cap(s);
}

export function applyLimpToEnemy(ctx, enemy, duration) {
  if (!enemy) return;
  const d = Math.max(1, duration | 0);
  enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, d);
  try {
    ctx.log(`${Cap(ctx, enemy.type || "enemy")} staggers; its legs are crippled and it can't move for ${d} turn${d > 1 ? "s" : ""}.`, "notice");
  } catch (_) {}
}

export function applyDazedToPlayer(ctx, duration) {
  if (!ctx || !ctx.player) return;
  const d = Math.max(1, duration | 0);
  ctx.player.dazedTurns = Math.max(ctx.player.dazedTurns || 0, d);
  try {
    ctx.log(`You are dazed and might lose your next action${d > 1 ? "s" : ""}.`, "warn");
  } catch (_) {}
}

export function applyBleedToEnemy(ctx, enemy, duration) {
  if (!ctx || !enemy) return;
  // Ethereal foes (ghosts/spirits/wraiths) do not bleed
  try {
    const t = String(enemy.type || "");
    if (/ghost|spirit|wraith/i.test(t)) return;
  } catch (_) {}
  const d = Math.max(1, duration | 0);
  enemy.bleedTurns = Math.max(enemy.bleedTurns || 0, d);
  try {
    ctx.log(`${Cap(ctx, enemy.type || "enemy")} starts bleeding (${enemy.bleedTurns}).`, "flavor");
  } catch (_) {}
}

export function applyBleedToPlayer(ctx, duration) {
  if (!ctx || !ctx.player) return;
  const d = Math.max(1, duration | 0);
  ctx.player.bleedTurns = Math.max(ctx.player.bleedTurns || 0, d);
  try {
    ctx.log(`You are bleeding (${ctx.player.bleedTurns}).`, "warn");
  } catch (_) {}
}

export function tick(ctx) {
  if (!ctx) return;
  const addDecal = typeof ctx.addBloodDecal === "function" ? ctx.addBloodDecal : null;

  // Player dazed
  if (ctx.player && ctx.player.dazedTurns && ctx.player.dazedTurns > 0) {
    ctx.player.dazedTurns -= 1;
    if (ctx.player.dazedTurns < 0) ctx.player.dazedTurns = 0;
  }

  // Player bleed
  if (ctx.player && ctx.player.bleedTurns && ctx.player.bleedTurns > 0) {
    ctx.player.bleedTurns -= 1;
    // 1 damage per tick
    ctx.player.hp -= 1;
    if (addDecal) {
      try { addDecal(ctx.player.x, ctx.player.y, 1.0); } catch (_) {}
    }
    if (ctx.player.hp <= 0) {
      ctx.player.hp = 0;
      if (typeof ctx.onPlayerDied === "function") ctx.onPlayerDied();
    } else {
      try { ctx.log(`You bleed (1).`, "warn"); } catch (_) {}
    }
  }

  // Enemies bleed
  if (Array.isArray(ctx.enemies)) {
    const died = [];
    for (const e of ctx.enemies) {
      // Ethereal foes do not bleed
      try {
        const t = String(e.type || "");
        if (/ghost|spirit|wraith/i.test(t)) { e.bleedTurns = 0; continue; }
      } catch (_) {}
      if (e.bleedTurns && e.bleedTurns > 0) {
        e.bleedTurns -= 1;
        e.hp -= 1;
        if (addDecal) {
          try { addDecal(e.x, e.y, 1.0); } catch (_) {}
        }
        if (e.hp <= 0) {
          died.push(e);
        } else {
          try { ctx.log(`${Cap(ctx, e.type || "enemy")} bleeds (1).`, "flavor"); } catch (_) {}
        }
      }
    }
    if (died.length && typeof ctx.onEnemyDied === "function") {
      for (const e of died) ctx.onEnemyDied(e);
    }
  }
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Status = {
    applyLimpToEnemy,
    applyDazedToPlayer,
    applyBleedToEnemy,
    applyBleedToPlayer,
    tick
  };
}