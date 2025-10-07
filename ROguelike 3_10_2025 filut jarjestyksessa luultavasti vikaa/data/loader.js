/**
 * GameData loader: loads JSON registries for items, enemies, npcs, consumables, shops, town config.
 * Exposes:
 *   window.GameData = {
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
(function () {
  const DATA_FILES = {
    items: "data/items.json",
    enemies: "data/enemies.json",
    npcs: "data/npcs.json",
    consumables: "data/consumables.json",
    shops: "data/shops.json",
    town: "data/town.json",
  };

  // Compact defaults used when JSON is unavailable (e.g., file://)
  const DEFAULTS = {
    items: [
      // Hand: sword/axe/shield with tiered ranges
      { id: "sword", slot: "hand", name: "sword", weights: { "1": 0.6, "2": 0.8, "3": 0.7 },
        atk: { "1": [0.8, 2.4], "2": [1.2, 3.4], "3": [2.0, 4.0] } },
      { id: "axe", slot: "hand", name: "axe", weights: { "1": 0.3, "2": 0.5, "3": 0.6 },
        atk: { "1": [1.0, 2.6], "2": [1.6, 3.6], "3": [2.4, 4.0] }, atkBonus: { 2: [0.1,0.4], 3: [0.2,0.6] } },
      { id: "shield", slot: "hand", name: "shield", weights: { "1": 0.4, "2": 0.6, "3": 0.5 },
        def: { "1": [0.6, 2.0], "2": [1.2, 3.0], "3": [2.0, 3.8] } },
      // Armor pieces
      { id: "helmet", slot: "head", name: "helmet", weight: 1.0,
        def: { "1": [0.2, 1.4], "2": [0.8, 2.6], "3": [1.4, 3.4] } },
      { id: "torso_armor", slot: "torso", name: "armor", weight: 1.0,
        def: { "1": [0.6, 2.4], "2": [1.6, 3.6], "3": [2.4, 4.0] } },
      { id: "leg_armor", slot: "legs", name: "leg armor", weight: 1.0,
        def: { "1": [0.3, 1.8], "2": [1.0, 3.0], "3": [1.8, 3.8] } },
      { id: "gloves", slot: "hands", name: "gloves", weight: 1.0,
        def: { "1": [0.2, 1.2], "2": [0.8, 2.4], "3": [1.2, 3.0] }, handAtkBonus: { "2": [0.1, 0.6], "3": [0.2, 1.0] }, handAtkChance: 0.5 },
    ],
    enemies: [
      { id: "goblin", glyph: "g", color: "#a3e635", tier: 1,
        hp: [[0, 4, 0.2]], atk: [[0, 1, 0.15]], xp: [[0, 6, 0.2]],
        weightByDepth: [[0, 1.0], [3, 0.8], [6, 0.5]],
        equipChance: 0.35, potionWeights: { lesser: 0.6, average: 0.3, strong: 0.1 } },
      { id: "troll", glyph: "T", color: "#34d399", tier: 2,
        hp: [[0, 8, 0.4]], atk: [[0, 2, 0.25]], xp: [[0, 12, 0.5]],
        weightByDepth: [[2, 0.6], [5, 0.9], [8, 0.7]],
        equipChance: 0.55, potionWeights: { lesser: 0.5, average: 0.35, strong: 0.15 } },
      { id: "ogre", glyph: "O", color: "#f87171", tier: 3,
        hp: [[0, 12, 0.6]], atk: [[0, 3, 0.35]], xp: [[0, 20, 0.8]],
        weightByDepth: [[4, 0.4], [7, 0.8], [10, 0.9]],
        equipChance: 0.75, potionWeights: { lesser: 0.4, average: 0.35, strong: 0.25 } },
    ],
    npcs: {
      residentNames: ["Ava", "Borin", "Cora", "Darin", "Eda", "Finn", "Goro", "Hana"],
      residentLines: ["Lovely day on the plaza.", "Buy supplies before you go.", "Rest your feet a while."],
      shopkeeperNames: ["Smith", "Apothecary", "Armorer", "Trader"],
      shopkeeperLines: ["Open from dawn to dusk.", "Best wares in town.", "Have a look!"],
      petCats: ["Mittens", "Shadow"],
      petDogs: ["Rex", "Buddy"],
    },
    consumables: {
      potions: [
        { name: "lesser potion (+3 HP)", heal: 3, weight: 0.6 },
        { name: "average potion (+6 HP)", heal: 6, weight: 0.3 },
        { name: "strong potion (+10 HP)", heal: 10, weight: 0.1 },
      ]
    },
    // Town config influences size/plaza/roads; keep minimal keys
    town: {
      sizes: { small: { W: 60, H: 40 }, big: { W: 90, H: 60 }, city: { W: 120, H: 80 } },
      plaza: { small: { w: 10, h: 8 }, big: { w: 14, h: 12 }, city: { w: 18, h: 14 } },
      roads: { xStride: 10, yStride: 8 },
      buildings: { max: 18, blockW: 8, blockH: 6 },
      props: { benchLimit: { small: 8, big: 12, city: 16 }, plantTryFactor: 10 }
    }
  };

  function fetchJson(url) {
    return fetch(url, { cache: "no-cache" })
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.json();
      });
  }

  const GameData = {
    items: null,
    enemies: null,
    npcs: null,
    consumables: null,
    shops: null,
    town: null,
    ready: null,
  };

  function logNotice(msg) {
    try {
      if (window.Logger && typeof Logger.log === "function") {
        Logger.log(msg, "notice");
      } else if (window.DEV && typeof console !== "undefined") {
        console.debug("[GameData] " + msg);
      }
    } catch (_) {}
  }

  function runningFromFile() {
    try { return typeof location !== "undefined" && location.protocol === "file:"; } catch (_) { return false; }
  }

  function applyDefaultsIfNeeded() {
    // If any required registry is missing, hydrate from DEFAULTS
    if (!GameData.items) GameData.items = DEFAULTS.items.slice(0);
    if (!GameData.enemies) GameData.enemies = DEFAULTS.enemies.slice(0);
    if (!GameData.npcs) GameData.npcs = Object.assign({}, DEFAULTS.npcs);
    if (!GameData.consumables) GameData.consumables = Object.assign({}, DEFAULTS.consumables);
    // shops: TownGen has internal defaults if null; leave as-is unless present
    if (!GameData.town) GameData.town = Object.assign({}, DEFAULTS.town);
  }

  GameData.ready = (async function loadAll() {
    try {
      const [items, enemies, npcs, consumables, shops, town] = await Promise.all([
        fetchJson(DATA_FILES.items).catch(() => null),
        fetchJson(DATA_FILES.enemies).catch(() => null),
        fetchJson(DATA_FILES.npcs).catch(() => null),
        fetchJson(DATA_FILES.consumables).catch(() => null),
        fetchJson(DATA_FILES.shops).catch(() => null),
        fetchJson(DATA_FILES.town).catch(() => null),
      ]);

      GameData.items = Array.isArray(items) ? items : null;
      GameData.enemies = Array.isArray(enemies) ? enemies : null;
      GameData.npcs = (npcs && typeof npcs === "object") ? npcs : null;
      GameData.consumables = (consumables && typeof consumables === "object") ? consumables : null;
      GameData.shops = Array.isArray(shops) ? shops : null;
      GameData.town = (town && typeof town === "object") ? town : null;

      // If running under file://, prefer defaults immediately to avoid fetch/CORS issues
      if (runningFromFile()) {
        applyDefaultsIfNeeded();
        logNotice("Detected file:// context; applied built-in defaults for registries.");
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
        try { console.debug("[GameData] loaded", { items: !!GameData.items, enemies: !!GameData.enemies, npcs: !!GameData.npcs, consumables: !!GameData.consumables, shops: !!GameData.shops, town: !!GameData.town }); } catch (_) {}
      }

      // If any registry failed to load, fill from DEFAULTS as a graceful fallback
      if (!GameData.items || !GameData.enemies || !GameData.npcs || !GameData.consumables || !GameData.town) {
        applyDefaultsIfNeeded();
        logNotice("Some registries failed to load; applied built-in defaults.");
      }
    } catch (e) {
      try { console.warn("[GameData] load error", e); } catch (_) {}
      // Keep whatever loaded; fill in defaults for missing ones
      applyDefaultsIfNeeded();
      logNotice("Registry load error; using built-in defaults.");
    }
  })();

  window.GameData = GameData;
})();