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

// Global in-memory fallback that persists across ctx instances within the same page/session
if (typeof window !== "undefined" && !window._TOWN_STATES_MEM) {
  try { window._TOWN_STATES_MEM = Object.create(null); } catch (_) {}
}

export function key(x, y) { return `${x},${y}`; }

function readLS() {
  try {
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
  // Restore inn upstairs overlay and stairs portal
  ctx.innUpstairs = st.innUpstairs || null;
  // Sanitize legacy upstairs tiles: remove any DOOR/WALL/WINDOW tiles so upstairs has only FLOOR/STAIRS.
  try {
    const up = ctx.innUpstairs;
    if (up && Array.isArray(up.tiles)) {
      const T = ctx.TILES || { WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3, WINDOW: 4 };
      for (let yy = 0; yy < up.tiles.length; yy++) {
        const row = up.tiles[yy];
        if (!Array.isArray(row)) continue;
        for (let xx = 0; xx < row.length; xx++) {
          const t = row[xx];
          if (t !== T.FLOOR && t !== T.STAIRS) row[xx] = T.FLOOR;
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
    if (typeof window !== "undefined" && window.OccupancyFacade && typeof window.OccupancyFacade.rebuild === "function") {
      window.OccupancyFacade.rebuild(ctx);
    } else {
      const TR = ctx.TownRuntime || (typeof window !== "undefined" ? window.TownRuntime : null);
      if (TR && typeof TR.rebuildOccupancy === "function") {
        TR.rebuildOccupancy(ctx);
      } else {
        const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
        if (OG && typeof OG.build === "function") {
          ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
        }
      }
    }
  } catch (_) {}

  // Visual refresh
  try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
  try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
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