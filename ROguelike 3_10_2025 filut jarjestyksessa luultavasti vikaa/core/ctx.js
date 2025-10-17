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
  const rng = typeof ctx.rng === "function"
    ? ctx.rng
    : ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
        ? window.RNG.rng
        : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
            ? window.RNGFallback.getRng()
            : Math.random));
  const round1 = (ctx.PlayerUtils && typeof ctx.PlayerUtils.round1 === "function")
    ? ctx.PlayerUtils.round1
    : (n) => Math.round(n * 10) / 10;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
  const chance = (p) => rng() < p;
  const randFloat = (min, max, decimals = 1) => {
    const v = min + rng() * (max - min);
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  };
  const pick = (arr, rfn) => {
    const r = rfn || rng;
    return arr[Math.floor(r() * arr.length)];
  };
  const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  ctx.utils = { round1, clamp, randInt, chance, randFloat, pick, capitalize };
  return ctx;
}

export function ensureLOS(ctx) {
  // Prefer shared LOS module if present (attached via attachModules or on window)
  if (ctx.LOS && typeof ctx.LOS.tileTransparent === "function" && typeof ctx.LOS.hasLOS === "function") {
    ctx.los = ctx.LOS;
    return ctx;
  }
  if (typeof window !== "undefined" && window.LOS && typeof window.LOS.tileTransparent === "function" && typeof window.LOS.hasLOS === "function") {
    ctx.los = window.LOS;
    return ctx;
  }

  // Fallback lightweight LOS
  function tileTransparent(c, x, y) {
    if (!c.inBounds || !c.inBounds(x, y)) return false;
    return c.map[y][x] !== c.TILES.WALL;
  }
  function hasLOS(c, x0, y0, x1, y1) {
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
  if (!ctx.los) ctx.los = { tileTransparent, hasLOS };
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

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.Ctx = { create, attachModules };
}