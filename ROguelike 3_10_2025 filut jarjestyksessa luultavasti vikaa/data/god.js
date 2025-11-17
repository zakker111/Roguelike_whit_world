/**
 * GOD utilities: cheat/debug helpers wired through ctx.
 *
 * API (ESM + window.God):
 *   heal(ctx)
 *   spawnStairsHere(ctx)
 *   spawnItems(ctx, count)
 *   spawnEnemyNearby(ctx, count)
 *   setAlwaysCrit(ctx, enabled)
 *   setCritPart(ctx, part)
 *   applySeed(ctx, seedUint32)
 *   rerollSeed(ctx)
 *   clearGameStorage(ctx)
 */
import { attachGlobal } from "../utils/global.js";
import { getMod } from "../utils/access.js";

export function heal(ctx) {
  const prev = ctx.player.hp;
  ctx.player.hp = ctx.player.maxHp;
  if (ctx.player.hp > prev) ctx.log(`GOD: You are fully healed (${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)} HP).`, "good");
  else ctx.log(`GOD: HP already full (${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "warn");
  ctx.updateUI();
  // Pure HUD update; no canvas change -> no draw
}

export function spawnStairsHere(ctx) {
  const x = ctx.player.x, y = ctx.player.y;
  if (!ctx.inBounds(x, y)) { ctx.log("GOD: Cannot place stairs out of bounds.", "warn"); return; }
  ctx.map[y][x] = ctx.TILES.STAIRS;
  ctx.seen[y][x] = true;
  ctx.visible[y][x] = true;
  ctx.log("GOD: Stairs appear beneath your feet.", "notice");
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
}

export function spawnItems(ctx, count = 3) {
  const created = [];
  for (let i = 0; i < count; i++) {
    let it = null;
    if (ctx.Items && typeof ctx.Items.createEquipment === "function") {
      const tier = Math.min(3, Math.max(1, Math.floor((ctx.floor + 1) / 2)));
      it = ctx.Items.createEquipment(tier, ctx.rng);
    } else if (ctx.DungeonItems && ctx.DungeonItems.lootFactories && typeof ctx.DungeonItems.lootFactories === "object") {
      const keys = Object.keys(ctx.DungeonItems.lootFactories);
      if (keys.length > 0) {
        const k = keys[Math.floor(ctx.rng() * keys.length)];
        try { it = ctx.DungeonItems.lootFactories[k](ctx, { tier: 2 }); } catch (_) {}
      }
    }
    if (!it) {
      if (ctx.rng() < 0.5) it = { kind: "equip", slot: "hand", name: "debug sword", atk: 1.5, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 0) };
      else it = { kind: "equip", slot: "torso", name: "debug armor", def: 1.0, tier: 2, decay: (ctx.initialDecay ? ctx.initialDecay(2) : 0) };
    }
    ctx.player.inventory.push(it);
    if (ctx.describeItem) created.push(ctx.describeItem(it));
  }
  if (created.length) {
    ctx.log(`GOD: Spawned ${created.length} item${created.length > 1 ? "s" : ""}:`);
    created.forEach(n => ctx.log(`- ${n}`));
    ctx.updateUI();
    if (ctx.renderInventory) ctx.renderInventory();
    // Inventory/UI changes only; let engine coalesce draw if needed
    try { ctx.rerenderInventoryIfOpen && ctx.rerenderInventoryIfOpen(); } catch (_) {}
  }
}

export function spawnEnemyNearby(ctx, count = 1) {
  // Enemy spawning is supported in dungeon mode only
  if (ctx.mode !== "dungeon") {
    ctx.log("GOD: Enemy spawn works in dungeon mode only.", "warn");
    return;
  }

  // Keep a cyclic cursor to force variety across clicks
  window.GOD_SPAWN_CYCLE = window.GOD_SPAWN_CYCLE || { list: [], idx: 0 };

  // Build a type list from registry only (JSON-registered), once
  (function ensureTypeCycle() {
    if (window.GOD_SPAWN_CYCLE.list.length > 0) return;
    try {
      const EM = (typeof window !== "undefined" ? window.Enemies : null);
      let types = [];
      if (EM && typeof EM.listTypes === "function") {
        types = EM.listTypes();
      }
      // Deterministic shuffle using ctx.rng so order differs per seed
      const list = (types || []).slice(0);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1));
        const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      }
      window.GOD_SPAWN_CYCLE.list = list;
      window.GOD_SPAWN_CYCLE.idx = 0;
    } catch (_) {
      window.GOD_SPAWN_CYCLE.list = [];
      window.GOD_SPAWN_CYCLE.idx = 0;
    }
  })();

  const isFreeFloor = (x, y) => {
    try {
      if (!ctx.inBounds(x, y)) return false;
      // Prefer generalized walkability over strict FLOOR to allow doors, etc.
      const walkable = (typeof ctx.isWalkable === "function") ? ctx.isWalkable(x, y) : (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.STAIRS);
      if (!walkable) return false;
      if (ctx.player.x === x && ctx.player.y === y) return false;
      // Prefer occupancy grid if available to avoid stale blocking
      const occEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function") ? ctx.occupancy.hasEnemy(x, y) : ctx.enemies.some(e => e && e.x === x && e.y === y);
      if (occEnemy) return false;
      return true;
    } catch (_) {
      return false;
    }
  };

  const pickNearby = () => {
    // Prefer spawning within radius <= 5 around player when possible
    const maxR = 5;
    const px = ctx.player.x | 0;
    const py = ctx.player.y | 0;

    // Scan rings from r=1..maxR; randomize order per ring
    for (let r = 1; r <= maxR; r++) {
      const candidates = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dy) !== r) continue; // perimeter of Manhattan ring
          const x = px + dx;
          const y = py + dy;
          if (isFreeFloor(x, y)) candidates.push({ x, y });
        }
      }
      if (candidates.length) {
        // Deterministic shuffle using ctx.rng
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(ctx.rng() * (i + 1));
          const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
        }
        return candidates[0];
      }
    }

    // Fallback: choose nearest free tile on the entire map
    let best = null;
    let bestD = Infinity;
    const rows = ctx.map.length;
    const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!isFreeFloor(x, y)) continue;
        const md = Math.abs(x - px) + Math.abs(y - py);
        if (md < bestD) { bestD = md; best = { x, y }; }
      }
    }
    return best;
  };

  function linearAt(arr, depth, fallback = 1) {
    if (!Array.isArray(arr) || arr.length === 0) return fallback;
    let chosen = arr[0];
    for (const e of arr) { if ((e[0] | 0) <= depth) chosen = e; }
    const minD = chosen[0] | 0, baseV = Number(chosen[1] || fallback), slope = Number(chosen[2] || 0);
    const delta = Math.max(0, depth - minD);
    return Math.max(1, Math.floor(baseV + slope * delta));
  }

  const spawned = [];
  // Abort if no registered enemy types
  if (!Array.isArray(window.GOD_SPAWN_CYCLE.list) || window.GOD_SPAWN_CYCLE.list.length === 0) {
    ctx.log("GOD: No enemy types registered (data/entities/enemies.json not loaded).", "warn");
    return;
  }
  for (let i = 0; i < count; i++) {
    const spot = pickNearby();
    if (!spot) break;

    // Cycle pick to force variety
    const pickKey = window.GOD_SPAWN_CYCLE.list[window.GOD_SPAWN_CYCLE.idx % window.GOD_SPAWN_CYCLE.list.length];
    window.GOD_SPAWN_CYCLE.idx++;

    // Prefer ctx.enemyFactory; else build from Enemies registry; no other fallbacks
    let ee = null;
    try {
      if (typeof ctx.enemyFactory === "function") {
        ee = ctx.enemyFactory(spot.x, spot.y, ctx.floor);
      }
    } catch (_) {}

    if (!ee || typeof ee.x !== "number" || typeof ee.y !== "number") {
      const EM = (typeof window !== "undefined" ? window.Enemies : null);
      if (EM && typeof EM.getTypeDef === "function") {
        const td = EM.getTypeDef(pickKey);
        if (td) {
          ee = {
            x: spot.x, y: spot.y,
            type: pickKey,
            glyph: td.glyph ? td.glyph : ((pickKey && pickKey.length) ? pickKey.charAt(0) : "?"),
            hp: td.hp(ctx.floor),
            atk: td.atk(ctx.floor),
            xp: td.xp(ctx.floor),
            level: (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(pickKey, ctx.floor, ctx.rng) : ctx.floor,
            announced: false
          };
        }
      }
    }

    if (!ee) {
      // Fallback enemy: visible '?' for debugging missing types
      ee = { x: spot.x, y: spot.y, type: pickKey || "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: ctx.floor, announced: false };
      ctx.log(`GOD: Fallback spawned for '${pickKey}' (not defined).`, "warn");
    }

    if (typeof ee.hp === "number" && ctx.rng() < 0.7) {
      const mult = 0.85 + ctx.rng() * 0.5;
      ee.hp = Math.max(1, Math.round(ee.hp * mult));
    }
    if (typeof ee.atk === "number" && ctx.rng() < 0.7) {
      const multA = 0.85 + ctx.rng() * 0.5;
      ee.atk = Math.max(0.1, Math.round(ee.atk * multA * 10) / 10);
    }
    ee.announced = false;

    ctx.enemies.push(ee);
    spawned.push(ee);
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    ctx.log(`GOD: Spawned ${cap(ee.type || "enemy")} Lv ${ee.level || 1} at (${ee.x},${ee.y}).`, "notice");
  }

  if (spawned.length) {
    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
  } else {
    ctx.log("GOD: No free space to spawn an enemy nearby.", "warn");
  }
}

export function setAlwaysCrit(ctx, enabled) {
  ctx.alwaysCrit = !!enabled;
  try { window.ALWAYS_CRIT = ctx.alwaysCrit; localStorage.setItem("ALWAYS_CRIT", ctx.alwaysCrit ? "1" : "0"); } catch (_) {}
  ctx.log(`GOD: Always Crit ${ctx.alwaysCrit ? "enabled" : "disabled"}.`, ctx.alwaysCrit ? "good" : "warn");
}

export function setCritPart(ctx, part) {
  const valid = new Set(["torso","head","hands","legs",""]);
  const p = valid.has(part) ? part : "";
  ctx.forcedCritPart = p;
  try {
    window.ALWAYS_CRIT_PART = p;
    if (p) localStorage.setItem("ALWAYS_CRIT_PART", p);
    else localStorage.removeItem("ALWAYS_CRIT_PART");
  } catch (_) {}
  if (p) ctx.log(`GOD: Forcing crit hit location: ${p}.`, "notice");
  else ctx.log("GOD: Cleared forced crit hit location.", "notice");
}

export function applySeed(ctx, seedUint32) {
  const s = (Number(seedUint32) >>> 0);
  try { localStorage.setItem("SEED", String(s)); } catch (_) {}
  if (typeof window !== "undefined" && window.RNG && typeof window.RNG.applySeed === "function") {
    window.RNG.applySeed(s);
    ctx.rng = window.RNG.rng;
  } else {
    // Deterministic local PRNG when RNG service is unavailable
    ctx.rng = (function mulberry32(seed) {
      let t = (seed >>> 0);
      return function () {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    })(s);
  }
  if (ctx.mode === "world") {
    ctx.log(`GOD: Applied seed ${s}. Regenerating overworld...`, "notice");
    ctx.initWorld();
  } else {
    ctx.log(`GOD: Applied seed ${s}. Regenerating floor ${ctx.floor}...`, "notice");
    ctx.generateLevel(ctx.floor);
  }
  // Draw will be scheduled by orchestrator (core/game.js) after regeneration
  try {
    const el = document.getElementById("god-seed-help");
    if (el) el.textContent = `Current seed: ${s}`;
    const input = document.getElementById("god-seed-input");
    if (input) input.value = String(s);
  } catch (_) {}
}

export function clearGameStorage(ctx) {
  // Clear persisted game states across modes to ensure a clean start
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("DUNGEON_STATES_V1");
      localStorage.removeItem("TOWN_STATES_V1");
      localStorage.removeItem("REGION_CUTS_V1");
      localStorage.removeItem("REGION_ANIMALS_V1");
      localStorage.removeItem("REGION_ANIMALS_V2");
      localStorage.removeItem("REGION_STATE_V1");
    }
  } catch (_) {}
  // Clear in-memory session mirrors
  try {
    if (typeof window !== "undefined") {
      window._DUNGEON_STATES_MEM = Object.create(null);
      window._TOWN_STATES_MEM = Object.create(null);
    }
  } catch (_) {}
  try {
    if (ctx) {
      if (ctx._dungeonStates) ctx._dungeonStates = Object.create(null);
      if (ctx._townStates) ctx._townStates = Object.create(null);
    }
  } catch (_) {}
  try { ctx.log && ctx.log("Cleared persisted game state (towns, dungeons, regions).", "notice"); } catch (_) {}
}

export function rerollSeed(ctx) {
  // Always clear persisted game states when rerolling seed to avoid cross-seed leaks
  try { clearGameStorage(ctx); } catch (_) {}
  const s = (Date.now() % 0xffffffff) >>> 0;
  applySeed(ctx, s);
}

// Back-compat: attach to window via helper
attachGlobal("God", { heal, spawnStairsHere, spawnItems, spawnEnemyNearby, setAlwaysCrit, setCritPart, applySeed, rerollSeed, clearGameStorage });