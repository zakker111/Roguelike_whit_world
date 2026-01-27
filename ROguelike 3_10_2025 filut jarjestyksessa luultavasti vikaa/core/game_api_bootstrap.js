/**
 * GameAPI bootstrap helpers extracted from core/game.js.
 *
 * This keeps core/game.js thinner by moving the GameAPI wiring into
 * a dedicated module. Behavior is preserved by injecting all needed
 * getters and helpers from the orchestrator.
 */

/**
 * Build and attach GameAPI facade via window.GameAPIBuilder.create.
 *
 * deps:
 * - getCtx()
 * - modHandle(name)
 * - getMode(), getWorld(), getPlayer(), getEnemies(), getNPCs(), getTownProps(),
 *   getCorpses(), getShops(), getDungeonExit(), getTownGate(), getMap(),
 *   getVisible(), getCamera(), getOccupancy(), getDecals(), getPerfStats()
 * - TILES
 * - tryMovePlayer(dx,dy), enterTownIfOnTile(), enterDungeonIfOnEntrance()
 * - isWalkable(x,y), inBounds(x,y)
 * - updateCamera(), recomputeFOV(), requestDraw(), updateUI()
 * - renderInventoryPanel(), equipItemByIndex(), equipItemByIndexHand(), unequipSlot()
 * - drinkPotionByIndex(), addPotionToInventory()
 * - getPlayerAttack(), getPlayerDefense()
 * - isShopOpenNow(shop), shopScheduleStr(shop)
 * - advanceTimeMinutes(mins), getWeatherSnapshot()
 * - returnToWorldIfAtExit(), returnToWorldFromTown(), initWorld()
 * - startEscortAutoTravel(), getClock(), log(msg,type)
 */
export function buildGameAPIImpl(deps) {
  try {
    if (
      typeof window === "undefined" ||
      !window.GameAPIBuilder ||
      typeof window.GameAPIBuilder.create !== "function"
    ) {
      return;
    }

    const {
      getCtx,
      modHandle,
      getMode,
      getWorld,
      getPlayer,
      getEnemies,
      getNPCs,
      getTownProps,
      getCorpses,
      getShops,
      getDungeonExit,
      getTownGate,
      getMap,
      getVisible,
      getCamera,
      getOccupancy,
      getDecals,
      getPerfStats,
      TILES,
      tryMovePlayer,
      enterTownIfOnTile,
      enterDungeonIfOnEntrance,
      isWalkable,
      inBounds,
      updateCamera,
      recomputeFOV,
      requestDraw,
      updateUI,
      renderInventoryPanel,
      equipItemByIndex,
      equipItemByIndexHand,
      unequipSlot,
      drinkPotionByIndex,
      addPotionToInventory,
      getPlayerAttack,
      getPlayerDefense,
      isShopOpenNow,
      shopScheduleStr,
      advanceTimeMinutes,
      getWeatherSnapshot,
      returnToWorldIfAtExit,
      returnToWorldFromTown,
      initWorld,
      startEscortAutoTravel,
      setAlwaysCrit,
      setCritPart,
      godSpawnEnemyNearby,
      godSpawnItems,
      generateLoot,
      getClock,
      log,
      enterSandboxRoom,
    } = deps;

    window.GameAPI = window.GameAPIBuilder.create({
      // Orchestrator sync helper (exposed so helpers like sandbox can request a full ctx→engine sync).
      applyCtxSyncAndRefresh: (ctx) => {
        try {
          if (typeof deps.applyCtxSyncAndRefresh === "function") {
            deps.applyCtxSyncAndRefresh(ctx);
          }
        } catch (_) {}
      },
      getMode: () => getMode(),
      getWorld: () => getWorld(),
      getPlayer: () => getPlayer(),
      getEnemies: () => getEnemies(),
      getNPCs: () => getNPCs(),
      getTownProps: () => getTownProps(),
      getCorpses: () => getCorpses(),
      getShops: () => getShops(),
      getDungeonExit: () => getDungeonExit(),
      getTownGate: () => getTownGate(),
      getMap: () => getMap(),
      getVisible: () => getVisible(),
      getCamera: () => getCamera(),
      getOccupancy: () => getOccupancy(),
      getDecals: () => getDecals(),
      getPerfStats: () => getPerfStats(),
      TILES,
      tryMovePlayer: (dx, dy) => tryMovePlayer(dx, dy),
      enterTownIfOnTile: () => enterTownIfOnTile(),
      enterDungeonIfOnEntrance: () => enterDungeonIfOnEntrance(),
      isWalkable: (x, y) => isWalkable(x, y),
      inBounds: (x, y) => inBounds(x, y),
      updateCamera: () => updateCamera(),
      recomputeFOV: () => recomputeFOV(),
      requestDraw: () => requestDraw(),
      updateUI: () => updateUI(),
      renderInventoryPanel: () => renderInventoryPanel(),
      equipItemByIndex: (idx) => equipItemByIndex(idx),
      equipItemByIndexHand: (idx, hand) => equipItemByIndexHand(idx, hand),
      unequipSlot: (slot) => unequipSlot(slot),
      drinkPotionByIndex: (idx) => drinkPotionByIndex(idx),
      addPotionToInventory: (heal, name) => addPotionToInventory(heal, name),
      getPlayerAttack: () => getPlayerAttack(),
      getPlayerDefense: () => getPlayerDefense(),
      isShopOpenNow: (shop) => isShopOpenNow(shop),
      shopScheduleStr: (shop) => shopScheduleStr(shop),
      advanceTimeMinutes: (mins) => advanceTimeMinutes(mins),
      getWeather: () => getWeatherSnapshot(),
      // Mode transitions
      returnToWorldIfAtExit: () => returnToWorldIfAtExit(),
      returnToWorldFromTown: () => returnToWorldFromTown(),
      initWorld: () => initWorld(),
      // Encounter helper: enter and sync a unique encounter map, using dungeon enemies under the hood
      enterEncounter: (template, biome, difficulty = 1) => {
        const ctx = getCtx();
        const MT = modHandle("ModesTransitions");
        if (MT && typeof MT.enterEncounter === "function") {
          return !!MT.enterEncounter(
            ctx,
            template,
            biome,
            difficulty,
            deps.applyCtxSyncAndRefresh
          );
        }
        return false;
      },
      // Open Region Map at current overworld tile and sync orchestrator state
      openRegionMap: () => {
        const ctx = getCtx();
        const MT = modHandle("ModesTransitions");
        if (MT && typeof MT.openRegionMap === "function") {
          return !!MT.openRegionMap(ctx, deps.applyCtxSyncAndRefresh);
        }
        return false;
      },
      // Start an encounter inside the active Region Map (ctx.mode === "region")
      startRegionEncounter: (template, biome) => {
        const ctx = getCtx();
        const MT = modHandle("ModesTransitions");
        if (MT && typeof MT.startRegionEncounter === "function") {
          return !!MT.startRegionEncounter(
            ctx,
            template,
            biome,
            deps.applyCtxSyncAndRefresh
          );
        }
        return false;
      },
      // Complete the active encounter immediately and sync back to orchestrator state.
      // Used by special flows like caravan encounters to return to the overworld without
      // requiring the player to walk to an exit tile.
      completeEncounter: (outcome = "victory") => {
        const ctx = getCtx();
        const MT = modHandle("ModesTransitions");
        if (MT && typeof MT.completeEncounter === "function") {
          return !!MT.completeEncounter(
            ctx,
            outcome,
            deps.applyCtxSyncAndRefresh,
            { startEscortAutoTravel }
          );
        }
        return false;
      },
      // GOD/helpers
      setAlwaysCrit: (v) => setAlwaysCrit(v),
      setCritPart: (part) => setCritPart(part),
      godSpawnEnemyNearby: (count) => godSpawnEnemyNearby(count),
      godSpawnItems: (count) => godSpawnItems(count),
      generateLoot: (source) => generateLoot(source),
      getClock: () => getClock(),
      getCtx: () => getCtx(),
      log: (msg, type) => log(msg, type),
      enterSandboxRoom: () => enterSandboxRoom(),
    });
  } catch (_) {}
}