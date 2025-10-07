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
      // Surface a gentle notice if any registry failed; system will fall back gracefully
      if (!GameData.items || !GameData.enemies || !GameData.npcs || !GameData.shops || !GameData.town) {
        logNotice("Some registries failed to load; using fallback data where needed.");
      }
    } catch (e) {
      try { console.warn("[GameData] load error", e); } catch (_) {}
      GameData.items = GameData.items || null;
      GameData.enemies = GameData.enemies || null;
      GameData.npcs = GameData.npcs || null;
      GameData.consumables = GameData.consumables || null;
      GameData.shops = GameData.shops || null;
      GameData.town = GameData.town || null;
      logNotice("Registry load error; using fallback data.");
    }
  })();

  window.GameData = GameData;
})();