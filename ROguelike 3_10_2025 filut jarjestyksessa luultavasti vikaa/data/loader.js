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
    ready: null,
  };

  GameData.ready = (async function loadAll() {
    try {
      const [items, enemies, npcs] = await Promise.all([
        fetchJson(DATA_FILES.items).catch(() => null),
        fetchJson(DATA_FILES.enemies).catch(() => null),
        fetchJson(DATA_FILES.npcs).catch(() => null),
      ]);
      GameData.items = Array.isArray(items) ? items : null;
      GameData.enemies = Array.isArray(enemies) ? enemies : null;
      GameData.npcs = (npcs && typeof npcs === "object") ? npcs : null;
      if (window.DEV) {
        try { console.debug("[GameData] loaded", { items: !!GameData.items, enemies: !!GameData.enemies, npcs: !!GameData.npcs }); } catch (_) {}
      }
    } catch (e) {
      try { console.warn("[GameData] load error", e); } catch (_) {}
      GameData.items = GameData.items || null;
      GameData.enemies = GameData.enemies || null;
      GameData.npcs = GameData.npcs || null;
    }
  })();

  window.GameData = GameData;
})();