/**
 * GameGod: orchestrator-adjacent helpers for GOD actions and restart/seed control.
 *
 * This module keeps core/game.js thinner while delegating to:
 * - core/god/facade.js for immediate GOD actions (heal, spawn, crit toggles)
 * - core/god/controls.js for seed/reroll flows
 * - core/death_flow.js for restart
 *
 * It intentionally does NOT own global state; callers pass ctx and small callbacks.
 */

import { attachGlobal } from "../../utils/global.js";

/**
 * Wrap core/god/facade.js GOD actions.
 *
 * opts:
 * - ctx: current ctx
 * - log(msg, type): logging function
 * - setAlwaysCritFacade(ctx, v), setCritPartFacade(ctx, part)
 * - godSpawnEnemyNearbyFacade(ctx, count), godSpawnItemsFacade(ctx, count)
 * - godHealFacade(ctx), godSpawnStairsHereFacade(ctx)
 */
export function godActions(opts) {
  return {
    setAlwaysCrit(v) {
      try {
        if (opts && typeof opts.setAlwaysCritFacade === "function") {
          const ok = opts.setAlwaysCritFacade(opts.ctx, v);
          if (ok) return true;
        }
      } catch (_) {}
      try {
        if (opts && typeof opts.log === "function") {
          opts.log("GOD: setAlwaysCrit not available.", "warn");
        }
      } catch (_) {}
      return false;
    },
    setCritPart(part) {
      try {
        if (opts && typeof opts.setCritPartFacade === "function") {
          const ok = opts.setCritPartFacade(opts.ctx, part);
          if (ok) return true;
        }
      } catch (_) {}
      try {
        if (opts && typeof opts.log === "function") {
          opts.log("GOD: setCritPart not available.", "warn");
        }
      } catch (_) {}
      return false;
    },
    godHeal() {
      try {
        if (opts && typeof opts.godHealFacade === "function") {
          const ok = opts.godHealFacade(opts.ctx);
          if (ok) return true;
        }
      } catch (_) {}
      try {
        if (opts && typeof opts.log === "function") {
          opts.log("GOD: heal not available.", "warn");
        }
      } catch (_) {}
      return false;
    },
    godSpawnStairsHere() {
      try {
        if (opts && typeof opts.godSpawnStairsHereFacade === "function") {
          const ok = opts.godSpawnStairsHereFacade(opts.ctx);
          if (ok) return true;
        }
      } catch (_) {}
      try {
        if (opts && typeof opts.log === "function") {
          opts.log("GOD: spawnStairsHere not available.", "warn");
        }
      } catch (_) {}
      return false;
    },
    godSpawnItems(count = 3) {
      try {
        if (opts && typeof opts.godSpawnItemsFacade === "function") {
          const ok = opts.godSpawnItemsFacade(opts.ctx, count);
          if (ok) return true;
        }
      } catch (_) {}
      try {
        if (opts && typeof opts.log === "function") {
          opts.log("GOD: spawnItems not available.", "warn");
        }
      } catch (_) {}
      return false;
    },
    godSpawnEnemyNearby(count = 1) {
      try {
        if (opts && typeof opts.godSpawnEnemyNearbyFacade === "function") {
          const ok = opts.godSpawnEnemyNearbyFacade(opts.ctx, count);
          if (ok) return true;
        }
      } catch (_) {}
      try {
        if (opts && typeof opts.log === "function") {
          opts.log("GOD: spawnEnemyNearby not available.", "warn");
        }
      } catch (_) {}
      return false;
    },
  };
}

/**
 * Seed / restart helpers.
 *
 * opts:
 * - getCtx(): () => ctx
 * - applyCtxSyncAndRefresh(ctx)
 * - clearPersistentGameStorage(): clears persisted game state
 * - log(msg, type)
 */
export function godSeedAndRestart(opts) {
  return {
    applySeed(seedUint32) {
      try {
        const ctx = opts.getCtx();
        const GC =
          (ctx && ctx.GodControls) ||
          (typeof window !== "undefined" ? window.GodControls : null);
        if (GC && typeof GC.applySeed === "function") {
          GC.applySeed(() => opts.getCtx(), seedUint32);
          // GC may update ctx.rng; ensure orchestrator sees it
          if (ctx && ctx.rng) {
            try {
              opts.onRngUpdated && opts.onRngUpdated(ctx.rng);
            } catch (_) {}
          }
          opts.applyCtxSyncAndRefresh(ctx);
          return true;
        }
      } catch (_) {}
      try {
        if (typeof opts.log === "function") {
          opts.log("GOD: applySeed not available.", "warn");
        }
      } catch (_) {}
      return false;
    },

    rerollSeed() {
      // Always clear persisted game states before rerolling to avoid cross-seed leaks
      try {
        if (typeof opts.clearPersistentGameStorage === "function") {
          opts.clearPersistentGameStorage();
        }
      } catch (_) {}

      try {
        const ctx = opts.getCtx();
        const GC =
          (ctx && ctx.GodControls) ||
          (typeof window !== "undefined" ? window.GodControls : null);
        if (GC && typeof GC.rerollSeed === "function") {
          GC.rerollSeed(() => opts.getCtx());
          if (ctx && ctx.rng) {
            try {
              opts.onRngUpdated && opts.onRngUpdated(ctx.rng);
            } catch (_) {}
          }
          opts.applyCtxSyncAndRefresh(ctx);
          return true;
        }
      } catch (_) {}
      try {
        if (typeof opts.log === "function") {
          opts.log("GOD: rerollSeed not available.", "warn");
        }
      } catch (_) {}
      return false;
    },

    restartGame() {
      try {
        const ctx = opts.getCtx();
        const DF =
          (ctx && ctx.DeathFlow) ||
          (typeof window !== "undefined" ? window.DeathFlow : null);
        if (DF && typeof DF.restart === "function") {
          DF.restart(ctx);
          return true;
        }
      } catch (_) {}
      // If DeathFlow is missing, the orchestrator still has a built-in fallback.
      return false;
    },
  };
}

// Back-compat / debug
attachGlobal("GameGod", { godActions, godSeedAndRestart });