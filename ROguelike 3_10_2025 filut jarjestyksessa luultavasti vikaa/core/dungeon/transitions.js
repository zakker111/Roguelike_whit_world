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

// If stepping on a special mountain-pass stairs, transfer to a linked dungeon across the mountain.
// The exit-side dungeon shares its base layout seed with the entrance dungeon so both ends of the
// pass are identical, and entering from the far side spawns the player at the pass stairs.
export function maybeEnterMountainPass(ctx, nx, ny) {
  try {
    const pass = ctx._mountainPassAt || null;
    if (pass && nx === pass.x && ny === pass.y && ctx.map[ny][nx] === ctx.TILES.STAIRS) {
      const tgt = computeAcrossMountainTarget(ctx);
      if (tgt && ctx.world) {
        try { save(ctx, false); } catch (_) {}

        const dinfo = ctx.dungeonInfo || ctx.dungeon || null;
        const level = Math.max(1, ctx.floor | 0);
        const size = (dinfo && dinfo.size) ? dinfo.size : "medium";

        // Ensure POI bookkeeping exists and either find or create a dungeon record at the
        // across-mountain coordinate. We use addDungeonPOI so world._poiSet stays consistent.
        let info = null;
        const world = ctx.world;
        try {
          const list = Array.isArray(world.dungeons) ? world.dungeons : [];
          info = list.find(d => d && (d.x | 0) === (tgt.x | 0) && (d.y | 0) === (tgt.y | 0)) || null;
          if (!info) {
            addDungeonPOI(world, tgt.x | 0, tgt.y | 0, {
              level,
              size,
              isMountainDungeon: true,
              spawnAtMountainPass: true,
              passSourceX: dinfo ? (dinfo.x | 0) : undefined,
              passSourceY: dinfo ? (dinfo.y | 0) : undefined,
            });
            // Re-fetch from world.dungeons after registration
            const list2 = Array.isArray(world.dungeons) ? world.dungeons : [];
            info = list2.find(d => d && (d.x | 0) === (tgt.x | 0) && (d.y | 0) === (tgt.y | 0)) || null;
          } else {
            info.isMountainDungeon = true;
            info.spawnAtMountainPass = true;
            if (dinfo) {
              info.passSourceX = dinfo.x | 0;
              info.passSourceY = dinfo.y | 0;
            }
            if (typeof info.level !== "number") info.level = level;
            if (!info.size) info.size = size;
          }
        } catch (_) {
          info = { x: tgt.x | 0, y: tgt.y | 0, level, size, isMountainDungeon: true, spawnAtMountainPass: true };
        }

        if (!info) return false;

        // When exiting this dungeon, return to the far-side world coordinate.
        ctx.worldReturnPos = { x: info.x | 0, y: info.y | 0 };
        ctx.cameFromWorld = true;

        ctx.log && ctx.log("You find a hidden passage through the mountain...", "info");
        return !!enter(ctx, info);
      }
    }
  } catch (_) {}
  return false;
}

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

  // Restore world position: prefer stored worldReturnPos; else dungeon entrance coordinates (absolute world coords)
  let rx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : null;
  let ry = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : null;
  if (rx == null || ry == null) {
    const info = ctx.dungeon || ctx.dungeonInfo;
    if (info && typeof info.x === "number" && typeof info.y === "number") {
      rx = info.x; ry = info.y;
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