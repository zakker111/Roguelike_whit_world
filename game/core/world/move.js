/**
 * World movement (Phase 3 extraction): tryMovePlayerWorld.
 */
import { getMod } from "../../utils/access.js";
import { ensureInBounds as ensureInBoundsExt } from "./expand.js";
import * as GMBridge from "../bridge/gm_bridge.js";

export function tryMovePlayerWorld(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.map) return false;

  // Compute intended target
  let nx = ctx.player.x + (dx | 0);
  let ny = ctx.player.y + (dy | 0);

  // Ensure expand-shift is enabled during normal movement (may have been suspended during transitions)
  if (ctx._suspendExpandShift) ctx._suspendExpandShift = false;

  // Top-edge water band: treat any attempt to move above row 0 as blocked (like water), do not expand upward
  if (ny < 0) {
    return false;
  }

  // Expand if outside (only for infinite worlds)
  try {
    if (ctx.world && ctx.world.type === "infinite" && ctx.world.gen && typeof ctx.world.gen.tileAt === "function") {
      const expanded = ensureInBoundsExt(ctx, nx, ny, 32);
      if (expanded) {
        // Player may have been shifted by left/top prepends; recompute target
        nx = ctx.player.x + (dx | 0);
        ny = ctx.player.y + (dy | 0);
      }
    }
  } catch (_) {}

  const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;

  // Convert target to absolute world coordinates
  const ox = (ctx.world.originX | 0) || 0;
  const oy = (ctx.world.originY | 0) || 0;
  const wx = ox + (nx | 0);
  const wy = oy + (ny | 0);

  // If the target tile has a travelling caravan (not one parked in a town), block movement
  // and offer an ambush/encounter option. Caravans that are currently atTown are considered
  // "inside" the settlement and should not block or prompt on the overworld tile.
  try {
    const caravans = Array.isArray(ctx.world.caravans) ? ctx.world.caravans : [];
    if (caravans.length) {
      const cv = caravans.find(c => c && !c.atTown && (c.x | 0) === wx && (c.y | 0) === wy);
      if (cv) {
        const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
        const prompt = "Do you want to encounter this caravan?";
        const onOk = () => { try { startCaravanAmbushEncounterWorld(ctx, cv); } catch (_) {} };
        const onCancel = () => {
          try { ctx.log && ctx.log("You decide to leave the caravan alone.", "info"); } catch (_) {}
        };
        if (UIO && typeof UIO.showConfirm === "function") {
          UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
        } else {
          onOk();
        }
        // Do not move onto the travelling caravan tile
        return true;
      }
    }
  } catch (_) {}

  // If the target tile has a wandering merchant, offer to trade
  try {
    const wanderers = Array.isArray(ctx.world.wanderers) ? ctx.world.wanderers : [];
    if (wanderers.length) {
      const wn = wanderers.find(w => w && !w.atTown && (w.x | 0) === wx && (w.y | 0) === wy);
      if (wn) {
        const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
        const greeting = (wn.dialogue && wn.dialogue.greeting) || "A merchant offers to trade.";
        const prompt = greeting + " Trade with " + (wn.name || "the merchant") + "?";
        const onOk = () => { try { openWandererShop(ctx, wn); } catch (_) {} };
        const onCancel = () => {
          try { ctx.log && ctx.log((wn.dialogue && wn.dialogue.farewell) || "You move on.", "info"); } catch (_) {}
        };
        if (UIO && typeof UIO.showConfirm === "function") {
          UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
        } else {
          onOk();
        }
        return true;
      }
    }
  } catch (_) {}

  let walkable = true;
  try {
    // Prefer World.isWalkable for compatibility with tiles.json overrides
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    if (W && typeof W.isWalkable === "function") {
      walkable = !!W.isWalkable(ctx.map[ny][nx]);
    } else if (ctx.world && ctx.world.gen && typeof ctx.world.gen.isWalkable === "function") {
      walkable = !!ctx.world.gen.isWalkable(ctx.map[ny][nx]);
    }
  } catch (_) {}

  if (!walkable) return false;

  ctx.player.x = nx; ctx.player.y = ny;

  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  // Non-combat skill hooks on overworld step
  try {
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    const WT = W ? W.TILES : null;
    const tileHere = ctx.world && ctx.world.map ? ctx.world.map[ny][nx] : null;
    const isWild = WT ? (tileHere === WT.FOREST || tileHere === WT.GRASS || tileHere === WT.BEACH || tileHere === WT.SWAMP) : true;

    // Survivalism: gradual progress when traversing wild tiles
    if (isWild) {
      try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.survivalism = (ctx.player.skills.survivalism || 0) + 0.2; } catch (_) {}
    }

    // Foraging via region map berry bushes only (overworld walking no longer grants berries)
  } catch (_) {}

  // Markers: if standing on an active marker, show a hint; interactions are triggered via G
  try {
    const markers = Array.isArray(ctx.world?.questMarkers) ? ctx.world.questMarkers : [];
    if (markers.length) {
      const rx = ((ctx.world?.originX | 0) + (ctx.player.x | 0)) | 0;
      const ry = ((ctx.world?.originY | 0) + (ctx.player.y | 0)) | 0;
      const here = markers.find(m => m && (m.x | 0) === rx && (m.y | 0) === ry);
      if (here) {
        try { ctx.log && ctx.log("Marker here: Press G to interact.", "notice"); } catch (_) {}
      }
    }
  } catch (_) {}

  let gmHandled = false;
  const modeBeforeGm = ctx.mode;
  try {
    gmHandled = !!GMBridge.maybeHandleWorldStep(ctx);
  } catch (_) {}

  // Phase 2: if GMBridge changed mode synchronously, apply exactly one sync boundary here.
  try {
    if (modeBeforeGm && ctx.mode !== modeBeforeGm) {
      const GA = getMod(ctx, "GameAPI");
      if (GA && typeof GA.applyCtxSyncAndRefresh === "function") {
        GA.applyCtxSyncAndRefresh(ctx);
      }
    }
  } catch (_) {}

  // Encounter roll before advancing time (modules may switch mode)
  if (!gmHandled) {
    try {
      const ES = ctx.EncounterService || (typeof window !== "undefined" ? window.EncounterService : null);
      if (ES && typeof ES.maybeTryEncounter === "function") {
        ES.maybeTryEncounter(ctx);
      }
    } catch (_) {}
  }
  try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
  return true;
}

/**
 * Start a special caravan ambush encounter when the player bumps into a caravan on the overworld.
 */
function startCaravanAmbushEncounterWorld(ctx, caravan) {
  try {
    // Close any confirm dialog before switching modes
    try {
      const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.closeConfirm === "function") {
        UIO.closeConfirm(ctx);
      }
    } catch (_) {}

    // Mark the caravan as ambushed so it no longer moves or spawns merchants.
    try {
      if (caravan) {
        caravan.atTown = false;
        caravan.dwellUntil = 0;
        caravan.ambushed = true;
      }
    } catch (_) {}

    // Link this encounter to an escortable caravan so the player can choose to travel with it afterwards.
    try {
      const world = ctx.world;
      if (world && caravan && typeof caravan.id !== "undefined") {
        world.caravanEscort = world.caravanEscort || { id: null, reward: 0, active: false };
        world.caravanEscort.id = caravan.id;

        // If no reward has been set yet for this escort, derive a simple gold reward
        // from the remaining distance to the caravan's destination town.
        if (!world.caravanEscort.reward || world.caravanEscort.reward <= 0) {
          try {
            const cx = caravan.x | 0;
            const cy = caravan.y | 0;
            const tx = (caravan.dest && typeof caravan.dest.x === "number") ? (caravan.dest.x | 0) : cx;
            const ty = (caravan.dest && typeof caravan.dest.y === "number") ? (caravan.dest.y | 0) : cy;
            const dx = tx - cx;
            const dy = ty - cy;
            const dist = Math.max(4, Math.abs(dx) + Math.abs(dy));
            world.caravanEscort.reward = 10 + dist * 2;
          } catch (_) {}
        }
        // Do not set active yet; the Caravan master dialog inside the encounter decides
        // whether the player actually chooses to travel with this caravan.
      }
    } catch (_) {}

    const template = {
      id: "caravan_ambush",
      name: "Caravan Ambush",
      map: { w: 26, h: 16, generator: "caravan_road" },
      groups: [
        { faction: "guard", count: { min: 3, max: 4 }, type: "guard" },
        { faction: "guard", count: { min: 2, max: 3 }, type: "guard_elite" }
      ],
      objective: { type: "reachExit" },
      difficulty: 4
    };

    const biome = "GRASS";
    let ok = false;
    let synced = false;

    // Prefer ctx-first entry via Modes (no ctx reacquire).
    let applyCtxSyncAndRefresh = null;
    try {
      const GA = ctx.GameAPI || getMod(ctx, "GameAPI");
      if (GA && typeof GA.applyCtxSyncAndRefresh === "function") {
        applyCtxSyncAndRefresh = GA.applyCtxSyncAndRefresh;
      }
    } catch (_) {}

    try {
      const M = ctx.Modes || getMod(ctx, "Modes");
      if (M && typeof M.enterEncounter === "function") {
        ok = !!M.enterEncounter(ctx, template, biome, template.difficulty || 4, applyCtxSyncAndRefresh || undefined);
        if (ok) synced = true;
      }
    } catch (_) {}

    // Fallback: direct EncounterRuntime entry
    if (!ok) {
      try {
        const ER = ctx.EncounterRuntime || getMod(ctx, "EncounterRuntime");
        if (ER && typeof ER.enter === "function") {
          ok = !!ER.enter(ctx, { template, biome, difficulty: template.difficulty || 4 });
        }
      } catch (_) {}
    }

    if (ok && !synced) {
      try {
        if (typeof applyCtxSyncAndRefresh === "function") {
          applyCtxSyncAndRefresh(ctx);
          synced = true;
        }
      } catch (_) {}
    }

    if (!ok && ctx.log) {
      ctx.log("Failed to start caravan ambush encounter.", "warn");
    } else if (ok && ctx.log) {
      ctx.log("You ambush the caravan on the road!", "notice");
    }
  } catch (_) {}
}

/**
 * Open a wandering merchant's shop when the player bumps into them on the overworld.
 * Creates a temporary shop object using the wanderer's shopPool and opens the shop UI.
 */
function openWandererShop(ctx, wanderer) {
  try {
    // Close any confirm dialog before opening the shop
    try {
      const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.closeConfirm === "function") {
        UIO.closeConfirm(ctx);
      }
    } catch (_) {}

    const ShopSvc = ctx.ShopService || getMod(ctx, "ShopService") || (typeof window !== "undefined" ? window.ShopService : null);

    // Build a temporary shop record the shop UI can use
    const shop = {
      x: wanderer.x | 0,
      y: wanderer.y | 0,
      type: wanderer.shopPool || "wandering_merchant",
      name: wanderer.name || "Traveling Merchant",
      alwaysOpen: true,
      isWanderer: true,
      wandererId: wanderer.id,
    };

    // Initialize shop state (inventory) using ShopService if available
    if (ShopSvc && typeof ShopSvc.ensureShopState === "function") {
      ShopSvc.ensureShopState(ctx, shop);
    }
    if (ShopSvc && typeof ShopSvc.restockIfNeeded === "function") {
      ShopSvc.restockIfNeeded(ctx, shop);
    }

    // Open the shop overlay via UIOrchestration.showShop
    const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
    if (UIO && typeof UIO.showShop === "function") {
      UIO.showShop(ctx, shop);
    } else {
      // Fallback: log that we met a merchant
      if (ctx.log) ctx.log("You meet " + (wanderer.name || "a merchant") + " but can't trade right now.", "info");
    }
  } catch (_) {
    try { if (ctx.log) ctx.log("Failed to open wanderer shop.", "warn"); } catch (_2) {}
  }
}