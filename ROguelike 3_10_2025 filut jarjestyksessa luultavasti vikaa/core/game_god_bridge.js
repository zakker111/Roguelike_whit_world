/**
 * Game GOD bridge helpers extracted from core/game.js.
 *
 * This keeps core/game.js thinner by centralizing GOD actions and
 * seed/restart flows behind a small dependency-injected bridge.
 */

import { godActions } from "./engine/game_god.js";
import {
  setAlwaysCrit as setAlwaysCritFacade,
  setCritPart as setCritPartFacade,
  godSpawnEnemyNearby as godSpawnEnemyNearbyFacade,
  godSpawnItems as godSpawnItemsFacade,
  godHeal as godHealFacade,
  godSpawnStairsHere as godSpawnStairsHereFacade,
  godSpawnEnemyById as godSpawnEnemyByIdFacade,
} from "./god/facade.js";

/**
 * Create GOD helpers bound to the orchestrator's state and helpers.
 *
 * deps:
 * - getCtx(): ctx
 * - log(msg, type)
 * - applyCtxSyncAndRefresh(ctx)
 * - setAlwaysCritFlag(bool)
 * - setForcedCritPartFlag(part)
 * - setRng(newRng)
 * - setFloor(n)
 * - setIsDead(bool)
 * - getPlayer(): player object
 * - setModeWorld(): set mode to "world"
 * - initWorld(): regenerate overworld
 * - modHandle(name): module resolver
 * - hideGameOver(): hides game over panel
 */
export function createGodBridge(deps) {
  function getCtx() {
    return deps.getCtx();
  }

  function makeGodActions(ctx) {
    return godActions({
      ctx,
      log: deps.log,
      setAlwaysCritFacade,
      setCritPartFacade,
      godSpawnEnemyNearbyFacade,
      godSpawnItemsFacade,
      godHealFacade,
      godSpawnStairsHereFacade,
      godSpawnEnemyByIdFacade,
    });
  }

  function setAlwaysCrit(v) {
    const ctx = getCtx();
    const actions = makeGodActions(ctx);
    if (actions.setAlwaysCrit(v)) {
      if (typeof deps.setAlwaysCritFlag === "function") {
        deps.setAlwaysCritFlag(!!v);
      }
    }
  }

  function setCritPart(part) {
    const ctx = getCtx();
    const actions = makeGodActions(ctx);
    if (actions.setCritPart(part)) {
      if (typeof deps.setForcedCritPartFlag === "function") {
        deps.setForcedCritPartFlag(part);
      }
    }
  }

  function godHeal() {
    const ctx = getCtx();
    const actions = makeGodActions(ctx);
    actions.godHeal();
  }

  function godSpawnStairsHere() {
    const ctx = getCtx();
    const actions = makeGodActions(ctx);
    actions.godSpawnStairsHere();
  }

  function godSpawnItems(count = 3) {
    const ctx = getCtx();
    const actions = makeGodActions(ctx);
    actions.godSpawnItems(count);
  }

  function godSpawnEnemyNearby(count = 1) {
    const ctx = getCtx();
    const actions = makeGodActions(ctx);
    actions.godSpawnEnemyNearby(count);
  }

  function godSpawnEnemyById(id, count = 1) {
    const ctx = getCtx();
    const actions = makeGodActions(ctx);
    actions.godSpawnEnemyById(id, count);
  }

  function applySeed(seedUint32) {
    if (typeof deps.applySeed === "function") {
      deps.applySeed(seedUint32);
      return;
    }
  }

  function rerollSeed() {
    if (typeof deps.rerollSeed === "function") {
      deps.rerollSeed();
      return;
    }
  }

  function restartGame() {
    // Prefer centralized DeathFlow / original restart behavior via deps.restartGame().
    if (typeof deps.restartGame === "function") {
      deps.restartGame();
      return;
    }

    // If deps.restartGame is missing, no local fallback is applied here.
    // Original core/game.js legacy restart path remains where needed.
  }

  return {
    setAlwaysCrit,
    setCritPart,
    godHeal,
    godSpawnStairsHere,
    godSpawnItems,
    godSpawnEnemyNearby,
    godSpawnEnemyById,
    applySeed,
    rerollSeed,
    restartGame,
  };
}