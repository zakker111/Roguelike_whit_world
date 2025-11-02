/**
 * GameData loader: loads JSON registries for items, enemies, npcs, consumables, shops, town config.
 * Exposes:
 *   export const GameData = {
 *     ready: Promise<void>,
 *     items: Array | null,
 *     enemies: Array | null,
 *     npcs: { residents: {...}, shopkeepers: {...}, pets: {...} } | null,
 *     consumables: Object | null,
 *     shops: Array | null,
 *     town: Object | null
 *   }
 *
 * When running from file:// where fetch() of local JSON is often blocked,
 * we provide compact, hardcoded defaults so the game remains playable.
 */
 
const DATA_FILES = {
  // Combined assets file (tiles + props) — required in strict mode
  assetsCombined: "data/world/world_assets.json",
  // Individual registries (moved into conventional subfolders)
  items: "data/entities/items.json",
  enemies: "data/entities/enemies.json",
  npcs: "data/entities/npcs.json",
  consumables: "data/entities/consumables.json",

  // Materials/crafting registries
  materials: "data/entities/materials.json",
  craftingRecipes: "data/crafting/recipes.json",

  // Loot/foraging pools
  materialPools: "data/loot/material_pools.json",
  foragingPools: "data/loot/foraging_pools.json",
  
  town: "data/world/town.json",
  flavor: "data/i18n/flavor.json",
  encounters: "data/encounters/encounters.json",
  // New: quest templates (available/active are dynamic per-town)
  quests: "data/quests/quests.json",
  config: "data/config/config.json",
  palette: "data/world/palette.json",
  messages: "data/i18n/messages.json",
  shopPhases: "data/shops/shop_phases.json",
  shopPools: "data/shops/shop_pools.json",
  shopRules: "data/shops/shop_rules.json",
  shopRestock: "data/shops/shop_restock.json",
  progression: "data/balance/progression.json",
  animals: "data/entities/animals.json",
  
  // New: prefab registry for town buildings (houses/shops/inns)
  prefabs: "data/worldgen/prefabs.json"
};

function fetchJson(url) {
  return fetch(url, { cache: "no-cache" })
    .then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.json();
    });
}

export const GameData = {
  items: null,
  enemies: null,
  npcs: null,
  consumables: null,
  shops: null,
  town: null,
  flavor: null,
  tiles: null,
  encounters: null,
  // New: quest templates
  quests: null,
  config: null,
  palette: null,
  messages: null,
  props: null,
  shopPhases: null,
  shopPools: null,
  shopRules: null,
  shopRestock: null,
  progression: null,

  // New: materials/crafting and pools
  materials: null,
  crafting: null,
  materialPools: null,
  foragingPools: null,
  
  // New: prefab registry grouped by category
  prefabs: null,
  ready: null,
};

function logNotice(msg) {
  try {
    if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
      window.Logger.log(msg, "notice");
    } else if (typeof window !== "undefined" && window.DEV && typeof console !== "undefined") {
      console.debug("[GameData] " + msg);
    }
  } catch (_) {}
}

function runningFromFile() {
  try { return typeof location !== "undefined" && location.protocol === "file:"; } catch (_) { return false; }
}

GameData.ready = (async function loadAll() {
  try {
    const [
      assetsCombined,
      items, enemies, npcs, consumables,
      materials, craftingRecipes, materialPools, foragingPools,
      town, flavor, encounters, quests, config, palette, messages,
      shopPhases, shopPools, shopRules, shopRestock, progression, animals, prefabs
    ] = await Promise.all([
      fetchJson(DATA_FILES.assetsCombined).catch(() => null),
      fetchJson(DATA_FILES.items).catch(() => null),
      fetchJson(DATA_FILES.enemies).catch(() => null),
      fetchJson(DATA_FILES.npcs).catch(() => null),
      fetchJson(DATA_FILES.consumables).catch(() => null),

      fetchJson(DATA_FILES.materials).catch(() => null),
      fetchJson(DATA_FILES.craftingRecipes).catch(() => null),
      fetchJson(DATA_FILES.materialPools).catch(() => null),
      fetchJson(DATA_FILES.foragingPools).catch(() => null),
      
      fetchJson(DATA_FILES.town).catch(() => null),
      fetchJson(DATA_FILES.flavor).catch(() => null),
      fetchJson(DATA_FILES.encounters).catch(() => null),
      fetchJson(DATA_FILES.quests).catch(() => null),
      fetchJson(DATA_FILES.config).catch(() => null),
      fetchJson(DATA_FILES.palette).catch(() => null),
      fetchJson(DATA_FILES.messages).catch(() => null),
      fetchJson(DATA_FILES.shopPhases).catch(() => null),
      fetchJson(DATA_FILES.shopPools).catch(() => null),
      fetchJson(DATA_FILES.shopRules).catch(() => null),
      fetchJson(DATA_FILES.shopRestock).catch(() => null),
      fetchJson(DATA_FILES.progression).catch(() => null),
      fetchJson(DATA_FILES.animals).catch(() => null),
      
      fetchJson(DATA_FILES.prefabs).catch(() => null)
    ]);

    GameData.items = Array.isArray(items) ? items : null;
    GameData.enemies = Array.isArray(enemies) ? enemies : null;
    GameData.npcs = (npcs && typeof npcs === "object") ? npcs : null;
    GameData.consumables = (consumables && typeof consumables === "object") ? consumables : null;
    GameData.shops = null;

    // New data domains
    GameData.materials = (materials && typeof materials === "object") ? materials : null;
    GameData.crafting = (craftingRecipes && typeof craftingRecipes === "object") ? craftingRecipes : null;
    GameData.materialPools = (materialPools && typeof materialPools === "object") ? materialPools : null;
    GameData.foragingPools = (foragingPools && typeof foragingPools === "object") ? foragingPools : null;

    GameData.town = (town && typeof town === "object") ? town : null;
    GameData.flavor = (flavor && typeof flavor === "object") ? flavor : null;
    GameData.encounters = (encounters && typeof encounters === "object") ? encounters : null;
    GameData.quests = (quests && typeof quests === "object") ? quests : null;
    GameData.config = (config && typeof config === "object") ? config : null;
    GameData.palette = (palette && typeof palette === "object") ? palette : null;
    GameData.messages = (messages && typeof messagesull;

    GameData.shopPhases = (shopPhases && typeof shopPhases === "object") ? shopPhases : null;
    GameData.shopPools = (shopPools && typeof shopPools === "object") ? shopPools : null;
    GameData.shopRules = (shopRules && typeof shopRules === "object") ? shopRules : null;
    GameData.shopRestock = (shopRestock && typeof shopRestock === "object") ? shopRestock : null;
    GameData.progression = (progression && typeof progression === "object") ? progression : null;
    GameData.animals = Array.isArray(animals) ? animals : null;
    

    // Prefabs registry grouped by category
    GameData.prefabs = (prefabs && typeof prefabs === "object") ? prefabs : null;

    // Strict: require combined assets file (tiles + props)
    try {
      if (assetsCombined && typeof assetsCombined === "object") {
        const combinedTiles = assetsCombined.tiles;
        const combinedProps = assetsCombined.props;
        if (combinedTiles && Array.isArray(combinedTiles.tiles)) GameData.tiles = combinedTiles;
        if (combinedProps && typeof combinedProps === "object") GameData.props = combinedProps;
      }
    } catch (_) {}

    if (!GameData.tiles || !GameData.props) {
      logNotice("Combined assets missing or invalid (data/world/world_assets.json). tiles/props not loaded (strict mode).");
      try { console.warn("[GameData] Combined assets missing; tiles/props unavailable in strict mode."); } catch (_) {}
    }

    // If running under file://, note that JSON may not load due to fetch/CORS
    if (runningFromFile()) {
      logNotice("Detected file:// context; JSON registries may be unavailable. Modules will use internal fallbacks.");
    }

    // DEV-only: inject malformed entries to exercise validators when ?validatebad=1 is present
    (function maybeInjectBadJson() {
      try {
        const params = new URLSearchParams(location.search);
        const enabled = (params.get("validatebad") === "1") || (params.get("badjson") === "1");
        const dev = window.DEV || localStorage.getItem("DEV") === "1" || (params.get("dev") === "1");
        if (!enabled || !dev) return;
        window.ValidationLog = window.ValidationLog || { warnings: [], notices: [] };

        if (Array.isArray(GameData.items)) {
          GameData.items.push({ id: "bad_item_no_slot", name: "bad", atk: { "1": [0, 0] } });
          GameData.items.push({ id: "bad_item_no_ranges", slot: "hand", name: "bad2" });
          window.ValidationLog.notices.push("Injected bad item entries");
        }

        if (Array.isArray(GameData.enemies)) {
          GameData.enemies.push({ id: "bad_enemy_no_glyph", color: "#fff", tier: 1, weightByDepth: [[0, 0.1]] });
          GameData.enemies.push({ id: "bad_enemy_no_weights", glyph: "?", color: "#fff", tier: 1, hp: [[0, 3, 0.5]], atk: [[0, 1, 0.2]], xp: [[0, 5, 0.5]] });
          GameData.enemies.push({ id: "bad_enemy_no_stats", glyph: "x", color: "#fff", tier: 1, weightByDepth: [[0, 0.1]] });
          window.ValidationLog.notices.push("Injected bad enemy entries");
        }

        if (GameData.npcs && typeof GameData.npcs === "object") {
          GameData.npcs.residentLines = [];
          GameData.npcs.shopkeeperLines = [];
          window.ValidationLog.notices.push("Emptied some NPC arrays");
        }
        window.BAD_JSON_INJECTED = true;
      } catch (_) {}
    })();

    // Minimal validation/logging for NPCs schema
    (function validateNPCs() {
      const ND = GameData.npcs;
      if (!ND) { logNotice("NPCs registry missing; using defaults in AI/Town."); return; }
      function isArr(a) { return Array.isArray(a) && a.length > 0; }
      if (!isArr(ND.residentNames)) logNotice("NPCs: residentNames missing or empty.");
      if (!isArr(ND.residentLines)) logNotice("NPCs: residentLines missing or empty.");
      if (!isArr(ND.shopkeeperNames)) logNotice("NPCs: shopkeeperNames missing or empty.");
      if (!isArr(ND.shopkeeperLines)) logNotice("NPCs: shopkeeperLines missing or empty.");
      if (!isArr(ND.petCats)) logNotice("NPCs: petCats missing or empty.");
      if (!isArr(ND.petDogs)) logNotice("NPCs: petDogs missing or empty.");
    })();

    if (window.DEV) {
      try { console.debug("[GameData] loaded", { items: !!GameData.items, enemies: !!GameData.enemies, npcs: !!GameData.npcs, consumables: !!GameData.consumables, shops: !!GameData.shops, town: !!GameData.town, tiles: !!GameData.tiles, config: !!GameData.config, palette: !!GameData.palette, messages: !!GameData.messages, props: !!GameData.props, shopPhases: !!GameData.shopPhases, shopPools: !!GameData.shopPools, shopRules: !!GameData.shopRules, shopRestock: !!GameData.shopRestock, progression: !!GameData.progression }); } catch (_) {}
    }

    // If any registry failed to load, modules will use internal fallbacks.
    if (!GameData.items || !GameData.enemies || !GameData.npcs || !GameData.consumables || !GameData.town || !GameData.flavor || !GameData.tiles || !GameData.encounters) {
      logNotice("Some registries failed to load; modules will use internal fallbacks.");
    }
  } catch (e) {
    try { console.warn("[GameData] load error", e); } catch (_) {}
    // Keep whatever loaded; modules across the codebase provide sensible fallbacks.
    logNotice("Registry load error; using built-in defaults.");
  }
})();

import { attachGlobal } from "../utils/global.js";

// Back-compat: attach to window via helper
attachGlobal("GameData", GameData);