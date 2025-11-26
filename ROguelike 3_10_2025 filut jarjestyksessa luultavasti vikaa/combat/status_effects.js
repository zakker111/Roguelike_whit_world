/**
 * Status effects: small, short-lived combat statuses.
 *
 * Exports (ESM + window.Status):
 * - applyLimpToEnemy(ctx, enemy, durationTurns)
 * - applyDazedToPlayer(ctx, durationTurns)
 * - applyBleedToEnemy(ctx, enemy, durationTurns)
 * - applyBleedToPlayer(ctx, durationTurns)
 * - applyInFlamesToEnemy(ctx, enemy, durationTurns)
 * - tick(ctx): per-turn updates (dazed, bleed, in-flames)
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

function getRng(ctx) {
  try {
    if (ctx && typeof ctx.rng === "function") return ctx.rng;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") {
      if (typeof window.RNG.getSeed !== "function" || window.RNG.getSeed() == null) {
        if (typeof window.RNG.autoInit === "function") window.RNG.autoInit();
      }
      return window.RNG.rng;
    }
  } catch (_) {}
  return Math.random;
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
    if (/ghost|spirit|wraith|skeleton/i.test(t)) return;
  } catch (_) {}
  const d = Math.max(1, duration | 0);
  enemy.bleedTurns = Math.max(enemy.bleedTurns || 0, d);
  try {
    ctx.log(`${Cap(ctx, enemy.type || "enemy")} starts bleeding (${enemy.bleedTurns}).`, "flavor", { category: "Combat", side: "enemy", tone: "bleed" });
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

// Moderate burning status: deals 1–1.5 damage per turn for the duration.
// Currently used for enemies when hit while the player is holding a torch.
export function applyInFlamesToEnemy(ctx, enemy, duration) {
  if (!ctx || !enemy) return;
  const d = Math.max(1, duration | 0);
  enemy.inFlamesTurns = Math.max(enemy.inFlamesTurns || 0, d);
  try {
    ctx.log(`${Cap(ctx, enemy.type || "enemy")} is engulfed in flames (${enemy.inFlamesTurns}).`, "warn", { category: "Combat", side: "enemy", tone: "fire" });
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
      try { ctx.log(`You bleed (1).`, "warn", { category: "Combat", side: "player", tone: "bleed" }); } catch (_) {}
    }
  }

  // Player in flames (not currently applied, but kept symmetric for future use)
  if (ctx.player && ctx.player.inFlamesTurns && ctx.player.inFlamesTurns > 0) {
    ctx.player.inFlamesTurns -= 1;
    const r = getRng(ctx);
    const dmg = 1 + (r() * 0.5); // 1–1.5, fractional is fine; UI rounds HP
    ctx.player.hp -= dmg;
    if (addDecal) {
      try { addDecal(ctx.player.x, ctx.player.y, 1.0); } catch (_) {}
    }
    if (ctx.player.hp <= 0) {
      ctx.player.hp = 0;
      if (typeof ctx.onPlayerDied === "function") ctx.onPlayerDied();
    } else {
      try { ctx.log(`You burn (${dmg.toFixed ? dmg.toFixed(1) : dmg}).`, "bad", { category: "Combat", side: "player", tone: "fire" }); } catch (_) {}
    }
  }

  // Enemies bleed / burn
  if (Array.isArray(ctx.enemies)) {
    const died = [];
    const r = getRng(ctx);
    for (const e of ctx.enemies) {
      // Ethereal foes do not bleed or burn
      let ethereal = false;
      try {
        const t = String(e.type || "");
        if (/ghost|spirit|wraith|skeleton/i.test(t)) {
          ethereal = true;
          e.bleedTurns = 0;
          e.inFlamesTurns = 0;
        }
      } catch (_) {}
      if (ethereal) continue;

      let dmgThisTick = 0;

      if (e.bleedTurns && e.bleedTurns > 0) {
        e.bleedTurns -= 1;
        e.hp -= 1;
        dmgThisTick += 1;
        if (addDecal) {
          try { addDecal(e.x, e.y, 1.0); } catch (_) {}
        }
        if (e.hp > 0) {
          try { ctx.log(`${Cap(ctx, e.type || "enemy")} bleeds (1).`, "flavor", { category: "Combat", side: "enemy", tone: "bleed" }); } catch (_) {}
        }
      }

      if (e.inFlamesTurns && e.inFlamesTurns > 0 && e.hp > 0) {
        e.inFlamesTurns -= 1;
        const burn = 1 + (r() * 0.5); // 1–1.5
        e.hp -= burn;
        dmgThisTick += burn;
        if (addDecal) {
          try { addDecal(e.x, e.y, 1.0); } catch (_) {}
        }
        if (e.hp > 0) {
          try { ctx.log(`${Cap(ctx, e.type || "enemy")} burns (${burn.toFixed ? burn.toFixed(1) : burn}).`, "warn", { category: "Combat", side: "enemy", tone: "fire" }); } catch (_) {}
        }
      }

      if (e.hp <= 0 && dmgThisTick > 0) {
        died.push(e);
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
    applyInFlamesToEnemy,
    tick
  };
}