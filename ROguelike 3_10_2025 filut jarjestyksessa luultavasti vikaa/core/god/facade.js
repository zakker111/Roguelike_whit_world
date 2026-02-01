/**
 * God facade: centralize GOD actions via ctx-first calls.
 */
import { getMod } from "../../utils/access.js";

export function setAlwaysCrit(ctx, v) {
  const GC = getMod(ctx, "GodControls");
  if (GC && typeof GC.setAlwaysCrit === "function") {
    GC.setAlwaysCrit(() => ctx, v);
    return true;
  }
  return false;
}

export function setCritPart(ctx, part) {
  const GC = getMod(ctx, "GodControls");
  if (GC && typeof GC.setCritPart === "function") {
    GC.setCritPart(() => ctx, part);
    return true;
  }
  return false;
}

export function godSpawnEnemyNearby(ctx, count = 1) {
  const GC = getMod(ctx, "GodControls");
  if (GC && typeof GC.spawnEnemyNearby === "function") {
    GC.spawnEnemyNearby(() => ctx, count);
    return true;
  }
  return false;
}

export function godSpawnEnemyById(ctx, id, count = 1) {
  const GC = getMod(ctx, "GodControls");
  if (GC && typeof GC.spawnEnemyById === "function") {
    GC.spawnEnemyById(() => ctx, id, count);
    return true;
  }
  return false;
}

export function godSpawnItems(ctx, count = 3) {
  const GC = getMod(ctx, "GodControls");
  if (GC && typeof GC.spawnItems === "function") {
    GC.spawnItems(() => ctx, count);
    return true;
  }
  return false;
}

export function godHeal(ctx) {
  const GC = getMod(ctx, "GodControls");
  if (GC && typeof GC.heal === "function") {
    GC.heal(() => ctx);
    return true;
  }
  return false;
}

export function godSpawnStairsHere(ctx) {
  const GC = getMod(ctx, "GodControls");
  if (GC && typeof GC.spawnStairsHere === "function") {
    GC.spawnStairsHere(() => ctx);
    return true;
  }
  return false;
}

// Back-compat for debugging
if (typeof window !== "undefined") {
  window.GodFacade = {
    setAlwaysCrit,
    setCritPart,
    godSpawnEnemyNearby,
    godSpawnEnemyById,
    godSpawnItems,
    godHeal,
    godSpawnStairsHere
  };
}