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
      // Post-gen camera/FOV/UI
      try { ctx.updateCamera(); } catch (_) {}
      try { ctx.recomputeFOV(); } catch (_) {}
      try { ctx.updateUI(); } catch (_) {}
      try { ctx.requestDraw(); } catch (_) {}
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
        if (ctx.UIBridge && typeof ctx.UIBridge.showShop === "function") {
          ctx.UIBridge.showShop(ctx, npc);
        }
      } else {
        ctx.log && ctx.log(`The ${doorShop.name || "shop"} is closed. ${sched}`, "warn");
      }
    }
  } catch (_) {}

  ctx.requestDraw && ctx.requestDraw();
  return true;
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

  // Recompute FOV/UI and inform player
  try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
  try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
  try { ctx.log && ctx.log("You return to the overworld.", "notice"); } catch (_) {}
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
if (typeof window !== "undefined") {
  window.TownRuntime = { generate, ensureSpawnClear, spawnGateGreeters, isFreeTownFloor, talk, returnToWorldIfAtGate, applyLeaveSync, showExitButton, hideExitButton };
}