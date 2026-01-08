/**
 * Ctx: shared context factory so modules consume a single ctx object
 * instead of importing each other via window.*.
 *
 * Exports (ESM + window.Ctx):
 * - create(base): returns a normalized ctx with consistent shape and optional module handles attached
 * - attachModules(ctx): attaches discovered module handles to the ctx (Enemies, Items, Player, UI, Logger, Loot, Dungeon, DungeonItems, FOV, AI, Input, Render, Tileset, Flavor, PlayerUtils, LOS, etc.)
 *
 * Notes:
 * - Modules should read from ctx only; avoid direct window.* lookups when using ctx.
 * - Utilities on ctx.utils are deterministic when ctx.rng is provided.
 */

// Shallow clone helper
function shallowClone(obj) {
  const out = {};
  for (const k in obj) out[k] = obj[k];
  return out;
}

export function attachModules(ctx) {
  // Provide optional references so modules can avoid window lookups
  // Only attach if present in the page; safe to ignore otherwise.
  if (typeof window !== "undefined") {
    if (window.Enemies) ctx.Enemies = window.Enemies;
    if (window.Items) ctx.Items = window.Items;
    if (window.Player) ctx.Player = window.Player;
    if (window.UI) ctx.UI = window.UI;
    if (window.Logger) ctx.Logger = window.Logger;
    if (window.Loot) ctx.Loot = window.Loot;
    if (window.Dungeon) ctx.Dungeon = window.Dungeon;
    if (window.DungeonItems) ctx.DungeonItems = window.DungeonItems;
    if (window.FOV) ctx.FOV = window.FOV;
    if (window.AI) ctx.AI = window.AI;
    if (window.Input) ctx.Input = window.Input;
    if (window.Actions) ctx.Actions = window.Actions;
    if (window.Render) ctx.Render = window.Render;
    if (window.Tileset) ctx.Tileset = window.Tileset;
    if (window.Flavor) ctx.Flavor = window.Flavor;
    if (window.PlayerUtils) ctx.PlayerUtils = window.PlayerUtils;
    if (window.LOS) ctx.LOS = window.LOS;
    if (window.Utils) ctx.Utils = window.Utils;
    // Added: world/town/dungeon persistence modules needed by Actions/Modes
    if (window.World) ctx.World = window.World;
    if (window.Town) ctx.Town = window.Town;
    if (window.TownAI) ctx.TownAI = window.TownAI;
    if (window.DungeonState) ctx.DungeonState = window.DungeonState;
    // Runtime facades
    if (window.DungeonRuntime) ctx.DungeonRuntime = window.DungeonRuntime;
    if (window.TownRuntime) ctx.TownRuntime = window.TownRuntime;
    if (window.RegionMapRuntime) ctx.RegionMapRuntime = window.RegionMapRuntime;
    if (window.Modes) ctx.Modes = window.Modes;
    // UI facades
    if (window.UIBridge) ctx.UIBridge = window.UIBridge;
    if (window.ShopUI) ctx.ShopUI = window.ShopUI;
    // Services (guarantee via ctx for shop/time helpers)
    if (window.ShopService) ctx.ShopService = window.ShopService;
    if (window.TimeService) ctx.TimeService = window.TimeService;
    if (window.Combat) ctx.Combat = window.Combat;
    if (window.Stats) ctx.Stats = window.Stats;
    // Misc helpers used by modules
    if (window.Decals) ctx.Decals = window.Decals;
    if (window.Status) ctx.Status = window.Status;
    if (window.OccupancyGrid) ctx.OccupancyGrid = window.OccupancyGrid;
    if (window.God) ctx.God = window.God;
    if (window.GameLoop) ctx.GameLoop = window.GameLoop;
  }
  return ctx;
}

export function ensureUtils(ctx) {
  // RNG must come from ctx.rng or RNGUtils; no RNGFallback/Math.random in Phase B
  let rng = null;
  try {
    if (window.Flavor) ctx.Flavor = window.Flavor;
  } catch (_) {}

  try {
    if (window.FollowersFlavor) ctx.FollowersFlavor = window.FollowersFlavor;
  } catch (_) {}

  const round1 = (ctx.PlayerUtils && typeof ctx.PlayerUtils.round1 === "function")
    ? ctx.PlayerUtils.round1
    : (n) => Math.round(n * 10) / 10;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // RNGUtils helpers when present; deterministic fallbacks when rng is unavailable
  const randInt = (min, max) => {
    try {
      const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
      if (RU && typeof RU.int === "function" && typeof rng === "function") {
        return RU.int(min, max, rng);
      }
    } catch (_) {}
    // Deterministic midpoint fallback
    return Math.floor((min + max) / 2);
  };
  const chance = (p) => {
    try {
      const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
      if (RU && typeof RU.chance === "function" && typeof rng === "function") {
        return RU.chance(p, rng);
      }
    } catch (_) {}
    // Deterministic: no random gating when rng unavailable
    return false;
  };
  const randFloat = (min, max, decimals = 1) => {
    try {
      const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
      if (RU && typeof RU.float === "function" && typeof rng === "function") {
        return RU.float(min, max, decimals, rng);
      }
    } catch (_) {}
    // Deterministic midpoint
    const v = (min + max) / 2;
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  };

  const pick = (arr, rfn) => {
    // Deterministic: choose first when rng unavailable
    const rf = (typeof rfn === "function") ? rfn : rng;
    if (typeof rf === "function") {
      const idx = Math.floor(rf() * arr.length);
      return arr[idx];
    }
    return arr[0];
  };
  const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  ctx.utils = { round1, clamp, randInt, chance, randFloat, pick, capitalize };
  return ctx;
}

export function ensureLOS(ctx) {
  // Build a wrapper LOS that honors the inn upstairs overlay when active.
  // Use any existing LOS implementation as a fallback for non-inn tiles.
  const baseLOS =
    (ctx.LOS && typeof ctx.LOS.tileTransparent === "function" && typeof ctx.LOS.hasLOS === "function") ? ctx.LOS :
    ((typeof window !== "undefined" && window.LOS && typeof window.LOS.tileTransparent === "function" && typeof window.LOS.hasLOS === "function") ? window.LOS : null);

  function insideInnInterior(c, x, y) {
    try {
      const tav = c.tavern && c.tavern.building ? c.tavern.building : null;
      const up = c.innUpstairs;
      if (!c.innUpstairsActive || !tav || !up) return false;
      const ox = up.offset ? up.offset.x : (tav.x + 1);
      const oy = up.offset ? up.offset.y : (tav.y + 1);
      const w = up.w | 0, h = up.h | 0;
      return x >= ox && x < ox + w && y >= oy && y < oy + h;
    } catch (_) { return false; }
  }

  function overlayTileAt(c, x, y) {
    try {
      const tav = c.tavern && c.tavern.building ? c.tavern.building : null;
      const up = c.innUpstairs;
      if (!c.innUpstairsActive || !tav || !up) return null;
      const ox = up.offset ? up.offset.x : (tav.x + 1);
      const oy = up.offset ? up.offset.y : (tav.y + 1);
      const lx = x - ox, ly = y - oy;
      if (ly < 0 || lx < 0 || ly >= (up.h | 0) || lx >= (up.w | 0)) return null;
      const row = (up.tiles && up.tiles[ly]) ? up.tiles[ly] : null;
      if (!row) return null;
      return row[lx];
    } catch (_) { return null; }
  }

  function tileTransparent(c, x, y) {
    if (!c.inBounds || !c.inBounds(x, y)) return false;
    // When upstairs overlay is active and within the inn interior, honor upstairs tiles for transparency.
    if (insideInnInterior(c, x, y)) {
      const t = overlayTileAt(c, x, y);
      if (t == null) return (c.map[y][x] !== c.TILES.WALL);
      // Treat WALL as opaque; others transparent (DOOR/STAIRS/FLOOR).
      return t !== c.TILES.WALL;
    }
    // Fallback to base LOS module if present, else local rule.
    if (baseLOS && typeof baseLOS.tileTransparent === "function") {
      return !!baseLOS.tileTransparent(c, x, y);
    }
    return c.map[y][x] !== c.TILES.WALL;
  }

  function hasLOS(c, x0, y0, x1, y1) {
    // Bresenham using overlay-aware transparency
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, e2;
    while (!(x0 === x1 && y0 === y1)) {
      e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) break;
      if (!tileTransparent(c, x0, y0)) return false;
    }
    return true;
  }

  ctx.los = { tileTransparent, hasLOS };
  return ctx;
}

export function create(base) {
  const ctx = shallowClone(base || {});
  // Attach module handles as conveniences to discourage window.* usage in modules
  attachModules(ctx);
  // Provide shared helpers
  ensureUtils(ctx);
  ensureLOS(ctx);
  // Optionally, freeze shallowly to prevent accidental mutation of the ctx contract by modules
  // Return non-frozen to keep flexibility; if desired, uncomment the next line:
  // return Object.freeze(ctx);
  return ctx;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Ctx", { create, attachModules });