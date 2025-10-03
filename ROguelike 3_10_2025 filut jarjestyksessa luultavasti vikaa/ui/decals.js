/**
 * Decals: visual effects like blood pools and fades, centralized.
 *
 * API:
 *   Decals.add(ctx, x, y, mult)
 *   Decals.tick(ctx)
 */
(function () {
  function add(ctx, x, y, mult = 1.0) {
    if (!ctx || typeof x !== "number" || typeof y !== "number") return;
    const map = ctx.map;
    const TILE = ctx.TILE;
    if (!map || !Array.isArray(map) || y < 0 || y >= map.length) return;
    const cols = map[0] ? map[0].length : 0;
    if (x < 0 || x >= cols) return;

    const decals = ctx.decals;
    if (!Array.isArray(decals)) return;

    // Merge on same tile
    const d = decals.find(d => d.x === x && d.y === y);
    const baseA = 0.16 + ctx.rng() * 0.18; // 0.16..0.34
    const baseR = Math.floor(TILE * (0.32 + ctx.rng() * 0.20)); // radius px
    if (d) {
      d.a = Math.min(0.9, d.a + baseA * mult);
      d.r = Math.max(d.r, baseR);
    } else {
      decals.push({ x, y, a: Math.min(0.9, baseA * mult), r: baseR });
      // Cap total decals to avoid unbounded growth
      if (decals.length > 240) decals.splice(0, decals.length - 240);
    }
  }

  function tick(ctx) {
    const decals = ctx && ctx.decals;
    if (!Array.isArray(decals) || decals.length === 0) return;
    for (let i = 0; i < decals.length; i++) {
      decals[i].a *= 0.92; // exponential fade
    }
    // filter in-place behavior: reassign array
    ctx.decals = decals.filter(d => d.a > 0.04);
  }

  window.Decals = { add, tick };
})();