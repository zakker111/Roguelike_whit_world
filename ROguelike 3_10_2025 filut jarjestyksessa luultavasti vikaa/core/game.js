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
  
  import { maybeEmitOverworldAnimalHint as maybeEmitOverworldAnimalHintExt } from "./world_hints.js";
import { clearPersistentGameStorage as clearPersistentGameStorageExt } from "./state/persistence.js";
import {
  initTimeWeather,
  getClock as timeGetClock,
  getWeatherSnapshot as timeGetWeatherSnapshot,
  minutesUntil as timeMinutesUntil,
  advanceTimeMinutes as timeAdvanceTimeMinutes,
  tickTimeAndWeather,
  getMinutesPerTurn,
  getTurnCounter
} from "./facades/time_weather.js";
import { measureDraw as perfMeasureDraw, measureTurn as perfMeasureTurn, getPerfStats as perfGetPerfStats } from "./facades/perf.js";
import { getRawConfig, getViewportDefaults, getWorldDefaults, getFovDefaults, getDevDefaults } from "./facades/config.js";
import { TILES as TILES_CONST, getColors as getColorsConst } from "./facades/visuals.js";
import { log as logFacade } from "./facades/log.js";
import { getRng as rngGetRng, int as rngInt, chance as rngChance, float as rngFloat } from "./facades/rng.js";
import {
  getPlayerAttack as combatGetPlayerAttack,
  getPlayerDefense as combatGetPlayerDefense,
  rollHitLocation as combatRollHitLocation,
  critMultiplier as combatCritMultiplier,
  getEnemyBlockChance as combatGetEnemyBlockChance,
  getPlayerBlockChance as combatGetPlayerBlockChance,
  enemyDamageAfterDefense as combatEnemyDamageAfterDefense,
  enemyDamageMultiplier as combatEnemyDamageMultiplier,
  enemyThreatLabel as combatEnemyThreatLabel
} from "./facades/combat.js";
import {
  renderInventoryPanel as renderInventoryPanelFacade,
  showInventoryPanel as showInventoryPanelFacade,
  hideInventoryPanel as hideInventoryPanelFacade,
  equipItemByIndex as equipItemByIndexFacade,
  equipItemByIndexHand as equipItemByIndexHandFacade,
  unequipSlot as unequipSlotFacade,
  addPotionToInventory as addPotionToInventoryFacade,
  drinkPotionByIndex as drinkPotionByIndexFacade,
  eatFoodByIndex as eatFoodByIndexFacade
} from "./facades/inventory.js";
import {
  initialDecay as invInitialDecay,
  rerenderInventoryIfOpen as invRerenderInventoryIfOpen,
  decayEquipped as invDecayEquipped,
  usingTwoHanded as invUsingTwoHanded,
  decayAttackHands as invDecayAttackHands,
  decayBlockingHands as invDecayBlockingHands,
  describeItem as invDescribeItem,
  equipIfBetter as invEquipIfBetter
} from "./facades/inventory_decay.js";
import {
  setAlwaysCrit as setAlwaysCritFacade,
  setCritPart as setCritPartFacade,
  godSpawnEnemyNearby as godSpawnEnemyNearbyFacade,
  godSpawnItems as godSpawnItemsFacade,
  godHeal as godHealFacade,
  godSpawnStairsHere as godSpawnStairsHereFacade
} from "./god/facade.js";

  // Runtime configuration (loaded via GameData.config via core/game_config.js)
  const CFG = getRawConfig();
  const { TILE, COLS, ROWS } = getViewportDefaults(CFG);
  const { MAP_COLS, MAP_ROWS } = getWorldDefaults(CFG);

  // Fresh session (no localStorage) support via URL params: ?fresh=1 or ?reset=1 or ?nolocalstorage=1
  try {
    const href = (typeof window !== "undefined" && window.location) ? window.location.href : "";
    const url = href ? new URL(href) : null;
    const params = url ? url.searchParams : null;
    const fresh = !!(params && (params.get("fresh") === "1" || params.get("reset") === "1" || params.get("nolocalstorage") === "1"));
    if (fresh) {
      try { if (typeof window !== "undefined") window.NO_LOCALSTORAGE = true; } catch (_) {}
      try { if (typeof localStorage !== "undefined") localStorage.clear(); } catch (_) {}
      try { if (typeof window !== "undefined") window._TOWN_STATES_MEM = Object.create(null); } catch (_) {}
    }
  } catch (_) {}

  const { FOV_DEFAULT, FOV_MIN, FOV_MAX } = getFovDefaults(CFG);
  let fovRadius = FOV_DEFAULT;

  // Initialize global time and weather runtime (shared across modes)
  initTimeWeather(CFG);

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
  // Inn upstairs overlay state
  let innUpstairs = null;    // { offset:{x,y}, w, h, tiles:number[][], props:[{x,y,type,name}] }
  let innUpstairsActive = false;
  let innStairsGround = [];  // [{x,y},{x,y}] two ground-floor stairs tiles inside inn hall
  
  let townName = null;       // current town's generated name

  // World/town/dungeon transition anchors
  let townExitAt = null;     // gate position inside town used to exit back to overworld
  let worldReturnPos = null; // overworld position to return to after leaving town/dungeon
  let dungeonExitAt = null;  // dungeon tile to return to overworld
  let cameFromWorld = false; // whether we entered dungeon from overworld
  let currentDungeon = null; // info for current dungeon entrance: { x,y, level, size }
  // Persist dungeon states by overworld entrance coordinate "x,y"
  const dungeonStates = Object.create(null);

  // Global time-of-day cycle and visual weather (shared across modes) are managed via
  // the time_weather facade. This keeps core/game.js focused on orchestration logic.
  function getClock() {
    return timeGetClock();
  }

  function getWeatherSnapshot(time) {
    return timeGetWeatherSnapshot(time);
  }

  
  const camera = {
    x: 0,
    y: 0,
    width: COLS * TILE,
    height: ROWS * TILE,
  };

  
  const TILES = TILES_CONST;
  const COLORS = getColorsConst();

  
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
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.autoInit === "function") {
      currentSeed = window.RNG.autoInit();
    } else {
      // If RNG service is unavailable, try to read persisted seed for diagnostics only
      const noLS = (typeof window !== "undefined" && !!window.NO_LOCALSTORAGE);
      const sRaw = (!noLS && typeof localStorage !== "undefined") ? localStorage.getItem("SEED") : null;
      currentSeed = sRaw != null ? (Number(sRaw) >>> 0) : null;
    }
  } catch (_) { currentSeed = null; }
  // Single RNG function via RNG facade; deterministic (0.5) if RNG is unavailable
  let rng = rngGetRng();
  let isDead = false;
  let startRoomRect = null;
  // GOD toggles (config-driven defaults with localStorage/window override)
  const DEV_DEFAULTS = getDevDefaults(CFG);
  const AC_DEFAULT = !!DEV_DEFAULTS.alwaysCritDefault;
  const CP_DEFAULT = DEV_DEFAULTS.critPartDefault;
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
      // Inn upstairs overlay
      innUpstairs,
      innUpstairsActive,
      innStairsGround,
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
      weather: getWeatherSnapshot(),
      // Perf stats for HUD overlay (smoothed via EMA when available)
      getPerfStats: () => perfGetPerfStats(),
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

  // RNG helpers via facade
  const randInt = (min, max) => rngInt(min, max, rng);
  const chance = (p) => rngChance(p, rng);
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
  const randFloat = (min, max, decimals = 1) => rngFloat(min, max, decimals, rng);
  const round1 = (n) => Math.round(n * 10) / 10;

  // Decay helpers delegated to inventory_decay facade
  function initialDecay(tier) {
    return invInitialDecay(getCtx(), tier);
  }

  function rerenderInventoryIfOpen() {
    invRerenderInventoryIfOpen(getCtx());
  }

  function decayEquipped(slot, amount) {
    invDecayEquipped(getCtx(), slot, amount);
  }

  
  function getPlayerAttack() {
    return combatGetPlayerAttack(getCtx());
  }

  
  function getPlayerDefense() {
    return combatGetPlayerDefense(getCtx());
  }

  function describeItem(item) {
    return invDescribeItem(getCtx(), item);
  }

  
  function rollHitLocation() {
    return combatRollHitLocation(getCtx());
  }

  function critMultiplier() {
    return combatCritMultiplier(getCtx());
  }

  function getEnemyBlockChance(enemy, loc) {
    return combatGetEnemyBlockChance(getCtx(), enemy, loc);
  }

  function getPlayerBlockChance(loc) {
    return combatGetPlayerBlockChance(getCtx(), loc);
  }

  // Enemy damage after applying player's defense
  function enemyDamageAfterDefense(raw) {
    return combatEnemyDamageAfterDefense(getCtx(), raw);
  }

  
  

  function enemyDamageMultiplier(level) {
    return combatEnemyDamageMultiplier(getCtx(), level);
  }

  // Classify enemy danger based on level difference vs player
  function enemyThreatLabel(enemy) {
    return combatEnemyThreatLabel(getCtx(), enemy);
  }

  
  function setFovRadius(r) {
    const clamped = Math.max(FOV_MIN, Math.min(FOV_MAX, r));
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
    try { addPotionToInventoryFacade(getCtx(), heal, name); return; } catch (_) {}
    log("Inventory system not available.", "warn");
  }

  function drinkPotionByIndex(idx) {
    try { drinkPotionByIndexFacade(getCtx(), idx); return; } catch (_) {}
    log("Inventory system not available.", "warn");
  }

  // Eat edible materials using centralized inventory flow
  function eatFoodByIndex(idx) {
    try { eatFoodByIndexFacade(getCtx(), idx); return; } catch (_) {}
    log("Inventory system not available.", "warn");
  }

  
  function equipIfBetter(item) {
    return invEquipIfBetter(getCtx(), item);
  }

  
  function log(msg, type = "info") {
    try { logFacade(getCtx(), msg, type); } catch (_) {
      try { console.log(`[${type}] ${msg}`); } catch (_) {}
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
    log("Error: Dungeon generation unavailable.", "bad");
    throw new Error("Dungeon generation unavailable");
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
    // Upstairs overlay-aware walkability: when active and inside the inn interior, honor upstairs tiles.
    try {
      if (innUpstairsActive && tavern && innUpstairs) {
        const b = tavern.building || null;
        const up = innUpstairs;
        if (b && up) {
          const ox = up.offset ? up.offset.x : (b.x + 1);
          const oy = up.offset ? up.offset.y : (b.y + 1);
          const lx = x - ox, ly = y - oy;
          const w = up.w | 0, h = up.h | 0;
          if (lx >= 0 && ly >= 0 && lx < w && ly < h) {
            const row = up.tiles && up.tiles[ly];
            const t = row ? row[lx] : null;
            if (t != null) {
              // Treat WALL as not walkable; allow FLOOR and STAIRS; disallow DOOR upstairs to avoid "walkable doors" issue.
              return t === TILES.FLOOR || t === TILES.STAIRS;
            }
          }
        }
      }
    } catch (_) {}

    // Centralize via Utils.isWalkableTile; fallback to tile-type check
    const U = modHandle("Utils");
    if (U && typeof U.isWalkableTile === "function") {
      return !!U.isWalkableTile(getCtx(), x, y);
    }
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const t = map[y][x];
    return t === TILES.FLOOR || t === TILES.DOOR || t === TILES.STAIRS || t === TILES.ROAD;
  }

  

  

  function recomputeFOV() {
    // Centralize FOV recompute via GameFOV; remove inline and legacy fallbacks
    const GF = modHandle("GameFOV");
    if (GF && typeof GF.recomputeWithGuard === "function") {
      const ctx = getCtx();
      ctx.seen = seen;
      ctx.visible = visible;
      GF.recomputeWithGuard(ctx);
      visible = ctx.visible;
      seen = ctx.seen;
    }
  }

  
  function updateCamera() {
    // Centralize camera updates via FOVCamera
    const FC = modHandle("FOVCamera");
    if (FC && typeof FC.updateCamera === "function") {
      FC.updateCamera(getCtx());
    }
  }

  
  function getRenderCtx() {
    const RO = modHandle("RenderOrchestration");
    if (!RO || typeof RO.getRenderCtx !== "function") {
      return null;
    }
    const base = RO.getRenderCtx(getCtx());
    // Perf sink: delegate to core/perf.js
    try {
      base.onDrawMeasured = (ms) => {
        try { perfMeasureDraw(ms); } catch (_) {}
      };
    } catch (_) {}
    return base;
  }

  // Batch multiple draw requests within a frame to avoid redundant renders.
  // Suppress draw flag used for fast-forward time (sleep/wait simulations)
  let _suppressDraw = false;

  

  function requestDraw() {
    if (_suppressDraw) return;
    const GL = modHandle("GameLoop");
    if (GL && typeof GL.requestDraw === "function") {
      GL.requestDraw();
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

    // Hard error: infinite world not available or generation failed
    log("Error: Infinite world generation failed or unavailable.", "bad");
    throw new Error("Infinite world generation failed or unavailable");
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
    return timeMinutesUntil(hourTarget, minuteTarget);
  }
  function advanceTimeMinutes(mins) {
    timeAdvanceTimeMinutes(mins, (msg, type) => log(msg, type), () => (typeof rng === "function" ? rng() : Math.random()));
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
    const minutesPerTurn = getMinutesPerTurn();
    const turns = Math.max(1, Math.ceil(total / (minutesPerTurn || 1)));
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
          // Inn upstairs overlay state
          setInnUpstairs: (v) => { if (typeof v !== "undefined") innUpstairs = v; },
          setInnUpstairsActive: (v) => { if (typeof v !== "undefined") innUpstairsActive = !!v; },
          setInnStairsGround: (v) => { if (Array.isArray(v)) innStairsGround = v; },
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
    // Inn upstairs overlay (fallback direct assignment)
    if (Object.prototype.hasOwnProperty.call(ctx, "innUpstairs")) innUpstairs = ctx.innUpstairs;
    if (Object.prototype.hasOwnProperty.call(ctx, "innUpstairsActive")) innUpstairsActive = !!ctx.innUpstairsActive;
    if (Object.prototype.hasOwnProperty.call(ctx, "innStairsGround") && Array.isArray(ctx.innStairsGround)) innStairsGround = ctx.innStairsGround;
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
    // Mandatory StateSync-only refresh path
    try {
      const SS = modHandle("StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(getCtx(), {
          // No-op sink here since sync already applied locally
        });
      }
    } catch (_) {}
  }

  /**
   * Auto-escort travel: after resolving a caravan ambush encounter and choosing to continue
   * guarding the caravan, automatically advance overworld turns with a small delay so the
   * caravan (and player) visibly travel toward their destination.
   */
  function startEscortAutoTravel() {
    try {
      const ctx0 = getCtx();
      if (!ctx0 || !ctx0.world) return;
      const world = ctx0.world;
      world._escortAutoTravel = world._escortAutoTravel || { running: false };
      const state = world._escortAutoTravel;
      if (state.running) return;
      state.running = true;

      let steps = 0;
      const maxSteps = 2000; // safety cap
      const delayMs = 140;

      function step() {
        try {
          const ctx = getCtx();
          if (!ctx || !ctx.world) { state.running = false; return; }
          const w = ctx.world;
          const escort = w.caravanEscort;
          if (!escort || !escort.active || ctx.mode !== "world") {
            state.running = false;
            return;
          }
          if (typeof ctx.turn === "function") ctx.turn();
        } catch (_) {}
        steps++;
        if (steps >= maxSteps) { state.running = false; return; }
        setTimeout(step, delayMs);
      }

      // Do one immediate step so the player sees the caravan start moving as soon
      // as they return to the overworld, then continue with a timed loop.
      try {
        const ctx = getCtx();
        const w = ctx.world;
        const escort = w && w.caravanEscort;
        if (escort && escort.active && ctx.mode === "world" && typeof ctx.turn === "function") {
          ctx.turn();
          steps++;
        }
      } catch (_) {}

      if (steps < maxSteps) {
        setTimeout(step, delayMs);
      } else {
        state.running = false;
      }
    } catch (_) {}
  }

  

  function enterTownIfOnTile() {
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.enterTownIfOnTile === "function") {
      const ctx = getCtx();
      const ok = !!MT.enterTownIfOnTile(ctx);
      if (ok) {
        applyCtxSyncAndRefresh(ctx);
      }
      return ok;
    }
    return false;
  }

  function enterDungeonIfOnEntrance() {
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.enterDungeonIfOnEntrance === "function") {
      const ctx = getCtx();
      const ok = !!MT.enterDungeonIfOnEntrance(ctx);
      if (ok) {
        applyCtxSyncAndRefresh(ctx);
      }
      return ok;
    }
    return false;
  }

  function leaveTownNow() {
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.leaveTownNow === "function") {
      const ctx = getCtx();
      MT.leaveTownNow(ctx);
      applyCtxSyncAndRefresh(ctx);
    }
  }

  function requestLeaveTown() {
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.requestLeaveTown === "function") {
      MT.requestLeaveTown(getCtx());
    }
  }

  function returnToWorldFromTown() {
    if (mode !== "town" || !world) return false;
    const ctx = getCtx();

    // Primary: use TownRuntime gate-aware exit
    const TR = modHandle("TownRuntime");
    if (TR && typeof TR.returnToWorldIfAtGate === "function") {
      const ok = !!TR.returnToWorldIfAtGate(ctx);
      if (ok) {
        applyCtxSyncAndRefresh(ctx);
        return true;
      }
    }

    // Fallback: if standing exactly on the gate tile, apply leave sync directly
    if (townExitAt && player.x === townExitAt.x && player.y === townExitAt.y) {
      if (TR && typeof TR.applyLeaveSync === "function") {
        TR.applyLeaveSync(ctx);
        applyCtxSyncAndRefresh(ctx);
        return true;
      }
    }

    // Compatibility: if a returnToWorldFromTown transition exists, try it
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.returnToWorldFromTown === "function") {
      const ok = !!MT.returnToWorldFromTown(ctx);
      if (ok) {
        applyCtxSyncAndRefresh(ctx);
        return true;
      }
    }

    // Guidance when not at gate
    const MZ = modHandle("Messages");
    if (MZ && typeof MZ.log === "function") {
      MZ.log(getCtx(), "town.exitHint");
    } else {
      log("Return to the town gate to exit to the overworld.", "info");
    }
    return false;
  }

  function returnToWorldIfAtExit() {
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.returnToWorldIfAtExit === "function") {
      const ctx = getCtx();
      const ok = MT.returnToWorldIfAtExit(ctx);
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
      const UIO = modHandle("UIOrchestration");
      if (UIO && typeof UIO.isLootOpen === "function" && UIO.isLootOpen(getCtx())) {
        hideLootPanel();
        return;
      }
    } catch (_) {}

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

    

    if (mode === "town") {
      // Prefer local interactions/logs first so guidance hint doesn't drown them out
      lootCorpse();
      // Then, if standing on the gate, leave town (or show exit hint if applicable)
      if (returnToWorldFromTown()) return;
      return;
    }

    // Fallback for non-world modes when Actions.doAction did not handle:
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
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isInventoryOpen === "function" && UIO.isInventoryOpen(getCtx()));
        },
        isLootOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isLootOpen === "function" && UIO.isLootOpen(getCtx()));
        },
        isGodOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isGodOpen === "function" && UIO.isGodOpen(getCtx()));
        },
        // Ensure shop modal is part of the modal stack priority
        isShopOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isShopOpen === "function" && UIO.isShopOpen(getCtx()));
        },
        // Smoke config modal priority after Shop
        isSmokeOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isSmokeOpen === "function" && UIO.isSmokeOpen(getCtx()));
        },
        // Sleep modal (Inn beds)
        isSleepOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isSleepOpen === "function" && UIO.isSleepOpen(getCtx()));
        },
        // Confirm dialog gating
        isConfirmOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isConfirmOpen === "function" && UIO.isConfirmOpen(getCtx()));
        },
        // actions
        onRestart: () => restartGame(),
        onShowInventory: () => showInventoryPanel(),
        onHideInventory: () => hideInventoryPanel(),
        onHideLoot: () => hideLootPanel(),
        onHideGod: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.hideGod === "function") UIO.hideGod(getCtx());
        },
        onHideShop: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.hideShop === "function") UIO.hideShop(getCtx());
        },
        onHideSmoke: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.hideSmoke === "function") UIO.hideSmoke(getCtx());
        },
        onHideSleep: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.hideSleep === "function") UIO.hideSleep(getCtx());
        },
        onCancelConfirm: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.cancelConfirm === "function") UIO.cancelConfirm(getCtx());
        },
        onShowGod: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.showGod === "function") UIO.showGod(getCtx());
          const UIH = modHandle("UI");
          if (UIH && typeof UIH.setGodFov === "function") UIH.setGodFov(fovRadius);
        },
        
        // Help / Controls + Character Sheet (F1)
        isHelpOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isHelpOpen === "function" && UIO.isHelpOpen(getCtx()));
        },
        onShowHelp: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.showHelp === "function") UIO.showHelp(getCtx());
        },
        onHideHelp: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.hideHelp === "function") UIO.hideHelp(getCtx());
        },
        // Character Sheet (C)
        isCharacterOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(UIO && typeof UIO.isCharacterOpen === "function" && UIO.isCharacterOpen(getCtx()));
        },
        onShowCharacter: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.showCharacter === "function") UIO.showCharacter(getCtx());
        },
        onHideCharacter: () => {
          const UIO = modHandle("UIOrchestration");
          if (UIO && typeof UIO.hideCharacter === "function") UIO.hideCharacter(getCtx());
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
    const DC = modHandle("Decals");
    if (DC && typeof DC.add === "function") {
      DC.add(getCtx(), x, y, mult);
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
    const LF = modHandle("LootFlow");
    if (LF && typeof LF.loot === "function") {
      LF.loot(getCtx());
      return;
    }
    const DR = modHandle("DungeonRuntime");
    if (DR && typeof DR.lootHere === "function") {
      DR.lootHere(getCtx());
      return;
    }
    const L = modHandle("Loot");
    if (L && typeof L.lootHere === "function") {
      L.lootHere(getCtx());
      return;
    }
    log("Nothing to loot here.", "info");
  }

  function showLootPanel(list) {
    const LF = modHandle("LootFlow");
    if (LF && typeof LF.show === "function") {
      LF.show(getCtx(), list);
      requestDraw();
      return;
    }
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.showLoot === "function") {
      UIO.showLoot(getCtx(), list);
      requestDraw();
    }
  }

  function hideLootPanel() {
    const LF = modHandle("LootFlow");
    if (LF && typeof LF.hide === "function") {
      LF.hide(getCtx());
      requestDraw();
      return;
    }
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.hideLoot === "function") {
      UIO.hideLoot(getCtx());
      requestDraw();
    }
  }

  
  // GOD mode actions (delegated to core/god_facade.js)
  function godHeal() {
    try { if (godHealFacade(getCtx())) return; } catch (_) {}
    log("GOD: heal not available.", "warn");
  }

  function godSpawnStairsHere() {
    try { if (godSpawnStairsHereFacade(getCtx())) return; } catch (_) {}
    log("GOD: spawnStairsHere not available.", "warn");
  }

  function godSpawnItems(count = 3) {
    try { if (godSpawnItemsFacade(getCtx(), count)) return; } catch (_) {}
    log("GOD: spawnItems not available.", "warn");
  }

  function godSpawnEnemyNearby(count = 1) {
    try { if (godSpawnEnemyNearbyFacade(getCtx(), count)) return; } catch (_) {}
    log("GOD: spawnEnemyNearby not available.", "warn");
  }

  
  function renderInventoryPanel() {
    try { renderInventoryPanelFacade(getCtx()); } catch (_) {}
  }

  function showInventoryPanel() {
    try { showInventoryPanelFacade(getCtx()); } catch (_) {}
  }

  function hideInventoryPanel() {
    try { hideInventoryPanelFacade(getCtx()); } catch (_) {}
  }

  function equipItemByIndex(idx) {
    try { equipItemByIndexFacade(getCtx(), idx); return; } catch (_) {}
    log("Equip system not available.", "warn");
  }

  function equipItemByIndexHand(idx, hand) {
    try { equipItemByIndexHandFacade(getCtx(), idx, hand); return; } catch (_) {}
    log("Equip system not available.", "warn");
  }

  function unequipSlot(slot) {
    try { unequipSlotFacade(getCtx(), slot); return; } catch (_) {}
    log("Equip system not available.", "warn");
  }

  

  function showGameOver() {
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.showGameOver === "function") {
      UIO.showGameOver(getCtx());
      requestDraw();
    }
  }

  // GOD: always-crit toggle (delegated to core/god_facade.js)
  function setAlwaysCrit(v) {
    try {
      const ok = setAlwaysCritFacade(getCtx(), v);
      if (ok) { alwaysCrit = !!v; return; }
    } catch (_) {}
    log("GOD: setAlwaysCrit not available.", "warn");
  }

  // GOD: set forced crit body part for player attacks (delegated to core/god_facade.js)
  function setCritPart(part) {
    try {
      const ok = setCritPartFacade(getCtx(), part);
      if (ok) { forcedCritPart = part; return; }
    } catch (_) {}
    log("GOD: setCritPart not available.", "warn");
  }

  // GOD: apply a deterministic RNG seed and regenerate current map (delegated)
  function applySeed(seedUint32) {
    const GC = modHandle("GodControls");
    if (GC && typeof GC.applySeed === "function") {
      const ctx = getCtx();
      GC.applySeed(() => getCtx(), seedUint32);
      rng = ctx.rng || rng;
      applyCtxSyncAndRefresh(ctx);
      return;
    }
    log("GOD: applySeed not available.", "warn");
  }

  // GOD: reroll seed using current time (delegated)
  function rerollSeed() {
    // Always clear persisted game states before rerolling to avoid cross-seed leaks
    try { clearPersistentGameStorage(); } catch (_) {}
    const GC = modHandle("GodControls");
    if (GC && typeof GC.rerollSeed === "function") {
      const ctx = getCtx();
      GC.rerollSeed(() => getCtx());
      rng = ctx.rng || rng;
      applyCtxSyncAndRefresh(ctx);
      return;
    }
    log("GOD: rerollSeed not available.", "warn");
  }

  function hideGameOver() {
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.hideGameOver === "function") {
      UIO.hideGameOver(getCtx());
    }
  }

  // Clear persisted game state (towns, dungeons, region map) via core/persistence.js
  function clearPersistentGameStorage() {
    try { clearPersistentGameStorageExt(getCtx()); } catch (_) {}
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
    clearPersistentGameStorage();
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
    log("XP system not available.", "warn");
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
    // Fallback: module-only; minimal corpse + removal
    const name = capitalize(enemy.type || "enemy");
    log(`${name} dies.`, "bad");
    corpses.push({ x: enemy.x, y: enemy.y, loot: [], looted: true });
    enemies = enemies.filter(e => e !== enemy);
    try { if (occupancy && typeof occupancy.clearEnemy === "function") occupancy.clearEnemy(enemy.x, enemy.y); } catch (_) {}
    gainXP(enemy.xp || 5);
  }

  
  function updateUI() {
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.updateStats === "function") {
      UIO.updateStats(getCtx());
    }
  }


  
  

  

  

  
  

  
  // Lightweight hint: delegated to core/world_hints.js
  function maybeEmitOverworldAnimalHint() {
    try {
      const ctx = getCtx();
      maybeEmitOverworldAnimalHintExt(ctx, getTurnCounter());
    } catch (_) {}
  }

  function turn() {
    if (isDead) return;

    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

    // Advance global time and visual weather state (non-gameplay)
    tickTimeAndWeather((msg, type) => log(msg, type), () => (typeof rng === "function" ? rng() : Math.random()));

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
        try { perfMeasureTurn(t1 - t0); } catch (_) {}
        return;
      }
    } catch (_) {}

    
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
          onEat: (idx) => eatFoodByIndex(idx),
          onRestart: () => restartGame(),
          onWait: () => turn()
        });
      }
      // Install GOD-specific handlers via dedicated module
      try {
        const GH = modHandle("GodHandlers");
        if (GH && typeof GH.install === "function") {
          GH.install(() => getCtx());
        }
      } catch (_) {}
    }
  }

  // Hand decay helpers delegated to inventory_decay facade
  function usingTwoHanded() {
    return invUsingTwoHanded(getCtx());
  }

  function decayAttackHands(light = false) {
    invDecayAttackHands(getCtx(), light);
  }

  function decayBlockingHands() {
    invDecayBlockingHands(getCtx());
  }

  
  // Orchestrator-controlled boot: these actions are now exposed as functions and invoked from core/game_orchestrator.js

  // Initialize mouse/click support (was previously executed at import time)
  export function initMouseSupport() {
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
            const UIO = modHandle("UIOrchestration");
            return !!(UIO && typeof UIO.isAnyModalOpen === "function" && UIO.isAnyModalOpen(getCtx()));
          },
        });
      }
    } catch (_) {}
  }

  // Start the render loop (or draw once if loop module is unavailable)
  export function startLoop() {
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

  // Request a redraw once assets (e.g., tiles.json) have fully loaded
  export function scheduleAssetsReadyDraw() {
    try {
      if (typeof window !== "undefined" && window.GameData && window.GameData.ready && typeof window.GameData.ready.then === "function") {
        window.GameData.ready.then(() => {
          // Request a draw which will rebuild offscreen caches against the now-loaded tiles.json
          requestDraw();
        });
      }
    } catch (_) {}
  }

  // Build and expose GameAPI facade (previously executed at import time)
  export function buildGameAPI() {
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
          getPerfStats: () => perfGetPerfStats(),
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
          getWeather: () => getWeatherSnapshot(),
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
            const ctx = getCtx();
            const RM = modHandle("RegionMapRuntime");
            if (RM && typeof RM.open === "function") {
              const ok = !!RM.open(ctx);
              if (ok) applyCtxSyncAndRefresh(ctx);
              return ok;
            }
            return false;
          },
          // Start an encounter inside the active Region Map (ctx.mode === "region")
          startRegionEncounter: (template, biome) => {
            const ctx = getCtx();
            const ER = modHandle("EncounterRuntime");
            if (ER && typeof ER.enterRegion === "function") {
              let difficulty = 1;
              try {
                const ES = modHandle("EncounterService");
                if (ES && typeof ES.computeDifficulty === "function") {
                  difficulty = ES.computeDifficulty(ctx, biome);
                } else {
                  const p = ctx.player || {};
                  const pl = (typeof p.level === "number") ? p.level : 1;
                  difficulty = Math.max(1, Math.min(5, 1 + Math.floor((pl - 1) / 2)));
                }
              } catch (_) {}
              const ok = !!ER.enterRegion(ctx, { template, biome, difficulty });
              if (ok) {
                applyCtxSyncAndRefresh(ctx);
              }
              return ok;
            }
            return false;
          },
          // Complete the active encounter immediately and sync back to orchestrator state.
          // Used by special flows like caravan encounters to return to the overworld without
          // requiring the player to walk to an exit tile.
          completeEncounter: (outcome = "victory") => {
            const ER = modHandle("EncounterRuntime");
            if (ER && typeof ER.complete === "function") {
              const ctx = getCtx();
              const encounterId = String(ctx.encounterInfo && ctx.encounterInfo.id || "").toLowerCase();
              const wasCaravanAmbush = encounterId === "caravan_ambush";
              ER.complete(ctx, outcome);
              applyCtxSyncAndRefresh(ctx);
              try {
                const w = ctx.getWorld ? ctx.getWorld() : ctx.world;
                const escort = w && w.caravanEscort;
                if (wasCaravanAmbush && escort && escort.active && window.GameAPI && window.GameAPI.getMode && window.GameAPI.getMode() === "world") {
                  startEscortAutoTravel();
                }
              } catch (_) {}
              return true;
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
  }


// ESM exports for module consumers
export {
  getCtx,
  requestDraw,
  initWorld,
  setupInput,
  generateLevel,
  tryMovePlayer,
  doAction,
  descendIfPossible,
  applySeed,
  rerollSeed,
  setFovRadius,
  updateUI
};
