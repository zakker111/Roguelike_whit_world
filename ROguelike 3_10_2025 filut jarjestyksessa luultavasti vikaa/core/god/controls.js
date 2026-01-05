/**
 * GodControls: thin wrappers that invoke data/god.js helpers via ctx.
 * Exports (ESM + window.GodControls):
 * - heal(getCtx)
 * - spawnStairsHere(getCtx)
 * - spawnItems(getCtx, count)
 * - spawnEnemyNearby(getCtx, count)
 * - setAlwaysCrit(getCtx, enabled)
 * - setCritPart(getCtx, part)
 * - toggleInvincible(getCtx, enabled)
 * - applySeed(getCtx, seedUint32)
 * - rerollSeed(getCtx)
 * - applyBleedToPlayer(getCtx, durationTurns)
 * - applyDazedToPlayer(getCtx, durationTurns)
 * - clearPlayerEffects(getCtx)
 * - teleportToNearestTower(getCtx)
 */

export function heal(getCtx) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.heal === "function") return G.heal(ctx);
  ctx.log("GOD: heal not available.", "warn");
}

export function spawnStairsHere(getCtx) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.spawnStairsHere === "function") return G.spawnStairsHere(ctx);
  ctx.log("GOD: spawnStairsHere not available.", "warn");
}

export function spawnItems(getCtx, count = 3) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.spawnItems === "function") return G.spawnItems(ctx, count);
  ctx.log("GOD: spawnItems not available.", "warn");
}

export function spawnEnemyNearby(getCtx, count = 1) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.spawnEnemyNearby === "function") return G.spawnEnemyNearby(ctx, count);
  ctx.log("GOD: spawnEnemyNearby not available.", "warn");
}

export function setAlwaysCrit(getCtx, enabled) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.setAlwaysCrit === "function") return G.setAlwaysCrit(ctx, enabled);
  ctx.log("GOD: setAlwaysCrit not available.", "warn");
}

export function setCritPart(getCtx, part) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.setCritPart === "function") return G.setCritPart(ctx, part);
  ctx.log("GOD: setCritPart not available.", "warn");
}

export function toggleInvincible(getCtx, enabled) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.toggleInvincible === "function") return G.toggleInvincible(ctx, !!enabled);
  ctx.log("GOD: toggleInvincible not available.", "warn");
}

export function applySeed(getCtx, seedUint32) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.applySeed === "function") return G.applySeed(ctx, seedUint32);
  ctx.log("GOD: applySeed not available.", "warn");
}

export function rerollSeed(getCtx) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.rerollSeed === "function") return G.rerollSeed(ctx);
  ctx.log("GOD: rerollSeed not available.", "warn");
}

export function applyBleedToPlayer(getCtx, duration = 3) {
  const ctx = getCtx();
  const ST = (ctx.Status || (typeof window !== "undefined" ? window.Status : null));
  if (ST && typeof ST.applyBleedToPlayer === "function") return ST.applyBleedToPlayer(ctx, duration);
  ctx.player.bleedTurns = Math.max(ctx.player.bleedTurns || 0, (duration | 0));
  ctx.log && ctx.log(`You are bleeding (${ctx.player.bleedTurns}).`, "info");
}

export function applyDazedToPlayer(getCtx, duration = 2) {
  const ctx = getCtx();
  const ST = (ctx.Status || (typeof window !== "undefined" ? window.Status : null));
  if (ST && typeof ST.applyDazedToPlayer === "function") return ST.applyDazedToPlayer(ctx, duration);
  ctx.player.dazedTurns = Math.max(ctx.player.dazedTurns || 0, (duration | 0));
  ctx.log && ctx.log(`You are dazed and might lose your next action${duration > 1 ? "s" : ""}.`, "info");
}

export function clearPlayerEffects(getCtx) {
  const ctx = getCtx();
  try {
    ctx.player.bleedTurns = 0;
    ctx.player.dazedTurns = 0;
    ctx.log && ctx.log("Status effects cleared (Bleed, Dazed).", "info");
    ctx.updateUI && ctx.updateUI();
  } catch (_) {}
}

export function teleportToNearestTower(getCtx) {
  const ctx = getCtx();
  const G = (ctx.God || (typeof window !== "undefined" ? window.God : null));
  if (G && typeof G.teleportToNearestTower === "function") return G.teleportToNearestTower(ctx);
  ctx.log("GOD: teleportToNearestTower not available.", "warn");
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.GodControls = {
    heal,
    spawnStairsHere,
    spawnItems,
    spawnEnemyNearby,
    setAlwaysCrit,
    setCritPart,
    applySeed,
    rerollSeed,
    applyBleedToPlayer,
    applyDazedToPlayer,
    clearPlayerEffects,
    teleportToNearestTower,
  };
}