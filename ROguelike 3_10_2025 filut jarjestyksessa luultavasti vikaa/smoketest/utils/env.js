// SmokeTest environment helpers
(function () {
  function detectCaps() {
    const caps = {};
    try {
      caps.GameAPI = !!window.GameAPI;
      const api = window.GameAPI || {};
      caps.getMode = typeof api.getMode === "function";
      caps.getEnemies = typeof api.getEnemies === "function";
      caps.getTownProps = typeof api.getTownProps === "function";
      caps.getNPCs = typeof api.getNPCs === "function";
      caps.routeToDungeon = typeof api.routeToDungeon === "function";
      caps.gotoNearestDungeon = typeof api.gotoNearestDungeon === "function";
      caps.gotoNearestTown = typeof api.gotoNearestTown === "function";
      caps.getChestsDetailed = typeof api.getChestsDetailed === "function";
      caps.getDungeonExit = typeof api.getDungeonExit === "function";
      caps.checkHomeRoutes = typeof api.checkHomeRoutes === "function";
      caps.getShops = typeof api.getShops === "function";
      caps.isShopOpenNowFor = typeof api.isShopOpenNowFor === "function";
      caps.getShopSchedule = typeof api.getShopSchedule === "function";
      caps.advanceMinutes = typeof api.advanceMinutes === "function";
      caps.getClock = typeof api.getClock === "function";
      caps.equipItemAtIndexHand = typeof api.equipItemAtIndexHand === "function";
    } catch (_) {}
    return caps;
  }
  function devRandomAudit() {
    try {
      if (!(window.DEV || localStorage.getItem("DEV") === "1")) return { scanned: 0, hits: [] };
      const scripts = Array.from(document.scripts || []);
      const hits = [];
      for (const s of scripts) {
        const src = s.src || "";
        if (!src) continue;
        if (src.startsWith(location.origin)) {
          // no-op, avoid fetching here
        }
        if (!src && s.text && s.text.includes("Math.random")) {
          hits.push({ type: "inline", snippet: (s.text || "").slice(0, 120) });
        }
      }
      try {
        const html = document.documentElement.outerHTML || "";
        if ((html.match(/Math\.random/g) || []).length > 0) {
          hits.push({ type: "dom", note: "Math.random appears in page HTML (might be harmless)." });
        }
      } catch (_) {}
      return { scanned: scripts.length, hits };
    } catch (_) {
      return { scanned: 0, hits: [] };
    }
  }
  window.SmokeEnv = { detectCaps, devRandomAudit };
})();