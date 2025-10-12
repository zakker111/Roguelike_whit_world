/**
 * Game
 * Main loop, world/town/dungeon state, combat orchestration, FOV/render, and module glue.
 *
 * What this file does
 * - Holds player/map/enemies state and advances turns.
 * - Routes input to movement and context actions (enter town/dungeon, loot, exit).
 * - Bridges modules via a normalized ctx (Ctx.create) so features can evolve independently.
 * - Provides deterministic RNG (via RNG service; falls back to mulberry32 when unavailable).
 * - Keeps FOV and camera view up-to-date and requests draws efficiently.
 * - Persists dungeon state per entrance so revisiting restores corpses/loot/visibility.
 *
 * How to read this file
 * - Modes and state: top-level variables track whether we are in world/town/dungeon and related anchors.
 * - RNG and determinism: centralized seed/init; helpers (randInt, randFloat, chance) prefer RNG service.
 * - FOV and camera: cache invalidation avoids unnecessary recomputes; camera centers on player.
 * - UI orchestration: updateStats/log/loot/inventory are routed through UI when present, with safe fallbacks.
 * - Dungeon persistence: save/load by world entrance key ("x,y"); modules can override via DungeonState.
 * - Town helpers: basic interactions (talk, shop), occupancy grid rebuild cadence, and bench/rest flows.
 * - Combat helpers: block chance, damage, crits, hit location, decay of equipment.
 * - Turn loop: ticks time, drives NPC/AI, applies status effects, and schedules a render.
 *
 * Notes on module handles
 * - Most features prefer ctx.* handles (Ctx.create(base)) to avoid window.* tight coupling.
 * - When a module is missing, minimal fallbacks keep the game playable (e.g., flat-floor dungeon).
 *
 * Determinism
 * - RNG is seeded via the GOD panel or auto-init; seed is persisted to localStorage ("SEED").
 * - Diagnostics in GOD and boot logs show current RNG source and seed for reproducibility.
 */
(() => {
  try {
    if (window.DEV) {
      console.log("[BOOT] game.js loaded. Modules present:", {
        DungeonState: !!(window.DungeonState),
        Logger: !!(window.Logger),
        UI: !!(window.UI),
        Dungeon: !!(window.Dungeon),
        Enemies: !!(window.Enemies),
      });
    }
  } catch (_) {}
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
        // Shared centralized fallback (deterministic) if RNG service not available
        try {
          if (typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function") {
            return RNGFallback.getRng(currentSeed);
          }
        } catch (_) {}
        // Ultimate fallback: non-deterministic
        return Math.random;
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
      worldReturnPos,
      cameFromWorld,
      npcs,
      shops,
      townProps,
      townBuildings,
      townPlaza,
      tavern,
      dungeonExitAt,
      // camera
      camera,
      getCamera: () => camera,
      // dungeon info
      dungeon: currentDungeon,
      dungeonInfo: currentDungeon,
      // persistence (in-memory)
      _dungeonStates: dungeonStates,
      time: getClock(),
      requestDraw,
      log,
      isWalkable, inBounds,
      // Prefer modules to use ctx.utils.*; keep these for backward use and fallbacks.
      round1, randInt, chance, randFloat,
      enemyColor, describeItem,
      setFovRadius,
      // expose recompute/update for modules like DungeonState
      recomputeFOV: () => recomputeFOV(),
      updateCamera: () => updateCamera(),
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

  // Prefer ctx module handles over window.* where possible
  function modHandle(name) {
    try {
      const c = getCtx();
      if (c && c[name]) return c[name];
    } catch (_) {}
    if (typeof window !== "undefined" && window[name]) return window[name];
    return null;
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
    const EM = modHandle("Enemies");
    if (EM && typeof EM.colorFor === "function") {
      return EM.colorFor(type);
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
    const IH = modHandle("Items");
    if (IH && typeof IH.initialDecay === "function") {
      return IH.initialDecay(tier);
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
    // Phase 1: centralize via Stats (which prefers Player under the hood)
    const S = modHandle("Stats");
    if (S && typeof S.getPlayerAttack === "function") {
      return S.getPlayerAttack(getCtx());
    }
    // Fallback: prefer Player module if Stats unavailable
    const P = modHandle("Player");
    if (P && typeof P.getAttack === "function") {
      return P.getAttack(player);
    }
    // Last-resort minimal fallback
    let bonus = 0;
    const eq = player.equipment || {};
    if (eq.left && typeof eq.left.atk === "number") bonus += eq.left.atk;
    if (eq.right && typeof eq.right.atk === "number") bonus += eq.right.atk;
    if (eq.hands && typeof eq.hands.atk === "number") bonus += eq.hands.atk;
    const levelBonus = Math.floor((player.level - 1) / 2);
    return round1(player.atk + bonus + levelBonus);
  }

  
  function getPlayerDefense() {
    // Phase 1: centralize via Stats (which prefers Player under the hood)
    const S = modHandle("Stats");
    if (S && typeof S.getPlayerDefense === "function") {
      return S.getPlayerDefense(getCtx());
    }
    // Fallback: prefer Player module if Stats unavailable
    const P = modHandle("Player");
    if (P && typeof P.getDefense === "function") {
      return P.getDefense(player);
    }
    // Last-resort minimal fallback
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
    const P = modHandle("Player");
    if (P && typeof P.describeItem === "function") {
      return P.describeItem(item);
    }
    const IH = modHandle("Items");
    if (IH && typeof IH.describe === "function") {
      return IH.describe(item);
    }
    // Minimal fallback
    if (!item) return "";
    return item.name || "item";
  }

  
  function rollHitLocation() {
    const C = modHandle("Combat");
    if (C && typeof C.rollHitLocation === "function") {
      return C.rollHitLocation(rng);
    }
    const r = rng();
    if (r < 0.50) return { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 };
    if (r < 0.65) return { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 };
    if (r < 0.80) return { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 };
    return { part: "legs", mult: 0.95, blockMod: 0.75, critBonus: -0.03 };
  }

  function critMultiplier() {
    const C = modHandle("Combat");
    if (C && typeof C.critMultiplier === "function") {
      return C.critMultiplier(rng);
    }
    return 1.6 + rng() * 0.4;
  }

  function getEnemyBlockChance(enemy, loc) {
    // Phase 1: centralize combat math in Combat; fall back to Enemies for compatibility
    const C = modHandle("Combat");
    if (C && typeof C.getEnemyBlockChance === "function") {
      return C.getEnemyBlockChance(getCtx(), enemy, loc);
    }
    const EM = modHandle("Enemies");
    if (EM && typeof EM.enemyBlockChance === "function") {
      return EM.enemyBlockChance(enemy, loc);
    }
    const base = enemy.type === "ogre" ? 0.10 : enemy.type === "troll" ? 0.08 : 0.06;
    return Math.max(0, Math.min(0.35, base * (loc?.blockMod || 1.0)));
  }

  function getPlayerBlockChance(loc) {
    const C = modHandle("Combat");
    if (C && typeof C.getPlayerBlockChance === "function") {
      return C.getPlayerBlockChance(getCtx(), loc);
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
    const C = modHandle("Combat");
    if (C && typeof C.enemyDamageAfterDefense === "function") {
      return C.enemyDamageAfterDefense(getCtx(), raw);
    }
    const def = getPlayerDefense();
    const DR = Math.max(0, Math.min(0.85, def / (def + 6)));
    const reduced = raw * (1 - DR);
    return Math.max(0.1, round1(reduced));
  }

  
  function enemyLevelFor(type, depth) {
    const EM = modHandle("Enemies");
    if (EM && typeof EM.levelFor === "function") {
      return EM.levelFor(type, depth, rng);
    }
    const tier = type === "ogre" ? 2 : (type === "troll" ? 1 : 0);
    const jitter = rng() < 0.35 ? 1 : 0;
    return Math.max(1, depth + tier + jitter);
  }

  function enemyDamageMultiplier(level) {
    // Phase 1: centralize in Combat; fall back to Enemies.* for compatibility
    const C = modHandle("Combat");
    if (C && typeof C.enemyDamageMultiplier === "function") {
      return C.enemyDamageMultiplier(level);
    }
    const EM = modHandle("Enemies");
    if (EM && typeof EM.damageMultiplier === "function") {
      return EM.damageMultiplier(level);
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
      // Force recompute by invalidating cache
      _lastFovRadius = -1;
      recomputeFOV();
      requestDraw();
    }
  }
  function adjustFov(delta) {
    setFovRadius(fovRadius + delta);
  }

  
  function addPotionToInventory(heal = 3, name = `potion (+${heal} HP)`) {
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.addPotion === "function") {
      return IC.addPotion(getCtx(), heal, name);
    }
    const P = modHandle("Player");
    if (P && typeof P.addPotion === "function") {
      P.addPotion(player, heal, name);
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
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.drinkByIndex === "function") {
      return IC.drinkByIndex(getCtx(), idx);
    }
    const P = modHandle("Player");
    if (P && typeof P.drinkPotionByIndex === "function") {
      P.drinkPotionByIndex(player, idx, {
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
    // Phase 1: delegate to Player/PlayerEquip to avoid duplicate logic
    if (window.Player && typeof Player.equipIfBetter === "function") {
      return Player.equipIfBetter(player, item, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
        describeItem: (it) => describeItem(it),
      });
    }
    log("Equip system not available.", "warn");
    return false;
  }

  
  function log(msg, type = "info") {
    // Mirror logs to console only in DEV for noise control
    try { if (window.DEV) console.debug(`[${type}] ${msg}`); } catch (_) {}
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
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.generate === "function") {
      const ctx = getCtx();
      ctx.startRoomRect = startRoomRect;
      DR.generate(ctx, depth);
      // Sync back references mutated by the module
      syncFromCtx(ctx);
      startRoomRect = ctx.startRoomRect || startRoomRect;
      return;
    }
    // Fallback: keep previous inline behavior
    const D = modHandle("Dungeon");
    if (D && typeof D.generateLevel === "function") {
      const ctx = getCtx();
      ctx.startRoomRect = startRoomRect;
      D.generateLevel(ctx, depth);
      map = ctx.map;
      seen = ctx.seen;
      visible = ctx.visible;
      enemies = ctx.enemies;
      corpses = ctx.corpses;
      startRoomRect = ctx.startRoomRect;
      decals = [];
      _lastMapCols = -1; _lastMapRows = -1; _lastMode = ""; _lastPlayerX = -1; _lastPlayerY = -1;
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
      if (typeof window !== "undefined" && window.OccupancyGrid && typeof OccupancyGrid.build === "function") {
        rebuildOccupancy();
      }
      if (window.DEV) {
        try {
          const visCount = enemies.filter(e => inBounds(e.x, e.y) && visible[e.y][e.x]).length;
          log(`[DEV] Enemies spawned: ${enemies.length}, visible now: ${visCount}.`, "notice");
        } catch (_) {}
      }
      updateUI();
      log("You explore the dungeon.");
      saveCurrentDungeonState(true);
      requestDraw();
      return;
    }
    // Fallback: flat-floor map
    map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILES.FLOOR));
    const sy = Math.max(1, MAP_ROWS - 2), sx = Math.max(1, MAP_COLS - 2);
    if (map[sy] && typeof map[sy][sx] !== "undefined") {
      map[sy][sx] = TILES.STAIRS;
    }
    enemies = [];
    corpses = [];
    decals = [];
    _lastMapCols = -1; _lastMapRows = -1; _lastMode = ""; _lastPlayerX = -1; _lastPlayerY = -1;
    recomputeFOV();
    updateCamera();
    updateUI();
    log("You explore the dungeon.");
    saveCurrentDungeonState(true);
  }

  function inBounds(x, y) {
    // Phase 1: prefer Utils.inBounds when available to avoid duplication
    if (window.Utils && typeof Utils.inBounds === "function") {
      try { return !!Utils.inBounds(getCtx(), x, y); } catch (_) {}
    }
    const mh = map.length || MAP_ROWS;
    const mw = map[0] ? map[0].length : MAP_COLS;
    return x >= 0 && y >= 0 && x < mw && y < mh;
  }

  // --------- Dungeon persistence helpers ---------
  function dungeonKeyFromWorldPos(x, y) {
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.keyFromWorldPos === "function") {
      return DR.keyFromWorldPos(x, y);
    }
    if (window.DungeonState && typeof DungeonState.key === "function") {
      return DungeonState.key(x, y);
    }
    return `${x},${y}`;
  }

  function saveCurrentDungeonState(logOnce = false) {
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.save === "function") {
      return DR.save(getCtx(), logOnce);
    }
    if (window.DungeonState && typeof DungeonState.save === "function") {
      try { if (window.DEV && logOnce) console.log("[TRACE] Calling DungeonState.save"); } catch (_) {}
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
    if (logOnce) {
      try {
        const totalEnemies = Array.isArray(enemies) ? enemies.length : 0;
        const typeCounts = (() => {
          try {
            if (!Array.isArray(enemies) || enemies.length === 0) return "";
            const mapCounts = {};
            for (const e of enemies) {
              const t = (e && e.type) ? String(e.type) : "(unknown)";
              mapCounts[t] = (mapCounts[t] || 0) + 1;
            }
            const parts = Object.keys(mapCounts).sort().map(k => `${k}:${mapCounts[k]}`);
            return parts.join(", ");
          } catch (_) { return ""; }
        })();
        const msg = `Dungeon snapshot: enemies=${totalEnemies}${typeCounts ? ` [${typeCounts}]` : ""}, corpses=${Array.isArray(corpses)?corpses.length:0}`;
        log(msg, "notice");
      } catch (_) {}
    }
  }

  function loadDungeonStateFor(x, y) {
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.load === "function") {
      const ctx = getCtx();
      const ok = DR.load(ctx, x, y);
      if (ok) syncFromCtx(ctx);
      return ok;
    }
    if (window.DungeonState && typeof DungeonState.load === "function") {
      const ctxMod = getCtx();
      const ok = DungeonState.load(ctxMod, x, y);
      if (ok) {
        syncFromCtx(ctxMod);
        updateCamera();
        recomputeFOV();
        updateUI();
        requestDraw();
      }
      return ok;
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

    player.x = dungeonExitAt.x;
    player.y = dungeonExitAt.y;

    if (inBounds(dungeonExitAt.x, dungeonExitAt.y)) {
      map[dungeonExitAt.y][dungeonExitAt.x] = TILES.STAIRS;
      if (visible[dungeonExitAt.y]) visible[dungeonExitAt.y][dungeonExitAt.x] = true;
      if (seen[dungeonExitAt.y]) seen[dungeonExitAt.y][dungeonExitAt.x] = true;
    }

    recomputeFOV();
    updateCamera();
    updateUI();
    requestDraw();
    return true;
  }

  function isWalkable(x, y) {
    // Phase 1: prefer Utils.isWalkableTile to unify tile semantics (ignore occupancy)
    if (window.Utils && typeof Utils.isWalkableTile === "function") {
      try { return !!Utils.isWalkableTile(getCtx(), x, y); } catch (_) {}
    }
    if (!inBounds(x, y)) return false;
    const t = map[y][x];
    return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.STAIRS;
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

  // FOV recompute guard: skip recompute unless player moved, FOV radius changed, mode changed, or map shape changed.
  let _lastPlayerX = -1, _lastPlayerY = -1, _lastFovRadius = -1, _lastMode = "", _lastMapCols = -1, _lastMapRows = -1;

  function recomputeFOV() {
    const rows = map.length;
    const cols = map[0] ? map[0].length : 0;

    const moved = (player.x !== _lastPlayerX) || (player.y !== _lastPlayerY);
    const fovChanged = (fovRadius !== _lastFovRadius);
    const modeChanged = (mode !== _lastMode);
    const mapChanged = (rows !== _lastMapRows) || (cols !== _lastMapCols);

    if (!modeChanged && !mapChanged && !fovChanged && !moved && mode !== "world") {
      // No change affecting FOV; skip recompute in dungeon/town
      return;
    }

    if (mode === "world") {
      // In overworld, reveal entire map (no fog-of-war)
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
      // update cache and return
      _lastPlayerX = player.x; _lastPlayerY = player.y;
      _lastFovRadius = fovRadius; _lastMode = mode;
      _lastMapCols = cols; _lastMapRows = rows;
      return;
    }

    ensureVisibilityShape();
    {
      const F = modHandle("FOV");
      if (F && typeof F.recomputeFOV === "function") {
        const ctx = getCtx();
        ctx.seen = seen;
        ctx.visible = visible;
        F.recomputeFOV(ctx);
        visible = ctx.visible;
        seen = ctx.seen;
        // update cache after recompute
        _lastPlayerX = player.x; _lastPlayerY = player.y;
        _lastFovRadius = fovRadius; _lastMode = mode;
        _lastMapCols = cols; _lastMapRows = rows;
        return;
      }
    }
    if (inBounds(player.x, player.y)) {
      visible[player.y][player.x] = true;
      seen[player.y][player.x] = true;
    }
    _lastPlayerX = player.x; _lastPlayerY = player.y;
    _lastFovRadius = fovRadius; _lastMode = mode;
    _lastMapCols = cols; _lastMapRows = rows;
  }

  
  function updateCamera() {
    // Prefer centralized camera module
    const FC = modHandle("FOVCamera");
    if (FC && typeof FC.updateCamera === "function") {
      FC.updateCamera(getCtx());
      return;
    }
    // Fallback: center camera on player with half-viewport slack beyond edges
    const mapCols = map[0] ? map[0].length : COLS;
    const mapRows = map ? map.length : ROWS;
    const mapWidth = mapCols * TILE;
    const mapHeight = mapRows * TILE;

    const targetX = player.x * TILE + TILE / 2 - camera.width / 2;
    const targetY = player.y * TILE + TILE / 2 - camera.height / 2;

    const slackX = Math.max(0, camera.width / 2 - TILE / 2);
    const slackY = Math.max(0, camera.height / 2 - TILE / 2);
    const minX = -slackX;
    const minY = -slackY;
    const maxX = (mapWidth - camera.width) + slackX;
    const maxY = (mapHeight - camera.height) + slackY;

    camera.x = Math.max(minX, Math.min(targetX, maxX));
    camera.y = Math.max(minY, Math.min(targetY, maxY));
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

  
  // Batch multiple draw requests within a frame to avoid redundant renders.
  let _drawQueued = false;
  let _rafId = null;

  // Simple perf counters (DEV-only visible in console)
  const PERF = { lastTurnMs: 0, lastDrawMs: 0 };

  function requestDraw() {
    const GL = modHandle("GameLoop");
    if (GL && typeof GL.requestDraw === "function") {
      GL.requestDraw();
      return;
    }
    const R = modHandle("Render");
    if (!(R && typeof R.draw === "function")) return;

    if (_drawQueued) return;
    _drawQueued = true;
    try {
      _rafId = (typeof window !== "undefined" && window.requestAnimationFrame)
        ? window.requestAnimationFrame(() => {
            const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            _drawQueued = false;
            R.draw(getRenderCtx());
            const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            PERF.lastDrawMs = t1 - t0;
            try { if (window.DEV) console.debug(`[PERF] draw ${PERF.lastDrawMs.toFixed(2)}ms`); } catch (_) {}
          })
        : null;
      if (_rafId == null) {
        // Fallback: if RAF not available, draw immediately
        const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        _drawQueued = false;
        R.draw(getRenderCtx());
        const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        PERF.lastDrawMs = t1 - t0;
        try { if (window.DEV) console.debug(`[PERF] draw ${PERF.lastDrawMs.toFixed(2)}ms`); } catch (_) {}
      }
    } catch (_) {
      const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      _drawQueued = false;
      R.draw(getRenderCtx());
      const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      PERF.lastDrawMs = t1 - t0;
      try { if (window.DEV) console.debug(`[PERF] draw ${PERF.lastDrawMs.toFixed(2)}ms`); } catch (_) {}
    }
  }

  

  

  function initWorld() {
    const W = modHandle("World");
    if (!(W && typeof W.generate === "function")) {
      log("World module missing; generating dungeon instead.", "warn");
      mode = "dungeon";
      generateLevel(floor);
      return;
    }
    const ctx = getCtx();
    world = W.generate(ctx, { width: MAP_COLS, height: MAP_ROWS });
    const start = (typeof W.pickTownStart === "function") ? W.pickTownStart(world, rng) : { x: 1, y: 1 };
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
    log("You arrive in the overworld. Towns: small (t), big (T), cities (C). Dungeons (D). Press G on a town/dungeon tile to enter/exit.", "notice");
    const UIH = modHandle("UI");
    if (UIH && typeof UIH.hideTownExitButton === "function") UIH.hideTownExitButton();
    requestDraw();
  }

  

  function talkNearbyNPC() {
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.talk === "function") {
      const ok = !!TR.talk(getCtx());
      return ok;
    }
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
    const SS = modHandle("ShopService");
    if (SS && typeof SS.shopAt === "function") {
      return SS.shopAt(getCtx(), x, y);
    }
    if (!Array.isArray(shops)) return null;
    return shops.find(s => s.x === x && s.y === y) || null;
  }
  // Shop schedule helpers (delegated to ShopService)
  function minutesOfDay(h, m = 0) {
    const SS = modHandle("ShopService");
    if (SS && typeof SS.minutesOfDay === "function") {
      return SS.minutesOfDay(h, m, DAY_MINUTES);
    }
    return ((h | 0) * 60 + (m | 0)) % DAY_MINUTES;
  }
  function isOpenAt(shop, minutes) {
    const SS = modHandle("ShopService");
    if (SS && typeof SS.isOpenAt === "function") {
      return SS.isOpenAt(shop, minutes);
    }
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    const o = shop.openMin, c = shop.closeMin;
    if (o === c) return false;
    return c > o ? (minutes >= o && minutes < c) : (minutes >= o || minutes < c);
  }
  function isShopOpenNow(shop = null) {
    const SS = modHandle("ShopService");
    if (SS && typeof SS.isShopOpenNow === "function") {
      return SS.isShopOpenNow(getCtx(), shop || null);
    }
    const t = getClock();
    const minutes = t.hours * 60 + t.minutes;
    if (!shop) return t.phase === "day";
    return isOpenAt(shop, minutes);
  }
  function shopScheduleStr(shop) {
    const SS = modHandle("ShopService");
    if (SS && typeof SS.shopScheduleStr === "function") {
      return SS.shopScheduleStr(shop);
    }
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
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.generate === "function") {
      const ctx = getCtx();
      const handled = !!TR.generate(ctx);
      if (handled) {
        syncFromCtx(ctx);
        return;
      }
    }
    const Tn = modHandle("Town");
    if (Tn && typeof Tn.generate === "function") {
      const ctx = getCtx();
      const handled = Tn.generate(ctx);
      if (handled) {
        syncFromCtx(ctx);
        updateCamera(); recomputeFOV(); updateUI(); requestDraw();
        return;
      }
    }
    log("Town module missing; unable to generate town.", "warn");
  }

  function ensureTownSpawnClear() {
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.ensureSpawnClear === "function") {
      TR.ensureSpawnClear(getCtx());
      return;
    }
    const Tn = modHandle("Town");
    if (Tn && typeof Tn.ensureSpawnClear === "function") {
      Tn.ensureSpawnClear(getCtx());
      return;
    }
    log("Town.ensureSpawnClear not available.", "warn");
  }

  function isFreeTownFloor(x, y) {
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.isFreeTownFloor === "function") {
      return !!TR.isFreeTownFloor(getCtx(), x, y);
    }
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
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.spawnGateGreeters === "function") {
      TR.spawnGateGreeters(getCtx(), count);
      return;
    }
    const Tn = modHandle("Town");
    if (Tn && typeof Tn.spawnGateGreeters === "function") {
      Tn.spawnGateGreeters(getCtx(), count);
      return;
    }
    log("Town.spawnGateGreeters not available.", "warn");
  }

  function syncFromCtx(ctx) {
    if (!ctx) return;
    mode = ctx.mode || mode;
    map = ctx.map || map;
    seen = ctx.seen || seen;
    visible = ctx.visible || visible;
    enemies = Array.isArray(ctx.enemies) ? ctx.enemies : enemies;
    corpses = Array.isArray(ctx.corpses) ? ctx.corpses : corpses;
    decals = Array.isArray(ctx.decals) ? ctx.decals : decals;
    npcs = Array.isArray(ctx.npcs) ? ctx.npcs : npcs;
    shops = Array.isArray(ctx.shops) ? ctx.shops : shops;
    townProps = Array.isArray(ctx.townProps) ? ctx.townProps : townProps;
    townBuildings = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : townBuildings;
    townPlaza = ctx.townPlaza || townPlaza;
    tavern = ctx.tavern || tavern;
    worldReturnPos = ctx.worldReturnPos || worldReturnPos;
    townExitAt = ctx.townExitAt || townExitAt;
    dungeonExitAt = ctx.dungeonExitAt || dungeonExitAt;
    currentDungeon = ctx.dungeon || ctx.dungeonInfo || currentDungeon;
    if (typeof ctx.floor === "number") { floor = ctx.floor | 0; window.floor = floor; }
  }

  function enterTownIfOnTile() {
    const M = modHandle("Modes");
    if (M && typeof M.enterTownIfOnTile === "function") {
      const ctx = getCtx();
      const ok = !!M.enterTownIfOnTile(ctx);
      if (ok) {
        // Sync mutated ctx back into local state
        syncFromCtx(ctx);
        updateCamera();
        // Invalidate FOV cache and recompute
        _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
        recomputeFOV();
        updateUI();
        requestDraw();
      }
      return ok;
    }
    return false;
  }

  function enterDungeonIfOnEntrance() {
    const M = modHandle("Modes");
    if (M && typeof M.enterDungeonIfOnEntrance === "function") {
      const ctx = getCtx();
      const ok = !!M.enterDungeonIfOnEntrance(ctx);
      if (ok) {
        syncFromCtx(ctx);
        updateCamera();
        _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
        recomputeFOV();
        updateUI();
        requestDraw();
      }
      return ok;
    }
    return false;
  }

  function leaveTownNow() {
    if (window.Modes && typeof Modes.leaveTownNow === "function") {
      const ctx = getCtx();
      Modes.leaveTownNow(ctx);
      // Sync mutated ctx back into local state
      mode = ctx.mode || mode;
      map = ctx.map || map;
      seen = ctx.seen || seen;
      visible = ctx.visible || visible;
      enemies = Array.isArray(ctx.enemies) ? ctx.enemies : enemies;
      corpses = Array.isArray(ctx.corpses) ? ctx.corpses : corpses;
      decals = Array.isArray(ctx.decals) ? ctx.decals : decals;
      npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
      shops = Array.isArray(ctx.shops) ? ctx.shops : [];
      townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
      townBuildings = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
      townPlaza = null;
      tavern = null;
      worldReturnPos = ctx.worldReturnPos || worldReturnPos;
      townExitAt = null;
      dungeonExitAt = null;
      currentDungeon = ctx.dungeon || ctx.dungeonInfo || null;
      if (typeof ctx.floor === "number") { floor = ctx.floor | 0; window.floor = floor; }
      recomputeFOV();
      updateCamera();
      updateUI();
      requestDraw();
      return;
    }
  }

  function requestLeaveTown() {
    const M = modHandle("Modes");
    if (M && typeof M.requestLeaveTown === "function") {
      M.requestLeaveTown(getCtx());
      return;
    }
    // Fallback confirm
    const doLeave = () => leaveTownNow();
    if (window.UI && typeof UI.showConfirm === "function") {
      const x = window.innerWidth / 2 - 140;
      const y = window.innerHeight / 2 - 60;
      UI.showConfirm("Do you want to leave the town?", { x, y }, () => doLeave(), () => {});
    } else {
      if (window.confirm && window.confirm("Do you want to leave the town?")) {
        doLeave();
      }
    }
  }

  function returnToWorldFromTown() {
    if (mode !== "town" || !world) return false;
    // Prefer TownRuntime centralization
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.returnToWorldIfAtGate === "function") {
      const ctx = getCtx();
      const ok = !!TR.returnToWorldIfAtGate(ctx);
      if (ok) {
        syncFromCtx(ctx);
        return true;
      }
    }
    if (townExitAt && player.x === townExitAt.x && player.y === townExitAt.y) {
      // Immediate exit on gate when pressing G (disable confirm UI)
      leaveTownNow();
      return true;
    }
    log("Return to the town gate to exit to the overworld.", "info");
    return false;
  }

  function returnToWorldIfAtExit() {
    const M = modHandle("Modes");
    if (M && typeof M.returnToWorldIfAtExit === "function") {
      const ctx = getCtx();
      const ok = M.returnToWorldIfAtExit(ctx);
      if (ok) {
        // Sync mutated ctx back into local state
        mode = ctx.mode || mode;
        map = ctx.map || map;
        seen = ctx.seen || seen;
        visible = ctx.visible || visible;
        enemies = Array.isArray(ctx.enemies) ? ctx.enemies : enemies;
        corpses = Array.isArray(ctx.corpses) ? ctx.corpses : corpses;
        decals = Array.isArray(ctx.decals) ? ctx.decals : decals;
        worldReturnPos = ctx.worldReturnPos || worldReturnPos;
        townExitAt = ctx.townExitAt || townExitAt;
        dungeonExitAt = ctx.dungeonExitAt || dungeonExitAt;
        currentDungeon = ctx.dungeon || ctx.dungeonInfo || currentDungeon;
        if (typeof ctx.floor === "number") { floor = ctx.floor | 0; window.floor = floor; }
        recomputeFOV();
        updateCamera();
        updateUI();
        requestDraw();
      }
      return ok;
    }
    return false;
  }

  // Context-sensitive action button (G): enter/exit/interact depending on mode/state
  function doAction() {
    hideLootPanel();

    // Town gate exit takes priority over other interactions
    if (mode === "town" && townExitAt && player.x === townExitAt.x && player.y === townExitAt.y) {
      if (returnToWorldFromTown()) return;
    }

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
        // Town-specific state
        npcs = Array.isArray(ctxMod.npcs) ? ctxMod.npcs : npcs;
        shops = Array.isArray(ctxMod.shops) ? ctxMod.shops : shops;
        townProps = Array.isArray(ctxMod.townProps) ? ctxMod.townProps : townProps;
        townBuildings = Array.isArray(ctxMod.townBuildings) ? ctxMod.townBuildings : townBuildings;
        townPlaza = ctxMod.townPlaza || townPlaza;
        tavern = ctxMod.tavern || tavern;
        // Anchors/persistence
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
        // Ensure shop modal is part of the modal stack priority
        isShopOpen: () => {
          // Step 2: Prefer ShopUI state when available; fallback to DOM check
          try {
            if (window.ShopUI && typeof ShopUI.isOpen === "function") {
              return !!ShopUI.isOpen();
            }
          } catch (_) {}
          try {
            const el = document.getElementById("shop-panel");
            return !!(el && el.hidden === false);
          } catch (_) { return false; }
        },
        // actions
        onRestart: () => restartGame(),
        onShowInventory: () => showInventoryPanel(),
        onHideInventory: () => hideInventoryPanel(),
        onHideLoot: () => hideLootPanel(),
        onHideGod: () => { if (window.UI && UI.hideGod) UI.hideGod(); requestDraw(); },
        onHideShop: () => hideShopPanel(),
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

          // Heuristic: if NPC is at/near a shop door, open a simple shop UI to buy potions and gear
          try {
            const nearShop = (() => {
              if (!Array.isArray(shops)) return false;
              for (const s of shops) {
                const d = Math.abs(s.x - npc.x) + Math.abs(s.y - npc.y);
                if (d <= 1) return true;
              }
              return false;
            })();
            if (nearShop) {
              openShopFor(npc);
            }
          } catch (_) {}

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
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.generateLoot === "function") {
      return DR.generateLoot(getCtx(), source);
    }
    const L = modHandle("Loot");
    if (L && typeof L.generate === "function") {
      return L.generate(getCtx(), source);
    }
    return [];
  }

  
  function interactTownProps() {
    const Tn = modHandle("Town");
    if (Tn && typeof Tn.interactProps === "function") {
      return !!Tn.interactProps(getCtx());
    }
    return false;
  }

  function lootCorpse() {
    if (isDead) return;

    // Prefer Actions module for all interaction/loot flows across modes
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

    // Dungeon-only fallback: loot ground or guide user
    if (mode === "dungeon") {
      const DR = modHandle("DungeonRuntime");
      if (DR && typeof DR.lootHere === "function") {
        DR.lootHere(getCtx());
        return;
      }
      if (window.Loot && typeof Loot.lootHere === "function") {
        Loot.lootHere(getCtx());
        return;
      }
      log("Return to the entrance (the hole '>') and press G to leave.", "info");
      requestDraw();
      return;
    }

    // World/town default
    log("Nothing to do here.");
  }

  function showLootPanel(list) {
    // Prefer UIBridge
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.showLoot === "function") {
      UB.showLoot(getCtx(), list);
      requestDraw();
      return;
    }
    if (window.UI && typeof UI.showLoot === "function") {
      UI.showLoot(list);
      requestDraw();
    }
  }

  function hideLootPanel() {
    // Prefer UIBridge
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.hideLoot === "function") {
      let wasOpen = true;
      try {
        if (typeof UB.isLootOpen === "function") wasOpen = !!UB.isLootOpen();
      } catch (_) {}
      UB.hideLoot(getCtx());
      if (wasOpen) requestDraw();
      return;
    }
    if (window.UI && typeof UI.hideLoot === "function") {
      let wasOpen = true;
      try {
        if (typeof UI.isLootOpen === "function") wasOpen = !!UI.isLootOpen();
      } catch (_) {}
      UI.hideLoot();
      if (wasOpen) requestDraw();
      return;
    }
    const panel = document.getElementById("loot-panel");
    if (!panel) return;
    const wasHidden = panel.hidden === true;
    panel.hidden = true;
    if (!wasHidden) requestDraw();
  }

  // Shop UI delegated to ui/shop_panel.js
  function hideShopPanel() {
    // Delegate to ShopUI via ctx handle when available; fallback to DOM
    const SU = modHandle("ShopUI");
    if (SU && typeof SU.hide === "function") {
      SU.hide();
      requestDraw();
      return;
    }
    const el = document.getElementById("shop-panel");
    if (el) el.hidden = true;
    requestDraw();
  }
  function openShopFor(npc) {
    // Delegate to ShopUI via ctx handle
    const SU = modHandle("ShopUI");
    if (SU && typeof SU.openForNPC === "function") {
      try { SU.openForNPC(getCtx(), npc); } catch (_) {}
      return;
    }
    try { log("Shop UI not available.", "warn"); } catch (_) {}
  }
  function shopBuyIndex(idx) {
    // Delegate to ShopUI via ctx handle
    const SU = modHandle("ShopUI");
    if (SU && typeof SU.buyIndex === "function") {
      try { SU.buyIndex(getCtx(), idx); } catch (_) {}
    }
  }

  // GOD mode actions
  function godHeal() {
    const G = modHandle("God");
    if (G && typeof G.heal === "function") { G.heal(getCtx()); return; }
    log("GOD: heal not available.", "warn");
  }

  function godSpawnStairsHere() {
    const G = modHandle("God");
    if (G && typeof G.spawnStairsHere === "function") { G.spawnStairsHere(getCtx()); return; }
    log("GOD: spawnStairsHere not available.", "warn");
  }

  function godSpawnItems(count = 3) {
    const G = modHandle("God");
    if (G && typeof G.spawnItems === "function") { G.spawnItems(getCtx(), count); return; }
    log("GOD: spawnItems not available.", "warn");
  }

  /**
   * Spawn one or more enemies near the player (debug/GOD).
   * - Chooses a free FLOOR tile within a small radius; falls back to any free floor tile.
   * - Creates enemy via ctx.enemyFactory or Enemies.createEnemyAt.
   * - Applies small randomized jitters to hp/atk for variety (deterministic via rng).
   */
  function godSpawnEnemyNearby(count = 1) {
    const G = modHandle("God");
    if (G && typeof G.spawnEnemyNearby === "function") { G.spawnEnemyNearby(getCtx(), count); return; }
    log("GOD: spawnEnemyNearby not available.", "warn");
  }

  
  function renderInventoryPanel() {
    // Keep totals in sync
    updateUI();
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.render === "function") {
      IC.render(getCtx());
      return;
    }
    // Prefer UIBridge
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.renderInventory === "function") {
      UB.renderInventory(getCtx());
      return;
    }
    if (window.UI && typeof UI.renderInventory === "function") {
      UI.renderInventory(player, describeItem);
    }
  }

  function showInventoryPanel() {
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.show === "function") {
      IC.show(getCtx());
    } else {
      renderInventoryPanel();
      const UB = modHandle("UIBridge");
      if (UB && typeof UB.showInventory === "function") {
        UB.showInventory(getCtx());
      } else if (window.UI && typeof UI.showInventory === "function") {
        UI.showInventory();
      } else {
        const panel = document.getElementById("inv-panel");
        if (panel) panel.hidden = false;
      }
    }
    requestDraw();
  }

  function hideInventoryPanel() {
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.hide === "function") {
      IC.hide(getCtx());
      requestDraw();
      return;
    }
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.hideInventory === "function") {
      UB.hideInventory(getCtx());
      requestDraw();
      return;
    }
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
    // Delegate to InventoryController (which uses Player/PlayerEquip internally)
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.equipByIndex === "function") {
      IC.equipByIndex(getCtx(), idx);
      return;
    }
    const P = modHandle("Player");
    if (P && typeof P.equipItemByIndex === "function") {
      P.equipItemByIndex(player, idx, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
        describeItem: (it) => describeItem(it),
      });
      return;
    }
    log("Equip system not available.", "warn");
  }

  function equipItemByIndexHand(idx, hand) {
    // Delegate to InventoryController
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.equipByIndexHand === "function") {
      IC.equipByIndexHand(getCtx(), idx, hand);
      return;
    }
    const P = modHandle("Player");
    if (P && typeof P.equipItemByIndex === "function") {
      P.equipItemByIndex(player, idx, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
        describeItem: (it) => describeItem(it),
        preferredHand: hand,
      });
      return;
    }
    log("Equip system not available.", "warn");
  }

  function unequipSlot(slot) {
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.unequipSlot === "function") {
      IC.unequipSlot(getCtx(), slot);
      return;
    }
    const P = modHandle("Player");
    if (P && typeof P.unequipSlot === "function") {
      P.unequipSlot(player, slot, {
        log,
        updateUI,
        renderInventory: () => renderInventoryPanel(),
      });
      return;
    }
    log("Equip system not available.", "warn");
  }

  

  function showGameOver() {
    // Prefer UIBridge
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.showGameOver === "function") {
      UB.showGameOver(getCtx());
      requestDraw();
      return;
    }
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
    const G = modHandle("God");
    if (G && typeof G.setAlwaysCrit === "function") { G.setAlwaysCrit(getCtx(), v); alwaysCrit = !!v; return; }
    alwaysCrit = !!v;
    try { window.ALWAYS_CRIT = alwaysCrit; localStorage.setItem("ALWAYS_CRIT", alwaysCrit ? "1" : "0"); } catch (_) {}
    log(`GOD: Always Crit ${alwaysCrit ? "enabled" : "disabled"}.`, alwaysCrit ? "good" : "warn");
  }

  // GOD: set forced crit body part for player attacks
  function setCritPart(part) {
    const G = modHandle("God");
    if (G && typeof G.setCritPart === "function") { G.setCritPart(getCtx(), part); forcedCritPart = part; return; }
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
    const G = modHandle("God");
    if (G && typeof G.applySeed === "function") {
      const ctx = getCtx();
      G.applySeed(ctx, seedUint32);
      // Sync RNG and any regenerated state back into local variables
      rng = ctx.rng || rng;
      syncFromCtx(ctx);
      updateCamera();
      recomputeFOV();
      updateUI();
      requestDraw();
      return;
    }
    // Minimal fallback
    const s = (Number(seedUint32) >>> 0);
    currentSeed = s;
    try { localStorage.setItem("SEED", String(s)); } catch (_) {}
    if (typeof window !== "undefined" && window.RNG && typeof RNG.applySeed === "function") {
      RNG.applySeed(s);
      rng = RNG.rng;
    } else {
      try {
        if (typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function") {
          rng = RNGFallback.getRng(s);
        } else {
          rng = Math.random;
        }
      } catch (_) {
        rng = Math.random;
      }
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
    const G = modHandle("God");
    if (G && typeof G.rerollSeed === "function") {
      const ctx = getCtx();
      G.rerollSeed(ctx);
      rng = ctx.rng || rng;
      syncFromCtx(ctx);
      updateCamera();
      recomputeFOV();
      updateUI();
      requestDraw();
      return;
    }
    const s = (Date.now() % 0xffffffff) >>> 0;
    applySeed(s);
  }

  function hideGameOver() {
    // Prefer UIBridge
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.hideGameOver === "function") {
      UB.hideGameOver(getCtx());
      return;
    }
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
    // Delegate to DungeonRuntime first
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.killEnemy === "function") {
      const ctx = getCtx();
      DR.killEnemy(ctx, enemy);
      // Sync mutated ctx (enemies, corpses, occupancy, player xp)
      syncFromCtx(ctx);
      return;
    }
    // Fallback local behavior
    const name = capitalize(enemy.type || "enemy");
    log(`${name} dies.`, "bad");
    const loot = generateLoot(enemy);
    corpses.push({ x: enemy.x, y: enemy.y, loot, looted: loot.length === 0 });
    enemies = enemies.filter(e => e !== enemy);
    try {
      if (occupancy && typeof occupancy.clearEnemy === "function") {
        occupancy.clearEnemy(enemy.x, enemy.y);
      }
    } catch (_) {}
    gainXP(enemy.xp || 5);
    try {
      if (window.DungeonState && typeof DungeonState.save === "function") {
        DungeonState.save(getCtx());
      }
    } catch (_) {}
  }

  
  function updateUI() {
    // Prefer UIBridge
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.updateStats === "function") {
      UB.updateStats(getCtx());
      return;
    }
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
    const AIH = modHandle("AI");
    if (AIH && typeof AIH.enemiesAct === "function") {
      AIH.enemiesAct(getCtx());
    }
    // No fallback here: AI behavior is defined in ai.js
  }

  function townNPCsAct() {
    if (mode !== "town") return;
    const TAI = modHandle("TownAI");
    if (TAI && typeof TAI.townNPCsAct === "function") {
      TAI.townNPCsAct(getCtx());
    }
  }

  
  function occupied(x, y) {
    if (player.x === x && player.y === y) return true;
    return enemies.some(e => e.x === x && e.y === y);
  }

  
  function turn() {
    if (isDead) return;

    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

    // Advance global time (centralized via TimeService)
    turnCounter = TS.tick(turnCounter);



    if (mode === "dungeon") {
      enemiesAct();
      // Ensure occupancy reflects enemy movement/deaths this turn to avoid stale blocking
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

      // Persistence snapshot logging removed from per-turn to avoid noise.
      // DungeonState.save is still called on key events (entry, kills, explicit saves).
    } else if (mode === "town") {
      townTick = (townTick + 1) | 0;
      townNPCsAct();
      // Rebuild occupancy at a modest stride to avoid ghost-blocking after NPC bursts
      const TOWN_OCC_STRIDE = 2;
      if ((townTick % TOWN_OCC_STRIDE) === 0) {
        rebuildOccupancy();
      }
    }

    recomputeFOV();
    updateUI();
    requestDraw();

    const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    PERF.lastTurnMs = t1 - t0;
    try { if (window.DEV) console.debug(`[PERF] turn ${PERF.lastTurnMs.toFixed(2)}ms`); } catch (_) {}
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
          // Panels for ESC-close default behavior
          isShopOpen: () => {
            // Step 2: Prefer ShopUI.isOpen if available; fallback to DOM
            try {
              if (window.ShopUI && typeof ShopUI.isOpen === "function") {
                return !!ShopUI.isOpen();
              }
            } catch (_) {}
            try {
              const el = document.getElementById("shop-panel");
              return !!(el && el.hidden === false);
            } catch (_) { return false; }
          },
          onHideShop: () => hideShopPanel(),
          onGodCheckHomes: () => {
            const ctx = getCtx();
            if (ctx.mode !== "town") {
              log("Home route check is available in town mode only.", "warn");
              requestDraw();
              return;
            }
            // Ensure town NPCs are populated before running the check
            try {
              if ((!Array.isArray(ctx.npcs) || ctx.npcs.length === 0) && window.TownAI && typeof TownAI.populateTown === "function") {
                TownAI.populateTown(ctx);
                // Sync back any mutations
                syncFromCtx(ctx);
                rebuildOccupancy();
              }
            } catch (_) {}

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
                // TownAI returns atTavern; display as "inn" for consistency
                extraLines.push(`Residents: ${r.atHome}/${r.total} at home, ${r.atTavern}/${r.total} at inn.`);
              } else {
                // Provide a hint if no residents were counted
                extraLines.push("No residents were counted; ensure town NPCs are populated.");
              }
              // Per-resident list of late-night away residents
              if (Array.isArray(res.residentsAwayLate) && res.residentsAwayLate.length) {
                extraLines.push(`Late-night (02:00–05:00): ${res.residentsAwayLate.length} resident(s) away from home and inn:`);
                res.residentsAwayLate.slice(0, 10).forEach(d => {
                  extraLines.push(`- ${d.name} at (${d.x},${d.y})`);
                });
                if (res.residentsAwayLate.length > 10) {
                  extraLines.push(`...and ${res.residentsAwayLate.length - 10} more.`);
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
          onGodDiagnostics: () => {
            const ctx = getCtx();
            const mods = {
              Enemies: !!ctx.Enemies, Items: !!ctx.Items, Player: !!ctx.Player,
              UI: !!ctx.UI, Logger: !!ctx.Logger, Loot: !!ctx.Loot,
              Dungeon: !!ctx.Dungeon, DungeonItems: !!ctx.DungeonItems,
              FOV: !!ctx.FOV, AI: !!ctx.AI, Input: !!ctx.Input,
              Render: !!ctx.Render, Tileset: !!ctx.Tileset, Flavor: !!ctx.Flavor,
              World: !!ctx.World, Town: !!ctx.Town, TownAI: !!ctx.TownAI,
              DungeonState: !!ctx.DungeonState
            };
            const rngSrc = (typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function") ? "RNG.service" : "mulberry32.fallback";
            const seedStr = (typeof currentSeed === "number") ? String(currentSeed >>> 0) : "(random)";
            log("Diagnostics:", "notice");
            log(`- Determinism: ${rngSrc}  Seed: ${seedStr}`, "info");
            log(`- Mode: ${mode}  Floor: ${floor}  FOV: ${fovRadius}`, "info");
            log(`- Map: ${map.length}x${(map[0] ? map[0].length : 0)}`, "info");
            log(`- Entities: enemies=${enemies.length} corpses=${corpses.length} npcs=${npcs.length}`, "info");
            log(`- Modules: ${Object.keys(mods).filter(k=>mods[k]).join(", ")}`, "info");
            log(`- PERF last turn: ${PERF.lastTurnMs.toFixed(2)}ms, last draw: ${PERF.lastDrawMs.toFixed(2)}ms`, "info");
            requestDraw();
          },
          onGodRunSmokeTest: () => {
            // Reload the page with ?smoketest=1 so the loader injects the runner and it auto-runs
            try {
              const url = new URL(window.location.href);
              url.searchParams.set("smoketest", "1");
              // Preserve existing dev flag/state if set in localStorage
              if (window.DEV || localStorage.getItem("DEV") === "1") {
                url.searchParams.set("dev", "1");
              }
              log("GOD: Reloading with smoketest=1…", "notice");
              window.location.href = url.toString();
            } catch (e) {
              try { console.error(e); } catch (_) {}
              try {
                log("GOD: Failed to construct URL; reloading with ?smoketest=1", "warn");
              } catch (_) {}
              window.location.search = "?smoketest=1";
            }
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

  // Mouse/click support delegated to ui/input_mouse.js
  try {
    if (window.InputMouse && typeof InputMouse.init === "function") {
      InputMouse.init({
        canvasId: "game",
        getMode: () => mode,
        TILE,
        getCamera: () => camera,
        getPlayer: () => ({ x: player.x, y: player.y }),
        inBounds: (x, y) => inBounds(x, y),
        isWalkable: (x, y) => isWalkable(x, y),
        getCorpses: () => corpses,
        getEnemies: () => enemies,
        tryMovePlayer: (dx, dy) => tryMovePlayer(dx, dy),
        lootCorpse: () => lootCorpse(),
        doAction: () => doAction(),
      });
    }
  } catch (_) {}

  {
    const GL = modHandle("GameLoop");
    if (GL && typeof GL.start === "function") {
      GL.start(() => getRenderCtx());
    } else {
      const R = modHandle("Render");
      if (R && typeof R.draw === "function") {
        R.draw(getRenderCtx());
      }
    }
  }

  // Expose GameAPI via builder
  try {
    if (window.GameAPIBuilder && typeof GameAPIBuilder.create === "function") {
      window.GameAPI = GameAPIBuilder.create({
        getMode: () => mode,
        getWorld: () => world,
        getPlayer: () => player,
        getEnemies: () => enemies,
        getNPCs: () => npcs,
        getTownProps: () => townProps,
        getCorpses: () => corpses,
        getShops: () => shops,
        getDungeonExit: () => dungeonExitAt,
        getTownGate: () => townExitAt,
        getMap: () => map,
        getVisible: () => visible,
        getCamera: () => camera,
        getOccupancy: () => occupancy,
        getDecals: () => decals,
        getPerfStats: () => ({ lastTurnMs: (PERF.lastTurnMs || 0), lastDrawMs: (PERF.lastDrawMs || 0) }),
        TILES,
        tryMovePlayer: (dx, dy) => tryMovePlayer(dx, dy),
        enterTownIfOnTile: () => enterTownIfOnTile(),
        enterDungeonIfOnEntrance: () => enterDungeonIfOnEntrance(),
        isWalkable: (x, y) => isWalkable(x, y),
        inBounds: (x, y) => inBounds(x, y),
        updateCamera: () => updateCamera(),
        recomputeFOV: () => recomputeFOV(),
        requestDraw: () => requestDraw(),
        updateUI: () => updateUI(),
        renderInventoryPanel: () => renderInventoryPanel(),
        equipItemByIndex: (idx) => equipItemByIndex(idx),
        equipItemByIndexHand: (idx, hand) => equipItemByIndexHand(idx, hand),
        unequipSlot: (slot) => unequipSlot(slot),
        drinkPotionByIndex: (idx) => drinkPotionByIndex(idx),
        addPotionToInventory: (heal, name) => addPotionToInventory(heal, name),
        getPlayerAttack: () => getPlayerAttack(),
        getPlayerDefense: () => getPlayerDefense(),
        isShopOpenNow: (shop) => isShopOpenNow(shop),
        shopScheduleStr: (shop) => shopScheduleStr(shop),
        advanceTimeMinutes: (mins) => advanceTimeMinutes(mins),
        restUntilMorning: () => restUntilMorning(),
        restAtInn: () => restAtInn(),
        returnToWorldIfAtExit: () => returnToWorldIfAtExit(),
        setAlwaysCrit: (v) => setAlwaysCrit(v),
        setCritPart: (part) => setCritPart(part),
        godSpawnEnemyNearby: (count) => godSpawnEnemyNearby(count),
        godSpawnItems: (count) => godSpawnItems(count),
        generateLoot: (source) => generateLoot(source),
        getClock: () => getClock(),
        getCtx: () => getCtx(),
        log: (msg, type) => log(msg, type),
      });
    }
  } catch (_) {}

})();