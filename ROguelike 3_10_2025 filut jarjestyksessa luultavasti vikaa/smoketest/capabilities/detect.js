(function () {
  // SmokeTest capability detection
  window.SmokeTest = window.SmokeTest || {};

  const Capabilities = {
    detect() {
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
        caps.enterDungeonIfOnEntrance = typeof api.enterDungeonIfOnEntrance === "function";
        caps.enterTownIfOnTile = typeof api.enterTownIfOnTile === "function";
        caps.routeTo = typeof api.routeTo === "function";
        caps.getWorld = typeof api.getWorld === "function";
        caps.getPlayer = typeof api.getPlayer === "function";
        // Inventory and equipment capabilities
        caps.getInventory = typeof api.getInventory === "function";
        caps.getStats = typeof api.getStats === "function";
        caps.getEquipment = typeof api.getEquipment === "function";
        caps.equipItemAtIndex = typeof api.equipItemAtIndex === "function";
        caps.getPotions = typeof api.getPotions === "function";
        caps.drinkPotionAtIndex = typeof api.drinkPotionAtIndex === "function";
        // Determinism/world anchors
        caps.nearestTown = typeof api.nearestTown === "function";
        caps.nearestDungeon = typeof api.nearestDungeon === "function";
        // Spawns and perf
        caps.spawnEnemyNearby = typeof api.spawnEnemyNearby === "function";
        caps.spawnItems = typeof api.spawnItems === "function";
        caps.addPotionToInventory = typeof api.addPotionToInventory === "function";
        caps.getPerf = typeof api.getPerf === "function";
      } catch (_) {}
      return caps;
    }
  };

  window.SmokeTest.Capabilities = Capabilities;
})();