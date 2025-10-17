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
  // Region map overlay state (fixed-size downscaled world view)
  let region = null;         // { width, height, map:number[][], cursor:{x,y}, exitTiles:[{x,y}], enterWorldPos:{x,y} }
  let npcs = [];             // simple NPCs for town mode: { x, y, name, lines:[] }
  let shops = [];            // shops in town mode: [{x,y,type,name}]
  let townProps = [];        // interactive town props: [{x,y,type,name}]
  let townBuildings = [];    // town buildings: [{x,y,w,h,door:{x,y}}]
  let townPlaza = null;      // central plaza coordinates {x,y}
  let tavern = null;         // tavern info: { building:{x,y,w,h,door}, door:{x,y} }
  
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
  const TS = (typeof window !== "undefined" && window.TimeService && typeof window.TimeService.create === "function")
    ? window.TimeService.create({ dayMinutes: 24 * 60, cycleTurns: 360 })
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
  let player = ((typeof window !== "undefined" && window.Player && typeof window.Player.createInitial === "function")
    ? window.Player.createInitial()
    : { x: 0, y: 0, hp: 20, maxHp: 40, inventory: [], atk: 1, xp: 0, level: 1, xpNext: 20, equipment: { left: null, right: null, head: null, torso: null, legs: null, hands: null } });
  let enemies = [];
  let corpses = [];
  // Visual decals like blood stains on the floor; array of { x, y, a (alpha 0..1), r (radius px) }
  let decals = [];
  // Occupancy Grid (entities on tiles)
  let occupancy = null;
  
  let floor = 1;
  // RNG: centralized via RNG service; allow persisted seed for reproducibility
  let currentSeed = null;
  if (typeof window !== "undefined" && window.RNG && typeof window.RNG.autoInit === "function") {
    try {
      currentSeed = window.RNG.autoInit();
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
  let rng = ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
    ? window.RNG.rng
    : (function () {
        // Shared centralized fallback (deterministic) if RNG service not available
        try {
          if (typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function") {
            return window.RNGFallback.getRng(currentSeed);
          }
        } catch (_) {}
        // Ultimate fallback: non-deterministic
        return Math.random;
      })());
  let isDead = false;
  let startRoomRect = null;
  // GOD toggles
  let alwaysCrit = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT === "boolean") ? !!window.ALWAYS_CRIT : false;
  let forcedCritPart = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT_PART === "string") ? window.ALWAYS_CRIT_PART : (typeof localStorage !== "undefined" ? (localStorage.getItem("ALWAYS_CRIT_PART") || "") : "");
  // Render grid preference (ctx-first). Default from window.DRAW_GRID; UI toggle will update this.
  let drawGridPref = (typeof window !== "undefined" && typeof window.DRAW_GRID === "boolean") ? !!window.DRAW_GRID : true;

  
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
      region,
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
      // Perf stats for HUD overlay (smoothed via EMA when available)
      getPerfStats: () => ({
        lastTurnMs: (typeof PERF.avgTurnMs === "number" ? PERF.avgTurnMs : (PERF.lastTurnMs || 0)),
        lastDrawMs: (typeof PERF.avgDrawMs === "number" ? PERF.avgDrawMs : (PERF.lastDrawMs || 0))
      }),
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

    if (typeof window !== "undefined" && window.Ctx && typeof window.Ctx.create === "function") {
      const ctx = window.Ctx.create(base);
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
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.int === "function") return window.RNG.int(min, max);
    return Math.floor(rng() * (max - min + 1)) + min;
  };
  const chance = (p) => {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.chance === "function") return window.RNG.chance(p);
    return rng() < p;
  };
  const capitalize = ((typeof window !== "undefined" && window.PlayerUtils && typeof window.PlayerUtils.capitalize === "function")
    ? window.PlayerUtils.capitalize
    : (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const enemyColor = (type) => {
    const EM = modHandle("Enemies");
    if (EM && typeof EM.colorFor === "function") {
      return EM.colorFor(type);
    }
    return COLORS.enemy;
  };
  const randFloat = (min, max, decimals = 1) => {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.float === "function") return window.RNG.float(min, max, decimals);
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
    const UB = modHandle("UIBridge");
    let open = false;
    try {
      if (UB && typeof UB.isInventoryOpen === "function") open = !!UB.isInventoryOpen();
    } catch (_) {}
    if (open) renderInventoryPanel();
  }

  function decayEquipped(slot, amount) {
    const P = modHandle("Player");
    if (P && typeof P.decayEquipped === "function") {
      P.decayEquipped(player, slot, amount, {
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
        const F = modHandle("Flavor");
        if (F && typeof F.onBreak === "function") {
          F.onBreak(getCtx(), { side: "player", slot, item: it });
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
    const FB = modHandle("Fallbacks");
    if (FB && typeof FB.rollHitLocation === "function") {
      return FB.rollHitLocation(rng);
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
    const FB = modHandle("Fallbacks");
    if (FB && typeof FB.critMultiplier === "function") {
      return FB.critMultiplier(rng);
    }
    return 1.6 + rng() * 0.4;
  }

  function getEnemyBlockChance(enemy, loc) {
    // Prefer Combat math; then fall back to Fallbacks; minimal local last-resort
    const C = modHandle("Combat");
    if (C && typeof C.getEnemyBlockChance === "function") {
      return C.getEnemyBlockChance(getCtx(), enemy, loc);
    }
    const FB = modHandle("Fallbacks");
    if (FB && typeof FB.enemyBlockChance === "function") {
      return FB.enemyBlockChance(getCtx(), enemy, loc);
    }
    const base = enemy.type === "ogre" ? 0.10 : enemy.type === "troll" ? 0.08 : 0.06;
    return Math.max(0, Math.min(0.35, base * (loc?.blockMod || 1.0)));
  }

  function getPlayerBlockChance(loc) {
    const C = modHandle("Combat");
    if (C && typeof C.getPlayerBlockChance === "function") {
      return C.getPlayerBlockChance(getCtx(), loc);
    }
    // Minimal fallback aligned with Combat module (includes brace bonus)
    const p = player || {};
    const eq = p.equipment || {};
    const leftDef = (eq.left && typeof eq.left.def === "number") ? eq.left.def : 0;
    const rightDef = (eq.right && typeof eq.right.def === "number") ? eq.right.def : 0;
    const handDef = Math.max(leftDef, rightDef);
    const base = 0.08 + handDef * 0.06;
    const mod = (loc && typeof loc.blockMod === "number") ? loc.blockMod : 1.0;
    const braceBonus = (p && typeof p.braceTurns === "number" && p.braceTurns > 0) ? 1.5 : 1.0;
    const clampMax = (braceBonus > 1.0) ? 0.75 : 0.6;
    return Math.max(0, Math.min(clampMax, base * mod * braceBonus));
  }

  // Enemy damage after applying player's defense with diminishing returns and a chip-damage floor
  function enemyDamageAfterDefense(raw) {
    const C = modHandle("Combat");
    if (C && typeof C.enemyDamageAfterDefense === "function") {
      return C.enemyDamageAfterDefense(getCtx(), raw);
    }
    const FB = modHandle("Fallbacks");
    if (FB && typeof FB.enemyDamageAfterDefense === "function") {
      return FB.enemyDamageAfterDefense(getCtx(), raw);
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
    const C = modHandle("Combat");
    if (C && typeof C.enemyDamageMultiplier === "function") {
      return C.enemyDamageMultiplier(level);
    }
    const FB = modHandle("Fallbacks");
    if (FB && typeof FB.enemyDamageMultiplier === "function") {
      return FB.enemyDamageMultiplier(level);
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
        renderInventory: () => rerenderInventoryIfOpen(),
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
    rerenderInventoryIfOpen();
  }

  
  function equipIfBetter(item) {
    // Delegate via ctx-first handle
    const P = modHandle("Player");
    if (P && typeof P.equipIfBetter === "function") {
      return P.equipIfBetter(player, item, {
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
    const LG = modHandle("Logger");
    if (LG && typeof LG.log === "function") {
      LG.log(msg, type);
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
      // Rebuild occupancy using TownRuntime helper or direct OccupancyGrid
      {
        const TR = modHandle("TownRuntime");
        if (TR && typeof TR.rebuildOccupancy === "function") {
          TR.rebuildOccupancy(getCtx());
        } else {
          const OG = modHandle("OccupancyGrid");
          if (OG && typeof OG.build === "function") {
            occupancy = OG.build({ map, enemies, npcs, props: townProps, player });
          }
        }
      }
      if (window.DEV) {
        try {
          const visCount = enemies.filter(e => inBounds(e.x, e.y) && visible[e.y][e.x]).length;
          log(`[DEV] Enemies spawned: ${enemies.length}, visible now: ${visCount}.`, "notice");
        } catch (_) {}
      }
      updateUI();
      log("You explore the dungeon.");
      try {
        const DR2 = modHandle("DungeonRuntime");
        if (DR2 && typeof DR2.save === "function") {
          DR2.save(ctx, true);
        } else {
          const DS = modHandle("DungeonState");
          if (DS && typeof DS.save === "function") {
            DS.save(ctx);
          }
        }
      } catch (_) {}
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
    try {
      const DR2 = modHandle("DungeonRuntime");
      if (DR2 && typeof DR2.save === "function") {
        DR2.save(getCtx(), true);
      } else {
        const DS = modHandle("DungeonState");
        if (DS && typeof DS.save === "function") {
          DS.save(getCtx());
        }
      }
    } catch (_) {}
    requestDraw();
    return;
  }

  function inBounds(x, y) {
    // Centralize via Utils.inBounds; no local fallback
    const U = modHandle("Utils");
    if (U && typeof U.inBounds === "function") {
      return !!U.inBounds(getCtx(), x, y);
    }
    return false;
  }

  
  

  

  function isWalkable(x, y) {
    // Centralize via Utils.isWalkableTile; no local fallback
    const U = modHandle("Utils");
    if (U && typeof U.isWalkableTile === "function") {
      return !!U.isWalkableTile(getCtx(), x, y);
    }
    return false;
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

    // In overworld, visible/seen are fully true; only recompute when mode or map shape changed.
    // This avoids re-filling arrays on every movement turn.
    if (mode === "world" && !modeChanged && !mapChanged) {
      _lastPlayerX = player.x; _lastPlayerY = player.y;
      _lastFovRadius = fovRadius; _lastMode = mode;
      _lastMapCols = cols; _lastMapRows = rows;
      return;
    }
    // Non-world: skip recompute when nothing relevant changed.
    if (!modeChanged && !mapChanged && !fovChanged && !moved) {
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
      region,
      npcs,
      shops,
      townProps,
      townBuildings,
      townExitAt,
      enemyColor: (t) => enemyColor(t),
      time: getClock(),
      // GameLoop can measure draw time and report via this sink
      onDrawMeasured: (ms) => { PERF.lastDrawMs = ms; },
    };
  }

  // Batch multiple draw requests within a frame to avoid redundant renders.
  let _drawQueued = false;
  let _rafId = null;

  // Simple perf counters (DEV-only visible in console) + EMA smoothing
  const PERF = { lastTurnMs: 0, lastDrawMs: 0, avgTurnMs: 0, avgDrawMs: 0 };

  function requestDraw() {
    const GL = modHandle("GameLoop");
    if (GL && typeof GL.requestDraw === "function") {
      GL.requestDraw();
      return;
    }
    const R = modHandle("Render");
    if (R && typeof R.draw === "function") {
      const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      R.draw(getRenderCtx());
      const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      PERF.lastDrawMs = t1 - t0;
      // EMA smoothing for draw time
      try {
        const a = 0.35; // smoothing factor
        if (typeof PERF.avgDrawMs !== "number" || PERF.avgDrawMs === 0) PERF.avgDrawMs = PERF.lastDrawMs;
        else PERF.avgDrawMs = (a * PERF.lastDrawMs) + ((1 - a) * PERF.avgDrawMs);
      } catch (_) {}
      try { if (window.DEV) console.debug(`[PERF] draw ${PERF.lastDrawMs.toFixed(2)}ms (avg ${PERF.avgDrawMs.toFixed(2)}ms)`); } catch (_) {}
    }
  }

  

  

  function initWorld() {
    // Prefer WorldRuntime.generate to centralize world setup
    const WR = modHandle("WorldRuntime");
    if (WR && typeof WR.generate === "function") {
      const ctx = getCtx();
      const ok = WR.generate(ctx, { width: MAP_COLS, height: MAP_ROWS });
      if (ok) {
        // Sync back any mutated references from ctx
        syncFromCtx(ctx);
        // Orchestrator schedules a single draw after world init
        requestDraw();
        return;
      }
      // Fall through to legacy path if WorldRuntime signaled failure
    }

    // Legacy path
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
    {
      // Delegate town exit button visibility via TownRuntime
      const TR = modHandle("TownRuntime");
      if (TR && typeof TR.hideExitButton === "function") TR.hideExitButton(getCtx());
    }
    requestDraw();
  }

  

  

  // Town shops helpers routed via ShopService (delegated)
  function isShopOpenNow(shop = null) {
    const SS = modHandle("ShopService");
    if (SS && typeof SS.isShopOpenNow === "function") {
      return SS.isShopOpenNow(getCtx(), shop || null);
    }
    return false;
  }
  function shopScheduleStr(shop) {
    const SS = modHandle("ShopService");
    if (SS && typeof SS.shopScheduleStr === "function") {
      return SS.shopScheduleStr(shop);
    }
    return "";
  }
  function minutesUntil(hourTarget /*0-23*/, minuteTarget = 0) {
    return TS.minutesUntil(turnCounter, hourTarget, minuteTarget);
  }
  function advanceTimeMinutes(mins) {
    turnCounter = TS.advanceMinutes(turnCounter, mins);
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
    region = ctx.region || region;
    townExitAt = ctx.townExitAt || townExitAt;
    dungeonExitAt = ctx.dungeonExitAt || dungeonExitAt;
    currentDungeon = ctx.dungeon || ctx.dungeonInfo || currentDungeon;
    if (typeof ctx.floor === "number") { floor = (ctx.floor | 0); }
  }

  // Helper: apply ctx sync and refresh visuals/UI in one place
  function applyCtxSyncAndRefresh(ctx) {
    syncFromCtx(ctx);
    updateCamera();
    recomputeFOV();
    updateUI();
    requestDraw();
  }

  

  function enterTownIfOnTile() {
    const M = modHandle("Modes");
    if (M && typeof M.enterTownIfOnTile === "function") {
      const ctx = getCtx();
      const ok = !!M.enterTownIfOnTile(ctx);
      if (ok) {
        // Invalidate cache then centralize sync/refresh
        _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
        applyCtxSyncAndRefresh(ctx);
        // Show Town Exit button via TownRuntime
        try {
          const TR = modHandle("TownRuntime");
          if (TR && typeof TR.showExitButton === "function") TR.showExitButton(getCtx());
        } catch (_) {}
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
        _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
        applyCtxSyncAndRefresh(ctx);
      }
      return ok;
    }
    return false;
  }

  function leaveTownNow() {
    const M = modHandle("Modes");
    if (M && typeof M.leaveTownNow === "function") {
      const ctx = getCtx();
      M.leaveTownNow(ctx);
      // Sync mutated ctx back into local state, then center camera and refresh
      syncFromCtx(ctx);
      updateCamera();
      recomputeFOV();
      updateUI();
      requestDraw();
      return;
    }
  }

  function requestLeaveTown() {
    const M = modHandle("Modes");
    if (M && typeof M.requestLeaveTown === "function") {
      M.requestLeaveTown(getCtx());
    }
  }

  function returnToWorldFromTown() {
    if (mode !== "town" || !world) return false;
    const ctx = getCtx();
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.returnToWorldIfAtGate === "function") {
      const ok = !!TR.returnToWorldIfAtGate(ctx);
      if (ok) {
        // Sync mutated ctx references into local state, then center camera on player
        syncFromCtx(ctx);
        updateCamera();
        recomputeFOV();
        updateUI();
        requestDraw();
        return true;
      }
    }
    // Fallback: if standing at the gate, leave via TownRuntime/Modes
    if (townExitAt && player.x === townExitAt.x && player.y === townExitAt.y) {
      // Prefer TownRuntime.applyLeaveSync to ensure camera centering under ctx state
      if (TR && typeof TR.applyLeaveSync === "function") {
        TR.applyLeaveSync(ctx);
        // Sync mutated ctx and refresh camera/FOV/UI against new world map
        syncFromCtx(ctx);
        updateCamera();
        recomputeFOV();
        updateUI();
        requestDraw();
        return true;
      }
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
        applyCtxSyncAndRefresh(ctx);
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

    // Prefer ctx-first Actions module
    {
      const A = modHandle("Actions");
      if (A && typeof A.doAction === "function") {
        const ctxMod = getCtx();
        const handled = A.doAction(ctxMod);
        if (handled) {
          applyCtxSyncAndRefresh(ctxMod);
          return;
        }
      }
    }

    if (mode === "world") {
      if (!enterTownIfOnTile()) {
        if (!enterDungeonIfOnEntrance()) {
          // Open Region map when pressing G on a walkable overworld tile
          const RM = modHandle("RegionMapRuntime");
          if (RM && typeof RM.open === "function") {
            const ctxMod = getCtx();
            const ok = !!RM.open(ctxMod);
            if (ok) {
              // Sync mutated ctx (mode -> "region") and refresh
              applyCtxSyncAndRefresh(ctxMod);
            }
          } else {
            log("Region map module not available.", "warn");
          }
        }
      }
      return;
    }

    if (mode === "town") {
      if (returnToWorldFromTown()) return;
      lootCorpse();
      return;
    }

    if (mode === "region") {
      const RM = modHandle("RegionMapRuntime");
      if (RM && typeof RM.onAction === "function") {
        const ctxMod = getCtx();
        const handled = !!RM.onAction(ctxMod);
        if (handled) {
          applyCtxSyncAndRefresh(ctxMod);
          return;
        }
      }
      return;
    }

    if (mode === "encounter") {
      const ctxMod = getCtx();
      // Check for a lootable container (corpse/chest) underfoot or adjacent with items
      let hasNearbyLoot = false;
      try {
        const p = ctxMod.player || player;
        const list = Array.isArray(ctxMod.corpses) ? ctxMod.corpses : [];
        for (const c of list) {
          if (!c) continue;
          const hasItems = Array.isArray(c.loot) && c.loot.length > 0;
          if (!hasItems) continue;
          const md = Math.abs((c.x|0) - (p.x|0)) + Math.abs((c.y|0) - (p.y|0));
          if (md <= 1) { hasNearbyLoot = true; break; }
        }
      } catch (_) {}

      if (hasNearbyLoot) {
        const DR = modHandle("DungeonRuntime");
        if (DR && typeof DR.lootHere === "function") {
          DR.lootHere(ctxMod);
          applyCtxSyncAndRefresh(ctxMod);
          return;
        }
      }

      // No lootable container nearby: treat G as withdraw/leave
      const ER = modHandle("EncounterRuntime");
      if (ER && typeof ER.complete === "function") {
        ER.complete(ctxMod, "withdraw");
        applyCtxSyncAndRefresh(ctxMod);
        return;
      }
      return;
    }

    if (mode === "dungeon") {
      lootCorpse();
      return;
    }

    lootCorpse();
  }

  function descendIfPossible() {
    {
      const A = modHandle("Actions");
      if (A && typeof A.descend === "function") {
        const handled = A.descend(getCtx());
        if (handled) return;
      }
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

  // Defensive stance: Brace for one turn (dungeon mode).
  // Increases block chance for the current turn if holding a defensive hand item (any hand item with def > 0).
  function brace() {
    if (isDead) return;
    if (mode !== "dungeon") {
      log("You can brace only in the dungeon.", "info");
      return;
    }
    const eq = player.equipment || {};
    const hasDefHand = !!((eq.left && typeof eq.left.def === "number" && eq.left.def > 0) || (eq.right && typeof eq.right.def === "number" && eq.right.def > 0));
    if (!hasDefHand) {
      log("You raise your arms, but without a defensive hand item bracing is ineffective.", "warn");
      // Still consume the turn to avoid free actions if desired
      turn();
      return;
    }
    player.braceTurns = 1;
    log("You brace behind your shield. Your block is increased this turn.", "notice");
    turn();
  }

  function setupInput() {
    const I = modHandle("Input");
    if (I && typeof I.init === "function") {
      I.init({
        // state queries
        isDead: () => isDead,
        isInventoryOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isInventoryOpen === "function") return !!UB.isInventoryOpen();
          } catch (_) {}
          return false;
        },
        isLootOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isLootOpen === "function") return !!UB.isLootOpen();
          } catch (_) {}
          return false;
        },
        isGodOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isGodOpen === "function") return !!UB.isGodOpen();
          } catch (_) {}
          return false;
        },
        // Ensure shop modal is part of the modal stack priority
        isShopOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isShopOpen === "function") return !!UB.isShopOpen();
          } catch (_) {}
          return false;
        },
        // Smoke config modal priority after Shop
        isSmokeOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isSmokeOpen === "function") return !!UB.isSmokeOpen();
          } catch (_) {}
          return false;
        },
        // Confirm dialog gating
        isConfirmOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isConfirmOpen === "function") return !!UB.isConfirmOpen();
          } catch (_) {}
          return false;
        },
        // actions
        onRestart: () => restartGame(),
        onShowInventory: () => showInventoryPanel(),
        onHideInventory: () => hideInventoryPanel(),
        onHideLoot: () => hideLootPanel(),
        onHideGod: () => {
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isGodOpen === "function") wasOpen = !!UB.isGodOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.hideGod === "function") UB.hideGod(getCtx());
          } catch (_) {}
          if (wasOpen) requestDraw();
        },
        onHideShop: () => {
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isShopOpen === "function") wasOpen = !!UB.isShopOpen();
          } catch (_) {}
          if (UB && typeof UB.hideShop === "function") {
            UB.hideShop(getCtx());
            if (wasOpen) requestDraw();
          }
        },
        onHideSmoke: () => {
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isSmokeOpen === "function") wasOpen = !!UB.isSmokeOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.hideSmoke === "function") UB.hideSmoke(getCtx());
          } catch (_) {}
          if (wasOpen) requestDraw();
        },
        onCancelConfirm: () => {
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isConfirmOpen === "function") wasOpen = !!UB.isConfirmOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.cancelConfirm === "function") UB.cancelConfirm(getCtx());
          } catch (_) {}
          if (wasOpen) requestDraw();
        },
        onShowGod: () => {
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isGodOpen === "function") wasOpen = !!UB.isGodOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.showGod === "function") UB.showGod(getCtx());
          } catch (_) {}
          const UIH = modHandle("UI");
          if (UIH && typeof UIH.setGodFov === "function") UIH.setGodFov(fovRadius);
          if (!wasOpen) requestDraw();
        },
        // Region Map
        isRegionMapOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isRegionMapOpen === "function") return !!UB.isRegionMapOpen();
          } catch (_) {}
          return false;
        },
        onShowRegionMap: () => {
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isRegionMapOpen === "function") wasOpen = !!UB.isRegionMapOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.showRegionMap === "function") UB.showRegionMap(getCtx());
          } catch (_) {}
          if (!wasOpen) requestDraw();
        },
        onHideRegionMap: () => {
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isRegionMapOpen === "function") wasOpen = !!UB.isRegionMapOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.hideRegionMap === "function") UB.hideRegionMap(getCtx());
          } catch (_) {}
          if (wasOpen) requestDraw();
        },
        onMove: (dx, dy) => tryMovePlayer(dx, dy),
        onWait: () => turn(),
        onLoot: () => doAction(),
        onDescend: () => descendIfPossible(),
        onBrace: () => brace(),
        adjustFov: (delta) => adjustFov(delta),
      });
    }
  }
          
  
  // Visual: add or strengthen a blood decal at tile (x,y)
  function addBloodDecal(x, y, mult = 1.0) {
    // Prefer Decals module
    const DC = modHandle("Decals");
    if (DC && typeof DC.add === "function") {
      DC.add(getCtx(), x, y, mult);
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

    // REGION MAP MODE (overlay): move cursor only, no time advance
    if (mode === "region") {
      const RM = modHandle("RegionMapRuntime");
      if (RM && typeof RM.tryMove === "function") {
        const ok = !!RM.tryMove(getCtx(), dx, dy);
        if (ok) return;
      }
      return;
    }

    // WORLD MODE
    if (mode === "world") {
      const WR = modHandle("WorldRuntime");
      if (WR && typeof WR.tryMovePlayerWorld === "function") {
        const ok = !!WR.tryMovePlayerWorld(getCtx(), dx, dy);
        if (ok) return;
      }
      // Fallback: direct world map walk if runtime didn't handle
      const nx = player.x + dx;
      const ny = player.y + dy;
      const wmap = world && world.map ? world.map : null;
      if (!wmap) return;
      const rows = wmap.length, cols = rows ? (wmap[0] ? wmap[0].length : 0) : 0;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
      const W = modHandle("World");
      const walkable = (W && typeof W.isWalkable === "function") ? !!W.isWalkable(wmap[ny][nx]) : true;
      if (walkable) {
        player.x = nx; player.y = ny;
        updateCamera();
        // Encounter roll before advancing time so acceptance can switch mode first
        try {
          const ES = modHandle("EncounterService");
          if (ES && typeof ES.maybeTryEncounter === "function") {
            ES.maybeTryEncounter(getCtx());
          }
        } catch (_) {}
        turn();
      }
      return;
    }

    // ENCOUNTER MODE
    if (mode === "encounter") {
      // Keep encounter input path identical to dungeon: delegate to DungeonRuntime.tryMoveDungeon,
      // then handle encounter-specific exit on STAIRS.
      const DR = modHandle("DungeonRuntime");
      const ctxMod = getCtx();
      if (DR && typeof DR.tryMoveDungeon === "function") {
        const acted = !!DR.tryMoveDungeon(ctxMod, dx, dy); // in encounter mode it does NOT call ctx.turn()
        if (acted) {
          // If we stepped onto an exit tile in encounter, withdraw immediately (dungeon uses returnToWorld, we use Encounter.complete)
          try {
            if (ctxMod.inBounds && ctxMod.inBounds(ctxMod.player.x, ctxMod.player.y)) {
              const here = ctxMod.map[ctxMod.player.y][ctxMod.player.x];
              if (here === ctxMod.TILES.STAIRS) {
                const ER = modHandle("EncounterRuntime");
                if (ER && typeof ER.complete === "function") {
                  ER.complete(ctxMod, "withdraw");
                }
              }
            }
          } catch (_) {}
          // Sync any mode/map changes and then advance the turn so AI/status run on synchronized state
          applyCtxSyncAndRefresh(ctxMod);
          turn();
          return;
        }
      }
      // Fallback: minimal dungeon-like movement
      const nx = player.x + dx;
      const ny = player.y + dy;
      if (!inBounds(nx, ny)) return;
      const blockedByEnemy = (occupancy && typeof occupancy.hasEnemy === "function") ? occupancy.hasEnemy(nx, ny) : enemies.some(e => e && e.x === nx && e.y === ny);
      if (isWalkable(nx, ny) && !blockedByEnemy) {
        player.x = nx;
        player.y = ny;
        updateCamera();
        turn();
      }
      return;
    }

    // TOWN MODE
    if (mode === "town") {
      const TR = modHandle("TownRuntime");
      if (TR && typeof TR.tryMoveTown === "function") {
        const ok = !!TR.tryMoveTown(getCtx(), dx, dy);
        if (ok) return;
      }
      // Fallback: minimal town movement and bump-talk
      const nx = player.x + dx;
      const ny = player.y + dy;
      if (!inBounds(nx, ny)) return;
      const npcBlocked = (occupancy && typeof occupancy.hasNPC === "function") ? occupancy.hasNPC(nx, ny) : npcs.some(n => n.x === nx && n.y === ny);
      if (npcBlocked) {
        const TR2 = modHandle("TownRuntime");
        if (TR2 && typeof TR2.talk === "function") {
          TR2.talk(getCtx());
        } else {
          log("Excuse me!", "info");
          // Pure log; no canvas redraw needed
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

    // DUNGEON MODE
    {
      const DR = modHandle("DungeonRuntime");
      if (DR && typeof DR.tryMoveDungeon === "function") {
        const ok = !!DR.tryMoveDungeon(getCtx(), dx, dy);
        if (ok) return;
      }
    }
    // Fallback: minimal dungeon movement into walkable, empty tiles
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (!inBounds(nx, ny)) return;
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

  
  

  function lootCorpse() {
    if (isDead) return;

    // Prefer ctx-first Actions module for all interaction/loot flows across modes
    {
      const A = modHandle("Actions");
      if (A && typeof A.loot === "function") {
        const ctxMod = getCtx();
        const handled = A.loot(ctxMod);
        if (handled) {
          applyCtxSyncAndRefresh(ctxMod);
          return;
        }
      }
    }

    // Dungeon-only fallback: loot ground or guide user
    if (mode === "dungeon") {
      const DR = modHandle("DungeonRuntime");
      if (DR && typeof DR.lootHere === "function") {
        DR.lootHere(getCtx());
        return;
      }
      {
        const L = modHandle("Loot");
        if (L && typeof L.lootHere === "function") {
          L.lootHere(getCtx());
          return;
        }
      }
      log("Return to the entrance (the hole '>') and press G to leave.", "info");
      // Pure guidance; canvas unchanged -> no redraw
      return;
    }

    // World/town default
    log("Nothing to do here.");
  }

  function showLootPanel(list) {
    const UB = modHandle("UIBridge");
    let wasOpen = false;
    try {
      if (UB && typeof UB.isLootOpen === "function") wasOpen = !!UB.isLootOpen();
    } catch (_) {}
    if (UB && typeof UB.showLoot === "function") {
      UB.showLoot(getCtx(), list);
      if (!wasOpen) requestDraw();
    }
  }

  function hideLootPanel() {
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.hideLoot === "function") {
      let wasOpen = true;
      try { if (typeof UB.isLootOpen === "function") wasOpen = !!UB.isLootOpen(); } catch (_) {}
      UB.hideLoot(getCtx());
      if (wasOpen) requestDraw();
    }
  }

  
  // GOD mode actions (delegated to GodControls)
  function godHeal() {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.heal === "function") { GC.heal(() => getCtx()); return; }
    const G = modHandle("God");
    if (G && typeof G.heal === "function") { G.heal(getCtx()); return; }
    log("GOD: heal not available.", "warn");
  }

  function godSpawnStairsHere() {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.spawnStairsHere === "function") { GC.spawnStairsHere(() => getCtx()); return; }
    const G = modHandle("God");
    if (G && typeof G.spawnStairsHere === "function") { G.spawnStairsHere(getCtx()); return; }
    log("GOD: spawnStairsHere not available.", "warn");
  }

  function godSpawnItems(count = 3) {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.spawnItems === "function") { GC.spawnItems(() => getCtx(), count); return; }
    const G = modHandle("God");
    if (G && typeof G.spawnItems === "function") { G.spawnItems(getCtx(), count); return; }
    log("GOD: spawnItems not available.", "warn");
  }

  function godSpawnEnemyNearby(count = 1) {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.spawnEnemyNearby === "function") { GC.spawnEnemyNearby(() => getCtx(), count); return; }
    const G = modHandle("God");
    if (G && typeof G.spawnEnemyNearby === "function") { G.spawnEnemyNearby(getCtx(), count); return; }
    log("GOD: spawnEnemyNearby not available.", "warn");
  }

  
  function renderInventoryPanel() {
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
  }

  function showInventoryPanel() {
    const UB = modHandle("UIBridge");
    let wasOpen = false;
    try {
      if (UB && typeof UB.isInventoryOpen === "function") wasOpen = !!UB.isInventoryOpen();
    } catch (_) {}
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.show === "function") {
      IC.show(getCtx());
    } else {
      renderInventoryPanel();
      if (UB && typeof UB.showInventory === "function") {
        UB.showInventory(getCtx());
      }
    }
    if (!wasOpen) requestDraw();
  }

  function hideInventoryPanel() {
    const UB = modHandle("UIBridge");
    let wasOpen = false;
    try {
      if (UB && typeof UB.isInventoryOpen === "function") wasOpen = !!UB.isInventoryOpen();
    } catch (_) {}
    const IC = modHandle("InventoryController");
    if (IC && typeof IC.hide === "function") {
      IC.hide(getCtx());
      if (wasOpen) requestDraw();
      return;
    }
    if (UB && typeof UB.hideInventory === "function") {
      UB.hideInventory(getCtx());
      if (wasOpen) requestDraw();
      return;
    }
    if (wasOpen) requestDraw();
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
        renderInventory: () => rerenderInventoryIfOpen(),
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
        renderInventory: () => rerenderInventoryIfOpen(),
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
        renderInventory: () => rerenderInventoryIfOpen(),
      });
      return;
    }
    log("Equip system not available.", "warn");
  }

  

  function showGameOver() {
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.showGameOver === "function") {
      UB.showGameOver(getCtx());
      requestDraw();
    }
  }

  // GOD: always-crit toggle (delegated)
  function setAlwaysCrit(v) {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.setAlwaysCrit === "function") { GC.setAlwaysCrit(() => getCtx(), v); alwaysCrit = !!v; return; }
    const G = modHandle("God");
    if (G && typeof G.setAlwaysCrit === "function") { G.setAlwaysCrit(getCtx(), v); alwaysCrit = !!v; return; }
    log("GOD: setAlwaysCrit not available.", "warn");
  }

  // GOD: set forced crit body part for player attacks (delegated)
  function setCritPart(part) {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.setCritPart === "function") { GC.setCritPart(() => getCtx(), part); forcedCritPart = part; return; }
    const G = modHandle("God");
    if (G && typeof G.setCritPart === "function") { G.setCritPart(getCtx(), part); forcedCritPart = part; return; }
    log("GOD: setCritPart not available.", "warn");
  }

  // GOD: apply a deterministic RNG seed and regenerate current map (delegated)
  function applySeed(seedUint32) {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.applySeed === "function") {
      const ctx = getCtx();
      GC.applySeed(() => getCtx(), seedUint32);
      rng = ctx.rng || rng;
      syncFromCtx(ctx);
      updateCamera();
      recomputeFOV();
      updateUI();
      requestDraw();
      return;
    }
    const G = modHandle("God");
    if (G && typeof G.applySeed === "function") {
      const ctx = getCtx();
      G.applySeed(ctx, seedUint32);
      rng = ctx.rng || rng;
      syncFromCtx(ctx);
      updateCamera();
      recomputeFOV();
      updateUI();
      requestDraw();
      return;
    }
    log("GOD: applySeed not available.", "warn");
  }

  // GOD: reroll seed using current time (delegated)
  function rerollSeed() {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.rerollSeed === "function") {
      const ctx = getCtx();
      GC.rerollSeed(() => getCtx());
      rng = ctx.rng || rng;
      syncFromCtx(ctx);
      updateCamera();
      recomputeFOV();
      updateUI();
      requestDraw();
      return;
    }
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
    log("GOD: rerollSeed not available.", "warn");
  }

  function hideGameOver() {
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.hideGameOver === "function") {
      UB.hideGameOver(getCtx());
    }
  }

  function restartGame() {
    hideGameOver();
    floor = 1;
    isDead = false;
    // Reset player using Player defaults when available; clear transient effects
    try {
      const P = modHandle("Player");
      if (P && typeof P.resetFromDefaults === "function") {
        P.resetFromDefaults(player);
      }
      if (player) { player.bleedTurns = 0; player.dazedTurns = 0; }
    } catch (_) {}
    mode = "world";
    initWorld();
  }

  
  function gainXP(amount) {
    const P = modHandle("Player");
    if (P && typeof P.gainXP === "function") {
      P.gainXP(player, amount, { log, updateUI });
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
    // Prefer centralized DungeonRuntime to handle loot, occupancy, XP, and persistence
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.killEnemy === "function") {
      const ctx = getCtx();
      DR.killEnemy(ctx, enemy);
      syncFromCtx(ctx);
      return;
    }
    // Minimal fallback: announce death, add corpse without loot, clear enemy, award XP
    const name = capitalize(enemy.type || "enemy");
    log(`${name} dies.`, "bad");
    corpses.push({ x: enemy.x, y: enemy.y, loot: [], looted: true });
    enemies = enemies.filter(e => e !== enemy);
    try {
      if (occupancy && typeof occupancy.clearEnemy === "function") {
        occupancy.clearEnemy(enemy.x, enemy.y);
      }
    } catch (_) {}
    gainXP(enemy.xp || 5);
  }

  
  function updateUI() {
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.updateStats === "function") {
      UB.updateStats(getCtx());
    }
  }


  
  

  

  

  
  

  
  function turn() {
    if (isDead) return;

    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

    // Advance global time (centralized via TimeService)
    turnCounter = TS.tick(turnCounter);



    if (mode === "dungeon") {
      const DR = modHandle("DungeonRuntime");
      if (DR && typeof DR.tick === "function") {
        DR.tick(getCtx());
      }
    } else if (mode === "town") {
      const TR = modHandle("TownRuntime");
      if (TR && typeof TR.tick === "function") {
        TR.tick(getCtx());
      }
    } else if (mode === "world") {
      const WR = modHandle("WorldRuntime");
      if (WR && typeof WR.tick === "function") {
        WR.tick(getCtx());
      }
    } else if (mode === "encounter") {
      const ER = modHandle("EncounterRuntime");
      if (ER && typeof ER.tick === "function") {
        const ctxMod = getCtx();
        ER.tick(ctxMod);
        // Sync any mode change triggered by encounter completion (victory/withdraw)
        applyCtxSyncAndRefresh(ctxMod);
      }
    } else if (mode === "region") {
      const RM = modHandle("RegionMapRuntime");
      if (RM && typeof RM.tick === "function") {
        RM.tick(getCtx());
      }
    }

    recomputeFOV();
    updateUI();
    requestDraw();

    // If external modules mutated ctx.mode/map (e.g., EncounterRuntime.complete), sync orchestrator state
    try {
      const cPost = getCtx();
      if (cPost && cPost.mode !== mode) {
        applyCtxSyncAndRefresh(cPost);
      }
    } catch (_) {}

    const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    PERF.lastTurnMs = t1 - t0;
    // EMA smoothing for turn time
    try {
      const a = 0.35; // smoothing factor
      if (typeof PERF.avgTurnMs !== "number" || PERF.avgTurnMs === 0) PERF.avgTurnMs = PERF.lastTurnMs;
      else PERF.avgTurnMs = (a * PERF.lastTurnMs) + ((1 - a) * PERF.avgTurnMs);
    } catch (_) {}
    try { if (window.DEV) console.debug(`[PERF] turn ${PERF.lastTurnMs.toFixed(2)}ms (avg ${PERF.avgTurnMs.toFixed(2)}ms)`); } catch (_) {}
  }
  
  
  
  {
    const UIH = modHandle("UI");
    if (UIH && typeof UIH.init === "function") {
      UIH.init();
      if (typeof UIH.setHandlers === "function") {
        UIH.setHandlers({
          onEquip: (idx) => equipItemByIndex(idx),
          onEquipHand: (idx, hand) => equipItemByIndexHand(idx, hand),
          onUnequip: (slot) => unequipSlot(slot),
          onDrink: (idx) => drinkPotionByIndex(idx),
          onRestart: () => restartGame(),
          onWait: () => turn(),
          onGodHeal: () => godHeal(),
          onGodSpawn: () => godSpawnItems(),
          onGodSetFov: (v) => setFovRadius(v),
          onGodToggleGrid: (v) => { drawGridPref = !!v; requestDraw(); },
          onGodSpawnEnemy: () => godSpawnEnemyNearby(),
          onGodSpawnStairs: () => godSpawnStairsHere(),
          onGodSetAlwaysCrit: (v) => setAlwaysCrit(v),
          onGodSetCritPart: (part) => setCritPart(part),
          onGodApplySeed: (seed) => applySeed(seed),
          onGodRerollSeed: () => rerollSeed(),
          onTownExit: () => requestLeaveTown(),
          // Panels for ESC-close default behavior
          isShopOpen: () => {
            // Prefer UIBridge single-source gating
            try {
              const UB = modHandle("UIBridge");
              if (UB && typeof UB.isShopOpen === "function") return !!UB.isShopOpen();
            } catch (_) {}
            return false;
          },
          onHideShop: () => {
            const UB = modHandle("UIBridge");
            let wasOpen = false;
            try {
              if (UB && typeof UB.isShopOpen === "function") wasOpen = !!UB.isShopOpen();
            } catch (_) {}
            if (UB && typeof UB.hideShop === "function") {
              UB.hideShop(getCtx());
              if (wasOpen) requestDraw();
            }
          },
          onGodCheckHomes: () => {
            const ctx = getCtx();
            if (ctx.mode !== "town") {
              log("Home route check is available in town mode only.", "warn");
              requestDraw();
              return;
            }
            // Ensure town NPCs are populated before running the check
            try {
              const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
              if ((!Array.isArray(ctx.npcs) || ctx.npcs.length === 0) && TAI && typeof TAI.populateTown === "function") {
                TAI.populateTown(ctx);
                // Sync back any mutations
                syncFromCtx(ctx);
                {
                  const TR = modHandle("TownRuntime");
                  if (TR && typeof TR.rebuildOccupancy === "function") {
                    TR.rebuildOccupancy(getCtx());
                  } else {
                    const OG = modHandle("OccupancyGrid");
                    if (OG && typeof OG.build === "function") {
                      occupancy = OG.build({ map, enemies, npcs, props: townProps, player });
                    }
                  }
                }
              }
            } catch (_) {}

            {
              const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
              if (TAI && typeof TAI.checkHomeRoutes === "function") {
                const res = TAI.checkHomeRoutes(ctx) || {};
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
            const rngSrc = (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") ? "RNG.service" : "mulberry32.fallback";
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
  }

  // Hand decay helpers
  function usingTwoHanded() {
    const eq = player.equipment || {};
    return eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded;
  }

  function decayAttackHands(light = false) {
    // Prefer centralized EquipmentDecay service
    const ED = modHandle("EquipmentDecay");
    if (ED && typeof ED.decayAttackHands === "function") {
      ED.decayAttackHands(player, rng, { twoHanded: usingTwoHanded(), light }, {
        log,
        updateUI,
        onInventoryChange: () => rerenderInventoryIfOpen(),
      });
      return;
    }
    // Fallback: local logic
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
    // Prefer centralized EquipmentDecay service
    const ED = modHandle("EquipmentDecay");
    if (ED && typeof ED.decayBlockingHands === "function") {
      ED.decayBlockingHands(player, rng, { twoHanded: usingTwoHanded() }, {
        log,
        updateUI,
        onInventoryChange: () => rerenderInventoryIfOpen(),
      });
      return;
    }
    // Fallback: local logic
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
    const IM = modHandle("InputMouse");
    if (IM && typeof IM.init === "function") {
      IM.init({
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
        isAnyModalOpen: () => {
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isAnyModalOpen === "function") return !!UB.isAnyModalOpen();
          } catch (_) {}
          return false;
        },
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

  // Ensure a redraw occurs once tiles.json finishes loading so JSON-only colors/glyphs apply
  try {
    if (typeof window !== "undefined" && window.GameData && window.GameData.ready && typeof window.GameData.ready.then === "function") {
      window.GameData.ready.then(() => {
        // Request a draw which will rebuild offscreen caches against the now-loaded tiles.json
        requestDraw();
      });
    }
  } catch (_) {}

  // Expose GameAPI via builder
  try {
    if (typeof window !== "undefined" && window.GameAPIBuilder && typeof window.GameAPIBuilder.create === "function") {
      window.GameAPI = window.GameAPIBuilder.create({
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
        // Mode transitions
        returnToWorldIfAtExit: () => returnToWorldIfAtExit(),
        returnToWorldFromTown: () => returnToWorldFromTown(),
        initWorld: () => initWorld(),
        // Encounter helper: enter and sync
        enterEncounter: (template, biome) => {
          const ER = modHandle("EncounterRuntime");
          if (ER && typeof ER.enter === "function") {
            const ctx = getCtx();
            const ok = ER.enter(ctx, { template, biome });
            if (ok) {
              applyCtxSyncAndRefresh(ctx);
            }
            return ok;
          }
          return false;
        },
        // Open Region Map at current overworld tile and sync orchestrator state
        openRegionMap: () => {
          const RM = modHandle("RegionMapRuntime");
          if (RM && typeof RM.open === "function") {
            const ctx = getCtx();
            const ok = !!RM.open(ctx);
            if (ok) {
              applyCtxSyncAndRefresh(ctx);
            }
            return ok;
          }
          return false;
        },
        // Start an encounter inside the active Region Map (ctx.mode === "region")
        startRegionEncounter: (template, biome) => {
          const ER = modHandle("EncounterRuntime");
          if (ER && typeof ER.enterRegion === "function") {
            const ctx = getCtx();
            const ok = !!ER.enterRegion(ctx, { template, biome });
            if (ok) {
              applyCtxSyncAndRefresh(ctx);
              // If the Region Map overlay modal is open, repaint it to show spawned enemies immediately
              try {
                const UB = modHandle("UIBridge");
                if (UB && typeof UB.isRegionMapOpen === "function" && UB.isRegionMapOpen() && typeof UB.showRegionMap === "function") {
                  UB.showRegionMap(ctx);
                }
              } catch (_) {}
            }
            return ok;
          }
          return false;
        },
        // GOD/helpers
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



// ESM exports for module consumers
export {
  getCtx,
  requestDraw,
  initWorld,
  generateLevel,
  tryMovePlayer,
  doAction,
  descendIfPossible,
  applySeed,
  rerollSeed,
  setFovRadius,
  updateUI
};
