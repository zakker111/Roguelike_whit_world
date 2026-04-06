/**
 * WorldHints: lightweight wildlife hint logic for overworld.
 * Keeps its own cooldown state; callable from game orchestrator.
 */
export function maybeEmitOverworldAnimalHint(ctx, turnCounter) {
  try {
    if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return;
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    const WT = W ? W.TILES : null;
    if (!WT) return;
    const tHere = ctx.world.map[ctx.player.y] && ctx.world.map[ctx.player.y][ctx.player.x];

    // Only hint on wild-ish tiles
    const onWild = (tHere === WT.FOREST || tHere === WT.GRASS || tHere === WT.BEACH || tHere === WT.SWAMP);
    if (!onWild) { state._wildNoHintTurns = 0; return; }

    // Respect a cooldown to avoid log spam
    const MIN_TURNS_BETWEEN_HINTS = 12;
    if ((turnCounter - state.lastAnimalHintTurn) < MIN_TURNS_BETWEEN_HINTS) { state._wildNoHintTurns++; return; }

    // Skip if this tile has been fully cleared in Region Map
    try {
      const RM = (typeof window !== "undefined" ? window.RegionMapRuntime : null);
      if (RM && typeof RM.animalsClearedHere === "function") {
        if (RM.animalsClearedHere(ctx.player.x | 0, ctx.player.y | 0)) { state._wildNoHintTurns = 0; return; }
      }
    } catch (_) {}

    // Biome-weighted chance
    let base =
      (tHere === WT.FOREST) ? 0.55 :
      (tHere === WT.GRASS)  ? 0.35 :
      (tHere === WT.BEACH)  ? 0.20 :
      (tHere === WT.SWAMP)  ? 0.25 : 0.0;

    // Survivalism slightly increases hint chance (up to +5%)
    try {
      const s = (ctx.player && ctx.player.skills) ? ctx.player.skills : null;
      if (s) {
        const survBuff = Math.max(0, Math.min(0.05, Math.floor((s.survivalism || 0) / 25) * 0.01));
        base = Math.min(0.80, base * (1 + survBuff));
      }
    } catch (_) {}

    // Pity: if we've been on wild tiles a long time without a hint, force one
    const PITY_TURNS = 40;
    const force = (state._wildNoHintTurns >= PITY_TURNS);

    let success = false;
    if (force) {
      success = true;
    } else if (base > 0) {
      try {
        const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
        const rfn = (RU && typeof RU.getRng === "function")
          ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
          : ((typeof ctx.rng === "function") ? ctx.rng : null);
        if (RU && typeof RU.chance === "function" && typeof rfn === "function") {
          success = !!RU.chance(base, rfn);
        } else {
          success = (typeof rfn === "function") ? (rfn() < base) : (0.5 < base);
        }
      } catch (_) {
        const rfn = (typeof ctx.rng === "function") ? ctx.rng : (() => 0.5);
        success = rfn() < base;
      }
    }

    if (success) {
      try { ctx.log && ctx.log("You notice signs of wildlife nearby. Press G to open the Region Map.", "notice"); } catch (_) {}
      state.lastAnimalHintTurn = turnCounter;
      state._wildNoHintTurns = 0;
    } else {
      state._wildNoHintTurns++;
    }
  } catch (_) {}
}

const state = {
  _wildNoHintTurns: 0,
  lastAnimalHintTurn: -100,
};

// Back-compat attachment
if (typeof window !== "undefined") {
  window.WorldHints = { maybeEmitOverworldAnimalHint };
}