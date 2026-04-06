import { exitToWorld as exitToWorldExt } from "../modes/exit.js";

export function createModeOps({ getCtx, applyCtxSyncAndRefresh, log, modHandle }) {
  function enterTownIfOnTile() {
    const ctx = getCtx();
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.enterTownIfOnTile === "function") {
      return !!MT.enterTownIfOnTile(ctx, applyCtxSyncAndRefresh);
    }
    return false;
  }

  function enterDungeonIfOnEntrance() {
    const ctx = getCtx();
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.enterDungeonIfOnEntrance === "function") {
      return !!MT.enterDungeonIfOnEntrance(ctx, applyCtxSyncAndRefresh);
    }
    return false;
  }

  function leaveTownNow() {
    const ctx = getCtx();
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.leaveTownNow === "function") {
      MT.leaveTownNow(ctx, applyCtxSyncAndRefresh);
    }
  }

  function requestLeaveTown() {
    const ctx = getCtx();
    const MT = modHandle("ModesTransitions");
    if (MT && typeof MT.requestLeaveTown === "function") {
      MT.requestLeaveTown(ctx);
    }
  }

  function returnToWorldFromTown() {
    const ctx = getCtx();
    const logExitHint = (c) => {
      const MZ = modHandle("Messages");
      if (MZ && typeof MZ.log === "function") {
        MZ.log(c, "town.exitHint");
      } else {
        log("Return to the town gate to exit to the overworld.", "info");
      }
    };
    return !!exitToWorldExt(ctx, {
      reason: "gate",
      applyCtxSyncAndRefresh,
      logExitHint
    });
  }

  function returnToWorldIfAtExit() {
    const ctx = getCtx();
    return !!exitToWorldExt(ctx, {
      reason: "stairs",
      applyCtxSyncAndRefresh
    });
  }

  return {
    enterTownIfOnTile,
    enterDungeonIfOnEntrance,
    leaveTownNow,
    requestLeaveTown,
    returnToWorldFromTown,
    returnToWorldIfAtExit,
  };
}

export const createGameModeOps = createModeOps;
