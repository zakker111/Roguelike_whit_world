import * as World from "../world/world.js";
import { getTileDef, getTileDefByKey } from "../data/tile_lookup.js";
import { getMod } from "../utils/access.js";
import { clamp } from "./region_map_sampling.js";

// Decorate a sampled region map with a simple ruins footprint: broken walls,
// gaps for entrances, and interior pillars. Mutates the `sample` array.
export function decorateRuinsSample(sample, rng, RU) {
  const WT = World.TILES;
  const h = sample.length;
  const w = sample[0] ? sample[0].length : 0;
  if (!w || !h) return;

  // Resolve RUIN_WALL id from tileset (region scope); fallback to MOUNTAIN if missing.
  let ruinWallId = WT.MOUNTAIN;
  try {
    const td = getTileDefByKey("region", "RUIN_WALL");
    if (td && typeof td.id === "number") ruinWallId = td.id | 0;
  } catch (_) {}

  const cx = (w / 2) | 0;
  const cy = (h / 2) | 0;
  const rw = Math.max(8, Math.floor(w * 0.5));
  const rh = Math.max(6, Math.floor(h * 0.45));
  const x0 = Math.max(1, cx - (rw >> 1));
  const y0 = Math.max(1, cy - (rh >> 1));
  const x1 = Math.min(w - 2, x0 + rw);
  const y1 = Math.min(h - 2, y0 + rh);

  const setTileSafe = (yy, xx, val) => {
    if (yy >= 0 && yy < h && xx >= 0 && xx < w && sample[yy]) {
      sample[yy][xx] = val;
    }
  };

  // Perimeter with gaps
  for (let x = x0; x <= x1; x++) {
    if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y0, x, ruinWallId);
    if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y1, x, ruinWallId);
  }
  for (let y = y0; y <= y1; y++) {
    if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y, x0, ruinWallId);
    if (RU && typeof RU.chance === "function" ? RU.chance(0.87, rng) : (rng() > 0.13)) setTileSafe(y, x1, ruinWallId);
  }

  // Open 3–5 random gaps in the ring to create entrances
  const gaps = 3 + ((rng() * 3) | 0);
  for (let i = 0; i < gaps; i++) {
    const side = (rng() * 4) | 0;
    if (side === 0) { // top
      const gx = x0 + 1 + ((rng() * Math.max(1, rw - 2)) | 0);
      setTileSafe(y0, gx, WT.GRASS);
      setTileSafe(y0, Math.max(gx - 1, x0 + 1), WT.GRASS);
      setTileSafe(y0, Math.min(gx + 1, x1 - 1), WT.GRASS);
      setTileSafe(y0 + 1, gx, WT.GRASS);
      setTileSafe(y0 + 1, Math.max(gx - 1, x0 + 1), WT.GRASS);
    } else if (side === 1) { // bottom
      const gx = x0 + 1 + ((rng() * Math.max(1, rw - 2)) | 0);
      setTileSafe(y1, gx, WT.GRASS);
      setTileSafe(y1, Math.max(gx - 1, x0 + 1), WT.GRASS);
      setTileSafe(y1, Math.min(gx + 1, x1 - 1), WT.GRASS);
      setTileSafe(y1 - 1, gx, WT.GRASS);
      setTileSafe(y1 - 1, Math.max(gx - 1, x0 + 1), WT.GRASS);
    } else if (side === 2) { // left
      const gy = y0 + 1 + ((rng() * Math.max(1, rh - 2)) | 0);
      setTileSafe(gy, x0, WT.GRASS);
      setTileSafe(Math.max(gy - 1, y0 + 1), x0, WT.GRASS);
      setTileSafe(Math.min(gy + 1, y1 - 1), x0, WT.GRASS);
      setTileSafe(gy, x0 + 1, WT.GRASS);
      setTileSafe(Math.max(gy - 1, y0 + 1), x0 + 1, WT.GRASS);
    } else { // right
      const gy = y0 + 1 + ((rng() * Math.max(1, rh - 2)) | 0);
      setTileSafe(gy, x1, WT.GRASS);
      setTileSafe(Math.max(gy - 1, y0 + 1), x1, WT.GRASS);
      setTileSafe(Math.min(gy + 1, y1 - 1), x1, WT.GRASS);
      setTileSafe(gy, x1 - 1, WT.GRASS);
      setTileSafe(Math.max(gy - 1, y0 + 1), x1 - 1, WT.GRASS);
    }
  }

  // Scatter interior short ruin segments/pillars
  const segs = 4 + ((rw + rh) / 6) | 0;
  for (let i = 0; i < segs; i++) {
    const horiz = rng() < 0.5;
    const len = 2 + ((rng() * 4) | 0);
    const sx = Math.max(x0 + 2, Math.min(x1 - 2, x0 + 2 + ((rng() * Math.max(1, rw - 4)) | 0)));
    const sy = Math.max(y0 + 2, Math.min(y1 - 2, y0 + 2 + ((rng() * Math.max(1, rh - 4)) | 0)));
    for (let k = 0; k < len; k++) {
      const x = (sx + (horiz ? k : 0)) | 0;
      const y = (sy + (horiz ? 0 : k)) | 0;
      if (x <= x0 || y <= y0 || x >= x1 || y >= y1) continue;
      if (RU && typeof RU.chance === "function" ? RU.chance(0.85, rng) : (rng() < 0.85)) setTileSafe(y, x, ruinWallId);
    }
  }

  // Ensure an inner clearing ring for mobility around center
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        if (sample[y] && sample[y][x] === ruinWallId) setTileSafe(y, x, WT.GRASS);
      }
    }
  }
}

// Ruins encounter (enemies + loot) setup on RUINS tiles inside Region Map.
// Uses ctx.region.map as the active tactical map and respects per-tile
// animalsCleared / loadedPersisted flags.
export function spawnRuinsEncounter(ctx, opts) {
  if (!ctx || !ctx.world || !ctx.region) return;
  const { anchorX, anchorY, animalsCleared, loadedPersisted, rng } = opts || {};
  const WT = World.TILES;

  try {
    const isRuinsHere = (ctx.world && ctx.world.map && ctx.world.map[anchorY][anchorX] === WT.RUINS);
    if (!isRuinsHere) return;
    // If animalsCleared is set for this tile, treat ruins as cleared as well (shared flag)
    if (animalsCleared) {
      try { ctx.log && ctx.log("These ruins are quiet; no hostiles remain.", "info"); } catch (_) {}
      return;
    }
    // If we restored a persisted map state, assume encounter already handled
    if (loadedPersisted) return;

    const h = ctx.region.map.length;
    const w = ctx.region.map[0] ? ctx.region.map[0].length : 0;
    if (!w || !h || typeof rng !== "function") return;

    // Resolve ruin wall id for walkability/FOV checks
    let ruinWallId = WT.MOUNTAIN;
    try {
      const td = getTileDefByKey("region", "RUIN_WALL");
      if (td && typeof td.id === "number") ruinWallId = td.id | 0;
    } catch (_) {}

    function walkableAt(x, y) {
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return false;
      const t = ctx.region.map[y][x];
      // Prefer tiles.json property
      try {
        const def = getTileDef("region", t);
        if (def && def.properties && typeof def.properties.walkable === "boolean") return !!def.properties.walkable;
      } catch (_) {}
      // Fallback to World.isWalkable on overworld semantics
      try { return !!World.isWalkable(t); } catch (_) {}
      return true;
    }

    function free(x, y) {
      if (!walkableAt(x, y)) return false;
      if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return false;
      if (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y)) return false;
      return true;
    }

    function pickInteriorSpot(tries = 200) {
      const cx = (w / 2) | 0;
      const cy = (h / 2) | 0;
      for (let t = 0; t < tries; t++) {
        const rx = cx + (((rng() * 7) | 0) - 3);
        const ry = cy + (((rng() * 5) | 0) - 2);
        const x = clamp(rx, 1, w - 2);
        const y = clamp(ry, 1, h - 2);
        if (free(x, y)) return { x, y };
      }
      // Fallback: any free walkable
      for (let t = 0; t < tries; t++) {
        const x = (rng() * w) | 0;
        const y = (rng() * h) | 0;
        if (free(x, y)) return { x, y };
      }
      return null;
    }

    // Create enemies using Enemies definitions only (JSON-only)
    function createEnemyOfType(x, y, type) {
      try {
        const EM = ctx.Enemies || getMod(ctx, "Enemies");
        if (EM && typeof EM.getTypeDef === "function") {
          const td = EM.getTypeDef(type);
          if (td) {
            const depth = 1;
            const e = {
              x, y,
              type,
              glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
              hp: td.hp(depth),
              atk: td.atk(depth),
              xp: td.xp(depth),
              level: (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth,
              announced: false
            };
            const s = String(type || "").toLowerCase();
            e.faction = s.includes("bandit") ? "bandit" : (s.includes("orc") ? "orc" : "monster");
            return e;
          }
        }
      } catch (_) {}
      try { ctx.log && ctx.log(`Fallback enemy spawned in ruins (type '${type}' not defined).`, "warn"); } catch (_) {}
      return { x, y, type: type || "fallback_enemy", glyph: "?", hp: 3, atk: 1.0, xp: 5, level: 1, faction: "monster", announced: false };
    }

    const choices = ["skeleton", "bandit", "mime_ghost"];
    const n = 2 + ((rng() * 3) | 0); // 2–4
    ctx.enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const spot = pickInteriorSpot(200);
      if (!spot) break;
      const t = choices[(rng() * choices.length) | 0];
      const e = createEnemyOfType(spot.x, spot.y, t);
      if (e) {
        ctx.enemies.push(e);
        placed++;
      }
    }

    // Place 1–2 lootable corpses/chests inside
    try {
      const L = ctx.Loot || getMod(ctx, "Loot");
      const chestCount = 1 + ((rng() * 2) | 0);
      for (let i = 0; i < chestCount; i++) {
        const spot = pickInteriorSpot(180);
        if (!spot) break;
        const loot = (L && typeof L.generate === "function") ? (L.generate(ctx, { type: "bandit", xp: 12 }) || []) : [{ kind: "gold", amount: 6, name: "gold" }];
        ctx.corpses.push({ kind: "chest", x: spot.x, y: spot.y, loot, looted: loot.length === 0 });
      }
    } catch (_) {}

    ctx.region._isEncounter = true;
    try { ctx.log && ctx.log("Hostiles lurk within the ruins!", "info"); } catch (_) {}
  } catch (_) {}
}
