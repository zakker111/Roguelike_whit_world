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
 */

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
  // Visual change (tile underfoot) will be drawn on next scheduled frame; defer draw to engine coalescer
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
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

  // Build a type list from registry or JSON (once)
  (function ensureTypeCycle() {
    if (window.GOD_SPAWN_CYCLE.list.length > 0) return;
    try {
      const EM = (typeof window !== "undefined" ? window.Enemies : null);
      let types = [];
      if (EM && typeof EM.listTypes === "function") {
        types = EM.listTypes();
      }
      if ((!types || types.length === 0) && typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.enemies)) {
        types = window.GameData.enemies.map(e => e.id || e.key).filter(Boolean);
      }
      if (!types || types.length === 0) {
        // Hardcoded fallback for dev to avoid goblin-only behavior
        types = ["goblin","troll","skeleton","bandit","ogre","mime_ghost","hell_houndin"];
      }
      // Deterministic shuffle using ctx.rng so order differs per seed
      const list = types.slice(0);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng() * (i + 1));
        const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      }
      window.GOD_SPAWN_CYCLE.list = list;
      window.GOD_SPAWN_CYCLE.idx = 0;
    } catch (_) {
      window.GOD_SPAWN_CYCLE.list = ["goblin","troll","skeleton","bandit","ogre","mime_ghost","hell_houndin"];
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
    const maxAttempts = 100;
    for (let i = 0; i < maxAttempts; i++) {
      const dx = Math.floor(ctx.rng() * 17) - 8; // wider search radius
      const dy = Math.floor(ctx.rng() * 17) - 8;
      const x = ctx.player.x + dx;
      const y = ctx.player.y + dy;
      if (isFreeFloor(x, y)) return { x, y };
    }
    const free = [];
    const rows = ctx.map.length;
    const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (isFreeFloor(x, y)) free.push({ x, y });
      }
    }
    if (!free.length) return null;
    return free[Math.floor(ctx.rng() * free.length)];
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
  for (let i = 0; i < count; i++) {
    const spot = pickNearby();
    if (!spot) break;

    // Cycle pick to force variety
    const pickKey = window.GOD_SPAWN_CYCLE.list[window.GOD_SPAWN_CYCLE.idx % window.GOD_SPAWN_CYCLE.list.length];
    window.GOD_SPAWN_CYCLE.idx++;

    // Prefer ctx.enemyFactory for consistency; if it returns null, build manually
    let ee = null;
    try {
      const makeEnemy = (ctx.enemyFactory || ((x, y, depth) => ({ x, y, type: pickKey || "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false })));
      ee = makeEnemy(spot.x, spot.y, ctx.floor);
    } catch (_) {}

    if (!ee || typeof ee.x !== "number" || typeof ee.y !== "number") {
      // Build from Enemies registry when available; otherwise from GameData JSON
      const EM = (typeof window !== "undefined" ? window.Enemies : null);
      if (EM && typeof EM.getTypeDef === "function") {
        const td = EM.getTypeDef(pickKey) || EM.getTypeDef("goblin");
        ee = {
          x: spot.x, y: spot.y,
          type: pickKey,
          glyph: td && td.glyph ? td.glyph : ((pickKey && pickKey.length) ? pickKey.charAt(0) : "?"),
          hp: td ? td.hp(ctx.floor) : 3,
          atk: td ? td.atk(ctx.floor) : 1,
          xp: td ? td.xp(ctx.floor) : 5,
          level: (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(pickKey, ctx.floor, ctx.rng) : ctx.floor,
          announced: false
        };
      } else {
        // Build from raw GameData.enemies if available
        const row = (window.GameData && Array.isArray(window.GameData.enemies)) ? window.GameData.enemies.find(e => (e.id || e.key) === pickKey) : null;
        ee = {
          x: spot.x, y: spot.y,
          type: pickKey,
          glyph: (row && row.glyph) ? row.glyph : ((pickKey && pickKey.length) ? pickKey.charAt(0) : "?"),
          hp: linearAt(row && row.hp || [], ctx.floor, 3),
          atk: linearAt(row && row.atk || [], ctx.floor, 1),
          xp: linearAt(row && row.xp || [], ctx.floor, 5),
          level: ctx.floor,
          announced: false
        };
      }
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

  if (spawned.length) ctx.requestDraw();
  else ctx.log("GOD: No free space to spawn an enemy nearby.", "warn");
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
    try {
      if (typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function") {
        ctx.rng = window.RNGFallback.getRng(s);
      } else {
        // As a last resort, use a time-seeded deterministic fallback
        ctx.rng = (function () {
          try { return window.RNGFallback.getRng(s); } catch (_) {}
          const seed = ((Date.now() % 0xffffffff) >>> 0);
          function mulberry32(a) {
            return function () {
              let t = a += 0x6D2B79F5;
              t = Math.imul(t ^ (t >>> 15), t | 1);
              t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
              return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
          }
          const f = mulberry32(seed);
          return function () { return f(); };
        })();
      }
    } catch (_) {
      // Same last-resort deterministic fallback
      const seed = ((Date.now() % 0xffffffff) >>> 0);
      function mulberry32(a) {
        return function () {
          let t = a += 0x6D2B79F5;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const f = mulberry32(seed);
      ctx.rng = function () { return f(); };
    }
  }
  if (ctx.mode === "world") {
    ctx.log(`GOD: Applied seed ${s}. Regenerating overworld...`, "notice");
    ctx.initWorld();
  } else {
    ctx.log(`GOD: Applied seed ${s}. Regenerating floor ${ctx.floor}...`, "notice");
    ctx.generateLevel(ctx.floor);
  }
  ctx.requestDraw();
  try {
    const el = document.getElementById("god-seed-help");
    if (el) el.textContent = `Current seed: ${s}`;
    const input = document.getElementById("god-seed-input");
    if (input) input.value = String(s);
  } catch (_) {}
}

export function rerollSeed(ctx) {
  const s = (Date.now() % 0xffffffff) >>> 0;
  applySeed(ctx, s);
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.God = { heal, spawnStairsHere, spawnItems, spawnEnemyNearby, setAlwaysCrit, setCritPart, applySeed, rerollSeed };
}