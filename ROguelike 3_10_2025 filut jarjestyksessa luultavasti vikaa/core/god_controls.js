/**
 * GodControls: thin wrappers that invoke data/god.js helpers via ctx.
 * Exports (ESM + window.GodControls):
 * - heal(getCtx)
 * - spawnStairsHere(getCtx)
 * - spawnItems(getCtx, count)
 * - spawnEnemyNearby(getCtx, count)
 * - setAlwaysCrit(getCtx, enabled)
 * - setCritPart(getCtx, part)
 * - applySeed(getCtx, seedUint32)
 * - rerollSeed(getCtx)
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
  };
}