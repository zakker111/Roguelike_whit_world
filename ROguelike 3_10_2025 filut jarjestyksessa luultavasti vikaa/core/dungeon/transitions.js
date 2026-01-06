/**
 * Dungeon transitions (Phase 3 extraction): return-to-world and mountain pass handling.
 */
import { getMod } from "../../utils/access.js";
import { save } from "./state.js";
import { enter } from "./enter.js";
import { addDungeon as addDungeonPOI } from "../world/poi.js";

// Determine a target world coordinate across a mountain from this dungeon's entrance.
export function computeAcrossMountainTarget(ctx) {
  try {
    const world = ctx.world || null;
    const gen = world && world.gen;
    const W = (typeof window !== "undefined" ? window.World : null);
    const WT = W ? W.TILES : null;
    const dinfo = ctx.dungeonInfo || ctx.dungeon || null;
    if (!gen || !WT || !dinfo) return null;
    // Mountain id
    const M = WT.MOUNTAIN;
    const wx0 = dinfo.x | 0, wy0 = dinfo.y | 0;

    // Directions to probe (N,E,S,W and diagonals) to find longest mountain run
    const dirs = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
    ];

    // Walk a mountain run starting from the first mountain tile adjacent to the entrance.
    // Limit the run length so we do not pick a target arbitrarily far away.
    function mountainRunLenFromNeighbor(dx, dy) {
      // Step once into the direction; require that tile to be mountain
      let x = wx0 + dx;
      let y = wy0 + dy;
      let t = gen.tileAt(x, y);
      if (t !== M) {
        return { len: 0, endX: wx0, endY: wy0 };
      }
      let len = 0;
      const maxRun = 120;
      // Now walk along this direction while we stay on mountains
      for (let i = 0; i < maxRun; i++) {
        t = gen.tileAt(x, y);
        if (t === M) {
          len++;
          x += dx;
          y += dy;
          continue;
        }
        break;
      }
      return { len, endX: x, endY: y };
    }

    let best = null;
    let bestLen = -1;
    for (const d of dirs) {
      const res = mountainRunLenFromNeighbor(d.dx, d.dy);
      if (res.len > bestLen) {
        bestLen = res.len;
        best = { d, res };
      }
    }
    if (!best || bestLen <= 0) return null;

    // Move one more step beyond the last mountain tile to ensure we are across
    let tx = best.res.endX;
    let ty = best.res.endY;
    // Nudge a few tiles further into non-mountain terrain for safety
    for (let k = 0; k < 5; k++) {
      const nx = tx + best.d.dx;
      const ny = ty + best.d.dy;
      const t = gen.tileAt(nx, ny);
      if (t === M) break;
      tx = nx;
      ty = ny;
    }

    // Prefer a nearby walkable tile (non-water/river/mountain) around the across-mountain
    // candidate so the overworld exit makes sense and does not drop the player into water.
    function isWalkableWorldTile(x, y) {
      try {
        if (W && typeof W.isWalkable === "function") {
          return !!W.isWalkable(gen.tileAt(x, y));
        }
      } catch (_) {}
      try {
        const tt = gen.tileAt(x, y);
        if (tt === WT.WATER || tt === WT.RIVER || tt === WT.MOUNTAIN) return false;
        return true;
      } catch (_) {
        return false;
      }
    }

    let bestTarget = { x: tx, y: ty };
    let found = isWalkableWorldTile(tx, ty);
    const maxRadius = 6;
    for (let r = 0; r <= maxRadius && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const ax = tx + dx;
          const ay = ty + dy;
          if (!isWalkableWorldTile(ax, ay)) continue;
          bestTarget = { x: ax, y: ay };
          found = true;
        }
      }
    }

    return bestTarget;
  } catch (_) {
    return null;
  }
}

// If stepping on a special mountain-pass stairs, use it as a bidirectional tunnel between two
// *dungeon interiors* A &amp; B, while still wiring their overworld entrances.
//
// Behaviour:
// - Entrance dungeon A (no passSourceX/Y on dungeonInfo):
//   - First time you step on the pass stairs inside A:
//     - Compute a far-side overworld coordinate B across the mountains.
//     - Create a dungeon POI at B (if missing) with spawnAtMountainPass=true and passSourceX/Y=A.x/y.
//   - Every time you step on the pass stairs inside A:
//     - Exit to overworld B, then immediately enter dungeon B interior.
//     - Normal stairs in B exit to overworld B.
// - Exit-side dungeon B (dungeonInfo.passSourceX/Y present):
//   - Stepping on the pass stairs inside B:
//     - Exit to overworld A, then immediately enter dungeon A interior.
//     - Normal stairs in A exit to overworld A.
// - From overworld:
//   - Entering A spawns at A's normal entrance room.
//   - Entering B spawns at the mountain-pass stairs (spawnAtMountainPass=true) so the second ladder is B's \"start\".
export function maybeEnterMountainPass(ctx, nx, ny) {
  try {
    const pass = ctx._mountainPassAt || null;
    if (!pass) return false;
    if (nx !== pass.x || ny !== pass.y) return false;
    if (!ctx.inBounds(nx, ny) || ctx.map[ny][nx] !== ctx.TILES.STAIRS) return false;
    if (!ctx.world) return false;

    const dinfo = ctx.dungeonInfo || ctx.dungeon || null;
    if (!dinfo) return false;

    // Move the player onto the pass stairs tile.
    ctx.player.x = nx;
    ctx.player.y = ny;

    const world = ctx.world;
    let targetInfo = null;
    let targetX = null;
    let targetY = null;

    // Far-side is the original source dungeon (A) when we are currently in B
    // (B carries passSourceX/Y pointing back to A).
    if (typeof dinfo.passSourceX === "number" && typeof dinfo.passSourceY === "number") {
      targetX = dinfo.passSourceX | 0;
      targetY = dinfo.passSourceY | 0;

      try {
        const list = Array.isArray(world.dungeons) ? world.dungeons : [];
        targetInfo = list.find(d => d && (d.x | 0) === targetX && (d.y | 0) === targetY) || null;
        if (!targetInfo) {
          const level = Math.max(1, ctx.floor | 0);
          const size = dinfo && dinfo.size ? dinfo.size : "medium";
          targetInfo = { x: targetX, y: targetY, level, size };
          list.push(targetInfo);
        }
      } catch (_) {}
    } else {
      // We are on the entrance side (A). Compute a far-side coordinate across the mountain
      // and ensure there is a dungeon POI at B with metadata for overworld entry.
      const tgt = computeAcrossMountainTarget(ctx);
      if (!tgt) return false;
      targetX = tgt.x | 0;
      targetY = tgt.y | 0;

      const level = Math.max(1, ctx.floor | 0);
      const size = dinfo && dinfo.size ? dinfo.size : "medium";

      try {
        const list = Array.isArray(world.dungeons) ? world.dungeons : (world.dungeons = []);
        let info = list.find(d => d && (d.x | 0) === targetX && (d.y | 0) === targetY) || null;
        if (!info) {
          addDungeonPOI(world, targetX, targetY, {
            level,
            size,
            isMountainDungeon: true,
            spawnAtMountainPass: true,
            passSourceX: dinfo.x | 0,
            passSourceY: dinfo.y | 0
          });
          // Re-fetch the registered dungeon info
          info = list.find(d => d && (d.x | 0) === targetX && (d.y | 0) === targetY) || null;
        } else {
          info.isMountainDungeon = true;
          info.spawnAtMountainPass = true;
          info.passSourceX = dinfo.x | 0;
          info.passSourceY = dinfo.y | 0;
          if (typeof info.level !== "number") info.level = level;
          if (!info.size) info.size = size;
        }
        targetInfo = info;
      } catch (_) {}

      if (!targetInfo) {
        // Fallback: synthesize a minimal dungeon info for B if POI registration failed.
        targetInfo = { x: targetX, y: targetY, level, size, isMountainDungeon: true, spawnAtMountainPass: true, passSourceX: dinfo.x | 0, passSourceY: dinfo.y | 0 };
      }
    }

    if (!targetInfo) return false;

    // When we later leave the target dungeon via its normal exit stairs, we want
    // to appear on that dungeon's overworld entrance tile.
    ctx.worldReturnPos = { x: targetInfo.x | 0, y: targetInfo.y | 0 };
    ctx.cameFromWorld = true;

    // Exit current dungeon back to overworld using the pass stairs as a valid exit.
    let exitedToWorld = false;
    try {
      const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
      if (DR && typeof DR.returnToWorldIfAtExit === "function") {
        exitedToWorld = !!DR.returnToWorldIfAtExit(ctx);
      } else {
        exitedToWorld = returnToWorldIfAtExit(ctx);
      }
    } catch (_) {
      exitedToWorld = false;
    }
    if (!exitedToWorld || ctx.mode !== "world") return false;

    // Now we stand on the overworld tile for targetInfo (A or B). Immediately
    // enter that dungeon interior. For overworld entry B should spawn at the
    // pass stairs (spawnAtMountainPass=true), but when using the internal
    // portal we want to arrive at the natural entrance room instead, so we
    // strip spawnAtMountainPass for this entry call only.
    let enterInfo = targetInfo;
    if (enterInfo && enterInfo.spawnAtMountainPass) {
      enterInfo = { ...targetInfo };
      try { delete enterInfo.spawnAtMountainPass; } catch (_) {}
    }

    try {
      const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
      let ok = false;
      if (DR && typeof DR.enter === "function") {
        ok = !!DR.enter(ctx, enterInfo);
      } else {
        ok = !!enter(ctx, enterInfo);
      }

      // After entering the target dungeon via the portal, ensure that future
      // normal exits (using the regular entrance/exit stairs) return to this
      // dungeon's own overworld tile, regardless of which side we came from.
      if (ok && ctx && ctx.mode === "dungeon" && targetInfo && typeof targetInfo.x === "number" && typeof targetInfo.y === "number") {
        ctx.worldReturnPos = { x: targetInfo.x | 0, y: targetInfo.y | 0 };
        ctx}

export function returnToWorldIfAtExit(ctx) {
  if (!ctx || ctx.mode !== "dungeon" || !ctx.world) return false;

  // Allow exit when standing on ANY STAIRS tile (not just the designated entrance),
  // unless it is the special mountain-pass portal handled elsewhere.
  const onStairs = (ctx.inBounds(ctx.player.x, ctx.player.y) && ctx.map[ctx.player.y][ctx.player.x] === ctx.TILES.STAIRS);
  if (!onStairs) return false;

  // Save state first
  try { save(ctx, false); } catch (_) {
    try { if (ctx.DungeonState && typeof ctx.DungeonState.save === "function") ctx.DungeonState.save(ctx); } catch (_) {}
    try { if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.save === "function") window.DungeonState.save(ctx); } catch (_) {}
  }

  // Switch to world and clear dungeon-only entities
  ctx.mode = "world";
  if (Array.isArray(ctx.enemies)) ctx.enemies.length = 0;
  if (Array.isArray(ctx.corpses)) ctx.corpses.length = 0;
  if (Array.isArray(ctx.decals)) ctx.decals.length = 0;

  // Use world map and restore fog-of-war so minimap remembers explored areas
  ctx.map = ctx.world.map;
  try {
    if (ctx.world && ctx.world.seenRef && Array.isArray(ctx.world.seenRef)) ctx.seen = ctx.world.seenRef;
    if (ctx.world && ctx.world.visibleRef && Array.isArray(ctx.world.visibleRef)) ctx.visible = ctx.world.visibleRef;
  } catch (_) {}

  // For mountain-pass dungeons, exiting via normal stairs should take the player to the
  // *other* side of the pass (A <-> B), not back to the same entrance. We detect the
  // paired dungeon using passSourceX/passSourceY metadata on the far side dungeon (B),
  // or by scanning world.dungeons for a record that uses this dungeon's coords as its
  // passSource (when we are on the source side A).
  try {
    const info = ctx.dungeonInfo || ctx.dungeon || null;
    if (info && info.isMountainDungeon && ctx.world && Array.isArray(ctx.world.dungeons)) {
      let twinX = null;
      let twinY = null;

      if (typeof info.passSourceX === "number" && typeof info.passSourceY === "number") {
        // We are on the far side (B); twin is the original entrance dungeon A.
        twinX = info.passSourceX | 0;
        twinY = info.passSourceY | 0;
      } else if (typeof info.x === "number" && typeof info.y === "number") {
        // We are on the entrance side (A); twin is any dungeon whose passSource points here.
        const list = ctx.world.dungeons;
        const twin = list.find(d =>
          d &&
          typeof d.passSourceX === "number" &&
          typeof d.passSourceY === "number" &&
          (d.passSourceX | 0) === (info.x | 0) &&
          (d.passSourceY | 0) === (info.y | 0)
        ) || null;
        if (twin) {
          twinX = twin.x | 0;
          twinY = twin.y | 0;
        }
      }

      if (twinX != null && twinY != null) {
        ctx.worldReturnPos = { x: twinX, y: twinY };
        ctx.cameFromWorld = true;
      }
    }
  } catch (_) {}

  // Restore world position: prefer stored worldReturnPos; else dungeon entrance coordinates (absolute world coords)
  let rx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : null;
  let ry = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : null;
  if (rx == null || ry == null) {
    const info2 = ctx.dungeon || ctx.dungeonInfo;
    if (info2 && typeof info2.x === "number" && typeof info2.y === "number") {
      rx = info2.x; ry = info2.y;
    }
  }

  // Ensure the target world cell is in the current window, then convert to local indices
  try {
    const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
    if (WR && typeof WR.ensureInBounds === "function" && typeof rx === "number" && typeof ry === "number") {
      // Suspend player shifting during expansion to avoid camera/position snaps
      ctx._suspendExpandShift = true;
      try {
        let lx = rx - ctx.world.originX;
        let ly = ry - ctx.world.originY;
        WR.ensureInBounds(ctx, lx, ly, 32);
      } finally {
        ctx._suspendExpandShift = false;
      }
      const lx2 = rx - ctx.world.originX;
      const ly2 = ry - ctx.world.originY;
      ctx.player.x = lx2;
      ctx.player.y = ly2;
    } else if (typeof rx === "number" && typeof ry === "number") {
      const lx = rx - ctx.world.originX;
      const ly = ry - ctx.world.originY;
      ctx.player.x = Math.max(0, Math.min((ctx.map[0]?.length || 1) - 1, lx));
      ctx.player.y = Math.max(0, Math.min((ctx.map.length || 1) - 1, ly));
    }
  } catch (_) {}

  // Refresh visuals via StateSync
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      if (ctx.FOV && typeof ctx.FOV.recomputeFOV === "function") ctx.FOV.recomputeFOV(ctx);
      else if (ctx.recomputeFOV) ctx.recomputeFOV();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
  } catch (_) {}
  try { ctx.log && ctx.log("You climb back to the overworld.", "info"); } catch (_) {}

  return true;
}