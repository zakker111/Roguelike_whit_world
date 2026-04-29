function worldTileAtAbs(ctx, ax, ay) {
  try {
    const world = ctx && ctx.world ? ctx.world : null;
    if (!world) return null;
    const wmap = Array.isArray(world.map) ? world.map : null;
    const ox = world.originX | 0;
    const oy = world.originY | 0;
    const lx = (ax - ox) | 0;
    const ly = (ay - oy) | 0;
    if (wmap && ly >= 0 && lx >= 0 && ly < wmap.length && lx < (wmap[0] ? wmap[0].length : 0)) {
      return wmap[ly][lx];
    }
    if (world.gen && typeof world.gen.tileAt === "function") {
      return world.gen.tileAt(ax, ay);
    }
  } catch (_) {}
  return null;
}

export function detectHarborContext(ctx, wx, wy, WT) {
  try {
    if (!ctx || !ctx.world || !WT) return null;

    const dirs = [
      { id: "N", dx: 0, dy: -1 },
      { id: "S", dx: 0, dy: 1 },
      { id: "W", dx: -1, dy: 0 },
      { id: "E", dx: 1, dy: 0 }
    ];

    const MAX_DIST = 2;
    let bestDir = "";
    let bestScore = 0;
    let bestCoast = 0;
    let bestRiver = 0;

    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      let coast = 0;
      let river = 0;

      for (let step = 1; step <= MAX_DIST; step++) {
        const t = worldTileAtAbs(ctx, wx + d.dx * step, wy + d.dy * step);
        if (t == null) continue;
        if (t === WT.WATER || t === WT.BEACH) {
          coast += 2;
        } else if (t === WT.RIVER) {
          river += 1;
        }
      }

      const score = coast + river;
      if (score > bestScore) {
        bestScore = score;
        bestDir = d.id;
        bestCoast = coast;
        bestRiver = river;
      }
    }

    const MIN_SCORE = 2;
    if (!bestDir || bestScore < MIN_SCORE) return null;

    let waterContext = "coast";
    if (bestRiver > 0 && bestRiver * 1.5 >= bestCoast) {
      waterContext = "river";
    }

    return {
      harborDir: bestDir,
      waterContext,
      score: bestScore,
      coastScore: bestCoast,
      riverScore: bestRiver
    };
  } catch (_) {
    return null;
  }
}

export function isHarborTownRecord(ctx, rec, WT) {
  try {
    if (!rec || typeof rec.x !== "number" || typeof rec.y !== "number") return false;
    if (String(rec.kind || "") === "castle") return false;
    if (rec.harborDir) return true;

    const info = detectHarborContext(ctx, rec.x | 0, rec.y | 0, WT);
    if (!info || !info.harborDir) return false;

    try {
      rec.harborDir = rec.harborDir || info.harborDir;
      rec.harborWater = rec.harborWater || info.waterContext;
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export function listHarborTownRecords(ctx, opts = {}) {
  try {
    const WT = opts.WT || (ctx && ctx.World ? ctx.World.TILES : null);
    const towns = Array.isArray(ctx?.world?.towns) ? ctx.world.towns : [];
    const out = [];
    for (let i = 0; i < towns.length; i++) {
      const rec = towns[i];
      if (!isHarborTownRecord(ctx, rec, WT)) continue;
      out.push(rec);
    }
    return out;
  } catch (_) {
    return [];
  }
}

export function findNearestHarborTown(ctx, fromWx, fromWy, opts = {}) {
  try {
    const list = listHarborTownRecords(ctx, opts);
    const excludeSame = !!opts.excludeSame;
    const maxDistance = Number.isFinite(opts.maxDistance) ? Math.max(0, opts.maxDistance | 0) : null;

    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const wx = rec.x | 0;
      const wy = rec.y | 0;
      if (excludeSame && wx === (fromWx | 0) && wy === (fromWy | 0)) continue;
      const dist = Math.abs(wx - (fromWx | 0)) + Math.abs(wy - (fromWy | 0));
      if (maxDistance != null && dist > maxDistance) continue;
      if (dist < bestDist) {
        best = rec;
        bestDist = dist;
      }
    }
    return best || null;
  } catch (_) {
    return null;
  }
}

export function findNearestOtherHarborTown(ctx, fromWx, fromWy, opts = {}) {
  return findNearestHarborTown(ctx, fromWx, fromWy, { ...opts, excludeSame: true });
}
