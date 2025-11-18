/**
 * Dungeon transitions (Phase 3 extraction): return-to-world and mountain pass handling.
 */
import { getMod } from "../../utils/access.js";
import { save } from "./state.js";
import { enter } from "./enter.js";

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

    function mountainRunLen(dx, dy) {
      let len = 0;
      let x = wx0, y = wy0;
      for (let i = 0; i < 300; i++) {
        const t = gen.tileAt(x, y);
        if (t === M) { len++; x += dx; y += dy; continue; }
        break;
      }
      return { len, endX: x, endY: y };
    }

    let best = null, bestLen = -1;
    for (const d of dirs) {
      const res = mountainRunLen(d.dx, d.dy);
      if (res.len > bestLen) { bestLen = res.len; best = { d, res }; }
    }
    if (!best) return null;
    // Move one more step beyond the last mountain tile to ensure we are across
    let tx = best.res.endX, ty = best.res.endY;
    // Nudge a few tiles further into non-mountain terrain for safety
    for (let k = 0; k < 5; k++) {
      const nx = tx + best.d.dx;
      const ny = ty + best.d.dy;
      const t = gen.tileAt(nx, ny);
      if (t === M) break;
      tx = nx; ty = ny;
    }
    return { x: tx, y: ty };
  } catch (_) { return null; }
}

// If stepping on a special mountain-pass stairs, transfer to a linked dungeon across the mountain.
export function maybeEnterMountainPass(ctx, nx, ny) {
  try {
    const pass = ctx._mountainPassAt || null;
    if (pass && nx === pass.x && ny === pass.y && ctx.map[ny][nx] === ctx.TILES.STAIRS) {
      const tgt = computeAcrossMountainTarget(ctx);
      if (tgt) {
        try { save(ctx, false); } catch (_) {}
        const size = (ctx.dungeonInfo && ctx.dungeonInfo.size) ? ctx.dungeonInfo.size : "medium";
        const level = Math.max(1, ctx.floor | 0);
        const info = { x: tgt.x, y: tgt.y, level, size };
        ctx.log && ctx.log("You find a hidden passage through the mountain...", "notice");
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
  try { ctx.log && ctx.log("You climb back to the overworld.", "notice"); } catch (_) {}

  return true;
}