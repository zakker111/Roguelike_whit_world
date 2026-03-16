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
  applySyncAndRefresh as gameStateApplySyncAndRefresh,
  syncFromCtxWithSink as gameStateSyncFromCtxWithSink
} from "./state/game_state.js";
import "./modes/transitions.js";
import { createGameModeOps } from "./engine/game_mode_ops.js";
import {
  initMouseSupportImpl,
  startLoopImpl,
  scheduleAssetsReadyDrawImpl,
} from "./game_bootstrap.js";
import { createGodBridge } from "./game_god_bridge.js";
import { buildGameAPIImpl } from "./game_api_bootstrap.js";
import { godSeedAndRestart } from "./engine/game_god.js";
import { applySessionBootFlagsFromUrl } from "./engine/session_boot.js";
import { createGameCanvasRuntime } from "./engine/canvas_boot.js";
import { createInitialPlayer } from "./engine/player_boot.js";
import { initRngRuntime } from "./engine/rng_boot.js";
import {
  initGameTime,
  getClock as gameTimeGetClock,
  getWeatherSnapshot as gameTimeGetWeatherSnapshot,
} from "./engine/game_time.js";
import { runTurn } from "./engine/game_turn.js";
import { recomputeWithGuard as gameFovRecomputeWithGuard } from "./engine/game_fov.js";
import { updateCamera as fovCameraUpdate } from "./engine/fov_camera.js";
import { createInitialModeState } from "./engine/mode_state.js";
import {
  tickTimeAndWeather,
  getMinutesPerTurn,
  getTurnCounter
} from "./facades/time_weather.js";
import { measureTurn as perfMeasureTurn, getPerfStats as perfGetPerfStats } from "./facades/perf.js";
import { getRawConfig, getViewportDefaults, getWorldDefaults, getFovDefaults, getDevDefaults } from "./facades/config.js";
import { TILES as TILES_CONST, getColors as getColorsConst } from "./facades/visuals.js";
import { log as logFacade } from "./facades/log.js";
import { int as rngInt, chance as rngChance, float as rngFloat } from "./facades/rng.js";
import { createGameCombatOps } from "./engine/game_combat_ops.js";
import { createGameInventoryOps } from "./engine/game_inventory_ops.js";
import { createGameMapOps } from "./engine/game_map_ops.js";
import { createGameRenderOps } from "./engine/game_render_ops.js";
import { createGameTimeOps } from "./engine/game_time_ops.js";
import { createGameShopOps } from "./engine/game_shop_ops.js";
import { createGameWorldOps } from "./engine/game_world_ops.js";
import { setupInputBridge, initUIHandlersBridge } from "./engine/game_ui_bridge.js";
// Side-effect import to ensure FollowersItems attaches itself to window.FollowersItems
import "./followers_items.js";
// Side-effect import to ensure SandboxRuntime attaches itself to window.SandboxRuntime
import "./sandbox/runtime.js";

  // Runtime configuration (loaded via GameData.config via core/game_config.js)
  const CFG = getRawConfig();
  const { TILE, COLS, ROWS } = getViewportDefaults(CFG);
  const { MAP_COLS, MAP_ROWS } = getWorldDefaults(CFG);

  // Fresh session (no localStorage) support via URL params: ?fresh=1 or ?reset=1 or ?nolocalstorage=1
  applySessionBootFlagsFromUrl();

  const { FOV_DEFAULT, FOV_MIN, FOV_MAX } = getFovDefaults(CFG);
  let fovRadius = FOV_DEFAULT;

  // Initialize global time and weather runtime (shared across modes)
  initGameTime(CFG);

  // Game modes: "world" (overworld) or "dungeon" (roguelike floor)
  let {
    mode,
    world,          // { map, width, height, towns, dungeons }
    // Region map overlay state (fixed-size downscaled world view)
    region,         // { width, height, map:number[][], cursor:{x,y}, exitTiles:[{x,y}], enterWorldPos:{x,y} }
    npcs,           // simple NPCs for town mode: { x, y, name, lines:[] }
    shops,          // shops in town mode: [{x,y,type,name}]
    townProps,      // interactive town props: [{x,y,type,name}]
    townBuildings,  // town buildings: [{x,y,w,h,door:{x,y}}]
    townPlaza,      // central plaza coordinates {x,y}
    tavern,         // tavern info: { building:{x,y,w,h,door}, door:{x,y} }
    // Inn upstairs overlay state
    innUpstairs,    // { offset:{x,y}, w, h, tiles:number[][], props:[{x,y,type,name}] }
    innUpstairsActive,
    innStairsGround, // [{x,y},{x,y}] two ground-floor stairs tiles inside inn hall

    // World/town/dungeon transition anchors
    townExitAt,     // gate position inside town used to exit back to overworld
    worldReturnPos, // overworld position to return to after leaving town/dungeon
    dungeonExitAt,  // dungeon tile to return to overworld
    cameFromWorld,  // whether we entered dungeon from overworld
    currentDungeon, // info for current dungeon entrance: { x,y, level, size }
    // Multi-floor tower runtime state (managed by DungeonRuntime).
    // Stored here so it survives across getCtx() calls.
    towerRun,
  } = createInitialModeState();
  // Persist dungeon states by overworld entrance coordinate "x,y"
  const dungeonStates = Object.create(null);

  // Global time-of-day cycle and visual weather (shared across modes) are managed via
  // the time_weather facade. This keeps core/game.js focused on orchestration logic.
  function getClock() {
    return gameTimeGetClock();
  }

  function getWeatherSnapshot(time) {
    return gameTimeGetWeatherSnapshot(time);
  }

  
  const { canvas, ctx, camera } = createGameCanvasRuntime({ COLS, ROWS, TILE });

  
  const TILES = TILES_CONST;
  const COLORS = getColorsConst();

  
  

  
  let map = [];
  let seen = [];
  let visible = [];
  let player = createInitialPlayer();
  let enemies = [];
  let corpses = [];
  // Visual decals like blood stains on the floor; array of { x, y, a (alpha 0..1), r (radius px) }
  let decals = [];
  // Encounter visuals
  let encounterProps = [];
  let encounterBiome = null;
  let encounterObjective = null;
  // Active encounter template metadata (id/name). Needed across ctx recreations.
  let encounterInfo = null;
  // Dungeon decorative props (e.g., wall torches)
  let dungeonProps = [];
  // Occupancy Grid (entities on tiles)
  let occupancy = null;
  
  let floor = 1;
  // RNG: centralized via RNG service; allow persisted seed for reproducibility
  const rngRuntime = initRngRuntime();
  const currentSeed = rngRuntime.currentSeed;
  let rng = rngRuntime.rng;
  void currentSeed;
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

  // Sandbox runtime flags and enemy overrides (sandbox-only debug helpers).
  // Flags are shallow-copied onto ctx via getCtx() so UI/AI can toggle them.
  let sandboxFlags = { fovEnabled: true, aiEnabled: true };
  let sandboxEnemyOverrides = Object.create(null);

  
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
      towerRun,
      // persistence (in-memory)
      _dungeonStates: dungeonStates,
      time: getClock(),
      weather: getWeatherSnapshot(),
      // Sandbox debug state
      isSandbox: mode === "sandbox",
      sandboxFlags,
      sandboxEnemyOverrides,
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
      getPlayerAttack, getPlayerDefense, getPlayerBlockChance, getEnemyBlockChance,
      enemyThreatLabel,
      // Needed by loot and UI flows
      updateUI: () => updateUI(),
      initialDecay,
      equipIfBetter,
      addPotionToInventory,
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
      decayAttackHands,
      decayBlockingHands,
      decayEquipped,
      rerenderInventoryIfOpen,
      onPlayerDied: () => {
        // GOD invincibility: player can still take damage as usual but
        // immediately heals back and cannot die while enabled.
        try {
          if (typeof window !== "undefined" && window.GOD_INVINCIBLE) {
            player.hp = player.maxHp;
            updateUI();
            log("GOD: Invincible — damage ignored.", "notice");
            return;
          }
        } catch (_) {}
        isDead = true;
        updateUI();
        log("You die. Press R or Enter to restart.", "info");
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

  const combatOps = createGameCombatOps(getCtx);
  const {
    getPlayerAttack,
    getPlayerDefense,
    rollHitLocation,
    critMultiplier,
    getEnemyBlockChance,
    getPlayerBlockChance,
    enemyDamageAfterDefense,
    enemyDamageMultiplier,
    enemyThreatLabel,
  } = combatOps;

  const inventoryOps = createGameInventoryOps(getCtx);
  const {
    initialDecay,
    rerenderInventoryIfOpen,
    decayEquipped,
    decayAttackHands,
    decayBlockingHands,
    describeItem,
    equipIfBetter,
    addPotionToInventory,
    drinkPotionByIndex,
    eatFoodByIndex,
    useItemByIndex,
    renderInventoryPanel,
    showInventoryPanel,
    hideInventoryPanel,
    equipItemByIndex,
    equipItemByIndexHand,
    unequipSlot,
  } = inventoryOps;

  // Prefer ctx module handles over window.* where possible
  function modHandle(name) {
    try {
      const c = getCtx();
      if (c && c[name]) return c[name];
    } catch (_) {}
    if (typeof window !== "undefined" && window[name]) return window[name];
    return null;
  }

  const mapOps = createGameMapOps(getCtx);
  const renderOps = createGameRenderOps(getCtx);
  const timeOps = createGameTimeOps({
    getCtx,
    log,
    rng: () => (typeof rng === "function" ? rng() : Math.random()),
    modHandle,
  });

  const shopOps = createGameShopOps({ getCtx, modHandle });
  const worldOps = createGameWorldOps({
    getCtx,
    applyCtxSyncAndRefresh,
    modHandle,
    MAP_COLS,
    MAP_ROWS,
  });

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

  
  

  
  function log(msg, type = "info", details = null) {
    try { logFacade(getCtx(), msg, type, details); } catch (_) {
      try { console.log(`[${type}] ${msg}`); } catch (_) {}
    }
  }

  
  
  function generateLevel(depth = 1) {
    const DR = modHandle("DungeonRuntime");
    if (!DR || typeof DR.generate !== "function") {
      throw new Error("DungeonRuntime.generate missing; dungeon generation cannot proceed");
    }
    const ctx = getCtx();
    ctx.startRoomRect = startRoomRect;
    DR.generate(ctx, depth);
    // Sync back references mutated by the module
    syncFromCtx(ctx);
    startRoomRect = ctx.startRoomRect || startRoomRect;
  }

  function inBounds(x, y) {
    return mapOps.inBounds(x, y);
  }

  
  



  function isWalkable(x, y) {
    return mapOps.isWalkable(x, y);
  }

  

  

  function recomputeFOV() {
    const ctx = getCtx();
    ctx.seen = seen;
    ctx.visible = visible;
    gameFovRecomputeWithGuard(ctx);
    visible = ctx.visible;
    seen = ctx.seen;
  }

  
  function updateCamera() {
    fovCameraUpdate(getCtx());
  }

  
  function getRenderCtx() {
    return renderOps.getRenderCtx();
  }

  function requestDraw() {
    renderOps.requestDraw();
  }

  

  

  function initWorld() {
    worldOps.initWorld();
  }

  // Enter a small sandbox dungeon-style room for focused testing (no persistence).
  function enterSandboxRoom() {
    try {
      const ctx = getCtx();
      if (!ctx) return false;
      const SR = ctx.SandboxRuntime || modHandle("SandboxRuntime");
      if (!SR || typeof SR.enter !== "function") {
        log("GOD: SandboxRuntime.enter not available; sandbox mode disabled.", "warn");
        return false;
      }
      // Mutate ctx into sandbox mode and let orchestrator sync + refresh.
      SR.enter(ctx, { scenario: "dungeon_room" });
      // Reset sandbox-specific debug state on entering sandbox.
      try {
        sandboxFlags = ctx.sandboxFlags || sandboxFlags || { fovEnabled: true, aiEnabled: true };
      } catch (_) {}
      try {
        sandboxEnemyOverrides = Object.create(null);
      } catch (_) {}
      applyCtxSyncAndRefresh(ctx);
      try {
        log("Sandbox: Entered dungeon test room. Press F10 for Sandbox Controls panel.", "info");
      } catch (_) {}
      return true;
    } catch (e) {
      try {
        log("GOD: Sandbox entry failed; see console for details.", "warn");
        // eslint-disable-next-line no-console
        console.error(e);
      } catch (_) {}
      return false;
    }
  }

  

  

  // Town shops helpers routed via ShopService (delegated)
  function isShopOpenNow(shop = null) {
    return shopOps.isShopOpenNow(shop);
  }
  function shopScheduleStr(shop) {
    return shopOps.shopScheduleStr(shop);
  }
  function minutesUntil(hourTarget /*0-23*/, minuteTarget = 0) {
    return timeOps.minutesUntil(hourTarget, minuteTarget);
  }
  function advanceTimeMinutes(mins) {
    timeOps.advanceTimeMinutes(mins);
  }
  // Run a number of turns equivalent to the given minutes so NPCs/AI act during time passage.
  function fastForwardMinutes(mins) {
    return timeOps.fastForwardMinutes(mins);
  }

  
  

  

  function syncFromCtx(ctx) {
    if (!ctx) return;
    gameStateSyncFromCtxWithSink(ctx, {
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
      setEncounterInfo: (v) => { if (typeof v !== "undefined") encounterInfo = v; },
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
      setTowerRun: (v) => { if (typeof v !== "undefined") towerRun = v; },
    });
  }

  // Helper: apply ctx sync and refresh visuals/UI in one place
  function applyCtxSyncAndRefresh(ctx) {
    // First sync orchestrator-local state from the mutated ctx
    syncFromCtx(ctx);
    // Then refresh camera/FOV/UI/draw via GameState helper using a fresh ctx view
    try {
      const refreshedCtx = getCtx();
      gameStateApplySyncAndRefresh(refreshedCtx);
    } catch (_) {}
  }

  /**
   * Auto-escort travel: thin wrapper to a dedicated helper so core/game.js
   * stays focused on orchestration. The actual timed loop lives in the
   * WorldRuntime or a dedicated world/escort helper.
   */
  function startEscortAutoTravel() {
    worldOps.startEscortAutoTravel();
  }

  

  const modeOps = createGameModeOps({
    getCtx,
    applyCtxSyncAndRefresh,
    log,
    modHandle
  });

  function enterTownIfOnTile() {
    return modeOps.enterTownIfOnTile();
  }

  function enterDungeonIfOnEntrance() {
    return modeOps.enterDungeonIfOnEntrance();
  }

  function leaveTownNow() {
    modeOps.leaveTownNow();
  }

  function requestLeaveTown() {
    modeOps.requestLeaveTown();
  }

  function returnToWorldFromTown() {
    return modeOps.returnToWorldFromTown();
  }

  function returnToWorldIfAtExit() {
    return modeOps.returnToWorldIfAtExit();
  }

  // Context-sensitive action button (G): enter/exit/interact depending on mode/state
  function doAction() {
    const ctx = getCtx();
    const A = modHandle("Actions");
    if (A && typeof A.doAction === "function") {
      const handled = !!A.doAction(ctx);
      if (handled) {
        applyCtxSyncAndRefresh(ctx);
      }
    }
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
    setupInputBridge({
      modHandle,
      getCtx,
      isDead: () => isDead,
      getFovRadius: () => fovRadius,
      restartGame,
      showInventoryPanel,
      hideInventoryPanel,
      hideLootPanel,
      tryMovePlayer,
      turn,
      doAction,
      descendIfPossible,
      brace,
      adjustFov,
    });
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
    log("Nothing to loot here.", "info");
  }

  function showLootPanel(list) {
    const LF = modHandle("LootFlow");
    if (LF && typeof LF.show === "function") {
      LF.show(getCtx(), list);
      return;
    }
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.showLoot === "function") {
      UIO.showLoot(getCtx(), list);
    }
  }

  function hideLootPanel() {
    const LF = modHandle("LootFlow");
    if (LF && typeof LF.hide === "function") {
      LF.hide(getCtx());
      return;
    }
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.hideLoot === "function") {
      UIO.hideLoot(getCtx());
    }
  }

  
  // GOD mode actions (delegated via core/game_god_bridge.js)
  const godBridge = createGodBridge({
    getCtx,
    log,
    applyCtxSyncAndRefresh,
    setAlwaysCritFlag: (v) => { alwaysCrit = !!v; },
    setForcedCritPartFlag: (part) => { forcedCritPart = part; },
    setRng: (newRng) => { rng = newRng || rng; },
    setFloor: (v) => { floor = (typeof v === "number") ? (v | 0) : floor; },
    setIsDead: (v) => { isDead = !!v; },
    getPlayer: () => player,
    setModeWorld: () => { mode = "world"; },
    initWorld: () => initWorld(),
    modHandle,
    hideGameOver: () => hideGameOver(),
    // Legacy seed/restart helpers so behavior stays identical
    applySeed: (seedUint32) => {
      const helpers = godSeedAndRestart({
        getCtx: () => getCtx(),
        applyCtxSyncAndRefresh,
        clearPersistentGameStorage: () => {
          try { clearPersistentGameStorageExt(getCtx()); } catch (_) {}
        },
        log,
        onRngUpdated: (newRng) => { rng = newRng || rng; },
      });
      helpers.applySeed(seedUint32);
    },
    rerollSeed: () => {
      const helpers = godSeedAndRestart({
        getCtx: () => getCtx(),
        applyCtxSyncAndRefresh,
        clearPersistentGameStorage: () => {
          try { clearPersistentGameStorageExt(getCtx()); } catch (_) {}
        },
        log,
        onRngUpdated: (newRng) => { rng = newRng || rng; },
      });
      helpers.rerollSeed();
    },
    restartGame: () => {
      const helpers = godSeedAndRestart({
        getCtx: () => getCtx(),
        applyCtxSyncAndRefresh,
        clearPersistentGameStorage: () => {
          try { clearPersistentGameStorageExt(getCtx()); } catch (_) {}
        },
        log,
        onRngUpdated: (newRng) => { rng = newRng || rng; },
      });
      // Call DeathFlow-based restart if present, but always also run the local reset path
      try {
        helpers.restartGame();
      } catch (_) {}

      // Local reset path (original core/game.js behavior)
      hideGameOver();
      try { clearPersistentGameStorageExt(getCtx()); } catch (_) {}
      floor = 1;
      isDead = false;
      try {
        const ctx = getCtx();
        try { ctx.isDead = false; } catch (_) {}
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
    },
  });

  const {
    setAlwaysCrit,
    setCritPart,
    godHeal,
    godSpawnStairsHere,
    godSpawnItems,
    godSpawnEnemyNearby,
    godSpawnEnemyById,
    applySeed,
    rerollSeed,
    restartGame,
  } = godBridge;

  
  

  

  function showGameOver() {
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.showGameOver === "function") {
      UIO.showGameOver(getCtx());
      requestDraw();
    }
  }

  function hideGameOver() {
    const UIO = modHandle("UIOrchestration");
    if (UIO && typeof UIO.hideGameOver === "function") {
      UIO.hideGameOver(getCtx());
    }
  }

  
  function gainXP(amount) {
    const P = modHandle("Player");
    if (!P || typeof P.gainXP !== "function") {
      throw new Error("Player.gainXP missing; XP system cannot proceed");
    }
    P.gainXP(player, amount, { log, updateUI });
  }

  function killEnemy(enemy) {
    // Delegate enemy death handling (loot, XP, occupancy, persistence) to
    // DungeonRuntime.killEnemy, which now owns the full implementation.
    const DR = modHandle("DungeonRuntime");
    if (!DR || typeof DR.killEnemy !== "function") {
      throw new Error("DungeonRuntime.killEnemy missing; enemy death handling cannot proceed");
    }
    const ctx = getCtx();
    DR.killEnemy(ctx, enemy);
    syncFromCtx(ctx);
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

    runTurn({
      getCtx: () => getCtx(),
      getMode: () => mode,
      tickTimeAndWeather,
      log,
      rng: () => (typeof rng === "function" ? rng() : Math.random()),
      applyCtxSyncAndRefresh,
      maybeEmitOverworldAnimalHint,
      perfMeasureTurn,
    });
  }
  
  

  {
    initUIHandlersBridge({
      modHandle,
      getCtx,
      equipItemByIndex,
      equipItemByIndexHand,
      unequipSlot,
      drinkPotionByIndex,
      eatFoodByIndex,
      useItemByIndex,
      restartGame,
      turn,
      getFovRadius: () => fovRadius,
    });
  }

  

  
  // Orchestrator-controlled boot: these actions are now exposed as functions and invoked from core/game_orchestrator.js

  // Initialize mouse/click support (was previously executed at import time)
  export function initMouseSupport() {
    return initMouseSupportImpl({
      modHandle,
      getCtx,
      getMode: () => mode,
      TILE,
      getCamera: () => camera,
      getPlayer: () => ({ x: player.x, y: player.y }),
      getCorpses: () => corpses,
      getEnemies: () => enemies,
      inBounds,
      isWalkable,
      tryMovePlayer,
      lootCorpse,
      doAction,
    });
  }

  // Start the render loop (or draw once if loop module is unavailable)
  export function startLoop() {
    return startLoopImpl({
      modHandle,
      getRenderCtx: () => getRenderCtx(),
    });
  }

  // Request a redraw once assets (e.g., tiles.json) have fully loaded
  export function scheduleAssetsReadyDraw() {
    return scheduleAssetsReadyDrawImpl({
      requestDraw: () => requestDraw(),
    });
  }

  // Build and expose GameAPI facade (previously executed at import time)
  export function buildGameAPI() {
    buildGameAPIImpl({
      getCtx,
      modHandle,
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
      tryMovePlayer,
      enterTownIfOnTile,
      enterDungeonIfOnEntrance,
      isWalkable,
      inBounds,
      updateCamera,
      recomputeFOV,
      requestDraw,
      updateUI,
      renderInventoryPanel,
      equipItemByIndex,
      equipItemByIndexHand,
      unequipSlot,
      drinkPotionByIndex,
      addPotionToInventory,
      getPlayerAttack,
      getPlayerDefense,
      isShopOpenNow,
      shopScheduleStr,
      advanceTimeMinutes,
      getWeatherSnapshot,
      returnToWorldIfAtExit,
      returnToWorldFromTown,
      initWorld,
      startEscortAutoTravel,
      setAlwaysCrit,
      setCritPart,
      godSpawnEnemyNearby,
      godSpawnEnemyById,
      godSpawnItems,
      generateLoot,
      getClock,
      log,
      applyCtxSyncAndRefresh,
      enterSandboxRoom: () => enterSandboxRoom(),
    });
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
