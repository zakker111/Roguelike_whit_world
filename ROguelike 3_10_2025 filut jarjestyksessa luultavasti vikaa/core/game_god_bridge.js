/**
 * Game GOD bridge helpers extracted from core/game.js.
 *
 * This keeps core/game.js thinner by centralizing GOD actions and
 * seed/restart flows behind a small dependency-injected bridge.
 */

import { godActions, godSeedAndRestart } from "./engine/game_god.js";
import {
  setAlwaysCrit as setAlwaysCritFacade,
  setCritPart as setCritPartFacade,
  godSpawnEnemyNearby as godSpawnEnemyNearbyFacade,
  godSpawnItems as godSpawnItemsFacade,
  godHeal as godHealFacade,
  godSpawnStairsHere as godSpawnStairsHereFacade,
} from "./god/facade.js";
import { clearPersistentGameStorage as clearPersistentGameStorageExt } from "./state/persistence.js";

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

  function clearPersistentGameStorage() {
    try {
      clearPersistentGameStorageExt(getCtx());
    } catch (_) {}
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

  function applySeed(seedUint32) {
    const helpers = godSeedAndRestart({
      getCtx,
      applyCtxSyncAndRefresh: deps.applyCtxSyncAndRefresh,
      clearPersistentGameStorage,
      log: deps.log,
      onRngUpdated: (newRng) => {
        if (typeof deps.setRng === "function") {
          deps.setRng(newRng);
        }
      },
    });
    helpers.applySeed(seedUint32);
  }

  function rerollSeed() {
    const helpers = godSeedAndRestart({
      getCtx,
      applyCtxSyncAndRefresh: deps.applyCtxSyncAndRefresh,
      clearPersistentGameStorage,
      log: deps.log,
      onRngUpdated: (newRng) => {
        if (typeof deps.setRng === "function") {
          deps.setRng(newRng);
        }
      },
    });
    helpers.rerollSeed();
  }

  function restartGame() {
    const helpers = godSeedAndRestart({
      getCtx,
      applyCtxSyncAndRefresh: deps.applyCtxSyncAndRefresh,
      clearPersistentGameStorage,
      log: deps.log,
      onRngUpdated: (newRng) => {
        if (typeof deps.setRng === "function") {
          deps.setRng(newRng);
        }
      },
    });
    // Prefer centralized DeathFlow; fall back to local restart path if needed.
    const handled = helpers.restartGame();
    if (handled) return;

    if (typeof deps.hideGameOver === "function") {
      deps.hideGameOver();
    }
    clearPersistentGameStorage();
    if (typeof deps.setFloor === "function") {
      deps.setFloor(1);
    }
    if (typeof deps.setIsDead === "function") {
      deps.setIsDead(false);
    }

    try {
      const P = deps.modHandle("Player");
      const player = deps.getPlayer && deps.getPlayer();
      if (P && typeof P.resetFromDefaults === "function" && player) {
        P.resetFromDefaults(player);
      }
      if (player) {
        player.bleedTurns = 0;
        player.dazedTurns = 0;
      }
    } catch (_) {}

    if (typeof deps.setModeWorld === "function") {
      deps.setModeWorld();
    }

    // Try GodControls.rerollSeed which applies and persists a new seed, then regenerates overworld
    try {
      const GC = deps.modHandle("GodControls");
      if (GC && typeof GC.rerollSeed === "function") {
        GC.rerollSeed(() => getCtx());
        return;
      }
    } catch (_) {}

    // Fallback: apply a time-based seed via RNG service or direct init, then generate world
    try {
      const s = (Date.now() % 0xffffffff) >>> 0;
      if (
        typeof window !== "undefined" &&
        window.RNG &&
        typeof window.RNG.applySeed === "function"
      ) {
        window.RNG.applySeed(s);
        if (typeof deps.setRng === "function") {
          deps.setRng(window.RNG.rng);
        }
        deps.initWorld();
        return;
      }
    } catch (_) {}

    // Ultimate fallback: no RNG service, just init world (non-deterministic)
    deps.initWorld();
  }

  return {
    setAlwaysCrit,
    setCritPart,
    godHeal,
    godSpawnStairsHere,
    godSpawnItems,
    godSpawnEnemyNearby,
    applySeed,
    rerollSeed,
    restartGame,
    clearPersistentGameStorage,
  };
}