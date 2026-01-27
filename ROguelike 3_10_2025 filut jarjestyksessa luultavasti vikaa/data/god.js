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
 *   teleportToNearestTower(ctx)
 *   teleportToTarget(ctx, target)
 *   toggleInvincible(ctx, enabled)
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
  // Enemy spawning is supported in dungeon or sandbox mode only
  if (ctx.mode !== "dungeon" && ctx.mode !== "sandbox") {
    ctx.log("GOD: Enemy spawn works in dungeon or sandbox mode only.", "warn");
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

/**
 * Spawn a specific enemy type id near the player (dungeon or sandbox mode only).
 * This uses the same placement logic as spawnEnemyNearby but does not cycle ids.
 */
export function spawnEnemyById(ctx, id, count = 1) {
  const typeId = String(id || "").trim();
  if (!typeId) {
    ctx.log("GOD: Enemy id is empty; cannot spawn.", "warn");
    return false;
  }
  // Enemy spawning is supported in dungeon or sandbox mode only
  if (ctx.mode !== "dungeon" && ctx.mode !== "sandbox") {
    ctx.log("GOD: spawnEnemyById works in dungeon or sandbox mode only.", "warn");
    return false;
  }

  const EM = (typeof window !== "undefined" ? window.Enemies : null);
  if (!EM || typeof EM.getTypeDef !== "function") {
    ctx.log("GOD: Enemies registry not available; cannot spawn by id.", "warn");
    return false;
  }
  const td = EM.getTypeDef(typeId);
  if (!td) {
    ctx.log(`GOD: Enemy id '${typeId}' not found in registry.`, "warn");
    return false;
  }

  const isFreeFloor = (x, y) => {
    try {
      if (!ctx.inBounds(x, y)) return false;
      const walkable = (typeof ctx.isWalkable === "function") ? ctx.isWalkable(x, y) : (ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.STAIRS);
      if (!walkable) return false;
      if (ctx.player.x === x && ctx.player.y === y) return false;
      const occEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function") ? ctx.occupancy.hasEnemy(x, y) : ctx.enemies.some(e => e && e.x === x && e.y === y);
      if (occEnemy) return false;
      return true;
    } catch (_) {
      return false;
    }
  };

  const pickNearby = () => {
    const maxR = 5;
    const px = ctx.player.x | 0;
    const py = ctx.player.y | 0;

    for (let r = 1; r <= maxR; r++) {
      const candidates = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dy) !== r) continue;
          const x = px + dx;
          const y = py + dy;
          if (isFreeFloor(x, y)) candidates.push({ x, y });
        }
      }
      if (candidates.length) {
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(ctx.rng() * (i + 1));
          const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
        }
        return candidates[0];
      }
    }

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

  const spawned = [];
  const n = Math.max(1, Math.min(50, (Number(count) || 0) | 0));

  for (let i = 0; i < n; i++) {
    const spot = pickNearby();
    if (!spot) break;

    let ee = null;
    try {
      // Prefer enemyFactory when it can honor a specific id in the future;
      // for now, build directly from Enemies registry.
      if (typeof ctx.enemyFactory === "function" && false) {
        ee = ctx.enemyFactory(spot.x, spot.y, ctx.floor);
      }
    } catch (_) {}

    if (!ee) {
      const level = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(typeId, ctx.floor, ctx.rng) : ctx.floor;
      ee = {
        x: spot.x,
        y: spot.y,
        type: typeId,
        glyph: td.glyph ? td.glyph : ((typeId && typeId.length) ? typeId.charAt(0) : "?"),
        hp: td.hp(ctx.floor),
        atk: td.atk(ctx.floor),
        xp: td.xp(ctx.floor),
        level,
        announced: false,
      };
    }

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
    return true;
  }

  ctx.log("GOD: No free space to spawn an enemy nearby.", "warn");
  return false;
}

export function setAlwaysCrit(ctx, enabled) {
  ctx.alwaysCrit = !!enabled;
  try { window.ALWAYS_CRIT = ctx.alwaysCrit; localStorage.setItem("ALWAYS_CRIT", ctx.alwaysCrit ? "1" : "0"); } catch (_) {}
  ctx.log(`GOD: Always Crit ${ctx.alwaysCrit ? "enabled" : "disabled"}.`, ctx.alwaysCrit ? "good" : "warn");
}

/**
 * Toggle GOD invincibility: when enabled, the player still takes damage
 * as usual but immediately heals back to max HP after each hit and
 * cannot die.
 */
export function toggleInvincible(ctx, enabled) {
  const on = !!enabled;
  ctx.godInvincible = on;
  try {
    if (typeof window !== "undefined") {
      window.GOD_INVINCIBLE = on;
    }
    if (typeof localStorage !== "undefined") {
      if (on) localStorage.setItem("GOD_INVINCIBLE", "1");
      else localStorage.removeItem("GOD_INVINCIBLE");
    }
  } catch (_) {}
  ctx.log(`GOD: Invincibility ${on ? "enabled" : "disabled"}.`, on ? "good" : "warn");
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

/**
 * Teleport player to the nearest tower tile in the overworld.
 * Uses InfiniteGen.tileAt so it can find towers outside the current window.
 * World-only; no effect in towns/dungeons/encounters.
 */
export function teleportToNearestTower(ctx) {
  try {
    if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.gen) {
      if (ctx && ctx.log) ctx.log("GOD: Teleport to tower works in overworld mode only.", "warn");
      return;
    }
    const WT = ctx.World && ctx.World.TILES;
    if (!WT || WT.TOWER == null) {
      ctx.log && ctx.log("GOD: Tower tile type not available.", "warn");
      return;
    }
    const gen = ctx.world.gen;
    if (!gen || typeof gen.tileAt !== "function") {
      ctx.log && ctx.log("GOD: World generator unavailable; cannot search for towers.", "warn");
      return;
    }

    const originX = ctx.world.originX | 0;
    const originY = ctx.world.originY | 0;
    const px = ctx.player && typeof ctx.player.x === "number" ? (ctx.player.x | 0) : 0;
    const py = ctx.player && typeof ctx.player.y === "number" ? (ctx.player.y | 0) : 0;
    const wx0 = originX + px;
    const wy0 = originY + py;

    let best = null;
    let bestDist = Infinity;
    const maxR = 400; // search radius in world tiles (~800x800 area around player)

    for (let wy = wy0 - maxR; wy <= wy0 + maxR; wy++) {
      for (let wx = wx0 - maxR; wx <= wx0 + maxR; wx++) {
        const t = gen.tileAt(wx, wy);
        if (t === WT.TOWER) {
          const md = Math.abs(wx - wx0) + Math.abs(wy - wy0);
          if (md < bestDist) {
            bestDist = md;
            best = { x: wx, y: wy };
          }
        }
      }
    }

    if (!best) {
      ctx.log && ctx.log("GOD: No towers found within search radius.", "warn");
      return;
    }

    // Ensure the target is inside the current window; expand map if needed.
    try {
      const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
      if (WR && typeof WR.ensureInBounds === "function") {
        ctx._suspendExpandShift = true;
        try {
          const hintLx = best.x - (ctx.world.originX | 0);
          const hintLy = best.y - (ctx.world.originY | 0);
          WR.ensureInBounds(ctx, hintLx, hintLy, 32);
        } finally {
          ctx._suspendExpandShift = false;
        }
      }
    } catch (_) {}

    const newOriginX = ctx.world.originX | 0;
    const newOriginY = ctx.world.originY | 0;
    const lx = best.x - newOriginX;
    const ly = best.y - newOriginY;

    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (lx < 0 || ly < 0 || ly >= rows || lx >= cols) {
      ctx.log && ctx.log("GOD: Teleport target ended up outside the current window; aborting.", "warn");
      return;
    }

    ctx.player.x = lx;
    ctx.player.y = ly;

    ctx.log && ctx.log(`GOD: Teleported to nearest tower at (${best.x},${best.y}).`, "notice");

    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
  } catch (e) {
    try {
      if (ctx && ctx.log) ctx.log("GOD: Teleport to tower failed; see console for details.", "warn");
      // eslint-disable-next-line no-console
      console.error(e);
    } catch (_) {}
  }
}

/**
 * Generic teleport helper for the GOD panel.
 * target: "tower" | "town" | "dungeon" | "ruins" | "castle"
 *
 * Uses the same infinite-world aware pattern as teleportToNearestTower:
 * - Searches in world space via world.gen.tileAt()
 * - Ensures the destination is inside the current window via WorldRuntime.ensureInBounds
 * - Converts back to local map coords and moves ctx.player.x/y directly
 */
export function teleportToTarget(ctx, target) {
  try {
    if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.gen) {
      if (ctx && ctx.log) ctx.log("GOD: Teleport works in overworld mode only.", "warn");
      return;
    }

    const t = String(target || "tower").toLowerCase();
    if (t === "tower") {
      teleportToNearestTower(ctx);
      return;
    }

    const WT = ctx.World && ctx.World.TILES;
    if (!WT) {
      ctx.log && ctx.log("GOD: World tile types not available.", "warn");
      return;
    }

    const gen = ctx.world.gen;
    if (!gen || typeof gen.tileAt !== "function") {
      ctx.log && ctx.log("GOD: World generator unavailable; cannot search for teleport target.", "warn");
      return;
    }

    // Player world coordinates
    const originX = ctx.world.originX | 0;
    const originY = ctx.world.originY | 0;
    const px = ctx.player && typeof ctx.player.x === "number" ? (ctx.player.x | 0) : 0;
    const py = ctx.player && typeof ctx.player.y === "number" ? (ctx.player.y | 0) : 0;
    const wx0 = originX + px;
    const wy0 = originY + py;

    let best = null;
    let bestDist = Infinity;

    // Special case: mountain dungeons use POI metadata (world.dungeons with isMountainDungeon)
    if (t === "mountain_dungeon") {
      const world = ctx.world;
      const duns = Array.isArray(world.dungeons) ? world.dungeons : [];
      for (const d of duns) {
        if (!d || !d.isMountainDungeon) continue;
        const wx = d.x | 0;
        const wy = d.y | 0;
        const md = Math.abs(wx - wx0) + Math.abs(wy - wy0);
        if (md < bestDist) {
          bestDist = md;
          best = { x: wx, y: wy };
        }
      }
      if (!best) {
        ctx.log && ctx.log("GOD: No mountain dungeons found in registered POIs.", "warn");
        return;
      }
    } else if (t === "harbor") {
      const world = ctx.world;
      const towns = Array.isArray(world.towns) ? world.towns : [];
      const hasWT = !!WT && WT.WATER != null;
      // Helper: detect whether a town is harbor-like based on nearby water.
      // We intentionally mirror the stricter harbor detection used in core/modes:
      // - Scan up to 2 tiles in N/S/E/W from the town tile.
      // - WATER/BEACH tiles add 2 points; RIVER tiles add 1 point.
      // - A town qualifies as harbor if best directional score >= 2
      //   (i.e., at least one WATER/BEACH tile or enough river).
      function isHarborTown(rec) {
        try {
          if (!rec || typeof rec.x !== "number" || typeof rec.y !== "number") return false;
          if (!hasWT) return false;
          if (!gen || typeof gen.tileAt !== "function") return false;

          const wxTown = rec.x | 0;
          const wyTown = rec.y | 0;
          const dirs = [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 },
          ];
          const MAX_DIST_HARBOR = 2; // only directly adjacent or 1 tile off
          let bestScore = 0;

          for (let i = 0; i < dirs.length; i++) {
            const d = dirs[i];
            let coast = 0;
            let river = 0;
            for (let step = 1; step <= MAX_DIST_HARBOR; step++) {
              const tcode = gen.tileAt(wxTown + d.dx * step, wyTown + d.dy * step);
              if (tcode == null) continue;
              if (tcode === WT.WATER || (WT.BEACH != null && tcode === WT.BEACH)) {
                coast += 2;
              } else if (WT.RIVER != null && tcode === WT.RIVER) {
                river += 1;
              }
            }
            const score = coast + river;
            if (score > bestScore) bestScore = score;
          }

          const MIN_SCORE_HARBOR = 2;
          return bestScore >= MIN_SCORE_HARBOR;
        } catch (_) {
          return false;
        }
      }

      for (let i = 0; i < towns.length; i++) {
        const rec = towns[i];
        if (!rec || typeof rec.x !== "number" || typeof rec.y !== "number") continue;
        if (!isHarborTown(rec)) continue;
        const wx = rec.x | 0;
        const wy = rec.y | 0;
        const md = Math.abs(wx - wx0) + Math.abs(wy - wy0);
        if (md < bestDist) {
          bestDist = md;
          best = { x: wx, y: wy };
        }
      }
      if (!best) {
        ctx.log && ctx.log("GOD: No harbor towns (ports) found within search radius.", "warn");
        return;
      }
    } else {
      // Map GOD target strings to overworld tile IDs
      function tileMatches(tileCode) {
        if (tileCode == null) return false;
        if (t === "town") {
          // Treat both TOWN and CASTLE as towns for this option.
          return tileCode === WT.TOWN || (WT.CASTLE != null && tileCode === WT.CASTLE);
        }
        if (t === "dungeon") return tileCode === WT.DUNGEON;
        if (t === "ruins") return tileCode === WT.RUINS;
        if (t === "castle") return WT.CASTLE != null && tileCode === WT.CASTLE;
        return false;
      }

      const maxR = 400; // same order of magnitude as tower search
      for (let wy = wy0 - maxR; wy <= wy0 + maxR; wy++) {
        for (let wx = wx0 - maxR; wx <= wx0 + maxR; wx++) {
          const tileCode = gen.tileAt(wx, wy);
          if (!tileMatches(tileCode)) continue;
          const md = Math.abs(wx - wx0) + Math.abs(wy - wy0);
          if (md < bestDist) {
            bestDist = md;
            best = { x: wx, y: wy };
          }
        }
      }

      if (!best) {
        const lbl = t.charAt(0).toUpperCase() + t.slice(1);
        ctx.log && ctx.log(`GOD: No ${lbl.toLowerCase()} found within search radius.`, "warn");
        return;
      }
    }

    // Ensure the target is inside the current window; expand map if needed.
    try {
      const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
      if (WR && typeof WR.ensureInBounds === "function") {
        ctx._suspendExpandShift = true;
        try {
          const hintLx = best.x - (ctx.world.originX | 0);
          const hintLy = best.y - (ctx.world.originY | 0);
          WR.ensureInBounds(ctx, hintLx, hintLy, 32);
        } finally {
          ctx._suspendExpandShift = false;
        }
      }
    } catch (_) {}

    const newOriginX = ctx.world.originX | 0;
    const newOriginY = ctx.world.originY | 0;
    const lx = best.x - newOriginX;
    const ly = best.y - newOriginY;

    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (lx < 0 || ly < 0 || ly >= rows || lx >= cols) {
      ctx.log && ctx.log("GOD: Teleport target ended up outside the current window; aborting.", "warn");
      return;
    }

    ctx.player.x = lx;
    ctx.player.y = ly;

    const label =
      t === "town" ? "town/castle" :
      t === "harbor" ? "harbor town" :
      t === "dungeon" ? "dungeon" :
      t === "mountain_dungeon" ? "mountain dungeon" :
      t === "ruins" ? "ruins" :
      t === "castle" ? "castle" : t;

    ctx.log && ctx.log(`GOD: Teleported to nearest ${label} at (${best.x},${best.y}).`, "notice");

    try {
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      }
    } catch (_) {}
  } catch (e) {
    try {
      ctx && ctx.log && ctx.log("GOD: Teleport helper failed; see console for details.", "warn");
      // eslint-disable-next-line no-console
      console.error(e);
    } catch (_) {}
  }
}

// Back-compat: attach to window via helper
attachGlobal("God", {
  heal,
  spawnStairsHere,
  spawnItems,
  spawnEnemyNearby,
  spawnEnemyById,
  setAlwaysCrit,
  toggleInvincible,
  setCritPart,
  applySeed,
  rerollSeed,
  clearGameStorage,
  teleportToNearestTower,
  teleportToTarget,
});