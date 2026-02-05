import * as World from "../world/world.js";
import { getTileDef } from "../data/tile_lookup.js";
import { getMod, getRNGUtils } from "../utils/access.js";
import { markAnimalsCleared } from "./region_map_persistence.js";

// RNG helper for animals module: prefer ctx.RNGUtils via access helper
function getRU(ctx) {
  try {
    return getRNGUtils(ctx);
  } catch (_) {
    return null;
  }
}

// Drive an active Region Map encounter: enemies act, occupancy rebuild,
// and mark the tile as cleared once no enemies remain.
export function driveRegionEncounter(ctx) {
  if (!ctx || ctx.mode !== "region" || !ctx.region || !ctx.region._isEncounter) return;

  try {
    const AIH = ctx.AI || getMod(ctx, "AI");
    if (AIH && typeof AIH.enemiesAct === "function") {
      AIH.enemiesAct(ctx);
    }
  } catch (_) {}

  try {
    const OF = ctx.OccupancyFacade || getMod(ctx, "OccupancyFacade");
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}

  // Victory: no enemies remain — keep player in Region Map (no auto-close or victory log)
  try {
    if (!Array.isArray(ctx.enemies) || ctx.enemies.length === 0) {
      ctx.region._isEncounter = false;
      ctx.encounterInfo = null;
      // Also mark this overworld tile as cleared to prevent future animal spawns
      try {
        const pos = ctx.region && ctx.region.enterWorldPos ? ctx.region.enterWorldPos : null;
        if (pos) markAnimalsCleared(pos.x | 0, pos.y | 0);
      } catch (_) {}
    }
  } catch (_) {}
}

// Neutral animals wander slowly even when not in an encounter.
export function tickNeutralAnimals(ctx) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return;

  try {
    const RU = getRU(ctx);
    const rfn = (RU && typeof RU.getRng === "function")
      ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : null);

    const sample = ctx.region.map || null;
    const h = sample ? sample.length : 0;
    const w = h ? (sample[0] ? sample[0].length : 0) : 0;
    if (w && h && Array.isArray(ctx.enemies) && ctx.enemies.length) {
      function walkableAt(x, y) {
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        const t = sample[y][x];
        // Prefer tiles.json walkability if present
        try {
          const def = getTileDef("region", t);
          if (def && def.properties && typeof def.properties.walkable === "boolean") return !!def.properties.walkable;
        } catch (_) {}
        // Fallback to overworld semantics
        try { return !!World.isWalkable(t); } catch (_) {}
        const WT = World.TILES;
        return (t !== WT.WATER && t !== WT.RIVER && t !== WT.MOUNTAIN);
      }

      function occupiedAt(x, y) {
        if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return true;
        return ctx.enemies.some(e => e && e.x === x && e.y === y);
      }

      let anyMoved = false;
      for (const e of ctx.enemies) {
        if (!e) continue;
        if (String(e.faction || "") !== "animal") continue;
        // 30% chance to attempt a small random step
        const chance = 0.30;
        const rv = (typeof rfn === "function") ? rfn() : Math.random();
        if (rv >= chance) continue;

        // Try a few random neighbor steps to find a valid move
        for (let tries = 0; tries < 6; tries++) {
          const dx = (((typeof rfn === "function" ? rfn() : Math.random()) * 3) | 0) - 1;
          const dy = (((typeof rfn === "function" ? rfn() : Math.random()) * 3) | 0) - 1;
          if (!dx && !dy) continue;
          const nx = e.x + dx;
          const ny = e.y + dy;
          if (!walkableAt(nx, ny)) continue;
          if (occupiedAt(nx, ny)) continue;
          e.x = nx; e.y = ny;
          anyMoved = true;
          break;
        }
      }

      if (anyMoved) {
        try {
          const OF = ctx.OccupancyFacade || getMod(ctx, "OccupancyFacade");
          if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
        } catch (_) {}
        try {
          const SS = ctx.StateSync || getMod(ctx, "StateSync");
          if (SS && typeof SS.applyAndRefresh === "function") SS.applyAndRefresh(ctx, {});
        } catch (_) {}
      }
    }
  } catch (_) {}
}
