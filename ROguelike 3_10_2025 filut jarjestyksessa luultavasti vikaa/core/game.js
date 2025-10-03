/**
 * Game: main loop, world state, combat, FOV/render orchestration, and glue.
 *
 * Responsibilities:
 * - Manage map, entities, player, RNG, and turn sequence
 * - Handle movement, bump-to-attack, blocks/crits/body-part, damage/DR, equipment decay
 * - Orchestrate FOV and drawing; bridge to UI and modules via ctx
 * - GOD toggles: always-crit (with forced body-part)
 *
 * Notes:
 * - Uses Ctx.create(base) to provide a normalized ctx to modules.
 * - Randomness is deterministic via mulberry32; helpers (randInt, randFloat, chance) built over it.
 */
(() => {
  const TILE = 32;
  const COLS = 30;
  const ROWS = 20;
  
  const MAP_COLS = 120;
  const MAP_ROWS = 80;

  const FOV_DEFAULT = 8;
  let fovRadius = FOV_DEFAULT;

  // Game modes: "world" (overworld) or "dungeon" (roguelike floor)
  let mode = "world";
  let world = null;          // { map, width, height, towns, dungeons }
  let npcs = [];             // simple NPCs for town mode: { x, y, name, lines:[] }
  let shops = [];            // shops in town mode: [{x,y,type,name}]
  let townProps = [];        // interactive town props: [{x,y,type,name}]
  let townBuildings = [];    // town buildings: [{x,y,w,h,door:{x,y}}]
  let townPlaza = null;      // central plaza coordinates {x,y}
  let tavern = null;         // tavern info: { building:{x,y,w,h,door}, door:{x,y} }
  let townTick = 0;          // simple turn counter for town routines
  let townName = null;       // current town's generated name

  // World/town/dungeon transition anchors
  let townExitAt = null;     // gate position inside town used to exit back to overworld
  let worldReturnPos = null; // overworld position to return to after leaving town/dungeon
  let dungeonExitAt = null;  // dungeon tile to return to overworld
  let cameFromWorld = false; // whether we entered dungeon from overworld
  let currentDungeon = null; // info for current dungeon entrance: { x,y, level, size }
  // Persist dungeon states by overworld entrance coordinate "x,y"
  const dungeonStates = Object.create(null);

  // Global time-of-day cycle (shared across modes)
  // Centralized via TimeService to avoid duplication and keep math consistent.
  const TS = (window.TimeService && typeof TimeService.create === "function")
    ? TimeService.create({ dayMinutes: 24 * 60, cycleTurns: 360 })
    : (function () {
        const DAY_MINUTES = 24 * 60;
        const CYCLE_TURNS = 360;
        const MINUTES_PER_TURN = DAY_MINUTES / CYCLE_TURNS;
        function getClock(tc) {
          const totalMinutes = Math.floor((tc | 0) * MINUTES_PER_TURN) % DAY_MINUTES;
          const h = Math.floor(totalMinutes / 60);
          const m = totalMinutes % 60;
          const hh = String(h).padStart(2, "0");
          const mm = String(m).padStart(2, "0");
          const phase = (h >= 20 || h < 6) ? "night" : (h < 8 ? "dawn" : (h < 18 ? "day" : "dusk"));
          return { hours: h, minutes: m, hhmm: `${hh}:${mm}`, phase, totalMinutes, minutesPerTurn: MINUTES_PER_TURN, cycleTurns: CYCLE_TURNS, turnCounter: (tc | 0) };
        }
        function minutesUntil(tc, hourTarget, minuteTarget = 0) {
          const clock = getClock(tc);
          const cur = clock.hours * 60 + clock.minutes;
          const goal = ((hourTarget | 0) * 60 + (minuteTarget | 0) + DAY_MINUTES) % DAY_MINUTES;
          let delta = goal - cur;
          if (delta <= 0) delta += DAY_MINUTES;
          return delta;
        }
        function advanceMinutes(tc, mins) {
          const turns = Math.ceil((mins | 0) / MINUTES_PER_TURN);
          return (tc | 0) + turns;
        }
        function tick(tc) { return (tc | 0) + 1; }
        return {
          DAY_MINUTES,
          CYCLE_TURNS,
          MINUTES_PER_TURN,
          getClock,
          minutesUntil,
          advanceMinutes,
          tick,
        };
      })();
  const DAY_MINUTES = TS.DAY_MINUTES;
  const CYCLE_TURNS = TS.CYCLE_TURNS;
  const MINUTES_PER_TURN = TS.MINUTES_PER_TURN;
  let turnCounter = 0;            // total turns elapsed since start

  // Compute in-game clock and phase from turnCounter (delegates to TimeService)
  function getClock() {
    return TS.getClock(turnCounter);
  }

  
  const camera = {
    x: 0,
    y: 0,
    width: COLS * TILE,
    height: ROWS * TILE,
  };

  
  const TILES = {
    WALL: 0,
    FLOOR: 1,
    DOOR: 2,
    STAIRS: 3,
    WINDOW: 4, // town-only: blocks movement, lets light through
  };

  const COLORS = {
    wall: "#1b1f2a",
    wallDark: "#131722",
    floor: "#0f1320",
    floorLit: "#0f1628",
    player: "#9ece6a",
    enemy: "#f7768e",
    enemyGoblin: "#8bd5a0",
    enemyTroll: "#e0af68",
    enemyOgre: "#f7768e",
    item: "#7aa2f7",
    corpse: "#c3cad9",
    corpseEmpty: "#6b7280",
    dim: "rgba(13, 16, 24, 0.75)"
  };

  
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  
  let map = [];
  let seen = [];
  let visible = [];
  let player = (window.Player && typeof Player.createInitial === "function")
    ? Player.createInitial()
    : { x: 0, y: 0, hp: 20, maxHp: 40, inventory: [], atk: 1, xp: 0, level: 1, xpNext: 20, equipment: { left: null, right: null, head: null, torso: null, legs: null, hands: null } };
  let enemies = [];
  let corpses = [];
  // Visual decals like blood stains on the floor; array of { x, y, a (alpha 0..1), r (radius px) }
  let decals = [];
  // Occupancy Grid (entities on tiles)
  let occupancy = null;
  function rebuildOccupancy() {
    if (typeof window !== "undefined" && window.OccupancyGrid && typeof OccupancyGrid.build === "function") {
      occupancy = OccupancyGrid.build({ map, enemies, npcs, props: townProps, player });
    }
  }
  let floor = 1;
  window.floor = floor;
  // RNG: centralized via RNG service; allow persisted seed for reproducibility
  let currentSeed = null;
  if (typeof window !== "undefined" && window.RNG && typeof RNG.autoInit === "function") {
    try {
      currentSeed = RNG.autoInit();
      // RNG.autoInit returns the seed value
    } catch (_) {
      try {
        const sRaw = (typeof localStorage !== "undefined") ? localStorage.getItem("SEED") : null;
        currentSeed = sRaw != null ? (Number(sRaw) >>> 0) : null;
      } catch (_) { currentSeed = null; }
    }
  } else {
    try {
      const sRaw = (typeof localStorage !== "undefined") ? localStorage.getItem("SEED") : null;
      currentSeed = sRaw != null ? (Number(sRaw) >>> 0) : null;
    } catch (_) { currentSeed = null; }
  }
  let rng = (typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function")
    ? RNG.rng
    : (function () {
        // minimal fallback mulberry32 if RNG service not available
        function mulberry32(a) {
          return function() {
            let t = a += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        }
        const seed = (currentSeed == null ? (Date.now() % 0xffffffff) : currentSeed) >>> 0;
        const _rng = mulberry32(seed);
        return function () { return _rng(); };
      })();
  let isDead = false;
  let startRoomRect = null;
  // GOD toggles
  let alwaysCrit = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT === "boolean") ? !!window.ALWAYS_CRIT : false;
  let forcedCritPart = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT_PART === "string") ? window.ALWAYS_CRIT_PART : (typeof localStorage !== "undefined" ? (localStorage.getItem("ALWAYS_CRIT_PART") || "") : "");

  
  function getCtx() {
    const base = {
      rng,
      ROWS, COLS, MAP_ROWS, MAP_COLS, TILE, TILES,
      player, enemies, corpses, decals, map, seen, visible, occupancy,
      floor, depth: floor,
      fovRadius,
      // world/overworld
      mode,
      world,
      npcs,
      shops,
      townProps,
      townBuildings,
      townPlaza,
      tavern,
      dungeon: currentDungeon,
      dungeonInfo: currentDungeon,
      time: getClock(),
      requestDraw,
      log,
      isWalkable, inBounds,
      // Prefer modules to use ctx.utils.*; keep these for backward use and fallbacks.
      round1, randInt, chance, randFloat,
      enemyColor, describeItem,
      setFovRadius,
      getPlayerAttack, getPlayerDefense, getPlayerBlockChance,
      enemyThreatLabel,
      // Needed by loot and UI flows
      updateUI: () => updateUI(),
      initialDecay: (tier) => initialDecay(tier),
      equipIfBetter: (item) => equipIfBetter(item),
      addPotionToInventory: (heal, name) => addPotionToInventory(heal, name),
      renderInventory: () => renderInventoryPanel(),
      showLoot: (list) => showLootPanel(list),
      hideLoot: () => hideLootPanel(),
      turn: () => turn(),
      // World/dungeon generation
      initWorld: () => initWorld(),
      generateLevel: (depth) => generateLevel(depth),
      // Combat helpers
      rollHitLocation,
      critMultiplier,
      enemyDamageAfterDefense,
      enemyDamageMultiplier,
      // Visual decals
      addBloodDecal: (x, y, mult) => addBloodDecal(x, y, mult),
      // Decay and side effects
      decayBlockingHands,
      decayEquipped,
      rerenderInventoryIfOpen,
      onPlayerDied: () => {
        isDead = true;
        updateUI();
        log("You die. Press R or Enter to restart.", "bad");
        showGameOver();
      },
      onEnemyDied: (enemy) => killEnemy(enemy),
    };

    if (window.Ctx && typeof Ctx.create === "function") {
      const ctx = Ctx.create(base);
      // enemy factory prefers ctx.Enemies handle, falling back gracefully
      ctx.enemyFactory = (x, y, depth) => {
        const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
        if (EM && typeof EM.createEnemyAt === "function") {
          return EM.createEnemyAt(x, y, depth, rng);
        }
        return { x, y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false };
      };
      if (window.DEV && ctx && ctx.utils) {
        try {
          console.debug("[DEV] ctx created:", {
            utils: Object.keys(ctx.utils),
            los: !!(ctx.los || ctx.LOS),
            modules: {
              Enemies: !!ctx.Enemies, Items: !!ctx.Items, Player: !!ctx.Player,
              UI: !!ctx.UI, Logger: !!ctx.Logger, Loot: !!ctx.Loot,
              Dungeon: !!ctx.Dungeon, DungeonItems: !!ctx.DungeonItems,
              FOV: !!ctx.FOV, AI: !!ctx.AI, Input: !!ctx.Input,
              Render: !!ctx.Render, Tileset: !!ctx.Tileset, Flavor: !!ctx.Flavor,
              World: !!ctx.World
            }
          });
        } catch (_) {}
      }
      return ctx;
    }

    // Fallback without Ctx: include a local enemyFactory using window.Enemies if present
    base.enemyFactory = (x, y, depth) => {
      if (typeof window !== "undefined" && window.Enemies && typeof window.Enemies.createEnemyAt === "function") {
        return window.Enemies.createEnemyAt(x, y, depth, rng);
      }
      return { x, y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false };
    };
    return base;
  }

  // Use RNG service if available for helpers
  const randInt = (min, max) => {
    if (typeof window !== "undefined" && window.RNG && typeof RNG.int === "function") return RNG.int(min, max);
    return Math.floor(rng() * (max - min + 1)) + min;
  };
  const chance = (p) => {
    if (typeof window !== "undefined" && window.RNG && typeof RNG.chance === "function") return RNG.chance(p);
    return rng() < p;
  };
  const capitalize = (window.PlayerUtils && typeof PlayerUtils.capitalize === "function")
    ? PlayerUtils.capitalize
    : (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const enemyColor = (type) => {
    if (window.Enemies && typeof Enemies.colorFor === "function") {
      return Enemies.colorFor(type);
    }
    return COLORS.enemy;
  };
  const randFloat = (min, max, decimals = 1) => {
    if (typeof window !== "undefined" && window.RNG && typeof RNG.float === "function") return RNG.float(min, max, decimals);
    const v = min + rng() * (max - min);
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  };
  const round1 = (n) => Math.round(n * 10) / 10;

  // Decay helpers
  function initialDecay(tier) {
    if (window.Items && typeof Items.initialDecay === "function") {
      return Items.initialDecay(tier);
    }
    
    if (tier <= 1) return randFloat(10, 35, 0);
    if (tier === 2) return randFloat(5, 20, 0);
    return randFloat(0, 10, 0);
  }

  function rerenderInventoryIfOpen() {
    if (window.UI && UI.isInventoryOpen && UI.isInventoryOpen()) {
      renderInventoryPanel();
    }
  }

  function decayEquipped(slot, amount) {
    if (window.Player && typeof Player.decayEquipped === "function") {
      Player.decayEquipped(player, slot, amount, {
        log,
        updateUI,
        onInventoryChange: () => rerenderInventoryIfOpen(),
      });
      return;
    }
    
    const it = player.equipment?.[slot];
    if (!it) return;
    const before = it.decay || 0;
    it.decay = Math.min(100, round1(before + amount));
    if (it.decay >= 100) {
      log(`${capitalize(it.name)} breaks and is destroyed.`, "bad");
      // Optional flavor for breakage
      try {
        if (window.Flavor && typeof Flavor.onBreak === "function") {
          Flavor.onBreak(getCtx(), { side: "player", slot, item: it });
        }
      } catch (_) {}
      player.equipment[slot] = null;
      updateUI();
      rerenderInventoryIfOpen();
    } else if (Math.floor(before) !== Math.floor(it.decay)) {
      rerenderInventoryIfOpen();
    }
  }

  
  function getPlayerAttack() {
    if (window.Stats && typeof Stats.getPlayerAttack === "function") {
      return Stats.getPlayerAttack(getCtx());
    }
    if (window.Player && typeof Player.getAttack === "function") {
      return Player.getAttack(player);
    }
    let bonus = 0;
    const eq = player.equipment || {};
    if (eq.left && typeof eq.left.atk === "number") bonus += eq.left.atk;
    if (eq.right && typeof eq.right.atk === "number") bonus += eq.right.atk;
    if (eq.hands && typeof eq.hands.atk === "number") bonus += eq.hands.atk;
    const levelBonus = Math.floor((player.level - 1) / 2);
    return round1(player.atk + bonus + levelBonus);
  }

  
  function getPlayerDefense() {
    if (window.Stats && typeof Stats.getPlayerDefense === "function") {
      return Stats.getPlayerDefense(getCtx());
    }
    if (window.Player && typeof Player.getDefense === "function") {
      return Player.getDefense(player);
    }
    let def = 0;
    const eq = player.equipment || {};
    if (eq.left && typeof eq.left.def === "number") def += eq.left.def;
    if (eq.right && typeof eq.right.def === "number") def += eq.right.def;
    if (eq.head && typeof eq.head.def === "number") def += eq.head.def;
    if (eq.torso && typeof eq.torso.def === "number") def += eq.torso.def;
    if (eq.legs && typeof eq.legs.def === "number") def += eq.legs.def;
    if (eq.hands && typeof eq.hands.def === "number") def += eq.hands.def;
    return round1(def);
  }

  function describeItem(item) {
    // Single source of truth: prefer Player.describeItem, then Items.describe
    if (window.Player && typeof Player.describeItem === "function") {
      return Player.describeItem(item);
    }
    if (window.Items && typeof Items.describe === "function") {
      return Items.describe(item);
    }
    // Minimal fallback
    if (!item) return "";
    return item.name || "item";
  }

  
  function rollHitLocation() {
    if (window.Combat && typeof Combat.rollHitLocation === "function") {
      return Combat.rollHitLocation(rng);
    }
    const r = rng();
    if (r < 0.50) return { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 };
    if (r < 0.65) return { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 };
    if (r < 0.80) return { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 };
    return { part: "legs", mult: 0.95, blockMod: 0.75, critBonus: -0.03 };
  }

  function critMultiplier() {
    if (window.Combat && typeof Combat.critMultiplier === "function") {
      return Combat.critMultiplier(rng);
    }
    return 1.6 + rng() * 0.4;
  }

  function getEnemyBlockChance(enemy, loc) {
    if (window.Enemies && typeof Enemies.enemyBlockChance === "function") {
      return Enemies.enemyBlockChance(enemy, loc);
    }
    const base = enemy.type === "ogre" ? 0.10 : enemy.type === "troll" ? 0.08 : 0.06;
    return Math.max(0, Math.min(0.35, base * (loc?.blockMod || 1.0)));
  }

  function getPlayerBlockChance(loc) {
    if (window.Combat && typeof Combat.getPlayerBlockChance === "function") {
      return Combat.getPlayerBlockChance(getCtx(), loc);
    }
    const eq = player.equipment || {};
    const leftDef = (eq.left && typeof eq.left.def === "number") ? eq.left.def : 0;
    const rightDef = (eq.right && typeof eq.right.def === "number") ? eq.right.def : 0;
    const handDef = Math.max(leftDef, rightDef);
    const base = 0.08 + handDef * 0.06;
    return Math.max(0, Math.min(0.6, base * (loc?.blockMod || 1.0)));
  }

  // Enemy damage after applying player's defense with diminishing returns and a chip-damage floor
  function enemyDamageAfterDefense(raw) {
    if (window.Combat && typeof Combat.enemyDamageAfterDefense === "function") {
      return Combat.enemyDamageAfterDefense(getCtx(), raw);
    }
    const def = getPlayerDefense();
    const DR = Math.max(0, Math.min(0.85, def / (def + 6)));
    const reduced = raw * (1 - DR);
    return Math.max(0.1, round1(reduced));
  }

  
  function enemyLevelFor(type, depth) {
    if (window.Enemies && typeof Enemies.levelFor === "function") {
      return Enemies.levelFor(type, depth, rng);
    }
    const tier = type === "ogre" ? 2 : (type === "troll" ? 1 : 0);
    const jitter = rng() < 0.35 ? 1 : 0;
    return Math.max(1, depth + tier + jitter);
  }

  function enemyDamageMultiplier(level) {
    if (window.Enemies && typeof Enemies.damageMultiplier === "function") {
      return Enemies.damageMultiplier(level);
    }
    return 1 + 0.15 * Math.max(0, (level || 1) - 1);
  }

  // Classify enemy danger based on level difference vs player
  function enemyThreatLabel(enemy) {
    const diff = (enemy.level || 1) - (player.level || 1);
    let label = "moderate";
    let tone = "info";
    if (diff <= -2) { label = "weak"; tone = "good"; }
    else if (diff === -1) { label = "weak"; tone = "good"; }
    else if (diff === 0) { label = "moderate"; tone = "info"; }
    else if (diff === 1) { label = "strong"; tone = "warn"; }
    else if (diff >= 2) { label = "deadly"; tone = "warn"; }
    return { label, tone, diff };
  }

  
  function setFovRadius(r) {
    const clamped = Math.max(3, Math.min(14, r));
    if (clamped !== fovRadius) {
      fovRadius = clamped;
      log(`FOV radius set to ${fovRadius}.`);
      recomputeFOV();
      requestDraw();
    }
  }
  function adjustFov(delta) {
    setFovRadius(fovRadius + delta);
  }

  
  function addPotionToInventory(heal = 3, name = `potion (+${heal} HP)`) {
    if (window.Player && typeof Player.addPotion === "function") {
      Player.addPotion(player, heal, name);
      return;
    }
    const existing = player.inventory.find(i => i.kind === "potion" && (i.heal ?? 3) === heal);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
    } else {
      player.inventory.push({ kind: "potion", heal, count: 1, name });
    }
  }

  function drinkPotionByIndex(idx) {
    if (window.Player && typeof Player.drinkPotionByIndex === "function") {
      Player.drinkPotionByIndex(player, idx, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
      });
      return;
    }
    if (!player.inventory || idx < 0 || idx >= player.inventory.length) return;
    const it = player.inventory[idx];
    if (!it || it.kind !== "potion") return;

    const heal = it.heal ?? 3;
    const prev = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    const gained = player.hp - prev;
    if (gained > 0) {
      log(`You drink a potion and restore ${gained.toFixed(1)} HP (HP ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "good");
    } else {
      log(`You drink a potion but feel no different (HP ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "warn");
    }

    if (it.count && it.count > 1) {
      it.count -= 1;
    } else {
      player.inventory.splice(idx, 1);
    }
    updateUI();
    renderInventoryPanel();
  }

  
  function equipIfBetter(item) {
    if (window.Player && typeof Player.equipIfBetter === "function") {
      return Player.equipIfBetter(player, item, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
        describeItem: (it) => describeItem(it),
      });
    }
    if (!item || item.kind !== "equip") return false;
    const slot = item.slot;
    const current = player.equipment[slot];
    const newScore = (item.atk || 0) + (item.def || 0);
    const curScore = current ? ((current.atk || 0) + (current.def || 0)) : -Infinity;
    const better = !current || newScore > curScore + 1e-9;

    if (better) {
      player.equipment[slot] = item;
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      log(`You equip ${item.name} (${slot}${statStr ? ", " + statStr : ""}).`);
      updateUI();
      renderInventoryPanel();
      return true;
    }
    return false;
  }

  
  function log(msg, type = "info") {
    if (window.Logger && typeof Logger.log === "function") {
      Logger.log(msg, type);
      return;
    }
    // Fallback (in case logger.js isn't loaded)
    const el = document.getElementById("log");
    if (!el) return;
    const div = document.createElement("div");
    div.className = `entry ${type}`;
    div.textContent = msg;
    el.prepend(div);
    const MAX = 60;
    while (el.childNodes.length > MAX) {
      el.removeChild(el.lastChild);
    }
  }

  
  
  function generateLevel(depth = 1) {
    if (window.Dungeon && typeof Dungeon.generateLevel === "function") {
      const ctx = getCtx();
      ctx.startRoomRect = startRoomRect;
      Dungeon.generateLevel(ctx, depth);
      // Sync back references mutated by the module
      map = ctx.map;
      seen = ctx.seen;
      visible = ctx.visible;
      enemies = ctx.enemies;
      corpses = ctx.corpses;
      startRoomRect = ctx.startRoomRect;
      // Clear decals on new floor
      decals = [];
      
      recomputeFOV();
      updateCamera();
      
      if (inBounds(player.x, player.y) && !visible[player.y][player.x]) {
        try { log("FOV sanity check: player tile not visible after gen; recomputing.", "warn"); } catch (_) {}
        recomputeFOV();
        if (inBounds(player.x, player.y)) {
          visible[player.y][player.x] = true;
          seen[player.y][player.x] = true;
        }
      }
      if (window.DEV) {
        try {
          const visCount = enemies.filter(e => inBounds(e.x, e.y) && visible[e.y][e.x]).length;
          log(`[DEV] Enemies spawned: ${enemies.length}, visible now: ${visCount}.`, "notice");
        } catch (_) {}
      }
      updateUI();
      // Unified message: dungeons are single-level; exploration only
      log("You explore the dungeon.");
      // Save initial dungeon state snapshot
      saveCurrentDungeonState();
      requestDraw();
      return;
    }
    
    map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILES.FLOOR));
    // Ensure a staircase exists in the fallback map
    const sy = Math.max(1, MAP_ROWS - 2), sx = Math.max(1, MAP_COLS - 2);
    if (map[sy] && typeof map[sy][sx] !== "undefined") {
      map[sy][sx] = TILES.STAIRS;
    }
    enemies = [];
    corpses = [];
    decals = [];
    recomputeFOV();
    updateCamera();
    updateUI();
    // Unified message: dungeons are single-level; exploration only
    log("You explore the dungeon.");
    // Save fallback dungeon state as well
    saveCurrentDungeonState();
    requestDraw();
  }

  function inBounds(x, y) {
    const mh = map.length || MAP_ROWS;
    const mw = map[0] ? map[0].length : MAP_COLS;
    return x >= 0 && y >= 0 && x < mw && y < mh;
  }

  // --------- Dungeon persistence helpers ---------
  function dungeonKeyFromWorldPos(x, y) {
    if (window.DungeonState && typeof DungeonState.key === "function") {
      return DungeonState.key(x, y);
    }
    return `${x},${y}`;
  }

  function saveCurrentDungeonState() {
    if (window.DungeonState && typeof DungeonState.save === "function") {
      DungeonState.save(getCtx());
      return;
    }
    if (mode !== "dungeon" || !currentDungeon || !dungeonExitAt) return;
    const key = dungeonKeyFromWorldPos(currentDungeon.x, currentDungeon.y);
    dungeonStates[key] = {
      map,
      seen,
      visible,
      enemies,
      corpses,
      decals,
      dungeonExitAt: { x: dungeonExitAt.x, y: dungeonExitAt.y },
      info: currentDungeon,
      level: floor
    };
  }

  function loadDungeonStateFor(x, y) {
    if (window.DungeonState && typeof DungeonState.load === "function") {
      return DungeonState.load(getCtx(), x, y);
    }
    const key = dungeonKeyFromWorldPos(x, y);
    const st = dungeonStates[key];
    if (!st) return false;

    mode = "dungeon";
    currentDungeon = st.info || { x, y, level: st.level || 1, size: "medium" };
    floor = st.level || 1;
    window.floor = floor;

    map = st.map;
    seen = st.seen;
    visible = st.visible;
    enemies = st.enemies;
    corpses = st.corpses;
    decals = st.decals || [];
    dungeonExitAt = st.dungeonExitAt || { x, y };

    // Place player at the entrance hole
    player.x = dungeonExitAt.x;
    player.y = dungeonExitAt.y;

    // Ensure the entrance tile is marked as stairs
    if (inBounds(dungeonExitAt.x, dungeonExitAt.y)) {
      map[dungeonExitAt.y][dungeonExitAt.x] = TILES.STAIRS;
      if (visible[dungeonExitAt.y]) visible[dungeonExitAt.y][dungeonExitAt.x] = true;
      if (seen[dungeonExitAt.y]) seen[dungeonExitAt.y][dungeonExitAt.x] = true;
    }

    recomputeFOV();
    updateCamera();
    updateUI();
    log(`You re-enter the dungeon (Difficulty ${floor}${currentDungeon.size ? ", " + currentDungeon.size : ""}).`, "notice");
    requestDraw();
    return true;
  }

  function isWalkable(x, y) {
    if (!inBounds(x, y)) return false;
    const t = map[y][x];
    return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.STAIRS;
  }

  

  
  function createEnemyAt(x, y, depth) {
    if (window.Enemies && typeof Enemies.createEnemyAt === "function") {
      return Enemies.createEnemyAt(x, y, depth, rng);
    }
    // Fallback (shouldn't happen if enemies.js is loaded)
    const type = "goblin";
    const level = enemyLevelFor(type, depth);
    return { x, y, type, glyph: "g", hp: 3, atk: 1, xp: 5, level, announced: false };
  }

  
  
  function ensureVisibilityShape() {
    const rows = map.length;
    const cols = map[0] ? map[0].length : 0;
    const shapeOk = Array.isArray(visible) && visible.length === rows && (rows === 0 || (visible[0] && visible[0].length === cols));
    if (!shapeOk) {
      visible = Array.from({ length: rows }, () => Array(cols).fill(false));
    }
    const seenOk = Array.isArray(seen) && seen.length === rows && (rows === 0 || (seen[0] && seen[0].length === cols));
    if (!seenOk) {
      seen = Array.from({ length: rows }, () => Array(cols).fill(false));
    }
  }

  function recomputeFOV() {
    if (mode === "world") {
      // In overworld, reveal entire map (no fog-of-war)
      const rows = map.length;
      const cols = map[0] ? map[0].length : 0;
      const shapeOk = Array.isArray(visible) && visible.length === rows && (rows === 0 || (visible[0] && visible[0].length === cols));
      if (!shapeOk) {
        visible = Array.from({ length: rows }, () => Array(cols).fill(true));
        seen = Array.from({ length: rows }, () => Array(cols).fill(true));
      } else {
        for (let y = 0; y < rows; y++) {
          visible[y].fill(true);
          if (!seen[y]) seen[y] = Array(cols).fill(true);
          else seen[y].fill(true);
        }
      }
      return;
    }
    ensureVisibilityShape();
    if (window.FOV && typeof FOV.recomputeFOV === "function") {
      const ctx = getCtx();
      ctx.seen = seen;
      ctx.visible = visible;
      FOV.recomputeFOV(ctx);
      visible = ctx.visible;
      seen = ctx.seen;
      return;
    }
    if (inBounds(player.x, player.y)) {
      visible[player.y][player.x] = true;
      seen[player.y][player.x] = true;
    }
  }

  
  function updateCamera() {
    // Center camera on player
    const mapCols = map[0] ? map[0].length : COLS;
    const mapRows = map ? map.length : ROWS;
    const mapWidth = mapCols * TILE;
    const mapHeight = mapRows * TILE;

    const targetX = player.x * TILE + TILE / 2 - camera.width / 2;
    const targetY = player.y * TILE + TILE / 2 - camera.height / 2;

    camera.x = Math.max(0, Math.min(targetX, Math.max(0, mapWidth - camera.width)));
    camera.y = Math.max(0, Math.min(targetY, Math.max(0, mapHeight - camera.height)));
  }

  
  function getRenderCtx() {
    return {
      ctx2d: ctx,
      TILE, ROWS, COLS, COLORS, TILES,
      map, seen, visible,
      player, enemies, corpses, decals,
      camera,
      mode,
      world,
      npcs,
      shops,
      townProps,
      townBuildings,
      townExitAt,
      enemyColor: (t) => enemyColor(t),
      time: getClock(),
    };
  }

  
  let needsDraw = true;
  function requestDraw() { needsDraw = true; }
  function draw() {
    if (!needsDraw) return;
    if (window.Render && typeof Render.draw === "function") {
      Render.draw(getRenderCtx());
    }
    needsDraw = false;
  }

  

  

  function initWorld() {
    if (!(window.World && typeof World.generate === "function")) {
      log("World module missing; generating dungeon instead.", "warn");
      mode = "dungeon";
      generateLevel(floor);
      return;
    }
    const ctx = getCtx();
    world = World.generate(ctx, { width: MAP_COLS, height: MAP_ROWS });
    const start = World.pickTownStart(world, rng);
    player.x = start.x; player.y = start.y;
    mode = "world";
    enemies = [];
    corpses = [];
    decals = [];
    npcs = [];   // no NPCs on overworld
    shops = [];  // no shops on overworld
    map = world.map;
    // fill seen/visible fully in world
    seen = Array.from({ length: map.length }, () => Array(map[0].length).fill(true));
    visible = Array.from({ length: map.length }, () => Array(map[0].length).fill(true));
    updateCamera();
    recomputeFOV();
    updateUI();
    log("You arrive in the overworld. Towns: small (t), big (T), cities (C). Dungeons (D). Press Enter on a town/dungeon to enter.", "notice");
    if (window.UI && typeof UI.hideTownExitButton === "function") UI.hideTownExitButton();
    requestDraw();
  }

  

  function talkNearbyNPC() {
    if (mode !== "town") return false;
    const targets = [];
    for (const n of npcs) {
      const d = Math.abs(n.x - player.x) + Math.abs(n.y - player.y);
      if (d <= 1) targets.push(n);
    }
    if (targets.length === 0) {
      log("There is no one to talk to here.");
      return false;
    }
    const npc = targets[randInt(0, targets.length - 1)];
    const line = npc.lines[randInt(0, npc.lines.length - 1)];
    log(`${npc.name}: ${line}`, "info");
    requestDraw();
    return true;
  }

  // Town shops helpers and resting
  function shopAt(x, y) {
    if (!Array.isArray(shops)) return null;
    return shops.find(s => s.x === x && s.y === y) || null;
  }
  // Shop schedule helpers
  function minutesOfDay(h, m = 0) { return ((h | 0) * 60 + (m | 0)) % DAY_MINUTES; }
  function isOpenAt(shop, minutes) {
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    const o = shop.openMin, c = shop.closeMin;
    if (o === c) {
      // Interpret o===c with alwaysOpen=false as closed all day
      return false;
    }
    if (c > o) return minutes >= o && minutes < c; // same-day window
    // overnight window (e.g., 18:00 -> 06:00)
    return minutes >= o || minutes < c;
  }
  function isShopOpenNow(shop = null) {
    const t = getClock();
    const minutes = t.hours * 60 + t.minutes;
    if (!shop) {
      // Fallback: original behavior when no shop provided
      return t.phase === "day";
    }
    return isOpenAt(shop, minutes);
  }
  function shopScheduleStr(shop) {
    if (!shop) return "";
    const h2 = (min) => {
      const hh = ((min / 60) | 0) % 24;
      return String(hh).padStart(2, "0");
    };
    return `Opens ${h2(shop.openMin)}:00, closes ${h2(shop.closeMin)}:00`;
  }
  function minutesUntil(hourTarget /*0-23*/, minuteTarget = 0) {
    return TS.minutesUntil(turnCounter, hourTarget, minuteTarget);
  }
  function advanceTimeMinutes(mins) {
    turnCounter = TS.advanceMinutes(turnCounter, mins);
  }
  function restUntilMorning(healFraction = 0.25) {
    const mins = minutesUntil(6, 0); // rest until 06:00 dawn
    advanceTimeMinutes(mins);
    const heal = Math.max(1, Math.floor(player.maxHp * healFraction));
    const prev = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    log(`You rest until morning (${getClock().hhmm}). HP ${prev.toFixed(1)} -> ${player.hp.toFixed(1)}.`, "good");
    updateUI();
    requestDraw();
  }
  function restAtInn() {
    const mins = minutesUntil(6, 0);
    advanceTimeMinutes(mins);
    const prev = player.hp;
    player.hp = player.maxHp;
    log(`You spend the night at the inn. You wake up fully rested at ${getClock().hhmm}.`, "good");
    updateUI();
    requestDraw();
  }

  function generateTown() {
    // Prefer Town module (facade). If it handled generation, sync references and return.
    if (window.Town && typeof Town.generate === "function") {
      const ctx = getCtx();
      const handled = Town.generate(ctx);
      if (handled) {
        map = ctx.map; seen = ctx.seen; visible = ctx.visible;
        enemies = ctx.enemies; corpses = ctx.corpses; decals = ctx.decals || [];
        npcs = ctx.npcs || npcs; shops = ctx.shops || shops;
        townProps = ctx.townProps || townProps; townBuildings = ctx.townBuildings || townBuildings;
        townPlaza = ctx.townPlaza || townPlaza; tavern = ctx.tavern || tavern;
        townExitAt = ctx.townExitAt || townExitAt; townName = ctx.townName || townName;
        updateCamera(); recomputeFOV(); updateUI(); requestDraw();
        return;
      }
    }
    // Structured town: walls with a gate, main road to a central plaza, secondary roads, buildings aligned to blocks, shops near plaza

    // Determine current town size from overworld (default 'big')
    let townSize = "big";
    try {
      if (world && Array.isArray(world.towns)) {
        // Use the last recorded world position when entering a town
        const wx = (worldReturnPos && typeof worldReturnPos.x === "number") ? worldReturnPos.x : player.x;
        const wy = (worldReturnPos && typeof worldReturnPos.y === "number") ? worldReturnPos.y : player.y;
        const info = world.towns.find(t => t.x === wx && t.y === wy);
        if (info && info.size) townSize = info.size;
      }
    } catch (_) {}

    // Size the town map according to town size to remove excessive empty space
    // small: 60x40, big: 90x60, city: 120x80 (fallback to MAP_* caps)
    const dims = (function () {
      if (townSize === "small") return { W: Math.min(MAP_COLS, 60), H: Math.min(MAP_ROWS, 40) };
      if (townSize === "city") return { W: Math.min(MAP_COLS, 120), H: Math.min(MAP_ROWS, 80) };
      return { W: Math.min(MAP_COLS, 90), H: Math.min(MAP_ROWS, 60) }; // big
    })();
    const W = dims.W, H = dims.H;

    // Initialize a compact map for this town size
    map = Array.from({ length: H }, () => Array(W).fill(TILES.FLOOR));

    const clampXY = (x, y) => ({ x: Math.max(1, Math.min(W - 2, x)), y: Math.max(1, Math.min(H - 2, y)) });

    // Target building count ranges
    const buildingTargetMin = townSize === "small" ? 10 : townSize === "city" ? 60 : 20;
    const buildingTargetMax = townSize === "small" ? 15 : townSize === "city" ? 100 : 30;
    const buildingTarget = randInt(buildingTargetMin, buildingTargetMax);

    // Town walls (outer perimeter)
    for (let x = 0; x < W; x++) { map[0][x] = TILES.WALL; map[H - 1][x] = TILES.WALL; }
    for (let y = 0; y < H; y++) { map[y][0] = TILES.WALL; map[y][W - 1] = TILES.WALL; }

    // Choose gate closest to player's current world-projected position
    const targets = [
      { x: 1, y: player.y },                // west
      { x: W - 2, y: player.y },            // east
      { x: player.x, y: 1 },                // north
      { x: player.x, y: H - 2 },            // south
    ].map(p => clampXY(p.x, p.y));

    let best = targets[0], bd = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.x - player.x) + Math.abs(t.y - player.y);
      if (d < bd) { bd = d; best = t; }
    }
    const gate = best;
    // Carve gate opening in wall
    if (gate.x === 1) map[gate.y][0] = TILES.DOOR;
    else if (gate.x === W - 2) map[gate.y][W - 1] = TILES.DOOR;
    else if (gate.y === 1) map[0][gate.x] = TILES.DOOR;
    else if (gate.y === H - 2) map[H - 1][gate.x] = TILES.DOOR;

    // Ensure gate tile inside wall is floor
    map[gate.y][gate.x] = TILES.FLOOR;
    player.x = gate.x; player.y = gate.y;
    townExitAt = { x: gate.x, y: gate.y };

    // Generate a town name (simple syllable-based)
    const makeTownName = () => {
      const prefixes = ["Oak", "Ash", "Pine", "River", "Stone", "Iron", "Silver", "Gold", "Wolf", "Fox", "Moon", "Star", "Red", "White", "Black", "Green"];
      const suffixes = ["dale", "ford", "field", "burg", "ton", "stead", "haven", "fall", "gate", "port", "wick", "shire", "crest", "view", "reach"];
      const mid = ["", "wood", "water", "brook", "hill", "rock", "ridge"];
      const p = prefixes[randInt(0, prefixes.length - 1)];
      const m = mid[randInt(0, mid.length - 1)];
      const s = suffixes[randInt(0, suffixes.length - 1)];
      return [p, m, s].filter(Boolean).join("") ;
    };
    townName = makeTownName();

    // Central plaza (rectangle) scaled by town size
    const plaza = { x: (W / 2) | 0, y: (H / 2) | 0 };
    townPlaza = { x: plaza.x, y: plaza.y };
    const plazaDims = (function () {
      if (townSize === "small") return { w: 10, h: 8 };
      if (townSize === "city") return { w: 18, h: 14 };
      return { w: 14, h: 12 }; // big
    })();
    const plazaW = plazaDims.w, plazaH = plazaDims.h;
    for (let yy = (plaza.y - (plazaH / 2)) | 0; yy <= (plaza.y + (plazaH / 2)) | 0; yy++) {
      for (let xx = (plaza.x - (plazaW / 2)) | 0; xx <= (plaza.x + (plazaW / 2)) | 0; xx++) {
        if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
        map[yy][xx] = TILES.FLOOR;
      }
    }

    // Main road from gate to plaza (L-shape)
    const carveRoad = (x1, y1, x2, y2) => {
      let x = x1, y = y1;
      while (x !== x2) { map[y][x] = TILES.FLOOR; x += Math.sign(x2 - x); }
      while (y !== y2) { map[y][x] = TILES.FLOOR; y += Math.sign(y2 - y); }
      map[y][x] = TILES.FLOOR;
    };
    carveRoad(gate.x, gate.y, plaza.x, gate.y);
    carveRoad(plaza.x, gate.y, plaza.x, plaza.y);

    // Secondary roads (grid) aligned around plaza
    for (let y = 6; y < H - 6; y += 8) for (let x = 1; x < W - 1; x++) map[y][x] = TILES.FLOOR;
    for (let x = 6; x < W - 6; x += 10) for (let y = 1; y < H - 1; y++) map[y][x] = TILES.FLOOR;

    // Blocks: place buildings aligned with blocks, leaving 1-tile sidewalk
    const buildings = [];
    const placeBuilding = (bx, by, bw, bh) => {
      // hollow rectangle
      for (let yy = by; yy < by + bh; yy++) {
        for (let xx = bx; xx < bx + bw; xx++) {
          if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
          const isBorder = (yy === by || yy === by + bh - 1 || xx === bx || xx === bx + bw - 1);
          map[yy][xx] = isBorder ? TILES.WALL : TILES.FLOOR;
        }
      }
      const b = { x: bx, y: by, w: bw, h: bh };
      buildings.push(b);
      return b;
    };

    // Iterate grid and try to place buildings in areas not roads
    // Block cell nominal size ~10x8; we inset by 1 for sidewalk, then choose random w/h that fit.
    for (let by = 2; by < H - 10 && buildings.length < buildingTarget; by += 8) {
      for (let bx = 2; bx < W - 12 && buildings.length < buildingTarget; bx += 10) {
        // skip if near plaza
        if (Math.abs((bx + 5) - plaza.x) < 9 && Math.abs((by + 4) - plaza.y) < 7) continue;
        // ensure area is floor and not road lines
        let clear = true;
        const blockW = 8, blockH = 6; // usable space inside each block cell
        for (let yy = by; yy < by + (blockH + 1) && clear; yy++) {
          for (let xx = bx; xx < bx + (blockW + 1); xx++) {
            if (map[yy][xx] !== TILES.FLOOR) { clear = false; break; }
          }
        }
        if (!clear) continue;

        // Randomize building size within the block with at least 2x2 interior
        const w = randInt(6, blockW);   // 6..8
        const h = randInt(4, blockH);   // 4..6
        const ox = randInt(0, Math.max(0, blockW - w));
        const oy = randInt(0, Math.max(0, blockH - h));
        placeBuilding(bx + 1 + ox, by + 1 + oy, w, h);
      }
    }

    // Doors and shops near plaza/main road
    function candidateDoors(b) {
      // candidate door positions on building border with outside tile
      return [
        { x: b.x + ((b.w / 2) | 0), y: b.y, ox: 0, oy: -1 },                      // top
        { x: b.x + b.w - 1, y: b.y + ((b.h / 2) | 0), ox: +1, oy: 0 },            // right
        { x: b.x + ((b.w / 2) | 0), y: b.y + b.h - 1, ox: 0, oy: +1 },            // bottom
        { x: b.x, y: b.y + ((b.h / 2) | 0), ox: -1, oy: 0 },                      // left
      ];
    }
    function ensureDoor(b) {
      // If any door already present, leave it; else choose a side with floor outside
      const cands = candidateDoors(b);
      // prefer candidates with outside floor
      const good = cands.filter(d => inBounds(d.x + d.ox, d.y + d.oy) && map[d.y + d.oy][d.x + d.ox] === TILES.FLOOR);
      const pick = (good.length ? good : cands)[randInt(0, (good.length ? good : cands).length - 1)];
      if (inBounds(pick.x, pick.y)) map[pick.y][pick.x] = TILES.DOOR;
      return pick;
    }
    function getExistingDoor(b) {
      const cds = candidateDoors(b);
      for (const d of cds) {
        if (inBounds(d.x, d.y) && map[d.y][d.x] === TILES.DOOR) return { x: d.x, y: d.y };
      }
      // ensure and return if none
      const dd = ensureDoor(b);
      return { x: dd.x, y: dd.y };
    }

    shops = [];
    const shopNames = ["Blacksmith", "Apothecary", "Armorer", "Trader", "Inn", "Fletcher", "Herbalist", "Fishmonger"];

    function pickShopHours(name) {
      const n = (name || "").toLowerCase();
      // Defaults
      let openH = 8, closeH = 18;
      let alwaysOpen = false;
      if (n.includes("blacksmith") || n.includes("armorer") || n.includes("fletcher") || n.includes("trader") || n.includes("fishmonger")) {
        openH = 8; closeH = 17;
      } else if (n.includes("apothecary") || n.includes("herbalist")) {
        openH = 9; closeH = 18;
      } else if (n.includes("inn")) {
        // Inns are always open
        alwaysOpen = true;
        openH = 0; closeH = 0;
      } else if (n.includes("tavern")) {
        // Taverns are always open
        alwaysOpen = true;
        openH = 0; closeH = 0;
      }
      return { openMin: minutesOfDay(openH), closeMin: minutesOfDay(closeH), alwaysOpen };
    }

    // Pick buildings closest to plaza for shops
    const scored = buildings.map(b => ({ b, d: Math.abs((b.x + (b.w / 2)) - plaza.x) + Math.abs((b.y + (b.h / 2)) - plaza.y) }));
    scored.sort((a, b) => a.d - b.d);
    const shopCount = Math.min(8, scored.length);
    for (let i = 0; i < shopCount; i++) {
      const b = scored[i].b;
      const door = ensureDoor(b);
      const name = shopNames[i % shopNames.length];
      const sched = pickShopHours(name);
      // Compute a default "inside" work tile just past the door
      const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      let inside = null;
      for (const dxy of inward) {
        const ix = door.x + dxy.dx, iy = door.y + dxy.dy;
        if (ix > b.x && ix < b.x + b.w - 1 && iy > b.y && iy < b.y + b.h - 1 && map[iy][ix] === TILES.FLOOR) {
          inside = { x: ix, y: iy };
          break;
        }
      }
      // Fallback to a tile near the geometric center of the building
      if (!inside) {
        const cx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, Math.floor(b.x + b.w / 2)));
        const cy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, Math.floor(b.y + b.h / 2)));
        inside = { x: cx, y: cy };
      }
      shops.push({ x: door.x, y: door.y, type: "shop", name, openMin: sched.openMin, closeMin: sched.closeMin, building: { x: b.x, y: b.y, w: b.w, h: b.h, door: { x: door.x, y: door.y } }, inside });
    }
    // Ensure every non-shop building also has at least one door
    const shopDoorSet = new Set(shops.map(s => `${s.x},${s.y}`));
    for (const b of buildings) {
      // check if any of the border tiles is already a DOOR
      const cd = candidateDoors(b);
      let hasDoor = cd.some(d => inBounds(d.x, d.y) && map[d.y][d.x] === TILES.DOOR);
      if (!hasDoor) {
        const d = ensureDoor(b);
        // not a shop; just a house
        if (!shopDoorSet.has(`${d.x},${d.y}`)) {
          // no need to add to shops array for normal houses
        }
      }
    }

    // Add windows to building walls (block movement but allow FOV to pass)
    function placeWindowsOnBuilding(b) {
      const sides = [
        { // top edge (exclude corners)
          pts: Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y }))
        },
        { // bottom
          pts: Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y + b.h - 1 }))
        },
        { // left
          pts: Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x, y: b.y + 1 + i }))
        },
        { // right
          pts: Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x + b.w - 1, y: b.y + 1 + i }))
        }
      ];

      // Collect all candidate wall tiles (not doors)
      let candidates = [];
      for (const s of sides) {
        for (const p of s.pts) {
          if (!inBounds(p.x, p.y)) continue;
          const t = map[p.y][p.x];
          if (t !== TILES.WALL) continue;
          candidates.push(p);
        }
      }
      if (candidates.length === 0) return;

      // Limit total windows per building based on size, with a small cap.
      const limit = Math.min(3, Math.max(1, Math.floor((b.w + b.h) / 10)));

      // Helper: avoid adjacent windows
      const placed = [];
      const isAdjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;

      // Randomly place up to 'limit' windows without adjacency
      let attempts = 0;
      while (placed.length < limit && candidates.length > 0 && attempts++ < candidates.length * 2) {
        const idx = randInt(0, candidates.length - 1);
        const p = candidates[idx];
        // Skip if adjacent to existing window
        if (placed.some(q => isAdjacent(p, q))) {
          candidates.splice(idx, 1);
          continue;
        }
        // Place window
        map[p.y][p.x] = TILES.WINDOW;
        placed.push(p);
        // Remove neighbors to keep spacing
        candidates = candidates.filter(c => !isAdjacent(c, p));
      }
    }
    for (const b of buildings) placeWindowsOnBuilding(b);

    // Store buildings globally with their doors for NPC homes/routines
    townBuildings = buildings.map(b => {
      const door = getExistingDoor(b);
      return { x: b.x, y: b.y, w: b.w, h: b.h, door };
    });

    // Props in plaza and parks + building interiors
    townProps = [];
    const addProp = (x, y, type, name) => {
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return;
      if (map[y][x] !== TILES.FLOOR) return;
      if (townProps.some(p => p.x === x && p.y === y)) return;
      townProps.push({ x, y, type, name });
    };
    const addSignNear = (x, y, text) => {
      // place a sign on a neighboring floor tile not occupied
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      for (const d of dirs) {
        const sx = x + d.dx, sy = y + d.dy;
        if (sx <= 0 || sy <= 0 || sx >= W - 1 || sy >= H - 1) continue;
        if (map[sy][sx] !== TILES.FLOOR) continue;
        if (townProps.some(p => p.x === sx && p.y === sy)) continue;
        addProp(sx, sy, "sign", text);
        return true;
      }
      return false;
    };

    // Place a welcome sign near the town gate
    addSignNear(gate.x, gate.y, `Welcome to ${townName}`);

    // Fill building interiors with richer furnishing
    function fillBuildingInterior(b) {
      const insideFloor = (x, y) => (x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1 && map[y][x] === TILES.FLOOR);
      const occupiedTile = (x, y) => townProps.some(p => p.x === x && p.y === y);
      const placeRandom = (type, name, attempts = 60) => {
        let t = 0;
        while (t++ < attempts) {
          const xx = randInt(b.x + 1, b.x + b.w - 2);
          const yy = randInt(b.y + 1, b.y + b.h - 2);
          if (!insideFloor(xx, yy)) continue;
          if (occupiedTile(xx, yy)) continue;
          addProp(xx, yy, type, name);
          return true;
        }
        return false;
      };

      // Fireplace near walls
      const borderAdj = [];
      for (let yy = b.y + 1; yy < b.y + b.h - 1; yy++) {
        for (let xx = b.x + 1; xx < b.x + b.w - 1; xx++) {
          if (!insideFloor(xx, yy)) continue;
          if (map[yy - 1][xx] === TILES.WALL || map[yy + 1][xx] === TILES.WALL || map[yy][xx - 1] === TILES.WALL || map[yy][xx + 1] === TILES.WALL) {
            borderAdj.push({ x: xx, y: yy });
          }
        }
      }
      if (borderAdj.length && rng() < 0.9) {
        const f = borderAdj[randInt(0, borderAdj.length - 1)];
        addProp(f.x, f.y, "fireplace", "Fireplace");
      }

      // Beds: larger homes get more beds
      const area = b.w * b.h;
      const bedTarget = Math.max(1, Math.min(3, Math.floor(area / 24))); // 1..3
      let bedsPlaced = 0, triesBed = 0;
      while (bedsPlaced < bedTarget && triesBed++ < 120) {
        if (placeRandom("bed", "Bed")) bedsPlaced++;
      }

      // Tables and chairs (simple)
      if (rng() < 0.8) placeRandom("table", "Table");
      let chairCount = rng() < 0.5 ? 2 : 1;
      while (chairCount-- > 0) placeRandom("chair", "Chair");

      // Storage: chests, crates, barrels
      let chestCount = rng() < 0.5 ? 2 : 1;
      let placedC = 0, triesC = 0;
      while (placedC < chestCount && triesC++ < 80) {
        if (placeRandom("chest", "Chest")) placedC++;
      }
      let crates = rng() < 0.6 ? 2 : 1;
      while (crates-- > 0) placeRandom("crate", "Crate");
      let barrels = rng() < 0.6 ? 2 : 1;
      while (barrels-- > 0) placeRandom("barrel", "Barrel");

      // Shelves against inner walls
      const shelfSpots = borderAdj.slice();
      let shelves = Math.min(2, Math.floor(area / 30));
      while (shelves-- > 0 && shelfSpots.length) {
        const s = shelfSpots.splice(randInt(0, shelfSpots.length - 1), 1)[0];
        if (!occupiedTile(s.x, s.y)) addProp(s.x, s.y, "shelf", "Shelf");
      }

      // Plants/rugs for variety
      if (rng() < 0.5) placeRandom("plant", "Plant");
      if (rng() < 0.5) placeRandom("rug", "Rug");
    }
    for (const b of buildings) fillBuildingInterior(b);

    // Ensure at least one tavern (towns) and 1–2 in cities, with cozy interior and beds.
    (function ensureTaverns() {
      if (!buildings.length) return;

      const desiredCount = (townSize === "city") ? 2 : 1;

      function scoreBuilding(b) {
        const area = b.w * b.h;
        const d = Math.abs((b.x + (b.w / 2)) - plaza.x) + Math.abs((b.y + (b.h / 2)) - plaza.y);
        return area - d * 2;
      }

      function isInside(bx, by, b) {
        return bx > b.x && bx < b.x + b.w - 1 && by > b.y && by < b.y + b.h - 1;
      }

      // Create a combined Inn/Tavern: large open bar area plus 4–10 small rooms with beds.
      function makeInnTavernIn(b) {
        const door = getExistingDoor(b);
        // First inn/tavern becomes global shelter
        if (!tavern) tavern = { building: b, door, beds: [] };

        // Make double-door for inns: add a second adjacent door tile on the same wall side
        (function addDoubleDoor() {
          const isTop = (door.y === b.y);
          const isBottom = (door.y === b.y + b.h - 1);
          const isLeft = (door.x === b.x);
          const isRight = (door.x === b.x + b.w - 1);
          let nx = door.x, ny = door.y;
          if (isTop || isBottom) {
            // Horizontal neighbor on border
            if (door.x + 1 < b.x + b.w - 1) { nx = door.x + 1; ny = door.y; }
            else if (door.x - 1 > b.x) { nx = door.x - 1; ny = door.y; }
          } else if (isLeft || isRight) {
            // Vertical neighbor on border
            if (door.y + 1 < b.y + b.h - 1) { nx = door.x; ny = door.y + 1; }
            else if (door.y - 1 > b.y) { nx = door.x; ny = door.y - 1; }
          }
          if (inBounds(nx, ny) && map[ny][nx] === TILES.WALL) {
            map[ny][nx] = TILES.DOOR;
          }
        })();

        // Determine bar open area: near door, carve a rectangular open space
        const innerMinX = b.x + 1, innerMaxX = b.x + b.w - 2;
        const innerMinY = b.y + 1, innerMaxY = b.y + b.h - 2;

        // Shop marker (always open) with building reference, named "Inn" to represent combined inn/tavern.
        const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        let deskPos = null;
        for (const dxy of inward) {
          const ix = door.x + dxy.dx, iy = door.y + dxy.dy;
          if (isInside(ix, iy, b) && map[iy][ix] === TILES.FLOOR) { deskPos = { x: ix, y: iy }; break; }
        }
        if (!deskPos) {
          deskPos = { x: Math.max(innerMinX, Math.min(innerMaxX, door.x)), y: Math.max(innerMinY, Math.min(innerMaxY, door.y)) };
        }
        shops.push({
          x: door.x, y: door.y, type: "shop", name: "Inn",
          openMin: 0, closeMin: 0, alwaysOpen: true,
          building: { x: b.x, y: b.y, w: b.w, h: b.h, door: { x: door.x, y: door.y } },
          inside: deskPos
        });
        addSignNear(door.x, door.y, "Inn");

        // Bar counter
        addProp(deskPos.x, deskPos.y, "table", "Bar Counter");

        // Define bar area size proportional to building
        const barW = Math.max(8, Math.min(16, Math.floor(b.w * 0.6)));
        const barH = Math.max(6, Math.min(10, Math.floor(b.h * 0.5)));
        const barX1 = Math.max(innerMinX, Math.min(innerMaxX - barW + 1, deskPos.x - Math.floor(barW / 2)));
        const barY1 = Math.max(innerMinY, Math.min(innerMaxY - barH + 1, deskPos.y - Math.floor(barH / 2)));
        for (let yy = barY1; yy < barY1 + barH; yy++) {
          for (let xx = barX1; xx < barX1 + barW; xx++) {
            if (!isInside(xx, yy, b)) continue;
            // ensure floor open space
            if (map[yy][xx] === TILES.WALL) map[yy][xx] = TILES.FLOOR;
          }
        }

        // Furnish bar area: benches, tables, chairs, rugs, barrels, fireplace on inner wall
        (function furnishBar() {
          // fireplace against inner wall near bar
          const borderAdj = [];
          for (let yy = innerMinY; yy <= innerMaxY; yy++) {
            for (let xx = innerMinX; xx <= innerMaxX; xx++) {
              const inBar = (yy >= barY1 && yy < barY1 + barH && xx >= barX1 && xx < barX1 + barW);
              if (!inBar) continue;
              if (map[yy][xx] !== TILES.FLOOR) continue;
              if (map[yy - 1]?.[xx] === TILES.WALL || map[yy + 1]?.[xx] === TILES.WALL || map[yy]?.[xx - 1] === TILES.WALL || map[yy]?.[xx + 1] === TILES.WALL) {
                borderAdj.push({ x: xx, y: yy });
              }
            }
          }
          if (borderAdj.length) {
            const f = borderAdj[randInt(0, borderAdj.length - 1)];
            if (!townProps.some(p => p.x === f.x && p.y === f.y)) addProp(f.x, f.y, "fireplace", "Fireplace");
          }

          let benchesPlaced = 0, triesB = 0;
          const benchTarget = Math.min(10, Math.max(6, Math.floor((barW * barH) / 12)));
          while (benchesPlaced < benchTarget && triesB++ < 300) {
            const bx = randInt(barX1, barX1 + barW - 1);
            const by = randInt(barY1, barY1 + barH - 1);
            if (map[by][bx] !== TILES.FLOOR) continue;
            if (townProps.some(p => p.x === bx && p.y === by)) continue;
            addProp(bx, by, "bench", "Bench");
            benchesPlaced++;
          }
          // tables and chairs
          let tables = 0, triesT = 0;
          const tableTarget = Math.min(5, Math.max(2, Math.floor(barW / 4)));
          while (tables < tableTarget && triesT++ < 160) {
            const tx = randInt(barX1, barX1 + barW - 1);
            const ty = randInt(barY1, barY1 + barH - 1);
            if (map[ty][tx] !== TILES.FLOOR) continue;
            if (townProps.some(p => p.x === tx && p.y === ty)) continue;
            addProp(tx, ty, "table", "Table");
            tables++;
          }
          let chairs = 0, triesC = 0;
          const chairTarget = tableTarget * 2;
          while (chairs < chairTarget && triesC++ < 200) {
            const cx = randInt(barX1, barX1 + barW - 1);
            const cy = randInt(barY1, barY1 + barH - 1);
            if (map[cy][cx] !== TILES.FLOOR) continue;
            if (townProps.some(p => p.x === cx && p.y === cy)) continue;
            addProp(cx, cy, "chair", "Chair");
            chairs++;
          }
          // rugs
          let rugs = 0, triesR = 0;
          const rugTarget = Math.min(4, Math.max(2, Math.floor(barW / 6)));
          while (rugs < rugTarget && triesR++ < 120) {
            const rx = randInt(barX1, barX1 + barW - 1);
            const ry = randInt(barY1, barY1 + barH - 1);
            if (map[ry][rx] !== TILES.FLOOR) continue;
            if (townProps.some(p => p.x === rx && p.y === ry)) continue;
            addProp(rx, ry, "rug", "Rug");
            rugs++;
          }
          // barrels near walls in bar area
          let barrels = 0, triesBrl = 0;
          const barrelTarget = Math.min(6, Math.max(3, Math.floor(barW / 5)));
          while (barrels < barrelTarget && triesBrl++ < 220) {
            const bx = randInt(barX1, barX1 + barW - 1);
            const by = randInt(barY1, barY1 + barH - 1);
            if (map[by][bx] !== TILES.FLOOR) continue;
            if (townProps.some(p => p.x === bx && p.y === by)) continue;
            addProp(bx, by, "barrel", "Barrel");
            barrels++;
          }
        })();

        // Create rooms grid along one side (prefer opposite side from bar)
        const rooms = randInt(6, 12);
        // Choose corridor position and orientation
        const corridorOnTop = (deskPos.y < (b.y + b.h / 2));
        const corrY = corridorOnTop ? innerMinY + 1 : innerMaxY - 2;
        for (let xx = innerMinX; xx <= innerMaxX; xx++) {
          // Carve corridor line
          if (map[corrY][xx] === TILES.WALL) map[corrY][xx] = TILES.FLOOR;
        }

        // Rooms below (if corridor on top) or above (if corridor on bottom)
        const roomBandY1 = corridorOnTop ? corrY + 1 : innerMinY;
        const roomBandY2 = corridorOnTop ? innerMaxY : corrY - 1;

        // Partition horizontally into rooms
        const bandHeight = roomBandY2 - roomBandY1 + 1;
        const minRoomW = 4, maxRoomW = 6, roomH = Math.max(3, Math.min(5, bandHeight));
        let xCursor = innerMinX;
        let createdRooms = 0;
        while (xCursor + minRoomW - 1 <= innerMaxX && createdRooms < rooms) {
          const w = Math.min(maxRoomW, Math.max(minRoomW, randInt(minRoomW, maxRoomW)));
          const rx1 = xCursor;
          const rx2 = Math.min(innerMaxX, rx1 + w - 1);
          xCursor = rx2 + 1;
          // Skip overlap with bar area significantly
          const overlapsBar = !(rx2 < barX1 || rx1 > (barX1 + barW - 1));
          if (overlapsBar && rng() < 0.7) continue;

          const ry1 = roomBandY1;
          const ry2 = Math.min(roomBandY1 + roomH - 1, roomBandY2);
          if (ry2 - ry1 < 2) continue;

          // Build room walls (hollow)
          for (let yy = ry1; yy <= ry2; yy++) {
            for (let xx = rx1; xx <= rx2; xx++) {
              if (!isInside(xx, yy, b)) continue;
              const isBorder = (yy === ry1 || yy === ry2 || xx === rx1 || xx === rx2);
              map[yy][xx] = isBorder ? TILES.WALL : TILES.FLOOR;
            }
          }
          // Door from corridor
          const doorX = randInt(rx1 + 1, rx2 - 1);
          const doorY = corridorOnTop ? ry1 : ry2;
          if (isInside(doorX, doorY, b)) map[doorY][doorX] = TILES.DOOR;

          // Bed inside room
          let bedPlaced = false, attempts = 0;
          while (!bedPlaced && attempts++ < 60) {
            const bx = randInt(rx1 + 1, rx2 - 1);
            const by = randInt(ry1 + 1, ry2 - 1);
            if (map[by][bx] !== TILES.FLOOR) continue;
            if (townProps.some(p => p.x === bx && p.y === by)) continue;
            addProp(bx, by, "bed", "Inn Bed");
            tavern.beds.push({ x: bx, y: by });
            bedPlaced = true;
          }

          createdRooms++;
        }

        // Barkeeper NPC
        const kp = deskPosFor(b, door, corridorOnTop, corrY) || door;
        npcs.push({
          x: kp.x, y: kp.y,
          name: "Barkeep",
          lines: ["Welcome to the inn.", "Grab a seat.", "Beds upstairs are ready."],
          isBarkeeper: true,
          _work: { x: kp.x, y: kp.y },
        });

        function deskPosFor(b, door, top, cy) {
          const dirs = [{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:0},{dx:-1,dy:0}];
          for (const d of dirs) {
            const ix = door.x + d.dx, iy = door.y + d.dy;
            if (isInside(ix, iy, b) && map[iy][ix] === TILES.FLOOR) return { x: ix, y: iy };
          }
          // fallback near corridor
          const ix = Math.max(innerMinX, Math.min(innerMaxX, door.x));
          const iy = cy;
          if (isInside(ix, iy, b) && map[iy][ix] === TILES.FLOOR) return { x: ix, y: iy };
          return null;
        }
      }

      // Build candidate list sorted by score
      const candidates = buildings.slice().sort((a, b) => scoreBuilding(b) - scoreBuilding(a));
      let created = 0;
      // Use existing buildings first
      for (const b of candidates) {
        if (created >= desiredCount) break;
        // Require larger than a typical house for inns
        if ((b.w * b.h) < 60) continue;
        // If an inn shop already exists here, skip
        const hasInnShop = shops.some(s => s.name === "Inn" && s.building && s.building.x === b.x && s.building.y === b.y && s.building.w === b.w && s.building.h === b.h);
        if (hasInnShop) continue;
        makeInnTavernIn(b);
        created++;
      }

      // If not enough, create new larger buildings near plaza edges
      const need = desiredCount - created;
      const tryPositions = [
        { x: plaza.x - 12, y: plaza.y - 6 },
        { x: plaza.x + 4,  y: plaza.y - 6 },
        { x: plaza.x - 12, y: plaza.y + 6 },
        { x: plaza.x + 4,  y: plaza.y + 6 },
      ];
      let pi = 0;
      for (let k = 0; k < need; k++) {
        let placedB = null;
        for (let tries = 0; tries < 80 && !placedB; tries++) {
          const pos = tryPositions[pi++ % tryPositions.length];
          // Choose a bigger size with at least 8x6 interior
          const bw = randInt(12, 16);
          const bh = randInt(10, 14);
          const bx = Math.max(2, Math.min(W - bw - 2, pos.x + randInt(-2, 2)));
          const by = Math.max(2, Math.min(H - bh - 2, pos.y + randInt(-2, 2)));
          // Check area clear (avoid roads/windows/doors)
          let ok = true;
          for (let yy = by; yy < by + bh && ok; yy++) {
            for (let xx = bx; xx < bx + bw && ok; xx++) {
              if (map[yy][xx] !== TILES.FLOOR) ok = false;
            }
          }
          if (!ok) continue;
          const newB = placeBuilding(bx, by, bw, bh);
          placedB = newB;
        }
        if (placedB) {
          makeInnTavernIn(placedB);
        }
      }

      // Log summary for visibility
      try {
        const innCount = shops.filter(s => (s.name || "").toLowerCase().includes("inn")).length;
        log(`Town has ${innCount} inn(s).`, innCount ? "info" : "warn");
      } catch (_) {}
    })();

    // Plaza fixtures
    addProp(plaza.x, plaza.y, "well", "Town Well");
    addProp(plaza.x - 6, plaza.y - 4, "lamp", "Lamp Post");
    addProp(plaza.x + 6, plaza.y - 4, "lamp", "Lamp Post");
    addProp(plaza.x - 6, plaza.y + 4, "lamp", "Lamp Post");
    addProp(plaza.x + 6, plaza.y + 4, "lamp", "Lamp Post");
    for (let dx = -4; dx <= 4; dx += 4) {
      addProp(plaza.x + dx, plaza.y - 3, "bench", "Bench");
      addProp(plaza.x + dx, plaza.y + 3, "bench", "Bench");
    }
    for (let i = -4; i <= 4; i += 4) {
      addProp(plaza.x - 8, plaza.y + i, "stall", "Market Stall");
      addProp(plaza.x + 8, plaza.y + i, "stall", "Market Stall");
    }
    if (rng() < 0.35) addProp(plaza.x + 1, plaza.y, "fountain", "Fountain");
    // Small park corners with trees
    for (let t = 0; t < 16; t++) {
      const tx = plaza.x + randInt(-10, 10);
      const ty = plaza.y + randInt(-8, 8);
      addProp(tx, ty, "tree", "Tree");
    }

    // Extra city lights: add more lamps around roads and plaza for "city" size
    if (townSize === "city") {
      const addLampIfFree = (x, y) => {
        if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
        if (map[y][x] !== TILES.FLOOR) return false;
        if (townProps.some(p => p.x === x && p.y === y)) return false;
        addProp(x, y, "lamp", "Lamp Post");
        return true;
      };
      // Lamps around plaza ring
      for (let radius = 5; radius <= 9; radius += 2) {
        addLampIfFree(plaza.x - radius, plaza.y);
        addLampIfFree(plaza.x + radius, plaza.y);
        addLampIfFree(plaza.x, plaza.y - radius);
        addLampIfFree(plaza.x, plaza.y + radius);
      }
      // Lamps along main road (horizontal and vertical)
      for (let x = 2; x < W - 2; x += 6) addLampIfFree(x, gate.y);
      for (let y = 2; y < H - 2; y += 6) addLampIfFree(plaza.x, y);
      // Random scatter near roads
      let extra = 18, attempts = 0;
      while (extra > 0 && attempts++ < 400) {
        const x = randInt(2, W - 3);
        const y = randInt(2, H - 3);
        // Prefer tiles near roads: check if same row as a road or same column
        const nearMain = (y === gate.y) || (x === plaza.x);
        const nearGrid = (y % 8 === 6) || (x % 10 === 6);
        if ((nearMain || nearGrid) && addLampIfFree(x, y)) {
          extra--;
        }
      }
    }

    // Town NPCs around plaza and along main road, avoid player adjacency
    npcs = [];
    // Populate shopkeepers, residents, and pets via TownAI
    if (window.TownAI && typeof TownAI.populateTown === "function") {
      TownAI.populateTown(getCtx());
    }

    // Shopkeepers spawned by TownAI.populateTown

    // Residents spawned by TownAI.populateTown

    const lines = [
      `Welcome to ${townName || "our town"}.`,
      "Shops are marked with S.",
      "Rest your feet a while.",
      "The dungeon is dangerous.",
      "Buy supplies before you go.",
      "Lovely day on the plaza.",
      "Care for a drink at the well?",
    ];
    // Scale roaming villagers count by buildings (cap within range)
    const roamTarget = Math.min(14, Math.max(6, Math.floor((townBuildings?.length || 12) / 2)));
    let placed = 0, tries = 0;
    while (placed < roamTarget && tries++ < 800) {
      const onRoad = rng() < 0.4;
      let x, y;
      if (onRoad) {
        // sample near main road y = gate.y or x = plaza.x
        if (rng() < 0.5) { y = gate.y; x = randInt(2, W - 3); }
        else { x = plaza.x; y = randInt(2, H - 3); }
      } else {
        const ox = randInt(-10, 10), oy = randInt(-8, 8);
        x = Math.max(1, Math.min(W - 2, plaza.x + ox));
        y = Math.max(1, Math.min(H - 2, plaza.y + oy));
      }
      if (map[y][x] !== TILES.FLOOR && map[y][x] !== TILES.DOOR) continue;
      if (x === player.x && y === player.y) continue;
      if (manhattan(player.x, player.y, x, y) <= 1) continue;
      if (npcs.some(n => n.x === x && n.y === y)) continue;
      if (townProps.some(p => p.x === x && p.y === y)) continue;
      npcs.push({ x, y, name: `Villager ${placed + 1}`, lines, _likesTavern: rng() < 0.45 });
      placed++;
    }

    // Pets spawned by TownAI.populateTown

    // Visibility (start unseen; FOV will reveal)
    seen = Array.from({ length: H }, () => Array(W).fill(false));
    visible = Array.from({ length: H }, () => Array(W).fill(false));
    enemies = [];
    corpses = [];
    decals = [];
  }

  function ensureTownSpawnClear() {
    if (window.Town && typeof Town.ensureSpawnClear === "function") {
      const handled = Town.ensureSpawnClear(getCtx());
      if (handled) return;
    }
    // Make sure the player isn't inside a building (WALL).
    // If current tile is not walkable, move to the nearest FLOOR/DOOR tile.
    const H = map.length;
    const W = map[0] ? map[0].length : 0;
    const isWalk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (map[y][x] === TILES.FLOOR || map[y][x] === TILES.DOOR);
    if (isWalk(player.x, player.y)) return;

    // BFS from current position to nearest walkable
    const q = [];
    const seenB = new Set();
    q.push({ x: player.x, y: player.y, d: 0 });
    seenB.add(`${player.x},${player.y}`);
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    while (q.length) {
      const cur = q.shift();
      for (const d of dirs) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        const key = `${nx},${ny}`;
        if (seenB.has(key)) continue;
        seenB.add(key);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (isWalk(nx, ny)) {
          player.x = nx; player.y = ny;
          return;
        }
        // expand through walls minimally to escape building
        q.push({ x: nx, y: ny, d: cur.d + 1 });
      }
    }
    // Fallback to center
    player.x = (W / 2) | 0;
    player.y = (H / 2) | 0;
  }

  function isFreeTownFloor(x, y) {
    // Prefer shared Utils module
    if (window.Utils && typeof Utils.isFreeTownFloor === "function") {
      return Utils.isFreeTownFloor(getCtx(), x, y);
    }
    if (!inBounds(x, y)) return false;
    if (map[y][x] !== TILES.FLOOR && map[y][x] !== TILES.DOOR) return false;
    if (x === player.x && y === player.y) return false;
    if (Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y)) return false;
    if (Array.isArray(townProps) && townProps.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  function manhattan(ax, ay, bx, by) {
    if (window.Utils && typeof Utils.manhattan === "function") {
      return Utils.manhattan(ax, ay, bx, by);
    }
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  function clearAdjacentNPCsAroundPlayer() {
    // Ensure the four cardinal neighbors around the player are not all occupied by NPCs
    const neighbors = [
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ];
    // If any neighbor has an NPC, remove up to two to keep space
    for (const pos of neighbors) {
      const idx = npcs.findIndex(n => n.x === pos.x && n.y === pos.y);
      if (idx !== -1) {
        npcs.splice(idx, 1);
      }
    }
  }

  function spawnGateGreeters(count = 4) {
    if (window.Town && typeof Town.spawnGateGreeters === "function") {
      const handled = Town.spawnGateGreeters(getCtx(), count);
      if (handled) return;
    }
    if (!townExitAt) return;
    const dirs = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
    ];
    const names = ["Ava", "Borin", "Cora", "Darin", "Eda", "Finn", "Goro", "Hana"];
    const lines = [
      `Welcome to ${townName || "our town"}.`,
      "Shops are marked with S.",
      "Stay as long as you like.",
      "The plaza is at the center.",
    ];
    let placed = 0;
    // two rings around the gate
    for (let ring = 1; ring <= 2 && placed < count; ring++) {
      for (const d of dirs) {
        const x = townExitAt.x + d.dx * ring;
        const y = townExitAt.y + d.dy * ring;
        if (isFreeTownFloor(x, y) && manhattan(player.x, player.y, x, y) > 1) {
          const name = names[randInt(0, names.length - 1)];
          npcs.push({ x, y, name, lines });
          placed++;
          if (placed >= count) break;
        }
      }
    }
    clearAdjacentNPCsAroundPlayer();
  }

  function enterTownIfOnTile() {
    if (mode !== "world" || !world) return false;
    const WT = window.World && World.TILES;
    const t = world.map[player.y][player.x];
    if (WT && t === World.TILES.TOWN) {
      worldReturnPos = { x: player.x, y: player.y };
      mode = "town";
      // Start town and ensure a valid spawn
      generateTown();
      ensureTownSpawnClear();
      townExitAt = { x: player.x, y: player.y };
      // Make entry calmer: reduce greeters to avoid surrounding the player
      spawnGateGreeters(0);

      // If entering at night, place NPCs at homes; allow a small number in tavern or at plaza
      (function setNightState() {
        try {
          const t = getClock();
          if (!t || t.phase !== "night") return;
          const occupied = new Set();
          const occKey = (x, y) => `${x},${y}`;
          const isInside = (b, x, y) => x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1;
          const isFreeInside = (b, x, y) => {
            if (!isInside(b, x, y)) return false;
            if (map[y][x] !== TILES.FLOOR && map[y][x] !== TILES.DOOR) return false;
            if (occupied.has(occKey(x, y))) return false;
            if (npcs.some(n => n.x === x && n.y === y)) return false;
            if (townProps.some(p => p.x === x && p.y === y && p.type !== "sign" && p.type !== "rug")) return false;
            return true;
          };
          const placeNear = (b, tx, ty) => {
            if (isFreeInside(b, tx, ty)) return { x: tx, y: ty };
            // search small radius inside building
            for (let r = 1; r <= 3; r++) {
              for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                  const nx = tx + dx, ny = ty + dy;
                  if (isFreeInside(b, nx, ny)) return { x: nx, y: ny };
                }
              }
            }
            // fallback to door
            const d = b.door || { x: Math.max(b.x + 1, Math.min(b.x + b.w - 2, tx)), y: Math.max(b.y + 1, Math.min(b.y + b.h - 2, ty)) };
            if (isFreeInside(b, d.x, d.y)) return { x: d.x, y: d.y };
            return null;
          };

          // Select a small set to remain at tavern/plaza
          const keepOutCount = Math.min(6, Math.max(2, Math.floor(npcs.length * 0.1)));
          const indices = npcs.map((_, i) => i);
          for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1)); const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
          }
          const keepOut = new Set(indices.slice(0, keepOutCount));

          for (let i = 0; i < npcs.length; i++) {
            const n = npcs[i];
            // Pets: keep behavior light, let some stay outside
            if (n.isPet) continue;

            // Some NPCs stay at inn/tavern or plaza
            if (keepOut.has(i)) {
              // Prefer inn/tavern door if present; else near plaza
              if (tavern && tavern.door && isFreeTownFloor(tavern.door.x, tavern.door.y)) {
                n.x = tavern.door.x; n.y = tavern.door.y;
                occupied.add(occKey(n.x, n.y));
                // Make sure they're visible at night entry for clarity
                if (visible[n.y] && typeof visible[n.y][n.x] !== "undefined") visible[n.y][n.x] = true;
                if (seen[n.y] && typeof seen[n.y][n.x] !== "undefined") seen[n.y][n.x] = true;
                continue;
              } else if (townPlaza) {
                const px = Math.max(1, Math.min(map[0].length - 2, townPlaza.x + randInt(-2, 2)));
                const py = Math.max(1, Math.min(map.length - 2, townPlaza.y + randInt(-2, 2)));
                if (isFreeTownFloor(px, py)) {
                  n.x = px; n.y = py;
                  occupied.add(occKey(n.x, n.y));
                  if (visible[py] && typeof visible[py][px] !== "undefined") visible[py][px] = true;
                  if (seen[py] && typeof seen[py][px] !== "undefined") seen[py][px] = true;
                  continue;
                }
              }
              // If couldn't place out, fall through to home
            }

            // Default: place at home inside building and set sleeping
            if (n._home && n._home.building) {
              const b = n._home.building;
              const target = n._home.bed ? { x: n._home.bed.x, y: n._home.bed.y } : { x: n._home.x, y: n._home.y };
              const spot = placeNear(b, target.x, target.y);
              if (spot) {
                n.x = spot.x; n.y = spot.y;
                n._sleeping = true;
                occupied.add(occKey(n.x, n.y));
                // Ensure these tiles are visible/seen so the user can confirm placement
                if (visible[n.y] && typeof visible[n.y][n.x] !== "undefined") visible[n.y][n.x] = true;
                if (seen[n.y] && typeof seen[n.y][n.x] !== "undefined") seen[n.y][n.x] = true;
                continue;
              }
            }
            // If no home/building info, leave as-is but ensure visibility if near the player
            if (visible[n.y] && typeof visible[n.y][n.x] !== "undefined") visible[n.y][n.x] = true;
            if (seen[n.y] && typeof seen[n.y][n.x] !== "undefined") seen[n.y][n.x] = true;
          }

          // Occasionally, 1–2 NPCs choose to sleep at the inn/tavern
          if (tavern && Array.isArray(tavern.beds) && tavern.beds.length) {
            const sleepers = rng() < 0.8 ? randInt(1, 2) : 1;
            const candidates = npcs.filter(n => !n.isPet && !n.isBarkeeper && !n._sleeping);
            // pick unique random indices
            for (let s = 0; s < sleepers && candidates.length; s++) {
              const idx = randInt(0, candidates.length - 1);
              const npc = candidates.splice(idx, 1)[0];
              // find a free bed
              let bedSpot = null;
              for (const bpos of tavern.beds) {
                const k = occKey(bpos.x, bpos.y);
                if (!occupied.has(k) && isFreeTownFloor(bpos.x, bpos.y)) { bedSpot = bpos; break; }
              }
              if (bedSpot) {
                npc.x = bedSpot.x; npc.y = bedSpot.y;
                npc._sleeping = true;
                occupied.add(occKey(npc.x, npc.y));
                if (visible[npc.y] && typeof visible[npc.y][npc.x] !== "undefined") visible[npc.y][npc.x] = true;
                if (seen[npc.y] && typeof seen[npc.y][npc.x] !== "undefined") seen[npc.y][npc.x] = true;
              }
            }
          }
        } catch (_) {}
      })();

      log(`You enter ${townName ? "the town of " + townName : "the town"}. Shops are marked with 'S'. Press G next to an NPC to talk. Press Enter on the gate to leave.`, "notice");
      if (window.UI && typeof UI.showTownExitButton === "function") UI.showTownExitButton();
      updateCamera();
      recomputeFOV();
      requestDraw();
      return true;
    }
    return false;
  }

  function enterDungeonIfOnEntrance() {
    if (mode !== "world" || !world) return false;
    const t = world.map[player.y][player.x];
    if (t && World.TILES && t === World.TILES.DUNGEON) {
      cameFromWorld = true;
      worldReturnPos = { x: player.x, y: player.y };

      // Look up dungeon info (level, size) from world POIs
      currentDungeon = null;
      try {
        if (Array.isArray(world.dungeons)) {
          currentDungeon = world.dungeons.find(d => d.x === player.x && d.y === player.y) || null;
        }
      } catch (_) { currentDungeon = null; }
      // Default fallback
      if (!currentDungeon) currentDungeon = { x: player.x, y: player.y, level: 1, size: "medium" };

      // If dungeon already has a saved state, load it and return
      if (loadDungeonStateFor(currentDungeon.x, currentDungeon.y)) {
        return true;
      }

      // Set dungeon difficulty = level; we keep 'floor' equal to dungeon level for UI/logic
      floor = Math.max(1, currentDungeon.level | 0);
      window.floor = floor;

      mode = "dungeon";
      generateLevel(floor);

      // Mark current dungeon start as exit point back to world; also ensure a visible "hole" (use STAIRS tile)
      dungeonExitAt = { x: player.x, y: player.y };
      if (inBounds(player.x, player.y)) {
        map[player.y][player.x] = TILES.STAIRS;
        if (Array.isArray(seen) && seen[player.y]) seen[player.y][player.x] = true;
        if (Array.isArray(visible) && visible[player.y]) visible[player.y][player.x] = true;
      }

      // Save fresh dungeon state
      saveCurrentDungeonState();

      log(`You enter the dungeon (Difficulty ${floor}${currentDungeon.size ? ", " + currentDungeon.size : ""}).`, "notice");
      return true;
    }
    return false;
  }

  function leaveTownNow() {
    mode = "world";
    map = world.map;
    npcs = [];
    shops = [];
    if (worldReturnPos) {
      player.x = worldReturnPos.x;
      player.y = worldReturnPos.y;
    }
    recomputeFOV();
    updateCamera();
    updateUI();
    log("You return to the overworld.", "notice");
    if (window.UI && typeof UI.hideTownExitButton === "function") UI.hideTownExitButton();
    requestDraw();
  }

  function requestLeaveTown() {
    if (window.UI && typeof UI.showConfirm === "function") {
      // Position near center
      const x = window.innerWidth / 2 - 140;
      const y = window.innerHeight / 2 - 60;
      UI.showConfirm("Do you want to leave the town?", { x, y }, () => leaveTownNow(), () => {});
    } else {
      if (window.confirm && window.confirm("Do you want to leave the town?")) {
        leaveTownNow();
      }
    }
  }

  function returnToWorldFromTown() {
    if (mode !== "town" || !world) return false;
    if (townExitAt && player.x === townExitAt.x && player.y === townExitAt.y) {
      requestLeaveTown();
      return true;
    }
    log("Return to the town gate to exit to the overworld.", "info");
    return false;
  }

  function returnToWorldIfAtExit() {
    if (window.DungeonState && typeof DungeonState.returnToWorldIfAtExit === "function") {
      return DungeonState.returnToWorldIfAtExit(getCtx());
    }
    if (mode !== "dungeon" || !cameFromWorld || !world) return false;
    if (floor !== 1) return false;
    if (dungeonExitAt && player.x === dungeonExitAt.x && player.y === dungeonExitAt.y) {
      // Save state before leaving so enemies/corpses/chests persist
      saveCurrentDungeonState();
      mode = "world";
      enemies = [];
      corpses = [];
      decals = [];
      map = world.map;
      if (worldReturnPos) {
        player.x = worldReturnPos.x;
        player.y = worldReturnPos.y;
      }
      recomputeFOV();
      updateCamera();
      updateUI();
      log("You return to the overworld.", "notice");
      requestDraw();
      return true;
    }
    log("Return to the dungeon entrance to go back to the overworld.", "info");
    return false;
  }

  // Context-sensitive action button (G): enter/exit/interact depending on mode/state
  function doAction() {
    hideLootPanel();
    // Prefer module
    if (window.Actions && typeof Actions.doAction === "function") {
      const ctxMod = getCtx();
      const handled = Actions.doAction(ctxMod);
      if (handled) {
        // Sync mutated ctx back into local state to ensure mode/map changes take effect
        mode = ctxMod.mode || mode;
        map = ctxMod.map || map;
        seen = ctxMod.seen || seen;
        visible = ctxMod.visible || visible;
        enemies = Array.isArray(ctxMod.enemies) ? ctxMod.enemies : enemies;
        corpses = Array.isArray(ctxMod.corpses) ? ctxMod.corpses : corpses;
        decals = Array.isArray(ctxMod.decals) ? ctxMod.decals : decals;
        worldReturnPos = ctxMod.worldReturnPos || worldReturnPos;
        townExitAt = ctxMod.townExitAt || townExitAt;
        dungeonExitAt = ctxMod.dungeonExitAt || dungeonExitAt;
        currentDungeon = ctxMod.dungeon || ctxMod.dungeonInfo || currentDungeon;
        if (typeof ctxMod.floor === "number") { floor = ctxMod.floor | 0; window.floor = floor; }
        updateCamera();
        recomputeFOV();
        updateUI();
        requestDraw();
        return;
      }
    }

    if (mode === "world") {
      if (!enterTownIfOnTile()) {
        enterDungeonIfOnEntrance();
      }
      return;
    }

    if (mode === "town") {
      if (returnToWorldFromTown()) return;
      lootCorpse();
      return;
    }

    if (mode === "dungeon") {
      lootCorpse();
      return;
    }

    lootCorpse();
  }

  function descendIfPossible() {
    if (window.Actions && typeof Actions.descend === "function") {
      const handled = Actions.descend(getCtx());
      if (handled) return;
    }
    if (mode === "world" || mode === "town") {
      doAction();
      return;
    }
    if (mode === "dungeon") {
      log("This dungeon has no deeper levels. Return to the entrance (the hole '>') and press G to leave.", "info");
      return;
    }
    const here = map[player.y][player.x];
    if (here === TILES.STAIRS) {
      log("There is nowhere to go down from here.", "info");
    } else {
      log("You need to stand on the staircase (brown tile marked with '>').", "info");
    }
  }

  function setupInput() {
    if (window.Input && typeof Input.init === "function") {
      Input.init({
        // state queries
        isDead: () => isDead,
        isInventoryOpen: () => !!(window.UI && UI.isInventoryOpen && UI.isInventoryOpen()),
        isLootOpen: () => !!(window.UI && UI.isLootOpen && UI.isLootOpen()),
        isGodOpen: () => !!(window.UI && UI.isGodOpen && UI.isGodOpen()),
        // actions
        onRestart: () => restartGame(),
        onShowInventory: () => showInventoryPanel(),
        onHideInventory: () => hideInventoryPanel(),
        onHideLoot: () => hideLootPanel(),
        onHideGod: () => { if (window.UI && UI.hideGod) UI.hideGod(); requestDraw(); },
        onShowGod: () => {
          if (window.UI) {
            if (typeof UI.setGodFov === "function") UI.setGodFov(fovRadius);
            if (typeof UI.showGod === "function") UI.showGod();
          }
          requestDraw();
        },
        onMove: (dx, dy) => tryMovePlayer(dx, dy),
        onWait: () => turn(),
        onLoot: () => doAction(),
        onDescend: () => descendIfPossible(),
        adjustFov: (delta) => adjustFov(delta),
      });
    }
  }

  
  // Visual: add or strengthen a blood decal at tile (x,y)
  function addBloodDecal(x, y, mult = 1.0) {
    // Prefer Decals module
    if (window.Decals && typeof Decals.add === "function") {
      Decals.add(getCtx(), x, y, mult);
      return;
    }
    if (!inBounds(x, y)) return;
    const d = decals.find(d => d.x === x && d.y === y);
    const baseA = 0.16 + rng() * 0.18;
    const baseR = Math.floor(TILE * (0.32 + rng() * 0.20));
    if (d) {
      d.a = Math.min(0.9, d.a + baseA * mult);
      d.r = Math.max(d.r, baseR);
    } else {
      decals.push({ x, y, a: Math.min(0.9, baseA * mult), r: baseR });
      if (decals.length > 240) decals.splice(0, decals.length - 240);
    }
  }

  function tryMovePlayer(dx, dy) {
    if (isDead) return;

    // WORLD MODE: move over overworld tiles (no NPCs here)
    if (mode === "world") {
      const nx = player.x + dx;
      const ny = player.y + dy;
      const wmap = world && world.map ? world.map : null;
      if (!wmap) return;
      const rows = wmap.length, cols = rows ? (wmap[0] ? wmap[0].length : 0) : 0;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
      if (window.World && typeof World.isWalkable === "function" && World.isWalkable(wmap[ny][nx])) {
        player.x = nx; player.y = ny;
        updateCamera();
        turn();
      }
      return;
    }

    // TOWN MODE: block NPC tiles, use local isWalkable
    if (mode === "town") {
      const nx = player.x + dx;
      const ny = player.y + dy;
      if (!inBounds(nx, ny)) return;
      const npcBlocked = (occupancy && typeof occupancy.hasNPC === "function") ? occupancy.hasNPC(nx, ny) : npcs.some(n => n.x === nx && n.y === ny);
      if (npcBlocked) {
        // Treat bumping into an NPC as a "hit"/interaction: they respond with a line
        const npc = npcs.find(n => n.x === nx && n.y === ny);
        if (npc) {
          const lines = Array.isArray(npc.lines) && npc.lines.length ? npc.lines : ["Hey!", "Watch it!", "Careful there."];
          const li = randInt(0, lines.length - 1);
          log(`${npc.name || "Villager"}: ${lines[li]}`, "info");
          requestDraw();
        } else {
          log("Excuse me!", "info");
        }
        return;
      }
      if (isWalkable(nx, ny)) {
        player.x = nx; player.y = ny;
        updateCamera();
        turn();
      }
      return;
    }

    // DUNGEON MODE:
    // Dazed: skip action if dazedTurns > 0
    if (player.dazedTurns && player.dazedTurns > 0) {
      player.dazedTurns -= 1;
      log("You are dazed and lose your action this turn.", "warn");
      turn();
      return;
    }
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!inBounds(nx, ny)) return;

    const enemy = enemies.find(e => e.x === nx && e.y === ny);
    if (enemy) {
      let loc = rollHitLocation();
      if (alwaysCrit && forcedCritPart) {
        const profiles = {
          torso: { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 },
          head:  { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 },
          hands: { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 },
          legs:  { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 },
        };
        if (profiles[forcedCritPart]) loc = profiles[forcedCritPart];
      }

      if (rng() < getEnemyBlockChance(enemy, loc)) {
        log(`${capitalize(enemy.type || "enemy")} blocks your attack to the ${loc.part}.`, "block");
        decayAttackHands(true);
        decayEquipped("hands", randFloat(0.2, 0.7, 1));
        turn();
        return;
      }

      let dmg = getPlayerAttack() * loc.mult;
      let isCrit = false;
      const critChance = Math.max(0, Math.min(0.6, 0.12 + loc.critBonus));
      if (alwaysCrit || rng() < critChance) {
        isCrit = true;
        dmg *= critMultiplier();
      }
      dmg = Math.max(0, round1(dmg));
      enemy.hp -= dmg;

      if (dmg > 0) {
        addBloodDecal(enemy.x, enemy.y, isCrit ? 1.6 : 1.0);
      }

      if (isCrit) {
        log(`Critical! You hit the ${enemy.type || "enemy"}'s ${loc.part} for ${dmg}.`, "crit");
      } else {
        log(`You hit the ${enemy.type || "enemy"}'s ${loc.part} for ${dmg}.`);
      }
      { const ctx = getCtx(); if (ctx.Flavor && typeof ctx.Flavor.logPlayerHit === "function") ctx.Flavor.logPlayerHit(ctx, { target: enemy, loc, crit: isCrit, dmg }); }
      if (isCrit && loc.part === "legs" && enemy.hp > 0) {
        if (window.Status && typeof Status.applyLimpToEnemy === "function") {
          Status.applyLimpToEnemy(getCtx(), enemy, 2);
        } else {
          enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, 2);
          log(`${capitalize(enemy.type || "enemy")} staggers; its legs are crippled and it can't move for 2 turns.`, "notice");
        }
      }
      if (isCrit && enemy.hp > 0 && window.Status && typeof Status.applyBleedToEnemy === "function") {
        Status.applyBleedToEnemy(getCtx(), enemy, 2);
      }

      if (enemy.hp <= 0) {
        killEnemy(enemy);
      }

      decayAttackHands();
      decayEquipped("hands", randFloat(0.3, 1.0, 1));
      turn();
      return;
    }

    // Prefer occupancy grid if available to avoid linear scans
    const blockedByEnemy = (occupancy && typeof occupancy.hasEnemy === "function") ? occupancy.hasEnemy(nx, ny) : enemies.some(e => e.x === nx && e.y === ny);
    if (isWalkable(nx, ny) && !blockedByEnemy) {
      player.x = nx;
      player.y = ny;
      updateCamera();
      turn();
    }
  }

  
  function generateLoot(source) {
    if (window.Loot && typeof Loot.generate === "function") {
      return Loot.generate(getCtx(), source);
    }
    return [];
  }

  
  function interactTownProps() {
    if (window.Town && typeof Town.interactProps === "function") {
      const handled = Town.interactProps(getCtx());
      if (handled) return true;
    }
    if (mode !== "town") return false;
    const candidates = [];
    const coords = [
      { x: player.x, y: player.y },
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ];
    for (const c of coords) {
      const p = townProps.find(p => p.x === c.x && p.y === c.y);
      if (p) candidates.push(p);
    }
    if (!candidates.length) return false;
    const p = candidates[0];
    switch (p.type) {
      case "well":
        log("You draw some cool water from the well. Refreshing.", "good");
        break;
      case "fountain":
        log("You watch the fountain for a moment. You feel calmer.", "info");
        break;
      case "bench": {
        const phase = getClock().phase;
        if (phase !== "day") {
          log("You relax on the bench and drift to sleep...", "info");
          restUntilMorning(0.25); // light heal to 25% of max
        } else {
          log("You sit on the bench and rest a moment.", "info");
        }
        break;
      }
      case "lamp":
        log("The lamp flickers warmly.", "info");
        break;
      case "stall":
        log("A vendor waves: 'Fresh wares soon!'", "notice");
        break;
      case "tree":
        log("A leafy tree offers a bit of shade.", "info");
        break;
      case "fireplace":
        log("You warm your hands by the fireplace.", "info");
        break;
      case "table":
        log("A sturdy wooden table. Nothing of note on it.", "info");
        break;
      case "chair":
        log("A simple wooden chair.", "info");
        break;
      case "bed":
        log("Looks comfy. Residents sleep here at night.", "info");
        break;
      case "chest":
        log("The chest is locked.", "warn");
        break;
      case "crate":
        log("A wooden crate. Might hold supplies.", "info");
        break;
      case "barrel":
        log("A barrel. Smells of ale.", "info");
        break;
      case "shelf":
        log("A shelf with assorted goods.", "info");
        break;
      case "plant":
        log("A potted plant adds some life.", "info");
        break;
      case "rug":
        log("A cozy rug warms the floor.", "info");
        break;
      case "sign": {
        const title = p.name || "Sign";
        // If this sign is next to a shop door, show its schedule
        const near = [
          { x: p.x, y: p.y },
          { x: p.x + 1, y: p.y },
          { x: p.x - 1, y: p.y },
          { x: p.x, y: p.y + 1 },
          { x: p.x, y: p.y - 1 },
        ];
        let shop = null;
        for (const c of near) {
          const s = shopAt(c.x, c.y);
          if (s) { shop = s; break; }
        }
        if (shop) {
          const openNow = isShopOpenNow(shop);
          const sched = shopScheduleStr(shop);
          log(`Sign: ${title}. ${sched} — ${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
        } else {
          log(`Sign: ${title}`, "info");
        }
        break;
      }
      default:
        log("There's nothing special here.");
    }
    requestDraw();
    return true;
  }

  function lootCorpse() {
    if (isDead) return;
    // Prefer module first
    if (window.Actions && typeof Actions.loot === "function") {
      const ctxMod = getCtx();
      const handled = Actions.loot(ctxMod);
      if (handled) {
        // Sync mutated ctx back into local state
        mode = ctxMod.mode || mode;
        map = ctxMod.map || map;
        seen = ctxMod.seen || seen;
        visible = ctxMod.visible || visible;
        enemies = Array.isArray(ctxMod.enemies) ? ctxMod.enemies : enemies;
        corpses = Array.isArray(ctxMod.corpses) ? ctxMod.corpses : corpses;
        decals = Array.isArray(ctxMod.decals) ? ctxMod.decals : decals;
        worldReturnPos = ctxMod.worldReturnPos || worldReturnPos;
        townExitAt = ctxMod.townExitAt || townExitAt;
        dungeonExitAt = ctxMod.dungeonExitAt || dungeonExitAt;
        currentDungeon = ctxMod.dungeon || ctxMod.dungeonInfo || currentDungeon;
        if (typeof ctxMod.floor === "number") { floor = ctxMod.floor | 0; window.floor = floor; }
        updateCamera();
        recomputeFOV();
        updateUI();
        requestDraw();
        return;
      }
    }

    if (mode === "town") {
      // Interact with shop if standing on a shop door
      const s = shopAt(player.x, player.y);
      if (s) {
        const openNow = isShopOpenNow(s);
        const schedule = shopScheduleStr(s);
        const sname = (s.name || "").toLowerCase();

        if (sname === "inn") {
          log(`Inn: ${schedule}. ${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
          // Inns provide resting; allow rest regardless to keep QoL
          log("You enter the inn.", "notice");
          restAtInn();
          return;
        }
        if (sname === "tavern") {
          log(`Tavern: ${schedule}. ${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
          const phase = getClock().phase;
          if (phase === "night" || phase === "dusk") {
            log("You step into the tavern. It's lively inside.", "notice");
          } else if (phase === "day") {
            log("You enter the tavern. A few patrons sit quietly.", "info");
          } else {
            log("You enter the tavern.", "info");
          }
          requestDraw();
          return;
        }

        if (openNow) {
          log(`The ${s.name || "shop"} is open. (Trading coming soon)`, "notice");
        } else {
          log(`The ${s.name || "shop"} is closed. ${schedule}`, "warn");
        }
        requestDraw();
        return;
      }
      // Interact with props first, then attempt to talk to an NPC
      if (interactTownProps()) return;
      if (talkNearbyNPC()) return;
      log("Nothing to do here.");
      return;
    }
    if (mode === "world") {
      log("Nothing to loot here.");
      return;
    }
    if (mode === "dungeon") {
      // Using G on the entrance hole returns to the overworld (module covers robust cases).
      // Keep fallback in case module absent.
      if (dungeonExitAt && player.x === dungeonExitAt.x && player.y === dungeonExitAt.y && world) {
        saveCurrentDungeonState();
        mode = "world";
        enemies = [];
        corpses = [];
        decals = [];
        map = world.map;
        // Restore exact overworld position:
        let rx = (worldReturnPos && typeof worldReturnPos.x === "number") ? worldReturnPos.x : null;
        let ry = (worldReturnPos && typeof worldReturnPos.y === "number") ? worldReturnPos.y : null;
        if (rx == null || ry == null) {
          const info = currentDungeon;
          if (info && typeof info.x === "number" && typeof info.y === "number") {
            rx = info.x; ry = info.y;
          }
        }
        if (rx == null || ry == null) {
          rx = Math.max(0, Math.min(world.map[0].length - 1, player.x));
          ry = Math.max(0, Math.min(world.map.length - 1, player.y));
        }
        player.x = rx; player.y = ry;

        recomputeFOV();
        updateCamera();
        updateUI();
        log("You climb back to the overworld.", "notice");
        requestDraw();
        return;
      }
    }
    if (window.Loot && typeof Loot.lootHere === "function") {
      Loot.lootHere(getCtx());
      return;
    }
  }

  function showLootPanel(list) {
    if (window.UI && typeof UI.showLoot === "function") {
      UI.showLoot(list);
      requestDraw();
    }
  }

  function hideLootPanel() {
    if (window.UI && typeof UI.hideLoot === "function") {
      UI.hideLoot();
      requestDraw();
      return;
    }
    const panel = document.getElementById("loot-panel");
    if (!panel) return;
    panel.hidden = true;
    requestDraw();
  }

  // GOD mode actions
  function godHeal() {
    if (window.God && typeof God.heal === "function") { God.heal(getCtx()); return; }
    const prev = player.hp;
    player.hp = player.maxHp;
    if (player.hp > prev) {
      log(`GOD: You are fully healed (${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)} HP).`, "good");
    } else {
      log(`GOD: HP already full (${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "warn");
    }
    updateUI();
    requestDraw();
  }

  function godSpawnStairsHere() {
    if (window.God && typeof God.spawnStairsHere === "function") { God.spawnStairsHere(getCtx()); return; }
    if (!inBounds(player.x, player.y)) {
      log("GOD: Cannot place stairs out of bounds.", "warn");
      return;
    }
    map[player.y][player.x] = TILES.STAIRS;
    seen[player.y][player.x] = true;
    visible[player.y][player.x] = true;
    log("GOD: Stairs appear beneath your feet.", "notice");
    requestDraw();
  }

  function godSpawnItems(count = 3) {
    if (window.God && typeof God.spawnItems === "function") { God.spawnItems(getCtx(), count); return; }
    const created = [];
    for (let i = 0; i < count; i++) {
      let it = null;
      if (window.Items && typeof Items.createEquipment === "function") {
        const tier = Math.min(3, Math.max(1, Math.floor((floor + 1) / 2)));
        it = Items.createEquipment(tier, rng);
      } else if (window.DungeonItems && DungeonItems.lootFactories && typeof DungeonItems.lootFactories === "object") {
        const keys = Object.keys(DungeonItems.lootFactories);
        if (keys.length > 0) {
          const k = keys[randInt(0, keys.length - 1)];
          try { it = DungeonItems.lootFactories[k](getCtx(), { tier: 2 }); } catch (_) {}
        }
      }
      if (!it) {
        if (rng() < 0.5) it = { kind: "equip", slot: "hand", name: "debug sword", atk: 1.5, tier: 2, decay: initialDecay(2) };
        else it = { kind: "equip", slot: "torso", name: "debug armor", def: 1.0, tier: 2, decay: initialDecay(2) };
      }
      player.inventory.push(it);
      created.push(describeItem(it));
    }
    if (created.length) {
      log(`GOD: Spawned ${created.length} item${created.length > 1 ? "s" : ""}:`);
      created.forEach(n => log(`- ${n}`));
      updateUI();
      renderInventoryPanel();
      requestDraw();
    }
  }

  /**
   * Spawn one or more enemies near the player (debug/GOD).
   * - Chooses a free FLOOR tile within a small radius; falls back to any free floor tile.
   * - Creates enemy via ctx.enemyFactory or Enemies.createEnemyAt.
   * - Applies small randomized jitters to hp/atk for variety (deterministic via rng).
   */
  function godSpawnEnemyNearby(count = 1) {
    if (window.God && typeof God.spawnEnemyNearby === "function") { God.spawnEnemyNearby(getCtx(), count); return; }
    const isFreeFloor = (x, y) => {
      if (!inBounds(x, y)) return false;
      if (map[y][x] !== TILES.FLOOR) return false;
      if (player.x === x && player.y === y) return false;
      if (enemies.some(e => e.x === x && e.y === y)) return false;
      return true;
    };

    const pickNearby = () => {
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        const dx = randInt(-5, 5);
        const dy = randInt(-5, 5);
        const x = player.x + dx;
        const y = player.y + dy;
        if (isFreeFloor(x, y)) return { x, y };
      }
      const free = [];
      for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < (map[0] ? map[0].length : 0); x++) {
          if (isFreeFloor(x, y)) free.push({ x, y });
        }
      }
      if (free.length === 0) return null;
      return free[randInt(0, free.length - 1)];
    };

    const ctx = getCtx();
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const spot = pickNearby();
      if (!spot) break;
      const makeEnemy = (ctx.enemyFactory || ((x, y, depth) => createEnemyAt(x, y, depth)));
      const e = makeEnemy(spot.x, spot.y, floor);

      if (typeof e.hp === "number" && rng() < 0.7) {
        const mult = 0.85 + rng() * 0.5;
        e.hp = Math.max(1, Math.round(e.hp * mult));
      }
      if (typeof e.atk === "number" && rng() < 0.7) {
        const multA = 0.85 + rng() * 0.5;
        e.atk = Math.max(0.1, round1(e.atk * multA));
      }
      e.announced = false;
      enemies.push(e);
      spawned.push(e);
      log(`GOD: Spawned ${capitalize(e.type || "enemy")} Lv ${e.level || 1} at (${e.x},${e.y}).`, "notice");
    }
    if (spawned.length > 0) {
      requestDraw();
    } else {
      log("GOD: No free space to spawn an enemy nearby.", "warn");
    }
  }

  
  function renderInventoryPanel() {
    if (window.UI && typeof UI.renderInventory === "function") {
      // Keep totals in sync
      updateUI();
      UI.renderInventory(player, describeItem);
    }
  }

  function showInventoryPanel() {
    renderInventoryPanel();
    if (window.UI && typeof UI.showInventory === "function") {
      UI.showInventory();
    } else {
      const panel = document.getElementById("inv-panel");
      if (panel) panel.hidden = false;
    }
    requestDraw();
  }

  function hideInventoryPanel() {
    if (window.UI && typeof UI.hideInventory === "function") {
      UI.hideInventory();
      requestDraw();
      return;
    }
    const panel = document.getElementById("inv-panel");
    if (!panel) return;
    panel.hidden = true;
    requestDraw();
  }

  function equipItemByIndex(idx) {
    if (window.Player && typeof Player.equipItemByIndex === "function") {
      Player.equipItemByIndex(player, idx, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
        describeItem: (it) => describeItem(it),
      });
      return;
    }
    if (!player.inventory || idx < 0 || idx >= player.inventory.length) return;
    const item = player.inventory[idx];
    if (!item || item.kind !== "equip") {
      log("That item cannot be equipped.");
      return;
    }
    const slot = item.slot || "hand";
    const prev = player.equipment[slot];
    player.inventory.splice(idx, 1);
    player.equipment[slot] = item;
    const statStr = ("atk" in item) ? `+${item.atk} atk` : ("def" in item) ? `+${item.def} def` : "";
    log(`You equip ${item.name} (${slot}${statStr ? ", " + statStr : ""}).`);
    if (prev) {
      player.inventory.push(prev);
      log(`You stow ${describeItem(prev)} into your inventory.`);
    }
    updateUI();
    renderInventoryPanel();
  }

  function equipItemByIndexHand(idx, hand) {
    if (window.Player && typeof Player.equipItemByIndex === "function") {
      Player.equipItemByIndex(player, idx, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
        describeItem: (it) => describeItem(it),
        preferredHand: hand,
      });
      return;
    }
    // fallback to generic equip if Player module missing
    equipItemByIndex(idx);
  }

  function unequipSlot(slot) {
    if (window.Player && typeof Player.unequipSlot === "function") {
      Player.unequipSlot(player, slot, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
      });
      return;
    }
    // fallback
    const eq = player.equipment || {};
    const valid = ["left","right","head","torso","legs","hands"];
    if (!valid.includes(slot)) return;
    if ((slot === "left" || slot === "right") && eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded) {
      const item = eq.left;
      eq.left = null; eq.right = null;
      player.inventory.push(item);
      log(`You unequip ${describeItem(item)} (two-handed).`);
      updateUI(); renderInventoryPanel();
      return;
    }
    const it = eq[slot];
    if (!it) return;
    eq[slot] = null;
    player.inventory.push(it);
    log(`You unequip ${describeItem(it)} from ${slot}.`);
    updateUI(); renderInventoryPanel();
  }

  

  function showGameOver() {
    if (window.UI && typeof UI.showGameOver === "function") {
      UI.showGameOver(player, floor);
      requestDraw();
      return;
    }
    const panel = document.getElementById("gameover-panel");
    const summary = document.getElementById("gameover-summary");
    const gold = (player.inventory.find(i => i.kind === "gold")?.amount) || 0;
    if (summary) {
      summary.textContent = `You died on floor ${floor} (Lv ${player.level}). Gold: ${gold}. XP: ${player.xp}/${player.xpNext}.`;
    }
    if (panel) panel.hidden = false;
    requestDraw();
  }

  // GOD: always-crit toggle
  function setAlwaysCrit(v) {
    if (window.God && typeof God.setAlwaysCrit === "function") { God.setAlwaysCrit(getCtx(), v); return; }
    alwaysCrit = !!v;
    try { window.ALWAYS_CRIT = alwaysCrit; localStorage.setItem("ALWAYS_CRIT", alwaysCrit ? "1" : "0"); } catch (_) {}
    log(`GOD: Always Crit ${alwaysCrit ? "enabled" : "disabled"}.`, alwaysCrit ? "good" : "warn");
  }

  // GOD: set forced crit body part for player attacks
  function setCritPart(part) {
    if (window.God && typeof God.setCritPart === "function") { God.setCritPart(getCtx(), part); return; }
    const valid = new Set(["torso","head","hands","legs",""]);
    const p = valid.has(part) ? part : "";
    forcedCritPart = p;
    try {
      window.ALWAYS_CRIT_PART = p;
      if (p) localStorage.setItem("ALWAYS_CRIT_PART", p);
      else localStorage.removeItem("ALWAYS_CRIT_PART");
    } catch (_) {}
    if (p) log(`GOD: Forcing crit hit location: ${p}.`, "notice");
    else log("GOD: Cleared forced crit hit location.", "notice");
  }

  // GOD: apply a deterministic RNG seed and regenerate current map
  function applySeed(seedUint32) {
    if (window.God && typeof God.applySeed === "function") { God.applySeed(getCtx(), seedUint32); return; }
    const s = (Number(seedUint32) >>> 0);
    currentSeed = s;
    try { localStorage.setItem("SEED", String(s)); } catch (_) {}
    if (typeof window !== "undefined" && window.RNG && typeof RNG.applySeed === "function") {
      RNG.applySeed(s);
      rng = RNG.rng;
    } else {
      function mulberry32(a) {
        return function() {
          let t = a += 0x6D2B79F5;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const _rng = mulberry32(s);
      rng = function () { return _rng(); };
    }
    if (mode === "world") {
      log(`GOD: Applied seed ${s}. Regenerating overworld...`, "notice");
      initWorld();
    } else {
      log(`GOD: Applied seed ${s}. Regenerating floor ${floor}...`, "notice");
      generateLevel(floor);
    }
    requestDraw();
    try {
      const el = document.getElementById("god-seed-help");
      if (el) el.textContent = `Current seed: ${s}`;
      const input = document.getElementById("god-seed-input");
      if (input) input.value = String(s);
    } catch (_) {}
  }

  // GOD: reroll seed using current time
  function rerollSeed() {
    if (window.God && typeof God.rerollSeed === "function") { God.rerollSeed(getCtx()); return; }
    const s = (Date.now() % 0xffffffff) >>> 0;
    applySeed(s);
  }

  function hideGameOver() {
    if (window.UI && typeof UI.hideGameOver === "function") {
      UI.hideGameOver();
      return;
    }
    const panel = document.getElementById("gameover-panel");
    if (panel) panel.hidden = true;
  }

  function restartGame() {
    hideGameOver();
    floor = 1;
    window.floor = floor;
    isDead = false;
    // Clear transient status effects on restart
    try {
      if (player) { player.bleedTurns = 0; player.dazedTurns = 0; }
    } catch (_) {}
    mode = "world";
    initWorld();
  }

  
  function gainXP(amount) {
    if (window.Player && typeof Player.gainXP === "function") {
      Player.gainXP(player, amount, { log, updateUI });
      return;
    }
    player.xp += amount;
    log(`You gain ${amount} XP.`);
    while (player.xp >= player.xpNext) {
      player.xp -= player.xpNext;
      player.level += 1;
      player.maxHp += 2;
      player.hp = player.maxHp;
      if (player.level % 2 === 0) player.atk += 1;
      player.xpNext = Math.floor(player.xpNext * 1.3 + 10);
      log(`You are now level ${player.level}. Max HP increased.`, "good");
    }
    updateUI();
  }

  function killEnemy(enemy) {
    const name = capitalize(enemy.type || "enemy");
    log(`${name} dies.`, "bad");
    const loot = generateLoot(enemy);
    corpses.push({ x: enemy.x, y: enemy.y, loot, looted: loot.length === 0 });
    gainXP(enemy.xp || 5);
    enemies = enemies.filter(e => e !== enemy);
    // Persist dungeon state immediately so corpses remain on revisit
    try {
      if (window.DungeonState && typeof DungeonState.save === "function") {
        DungeonState.save(getCtx());
      }
    } catch (_) {}
  }

  
  function updateUI() {
    if (window.UI && typeof UI.updateStats === "function") {
      UI.updateStats(player, floor, getPlayerAttack, getPlayerDefense, getClock());
      return;
    }
    // Fallback if UI module not loaded
    const hpEl = document.getElementById("health");
    const floorEl = document.getElementById("floor");
    const gold = (player.inventory.find(i => i.kind === "gold")?.amount) || 0;
    if (hpEl) hpEl.textContent = `HP: ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}  Gold: ${gold}`;
    const t = getClock();
    if (floorEl) floorEl.textContent = `Floor: ${floor}  Lv: ${player.level}  XP: ${player.xp}/${player.xpNext}  Time: ${t.hhmm} (${t.phase})`;
  }

  
  function enemiesAct() {
    if (window.AI && typeof AI.enemiesAct === "function") {
      AI.enemiesAct(getCtx());
    }
    // No fallback here: AI behavior is defined in ai.js
  }

  function townNPCsAct() {
    if (mode !== "town") return;
    if (window.TownAI && typeof TownAI.townNPCsAct === "function") {
      TownAI.townNPCsAct(getCtx());
    }
  }
  
  function occupied(x, y) {
    if (player.x === x && player.y === y) return true;
    return enemies.some(e => e.x === x && e.y === y);
  }

  
  function turn() {
    if (isDead) return;

    // Advance global time (centralized via TimeService)
    turnCounter = TS.tick(turnCounter);

    

    if (mode === "dungeon") {
      enemiesAct();
      rebuildOccupancy();
      // Status effects tick (bleed, dazed, etc.)
      try {
        if (window.Status && typeof Status.tick === "function") {
          Status.tick(getCtx());
        }
      } catch (_) {}
      // Visual: decals fade each turn
      if (window.Decals && typeof Decals.tick === "function") {
        Decals.tick(getCtx());
      } else if (decals && decals.length) {
        for (let i = 0; i < decals.length; i++) {
          decals[i].a *= 0.92;
        }
        decals = decals.filter(d => d.a > 0.04);
      }
      // clamp corpse list length
      if (corpses.length > 50) corpses = corpses.slice(-50);

      // Persist dungeon state after each dungeon turn
      saveCurrentDungeonState();
    } else if (mode === "town") {
      townTick = (townTick + 1) | 0;
      townNPCsAct();
      rebuildOccupancy();
    }

    recomputeFOV();
    updateUI();
    requestDraw();
  }

  // Main animation loop
  function loop() {
    draw();
    requestAnimationFrame(loop);
  }

  
  if (window.UI && typeof UI.init === "function") {
      UI.init();
      if (typeof UI.setHandlers === "function") {
        UI.setHandlers({
          onEquip: (idx) => equipItemByIndex(idx),
          onEquipHand: (idx, hand) => equipItemByIndexHand(idx, hand),
          onUnequip: (slot) => unequipSlot(slot),
          onDrink: (idx) => drinkPotionByIndex(idx),
          onRestart: () => restartGame(),
          onWait: () => turn(),
          onGodHeal: () => godHeal(),
          onGodSpawn: () => godSpawnItems(),
          onGodSetFov: (v) => setFovRadius(v),
          onGodSpawnEnemy: () => godSpawnEnemyNearby(),
          onGodSpawnStairs: () => godSpawnStairsHere(),
          onGodSetAlwaysCrit: (v) => setAlwaysCrit(v),
          onGodSetCritPart: (part) => setCritPart(part),
          onGodApplySeed: (seed) => applySeed(seed),
          onGodRerollSeed: () => rerollSeed(),
          onTownExit: () => requestLeaveTown(),
          onGodCheckHomes: () => {
            const ctx = getCtx();
            if (ctx.mode !== "town") {
              log("Home route check is available in town mode only.", "warn");
              requestDraw();
              return;
            }
            if (window.TownAI && typeof TownAI.checkHomeRoutes === "function") {
              const res = TownAI.checkHomeRoutes(ctx) || {};
              const totalChecked = (typeof res.total === "number")
                ? res.total
                : ((res.reachable || 0) + (res.unreachable || 0));
              const skippedStr = res.skipped ? `, ${res.skipped} skipped` : "";
              const summaryLine = `Home route check: ${(res.reachable || 0)}/${totalChecked} reachable, ${(res.unreachable || 0)} unreachable${skippedStr}.`;
              log(summaryLine, (res.unreachable || 0) ? "warn" : "good");
              let extraLines = [];
              if (res.residents && typeof res.residents.total === "number") {
                const r = res.residents;
                extraLines.push(`Residents: ${r.atHome}/${r.total} at home, ${r.atInn}/${r.total} at inn.`);
              }
              // Per-resident list of late-night away residents
              if (Array.isArray(res.residentsAwayLate) && res.residentsAwayLate.length) {
                extraLines.push(`Late-night (02:00–05:00): ${res.residentsAwayLate.length} resident(s) away from home and inn:`);
                res.residentsAwayLate.slice(0, 10).forEach(d => {
                  extraLines.push(`- ${d.name} at (${d.x},${d.y})`);
                });
                if (res.residentsAwayLate.length > 10) {
                  extraLines.push(`...and ${res.residentsAwayLate - 10} more.`);
                }
              }
              if (res.skipped) {
                extraLines.push(`Skipped ${res.skipped} NPCs not expected to have homes (e.g., pets).`);
              }
              if (res.unreachable && Array.isArray(res.details)) {
                res.details.slice(0, 8).forEach(d => {
                  extraLines.push(`- ${d.name}: ${d.reason}`);
                });
                if (res.details.length > 8) extraLines.push(`...and ${res.details.length - 8} more.`);
              }
              // Mirror summary inside GOD panel output area for visibility while modal is open
              try {
                const el = document.getElementById("god-check-output");
                if (el) {
                  const html = [summaryLine].concat(extraLines).map(s => `<div>${s}</div>`).join("");
                  el.innerHTML = html;
                }
              } catch (_) {}
              // Also write all extra lines to the main log
              extraLines.forEach(line => log(line, "info"));
              // Request draw to show updated debug paths (if enabled)
              requestDraw();
            } else {
              log("TownAI.checkHomeRoutes not available.", "warn");
            }
          },
          onGodCheckInnTavern: () => {
            const ctx = getCtx();
            if (ctx.mode !== "town") {
              log("Inn check is available in town mode only.", "warn");
              requestDraw();
              return;
            }
            const list = Array.isArray(shops) ? shops : [];
            const inns = list.filter(s => (s.name || "").toLowerCase().includes("inn"));
            const line = `Inn: ${inns.length} inn(s).`;
            log(line, inns.length ? "info" : "warn");
            const lines = [];
            inns.slice(0, 6).forEach((s, i) => {
              lines.push(`- Inn ${i + 1} at door (${s.x},${s.y})`);
            });
            try {
              const el = document.getElementById("god-check-output");
              if (el) {
                const html = [line].concat(lines).map(s => `<div>${s}</div>`).join("");
                el.innerHTML = html;
              }
            } catch (_) {}
            lines.forEach(l => log(l, "info"));
            requestDraw();
          },
        });
      }
    }

  // Hand decay helpers
  function usingTwoHanded() {
    const eq = player.equipment || {};
    return eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded;
  }

  function decayAttackHands(light = false) {
    const eq = player.equipment || {};
    const amtMain = light ? randFloat(0.6, 1.6, 1) : randFloat(1.0, 2.2, 1);
    if (usingTwoHanded()) {
      // Two-handed: same item is referenced in both hands; applying to both intentionally doubles wear.
      // If we ever want to apply once per swing, change to a single decayEquipped on one hand.
      if (eq.left) decayEquipped("left", amtMain);
      if (eq.right) decayEquipped("right", amtMain);
      return;
    }
    // prefer decaying a hand with attack stat
    const leftAtk = (eq.left && typeof eq.left.atk === "number") ? eq.left.atk : 0;
    const rightAtk = (eq.right && typeof eq.right.atk === "number") ? eq.right.atk : 0;
    if (leftAtk >= rightAtk && leftAtk > 0) {
      decayEquipped("left", amtMain);
    } else if (rightAtk > 0) {
      decayEquipped("right", amtMain);
    } else if (eq.left) {
      decayEquipped("left", amtMain);
    } else if (eq.right) {
      decayEquipped("right", amtMain);
    }
  }

  function decayBlockingHands() {
    const eq = player.equipment || {};
    const amt = randFloat(0.6, 1.6, 1);
    if (usingTwoHanded()) {
      // Two-handed: same object on both hands; decaying both sides doubles the wear when blocking.
      if (eq.left) decayEquipped("left", amt);
      if (eq.right) decayEquipped("right", amt);
      return;
    }
    const leftDef = (eq.left && typeof eq.left.def === "number") ? eq.left.def : 0;
    const rightDef = (eq.right && typeof eq.right.def === "number") ? eq.right.def : 0;
    if (rightDef >= leftDef && eq.right) {
      decayEquipped("right", amt);
    } else if (eq.left) {
      decayEquipped("left", amt);
    }
  }

  
  initWorld();
  setupInput();
  loop();
})();