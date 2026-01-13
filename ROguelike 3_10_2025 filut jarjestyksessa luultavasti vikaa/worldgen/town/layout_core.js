/**
 * Town layout core
 * ----------------
 * Base town layout logic extracted from worldgen/town_gen.js:
 * - Determines town size/kind from overworld metadata.
 * - Sizes the town map and carves outer walls and gate.
 * - Positions the player at the gate and sets town name/biome.
 * - Clears town containers (props/shops/buildings/prefab usage).
 *
 * This module mutates ctx in the same way the original code did,
 * and returns key values (rng, W/H, gate, townSize/kind, name, TOWNCFG, info)
 * for the rest of the generation pipeline to reuse.
 */

import { getGameData, getMod, getRNGUtils } from "../../utils/access.js";

/**
 * Build the base town layout: map dims + walls + gate + name + biome.
 *
 * @param {Object} ctx - game context
 * @returns {{rng:function|null,W:number,H:number,gate:{x:number,y:number},townSize:string,townKind:string,townName:string|null,TOWNCFG:object|null,info:object|null}}
 */
export function buildBaseTown(ctx) {
  // Seeded RNG helper for determinism
  const RU = getRNGUtils(ctx);
  const rng = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);

  // Determine current town size from overworld (default "big")
  // and capture its world entry for persistence.
  let townSize = "big";
  let info = null;
  try {
    if (ctx.world && Array.isArray(ctx.world.towns)) {
      const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : ctx.player.x;
      const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : ctx.player.y;
      info = ctx.world.towns.find(t => t.x === wx && t.y === wy) || null;
      if (info && info.size) townSize = info.size;
    }
  } catch (_) {
    info = null;
  }

  // Determine town kind (e.g. regular town vs castle) from overworld metadata.
  let townKind = "town";
  try {
    if (info && typeof info.kind === "string" && info.kind) {
      townKind = info.kind;
    }
  } catch (_) {}
  ctx.townKind = townKind;
  if (townKind === "castle" && townSize !== "city") townSize = "city";

  // Size the town map from data/town.json (fallback to previous values).
  const GD = getGameData(ctx);
  const TOWNCFG = (GD && GD.town) || null;
  function cfgSize(sizeKey) {
    const d = (TOWNCFG && TOWNCFG.sizes && TOWNCFG.sizes[sizeKey]) || null;
    if (d) return { W: Math.min(ctx.MAP_COLS, d.W | 0), H: Math.min(ctx.MAP_ROWS, d.H | 0) };
    if (sizeKey === "small") return { W: Math.min(ctx.MAP_COLS, 60), H: Math.min(ctx.MAP_ROWS, 40) };
    if (sizeKey === "city")  return { W: Math.min(ctx.MAP_COLS, 120), H: Math.min(ctx.MAP_ROWS, 80) };
    return { W: Math.min(ctx.MAP_COLS, 90), H: Math.min(ctx.MAP_ROWS, 60) };
  }
  const dims = cfgSize(townSize);
  const W = dims.W, H = dims.H;
  ctx.map = Array.from({ length: H }, () => Array(W).fill(ctx.TILES.FLOOR));

  // Outer walls
  for (let x = 0; x < W; x++) { ctx.map[0][x] = ctx.TILES.WALL; ctx.map[H - 1][x] = ctx.TILES.WALL; }
  for (let y = 0; y < H; y++) { ctx.map[y][0] = ctx.TILES.WALL; ctx.map[y][W - 1] = ctx.TILES.WALL; }

  // Gate placement: prefer the edge matching the approach direction, else nearest edge.
  const clampXY = (x, y) => ({ x: Math.max(1, Math.min(W - 2, x)), y: Math.max(1, Math.min(H - 2, y)) });
  const pxy = clampXY(ctx.player.x, ctx.player.y);
  let gate = null;

  // If Modes recorded an approach direction (E/W/N/S), pick corresponding perimeter gate.
  const dir = (typeof ctx.enterFromDir === "string") ? ctx.enterFromDir : "";
  if (dir) {
    if (dir === "E") gate = { x: 1, y: pxy.y };           // entered moving east -> came from west -> west edge
    else if (dir === "W") gate = { x: W - 2, y: pxy.y };  // entered moving west -> came from east -> east edge
    else if (dir === "N") gate = { x: pxy.x, y: H - 2 };  // entered moving north -> came from south -> south edge
    else if (dir === "S") gate = { x: pxy.x, y: 1 };      // entered moving south -> came from north -> north edge
  }

  if (!gate) {
    // Fallback: pick nearest edge to the player's (clamped) position.
    const targets = [
      { x: 1, y: pxy.y },                // west
      { x: W - 2, y: pxy.y },            // east
      { x: pxy.x, y: 1 },                // north
      { x: pxy.x, y: H - 2 },            // south
    ];
    let best = targets[0], bd = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.x - pxy.x) + Math.abs(t.y - pxy.y);
      if (d < bd) { bd = d; best = t; }
    }
    gate = best;
  }

  // Carve gate: mark the perimeter door and the interior gate tile as floor.
  if (gate.x === 1) ctx.map[gate.y][0] = ctx.TILES.DOOR;
  else if (gate.x === W - 2) ctx.map[gate.y][W - 1] = ctx.TILES.DOOR;
  else if (gate.y === 1) ctx.map[0][gate.x] = ctx.TILES.DOOR;
  else if (gate.y === H - 2) ctx.map[H - 1][gate.x] = ctx.TILES.DOOR;

  ctx.map[gate.y][gate.x] = ctx.TILES.FLOOR;
  ctx.player.x = gate.x; ctx.player.y = gate.y;
  ctx.townExitAt = { x: gate.x, y: gate.y };

  // Name: persist on the world.towns entry so it remains stable across visits.
  let townName = null;
  try {
    if (info && typeof info.name === "string" && info.name) townName = info.name;
  } catch (_) { townName = null; }
  if (!townName) {
    const prefixes = ["Oak", "Ash", "Pine", "River", "Stone", "Iron", "Silver", "Gold", "Wolf", "Fox", "Moon", "Star", "Red", "White", "Black", "Green"];
    const suffixes = ["dale", "ford", "field", "burg", "ton", "stead", "haven", "fall", "gate", "port", "wick", "shire", "crest", "view", "reach"];
    const mid = ["", "wood", "water", "brook", "hill", "rock", "ridge"];
    const p = prefixes[Math.floor(rng() * prefixes.length) % prefixes.length];
    const m = mid[Math.floor(rng() * mid.length) % mid.length];
    const s = suffixes[Math.floor(rng() * suffixes.length) % suffixes.length];
    townName = [p, m, s].filter(Boolean).join("");
    try { if (info) info.name = townName; } catch (_) {}
  }
  // Castle settlements get a castle-style name prefix if not already labeled as such.
  if (townKind === "castle" && townName) {
    try {
      if (!/castle/i.test(townName)) {
        townName = `Castle ${townName}`;
        if (info) info.name = townName;
      }
    } catch (_) {}
  }
  ctx.townName = townName;
  // Expose size to other modules (AI, UI).
  ctx.townSize = townSize;
  // Reset town containers to avoid stale data when generate() is invoked more than once in a session.
  // This prevents duplicated plaza props or repeated shop/sign placements.
  ctx.townProps = [];
  ctx.shops = [];
  ctx.townBuildings = [];
  ctx.townPrefabUsage = { houses: [], shops: [], inns: [], plazas: [], caravans: [] };

  // Derive and persist the town biome from the overworld around this town's location.
  (function deriveTownBiome() {
    try {
      const WMOD = ctx.World || getMod(ctx, "World");
      const WT = WMOD && WMOD.TILES ? WMOD.TILES : null;
      const world = ctx.world || {};

      // Helper: get world tile by absolute coords; prefer current window, fall back to generator.
      function worldTileAtAbs(ax, ay) {
        const wmap = world.map || null;
        const ox = world.originX | 0, oy = world.originY | 0;
        const lx = (ax - ox) | 0, ly = (ay - oy) | 0;
        if (Array.isArray(wmap) && ly >= 0 && lx >= 0 && ly < wmap.length && lx < (wmap[0] ? wmap[0].length : 0)) {
          return wmap[ly][lx];
        }
        if (world.gen && typeof world.gen.tileAt === "function") return world.gen.tileAt(ax, ay);
        return null;
      }

      // Absolute world coords for this town.
      const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number")
        ? (ctx.worldReturnPos.x | 0)
        : ((world.originX | 0) + (ctx.player.x | 0));
      const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number")
        ? (ctx.worldReturnPos.y | 0)
        : ((world.originY | 0) + (ctx.player.y | 0));

      // Neighborhood sampling around the town tile to find surrounding biome (skip TOWN/DUNGEON/RUINS).
      let counts = { DESERT: 0, SNOW: 0, BEACH: 0, SWAMP: 0, FOREST: 0, GRASS: 0 };
      function bump(tile) {
        if (!WT) return;
        if (tile === WT.DESERT) counts.DESERT++;
        else if (tile === WT.SNOW) counts.SNOW++;
        else if (tile === WT.BEACH) counts.BEACH++;
        else if (tile === WT.SWAMP) counts.SWAMP++;
        else if (tile === WT.FOREST) counts.FOREST++;
        else if (tile === WT.GRASS) counts.GRASS++;
      }

      // Search radius growing rings until we find any biome tiles.
      const MAX_R = 6;
      for (let r = 1; r <= MAX_R; r++) {
        let any = false;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // only outer ring
            const t = worldTileAtAbs(wx + dx, wy + dy);
            if (t == null) continue;
            // Skip POI markers
            if (WT && (t === WT.TOWN || t === WT.DUNGEON || t === WT.RUINS)) continue;
            bump(t);
            any = true;
          }
        }
        // If we have any biome counts after this ring, stop.
        const total = counts.DESERT + counts.SNOW + counts.BEACH + counts.SWAMP + counts.FOREST + counts.GRASS;
        if (any && total > 0) break;
      }

      // Pick the biome with the highest count; tie-break by a fixed priority.
      const order = ["FOREST", "GRASS", "DESERT", "BEACH", "SNOW", "SWAMP"];
      let best = "GRASS", bestV = -1;
      for (const k of order) {
        const v = counts[k] | 0;
        if (v > bestV) { bestV = v; best = k; }
      }
      ctx.townBiome = best || "GRASS";

      // Persist on world.towns entry if available.
      try {
        const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === wx && t.y === wy) : null;
        if (rec && typeof rec === "object") rec.biome = ctx.townBiome;
        else if (info && typeof info === "object") info.biome = ctx.townBiome;
      } catch (_) {}
    } catch (_) {}
  })();

  return {
    rng,
    W,
    H,
    gate,
    townSize,
    townKind,
    townName,
    TOWNCFG,
    info
  };
}

/**
 * Build and carve the central plaza.
 * - Picks plaza size from TOWNCFG.plaza[sizeKey] with safe defaults.
 * - Carves FLOOR tiles in a rectangle around the center.
 * - Sets ctx.townPlaza and ctx.townPlazaRect.
 *
 * Returns the plaza center and dimensions for use by town_gen.js.
 */
export function buildPlaza(ctx, W, H, townSize, TOWNCFG) {
  const plaza = { x: (W / 2) | 0, y: (H / 2) | 0 };
  ctx.townPlaza = { x: plaza.x, y: plaza.y };

  function cfgPlaza(sizeKey) {
    const d = (TOWNCFG && TOWNCFG.plaza && TOWNCFG.plaza[sizeKey]) || null;
    if (d) return { w: d.w | 0, h: d.h | 0 };
    if (sizeKey === "small") return { w: 10, h: 8 };
    if (sizeKey === "city") return { w: 18, h: 14 };
    return { w: 14, h: 12 };
  }

  const plazaDims = cfgPlaza(townSize);
  const plazaW = plazaDims.w;
  const plazaH = plazaDims.h;

  for (let yy = (plaza.y - (plazaH / 2)) | 0; yy <= (plaza.y + (plazaH / 2)) | 0; yy++) {
    for (let xx = (plaza.x - (plazaW / 2)) | 0; xx <= (plaza.x + (plazaW / 2)) | 0; xx++) {
      if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
      ctx.map[yy][xx] = ctx.TILES.FLOOR;
    }
  }

  try {
    ctx.townPlazaRect = {
      x0: ((plaza.x - (plazaW / 2)) | 0),
      y0: ((plaza.y - (plazaH / 2)) | 0),
      x1: ((plaza.x + (plazaW / 2)) | 0),
      y1: ((plaza.y + (plazaH / 2)) | 0)
    };
  } catch (_) {}

  return { plaza, plazaW, plazaH };
}

/**
 * Carve a hollow rectangle building (walls on border, floor inside) and
 * append its rect to the buildings list. This is the generic fallback
 * building primitive shared by town_gen.
 */
export function carveBuildingRect(ctx, buildings, bx, by, bw, bh, W, H) {
  for (let yy = by; yy < by + bh; yy++) {
    for (let xx = bx; xx < bx + bw; xx++) {
      if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
      const isBorder = (yy === by || yy === by + bh - 1 || xx === bx || xx === bx + bw - 1);
      ctx.map[yy][xx] = isBorder ? ctx.TILES.WALL : ctx.TILES.FLOOR;
    }
  }
  buildings.push({ x: bx, y: by, w: bw, h: bh });
}