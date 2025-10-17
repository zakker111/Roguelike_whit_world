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
  items: "data/items.json",
  enemies: "data/enemies.json",
  npcs: "data/npcs.json",
  consumables: "data/consumables.json",
  shops: "data/shops.json",
  town: "data/town.json",
  flavor: "data/flavor.json",
  tiles: "data/tiles.json",
};

// Compact defaults used when JSON is unavailable (e.g., file://)
// Minimal defaults to avoid duplicating JSON content.
// Intentionally left empty so modules use their own internal fallbacks when data is missing.
const DEFAULTS = {};

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

function applyDefaultsIfNeeded() {
  // No-op: avoid duplicating JSON content with hardcoded defaults.
  // Modules across the codebase already provide sensible fallbacks when registries are missing.
}

GameData.ready = (async function loadAll() {
  try {
    const [items, enemies, npcs, consumables, shops, town, flavor, tiles] = await Promise.all([
      fetchJson(DATA_FILES.items).catch(() => null),
      fetchJson(DATA_FILES.enemies).catch(() => null),
      fetchJson(DATA_FILES.npcs).catch(() => null),
      fetchJson(DATA_FILES.consumables).catch(() => null),
      fetchJson(DATA_FILES.shops).catch(() => null),
      fetchJson(DATA_FILES.town).catch(() => null),
      fetchJson(DATA_FILES.flavor).catch(() => null),
      fetchJson(DATA_FILES.tiles).catch(() => null),
    ]);

    GameData.items = Array.isArray(items) ? items : null;
    GameData.enemies = Array.isArray(enemies) ? enemies : null;
    GameData.npcs = (npcs && typeof npcs === "object") ? npcs : null;
    GameData.consumables = (consumables && typeof consumables === "object") ? consumables : null;
    GameData.shops = Array.isArray(shops) ? shops : null;
    GameData.town = (town && typeof town === "object") ? town : null;
    GameData.flavor = (flavor && typeof flavor === "object") ? flavor : null;
    GameData.tiles = (tiles && typeof tiles === "object" && Array.isArray(tiles.tiles)) ? tiles : null;

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

    // Tiles.json validation: warn when critical fields are missing or conflicting
    (function validateTiles() {
      const TD = GameData.tiles;
      if (!TD || !Array.isArray(TD.tiles)) { logNotice("Tiles registry missing or malformed."); return; }
      const tiles = TD.tiles;
      const seenByMode = { overworld: new Map(), region: new Map(), dungeon: new Map(), town: new Map() };
      let missingFill = 0, missingProps = 0, duplicateIdMode = 0;

      function add(mode, id, t) {
        const m = seenByMode[mode];
        if (!m) return;
        if (m.has(id)) {
          duplicateIdMode++;
        } else {
          m.set(id, t);
        }
      }

      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const id = (t && typeof t.id === "number") ? (t.id | 0) : null;
        const appears = Array.isArray(t && t.appearsIn) ? t.appearsIn : [];
        if (id == null || appears.length === 0) {
          logNotice(`Tiles: entry ${i} missing id or appearsIn.`);
          continue;
        }
        for (const modeRaw of appears) {
          const mode = String(modeRaw).toLowerCase();
          add(mode, id, t);
          // colors.fill recommended for base layer draw
          if (!t.colors || !t.colors.fill) missingFill++;
          // properties.walkable/blocksFOV recommended for behavior consistency
          const props = t.properties || {};
          if (typeof props.walkable !== "boolean" && typeof props.blocksFOV !== "boolean") missingProps++;
        }
      }

      if (duplicateIdMode > 0) logNotice(`Tiles: ${duplicateIdMode} duplicate id+mode entries detected (conflicting definitions).`);
      if (missingFill > 0) logNotice(`Tiles: ${missingFill} entries without colors.fill (those tiles will not render base layer).`);
      if (missingProps > 0) logNotice(`Tiles: ${missingProps} entries without walkable/blocksFOV properties (movement/LOS may be ambiguous).`);

      // Overrides format check (optional)
      const overrides = TD.overrides;
      if (overrides && typeof overrides === "object") {
        for (const mode of Object.keys(overrides)) {
          const ov = overrides[mode];
          if (!ov || typeof ov !== "object") continue;
          for (const key of Object.keys(ov)) {
            const val = ov[key];
            if (val && typeof val === "object") {
              // okay
            } else {
              logNotice(`Tiles: override ${mode}.${key} should be an object of property overrides.`);
            }
          }
        }
      }
    })();

    if (window.DEV) {
      try { console.debug("[GameData] loaded", { items: !!GameData.items, enemies: !!GameData.enemies, npcs: !!GameData.npcs, consumables: !!GameData.consumables, shops: !!GameData.shops, town: !!GameData.town, tiles: !!GameData.tiles }); } catch (_) {}
    }

    // If any registry failed to load, modules will use internal fallbacks.
    if (!GameData.items || !GameData.enemies || !GameData.npcs || !GameData.consumables || !GameData.town || !GameData.flavor || !GameData.tiles) {
      logNotice("Some registries failed to load; modules will use internal fallbacks.");
    }
  } catch (e) {
    try { console.warn("[GameData] load error", e); } catch (_) {}
    // Keep whatever loaded; fill in defaults for missing ones
    applyDefaultsIfNeeded();
    logNotice("Registry load error; using built-in defaults.");
  }
})();

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.GameData = GameData;
}