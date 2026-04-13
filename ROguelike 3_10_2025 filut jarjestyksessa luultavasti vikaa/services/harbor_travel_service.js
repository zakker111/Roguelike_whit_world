import { attachGlobal } from "../utils/global.js";
import { findNearestOtherHarborTown } from "../core/world/harbor.js";

const DEFAULT_FARE = 200;
const DEFAULT_TRAVEL_MINUTES = 480;

function currentTownRecord(ctx) {
  try {
    if (!ctx || !ctx.worldReturnPos || !Array.isArray(ctx.world?.towns)) return null;
    const wx = ctx.worldReturnPos.x | 0;
    const wy = ctx.worldReturnPos.y | 0;
    return ctx.world.towns.find(t => t && (t.x | 0) === wx && (t.y | 0) === wy) || null;
  } catch (_) {
    return null;
  }
}

function destinationLabel(rec) {
  const name = String((rec && rec.name) || "").trim();
  return name ? `${name} Harbor` : "another harbor town";
}

export function findPlayerGoldStack(ctx) {
  try {
    const inv = ctx && ctx.player && Array.isArray(ctx.player.inventory) ? ctx.player.inventory : [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (it && it.kind === "gold") return it;
    }
  } catch (_) {}
  return null;
}

export function canAffordHarborPassage(ctx, price = DEFAULT_FARE) {
  const gold = findPlayerGoldStack(ctx);
  const amount = gold && typeof gold.amount === "number" ? (gold.amount | 0) : 0;
  return amount >= (price | 0);
}

export function getHarborTravelDestination(ctx, opts = {}) {
  try {
    const rec = currentTownRecord(ctx);
    if (!rec) return null;
    return findNearestOtherHarborTown(ctx, rec.x | 0, rec.y | 0, opts);
  } catch (_) {
    return null;
  }
}

export function travelToHarborTown(ctx, destination, opts = {}) {
  try {
    if (!ctx || !destination || typeof destination.x !== "number" || typeof destination.y !== "number") return false;

    const minutes = Number.isFinite(opts.minutes) ? Math.max(30, opts.minutes | 0) : DEFAULT_TRAVEL_MINUTES;
    const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
    const TR = ctx.TownRuntime || (typeof window !== "undefined" ? window.TownRuntime : null);
    const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
    const applySync = () => {
      try {
        if (typeof ctx.applyCtxSyncAndRefresh === "function") {
          ctx.applyCtxSyncAndRefresh(ctx);
          return;
        }
      } catch (_) {}
      try {
        const api = (typeof window !== "undefined" && window.GameAPI) ? window.GameAPI : null;
        if (api && typeof api.applyCtxSyncAndRefresh === "function") {
          api.applyCtxSyncAndRefresh(ctx);
        }
      } catch (_) {}
    };

    const doTravel = () => {
      try {
        if (ctx.mode === "town" && TR && typeof TR.applyLeaveSync === "function") {
          TR.applyLeaveSync(ctx, { suppressLog: true });
        }
      } catch (_) {}

      ctx.worldReturnPos = { x: destination.x | 0, y: destination.y | 0 };

      if (!ctx.world || !Array.isArray(ctx.world.map)) return;
      ctx.mode = "world";
      ctx.map = ctx.world.map;
      if (ctx.world.seenRef) ctx.seen = ctx.world.seenRef;
      if (ctx.world.visibleRef) ctx.visible = ctx.world.visibleRef;

      if (WR && typeof WR.ensureInBounds === "function") {
        ctx._suspendExpandShift = true;
        try {
          const hintLx = (destination.x | 0) - (ctx.world.originX | 0);
          const hintLy = (destination.y | 0) - (ctx.world.originY | 0);
          WR.ensureInBounds(ctx, hintLx, hintLy, 32);
        } finally {
          ctx._suspendExpandShift = false;
        }
      }

      const lx = (destination.x | 0) - (ctx.world.originX | 0);
      const ly = (destination.y | 0) - (ctx.world.originY | 0);
      ctx.player.x = lx;
      ctx.player.y = ly;
      applySync();

      let entered = false;
      try {
        if (typeof ctx.enterTownIfOnTile === "function") {
          entered = !!ctx.enterTownIfOnTile();
        } else if (ctx.Modes && typeof ctx.Modes.enterTownIfOnTile === "function") {
          entered = !!ctx.Modes.enterTownIfOnTile(ctx);
        }
      } catch (_) {
        entered = false;
      }

      if (entered && ctx.log) {
        applySync();
        ctx.log(`By the next tide, you arrive at ${destinationLabel(destination)}.`, "good");
      } else if (!entered && ctx.log) {
        applySync();
        ctx.log("The ship cannot dock at the destination harbor.", "warn");
      }
    };

    if (UIO && typeof UIO.animateSleep === "function") {
      UIO.animateSleep(ctx, minutes, doTravel);
    } else {
      doTravel();
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function buyHarborPassage(ctx, captainNpc, opts = {}) {
  try {
    if (!ctx || ctx.mode !== "town") return false;
    const fare = Number.isFinite(opts.price)
      ? Math.max(1, opts.price | 0)
      : Math.max(1, ((captainNpc && captainNpc.harborTicketPrice) || DEFAULT_FARE) | 0);
    const destination = opts.destination || getHarborTravelDestination(ctx);
    if (!destination) {
      ctx.log && ctx.log("No ship is sailing to another harbor today.", "info");
      return false;
    }

    const gold = findPlayerGoldStack(ctx);
    const amount = gold && typeof gold.amount === "number" ? (gold.amount | 0) : 0;
    if (amount < fare) {
      ctx.log && ctx.log(`You need ${fare} gold for passage.`, "warn");
      return false;
    }

    gold.amount = amount - fare;
    ctx.updateUI && ctx.updateUI();
    try { ctx.rerenderInventoryIfOpen && ctx.rerenderInventoryIfOpen(); } catch (_) {}

    ctx.log && ctx.log(`You buy passage for ${fare} gold.`, "good");
    return travelToHarborTown(ctx, destination, opts);
  } catch (_) {
    return false;
  }
}

const HarborTravelService = {
  canAffordHarborPassage,
  findPlayerGoldStack,
  getHarborTravelDestination,
  buyHarborPassage,
  travelToHarborTown
};

attachGlobal("HarborTravelService", HarborTravelService);

export default HarborTravelService;
