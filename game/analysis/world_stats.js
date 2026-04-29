(function () {
  if (typeof window === "undefined") return;
  let params;
  try {
    params = new URLSearchParams(window.location.search || "");
  } catch (_) {
    return;
  }
  if (params.get("worldstats") !== "1") return;

  function log(msg, level, extra) {
    try {
      const Logger = window.Logger;
      if (Logger && typeof Logger.log === "function") {
        Logger.log(msg, level || "notice", Object.assign({ category: "World" }, extra || {}));
      }

      var panel = document.getElementById("world-stats-panel");
      if (!panel) {
        panel = document.createElement("pre");
        panel.id = "world-stats-panel";
        panel.style.position = "absolute";
        panel.style.left = "4px";
        panel.style.top = "80px";
        panel.style.zIndex = "9999";
        panel.style.fontSize = "11px";
        panel.style.color = "#e5e7eb";
        panel.style.background = "rgba(0,0,0,0.6)";
        panel.style.padding = "4px 6px";
        panel.style.maxWidth = "420px";
        panel.style.whiteSpace = "pre-wrap";
        panel.style.pointerEvents = "none";
        document.body.appendChild(panel);
      }

      panel.textContent += msg + "\n";
    } catch (_) {}
  }

  async function run() {
    try {
      const IG = window.InfiniteGen;
      const RNG = window.RNG;
      if (!IG || typeof IG.create !== "function" || !RNG || typeof RNG.getSeed !== "function") {
        log("[WorldStats] InfiniteGen or RNG not ready; aborting", "warn");
        return;
      }
      const seed = RNG.getSeed();
      const gen = IG.create(seed);
      const T = gen.TILES || {};

      const counts = Object.create(null);
      const radius = 120; // 241x241  58k tiles
      let total = 0;
      for (let y = -radius; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
          const t = gen.tileAt(x, y);
          counts[t] = (counts[t] || 0) + 1;
          total++;
        }
      }

      log("[WorldStats] Sampled " + total + " tiles around (0,0)", "notice");

      function label(id) {
        try {
          for (const [name, val] of Object.entries(T)) {
            if (val === id) return name;
          }
        } catch (_) {}
        return "id=" + id;
      }

      const keys = Object.keys(counts)
        .map(Number)
        .sort((a, b) => counts[b] - counts[a]);
      for (const id of keys) {
        const c = counts[id];
        const pct = ((c * 100) / total).toFixed(2);
        log(`[WorldStats] ${label(id)} (${id}) -> ${c} (${pct}%)`, "notice");
      }

      // Focused river/ford ratio
      const tile = {};
      for (const [name, val] of Object.entries(T)) tile[name] = val;
      const riverId = tile.RIVER;
      const shallowId = tile.SHALLOW;
      if (riverId != null && shallowId != null) {
        const riverTiles = counts[riverId] || 0;
        const shallowTiles = counts[shallowId] || 0;
        if (riverTiles + shallowTiles > 0) {
          const fordShare = ((shallowTiles * 100) / (riverTiles + shallowTiles)).toFixed(2);
          log(`[WorldStats] River tiles: RIVER=${riverTiles}, SHALLOW=${shallowTiles}, ford share=${fordShare}%`, "notice");
        }

        // 1D river segment analysis along y=0: how many river segments contain at least one SHALLOW tile
        let segments = 0;
        let segmentsWithFord = 0;
        let inSeg = false;
        let segHasFord = false;
        for (let x = -500; x <= 500; x++) {
          const t = gen.tileAt(x, 0);
          const isRiverish = t === riverId || t === shallowId;
          if (isRiverish) {
            if (!inSeg) {
              inSeg = true;
              segments++;
              segHasFord = false;
            }
            if (t === shallowId) segHasFord = true;
          } else {
            if (inSeg && segHasFord) segmentsWithFord++;
            inSeg = false;
          }
        }
        if (inSeg && segHasFord) segmentsWithFord++;
        if (segments > 0) {
          log(`[WorldStats] River segments on y=0: total=${segments}, withShallow=${segmentsWithFord}`, "notice");
        }
      }

      // Mountain fraction for sanity
      const mountainId = tile.MOUNTAIN;
      if (mountainId != null && total > 0) {
        const m = counts[mountainId] || 0;
        const mountainPct = ((m * 100) / total).toFixed(2);
        log(`[WorldStats] Mountains: MOUNTAIN=${m} (${mountainPct}%)`, "notice");
      }
    } catch (e) {
      log("[WorldStats] Error: " + (e && e.message ? e.message : String(e)), "error");
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(run, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(run, 0);
    });
  }
})();
