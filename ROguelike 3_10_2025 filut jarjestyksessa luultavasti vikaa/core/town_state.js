/**
 * TownState: persistence helpers for town maps keyed by overworld entry tile.
 *
 * API (ESM + window.TownState):
 *   key(x, y) -> "x,y"
 *   save(ctx)
 *   load(ctx, x, y) -> true/false
 *
 * Notes
 * - We persist the full town map, visibility memory (seen/visible), and town entities (npcs, shops, props).
 * - On load, we restore the player to the saved town gate (townExitAt) and rebuild occupancy.
 * - Storage is kept both in-memory (page session) and localStorage so revisits are stable and memory persists.
 */

const LS_KEY = "TOWN_STATES_V1";

import * as Roads from "../worldgen/roads.js";

// Global in-memory fallback that persists across ctx instances within the same page/session
if (typeof window !== "undefined" && !window._TOWN_STATES_MEM) {
  try { window._TOWN_STATES_MEM = Object.create(null); } catch (_) {}
}

export function key(x, y) { return `${x},${y}`; }

function readLS() {
  try {
    // Allow disabling localStorage via flag (set by URL param fresh=1/reset=1/nolocalstorage=1)
    if (typeof window !== "undefined" && window.NO_LOCALSTORAGE) return Object.create(null);
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return Object.create(null);
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : Object.create(null);
  } catch (_) {
    return Object.create(null);
  }
}

function writeLS(obj) {
  try {
    // Allow disabling localStorage writes via flag (set by URL param fresh=1/reset=1/nolocalstorage=1)
    if (typeof window !== "undefined" && window.NO_LOCALSTORAGE) return;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    }
  } catch (_) {}
}

function cloneForStorage(st) {
  const out = {
    map: st.map,
    seen: st.seen,
    visible: st.visible,
    // Entities and fixtures
    npcs: Array.isArray(st.npcs)
      ? st.npcs.map(n => ({
          x: n.x, y: n.y,
          name: n.name,
          lines: Array.isArray(n.lines) ? n.lines.slice(0) : undefined,
          isShopkeeper: !!n.isShopkeeper,
          greeter: !!n.greeter,
          isSeppo: !!n.isSeppo,
          seppo: !!n.seppo
        }))
      : [],
    shops: Array.isArray(st.shops)
      ? st.shops.map(s => ({
          x: s.x, y: s.y,
          type: s.type, name: s.name,
          openMin: s.openMin, closeMin: s.closeMin, alwaysOpen: !!s.alwaysOpen,
          building: s.building ? { x: s.building.x, y: s.building.y, w: s.building.w, h: s.building.h, door: s.building.door ? { x: s.building.door.x, y: s.building.door.y } : undefined } : null,
          inside: s.inside ? { x: s.inside.x, y: s.inside.y } : null
        }))
      : [],
    townProps: Array.isArray(st.townProps)
      ? st.townProps.map(p => ({ x: p.x, y: p.y, type: p.type, name: p.name }))
      : [],
    townBuildings: Array.isArray(st.townBuildings)
      ? st.townBuildings.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, door: b.door ? { x: b.door.x, y: b.door.y } : undefined }))
      : [],
    townPlaza: st.townPlaza ? { x: st.townPlaza.x, y: st.townPlaza.y } : null,
    tavern: st.tavern ? { building: st.tavern.building ? { x: st.tavern.building.x, y: st.tavern.building.y, w: st.tavern.building.w, h: st.tavern.building.h } : null,
                         door: st.tavern.door ? { x: st.tavern.door.x, y: st.tavern.door.y } : null } : null,
    // Inn upstairs overlay persistence (optional)
    innUpstairs: st.innUpstairs ? {
      offset: st.innUpstairs.offset ? { x: st.innUpstairs.offset.x, y: st.innUpstairs.offset.y } : null,
      w: st.innUpstairs.w | 0,
      h: st.innUpstairs.h | 0,
      tiles: Array.isArray(st.innUpstairs.tiles) ? st.innUpstairs.tiles.map(row => Array.isArray(row) ? row.slice(0) : []) : [],
      props: Array.isArray(st.innUpstairs.props) ? st.innUpstairs.props.map(p => ({ x: p.x, y: p.y, type: p.type, name: p.name })) : []
    } : null,
    innStairsGround: Array.isArray(st.innStairsGround) ? st.innStairsGround.map(s => ({ x: s.x, y: s.y })) : [],
    townExitAt: st.townExitAt ? { x: st.townExitAt.x, y: st.townExitAt.y } : null,
    // Persist roads mask when present (for consistent rendering on revisit)
    townRoads: Array.isArray(st.townRoads) ? st.townRoads : null,
    townName: st.townName || null,
    townSize: st.townSize || null
  };
  return out;
}

export function save(ctx) {
  if (!ctx || ctx.mode !== "town") return;
  // Use the world entry tile as the key (where we will return in overworld)
  const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? (ctx.worldReturnPos.x | 0) : null;
  const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? (ctx.worldReturnPos.y | 0) : null;
  if (wx == null || wy == null) return;
  const k = key(wx, wy);

  if (!ctx._townStates) ctx._townStates = Object.create(null);

  const snapshot = {
    map: ctx.map,
    seen: ctx.seen,
    visible: ctx.visible,
    npcs: ctx.npcs || [],
    shops: ctx.shops || [],
    townProps: ctx.townProps || [],
    townBuildings: ctx.townBuildings || [],
    townPlaza: ctx.townPlaza || null,
    tavern: ctx.tavern || null,
    // Save inn upstairs overlay and stairs portal positions if present
    innUpstairs: ctx.innUpstairs || null,
    innStairsGround: Array.isArray(ctx.innStairsGround) ? ctx.innStairsGround.slice(0) : [],
    townExitAt: ctx.townExitAt || null,
    // Persist roads mask for rendering on reload
    townRoads: Array.isArray(ctx.townRoads) ? ctx.townRoads : null,
    townName: ctx.townName || null,
    townSize: ctx.townSize || null
  };

  const cloned = cloneForStorage(snapshot);
  ctx._townStates[k] = cloned;
  try { if (typeof window !== "undefined" && window._TOWN_STATES_MEM) window._TOWN_STATES_MEM[k] = cloned; } catch (_) {}

  const ls = readLS();
  ls[k] = cloned;
  writeLS(ls);

  try {
    const npcCount = Array.isArray(snapshot.npcs) ? snapshot.npcs.length : 0;
    const shopCount = Array.isArray(snapshot.shops) ? snapshot.shops.length : 0;
    const msg = `TownState.save: key ${k}, npcs=${npcCount}, shops=${shopCount}`;
    if (typeof window !== "undefined" && window.DEV && ctx.log) ctx.log(msg, "notice");
    console.log(msg);
  } catch (_) {}
}

function loadFromMemory(ctx, k) {
  if (ctx._townStates && ctx._townStates[k]) return ctx._townStates[k];
  try {
    if (typeof window !== "undefined" && window._TOWN_STATES_MEM && window._TOWN_STATES_MEM[k]) {
      return window._TOWN_STATES_MEM[k];
    }
  } catch (_) {}
  return null;
}

function loadFromLS(k) {
  const ls = readLS();
  return ls[k] || null;
}

function applyState(ctx, st, x, y) {
  ctx.mode = "town";
  // Basic state
  ctx.map = st.map;
  ctx.seen = st.seen;
  ctx.visible = st.visible;
  ctx.npcs = Array.isArray(st.npcs) ? st.npcs : [];
  ctx.shops = Array.isArray(st.shops) ? st.shops : [];
  ctx.townProps = Array.isArray(st.townProps) ? st.townProps : [];
  ctx.townBuildings = Array.isArray(st.townBuildings) ? st.townBuildings : [];
  ctx.townPlaza = st.townPlaza || null;
  ctx.tavern = st.tavern || null;
  // Roads mask (optional): use persisted mask if present
  ctx.townRoads = Array.isArray(st.townRoads) ? st.townRoads : null;

  // Sanitize loaded props to avoid stale/dangling remnants from older saves or generation changes.
  // - Drop props outside bounds or sitting on non-walkable tiles (only FLOOR/STAIRS allowed).
  // - Enforce interior-only props to exist only inside some building.
  // - Deduplicate exact coordinate duplicates (keep first).
  (function sanitizeLoadedTownProps() {
    try {
      const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
      const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
      function inB(x, y) { return y >= 0 && y < rows && x >= 0 && x < cols; }
      function insideAnyBuilding(x, y) {
        const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
        for (let i = 0; i < tbs.length; i++) {
          const B = tbs[i];
          if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
        }
        return false;
      }
      const interiorOnly = new Set(["bed","table","chair","shelf","rug","fireplace","quest_board","chest","counter"]);
      const seenCoord = new Set();
      const before = Array.isArray(ctx.townProps) ? ctx.townProps.length : 0;
      const filtered = [];
      const props = Array.isArray(ctx.townProps) ? ctx.townProps : [];
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        if (!p) continue;
        const x = p.x | 0, y = p.y | 0;
        const key = `${x},${y}`;
        // Deduplicate exact coordinate duplicates (keep the first encountered)
        if (seenCoord.has(key)) continue;
        seenCoord.add(key);
        // Bounds and tile check
        if (!inB(x, y)) continue;
        const t = ctx.map[y][x];
        if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.STAIRS && t !== ctx.TILES.ROAD) continue;
        // Interior-only filtering
        const typ = String(p.type || "").toLowerCase();
        if (interiorOnly.has(typ) && !insideAnyBuilding(x, y)) continue;
        // Keep
        filtered.push({ x, y, type: p.type, name: p.name });
      }
      ctx.townProps = filtered;
      try {
        const removed = before - filtered.length;
        if (removed > 0) {
          const msg = `TownState: sanitized ${removed} dangling props on load.`;
          if (typeof window !== "undefined" && window.DEV && ctx.log) ctx.log(msg, "warn");
          console.log(msg);
        }
      } catch (_) {}
    } catch (_) {}
  })();

  // Restore inn upstairs overlay and stairs portal
  ctx.innUpstairs = st.innUpstairs || null;
  // Sanitize legacy upstairs tiles: convert DOOR/WINDOW to FLOOR; keep WALL/STAIRS intact.
  try {
    const up = ctx.innUpstairs;
    if (up && Array.isArray(up.tiles)) {
      const T = ctx.TILES || { WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3, WINDOW: 4 };
      for (let yy = 0; yy < up.tiles.length; yy++) {
        const row = up.tiles[yy];
        if (!Array.isArray(row)) continue;
        for (let xx = 0; xx < row.length; xx++) {
          const t = row[xx];
          if (t === T.DOOR || t === T.WINDOW) row[xx] = T.FLOOR;
        }
      }
    }
  } catch (_) {}
  ctx.innStairsGround = Array.isArray(st.innStairsGround) ? st.innStairsGround : [];
  ctx.innUpstairsActive = false;
  ctx.townExitAt = st.townExitAt || null;
  ctx.townName = st.townName || ctx.townName || null;
  ctx.townSize = st.townSize || ctx.townSize || null;

  // Ensure we can return to the same overworld tile on exit
  ctx.worldReturnPos = { x, y };

  // Build roads mask if missing (for loaded towns saved before roads were persisted)
  (function rebuildTownRoadsMaskOnLoad() {
    try {
      const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
      const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
      if (!rows || !cols) return;

      // If a mask exists and matches current dimensions, keep it
      if (Array.isArray(ctx.townRoads) && ctx.townRoads.length === rows && Array.isArray(ctx.townRoads[0]) && ctx.townRoads[0].length === cols) return;

      // Build outdoor mask (FLOOR outside buildings) so subsequent road logic can reference it
      (function ensureOutdoorMask() {
        try {
          const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
          function insideAnyBuilding(x, y) {
            const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
            for (let i = 0; i < tbs.length; i++) {
              const B = tbs[i];
              if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
            }
            return false;
          }
          for (let yy = 0; yy < rows; yy++) {
            for (let xx = 0; xx < cols; xx++) {
              const t = ctx.map[yy][xx];
              if (t === ctx.TILES.FLOOR && !insideAnyBuilding(xx, yy)) {
                mask[yy][xx] = true;
              }
            }
          }
          ctx.townOutdoorMask = mask;
        } catch (_) {}
      })();

      // Prefer deriving mask directly from ROAD tiles in the current map
      let anyRoad = false;
      const roadsMask = Array.from({ length: rows }, () => Array(cols).fill(false));
      for (let yy = 0; yy < rows; yy++) {
        for (let xx = 0; xx < cols; xx++) {
          if (ctx.map[yy][xx] === ctx.TILES.ROAD) {
            roadsMask[yy][xx] = true;
            anyRoad = true;
          }
        }
      }

      if (!anyRoad) {
        // Legacy save: rebuild roads using the generator helper, then derive mask from ROAD tiles
        try {
          // Import on demand to avoid hard dependency when not needed
          const Roads = (typeof window !== "undefined" && window.Roads) ? window.Roads : null;
          if (Roads && typeof Roads.build === "function") {
            Roads.build(ctx);
          }
        } catch (_) {}
        // Derive mask again after potential rebuild
        for (let yy = 0; yy < rows; yy++) {
          for (let xx = 0; xx < cols; xx++) {
            roadsMask[yy][xx] = (ctx.map[yy][xx] === ctx.TILES.ROAD);
          }
        }
      }

      ctx.townRoads = roadsMask;
    } catch (_) {}
  })();

  // Ensure town biome is set on load (use persisted world.towns biome or infer from surrounding world tiles)
  try {
    // Clear any stale outdoor mask from a previous town; it will be rebuilt for this map
    try { ctx.townOutdoorMask = undefined; } catch (_) {}

    // Prefer persisted record
    const rec = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t && t.x === x && t.y === y) : null;
    if (rec && rec.biome) {
      ctx.townBiome = rec.biome;
      try { if (ctx.log) ctx.log(`TownState: using persisted biome '${ctx.townBiome}' at ${x},${y}.`, "notice"); } catch (_) {}
    } else {
      const WMOD = (typeof window !== "undefined" ? window.World : null);
      const WT = WMOD && WMOD.TILES ? WMOD.TILES : null;
      const world = ctx.world || {};
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
      let counts = { DESERT:0, SNOW:0, BEACH:0, SWAMP:0, FOREST:0, GRASS:0 };
      function bump(tile) {
        if (!WT) return;
        if (tile === WT.DESERT) counts.DESERT++;
        else if (tile === WT.SNOW) counts.SNOW++;
        else if (tile === WT.BEACH) counts.BEACH++;
        else if (tile === WT.SWAMP) counts.SWAMP++;
        else if (tile === WT.FOREST) counts.FOREST++;
        else if (tile === WT.GRASS) counts.GRASS++;
      }
      const MAX_R = 6;
      for (let r = 1; r <= MAX_R; r++) {
        let any = false;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const t = worldTileAtAbs(x + dx, y + dy);
            if (t == null) continue;
            if (WT && (t === WT.TOWN || t === WT.DUNGEON || t === WT.RUINS)) continue;
            bump(t);
            any = true;
          }
        }
        const total = counts.DESERT + counts.SNOW + counts.BEACH + counts.SWAMP + counts.FOREST + counts.GRASS;
        if (any && total > 0) break;
      }
      // Prefer nearest non-POI biome tile within a small radius to match the local anchor, else fall back to counts with tie-break.
      function nearestBiomeTile() {
        const dirs = [
          {dx: 1, dy: 0}, {dx: -1, dy: 0}, {dx: 0, dy: 1}, {dx: 0, dy: -1},
          {dx: 1, dy: 1}, {dx: 1, dy: -1}, {dx: -1, dy: 1}, {dx: -1, dy: -1},
        ];
        const MAX_NEAR = 3;
        for (let r = 1; r <= MAX_NEAR; r++) {
          for (let i = 0; i < dirs.length; i++) {
            const nx = x + dirs[i].dx * r;
            const ny = y + dirs[i].dy * r;
            const t = worldTileAtAbs(nx, ny);
            if (t == null) continue;
            if (WT && (t === WT.TOWN || t === WT.DUNGEON || t === WT.RUINS)) continue;
            if (t === WT.FOREST) return "FOREST";
            if (t === WT.SNOW)   return "SNOW";
            if (t === WT.SWAMP)  return "SWAMP";
            if (t === WT.GRASS)  return "GRASS";
            if (t === WT.DESERT) return "DESERT";
            if (t === WT.BEACH)  return "BEACH";
          }
        }
        return null;
      }
      const nearPick = nearestBiomeTile();
      if (nearPick) {
        ctx.townBiome = nearPick;
      } else {
        // Tie-break priority favors FOREST/SNOW/SWAMP over GRASS/DESERT/BEACH
        const order = ["FOREST","SNOW","SWAMP","GRASS","DESERT","BEACH"];
        let best = "GRASS", bestV = -1;
        for (const k2 of order) { const v = counts[k2] | 0; if (v > bestV) { bestV = v; best = k2; } }
        ctx.townBiome = best || "GRASS";
      }
      // Persist for next load
      try { if (rec && typeof rec === "object") rec.biome = ctx.townBiome; } catch (_) {}
      // Report inference details
      try {
        if (ctx.log) {
          ctx.log(`TownState: inferred biome at ${x},${y}: nearest=${nearPick || "none"}, counts F=${counts.FOREST|0} G=${counts.GRASS|0} D=${counts.DESERT|0} B=${counts.BEACH|0} S=${counts.SNOW|0} W=${counts.SWAMP|0}; chosen=${ctx.townBiome}`, "notice");
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Place player at the town gate (exit tile) if available
  try {
    const ex = (ctx.townExitAt && typeof ctx.townExitAt.x === "number") ? (ctx.townExitAt.x | 0) : null;
    const ey = (ctx.townExitAt && typeof ctx.townExitAt.y === "number") ? (ctx.townExitAt.y | 0) : null;
    if (ex != null && ey != null) {
      ctx.player.x = ex; ctx.player.y = ey;
    } else {
      // Fallback: near center
      const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
      const cols = (rows && Array.isArray(ctx.map[0])) ? ctx.map[0].length : 0;
      ctx.player.x = Math.max(1, Math.min(cols - 2, ctx.player.x | 0));
      ctx.player.y = Math.max(1, Math.min(rows - 2, ctx.player.y | 0));
    }
  } catch (_) {}

  // Rebuild occupancy (centralized)
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}

  // Re-link shop references to nearby shopkeepers when loading from persistence.
  // NPC snapshots do not carry _shopRef, so attach by proximity to the shop door or interior.
  (function relinkShopsToKeepers() {
    try {
      const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
      const shops = Array.isArray(ctx.shops) ? ctx.shops : [];
      for (const s of shops) {
        if (!s) continue;
        let best = null;
        let bestScore = Infinity;
        for (const n of npcs) {
          if (!n || !n.isShopkeeper) continue;
          // Determine if inside the building footprint
          let inside = false;
          try {
            const b = s.building || null;
            if (b) inside = (n.x > b.x && n.x < b.x + b.w - 1 && n.y > b.y && n.y < b.y + b.h - 1);
          } catch (_) {}
          const dx = Math.abs(n.x - s.x), dy = Math.abs(n.y - s.y);
          const nearDoor = (dx + dy) === 1 || Math.max(dx, dy) <= 1;
          const close = (dx + dy) <= 2;
          if (inside || nearDoor || close) {
            const score = inside ? 0 : (nearDoor ? 1 : (dx + dy));
            if (score < bestScore) { bestScore = score; best = n; }
          }
        }
        if (best && !best._shopRef) {
          best._shopRef = s;
        }
      }
    } catch (_) {}
  })();

  // Visual refresh via StateSync when available
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      if (typeof ctx.updateCamera === "function") ctx.updateCamera();
      if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
      if (typeof ctx.updateUI === "function") ctx.updateUI();
      if (typeof ctx.requestDraw === "function") ctx.requestDraw();
    }
  } catch (_) {}
  try {
    const name = ctx.townName ? `the town of ${ctx.townName}` : "the town";
    ctx.log && ctx.log(`You re-enter ${name}.`, "notice");
  } catch (_) {}
}

export function load(ctx, x, y) {
  if (!ctx) return false;
  const k = key(x, y);

  // Prefer in-memory state
  let st = loadFromMemory(ctx, k);
  if (!st) st = loadFromLS(k);
  if (!st) {
    try {
      const msg = `TownState.load: no state for key ${k}`;
      if (ctx.log) ctx.log(msg, "warn");
      console.log(msg);
    } catch (_) {}
    return false;
  }

  try {
    const npcCount = Array.isArray(st.npcs) ? st.npcs.length : 0;
    const shopCount = Array.isArray(st.shops) ? st.shops.length : 0;
    const msg = `TownState.load: key ${k}, npcs=${npcCount}, shops=${shopCount}`;
    if (typeof window !== "undefined" && window.DEV && ctx.log) ctx.log(msg, "notice");
    console.log(msg);
  } catch (_) {}

  applyState(ctx, st, x, y);
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.TownState = { key, save, load };
}