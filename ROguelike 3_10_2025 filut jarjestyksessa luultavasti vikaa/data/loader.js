/**
 * GameData loader: loads JSON registries for items, enemies, and npcs.
 * Exposes:
 *   window.GameData = {
 *     ready: Promise<void>,
 *     items: Array | null,
 *     enemies: Array | null,
 *     npcs: { residents: {...}, shopkeepers: {...}, pets: {...} } | null
 *   }
 */
(function () {
  const DATA_FILES = {
    items: "data/items.json",
    enemies: "data/enemies.json",
    npcs: "data/npcs.json",
    consumables: "data/consumables.json",
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
      const [items, enemies, npcs, consumables] = await Promise.all([
        fetchJson(DATA_FILES.items).catch(() => null),
        fetchJson(DATA_FILES.enemies).catch(() => null),
        fetchJson(DATA_FILES.npcs).catch(() => null),
        fetchJson(DATA_FILES.consumables).catch(() => null),
      ]);
      GameData.items = Array.isArray(items) ? items : null;
      GameData.enemies = Array.isArray(enemies) ? enemies : null;
      GameData.npcs = (npcs && typeof npcs === "object") ? npcs : null;
      GameData.consumables = (consumables && typeof consumables === "object") ? consumables : null;
      if (window.DEV) {
        try { console.debug("[GameData] loaded", { items: !!GameData.items, enemies: !!GameData.enemies, npcs: !!GameData.npcs, consumables: !!GameData.consumables }); } catch (_) {}
      }
      // Surface a gentle notice if any registry failed; system will fall back gracefully
      if (!GameData.items || !GameData.enemies || !GameData.npcs) {
        logNotice("Some registries failed to load; using fallback data where needed.");
      }
    } catch (e) {
      try { console.warn("[GameData] load error", e); } catch (_) {}
      GameData.items = GameData.items || null;
      GameData.enemies = GameData.enemies || null;
      GameData.npcs = GameData.npcs || null;
      GameData.consumables = GameData.consumables || null;
      logNotice("Registry load error; using fallback data.");
    }
  })();

  window.GameData = GameData;
})();