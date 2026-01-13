/**
 * Town layout core
 * ----------------
 * Base town layout logic extracted from worldgen/town_gen.js:
 * - Determines town size/kind from overworld metadata.
 * - Sizes the town map and carves outer walls and gate.
 * - Positions the player at the gate and sets town name/biome.
 * - Clears town containers (props/shops/buildings/prefab usage).
 * - Provides helpers for inn and castle keep placement.
 *
 * This module mutates ctx in the same way the original code did,
 * and returns key values (rng, W/H, gate, townSize/kind, name, TOWNCFG, info)
 * for the rest of the generation pipeline to reuse.
 */

import { getGameData, getMod, getRNGUtils } from "../../utils/access.js";
import { getInnSizeConfig, getCastleKeepSizeConfig } from "./config.js";

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
 *
 * This is intentionally minimal and does not stamp doors or windows;
 * those are added in later passes.
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

/**
 * Check that a provisional building rectangle plus a margin is entirely
 * FLOOR tiles. This is used to enforce a one-tile gap between buildings
 * so their walls never touch.
 */
export function isAreaClearForBuilding(ctx, W, H, bx, by, bw, bh, margin = 1) {
  const x0 = Math.max(1, bx - margin);
  const y0 = Math.max(1, by - margin);
  const x1 = Math.min(W - 2, bx + bw - 1 + margin);
  const y1 = Math.min(H - 2, by + bh - 1 + margin);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const t = ctx.map[yy][xx];
      if (t !== ctx.TILES.FLOOR) return false;
    }
  }
  return true;
}

/**
 * Find all buildings whose rect overlaps [x0,y0,w,h] with optional margin.
 */
export function findBuildingsOverlappingRect(buildings, x0, y0, w, h, margin = 0) {
  const out = [];
  const ax = x0, ay = y0, aw = w, ah = h;
  const ax0 = ax - margin, ay0 = ay - margin, ax1 = ax + aw - 1 + margin, ay1 = ay + ah - 1 + margin;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const bx0 = b.x - margin, by0 = b.y - margin, bx1 = b.x + b.w - 1 + margin, by1 = b.y + b.h - 1 + margin;
    const sepX = (ax1 < bx0) || (bx1 < ax0);
    const sepY = (ay1 < by0) || (by1 < ay0);
    if (!(sepX || sepY)) out.push(b);
  }
  return out;
}

/**
 * Plaza fixtures via prefab only (no fallbacks). For castle settlements, keep
 * the central area clear for the castle keep and skip plaza prefabs.
 *
 * This is extracted from town_gen.js; behaviour is unchanged. Prefab stamping
 * and building removal are delegated via function parameters so this module
 * stays focused on layout concerns.
 */
export function placePlazaPrefabStrict(
  ctx,
  buildings,
  townKind,
  plaza,
  plazaW,
  plazaH,
  rng,
  removeBuildingAndProps,
  stampPlazaPrefab,
  trySlipStamp,
  pickPrefab
) {
  // Castle towns keep the plaza clear for the keep; skip plaza prefabs entirely.
  if (townKind === "castle") return;

  try {
    // Guard: if a plaza prefab was already stamped in this generation cycle, skip
    try {
      if (ctx.townPrefabUsage && Array.isArray(ctx.townPrefabUsage.plazas) && ctx.townPrefabUsage.plazas.length > 0) return;
    } catch (_) {}

    const GD7 = getGameData(ctx);
    const PFB = (GD7 && GD7.prefabs) ? GD7.prefabs : null;
    const plazas = (PFB && Array.isArray(PFB.plazas)) ? PFB.plazas : [];
    if (!plazas.length) {
      try { if (ctx && typeof ctx.log === "function") ctx.log("Plaza: no plaza prefabs defined; using fallback layout only.", "notice"); } catch (_) {}
      return;
    }

    // Clear the plaza rectangle before stamping so that any previous roads/buildings
    // inside the plaza do not prevent prefab placement.
    try {
      const px0 = ((plaza.x - (plazaW / 2)) | 0);
      const px1 = ((plaza.x + (plazaW / 2)) | 0);
      const py0 = ((plaza.y - (plazaH / 2)) | 0);
      const py1 = ((plaza.y + (plazaH / 2)) | 0);
      const rx0 = Math.max(1, px0);
      const ry0 = Math.max(1, py0);
      const rx1 = Math.min(ctx.map[0].length - 2, px1);
      const ry1 = Math.min(ctx.map.length - 2, py1);

      // Remove any buildings overlapping the plaza rectangle
      const overl = findBuildingsOverlappingRect(buildings, rx0, ry0, rx1 - rx0 + 1, ry1 - ry0 + 1, 0);
      if (overl && overl.length) {
        for (let i = 0; i < overl.length; i++) {
          removeBuildingAndProps(overl[i]);
        }
      }
      // Force tiles in the plaza rectangle back to FLOOR before stamping
      for (let yy = ry0; yy <= ry1; yy++) {
        for (let xx = rx0; xx <= rx1; xx++) {
          ctx.map[yy][xx] = ctx.TILES.FLOOR;
        }
      }
    } catch (_) {}

    // Filter prefabs that fit inside current plaza rectangle
    const fit = plazas.filter(p => p && p.size && (p.size.w | 0) <= plazaW && (p.size.h | 0) <= plazaH);
    const list = (fit.length ? fit : plazas);
    const pref = pickPrefab(list, ctx.rng || rng);
    if (!pref || !pref.size) {
      try { if (ctx && typeof ctx.log === "function") ctx.log("Plaza: failed to pick a valid plaza prefab; using fallback layout.", "notice"); } catch (_) {}
      return;
    }

    // Center the plaza prefab within the carved plaza rectangle
    const bx = ((plaza.x - ((pref.size.w / 2) | 0)) | 0);
    const by = ((plaza.y - ((pref.size.h / 2) | 0)) | 0);
    if (!stampPlazaPrefab(ctx, pref, bx, by)) {
      // Attempt slight slip only; no fallback
      const slipped = trySlipStamp(ctx, pref, bx, by, 2);
      if (!slipped) {
        try { if (ctx && typeof ctx.log === "function") ctx.log("Plaza: plaza prefab did not fit even after clearing area; using fallback layout.", "notice"); } catch (_) {}
      } else {
        try { if (ctx && typeof ctx.log === "function") ctx.log(`Plaza: plaza prefab '${pref.id || "unknown"}' placed with slip.`, "notice"); } catch (_) {}
      }
    } else {
      try { if (ctx && typeof ctx.log === "function") ctx.log(`Plaza: plaza prefab '${pref.id || "unknown"}' stamped successfully.`, "notice"); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Door placement helpers for rectangular buildings. These are geometry-only
 * and do not depend on Prefabs; they operate on the TILE map + ctx.
 */
export function layoutCandidateDoors(b) {
  return [
    { x: b.x + ((b.w / 2) | 0), y: b.y, ox: 0, oy: -1 },                      // top
    { x: b.x + b.w - 1, y: b.y + ((b.h / 2) | 0), ox: +1, oy: 0 },            // right
    { x: b.x + ((b.w / 2) | 0), y: b.y + b.h - 1, ox: 0, oy: +1 },            // bottom
    { x: b.x, y: b.y + ((b.h / 2) | 0), ox: -1, oy: 0 },                      // left
  ];
}

export function layoutEnsureDoor(ctx, b) {
  const cands = layoutCandidateDoors(b);
  const good = cands.filter(d => {
    const tx = d.x + d.ox;
    const ty = d.y + d.oy;
    if (ty < 0 || ty >= ctx.map.length) return false;
    if (tx < 0 || tx >= ctx.map[0].length) return false;
    return ctx.map[ty][tx] === ctx.TILES.FLOOR;
  });
  const pool = good.length ? good : cands;
  const idx = (typeof ctx.rng === "function")
    ? (Math.floor(ctx.rng() * pool.length) % pool.length)
    : (Math.floor(Math.random() * pool.length) % pool.length);
  const pick = pool[idx];
  if (pick && ctx.map[pick.y] && ctx.map[pick.y][pick.x] !== undefined) {
    ctx.map[pick.y][pick.x] = ctx.TILES.DOOR;
  }
  return pick;
}

export function layoutGetExistingDoor(ctx, b) {
  const cds = layoutCandidateDoors(b);
  for (const d of cds) {
    if (d.y < 0 || d.y >= ctx.map.length) continue;
    if (d.x < 0 || d.x >= ctx.map[0].length) continue;
    if (ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
      return { x: d.x, y: d.y };
    }
  }
  const dd = layoutEnsureDoor(ctx, b);
  return { x: dd.x, y: dd.y };
}

/**
 * Place a castle keep building (for townKind === "castle") near the plaza.
 * Keeps plaza open and avoids overwriting the gate; uses the same logic that
 * previously lived in town_gen.js. No RNG is currently used, but rng is
 * accepted for future variability.
 */
export function placeCastleKeep(ctx, buildings, W, H, gate, plaza, plazaW, plazaH, townKind, TOWNCFG, rng) {
  if (townKind !== "castle") return;

  // Scale keep size from plaza size, with bounds tied to town size (data-driven via town.json when available).
  const keepSize = getCastleKeepSizeConfig(TOWNCFG, ctx.townSize, plazaW, plazaH, W, H);
  let keepW = keepSize.keepW;
  let keepH = keepSize.keepH;
  if (keepW < 10 || keepH < 8) return;

  // Helper: prevent overlapping the town plaza footprint (optionally with a small buffer)
  function overlapsPlazaRectLocal(bx, by, bw, bh, margin = 0) {
    const px0 = ((plaza.x - (plazaW / 2)) | 0);
    const px1 = ((plaza.x + (plazaW / 2)) | 0);
    const py0 = ((plaza.y - (plazaH / 2)) | 0);
    const py1 = ((plaza.y + (plazaH / 2)) | 0);
    const ax0 = bx, ay0 = by;
    const ax1 = bx + bw - 1, ay1 = by + bh - 1;
    const bx0 = Math.max(1, px0 - margin), by0 = Math.max(1, py0 - margin);
    const bx1 = Math.min(W - 2, px1 + margin), by1 = Math.min(H - 2, py1 + margin);
    const sepX = (ax1 < bx0) || (bx1 < ax0);
    const sepY = (ay1 < by0) || (by1 < ay0);
    return !(sepX || sepY);
  }

  // Start centered on the plaza.
  let kx = Math.max(2, Math.min(W - keepW - 2, (plaza.x - (keepW / 2)) | 0));
  let ky = Math.max(2, Math.min(H - keepH - 2, (plaza.y - (keepH / 2)) | 0));

  // If this would overlap the plaza rectangle, try shifting the keep to one of the four sides
  // so the plaza stays open.
  if (overlapsPlazaRectLocal(kx, ky, keepW, keepH, 0)) {
    const candidates = [
      // Below plaza
      {
        x: Math.max(2, Math.min(W - keepW - 2, (plaza.x - (keepW / 2)) | 0)),
        y: Math.min(H - keepH - 2, ((plaza.y + (plazaH / 2)) | 0) + 2)
      },
      // Above plaza
      {
        x: Math.max(2, Math.min(W - keepW - 2, (plaza.x - (keepW / 2)) | 0)),
        y: Math.max(2, ((plaza.y - (plazaH / 2)) | 0) - 2 - keepH)
      },
      // Right of plaza
      {
        x: Math.min(W - keepW - 2, ((plaza.x + (plazaW / 2)) | 0) + 2),
        y: Math.max(2, Math.min(H - keepH - 2, (plaza.y - (keepH / 2)) | 0))
      },
      // Left of plaza
      {
        x: Math.max(2, ((plaza.x - (plazaW / 2)) | 0) - 2 - keepW),
        y: Math.max(2, Math.min(H - keepH - 2, (plaza.y - (keepH / 2)) | 0))
      }
    ];
    let placedPos = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cx = Math.max(2, Math.min(W - keepW - 2, c.x));
      const cy = Math.max(2, Math.min(H - keepH - 2, c.y));
      if (overlapsPlazaRectLocal(cx, cy, keepW, keepH, 0)) continue;
      placedPos = { x: cx, y: cy };
      break;
    }
    if (!placedPos) {
      // No valid non-overlapping placement; skip keep to preserve plaza.
      return;
    }
    kx = placedPos.x;
    ky = placedPos.y;
  }

  // Do not overwrite the gate tile.
  if (kx <= gate.x && gate.x <= kx + keepW - 1 && ky <= gate.y && gate.y <= ky + keepH - 1) {
    return;
  }

  // Ensure the area is mostly floor before carving (avoid overlapping existing prefab buildings).
  let blocked = false;
  for (let y = ky; y < ky + keepH && !blocked; y++) {
    for (let x = kx; x < kx + keepW; x++) {
      if (y <= 0 || x <= 0 || y >= H - 1 || x >= W - 1) { blocked = true; break; }
      const t = ctx.map[y][x];
      if (t !== ctx.TILES.FLOOR) { blocked = true; break; }
    }
  }
  if (blocked) return;

  // Carve the keep shell.
  carveBuildingRect(ctx, buildings, kx, ky, keepW, keepH, W, H);

  // Annotate the most recently added building as the castle keep for diagnostics.
  const keep = buildings[buildings.length - 1];
  if (keep) {
    keep.prefabId = "castle_keep";
    keep.prefabCategory = "castle";
  }

  // Luxurious interior furnishing: central hall rug, throne area, side chambers with beds/chests.
  const innerX0 = kx + 1;
  const innerY0 = ky + 1;
  const innerX1 = kx + keepW - 2;
  const innerY1 = ky + keepH - 2;
  const midX = (innerX0 + innerX1) >> 1;
  const midY = (innerY0 + innerY1) >> 1;

  function safeAddProp(x, y, type, name) {
    try {
      if (x <= innerX0 || y <= innerY0 || x >= innerX1 || y >= innerY1) return;
      if (ctx.map[y][x] !== ctx.TILES.FLOOR) return;
      if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return;
      ctx.townProps.push({ x, y, type, name });
    } catch (_) {}
  }

  // Long rug down the central hall.
  for (let y = innerY0 + 1; y <= innerY1 - 1; y++) {
    safeAddProp(midX, y, "rug");
  }

  // Throne area at the far end from the gate: decide orientation by comparing to gate position.
  let throneY = innerY0 + 1;
  let tableY = throneY + 1;
  if (gate.y < ky) {
    // Gate is above keep -> throne at south end.
    throneY = innerY1 - 1;
    tableY = throneY - 1;
  }
  safeAddProp(midX, throneY, "chair", "Throne");
  safeAddProp(midX - 1, throneY, "plant");
  safeAddProp(midX + 1, throneY, "plant");
  // High table in front of throne.
  safeAddProp(midX, tableY, "table");

  // Grand fireplaces on the side walls.
  safeAddProp(innerX0 + 1, midY, "fireplace");
  safeAddProp(innerX1 - 1, midY, "fireplace");

  // Side chambers with beds and chests.
  safeAddProp(innerX0 + 2, innerY0 + 2, "bed");
  safeAddProp(innerX0 + 3, innerY0 + 2, "chest");
  safeAddProp(innerX1 - 3, innerY0 + 2, "bed");
  safeAddProp(innerX1 - 2, innerY0 + 2, "chest");

  safeAddProp(innerX0 + 2, innerY1 - 2, "bed");
  safeAddProp(innerX0 + 3, innerY1 - 2, "table");
  safeAddProp(innerX1 - 3, innerY1 - 2, "bed");
  safeAddProp(innerX1 - 2, innerY1 - 2, "table");

  // Decorative plants and barrels along the walls.
  for (let x = innerX0 + 2; x <= innerX1 - 2; x += 3) {
    safeAddProp(x, innerY0 + 1, "plant");
    safeAddProp(x, innerY1 - 1, "plant");
  }
  safeAddProp(innerX0 + 1, innerY0 + 1, "barrel");
  safeAddProp(innerX1 - 1, innerY0 + 1, "barrel");
}

/**
 * Enlarge and position the Inn next to the plaza, with size almost as big as
 * the plaza and double doors facing it. This is the inn/tavern layout logic
 * extracted from town_gen.js.
 */
export function buildInnAndMarkTavern(ctx, buildings, W, H, gate, plaza, plazaW, plazaH, townSize, TOWNCFG, rng, stampPrefab, findBuildingsOverlappingRect, removeBuildingAndProps, overlapsPlazaRect, placeBuilding, candidateDoors, inBounds) {
  // Always carve the Inn even if no other buildings exist, to guarantee at least one building

  // Target size: scale from plaza dims and ensure larger minimums by town size
  let rectUsedInn = null;
  const sizeKey = townSize;
  // Make inn a bit smaller than before to keep plaza spacious (data-driven via town.json when available)
  const innSize = getInnSizeConfig(TOWNCFG, sizeKey);
  const minW = innSize.minW;
  const minH = innSize.minH;
  const scaleW = innSize.scaleW;
  const scaleH = innSize.scaleH;
  const targetW = Math.max(minW, Math.floor(plazaW * scaleW));
  const targetH = Math.max(minH, Math.floor(plazaH * scaleH));

  // Require a clear one-tile floor margin around the Inn so it never connects to other buildings
  function hasMarginClear(x, y, w, h, margin = 1) {
    const x0 = Math.max(1, x - margin);
    const y0 = Math.max(1, y - margin);
    const x1 = Math.min(W - 2, x + w - 1 + margin);
    const y1 = Math.min(H - 2, y + h - 1 + margin);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        // Outside the rect or inside, we require current tiles to be FLOOR (roads/plaza),
        // not walls/doors/windows of other buildings.
        if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) return false;
      }
    }
    return true;
  }

  // Try to place the Inn on one of the four sides adjacent to the plaza, ensuring margin clear
  function placeInnRect() {
    // Start with desired target size and shrink if we cannot find a margin-clear slot
    let tw = targetW, th = targetH;

    // Attempt multiple shrink steps to satisfy margin without touching other buildings
    for (let shrink = 0; shrink < 4; shrink++) {
      const candidates = [];

      // East of plaza
      candidates.push({
        side: "westFacing",
        x: Math.min(W - 2 - tw, ((plaza.x + (plazaW / 2)) | 0) + 2),
        y: Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0))
      });
      // West of plaza
      candidates.push({
        side: "eastFacing",
        x: Math.max(1, ((plaza.x - (plazaW / 2)) | 0) - 2 - tw),
        y: Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0))
      });
      // South of plaza
      candidates.push({
        side: "northFacing",
        x: Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0)),
        y: Math.min(H - 2 - th, ((plaza.y + (plazaH / 2)) | 0) + 2)
      });
      // North of plaza
      candidates.push({
        side: "southFacing",
        x: Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0)),
        y: Math.max(1, ((plaza.y - (plazaH / 2)) | 0) - 2 - th)
      });

      // Pick the first candidate that fits fully in bounds and has a clear margin
      for (const c of candidates) {
        const nx = Math.max(1, Math.min(W - 2 - tw, c.x));
        const ny = Math.max(1, Math.min(H - 2 - th, c.y));
        const fits = (nx >= 1 && ny >= 1 && nx + tw < W - 1 && ny + th < H - 1);
        // Also ensure the Inn never overlaps the plaza footprint
        if (fits && hasMarginClear(nx, ny, tw, th, 1) && !overlapsPlazaRect(nx, ny, tw, th, 1)) {
          return { x: nx, y: ny, w: tw, h: th, facing: c.side };
        }
      }

      // If none fit with current size, shrink slightly and try again
      tw = Math.max(minW, tw - 2);
      th = Math.max(minH, th - 2);
    }

    // As a last resort, shrink until margin-clear and non-overlap near plaza center
    for (let extraShrink = 0; extraShrink < 6; extraShrink++) {
      const nx = Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0));
      const ny = Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0));
      const fits = (nx >= 1 && ny >= 1 && nx + tw < W - 1 && ny + th < H - 1);
      if (fits && hasMarginClear(nx, ny, tw, th, 1) && !overlapsPlazaRect(nx, ny, tw, th, 1)) {
        return { x: nx, y: ny, w: tw, h: th, facing: "southFacing" };
      }
      tw = Math.max(minW, tw - 2);
      th = Math.max(minH, th - 2);
    }
    // Final minimal placement
    const nx = Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0));
    const ny = Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0));
    return { x: nx, y: ny, w: tw, h: th, facing: "southFacing" };
  }

  const innRect = placeInnRect();

  // Prefer prefab-based Inn stamping when available
  const GD2 = getGameData(ctx);
  const PFB = (GD2 && GD2.prefabs) ? GD2.prefabs : null;
  let usedPrefabInn = false;
  if (PFB && Array.isArray(PFB.inns) && PFB.inns.length) {
    // Prefer the largest inn prefab that fits, to ensure a roomy tavern
    const innsSorted = PFB.inns
      .slice()
      .filter(p => p && p.size && typeof p.size.w === "number" && typeof p.size.h === "number")
      .sort((a, b) => (b.size.w * b.size.h) - (a.size.w * a.size.h));

    // Try stamping centered in innRect; if it doesn't fit, shrink rect and retry a few times
    let bx = innRect.x, by = innRect.y, bw = innRect.w, bh = innRect.h;
    for (let attempts = 0; attempts < 4 && !usedPrefabInn; attempts++) {
      const pref = innsSorted.find(p => p.size.w <= bw && p.size.h <= bh) || null;
      if (pref) {
        const ox = Math.floor((bw - pref.size.w) / 2);
        const oy = Math.floor((bh - pref.size.h) / 2);
        if (stampPrefab(ctx, pref, bx + ox, by + oy)) {
          usedPrefabInn = true;
          rectUsedInn = { x: bx + ox, y: by + oy, w: pref.size.w, h: pref.size.h };
          break;
        }
      }
      bw = Math.max(10, bw - 2);
      bh = Math.max(8, bh - 2);
    }
  }

  // Decide whether to proceed with inn assignment
  if (!usedPrefabInn) {
    // Second pass: try stamping an inn prefab anywhere on the map (largest-first), allowing removal of overlapping buildings
    const GD3 = getGameData(ctx);
    const PFB2 = (GD3 && GD3.prefabs) ? GD3.prefabs : null;
    if (PFB2 && Array.isArray(PFB2.inns) && PFB2.inns.length) {
      const innsSorted2 = PFB2.inns
        .slice()
        .filter(function(p){ return p && p.size && typeof p.size.w === "number" && typeof p.size.h === "number"; })
        .sort(function(a, b){ return (b.size.w * b.size.h) - (a.size.w * a.size.h); });
      let stamped = false;
      for (let ip = 0; ip < innsSorted2.length && !stamped; ip++) {
        const pref = innsSorted2[ip];
        const wInn = pref.size.w | 0, hInn = pref.size.h | 0;
        for (let y = 2; y <= H - hInn - 2 && !stamped; y++) {
          for (let x = 2; x <= W - wInn - 2 && !stamped; x++) {
            // Try stamping directly
            if (stampPrefab(ctx, pref, x, y)) {
              rectUsedInn = { x: x, y: y, w: wInn, h: hInn };
              usedPrefabInn = true;
              stamped = true;
              break;
            }
            // If blocked by existing buildings, remove ALL overlaps and try again
            const overl = findBuildingsOverlappingRect(x, y, wInn, hInn, 0);
            if (overl && overl.length) {
              for (let oi = 0; oi < overl.length; oi++) {
                removeBuildingAndProps(overl[oi]);
              }
              if (stampPrefab(ctx, pref, x, y)) {
                rectUsedInn = { x: x, y: y, w: wInn, h: hInn };
                usedPrefabInn = true;
                stamped = true;
                break;
              }
            }
          }
        }
      }
      // Force a plaza-centered placement by clearing overlaps if none were stamped in the scan
      if (!stamped) {
        const pref0 = innsSorted2[0];
        if (pref0 && pref0.size) {
          const wInn0 = pref0.size.w | 0, hInn0 = pref0.size.h | 0;
          const fx = Math.max(2, Math.min(W - wInn0 - 2, ((plaza.x - ((wInn0 / 2) | 0)) | 0)));
          const fy = Math.max(2, Math.min(H - hInn0 - 2, ((plaza.y - ((hInn0 / 2) | 0)) | 0)));
          const overl0 = findBuildingsOverlappingRect(fx, fy, wInn0, hInn0, 0);
          if (overl0 && overl0.length) {
            for (let oi = 0; oi < overl0.length; oi++) {
              removeBuildingAndProps(overl0[oi]);
            }
          }
          if (stampPrefab(ctx, pref0, fx, fy)) {
            rectUsedInn = { x: fx, y: fy, w: wInn0, h: hInn0 };
            usedPrefabInn = true;
          }
        }
      }
    }
    // As an absolute fallback, carve a hollow-rectangle Inn near the plaza to guarantee an Inn exists
    if (!usedPrefabInn) {
      placeBuilding(innRect.x, innRect.y, innRect.w, innRect.h);
      rectUsedInn = { x: innRect.x, y: innRect.y, w: innRect.w, h: innRect.h };
    }
  }

  // Choose an existing building to replace/represent the inn, prefer the one closest to baseRect center,
  // and ensure the building record matches the actual stamped inn rectangle so furnishing runs correctly.
  const baseRect = rectUsedInn || innRect;
  let targetIdx = -1, bestD = Infinity;
  const cx = (baseRect.x + (baseRect.w / 2)) | 0;
  const cy = (baseRect.y + (baseRect.h / 2)) | 0;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const d = Math.abs((b.x + (b.w / 2)) - cx) + Math.abs((b.y + (b.h / 2)) - cy);
    if (d < bestD) { bestD = d; targetIdx = i; }
  }
  if (targetIdx === -1) {
    // If none available (shouldn't happen), push a new building record
    buildings.push({ x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h });
  } else {
    const prevB = buildings[targetIdx];
    buildings[targetIdx] = {
      x: baseRect.x,
      y: baseRect.y,
      w: baseRect.w,
      h: baseRect.h,
      prefabId: prevB ? prevB.prefabId : null,
      prefabCategory: prevB ? prevB.prefabCategory : null
    };
  }

  // Record the tavern (Inn) building and its preferred door (closest to plaza)
  try {
    const cds = candidateDoors(baseRect);
    let bestDoor = null, bestD2 = Infinity;
    for (const d of cds) {
      if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
        const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
        if (dd < bestD2) { bestD2 = dd; bestDoor = { x: d.x, y: d.y }; }
      }
    }
    // Do not auto-carve doors for the inn; rely solely on prefab DOOR tiles.
    try {
      const bRec = buildings.find(b => b.x === baseRect.x && b.y === baseRect.y && b.w === baseRect.w && b.h === baseRect.h) || null;
      const pid = (bRec && typeof bRec.prefabId !== "undefined") ? bRec.prefabId : null;
      const pcat = (bRec && typeof bRec.prefabCategory !== "undefined") ? bRec.prefabCategory : null;
      if (bestDoor) {
        ctx.tavern = {
          building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h, prefabId: pid, prefabCategory: pcat },
          door: { x: bestDoor.x, y: bestDoor.y }
        };
      } else {
        ctx.tavern = {
          building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h, prefabId: pid, prefabCategory: pcat }
        };
      }
    } catch (_) {
      if (bestDoor) {
        ctx.tavern = { building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h }, door: { x: bestDoor.x, y: bestDoor.y } };
      } else {
        ctx.tavern = { building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h } };
      }
    }
  } catch (_) {}
}