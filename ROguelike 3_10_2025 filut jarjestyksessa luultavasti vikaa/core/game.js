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
  // Runtime configuration (loaded via GameData.config when available)
  const CFG = (typeof window !== "undefined" && window.GameData && window.GameData.config && typeof window.GameData.config === "object")
    ? window.GameData.config
    : null;

  const TILE = (CFG && CFG.viewport && typeof CFG.viewport.TILE === "number") ? CFG.viewport.TILE : 32;
  const COLS = (CFG && CFG.viewport && typeof CFG.viewport.COLS === "number") ? CFG.viewport.COLS : 30;
  const ROWS = (CFG && CFG.viewport && typeof CFG.viewport.ROWS === "number") ? CFG.viewport.ROWS : 20;
  
  const MAP_COLS = (CFG && CFG.world && typeof CFG.world.MAP_COLS === "number") ? CFG.world.MAP_COLS : 120;
  const MAP_ROWS = (CFG && CFG.world && typeof CFG.world.MAP_ROWS === "number") ? CFG.world.MAP_ROWS : 80;

  const FOV_DEFAULT = (CFG && CFG.fov && typeof CFG.fov.default === "number") ? CFG.fov.default : 8;
  const FOV_MIN = (CFG && CFG.fov && typeof CFG.fov.min === "number") ? CFG.fov.min : 3;
  const FOV_MAX = (CFG && CFG.fov && typeof CFG.fov.max === "number") ? CFG.fov.max : 14;
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
  // Time configuration from JSON when available
  const _CFG_DAY_MINUTES = (CFG && CFG.time && typeof CFG.time.dayMinutes === "number") ? CFG.time.dayMinutes : (24 * 60);
  const _CFG_CYCLE_TURNS = (CFG && CFG.time && typeof CFG.time.cycleTurns === "number") ? CFG.time.cycleTurns : 360;

  const TS = (typeof window !== "undefined" && window.TimeService && typeof window.TimeService.create === "function")
    ? window.TimeService.create({ dayMinutes: _CFG_DAY_MINUTES, cycleTurns: _CFG_CYCLE_TURNS })
    : (function () {
        const DAY_MINUTES = _CFG_DAY_MINUTES;
        const CYCLE_TURNS = _CFG_CYCLE_TURNS;
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

  // Palette override from JSON when available
  const PAL = (typeof window !== "undefined" && window.GameData && window.GameData.palette && typeof window.GameData.palette === "object")
    ? window.GameData.palette
    : null;

  const COLORS = {
    wall: (PAL && PAL.tiles && PAL.tiles.wall) || "#1b1f2a",
    wallDark: (PAL && PAL.tiles && PAL.tiles.wallDark) || "#131722",
    floor: (PAL && PAL.tiles && PAL.tiles.floor) || "#0f1320",
    floorLit: (PAL && PAL.tiles && PAL.tiles.floorLit) || "#0f1628",
    player: (PAL && PAL.entities && PAL.entities.player) || "#9ece6a",
    enemy: (PAL && PAL.entities && PAL.entities.enemyDefault) || "#f7768e",
    enemyGoblin: (PAL && PAL.entities && PAL.entities.goblin) || "#8bd5a0",
    enemyTroll: (PAL && PAL.entities && PAL.entities.troll) || "#e0af68",
    enemyOgre: (PAL && PAL.entities && PAL.entities.ogre) || "#f7768e",
    item: (PAL && PAL.entities && PAL.entities.item) || "#7aa2f7",
    corpse: (PAL && PAL.entities && PAL.entities.corpse) || "#c3cad9",
    corpseEmpty: (PAL && PAL.entities && PAL.entities.corpseEmpty) || "#6b7280",
    dim: (PAL && PAL.overlays && PAL.overlays.dim) || "rgba(13, 16, 24, 0.75)"
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
  // Encounter visuals
  let encounterProps = [];
  let encounterBiome = null;
  let encounterObjective = null;
  // Dungeon decorative props (e.g., wall torches)
  let dungeonProps = [];
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
  // GOD toggles (config-driven defaults with localStorage/window override)
  const AC_DEFAULT = (CFG && CFG.dev && typeof CFG.dev.alwaysCritDefault === "boolean") ? !!CFG.dev.alwaysCritDefault : false;
  const CP_DEFAULT = (CFG && CFG.dev && typeof CFG.dev.critPartDefault === "string") ? CFG.dev.critPartDefault : "";
  let alwaysCrit = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT === "boolean") ? !!window.ALWAYS_CRIT : AC_DEFAULT;
  let forcedCritPart = (typeof window !== "undefined" && typeof window.ALWAYS_CRIT_PART === "string")
    ? window.ALWAYS_CRIT_PART
    : (typeof localStorage !== "undefined" ? ((localStorage.getItem("ALWAYS_CRIT_PART") || CP_DEFAULT)) : CP_DEFAULT);
  // Render grid preference (ctx-first). Default from window.DRAW_GRID; UI toggle will update this.
  let drawGridPref = (typeof window !== "undefined" && typeof window.DRAW_GRID === "boolean") ? !!window.DRAW_GRID : true;

  
  function getCtx() {
    const base = {
      rng,
      ROWS, COLS, MAP_ROWS, MAP_COLS, TILE, TILES,
      player, enemies, corpses, decals, map, seen, visible, occupancy,
      // encounter visuals
      encounterProps, encounterBiome, encounterObjective,
      dungeonProps,
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
      // Fast-forward helper: run turns to simulate minutes (NPCs act each turn)
      fastForwardMinutes: (mins) => fastForwardMinutes(mins),
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
        // No fallback: enforce JSON-defined enemies only for clarity
        return null;
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
      // No fallback: enforce JSON-defined enemies only
      return null;
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
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.int === "function") {
        return window.RNGUtils.int(min, max, rng);
      }
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.RNG && typeof window.RNG.int === "function") return window.RNG.int(min, max);
    } catch (_) {}
    return Math.floor(rng() * (max - min + 1)) + min;
  };
  const chance = (p) => {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.chance === "function") {
        return window.RNGUtils.chance(p, rng);
      }
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.RNG && typeof window.RNG.chance === "function") return window.RNG.chance(p);
    } catch (_) {}
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
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.float === "function") {
        return window.RNGUtils.float(min, max, decimals, rng);
      }
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.RNG && typeof window.RNG.float === "function") return window.RNG.float(min, max, decimals);
    } catch (_) {}
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
    const clamped = Math.max(FOV_MIN, Math.min(FOV_MAX, r));
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
    // Prefer centralized InventoryFlow
    try {
      const IF = modHandle("InventoryFlow");
      if (IF && typeof IF.addPotionToInventory === "function") {
        IF.addPotionToInventory(getCtx(), heal, name);
        return;
      }
    } catch (_) {}
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
    // Prefer centralized InventoryFlow
    try {
      const IF = modHandle("InventoryFlow");
      if (IF && typeof IF.drinkPotionByIndex === "function") {
        IF.drinkPotionByIndex(getCtx(), idx);
        return;
      }
    } catch (_) {}
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
    if (!it || (it.kind !== "potion" && it.kind !== "drink")) return;

    const heal = it.heal ?? (it.kind === "drink" ? 2 : 3);
    const prev = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    const gained = player.hp - prev;
    const label = it.name ? it.name : (it.kind === "drink" ? "drink" : "potion");
    if (gained > 0) {
      log(`You drink ${label} and restore ${gained.toFixed(1)} HP (HP ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "good");
    } else {
      log(`You drink ${label} but feel no different (HP ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "warn");
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
        try {
          const ctx2 = getCtx();
          if (typeof window !== "undefined" && window.OccupancyFacade && typeof window.OccupancyFacade.rebuild === "function") {
            window.OccupancyFacade.rebuild(ctx2);
            occupancy = ctx2.occupancy || occupancy;
          } else {
            const TR = modHandle("TownRuntime");
            if (TR && typeof TR.rebuildOccupancy === "function") {
              TR.rebuildOccupancy(ctx2);
              occupancy = ctx2.occupancy || occupancy;
            } else {
              const OG = modHandle("OccupancyGrid");
              if (OG && typeof OG.build === "function") {
                occupancy = OG.build({ map, enemies, npcs, props: townProps, player });
              }
            }
          }
        } catch (_) {}
      }
      if (window.DEV) {
        try {
          const visCount = enemies.filter(e => inBounds(e.x, e.y) && visible[e.y][e.x]).length;
          log(`[DEV] Enemies spawned: ${enemies.length}, visible now: ${visCount}.`, "notice");
        } catch (_) {}
      }
      updateUI();
      {
        const MZ = modHandle("Messages");
        if (MZ && typeof MZ.log === "function") {
          MZ.log(getCtx(), "dungeon.explore");
        } else {
          log("You explore the dungeon.");
        }
      }
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
    {
      const MZ = modHandle("Messages");
      if (MZ && typeof MZ.log === "function") {
        MZ.log(getCtx(), "dungeon.explore");
      } else {
        log("You explore the dungeon.");
      }
    }
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
    // Centralize via Utils.inBounds; fallback to local map bounds
    const U = modHandle("Utils");
    if (U && typeof U.inBounds === "function") {
      return !!U.inBounds(getCtx(), x, y);
    }
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    return x >= 0 && y >= 0 && x < cols && y < rows;
  }

  
  

  

  function isWalkable(x, y) {
    // Centralize via Utils.isWalkableTile; fallback to tile-type check
    const U = modHandle("Utils");
    if (U && typeof U.isWalkableTile === "function") {
      return !!U.isWalkableTile(getCtx(), x, y);
    }
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
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
    // Prefer centralized GameFOV guard-based recompute
    try {
      const GF = modHandle("GameFOV");
      if (GF && typeof GF.recomputeWithGuard === "function") {
        // Ensure ctx carries current seen/visible references
        const ctx = getCtx();
        ctx.seen = seen;
        ctx.visible = visible;
        const did = !!GF.recomputeWithGuard(ctx);
        if (did) {
          visible = ctx.visible;
          seen = ctx.seen;
        }
        return;
      }
    } catch (_) {}

    // Legacy inline path
    const rows = map.length;
    const cols = map[0] ? map[0].length : 0;

    const moved = (player.x !== _lastPlayerX) || (player.y !== _lastPlayerY);
    const fovChanged = (fovRadius !== _lastFovRadius);
    const modeChanged = (mode !== _lastMode);
    const mapChanged = (rows !== _lastMapRows) || (cols !== _lastMapCols);

    if (!modeChanged && !mapChanged && !fovChanged && !moved) {
      return;
    }

    // Prefer centralized GameState ensuring grid shape
    try {
      if (typeof window !== "undefined" && window.GameState && typeof window.GameState.ensureVisibilityShape === "function") {
        window.GameState.ensureVisibilityShape(getCtx());
      } else {
        ensureVisibilityShape();
      }
    } catch (_) { ensureVisibilityShape(); }

    {
      const F = modHandle("FOV");
      if (F && typeof F.recomputeFOV === "function") {
        const ctx = getCtx();
        ctx.seen = seen;
        ctx.visible = visible;
        F.recomputeFOV(ctx);
        visible = ctx.visible;
        seen = ctx.seen;
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
    // Prefer centralized RenderOrchestration facade
    try {
      const RO = modHandle("RenderOrchestration");
      if (RO && typeof RO.getRenderCtx === "function") {
        const base = RO.getRenderCtx(getCtx());
        // Ensure PERF sink uses local PERF tracker
        try { base.onDrawMeasured = (ms) => { PERF.lastDrawMs = ms; }; } catch (_) {}
        return base;
      }
    } catch (_) {}
    // Fallback: inline context builder
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
      // encounter visuals for RenderDungeon
      encounterProps,
      encounterBiome,
      dungeonProps,
      enemyColor: (t) => enemyColor(t),
      time: getClock(),
      onDrawMeasured: (ms) => { PERF.lastDrawMs = ms; },
    };
  }

  // Batch multiple draw requests within a frame to avoid redundant renders.
  let _drawQueued = false;
  let _rafId = null;
  // Suppress draw flag used for fast-forward time (sleep/wait simulations)
  let _suppressDraw = false;

  // Simple perf counters (DEV-only visible in console) + EMA smoothing
  const PERF = { lastTurnMs: 0, lastDrawMs: 0, avgTurnMs: 0, avgDrawMs: 0 };
  // Hint cooldown to avoid spamming animal proximity logs
  let lastAnimalHintTurn = -100;

  function requestDraw() {
    if (_suppressDraw) return;
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
        // Ensure the camera is centered on the player before the first render
        try { updateCamera(); } catch (_) {}
        // Ensure FOV reflects the spawn position right away
        try { recomputeFOV(); } catch (_) {}
        try { updateUI(); } catch (_) {}
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
    // Clear lingering encounter visuals when returning to world
    encounterProps = [];
    encounterBiome = null;
    encounterObjective = null;
    npcs = [];   // no NPCs on overworld
    shops = [];  // no shops on overworld
    map = world.map;
    // fill seen/visible fully in world
    seen = Array.from({ length: map.length }, () => Array(map[0].length).fill(true));
    visible = Array.from({ length: map.length }, () => Array(map[0].length).fill(true));
    updateCamera();
    recomputeFOV();
    updateUI();
    {
      const MZ = modHandle("Messages");
      if (MZ && typeof MZ.log === "function") {
        MZ.log(getCtx(), "world.arrive");
      } else {
        log("You arrive in the overworld. Towns: small (t), big (T), cities (C). Dungeons (D). Press G on a town/dungeon tile to enter/exit.", "notice");
      }
    }
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
  // Run a number of turns equivalent to the given minutes so NPCs/AI act during time passage.
  function fastForwardMinutes(mins) {
    // Prefer centralized Movement facade
    try {
      const MV = modHandle("Movement");
      if (MV && typeof MV.fastForwardMinutes === "function") {
        return MV.fastForwardMinutes(getCtx(), mins);
      }
    } catch (_) {}
    const total = Math.max(0, (Number(mins) || 0) | 0);
    if (total <= 0) return 0;
    const turns = Math.max(1, Math.ceil(total / MINUTES_PER_TURN));
    _suppressDraw = true;
    for (let i = 0; i < turns; i++) {
      try { turn(); } catch (_) { break; }
    }
    _suppressDraw = false;
    recomputeFOV();
    updateUI();
    return turns;
  }

  
  

  

  function syncFromCtx(ctx) {
    if (!ctx) return;
    try {
      const SS = modHandle("StateSync");
      if (SS && typeof SS.applyLocal === "function") {
        SS.applyLocal(ctx, {
          setMode: (v) => { if (typeof v !== "undefined") mode = v; },
          setMap: (v) => { if (v) map = v; },
          setSeen: (v) => { if (v) seen = v; },
          setVisible: (v) => { if (v) visible = v; },
          setWorld: (v) => { if (typeof v !== "undefined") world = v; },
          setEnemies: (v) => { if (Array.isArray(v)) enemies = v; },
          setCorpses: (v) => { if (Array.isArray(v)) corpses = v; },
          setDecals: (v) => { if (Array.isArray(v)) decals = v; },
          setNpcs: (v) => { if (Array.isArray(v)) npcs = v; },
          setEncounterProps: (v) => { if (Array.isArray(v)) encounterProps = v; },
          setDungeonProps: (v) => { if (Array.isArray(v)) dungeonProps = v; },
          setEncounterBiome: (v) => { encounterBiome = v; },
          setEncounterObjective: (v) => { encounterObjective = v; },
          setShops: (v) => { if (Array.isArray(v)) shops = v; },
          setTownProps: (v) => { if (Array.isArray(v)) townProps = v; },
          setTownBuildings: (v) => { if (Array.isArray(v)) townBuildings = v; },
          setTownPlaza: (v) => { if (typeof v !== "undefined") townPlaza = v; },
          setTavern: (v) => { if (typeof v !== "undefined") tavern = v; },
          setWorldReturnPos: (v) => { if (typeof v !== "undefined") worldReturnPos = v; },
          setRegion: (v) => { if (typeof v !== "undefined") region = v; },
          setTownExitAt: (v) => { if (typeof v !== "undefined") townExitAt = v; },
          setDungeonExitAt: (v) => { if (typeof v !== "undefined") dungeonExitAt = v; },
          setDungeonInfo: (v) => { if (typeof v !== "undefined") currentDungeon = v; },
          setFloor: (v) => { if (typeof v === "number") floor = (v | 0); },
        });
        return;
      }
    } catch (_) {}
    // Fallback: direct assignment
    mode = ctx.mode || mode;
    map = ctx.map || map;
    seen = ctx.seen || seen;
    visible = ctx.visible || visible;
    world = ctx.world || world;
    enemies = Array.isArray(ctx.enemies) ? ctx.enemies : enemies;
    corpses = Array.isArray(ctx.corpses) ? ctx.corpses : corpses;
    decals = Array.isArray(ctx.decals) ? ctx.decals : decals;
    npcs = Array.isArray(ctx.npcs) ? ctx.npcs : npcs;
    encounterProps = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : encounterProps;
    dungeonProps = Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps : dungeonProps;
    if (Object.prototype.hasOwnProperty.call(ctx, "encounterBiome")) {
      encounterBiome = ctx.encounterBiome;
    }
    if (Object.prototype.hasOwnProperty.call(ctx, "encounterObjective")) {
      encounterObjective = ctx.encounterObjective;
    }
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
    // Prefer centralized StateSync apply+refresh, then GameState helper
    try {
      const SS = modHandle("StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(getCtx(), {
          // No-op sink here since sync already applied locally
        });
        return;
      }
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.GameState && typeof window.GameState.applySyncAndRefresh === "function") {
        window.GameState.applySyncAndRefresh(getCtx());
        return;
      }
    } catch (_) {}
    updateCamera();
    recomputeFOV();
    updateUI();
    requestDraw();
  }

  

  function enterTownIfOnTile() {
    // Prefer unified ModesTransitions facade
    try {
      const MT = modHandle("ModesTransitions");
      if (MT && typeof MT.enterTownIfOnTile === "function") {
        const ctx = getCtx();
        const ok = !!MT.enterTownIfOnTile(ctx);
        if (ok) {
          _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
          applyCtxSyncAndRefresh(ctx);
          try {
            const TR = modHandle("TownRuntime");
            if (TR && typeof TR.showExitButton === "function") TR.showExitButton(getCtx());
          } catch (_) {}
        }
        return ok;
      }
    } catch (_) {}

    const M = modHandle("Modes");
    if (M && typeof M.enterTownIfOnTile === "function") {
      const ctx = getCtx();
      const ok = !!M.enterTownIfOnTile(ctx);
      if (ok) {
        _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
        applyCtxSyncAndRefresh(ctx);
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
    // Prefer unified ModesTransitions facade
    try {
      const MT = modHandle("ModesTransitions");
      if (MT && typeof MT.enterDungeonIfOnEntrance === "function") {
        const ctx = getCtx();
        const ok = !!MT.enterDungeonIfOnEntrance(ctx);
        if (ok) {
          _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
          applyCtxSyncAndRefresh(ctx);
        }
        return ok;
      }
    } catch (_) {}

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
    // Prefer unified ModesTransitions facade
    try {
      const MT = modHandle("ModesTransitions");
      if (MT && typeof MT.leaveTownNow === "function") {
        const ctx = getCtx();
        MT.leaveTownNow(ctx);
        applyCtxSyncAndRefresh(ctx);
        return;
      }
    } catch (_) {}
    const M = modHandle("Modes");
    if (M && typeof M.leaveTownNow === "function") {
      const ctx = getCtx();
      M.leaveTownNow(ctx);
      applyCtxSyncAndRefresh(ctx);
      return;
    }
  }

  function requestLeaveTown() {
    try {
      const MT = modHandle("ModesTransitions");
      if (MT && typeof MT.requestLeaveTown === "function") {
        MT.requestLeaveTown(getCtx());
        return;
      }
    } catch (_) {}
    const M = modHandle("Modes");
    if (M && typeof M.requestLeaveTown === "function") {
      M.requestLeaveTown(getCtx());
    }
  }

  function returnToWorldFromTown() {
    if (mode !== "town" || !world) return false;
    // Prefer unified ModesTransitions facade
    try {
      const MT = modHandle("ModesTransitions");
      if (MT && typeof MT.returnToWorldFromTown === "function") {
        const ok = !!MT.returnToWorldFromTown(getCtx());
        if (ok) {
          applyCtxSyncAndRefresh(getCtx());
          return true;
        }
      }
    } catch (_) {}
    const ctx = getCtx();
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.returnToWorldIfAtGate === "function") {
      const ok = !!TR.returnToWorldIfAtGate(ctx);
      if (ok) {
        applyCtxSyncAndRefresh(ctx);
        return true;
      }
    }
    if (townExitAt && player.x === townExitAt.x && player.y === townExitAt.y) {
      if (TR && typeof TR.applyLeaveSync === "function") {
        TR.applyLeaveSync(ctx);
        applyCtxSyncAndRefresh(ctx);
        return true;
      }
    }
    {
      const MZ = modHandle("Messages");
      if (MZ && typeof MZ.log === "function") {
        MZ.log(getCtx(), "town.exitHint");
      } else {
        log("Return to the town gate to exit to the overworld.", "info");
      }
    }
    return false;
  }

  function returnToWorldIfAtExit() {
    try {
      const MT = modHandle("ModesTransitions");
      if (MT && typeof MT.returnToWorldIfAtExit === "function") {
        const ctx = getCtx();
        const ok = MT.returnToWorldIfAtExit(ctx);
        if (ok) {
          applyCtxSyncAndRefresh(ctx);
        }
        return ok;
      }
    } catch (_) {}
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
    // Toggle behavior: if Loot UI is open, close it and do nothing else (do not consume a turn)
    try {
      const UB = modHandle("UIBridge");
      if (UB && typeof UB.isLootOpen === "function" && UB.isLootOpen()) {
        hideLootPanel();
        return;
      }
    } catch (_) {}
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
      // Prefer local interactions/logs first so guidance hint doesn't drown them out
      lootCorpse();
      // Then, if standing on the gate, leave town (or show exit hint if applicable)
      if (returnToWorldFromTown()) return;
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
      // Loot/flavor when standing on any corpse/chest (even if already looted)
      try {
        const list = Array.isArray(ctxMod.corpses) ? ctxMod.corpses : [];
        const corpseHere = list.find(c => c && c.x === ctxMod.player.x && c.y === ctxMod.player.y);
        if (corpseHere) {
          const DR = modHandle("DungeonRuntime");
          if (DR && typeof DR.lootHere === "function") {
            DR.lootHere(ctxMod);
            applyCtxSyncAndRefresh(ctxMod);
            return;
          }
        }
      } catch (_) {}

      // No lootable container underfoot: only allow withdraw if standing on exit (stairs) tile
      try {
        if (ctxMod.inBounds && ctxMod.inBounds(ctxMod.player.x, ctxMod.player.y)) {
          const here = ctxMod.map[ctxMod.player.y][ctxMod.player.x];
          if (here === ctxMod.TILES.STAIRS) {
            const ER = modHandle("EncounterRuntime");
            if (ER && typeof ER.complete === "function") {
              ER.complete(ctxMod, "withdraw");
              applyCtxSyncAndRefresh(ctxMod);
              return;
            }
          }
        }
      } catch (_) {}

      // If standing on an encounter prop, interact or describe it (consistent with town prop messages)
      try {
        const props = Array.isArray(ctxMod.encounterProps) ? ctxMod.encounterProps : [];
        const p = props.find(pr => pr && pr.x === ctxMod.player.x && pr.y === ctxMod.player.y);
        if (p) {
          const type = String(p.type || "").toLowerCase();
          if (type === "captive") {
            // Rescue captive objective support
            if (ctxMod.encounterObjective && ctxMod.encounterObjective.type === "rescueTarget" && !ctxMod.encounterObjective.rescued) {
              ctxMod.encounterObjective.rescued = true;
              log("You free the captive! Now reach an exit (>) to leave.", "good");
            } else {
              log("You help the captive to their feet.", "info");
            }
          } else if (type === "barrel") log("You stand next to a barrel.", "info");
          else if (type === "crate") log("You stand next to a crate.", "info");
          else if (type === "bench") log("You stand next to a bench.", "info");
          else if (type === "campfire") {
            // Prompt to cook raw meat if available
            try {
              const UB = modHandle("UIBridge");
              // Count raw meat in inventory
              const inv = ctxMod.player.inventory || [];
              let rawMeatIdxs = [];
              let rawCount = 0;
              for (let i = 0; i < inv.length; i++) {
                const it = inv[i];
                if (!it || it.kind !== "material") continue;
                const nm = String(it.name || it.type || "").toLowerCase();
                if (nm === "meat") {
                  const amt = (it.amount | 0) || (it.count | 0) || 1;
                  rawCount += amt;
                  rawMeatIdxs.push(i);
                }
              }
              if (rawCount > 0) {
                const prompt = `You stand by a campfire. Cook ${rawCount} meat?`;
                const onOk = () => {
                  // Remove raw meat entries
                  let remaining = rawCount;
                  // Remove from largest stacks first
                  rawMeatIdxs.sort((a, b) => {
                    const aa = ((inv[a]?.amount | 0) || (inv[a]?.count | 0) || 1);
                    const bb = ((inv[b]?.amount | 0) || (inv[b]?.count | 0) || 1);
                    return bb - aa;
                  });
                  for (const idx of rawMeatIdxs) {
                    const it = inv[idx];
                    if (!it || remaining <= 0) continue;
                    const amt = (it.amount | 0) || (it.count | 0) || 1;
                    const take = Math.min(amt, remaining);
                    const left = amt - take;
                    if (typeof it.amount === "number") it.amount = left;
                    else if (typeof it.count === "number") it.count = left;
                    // remove entry if zero
                    if (((it.amount | 0) || (it.count | 0) || 0) <= 0) {
                      inv.splice(idx, 1);
                    }
                    remaining -= take;
                  }
                  // Add cooked meat stack
                  const cookedName = "meat (cooked)";
                  const existingCooked = inv.find(x => x && x.kind === "material" && String(x.name || x.type || "").toLowerCase() === cookedName);
                  if (existingCooked) {
                    if (typeof existingCooked.amount === "number") existingCooked.amount += rawCount;
                    else if (typeof existingCooked.count === "number") existingCooked.count += rawCount;
                    else existingCooked.amount = rawCount;
                  } else {
                    inv.push({ kind: "material", type: "meat_cooked", name: cookedName, amount: rawCount });
                  }
                  log(`You cook ${rawCount} meat into ${rawCount} meat (cooked).`, "good");
                  updateUI();
                  // Re-render inventory panel if open
                  try { const UB2 = modHandle("UIBridge"); if (UB2 && typeof UB2.renderInventory === "function") UB2.renderInventory(getCtx()); } catch (_) {}
                };
                const onCancel = () => {
                  log("You warm your hands by the fire.", "info");
                };
                if (UB && typeof UB.showConfirm === "function") {
                  UB.showConfirm(ctxMod, prompt, null, onOk, onCancel);
                } else {
                  // Fallback: immediate cook without UI
                  onOk();
                }
              } else {
                log("You stand by a campfire.", "info");
              }
            } catch (_) {
              log("You stand by a campfire.", "info");
            }
          }
          else if (type === "merchant") {
            try {
              const UB = modHandle("UIBridge");
              if (UB && typeof UB.showShop === "function") {
                UB.showShop(ctxMod, { name: p.name || "Merchant", vendor: p.vendor || "merchant" });
              } else {
                log("The merchant nods. (Trading UI not available)", "warn");
              }
            } catch (_) {}
          } else log(`You stand on ${p.name || p.type || "a prop"}.`, "info");
          applyCtxSyncAndRefresh(ctxMod);
          return;
        }
      } catch (_) {}

      // Otherwise, nothing to do here
      {
        const MZ = modHandle("Messages");
        if (MZ && typeof MZ.log === "function") {
          MZ.log(getCtx(), "encounter.exitHint");
        } else {
          log("Return to the exit (>) to leave this encounter.", "info");
        }
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
    const MV = modHandle("Movement");
    if (MV && typeof MV.descendIfPossible === "function") {
      MV.descendIfPossible(getCtx());
    }
  }

  // Defensive stance: Brace for one turn (dungeon mode).
  function brace() {
    const MV = modHandle("Movement");
    if (MV && typeof MV.brace === "function") {
      MV.brace(getCtx());
    }
  }

  function setupInput() {
    const I = modHandle("Input");
    if (I && typeof I.init === "function") {
      I.init({
        // state queries
        isDead: () => isDead,
        isInventoryOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isInventoryOpen === "function") return !!UIO.isInventoryOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isInventoryOpen === "function") return !!UB.isInventoryOpen();
          } catch (_) {}
          return false;
        },
        isLootOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isLootOpen === "function") return !!UIO.isLootOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isLootOpen === "function") return !!UB.isLootOpen();
          } catch (_) {}
          return false;
        },
        isGodOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isGodOpen === "function") return !!UIO.isGodOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isGodOpen === "function") return !!UB.isGodOpen();
          } catch (_) {}
          return false;
        },
        // Ensure shop modal is part of the modal stack priority
        isShopOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isShopOpen === "function") return !!UIO.isShopOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isShopOpen === "function") return !!UB.isShopOpen();
          } catch (_) {}
          return false;
        },
        // Smoke config modal priority after Shop
        isSmokeOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isSmokeOpen === "function") return !!UIO.isSmokeOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isSmokeOpen === "function") return !!UB.isSmokeOpen();
          } catch (_) {}
          return false;
        },
        // Sleep modal (Inn beds)
        isSleepOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isSleepOpen === "function") return !!UIO.isSleepOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isSleepOpen === "function") return !!UB.isSleepOpen();
          } catch (_) {}
          return false;
        },
        // Confirm dialog gating
        isConfirmOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isConfirmOpen === "function") return !!UIO.isConfirmOpen(getCtx());
          } catch (_) {}
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
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.hideGod === "function") { UIO.hideGod(getCtx()); return; }
          } catch (_) {}
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
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.hideShop === "function") { UIO.hideShop(getCtx()); return; }
          } catch (_) {}
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
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.hideSmoke === "function") { UIO.hideSmoke(getCtx()); return; }
          } catch (_) {}
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
        onHideSleep: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.hideSleep === "function") { UIO.hideSleep(getCtx()); return; }
          } catch (_) {}
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isSleepOpen === "function") wasOpen = !!UB.isSleepOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.hideSleep === "function") UB.hideSleep(getCtx());
          } catch (_) {}
          if (wasOpen) requestDraw();
        },
        onCancelConfirm: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.cancelConfirm === "function") { UIO.cancelConfirm(getCtx()); return; }
          } catch (_) {}
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
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.showGod === "function") { UIO.showGod(getCtx()); }
          } catch (_) {}
          const UIH = modHandle("UI");
          if (UIH && typeof UIH.setGodFov === "function") UIH.setGodFov(fovRadius);
        },
        // Region Map
        isRegionMapOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isRegionMapOpen === "function") return !!UIO.isRegionMapOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isRegionMapOpen === "function") return !!UB.isRegionMapOpen();
          } catch (_) {}
          return false;
        },
        onShowRegionMap: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.showRegionMap === "function") { UIO.showRegionMap(getCtx()); return; }
          } catch (_) {}
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
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.hideRegionMap === "function") { UIO.hideRegionMap(getCtx()); return; }
          } catch (_) {}
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
        // Help / Controls + Character Sheet (F1)
        isHelpOpen: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isHelpOpen === "function") return !!UIO.isHelpOpen(getCtx());
          } catch (_) {}
          try {
            const UB = modHandle("UIBridge");
            if (UB && typeof UB.isHelpOpen === "function") return !!UB.isHelpOpen();
          } catch (_) {}
          return false;
        },
        onShowHelp: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.showHelp === "function") { UIO.showHelp(getCtx()); return; }
          } catch (_) {}
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isHelpOpen === "function") wasOpen = !!UB.isHelpOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.showHelp === "function") UB.showHelp(getCtx());
          } catch (_) {}
          if (!wasOpen) requestDraw();
        },
        onHideHelp: () => {
          try {
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.hideHelp === "function") { UIO.hideHelp(getCtx()); return; }
          } catch (_) {}
          const UB = modHandle("UIBridge");
          let wasOpen = false;
          try {
            if (UB && typeof UB.isHelpOpen === "function") wasOpen = !!UB.isHelpOpen();
          } catch (_) {}
          try {
            if (UB && typeof UB.hideHelp === "function") UB.hideHelp(getCtx());
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
    // Centralized movement only
    const MV = modHandle("Movement");
    if (MV && typeof MV.tryMove === "function") {
      MV.tryMove(getCtx(), dx, dy);
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
    // Prefer centralized LootFlow
    try {
      const LF = modHandle("LootFlow");
      if (LF && typeof LF.loot === "function") {
        const ok = !!LF.loot(getCtx());
        if (ok) return;
      }
    } catch (_) {}
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
      return;
    }

    log("Nothing to do here.");
  }

  function showLootPanel(list) {
    // Prefer centralized LootFlow
    try {
      const LF = modHandle("LootFlow");
      if (LF && typeof LF.show === "function") {
        LF.show(getCtx(), list);
        return;
      }
    } catch (_) {}
    // Prefer centralized UI orchestration
    try {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.showLoot === "function") {
        UIO.showLoot(getCtx(), list);
        return;
      }
    } catch (_) {}
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
    // Prefer centralized LootFlow
    try {
      const LF = modHandle("LootFlow");
      if (LF && typeof LF.hide === "function") {
        LF.hide(getCtx());
        return;
      }
    } catch (_) {}
    // Prefer centralized UI orchestration
    try {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideLoot === "function") {
        UIO.hideLoot(getCtx());
        return;
      }
    } catch (_) {}
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
    // Prefer centralized UI orchestration
    try {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.renderInventory === "function") {
        UIO.renderInventory(getCtx());
        return;
      }
    } catch (_) {}
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
    // Prefer centralized UI orchestration
    try {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.showInventory === "function") {
        UIO.showInventory(getCtx());
        return;
      }
    } catch (_) {}
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
    // Prefer centralized UI orchestration
    try {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideInventory === "function") {
        UIO.hideInventory(getCtx());
        return;
      }
    } catch (_) {}
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
    // Prefer centralized InventoryFlow
    try {
      const IF = modHandle("InventoryFlow");
      if (IF && typeof IF.equipItemByIndex === "function") {
        IF.equipItemByIndex(getCtx(), idx);
        return;
      }
    } catch (_) {}
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
    // Prefer centralized InventoryFlow
    try {
      const IF = modHandle("InventoryFlow");
      if (IF && typeof IF.equipItemByIndexHand === "function") {
        IF.equipItemByIndexHand(getCtx(), idx, hand);
        return;
      }
    } catch (_) {}
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
    // Prefer centralized InventoryFlow
    try {
      const IF = modHandle("InventoryFlow");
      if (IF && typeof IF.unequipSlot === "function") {
        IF.unequipSlot(getCtx(), slot);
        return;
      }
    } catch (_) {}
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
    // Prefer centralized DeathFlow
    try {
      const DF = modHandle("DeathFlow");
      if (DF && typeof DF.show === "function") {
        DF.show(getCtx());
        return;
      }
    } catch (_) {}
    // Prefer centralized UI orchestration
    try {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.showGameOver === "function") {
        UIO.showGameOver(getCtx());
        return;
      }
    } catch (_) {}
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
    // Prefer centralized DeathFlow
    try {
      const DF = modHandle("DeathFlow");
      if (DF && typeof DF.hide === "function") {
        DF.hide(getCtx());
        return;
      }
    } catch (_) {}
    // Prefer centralized UI orchestration
    try {
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.hideGameOver === "function") {
        UIO.hideGameOver(getCtx());
        return;
      }
    } catch (_) {}
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.hideGameOver === "function") {
      UB.hideGameOver(getCtx());
    }
  }

  function restartGame() {
    // Prefer centralized DeathFlow (still invoke, but continue to apply a new seed)
    try {
      const DF = modHandle("DeathFlow");
      if (DF && typeof DF.restart === "function") {
        DF.restart(getCtx());
      }
    } catch (_) {}
    hideGameOver();
    floor = 1;
    isDead = false;
    try {
      const P = modHandle("Player");
      if (P && typeof P.resetFromDefaults === "function") {
        P.resetFromDefaults(player);
      }
      if (player) { player.bleedTurns = 0; player.dazedTurns = 0; }
    } catch (_) {}
    // Enter overworld and reroll seed so each new game starts with a fresh world
    mode = "world";
    // Try GodControls.rerollSeed which applies and persists a new seed, then regenerates overworld
    try {
      const GC = modHandle("GodControls");
      if (GC && typeof GC.rerollSeed === "function") {
        GC.rerollSeed(() => getCtx());
        return;
      }
    } catch (_) {}
    // Fallback: apply a time-based seed via RNG service or direct init, then generate world
    try {
      const s = (Date.now() % 0xffffffff) >>> 0;
      if (typeof window !== "undefined" && window.RNG && typeof window.RNG.applySeed === "function") {
        window.RNG.applySeed(s);
        rng = window.RNG.rng;
        initWorld();
        return;
      }
    } catch (_) {}
    // Ultimate fallback: no RNG service, just init world (non-deterministic)
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
    // Minimal fallback: announce death, add corpse with flavor, clear enemy, award XP
    const name = capitalize(enemy.type || "enemy");
    log(`${name} dies.`, "bad");
    const last = enemy._lastHit || null;
    function flavorFromLastHit(lh) {
      if (!lh) return null;
      const part = lh.part || "torso";
      const killer = lh.by || "unknown";
      const via = lh.weapon ? lh.weapon : (lh.via || "attack");
      let wound = "";
      if (part === "head") wound = lh.crit ? "head crushed into pieces" : "wound to the head";
      else if (part === "torso") wound = lh.crit ? "deep gash across the torso" : "stab wound in the torso";
      else if (part === "legs") wound = lh.crit ? "leg shattered beyond use" : "wound to the leg";
      else if (part === "hands") wound = lh.crit ? "hands mangled" : "cut on the hand";
      else wound = "fatal wound";
      const killedBy = (killer === "player") ? "you" : killer;
      return { killedBy, wound, via };
    }
    const meta = flavorFromLastHit(last);
    // Basic loot: animals drop meat/hide; others drop generic coin scrap
    let loot = [];
    try {
      const isAnimal = String(enemy.faction || "").startsWith("animal");
      if (isAnimal) {
        // Simple animal loot (stackable material)
        const meatAmt = 1 + Math.floor(rng() * 2); // 1–2
        loot.push({ kind: "material", type: "meat", name: "meat", amount: meatAmt });
        if (rng() < 0.35) loot.push({ kind: "material", type: "hide", name: "hide", amount: 1 });
      } else {
        // Fallback: small gold scrap
        loot.push({ kind: "gold", amount: 1, name: "gold" });
      }
    } catch (_) {}
    corpses.push({ x: enemy.x, y: enemy.y, loot: loot, looted: loot.length === 0, meta: meta || undefined });
    enemies = enemies.filter(e => e !== enemy);
    try {
      if (occupancy && typeof occupancy.clearEnemy === "function") {
        occupancy.clearEnemy(enemy.x, enemy.y);
      }
    } catch (_) {}
    gainXP(enemy.xp || 5);
    // If in Region Map and this was an animal, mark region cleared to prevent future spawns
    try {
      const wasAnimal = String(enemy.faction || "").startsWith("animal");
      if (mode === "region" && wasAnimal && region && region.enterWorldPos) {
        const pos = region.enterWorldPos;
        if (typeof window !== "undefined" && window.RegionMapRuntime && typeof window.RegionMapRuntime.markAnimalsCleared === "function") {
          window.RegionMapRuntime.markAnimalsCleared(pos.x | 0, pos.y | 0);
        }
        // Update flag immediately in current session
        try { region._hasKnownAnimals = true; } catch (_) {}
      }
    } catch (_) {}
  }

  
  function updateUI() {
    const UB = modHandle("UIBridge");
    if (UB && typeof UB.updateStats === "function") {
      UB.updateStats(getCtx());
    }
  }


  
  

  

  

  
  

  
  // Lightweight hint: in overworld, occasionally inform the player about nearby wildlife so they can open Region Map.
  let _wildNoHintTurns = 0;
  function maybeEmitOverworldAnimalHint() {
    try {
      if (mode !== "world" || !world || !world.map) { _wildNoHintTurns = 0; return; }

      const WT = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : null;
      if (!WT) return;
      const tHere = world.map[player.y] && world.map[player.y][player.x];

      // Only hint on wild-ish tiles
      const onWild = (tHere === WT.FOREST || tHere === WT.GRASS || tHere === WT.BEACH);
      if (!onWild) { _wildNoHintTurns = 0; return; }

      // Respect a cooldown to avoid log spam
      const MIN_TURNS_BETWEEN_HINTS = 12;
      if ((turnCounter - lastAnimalHintTurn) < MIN_TURNS_BETWEEN_HINTS) { _wildNoHintTurns++; return; }

      // Skip if this tile has been fully cleared in Region Map
      try {
        const RM = (typeof window !== "undefined" ? window.RegionMapRuntime : null);
        if (RM && typeof RM.animalsClearedHere === "function") {
          if (RM.animalsClearedHere(player.x | 0, player.y | 0)) { _wildNoHintTurns = 0; return; }
        }
      } catch (_) {}

      // Biome-weighted chance (more generous to ensure visibility)
      const base =
        (tHere === WT.FOREST) ? 0.55 :
        (tHere === WT.GRASS)  ? 0.35 :
        (tHere === WT.BEACH)  ? 0.20 : 0.0;

      // Pity: if we've been on wild tiles a long time without a hint, force one
      const PITY_TURNS = 40;
      const force = (_wildNoHintTurns >= PITY_TURNS);

      let success = false;
      if (force) {
        success = true;
      } else if (base > 0) {
        try {
          if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.chance === "function") {
            success = !!window.RNGUtils.chance(base, rng);
          } else {
            success = rng() < base;
          }
        } catch (_) {
          success = rng() < base;
        }
      }

      if (success) {
        log("You notice signs of wildlife nearby. Press G to open the Region Map.", "notice");
        lastAnimalHintTurn = turnCounter;
       wildNoHintTurns = 0;
      } else {
        _wildNoHintTurns++;
      }
    } catch (_) {}
  }

  function turn() {
    if (isDead) return;

    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

    // Advance global time (centralized via TimeService)
    turnCounter = TS.tick(turnCounter);

    // Prefer centralized TurnLoop when available
    try {
      const TL = modHandle("TurnLoop");
      if (TL && typeof TL.tick === "function") {
        const ctxMod = getCtx();
        TL.tick(ctxMod);
        // If external modules mutated ctx.mode/map (e.g., EncounterRuntime.complete), sync orchestrator state
        try {
          const cPost = getCtx();
          if (cPost && cPost.mode !== mode) {
            applyCtxSyncAndRefresh(cPost);
          }
        } catch (_) {}
        // Overworld wildlife hint even when TurnLoop is active
        try {
          if (mode === "world") { maybeEmitOverworldAnimalHint(); }
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
        return;
      }
    } catch (_) {}

    // Fallback: inline turn processing (legacy path)
    // Injury healing: healable injuries tick down and disappear when reaching 0
    try {
      if (player && Array.isArray(player.injuries) && player.injuries.length) {
        let changed = false;
        player.injuries = player.injuries.map((inj) => {
          if (!inj) return null;
          if (typeof inj === "string") {
            // Convert legacy string format to object
            const name = inj;
            const permanent = /scar|missing finger/i.test(name);
            return { name, healable: !permanent, durationTurns: permanent ? 0 : 40 };
          }
          if (inj.healable && (inj.durationTurns | 0) > 0) {
            inj.durationTurns = (inj.durationTurns | 0) - 1;
            changed = true;
          }
          return (inj.healable && inj.durationTurns <= 0) ? null : inj;
        }).filter(Boolean);
        if (changed) {
          // Update HUD so Character Sheet reflects status sooner if open later
          updateUI();
        }
      }
    } catch (_) {}

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
      // After world tick, maybe emit a wildlife hint
      maybeEmitOverworldAnimalHint();
    } else if (mode === "encounter") {
      const ER = modHandle("EncounterRuntime");
      if (ER && typeof ER.tick === "function") {
        const ctxMod = getCtx();
        ER.tick(ctxMod);
        // Merge enemy/corpse/decals mutations that may have been synced via a different ctx inside callbacks
        try {
          ctxMod.enemies = Array.isArray(enemies) ? enemies : ctxMod.enemies;
          ctxMod.corpses = Array.isArray(corpses) ? corpses : ctxMod.corpses;
          ctxMod.decals = Array.isArray(decals) ? decals : ctxMod.decals;
        } catch (_) {}
        // Now push ctx state (including player position/mode changes) and refresh
        applyCtxSyncAndRefresh(ctxMod);
      }
    } else if (mode === "region") {
      const RM = modHandle("RegionMapRuntime");
      if (RM && typeof RM.tick === "function") {
        RM.tick(getCtx());
      }
    }

    // Apply status effects globally each turn (bleed, dazed)
    try {
      const ST = modHandle("Status");
      if (ST && typeof ST.tick === "function") {
        ST.tick(getCtx());
      }
    } catch (_) {}

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
          // Encounter debug helpers
          onGodStartEncounterNow: (encId) => {
            try {
              const id = String(encId || "").toLowerCase();
              const GD = (typeof window !== "undefined" ? window.GameData : null);
              const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : [];
              const t = reg.find(t => String(t.id || "").toLowerCase() === id) || null;
              if (!t) {
                if (id) log(`GOD: Encounter '${id}' not found.`, "warn");
                return;
              }
              if (mode !== "world") {
                log("GOD: Start Now works in overworld only.", "warn");
                return;
              }
              const tile = world && world.map ? world.map[player.y][player.x] : null;
              const biome = (function () {
                try {
                  const W = (typeof window !== "undefined" && window.World) ? window.World : null;
                  return (W && typeof W.biomeName === "function") ? (W.biomeName(tile) || "").toUpperCase() : "";
                } catch (_) { return ""; }
              })();
              const diff = 1;
              const ok = (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.enterEncounter === "function")
                ? window.GameAPI.enterEncounter(t, biome, diff)
                : false;
              if (!ok) {
                const ER = modHandle("EncounterRuntime");
                if (ER && typeof ER.enter === "function") {
                  const ctxMod = getCtx();
                  if (ER.enter(ctxMod, { template: t, biome, difficulty: diff })) {
                    applyCtxSyncAndRefresh(ctxMod);
                  }
                }
              }
            } catch (_) {}
          },
          onGodArmEncounterNextMove: (encId) => {
            try {
              const id = String(encId || "");
              if (!id) { log("GOD: Select an encounter first.", "warn"); return; }
              window.DEBUG_ENCOUNTER_ARM = id;
              log(`GOD: Armed '${id}' — will trigger on next overworld move.`, "notice");
            } catch (_) {}
          },
          // Status effect test hooks
          onGodApplyBleed: (dur = 3) => {
            const GC = modHandle("GodControls");
            if (GC && typeof GC.applyBleedToPlayer === "function") {
              GC.applyBleedToPlayer(() => getCtx(), dur);
              updateUI();
            } else {
              const ST = modHandle("Status");
              if (ST && typeof ST.applyBleedToPlayer === "function") {
                ST.applyBleedToPlayer(getCtx(), dur);
                updateUI();
              } else {
                player.bleedTurns = Math.max(player.bleedTurns || 0, (dur | 0));
                log(`You are bleeding (${player.bleedTurns}).`, "warn");
                updateUI();
              }
            }
          },
          onGodApplyDazed: (dur = 2) => {
            const GC = modHandle("GodControls");
            if (GC && typeof GC.applyDazedToPlayer === "function") {
              GC.applyDazedToPlayer(() => getCtx(), dur);
              updateUI();
            } else {
              const ST = modHandle("Status");
              if (ST && typeof ST.applyDazedToPlayer === "function") {
                ST.applyDazedToPlayer(getCtx(), dur);
                updateUI();
              } else {
                player.dazedTurns = Math.max(player.dazedTurns || 0, (dur | 0));
                log(`You are dazed and might lose your next action${dur > 1 ? "s" : ""}.`, "warn");
                updateUI();
              }
            }
          },
          onGodClearEffects: () => {
            const GC = modHandle("GodControls");
            if (GC && typeof GC.clearPlayerEffects === "function") {
              GC.clearPlayerEffects(() => getCtx());
            } else {
              player.bleedTurns = 0;
              player.dazedTurns = 0;
              updateUI();
              log("Status effects cleared (Bleed, Dazed).", "info");
            }
          },
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
                  const ctx2 = getCtx();
                  if (typeof window !== "undefined" && window.OccupancyFacade && typeof window.OccupancyFacade.rebuild === "function") {
                    window.OccupancyFacade.rebuild(ctx2);
                  } else {
                    const TR = modHandle("TownRuntime");
                    if (TR && typeof TR.rebuildOccupancy === "function") {
                      TR.rebuildOccupancy(ctx2);
                    } else {
                      const OG = modHandle("OccupancyGrid");
                      if (OG && typeof OG.build === "function") {
                        occupancy = OG.build({ map, enemies, npcs, props: townProps, player });
                      }
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
                const skippedCount = (typeof res.skipped === "number") ? res.skipped : 0;
                const skippedStr = skippedCount ? `, ${skippedCount} skipped` : "";
                const reachableCount = (typeof res.reachable === "number") ? res.reachable : 0;
                const unreachableCount = (typeof res.unreachable === "number") ? res.unreachable : 0;
                const summaryLine = `Home route check: ${reachableCount}/${totalChecked} reachable, ${unreachableCount} unreachable${skippedStr}.`;
                log(summaryLine, unreachableCount ? "warn" : "good");

                const extraLines = [];
                // Type breakdown (helps explain differences between on-screen NPCs vs residents counted)
                try {
                  const counts = res.counts || null;
                  if (counts) {
                    const npcTotalAll = (typeof counts.npcTotal === "number") ? counts.npcTotal : (totalChecked + skippedCount);
                    const pets = (typeof counts.pets === "number") ? counts.pets : skippedCount;
                    const shopTotal = (typeof counts.shopkeepersTotal === "number") ? counts.shopkeepersTotal : 0;
                    const greetTotal = (typeof counts.greetersTotal === "number") ? counts.greetersTotal : 0;
                    const resTotal = (res.residents && typeof res.residents.total === "number") ? res.residents.total
                                     : ((typeof counts.residentsTotal === "number") ? counts.residentsTotal : 0);
                    const roamersTotal = (typeof counts.roamersTotal === "number")
                      ? counts.roamersTotal
                      : Math.max(0, totalChecked - resTotal - shopTotal - greetTotal);
                    extraLines.push(`NPCs: ${totalChecked} checked (excluding pets), ${pets} pet(s) skipped. Total in town: ${npcTotalAll}.`);
                    extraLines.push(`By type: residents ${resTotal}, shopkeepers ${shopTotal}, greeters ${greetTotal}, roamers ${roamersTotal}.`);
                  } else {
                    const npcTotalAll = totalChecked + skippedCount;
                    extraLines.push(`NPCs: ${totalChecked} checked (excluding pets). Total in town: ${npcTotalAll}.`);
                  }
                } catch (_) {}

                if (res.residents && typeof res.residents.total === "number") {
                  const r = res.residents;
                  const atHome = (typeof r.atHome === "number") ? r.atHome : 0;
                  const atInn = (typeof r.atTavern === "number") ? r.atTavern : 0; // display as "inn"
                  extraLines.push(`Residents: ${atHome}/${r.total} at home, ${atInn}/${r.total} at inn.`);
                } else {
                  // Provide a hint if no residents were counted
                  extraLines.push("No residents were counted; ensure town NPCs are populated.");
                }
                // Inn/Tavern occupancy summary across all NPCs (not just residents)
                if (res.tavern && (typeof res.tavern.any === "number")) {
                  const innAny = res.tavern.any | 0;
                  const innSleep = (typeof res.tavern.sleeping === "number") ? res.tavern.sleeping | 0 : 0;
                  extraLines.push(`Inn status: ${innAny} NPC(s) inside; sleeping: ${innSleep}.`);
                }
                // Show first few sleepers by name for quick verification
                if (Array.isArray(res.sleepersAtTavern) && res.sleepersAtTavern.length) {
                  res.sleepersAtTavern.slice(0, 8).forEach(d => {
                    const nm = (typeof d.name === "string" && d.name) ? d.name : `NPC ${String((d.index | 0) + 1)}`;
                    extraLines.push(`- Sleeping: ${nm} at (${d.x},${d.y})`);
                  });
                  if (res.sleepersAtTavern.length > 8) extraLines.push(`...and ${res.sleepersAtTavern.length - 8} more.`);
                }

                // Per-resident list of late-night away residents
                if (Array.isArray(res.residentsAwayLate) && res.residentsAwayLate.length) {
                  extraLines.push(`Late-night (02:00–05:00): ${res.residentsAwayLate.length} resident(s) away from home and inn:`);
                  res.residentsAwayLate.slice(0, 10).forEach(d => {
                    const name = (typeof d.name === "string" && d.name) ? d.name : "Resident";
                    extraLines.push(`- ${name} at (${d.x},${d.y})`);
                  });
                  if (res.residentsAwayLate.length > 10) {
                    extraLines.push(`...and ${res.residentsAwayLate.length - 10} more.`);
                  }
                }
                if (skippedCount) {
                  extraLines.push(`Skipped ${skippedCount} NPCs not expected to have homes (e.g., pets).`);
                }
                if (unreachableCount && Array.isArray(res.details)) {
                  res.details.slice(0, 8).forEach(d => {
                    const name = (typeof d.name === "string" && d.name) ? d.name : `NPC ${String((d.index | 0) + 1)}`;
                    extraLines.push(`- ${name}: ${d.reason}`);
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

                // Do not change Home Paths overlay state here; this action only logs results.
                // Users can toggle the overlay via the GOD panel control.

                // Request draw to show updated debug paths
                requestDraw();
              } else {
                log("TownAI.checkHomeRoutes not available.", "warn");
              }
            }
          },
          onGodCheckInnTavern: () => {
            const ctx = getCtx();
            if (ctx.mode !== "town") {
              log("Inn/Plaza check is available in town mode only.", "warn");
              requestDraw();
              return;
            }
            const list = Array.isArray(shops) ? shops : [];
            const inns = list.filter(s => (s.name || "").toLowerCase().includes("inn"));
            const plaza = ctx.townPlaza || null;

            const header = `Inn/Plaza: ${inns.length} inn(s).`;
            log(header, inns.length ? "info" : "warn");

            const lines = [];

            // Plaza/Square coordinates
            if (plaza && typeof plaza.x === "number" && typeof plaza.y === "number") {
              lines.push(`Plaza/Square center: (${plaza.x},${plaza.y})`);
            } else {
              lines.push("Plaza/Square: (unknown)");
            }

            // Inn coordinates (door + building rect) + overlap diagnostics
            function rectOverlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
              const sepX = (ax1 < bx0) || (bx1 < ax0);
              const sepY = (ay1 < by0) || (by1 < ay0);
              return !(sepX || sepY);
            }
            const pRect = (ctx.townPlazaRect && typeof ctx.townPlazaRect.x0 === "number")
              ? ctx.townPlazaRect
              : null;

            inns.slice(0, 8).forEach((s, i) => {
              const b = s && s.building ? s.building : null;
              const doorStr = `door (${s.x},${s.y})`;
              if (b && typeof b.x === "number" && typeof b.y === "number" && typeof b.w === "number" && typeof b.h === "number") {
                const bx0 = b.x, by0 = b.y, bx1 = b.x + b.w - 1, by1 = b.y + b.h - 1;
                const overlapStr = (pRect ? (rectOverlap(bx0, by0, bx1, by1, pRect.x0, pRect.y0, pRect.x1, pRect.y1) ? "OVERLAPS plaza" : "no overlap") : "");
                lines.push(`Inn ${i + 1}: ${doorStr}, building (${b.x},${b.y}) size ${b.w}x${b.h}${overlapStr ? ` — ${overlapStr}` : ""}`);
              } else {
                lines.push(`Inn ${i + 1}: ${doorStr}`);
              }
            });

            try {
              const el = document.getElementById("god-check-output");
              if (el) {
                const html = [header].concat(lines).map(s => `<div>${s}</div>`).join("");
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
            const UIO = modHandle("UIOrchestration");
            if (UIO && typeof UIO.isAnyModalOpen === "function") return !!UIO.isAnyModalOpen(getCtx());
          } catch (_) {}
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
        // Encounter helper: enter and sync a unique encounter map, using dungeon enemies under the hood
        enterEncounter: (template, biome, difficulty = 1) => {
          const ER = modHandle("EncounterRuntime");
          if (ER && typeof ER.enter === "function") {
            const ctx = getCtx();
            const ok = ER.enter(ctx, { template, biome, difficulty });
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
