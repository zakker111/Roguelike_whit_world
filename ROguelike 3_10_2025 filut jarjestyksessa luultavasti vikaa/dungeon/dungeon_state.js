/**
 * DungeonState: persistence helpers for dungeon maps keyed by overworld entrance.
 *
 * API (ESM + window.DungeonState):
 *   key(x, y) -> "x,y"
 *   save(ctx)
 *   load(ctx, x, y) -> true/false
 *   returnToWorldIfAtExit(ctx) -> true/false
 */

import { getMod } from "../utils/access.js";

const LS_KEY = "DUNGEON_STATES_V1";

// Global in-memory fallback that persists across ctx instances within the same page/session
if (typeof window !== "undefined" && !window._DUNGEON_STATES_MEM) {
  try { window._DUNGEON_STATES_MEM = Object.create(null); } catch (_) {}
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
  // Shallow clone with primitives/arrays suitable for JSON
  const out = {
    map: st.map,
    seen: st.seen,
    visible: st.visible,
    enemies: Array.isArray(st.enemies)
      ? st.enemies.map(e => ({
          x: e.x, y: e.y,
          type: e.type, glyph: e.glyph,
          hp: e.hp, atk: e.atk, xp: e.xp, level: e.level,
          // optional runtime/status fields we want to preserve
          immobileTurns: e.immobileTurns,
          bleedTurns: e.bleedTurns,
          inFlamesTurns: e.inFlamesTurns,
          announced: e.announced
        }))
      : [],
    corpses: Array.isArray(st.corpses)
      ? st.corpses.map(c => ({
          x: c.x, y: c.y,
          kind: c.kind,           // preserve chest vs corpse
          looted: !!c.looted,
          loot: Array.isArray(c.loot) ? c.loot : [],
          // Persist flavor/meta and examination state so revisits keep the death details and prevent repeated spam
          meta: c.meta ? {
            killedBy: c.meta.killedBy,
            wound: c.meta.wound,
            via: c.meta.via
          } : undefined,
          _examined: !!c._examined
        }))
      : [],
    decals: Array.isArray(st.decals) ? st.decals.map(d => ({ x: d.x, y: d.y, a: d.a, r: d.r })) : [],
    dungeonExitAt: st.dungeonExitAt,
    info: st.info,
    level: st.level
  };
  return out;
}

export function save(ctx) {
  if (!ctx) return;
  if (ctx.mode !== "dungeon" || !ctx.dungeonInfo || !ctx.dungeonExitAt) return;
  const k = key(ctx.dungeonInfo.x, ctx.dungeonInfo.y);
  if (!ctx._dungeonStates) ctx._dungeonStates = Object.create(null);
  const snapshot = {
    map: ctx.map,
    seen: ctx.seen,
    visible: ctx.visible,
    enemies: ctx.enemies,
    corpses: ctx.corpses,
    decals: ctx.decals,
    dungeonExitAt: { x: ctx.dungeonExitAt.x, y: ctx.dungeonExitAt.y },
    info: ctx.dungeonInfo,
    level: ctx.floor
  };
  // Store a cloned, JSON-safe copy in memory to avoid aliasing/mutation issues
  ctx._dungeonStates[k] = cloneForStorage(snapshot);

  // Also persist to localStorage so dungeons remain identical on re-entry and across refreshes
  const ls = readLS();
  ls[k] = cloneForStorage(snapshot);
  writeLS(ls);

  // Debug/log summary to help diagnose persistence issues
  try {
    const enemiesCount = Array.isArray(snapshot.enemies) ? snapshot.enemies.length : 0;
    const corpsesCount = Array.isArray(snapshot.corpses) ? snapshot.corpses.length : 0;
    const msg = `DungeonState.save: key ${k}, enemies=${enemiesCount}, corpses=${corpsesCount}`;
    if (window.DEV && ctx.log) ctx.log(msg, "notice");
    try { if (typeof window !== "undefined" && window.DEV && window.Logger && typeof window.Logger.log === "function") window.Logger.log(msg, "notice", { category: "DungeonState" }); } catch (_) {}
  } catch (_) {}
}

function loadFromMemory(ctx, k) {
  if (ctx._dungeonStates && ctx._dungeonStates[k]) return ctx._dungeonStates[k];
  try {
    if (typeof window !== "undefined" && window._DUNGEON_STATES_MEM && window._DUNGEON_STATES_MEM[k]) {
      
      return window._DUNGEON_STATES_MEM[k];
    }
  } catch (_) {}
  return null;
}

function loadFromLS(k) {
  const ls = readLS();
  return ls[k] || null;
}

function applyState(ctx, st, x, y) {
  // Restore basic mode/info/state
  ctx.mode = "dungeon";
  ctx.dungeonInfo = st.info || { x, y, level: st.level || 1, size: "medium" };
  ctx.floor = st.level || 1;

  // Deep references
  ctx.map = st.map;
  ctx.seen = st.seen;
  ctx.visible = st.visible;
  ctx.enemies = st.enemies || [];
  ctx.corpses = st.corpses || [];
  ctx.decals = st.decals || [];
  // Exit tile from saved state or fallback to world entrance
  let ex, ey;
  if (st.dungeonExitAt && typeof st.dungeonExitAt.x === "number" && typeof st.dungeonExitAt.y === "number") {
    ex = st.dungeonExitAt.x; ey = st.dungeonExitAt.y;
  } else {
    ex = x; ey = y;
    
  }

  // Clamp exit to current dungeon map bounds defensively
  try {
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = (rows && Array.isArray(ctx.map[0])) ? ctx.map[0].length : 0;
    if (rows > 0 && cols > 0) {
      ex = Math.max(0, Math.min(cols - 1, ex | 0));
      ey = Math.max(0, Math.min(rows - 1, ey | 0));
    }
  } catch (_) {}
  ctx.dungeonExitAt = { x: ex, y: ey };

  // Place player at the known dungeon exit tile to avoid mismatch
  const prevPX = ctx.player.x, prevPY = ctx.player.y;
  ctx.player.x = ctx.dungeonExitAt.x | 0;
  ctx.player.y = ctx.dungeonExitAt.y | 0;

  // Ensure entrance tile is STAIRS and mark visible/seen
  if (ctx.inBounds(ctx.dungeonExitAt.x, ctx.dungeonExitAt.y)) {
    if (ctx.map[ctx.dungeonExitAt.y] && typeof ctx.map[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] !== "undefined") {
      ctx.map[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = ctx.TILES.STAIRS;
    }
    if (ctx.visible[ctx.dungeonExitAt.y] && typeof ctx.visible[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] !== "undefined") {
      ctx.visible[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
    }
    if (ctx.seen[ctx.dungeonExitAt.y] && typeof ctx.seen[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] !== "undefined") {
      ctx.seen[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
    }
  }

  // Debug: log a concise position summary for entry
  try {
    if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") window.Logger.log("DungeonState.applyState: key " + key(x,y) + ", exit=(" + ctx.dungeonExitAt.x + "," + ctx.dungeonExitAt.y + "), player " + prevPX + "," + prevPY + " -> " + ctx.player.x + "," + ctx.player.y + ", corpses=" + ctx.corpses.length + ", enemies=" + ctx.enemies.length, "notice", { category: "DungeonState" });
    if (window.DEV && ctx.log) ctx.log("DungeonState.applyState: player at (" + ctx.player.x + "," + ctx.player.y + ").", "info");
  } catch (_) {}

  // Refresh via StateSync when available
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  ctx.log(`You re-enter the dungeon (Difficulty ${ctx.floor}${ctx.dungeonInfo.size ? ", " + ctx.dungeonInfo.size : ""}).`, "notice");
}

export function load(ctx, x, y) {
  if (!ctx) return false;
  const k = key(x, y);

  // Prefer in-memory state first
  let st = loadFromMemory(ctx, k);

  // Fallback to localStorage if not in memory
  if (!st) {
    
    st = loadFromLS(k);
  }
  if (!st) {
    try {
      const msg = `DungeonState.load: no state for key ${k}`;
      if (ctx.log) ctx.log(msg, "warn");
      try { if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") window.Logger.log(msg, "warn", { category: "DungeonState" }); } catch (_) {}
    } catch (_) {}
    return false;
  }

  try {
    const enemiesCount = Array.isArray(st.enemies) ? st.enemies.length : 0;
    const corpsesCount = Array.isArray(st.corpses) ? st.corpses.length : 0;
    const msg = `DungeonState.load: key ${k}, enemies=${enemiesCount}, corpses=${corpsesCount}`;
    if (window.DEV && ctx.log) ctx.log(msg, "notice");
    try { if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") window.Logger.log(msg, "notice", { category: "DungeonState" }); } catch (_) {}
  } catch (_) {}

  applyState(ctx, st, x, y);
  return true;
}

export function returnToWorldIfAtExit(ctx) {
  if (!ctx) return false;
  if (ctx.mode !== "dungeon" || !ctx.cameFromWorld || !ctx.world) return false;
  if (ctx.floor !== 1) return false;
  const ex = ctx.dungeonExitAt && ctx.dungeonExitAt.x;
  const ey = ctx.dungeonExitAt && ctx.dungeonExitAt.y;
  if (typeof ex !== "number" || typeof ey !== "number") return false;
  if (ctx.player.x === ex && ctx.player.y === ey) {
    // Save current dungeon state before leaving so corpses/emptied chests persist
    try {
      save(ctx);
    } catch (_) {}

    ctx.mode = "world";
    ctx.enemies = [];
    ctx.corpses = [];
    ctx.decals = [];
    ctx.map = ctx.world.map;
    if (ctx.worldReturnPos) {
      const rx = ctx.worldReturnPos.x | 0;
      const ry = ctx.worldReturnPos.y | 0;
      const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
      if (WR && typeof WR.ensureInBounds === "function" && ctx.world) {
        // Prevent camera snap on expansion
        ctx._suspendExpandShift = true;
        try {
          let lx = rx - (ctx.world.originX | 0);
          let ly = ry - (ctx.world.originY | 0);
          WR.ensureInBounds(ctx, lx, ly, 32);
        } finally {
          ctx._suspendExpandShift = false;
        }
        const lx2 = rx - (ctx.world.originX | 0);
        const ly2 = ry - (ctx.world.originY | 0);
        ctx.player.x = lx2;
        ctx.player.y = ly2;
      } else {
        const lx = rx - (ctx.world.originX | 0);
        const ly = ry - (ctx.world.originY | 0);
        const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
        const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
        ctx.player.x = Math.max(0, Math.min((cols ? cols - 1 : 0), lx));
        ctx.player.y = Math.max(0, Math.min((rows ? rows - 1 : 0), ly));
      }
    }
    // Refresh via StateSync when available
    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
    ctx.log("You return to the overworld.", "notice");
    return true;
  }
  ctx.log("Return to the dungeon entrance to go back to the overworld.", "info");
  return false;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.DungeonState = { key, save, load, returnToWorldIfAtExit };
}