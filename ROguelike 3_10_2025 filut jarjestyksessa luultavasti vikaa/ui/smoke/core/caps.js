// SmokeTest capability detection against GameAPI/UI.

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

  window.SmokeCore = window.SmokeCore || {};
  window.SmokeCore.Caps = { detectCaps };
})();