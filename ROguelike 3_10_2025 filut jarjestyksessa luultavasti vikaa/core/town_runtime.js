/**
 * TownRuntime: generation and helpers for town mode.
 *
 * Exports (ESM + window.TownRuntime):
 * - generate(ctx): populates ctx.map/visible/seen/npcs/shops/props/buildings/etc.
 * - ensureSpawnClear(ctx)
 * - spawnGateGreeters(ctx, count=4)
 * - isFreeTownFloor(ctx, x, y)
 * - talk(ctx): bump-talk with nearby NPCs; returns true if handled
 * - returnToWorldIfAtGate(ctx): leaves town if the player stands on the gate tile; returns true if handled
 */

export function generate(ctx) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.generate === "function") {
    const handled = Tn.generate(ctx);
    if (handled) {
      // Greeters at gate: Town.generate should ensure one; allow module to add none if unnecessary
      if (typeof Tn.spawnGateGreeters === "function") {
        try { Tn.spawnGateGreeters(ctx, 0); } catch (_) {}
      }
      // Post-gen camera/FOV/UI (draw coalesced by orchestrator)
      try { ctx.updateCamera(); } catch (_) {}
      try { ctx.recomputeFOV(); } catch (_) {}
      try { ctx.updateUI(); } catch (_) {}
      return true;
    }
  }
  ctx.log && ctx.log("Town module missing; unable to generate town.", "warn");
  return false;
}

export function ensureSpawnClear(ctx) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.ensureSpawnClear === "function") {
    Tn.ensureSpawnClear(ctx);
    return;
  }
  ctx.log && ctx.log("Town.ensureSpawnClear not available.", "warn");
}

export function spawnGateGreeters(ctx, count) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.spawnGateGreeters === "function") {
    Tn.spawnGateGreeters(ctx, count);
    return;
  }
  ctx.log && ctx.log("Town.spawnGateGreeters not available.", "warn");
}

export function isFreeTownFloor(ctx, x, y) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.isFreeTownFloor === "function") {
      return !!ctx.Utils.isFreeTownFloor(ctx, x, y);
    }
  } catch (_) {}
  const U = (typeof window !== "undefined" ? window.Utils : null);
  if (U && typeof U.isFreeTownFloor === "function") {
    return !!U.isFreeTownFloor(ctx, x, y);
  }
  if (!ctx.inBounds(x, y)) return false;
  const t = ctx.map[y][x];
  if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) return false;
  if (x === ctx.player.x && y === ctx.player.y) return false;
  if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === x && n.y === y)) return false;
  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
  return true;
}

export function talk(ctx) {
  if (ctx.mode !== "town") return false;
  const npcs = ctx.npcs || [];
  const near = [];
  for (const n of npcs) {
    const d = Math.abs(n.x - ctx.player.x) + Math.abs(n.y - ctx.player.y);
    if (d <= 1) near.push(n);
  }
  if (!near.length) {
    ctx.log && ctx.log("There is no one to talk to here.");
    return false;
  }
  const pick = (arr, rng) => arr[(arr.length === 1) ? 0 : Math.floor((rng ? rng() : Math.random()) * arr.length) % arr.length];
  const npc = pick(near, ctx.rng);
  const lines = Array.isArray(npc.lines) && npc.lines.length ? npc.lines : ["Hey!", "Watch it!", "Careful there."];
  const line = pick(lines, ctx.rng);
  ctx.log && ctx.log(`${npc.name || "Villager"}: ${line}`, "info");

  // If the NPC is at or adjacent to a shop door, gate opening by schedule via ShopService
  try {
    let doorShop = null;
    const shops = Array.isArray(ctx.shops) ? ctx.shops : [];
    for (const s of shops) {
      const dd = Math.abs(s.x - npc.x) + Math.abs(s.y - npc.y);
      if (dd <= 1) { doorShop = s; break; }
    }
    if (doorShop) {
      const SS = ctx.ShopService || (typeof window !== "undefined" ? window.ShopService : null);
      const openNow = (SS && typeof SS.isShopOpenNow === "function") ? SS.isShopOpenNow(ctx, doorShop) : false;
      const sched = (SS && typeof SS.shopScheduleStr === "function") ? SS.shopScheduleStr(doorShop) : "";
      if (openNow) {
        // Coalesce draw: only request a redraw if shop was previously closed
        let wasOpen = false;
        try { wasOpen = !!(ctx.UIBridge && typeof ctx.UIBridge.isShopOpen === "function" && ctx.UIBridge.isShopOpen()); } catch (_) {}
        if (ctx.UIBridge && typeof ctx.UIBridge.showShop === "function") {
          ctx.UIBridge.showShop(ctx, npc);
        }
        if (!wasOpen) { ctx.requestDraw && ctx.requestDraw(); }
      } else {
        ctx.log && ctx.log(`The ${doorShop.name || "shop"} is closed. ${sched}`, "warn");
        // Pure log; no canvas redraw needed
      }
    }
  } catch (_) {}

  return true;
}

export function tryMoveTown(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "town") return false;
  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  let npcBlocked = false;
  try {
    if (ctx.occupancy && typeof ctx.occupancy.hasNPC === "function") {
      npcBlocked = !!ctx.occupancy.hasNPC(nx, ny);
    } else {
      npcBlocked = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === nx && n.y === ny);
    }
  } catch (_) {}

  if (npcBlocked) {
    if (typeof talk === "function") {
      talk(ctx);
    } else if (ctx.log) {
      ctx.log("Excuse me!", "info");
    }
    return true;
  }

  const walkable = (typeof ctx.isWalkable === "function") ? !!ctx.isWalkable(nx, ny) : true;
  if (walkable) {
    ctx.player.x = nx; ctx.player.y = ny;
    try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
    try { ctx.turn && ctx.turn(); } catch (_) {}
    return true;
  }
  return false;
}

export function returnToWorldIfAtGate(ctx) {
  if (!ctx || ctx.mode !== "town" || !ctx.world) return false;
  const atGate = !!(ctx.townExitAt && ctx.player.x === ctx.townExitAt.x && ctx.player.y === ctx.townExitAt.y);
  if (!atGate) return false;

  // Apply leave to overworld
  applyLeaveSync(ctx);

  return true;
}

export function applyLeaveSync(ctx) {
  if (!ctx || !ctx.world) return false;

  // Switch mode and restore overworld map
  ctx.mode = "world";
  ctx.map = ctx.world.map;

  // Clear town-only state
  try {
    if (Array.isArray(ctx.npcs)) ctx.npcs.length = 0;
    if (Array.isArray(ctx.shops)) ctx.shops.length = 0;
    if (Array.isArray(ctx.townProps)) ctx.townProps.length = 0;
    if (Array.isArray(ctx.townBuildings)) ctx.townBuildings.length = 0;
    ctx.townPlaza = null;
    ctx.tavern = null;
  } catch (_) {}

  // Restore world position if available
  try {
    if (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number") {
      ctx.player.x = ctx.worldReturnPos.x;
      ctx.player.y = ctx.worldReturnPos.y;
    }
  } catch (_) {}

  // Clear exit anchors
  try {
    ctx.townExitAt = null;
    ctx.dungeonExitAt = null;
    ctx.dungeon = ctx.dungeonInfo = null;
  } catch (_) {}

  // Hide UI elements
  hideExitButton(ctx);

  // Ensure camera is centered on player
  try {
    if (ctx && typeof ctx.updateCamera === "function") ctx.updateCamera();
    else centerCamera(ctx);
  } catch (_) { centerCamera(ctx); }

  // Recompute FOV/UI and inform player (draw coalesced by orchestrator)
  try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
eturn to the overworld.", "notice"); } catch (_) {}
  try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}

  return true;
}

// Fallback camera centering if FOVCamera/updateCamera is unavailable
function centerCamera(ctx) {
  try {
    const cam = (typeof ctx.getCamera === "function") ? ctx.getCamera() : (ctx.camera || null);
    if (!cam) return;
    const TILE = (typeof ctx.TILE === "number") ? ctx.TILE : 32;
    const rows = ctx.map.length;
    const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    const mapWidth = cols * TILE;
    const mapHeight = rows * TILE;
    const targetX = ctx.player.x * TILE + TILE / 2 - cam.width / 2;
    const targetY = ctx.player.y * TILE + TILE / 2 - cam.height / 2;
    const slackX = Math.max(0, cam.width / 2 - TILE / 2);
    const slackY = Math.max(0, cam.height / 2 - TILE / 2);
    const minX = -slackX;
    const minY = -slackY;
    const maxX = (mapWidth - cam.width) + slackX;
    const maxY = (mapHeight - cam.height) + slackY;
    cam.x = Math.max(minX, Math.min(targetX, maxX));
    cam.y = Math.max(minY, Math.min(targetY, maxY));
  } catch (_) {}
}

export function showExitButton(ctx) {
  try {
    if (ctx && ctx.UIBridge && typeof ctx.UIBridge.showTownExitButton === "function") {
      ctx.UIBridge.showTownExitButton(ctx);
    }
  } catch (_) {}
}
export function hideExitButton(ctx) {
  try {
    if (ctx && ctx.UIBridge && typeof ctx.UIBridge.hideTownExitButton === "function") {
      ctx.UIBridge.hideTownExitButton(ctx);
    }
  } catch (_) {}
}

// Back-compat: attach to window for classic scripts
export function tick(ctx) {
  if (!ctx || ctx.mode !== "town") return false;
  // Drive NPC behavior
  try {
    const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
    if (TAI && typeof TAI.townNPCsAct === "function") {
      TAI.townNPCsAct(ctx);
    }
  } catch (_) {}
  // Rebuild occupancy every other turn to avoid ghost-blocking after NPC bursts
  try {
    const stride = 2;
    const t = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    if ((t % stride) === 0) {
      const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
      if (OG && typeof OG.build === "function") {
        ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
      }
    }
  } catch (_) {}
  return true;
}

// Explicit occupancy rebuild helper for callers that mutate town entities outside tick cadence.
export function rebuildOccupancy(ctx) {
  try {
    const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
    if (OG && typeof OG.build === "function") {
      ctx.occupancy = OG.build({ map: ctx.map, enemies: ctx.enemies, npcs: ctx.npcs, props: ctx.townProps, player: ctx.player });
      return true;
    }
  } catch (_) {}
  return false;
}

if (typeof window !== "undefined") {
  window.TownRuntime = { generate, ensureSpawnClear, spawnGateGreeters, isFreeTownFloor, talk, tryMoveTown, tick, returnToWorldIfAtGate, applyLeaveSync, showExitButton, hideExitButton, rebuildOccupancy };
}