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

    // Normalize slot: "hand" items must choose left or right (and may be two-handed)
    const eq = player.equipment || {};
    const score = (it) => (it ? ((it.atk || 0) + (it.def || 0)) : -Infinity);

    if (item.slot === "hand") {
      // Two-handed: occupies both hands; compare against combined current hand score
      if (item.twoHanded) {
        const currentLeft = eq.left || null;
        const currentRight = eq.right || null;
        const currentScore = score(currentLeft) + score(currentRight);
        const newScore = (item.atk || 0) + (item.def || 0); // treat two-handed as single score; it's usually higher atk
        const better = !currentLeft && !currentRight ? true : (newScore > currentScore + 1e-9);
        if (!better) return false;

        // Equip two-handed: same object in both hands to preserve decay semantics elsewhere
        eq.left = item;
        eq.right = item;
        const parts = [];
        if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
        if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
        const statStr = parts.join(", ");
        log(`You equip ${item.name} (two-handed${statStr ? ", " + statStr : ""}).`);
        updateUI();
        renderInventoryPanel();
        return true;
      }

      // One-handed: prefer empty hand; otherwise replace the weaker hand
      const leftScore = score(eq.left);
      const rightScore = score(eq.right);
      const newScore = (item.atk || 0) + (item.def || 0);

      let target = null;
      if (!eq.left) target = "left";
      else if (!eq.right) target = "right";
      else target = leftScore <= rightScore ? "left" : "right";

      const curScore = target === "left" ? leftScore : rightScore;
      const better = !eq[target] || newScore > curScore + 1e-9;
      if (!better) return false;

      eq[target] = item;
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      log(`You equip ${item.name} (${target}${statStr ? ", " + statStr : ""}).`);
      updateUI();
      renderInventoryPanel();
      return true;
    }

    // Non-hand slots ("head","torso","legs","hands")
    const slot = item.slot;
    const current = eq[slot];
    const newScore = (item.atk || 0) + (item.def || 0);
    const curScore = score(current);
    const better = !current || newScore > curScore + 1e-9;

    if (better) {
      eq[slot] = item;
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
    const D = modHandle("Dungeon");
    if (D && typeof D.generateLevel === "function") {
      const ctx = getCtx();
      ctx.startRoomRect = startRoomRect;
      D.generateLevel(ctx, depth);
      // Sync back references mutated by the module
      map = ctx.map;
      seen = ctx.seen;
      visible = ctx.visible;
      enemies = ctx.enemies;
      corpses = ctx.corpses;
      startRoomRect = ctx.startRoomRect;
      // Clear decals on new floor
      decals = [];
      // Invalidate FOV cache and recompute
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
      // Unified message: dungeons are single-level; exploration only
      log("You explore the dungeon.");
      // Save initial dungeon state snapshot (log once on entry)
      saveCurrentDungeonState(true);
      requestDraw();
      return;
    }
    // Fallback: flat-floor map
    map = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(TILES.FLOOR));
    // Ensure a staircase exists in the fallback map
    const sy = Math.max(1, MAP_ROWS - 2), sx = Math.max(1, MAP_COLS - 2);
    if (map[sy] && typeof map[sy][sx] !== "undefined") {
      map[sy][sx] = TILES.STAIRS;
    }
    enemies = [];
    corpses = [];
    decals = [];
    // Invalidate FOV cache and recompute
    _lastMapCols = -1; _lastMapRows = -1; _lastMode = ""; _lastPlayerX = -1; _lastPlayerY = -1;
    recomputeFOV();
    updateCamera();
    updateUI();
    // Unified message: dungeons are single-level; exploration only
    log("You explore the dungeon.");
    // Save fallback dungeon state as well (log once on entry)
    saveCurrentDungeonState(true);
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

  function saveCurrentDungeonState(logOnce = false) {
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
    if (window.DungeonState && typeof DungeonState.load === "function") {
      const ctxMod = getCtx();
      const ok = DungeonState.load(ctxMod, x, y);
      if (ok) {
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
    // Re-entry message is logged centrally in DungeonState.applyState to avoid duplicates.
    requestDraw();
    return true;
  }

  function isWalkable(x, y) {
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
    if (window.ShopService && typeof ShopService.shopAt === "function") {
      return ShopService.shopAt(getCtx(), x, y);
    }
    if (!Array.isArray(shops)) return null;
    return shops.find(s => s.x === x && s.y === y) || null;
  }
  // Shop schedule helpers (delegated to ShopService)
  function minutesOfDay(h, m = 0) {
    if (window.ShopService && typeof ShopService.minutesOfDay === "function") {
      return ShopService.minutesOfDay(h, m, DAY_MINUTES);
    }
    return ((h | 0) * 60 + (m | 0)) % DAY_MINUTES;
  }
  function isOpenAt(shop, minutes) {
    if (window.ShopService && typeof ShopService.isOpenAt === "function") {
      return ShopService.isOpenAt(shop, minutes);
    }
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    const o = shop.openMin, c = shop.closeMin;
    if (o === c) return false;
    return c > o ? (minutes >= o && minutes < c) : (minutes >= o || minutes < c);
  }
  function isShopOpenNow(shop = null) {
    if (window.ShopService && typeof ShopService.isShopOpenNow === "function") {
      return ShopService.isShopOpenNow(getCtx(), shop || null);
    }
    const t = getClock();
    const minutes = t.hours * 60 + t.minutes;
    if (!shop) return t.phase === "day";
    return isOpenAt(shop, minutes);
  }
  function shopScheduleStr(shop) {
    if (window.ShopService && typeof ShopService.shopScheduleStr === "function") {
      return ShopService.shopScheduleStr(shop);
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
    const Tn = modHandle("Town");
    if (Tn && typeof Tn.generate === "function") {
      const ctx = getCtx();
      const handled = Tn.generate(ctx);
      if (handled) {
        // Sync back mutated references
        map = ctx.map; seen = ctx.seen; visible = ctx.visible;
        enemies = ctx.enemies; corpses = ctx.corpses; decals = ctx.decals || [];
        npcs = ctx.npcs || []; shops = ctx.shops || [];
        townProps = ctx.townProps || []; townBuildings = ctx.townBuildings || [];
        townPlaza = ctx.townPlaza || null; tavern = ctx.tavern || null;
        townExitAt = ctx.townExitAt || townExitAt; townName = ctx.townName || townName;
        // Ensure greeters on entry to give immediate life at the gate
        {
          const Tn2 = modHandle("Town");
          if (Tn2 && typeof Tn2.spawnGateGreeters === "function") {
            // Town.generate already ensures a greeter; do not spawn additional here.
            Tn2.spawnGateGreeters(ctx, 0);
            npcs = ctx.npcs || npcs;
          }
        }
        updateCamera(); recomputeFOV(); updateUI(); requestDraw();
        return;
      }
    }
    log("Town module missing; unable to generate town.", "warn");
  }

  function ensureTownSpawnClear() {
    {
      const Tn = modHandle("Town");
      if (Tn && typeof Tn.ensureSpawnClear === "function") {
        Tn.ensureSpawnClear(getCtx());
        return;
      }
    }
    log("Town.ensureSpawnClear not available.", "warn");
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
    {
      const Tn = modHandle("Town");
      if (Tn && typeof Tn.spawnGateGreeters === "function") {
        Tn.spawnGateGreeters(getCtx(), count);
        return;
      }
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
    // Handle confirm here so we can sync locals after leaving
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
    if (townExitAt && player.x === townExitAt.x && player.y === townExitAt.y) {
      // Immediate exit on gate when pressing G (disable confirm UI)
      leaveTownNow();
      return true;
    }
    log("Return to the town gate to exit to the overworld.", "info");
    return false;
  }

  function returnToWorldIfAtExit() {
    if (window.Modes && typeof Modes.returnToWorldIfAtExit === "function") {
      const ctx = getCtx();
      const ok = Modes.returnToWorldIfAtExit(ctx);
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
    if (window.Loot && typeof Loot.generate === "function") {
      return Loot.generate(getCtx(), source);
    }
    return [];
  }

  
  function interactTownProps() {
    if (window.Town && typeof Town.interactProps === "function") {
      return !!Town.interactProps(getCtx());
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
    if (window.UI && typeof UI.showLoot === "function") {
      // Only request a redraw if the UI module actually opened/changed state
      UI.showLoot(list);
      requestDraw();
    }
  }

  function hideLootPanel() {
    if (window.UI && typeof UI.hideLoot === "function") {
      const wasOpen = (typeof UI.isLootOpen === "function") ? UI.isLootOpen() : true;
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

  // ---------------- Simple Shop UI (fallback) ----------------
  let currentShopStock = null; // [{item, price}]
  function priceFor(item) {
    if (!item) return 10;
    if (item.kind === "potion") {
      const h = item.heal != null ? item.heal : 5;
      return Math.max(5, Math.min(50, Math.round(h * 2)));
    }
    const base = (item.atk || 0) * 10 + (item.def || 0) * 10;
    const tier = (item.tier || 1);
    return Math.max(15, Math.round(base + tier * 15));
  }
  function cloneItem(it) {
    try { return JSON.parse(JSON.stringify(it)); } catch (_) {}
    return Object.assign({}, it);
  }
  function ensureShopPanel() {
    let el = document.getElementById("shop-panel");
    if (el) return el;
    el = document.createElement("div");
    el.id = "shop-panel";
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.top = "50%";
    el.style.transform = "translate(-50%,-50%)";
    el.style.zIndex = "9998";
    el.style.minWidth = "300px";
    el.style.maxWidth = "520px";
    el.style.maxHeight = "60vh";
    el.style.overflow = "auto";
    el.style.padding = "12px";
    el.style.background = "rgba(14, 18, 28, 0.95)";
    el.style.color = "#e5e7eb";
    el.style.border = "1px solid #334155";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.6)";
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>Shop</strong>
        <button id="shop-close-btn" style="padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Close</button>
      </div>
      <div id="shop-gold" style="margin-bottom:8px;color:#93c5fd;"></div>
      <div id="shop-list"></div>
    `;
    document.body.appendChild(el);
    const btn = el.querySelector("#shop-close-btn");
    if (btn) btn.onclick = () => hideShopPanel();
    return el;
  }
  function renderShopPanel() {
    const el = ensureShopPanel();
    el.hidden = false;
    const goldDiv = el.querySelector("#shop-gold");
    const listDiv = el.querySelector("#shop-list");
    const gold = (player.inventory.find(i => i && i.kind === "gold")?.amount) || 0;
    if (goldDiv) goldDiv.textContent = `Gold: ${gold}`;
    if (!listDiv) return;
    if (!Array.isArray(currentShopStock) || currentShopStock.length === 0) {
      listDiv.innerHTML = `<div style="color:#94a3b8;">No items for sale.</div>`;
      return;
    }
    listDiv.innerHTML = currentShopStock.map((row, idx) => {
      const name = describeItem(row.item) || "item";
      const p = row.price | 0;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">
        <div>${name} — <span style="color:#93c5fd;">${p}g</span></div>
        <button data-idx="${idx}" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Buy</button>
      </div>`;
    }).join("");
    // Attach handlers
    Array.from(listDiv.querySelectorAll("button[data-idx]")).forEach(btn => {
      btn.onclick = () => {
        const i = Number(btn.getAttribute("data-idx") || -1);
        shopBuyIndex(i);
      };
    });
  }
  function hideShopPanel() {
    const el = document.getElementById("shop-panel");
    if (el) el.hidden = true;
    requestDraw();
  }
  function openShopFor(npc) {
    // Generate a small stock list
    const stock = [];
    // A couple of potions
    stock.push({ item: { kind: "potion", heal: 5, count: 1, name: "potion (+5 HP)" }, price: 10 });
    stock.push({ item: { kind: "potion", heal: 10, count: 1, name: "potion (+10 HP)" }, price: 18 });
    // Some equipment via Items if available
    try {
      if (window.Items && typeof Items.createEquipment === "function") {
        const t1 = Items.createEquipment(1, rng);
        const t2 = Items.createEquipment(2, rng);
        if (t1) stock.push({ item: t1, price: priceFor(t1) });
        if (t2) stock.push({ item: t2, price: priceFor(t2) });
      } else {
        // fallback simple gear
        const s = { kind: "equip", slot: "left", name: "simple sword", atk: 1.5, tier: 1, decay: initialDecay(1) };
        const a = { kind: "equip", slot: "torso", name: "leather armor", def: 1.0, tier: 1, decay: initialDecay(1) };
        stock.push({ item: s, price: priceFor(s) });
        stock.push({ item: a, price: priceFor(a) });
      }
    } catch (_) {}
    currentShopStock = stock;
    renderShopPanel();
  }
  function shopBuyIndex(idx) {
    if (!Array.isArray(currentShopStock) || idx < 0 || idx >= currentShopStock.length) return;
    const row = currentShopStock[idx];
    const cost = row.price | 0;
    let goldObj = player.inventory.find(i => i && i.kind === "gold");
    const cur = goldObj && typeof goldObj.amount === "number" ? goldObj.amount : 0;
    if (cur < cost) {
      log("You don't have enough gold.", "warn");
      renderShopPanel();
      return;
    }
    const copy = cloneItem(row.item);
    // Deduct gold and add item
    if (!goldObj) { goldObj = { kind: "gold", amount: 0, name: "gold" }; player.inventory.push(goldObj); }
    goldObj.amount = (goldObj.amount | 0) - cost;
    if (copy.kind === "potion") {
      // Merge same potions
      const same = player.inventory.find(i => i && i.kind === "potion" && (i.heal ?? 0) === (copy.heal ?? 0));
      if (same) same.count = (same.count || 1) + (copy.count || 1);
      else player.inventory.push(copy);
    } else {
      player.inventory.push(copy);
    }
    updateUI();
    renderInventoryPanel();
    log(`You bought ${describeItem(copy)} for ${cost} gold.`, "good");
    renderShopPanel();
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
      const makeEnemy = (ctx.enemyFactory || ((x, y, depth) => ({ x, y, type: "goblin", glyph: "g", hp: 3, atk: 1, xp: 5, level: depth, announced: false })));
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
      // Always render content; panel may be opening and not yet marked as open
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

    const eq = player.equipment || {};
    const takeFromInventory = () => { player.inventory.splice(idx, 1); };

    if (item.slot === "hand") {
      // Handle two-handed vs one-handed equip consistently
      takeFromInventory();

      if (item.twoHanded) {
        // Unequip any existing hand items and stow them
        if (eq.left) { player.inventory.push(eq.left); }
        if (eq.right && eq.right !== eq.left) { player.inventory.push(eq.right); }
        eq.left = item;
        eq.right = item;
        const parts = [];
        if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
        if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
        const statStr = parts.join(", ");
        log(`You equip ${item.name} (two-handed${statStr ? ", " + statStr : ""}).`);
        updateUI();
        renderInventoryPanel();
        return;
      }

      // One-handed: prefer an empty hand; otherwise replace left by default
      let target = null;
      if (!eq.left) target = "left";
      else if (!eq.right) target = "right";
      else target = "left";

      const prev = eq[target] || null;
      eq[target] = item;

      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      log(`You equip ${item.name} (${target}${statStr ? ", " + statStr : ""}).`);
      if (prev) {
        player.inventory.push(prev);
        log(`You stow ${describeItem(prev)} into your inventory.`);
      }
      updateUI();
      renderInventoryPanel();
      return;
    }

    // Non-hand slots
    const slot = item.slot;
    const prev = eq[slot] || null;
    takeFromInventory();
    eq[slot] = item;
    const statStr = ("atk" in item) ? `+${Number(item.atk).toFixed(1)} atk` : ("def" in item) ? `+${Number(item.def).toFixed(1)} def` : "";
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
    // Fallback: explicitly equip to requested hand
    if (!player.inventory || idx < 0 || idx >= player.inventory.length) return;
    const item = player.inventory[idx];
    if (!item || item.kind !== "equip") {
      log("That item cannot be equipped.");
      return;
    }
    if (item.slot !== "hand") {
      // Not a hand item; delegate to generic equip
      equipItemByIndex(idx);
      return;
    }
    const eq = player.equipment || {};
    const target = (hand === "right") ? "right" : "left";

    // Two-handed items occupy both hands
    player.inventory.splice(idx, 1);
    if (item.twoHanded) {
      if (eq.left) { player.inventory.push(eq.left); }
      if (eq.right && eq.right !== eq.left) { player.inventory.push(eq.right); }
      eq.left = item;
      eq.right = item;
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      log(`You equip ${item.name} (two-handed${statStr ? ", " + statStr : ""}).`);
      updateUI();
      renderInventoryPanel();
      return;
    }

    // One-handed: replace only the requested hand
    const prev = eq[target] || null;
    eq[target] = item;
    const parts = [];
    if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
    if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
    const statStr = parts.join(", ");
    log(`You equip ${item.name} (${target}${statStr ? ", " + statStr : ""}).`);
    if (prev) {
      player.inventory.push(prev);
      log(`You stow ${describeItem(prev)} into your inventory.`);
    }
    updateUI();
    renderInventoryPanel();
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
    // Remove from enemies immediately
    enemies = enemies.filter(e => e !== enemy);
    // Clear enemy occupancy for this tile so player can walk onto corpse
    try {
      if (occupancy && typeof occupancy.clearEnemy === "function") {
        occupancy.clearEnemy(enemy.x, enemy.y);
      }
    } catch (_) {}
    gainXP(enemy.xp || 5);
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

  // Mouse/click support on the canvas: click specific containers (chests/corpses) to loot
  (function setupMouse() {
    try {
      const canvasEl = document.getElementById("game");
      if (!canvasEl) return;

      function hasContainerAt(x, y) {
        try {
          return Array.isArray(corpses) && corpses.find(c => c && c.x === x && c.y === y && (!c.looted || (Array.isArray(c.loot) && c.loot.length > 0)));
        } catch (_) {
          return null;
        }
      }

      canvasEl.addEventListener("click", (ev) => {
        try {
          // If UI modals are open, let them handle clicks
          if (window.UI) {
            if (typeof UI.isLootOpen === "function" && UI.isLootOpen()) return;
            if (typeof UI.isInventoryOpen === "function" && UI.isInventoryOpen()) return;
            if (typeof UI.isGodOpen === "function" && UI.isGodOpen()) return;
          }
          // Only act in dungeon and town; for world we ignore clicks for now
          if (mode !== "dungeon" && mode !== "town") return;

          const rect = canvasEl.getBoundingClientRect();
          const px = ev.clientX - rect.left;
          const py = ev.clientY - rect.top;

          // Map pixel to tile coordinates considering camera
          const tx = Math.floor((camera.x + Math.max(0, px)) / TILE);
          const ty = Math.floor((camera.y + Math.max(0, py)) / TILE);

          if (!inBounds(tx, ty)) return;

          if (mode === "dungeon") {
            const targetContainer = hasContainerAt(tx, ty);

            if (targetContainer) {
              // If clicked on our own tile and there is a container here, loot it
              if (tx === player.x && ty === player.y) {
                lootCorpse();
                return;
              }
              // If adjacent to the clicked container, step onto it and loot
              const md = Math.abs(tx - player.x) + Math.abs(ty - player.y);
              if (md === 1) {
                const dx = Math.sign(tx - player.x);
                const dy = Math.sign(ty - player.y);
                tryMovePlayer(dx, dy);
                // If we arrived on the container, auto-loot
                setTimeout(() => {
                  try {
                    if (player.x === tx && player.y === ty) lootCorpse();
                  } catch (_) {}
                }, 0);
                return;
              }
              // Not adjacent: inform the player
              log("Move next to the chest/corpse and click it to loot.", "info");
              return;
            }

            // If no container was clicked, allow simple adjacent click-to-move QoL
            const md = Math.abs(tx - player.x) + Math.abs(ty - player.y);
            if (md === 1) {
              const dx = Math.sign(tx - player.x);
              const dy = Math.sign(ty - player.y);
              tryMovePlayer(dx, dy);
            }
            return;
          }

          if (mode === "town") {
            // In town, click on player's tile performs the context action (talk/exit/loot if chest underfoot)
            if (tx === player.x && ty === player.y) {
              doAction();
              return;
            }
            // Adjacent tile click: small QoL move
            const md = Math.abs(tx - player.x) + Math.abs(ty - player.y);
            if (md === 1) {
              const dx = Math.sign(tx - player.x);
              const dy = Math.sign(ty - player.y);
              tryMovePlayer(dx, dy);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}
  })();

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

  // Expose a minimal API for smoke tests and diagnostics
  try {
    window.GameAPI = {
      getMode: () => mode,
      getWorld: () => world,
      getPlayer: () => ({ x: player.x, y: player.y }),
      moveStep: (dx, dy) => { tryMovePlayer(dx, dy); },
      // Overworld helpers
      isWalkableOverworld: (x, y) => {
        if (!world || !world.map) return false;
        const t = world.map[y] && world.map[y][x];
        return (typeof window.World === "object" && typeof World.isWalkable === "function") ? World.isWalkable(t) : true;
      },
      nearestDungeon: () => {
        if (!world || !Array.isArray(world.dungeons) || world.dungeons.length === 0) return null;
        const sx = player.x, sy = player.y;
        let best = null, bestD = Infinity;
        for (const d of world.dungeons) {
          const dd = Math.abs(d.x - sx) + Math.abs(d.y - sy);
          if (dd < bestD) { bestD = dd; best = { x: d.x, y: d.y }; }
        }
        return best;
      },
      nearestTown: () => {
        if (!world || !Array.isArray(world.towns) || world.towns.length === 0) return null;
        const sx = player.x, sy = player.y;
        let best = null, bestD = Infinity;
        for (const t of world.towns) {
          const dd = Math.abs(t.x - sx) + Math.abs(t.y - sy);
          if (dd < bestD) { bestD = dd; best = { x: t.x, y: t.y }; }
        }
        return best;
      },
      routeTo: (tx, ty) => {
        // BFS over overworld to build a simple path
        if (!world || !world.map) return [];
        const w = world.width, h = world.height;
        const start = { x: player.x, y: player.y };
        const q = [start];
        const prev = new Map();
        const seen = new Set([`${start.x},${start.y}`]);
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        while (q.length) {
          const cur = q.shift();
          if (cur.x === tx && cur.y === ty) break;
          for (const d of dirs) {
            const nx = cur.x + d.dx, ny = cur.y + d.dy;
            const key = `${nx},${ny}`;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (seen.has(key)) continue;
            if (!window.GameAPI.isWalkableOverworld(nx, ny)) continue;
            seen.add(key);
            prev.set(key, cur);
            q.push({ x: nx, y: ny });
          }
        }
        // reconstruct
        const path = [];
        let curKey = `${tx},${ty}`;
        if (!prev.has(curKey) && !(start.x === tx && start.y === ty)) return [];
        let cur = { x: tx, y: ty };
        while (!(cur.x === start.x && cur.y === start.y)) {
          path.push(cur);
          const p = prev.get(`${cur.x},${cur.y}`);
          if (!p) break;
          cur = p;
        }
        path.reverse();
        return path;
      },
      gotoNearestDungeon: async () => {
        const target = window.GameAPI.nearestDungeon();
        if (!target) { return true; }
        const path = window.GameAPI.routeTo(target.x, target.y);
        if (!path || !path.length) { return false; }
        for (const step of path) {
          const dx = Math.sign(step.x - player.x);
          const dy = Math.sign(step.y - player.y);
          try { window.GameAPI.moveStep(dx, dy); } catch (_) {}
          await new Promise(r => setTimeout(r, 60));
        }
        return true;
      },
      gotoNearestTown: async () => {
        const target = window.GameAPI.nearestTown();
        if (!target) { return true; }
        const path = window.GameAPI.routeTo(target.x, target.y);
        if (!path || !path.length) { return false; }
        for (const step of path) {
          const dx = Math.sign(step.x - player.x);
          const dy = Math.sign(step.y - player.y);
          try { window.GameAPI.moveStep(dx, dy); } catch (_) {}
          await new Promise(r => setTimeout(r, 60));
        }
        return true;
      },
      enterTownIfOnTile: () => {
        try {
          // Use local wrapper to ensure mutated ctx is synced back and UI/redraw updates occur
          return !!enterTownIfOnTile();
        } catch (_) { return false; }
      },
      enterDungeonIfOnEntrance: () => {
        try {
          // Use local wrapper to ensure mutated ctx is synced back and UI/redraw updates occur
          return !!enterDungeonIfOnEntrance();
        } catch (_) { return false; }
      },
      // Current map pathing helpers (town/dungeon)
      getEnemies: () => enemies.map(e => ({ x: e.x, y: e.y, hp: e.hp, type: e.type, immobileTurns: e.immobileTurns || 0, bleedTurns: e.bleedTurns || 0 })),
      // Include index so runner can correlate to NPC internals when needed
      getNPCs: () => (Array.isArray(npcs) ? npcs.map((n, i) => ({ i, x: n.x, y: n.y, name: n.name })) : []),
      getTownProps: () => (Array.isArray(townProps) ? townProps.map(p => ({ x: p.x, y: p.y, type: p.type || "" })) : []),
      getDungeonExit: () => (dungeonExitAt ? { x: dungeonExitAt.x, y: dungeonExitAt.y } : null),
      getTownGate: () => (townExitAt ? { x: townExitAt.x, y: townExitAt.y } : null),
      getCorpses: () => (Array.isArray(corpses) ? corpses.map(c => ({ kind: c.kind || "corpse", x: c.x, y: c.y, looted: !!c.looted, lootCount: Array.isArray(c.loot) ? c.loot.length : 0 })) : []),
      getChestsDetailed: () => {
        if (!Array.isArray(corpses)) return [];
        const list = [];
        for (const c of corpses) {
          if (c && c.kind === "chest") {
            const items = Array.isArray(c.loot) ? c.loot : [];
            const names = items.map(it => {
              if (!it) return "(null)";
              if (it.name) return it.name;
              if (it.kind === "equip") {
                const stats = [];
                if (typeof it.atk === "number") stats.push(`+${it.atk} atk`);
                if (typeof it.def === "number") stats.push(`+${it.def} def`);
                return `${it.slot || "equip"}${stats.length ? ` (${stats.join(", ")})` : ""}`;
              }
              if (it.kind === "potion") return it.name || "potion";
              return it.kind || "item";
            });
            list.push({ x: c.x, y: c.y, items: names });
          }
        }
        return list;
      },
      getInventory: () => (Array.isArray(player.inventory) ? player.inventory.map((it, i) => ({ i, kind: it.kind, slot: it.slot, name: it.name, atk: it.atk, def: it.def, decay: it.decay, count: it.count })) : []),
      getEquipment: () => {
        const eq = player.equipment || {};
        function info(it) { return it ? { name: it.name, slot: it.slot, atk: it.atk, def: it.def, decay: it.decay, twoHanded: !!it.twoHanded } : null; }
        return { left: info(eq.left), right: info(eq.right), head: info(eq.head), torso: info(eq.torso), legs: info(eq.legs), hands: info(eq.hands) };
      },
      getStats: () => {
        try {
          return { atk: getPlayerAttack(), def: getPlayerDefense(), hp: player.hp, maxHp: player.maxHp, level: player.level };
        } catch(_) { return { atk: 0, def: 0, hp: player.hp, maxHp: player.maxHp, level: player.level }; }
      },
      equipItemAtIndex: (idx) => { try { equipItemByIndex(idx|0); return true; } catch(_) { return false; } },
      equipItemAtIndexHand: (idx, hand) => { try { equipItemByIndexHand(idx|0, String(hand || "left")); return true; } catch(_) { return false; } },
      unequipSlot: (slot) => { try { unequipSlot(String(slot)); return true; } catch(_) { return false; } },
      // Potions
      getPotions: () => {
        try {
          if (!Array.isArray(player.inventory)) return [];
          const out = [];
          for (let i = 0; i < player.inventory.length; i++) {
            const it = player.inventory[i];
            if (it && it.kind === "potion") {
              out.push({ i, heal: it.heal, count: it.count, name: it.name });
            }
          }
          return out;
        } catch(_) { return []; }
      },
      drinkPotionAtIndex: (idx) => { try { drinkPotionByIndex(idx|0); return true; } catch(_) { return false; } },
      getGold: () => {
        try {
          const g = player.inventory.find(i => i && i.kind === "gold");
          return g && typeof g.amount === "number" ? g.amount : 0;
        } catch(_) { return 0; }
      },
      addGold: (amt) => {
        try {
          const amount = Number(amt) || 0;
          if (amount <= 0) return false;
          let g = player.inventory.find(i => i && i.kind === "gold");
          if (!g) { g = { kind: "gold", amount: 0, name: "gold" }; player.inventory.push(g); }
          g.amount += amount;
          updateUI(); renderInventoryPanel();
          return true;
        } catch(_) { return false; }
      },
      removeGold: (amt) => {
        try {
          const amount = Number(amt) || 0;
          if (amount <= 0) return true;
          let g = player.inventory.find(i => i && i.kind === "gold");
          if (!g) return false;
          g.amount = Math.max(0, (g.amount|0) - amount);
          updateUI(); renderInventoryPanel();
          return true;
        } catch(_) { return false; }
      },
      // Debug helpers for town buildings/props
      getNPCHomeByIndex: (idx) => {
        try {
          if (!Array.isArray(npcs) || idx < 0 || idx >= npcs.length) return null;
          const n = npcs[idx];
          const b = n && n._home && n._home.building ? n._home.building : null;
          if (!b) return null;
          const propsIn = (Array.isArray(townProps) ? townProps.filter(p => (p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1)) : []).map(p => ({ x: p.x, y: p.y, type: p.type || "" }));
          return { building: { x: b.x, y: b.y, w: b.w, h: b.h, door: b.door ? { x: b.door.x, y: b.door.y } : null }, props: propsIn };
        } catch (_) { return null; }
      },
      equipBestFromInventory: () => {
        // Try to equip any better items from inventory using existing helper; return names equipped
        const equipped = [];
        if (!Array.isArray(player.inventory) || player.inventory.length === 0) return equipped;
        // Iterate a snapshot since equip may mutate inventory
        const snap = player.inventory.slice(0);
        for (const it of snap) {
          if (it && it.kind === "equip") {
            if (equipIfBetter(it)) {
              // Remove equipped item from inventory snapshot? equipIfBetter does not mutate inventory by default; ensure no duping
              // Best-effort: if inventory still contains same object, remove one instance
              const idx = player.inventory.indexOf(it);
              if (idx !== -1) player.inventory.splice(idx, 1);
              equipped.push(it.name || "equip");
            }
          }
        }
        return equipped;
      },
      // Shops/time/perf helpers for test runner
      getShops: () => (Array.isArray(shops) ? shops.map(s => ({ x: s.x, y: s.y, name: s.name || "", alwaysOpen: !!s.alwaysOpen, openMin: s.openMin, closeMin: s.closeMin })) : []),
      isShopOpenNowFor: (shop) => {
        try { return isShopOpenNow(shop); } catch (_) { return false; }
      },
      getShopSchedule: (shop) => {
        try { return shopScheduleStr(shop); } catch (_) { return ""; }
      },
      // Town home route diagnostic (programmatic access for smoke tests)
      checkHomeRoutes: () => {
        try {
          if (window.TownAI && typeof TownAI.checkHomeRoutes === "function") {
            return TownAI.checkHomeRoutes(getCtx()) || null;
          }
        } catch (_) {}
        return null;
      },
      getClock: () => getClock(),
      advanceMinutes: (mins) => { try { advanceTimeMinutes((Number(mins) || 0) | 0); updateUI(); requestDraw(); return true; } catch (_) { return false; } },
      restUntilMorning: () => { try { restUntilMorning(); } catch (_) {} },
      restAtInn: () => { try { restAtInn(); } catch (_) {} },
      getPerf: () => {
        try { return { lastTurnMs: (PERF.lastTurnMs || 0), lastDrawMs: (PERF.lastDrawMs || 0) }; } catch (_) { return { lastTurnMs: 0, lastDrawMs: 0 }; }
      },
      getDecalsCount: () => Array.isArray(decals) ? decals.length : 0,
      returnToWorldIfAtExit: () => {
        try {
          return !!returnToWorldIfAtExit();
        } catch(_) { return false; }
      },
      // Crit/status test helpers
      setAlwaysCrit: (v) => { try { setAlwaysCrit(!!v); return true; } catch(_) { return false; } },
      setCritPart: (part) => { try { setCritPart(String(part || "")); return true; } catch(_) { return false; } },
      getPlayerStatus: () => { try { return { hp: player.hp, maxHp: player.maxHp, dazedTurns: player.dazedTurns | 0 }; } catch(_) { return { hp: 0, maxHp: 0, dazedTurns: 0 }; } },
      setPlayerDazedTurns: (n) => { try { player.dazedTurns = Math.max(0, (Number(n) || 0) | 0); return true; } catch(_) { return false; } },
      isWalkableDungeon: (x, y) => inBounds(x, y) && isWalkable(x, y),
      // Visibility/FOV helpers for smoketest
      getVisibilityAt: (x, y) => {
        try {
          if (!inBounds(x|0, y|0)) return false;
          return !!(visible[y|0] && visible[y|0][x|0]);
        } catch(_) { return false; }
      },
      getTiles: () => ({ WALL: TILES.WALL, FLOOR: TILES.FLOOR, DOOR: TILES.DOOR, STAIRS: TILES.STAIRS, WINDOW: TILES.WINDOW }),
      getTile: (x, y) => {
        try {
          if (!inBounds(x|0, y|0)) return null;
          return map[y|0][x|0];
        } catch(_) { return null; }
      },
      hasEnemy: (x, y) => {
        try {
          if (occupancy && typeof occupancy.hasEnemy === "function") return !!occupancy.hasEnemy(x|0, y|0);
          return enemies.some(e => (e.x|0) === (x|0) && (e.y|0) === (y|0));
        } catch(_) { return false; }
      },
      hasNPC: (x, y) => {
        try {
          if (occupancy && typeof occupancy.hasNPC === "function") return !!occupancy.hasNPC(x|0, y|0);
          return npcs.some(n => (n.x|0) === (x|0) && (n.y|0) === (y|0));
        } catch(_) { return false; }
      },
      hasLOS: (x0, y0, x1, y1) => {
        try {
          const c = getCtx();
          if (c && c.los && typeof c.los.hasLOS === "function") return !!c.los.hasLOS(c, x0|0, y0|0, x1|0, y1|0);
        } catch(_) {}
        return false;
      },
      // GOD helpers for smoketest fallbacks
      spawnEnemyNearby: (count = 1) => {
        try { godSpawnEnemyNearby((Number(count) || 0) | 0 || 1); return true; } catch(_) { return false; }
      },
      spawnItems: (count = 3) => {
        try { godSpawnItems((Number(count) || 0) | 0 || 3); return true; } catch(_) { return false; }
      },
      addPotionToInventory: (heal, name) => {
        try { addPotionToInventory((Number(heal) || 0) || 3, String(name || "")); return true; } catch(_) { return false; }
      },
      // Test helper: spawn a chest near the player in dungeon mode (best-effort).
      // Returns true if at least one chest was placed.
      spawnChestNearby: (count = 1) => {
        try {
          const n = Math.max(1, (Number(count) || 0) | 0);
          if (mode !== "dungeon") return false;
          const isFreeFloor = (x, y) => {
            if (!inBounds(x, y)) return false;
            if (map[y][x] !== TILES.FLOOR) return false;
            if (player.x === x && player.y === y) return false;
            if (enemies.some(e => e.x === x && e.y === y)) return false;
            return true;
          };
          const pickNearby = () => {
            // Try a local radius first
            for (let i = 0; i < 60; i++) {
              const dx = randInt(-4, 4);
              const dy = randInt(-4, 4);
              const x = player.x + dx, y = player.y + dy;
              if (isFreeFloor(x, y)) return { x, y };
            }
            // Fallback: any free floor
            for (let y = 0; y < map.length; y++) {
              for (let x = 0; x < (map[0] ? map[0].length : 0); x++) {
                if (isFreeFloor(x, y)) return { x, y };
              }
            }
            return null;
          };
          let made = 0;
          for (let i = 0; i < n; i++) {
            const spot = pickNearby();
            if (!spot) break;
            const loot = generateLoot("chest") || [];
            corpses.push({ x: spot.x, y: spot.y, kind: "chest", looted: loot.length === 0, loot });
            made++;
            try { log(`GOD: Spawned chest at (${spot.x},${spot.y}).`, "notice"); } catch (_) {}
          }
          if (made > 0) { requestDraw(); return true; }
          return false;
        } catch (_) { return false; }
      },

      routeToDungeon: (tx, ty) => {
        // BFS on current map (works for both town and dungeon as it uses isWalkable)
        const w = map[0] ? map[0].length : 0;
        const h = map.length;
        if (w === 0 || h === 0) return [];
        const start = { x: player.x, y: player.y };
        const q = [start];
        const prev = new Map();
        const seen = new Set([`${start.x},${start.y}`]);
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        while (q.length) {
          const cur = q.shift();
          if (cur.x === tx && cur.y === ty) break;
          for (const d of dirs) {
            const nx = cur.x + d.dx, ny = cur.y + d.dy;
            const key = `${nx},${ny}`;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (seen.has(key)) continue;
            if (!window.GameAPI.isWalkableDungeon(nx, ny)) continue;
            seen.add(key);
            prev.set(key, cur);
            q.push({ x: nx, y: ny });
          }
        }
        const path = [];
        let curKey = `${tx},${ty}`;
        if (!prev.has(curKey) && !(start.x === tx && start.y === ty)) return [];
        let cur = { x: tx, y: ty };
        while (!(cur.x === start.x && cur.y === start.y)) {
          path.push(cur);
          const p = prev.get(`${cur.x},${cur.y}`);
          if (!p) break;
          cur = p;
        }
        path.reverse();
        return path;
      },

      // DEV/test-only: teleport player to a target tile and refresh state (camera/FOV/UI/redraw).
      // opts: { ensureWalkable: true, fallbackScanRadius: 6 }
      teleportTo: (tx, ty, opts) => {
        try {
          const x = (Number(tx) || 0) | 0;
          const y = (Number(ty) || 0) | 0;
          const ensureWalkable = !opts || (opts.ensureWalkable !== false);
          const fallbackR = (opts && opts.fallbackScanRadius != null) ? (opts.fallbackScanRadius | 0) : 6;

          const curMode = mode;
          const canWorld = () => {
            if (!world || !world.map) return false;
            const t = world.map[y] && world.map[y][x];
            return (typeof window.World === "object" && typeof World.isWalkable === "function") ? World.isWalkable(t) : true;
          };
          const canLocal = () => {
            if (!inBounds(x, y)) return false;
            if (!ensureWalkable) return true;
            if (!isWalkable(x, y)) return false;
            // avoid enemies/NPCs on the exact tile
            if (curMode === "dungeon" && enemies.some(e => e.x === x && e.y === y)) return false;
            if (curMode === "town") {
              const npcBlocked = (occupancy && typeof occupancy.hasNPC === "function") ? occupancy.hasNPC(x, y) : (Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y));
              if (npcBlocked) return false;
            }
            return true;
          };

          let ok = false;
          if (curMode === "world") {
            ok = canWorld();
          } else {
            ok = canLocal();
          }

          // If target is blocked, scan a small radius for a free alternative
          if (!ok && ensureWalkable) {
            const r = Math.max(1, fallbackR | 0);
            let best = null, bestD = Infinity;
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                const nx = x + dx, ny = y + dy;
                const md = Math.abs(dx) + Math.abs(dy);
                if (md > r) continue;
                if (curMode === "world") {
                  if (!world || !world.map) continue;
                  const t = world.map[ny] && world.map[ny][nx];
                  const walk = (typeof window.World === "object" && typeof World.isWalkable === "function") ? World.isWalkable(t) : true;
                  if (walk && md < bestD) { best = { x: nx, y: ny }; bestD = md; }
                } else {
                  if (!inBounds(nx, ny)) continue;
                  // block entity-occupied
                  if (curMode === "dungeon" && enemies.some(e => e.x === nx && e.y === ny)) continue;
                  if (curMode === "town") {
                    const npcBlocked = (occupancy && typeof occupancy.hasNPC === "function") ? occupancy.hasNPC(nx, ny) : (Array.isArray(npcs) && npcs.some(n => n.x === nx && n.y === ny));
                    if (npcBlocked) continue;
                  }
                  if (isWalkable(nx, ny) && md < bestD) { best = { x: nx, y: ny }; bestD = md; }
                }
              }
            }
            if (best) { player.x = best.x; player.y = best.y; ok = true; }
          }

          if (!ok) {
            // If we didn't relax, try setting anyway (for testing blocked tiles)
            if (!ensureWalkable) { player.x = x; player.y = y; ok = true; }
          } else {
            if (curMode !== "world") { player.x = (player.x | 0); player.y = (player.y | 0); } // ensure ints
            if (curMode === "world") { player.x = x; player.y = y; }
            if (curMode !== "world" && !(player.x === x && player.y === y)) {
              // If ok was from fallback, the assignment already occurred above
            } else {
              player.x = x; player.y = y;
            }
          }

          if (ok) {
            updateCamera();
            // Invalidate FOV cache to force recompute
            _lastMode = ""; _lastMapCols = -1; _lastMapRows = -1; _lastPlayerX = -1; _lastPlayerY = -1;
            recomputeFOV();
            updateUI();
            requestDraw();
          }
          return !!ok;
        } catch (_) {
          return false;
        }
      }
    };
  } catch (_) {}

})();