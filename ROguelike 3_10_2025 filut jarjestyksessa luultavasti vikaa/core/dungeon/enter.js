/**
 * Dungeon enter (Phase 3 extraction): mode switch and initial floor setup.
 */
import { getMod } from "../../utils/access.js";
import { load, save } from "./state.js";
import { generate } from "./generate.js";

export function enter(ctx, info) {
  if (!ctx || !info) return false;
  // Preserve world fog-of-war references so we can restore on exit
  try {
    if (ctx.world) {
      ctx.world.seenRef = ctx.seen;
      ctx.world.visibleRef = ctx.visible;
    }
  } catch (_) {}
  ctx.dungeon = info;
  ctx.dungeonInfo = info;
  ctx.floor = Math.max(1, (info.level | 0) || 1);
  ctx.mode = "dungeon";

  // Try loading an existing state first
  try {
    if (load(ctx, info.x, info.y)) {
      return true;
    }
  } catch (_) {}

  // Announce entry and generate a fresh floor
  try { ctx.log && ctx.log(`You enter the dungeon (Difficulty ${ctx.floor}${info.size ? ", " + info.size : ""}).`, "info"); } catch (_) {}
  generate(ctx, ctx.floor);

  // Mark entrance position as the exit and ensure tile visuals
  try {
    ctx.dungeonExitAt = { x: ctx.player.x, y: ctx.player.y };
    if (ctx.inBounds && ctx.inBounds(ctx.player.x, ctx.player.y)) {
      ctx.map[ctx.player.y][ctx.player.x] = ctx.TILES.STAIRS;
      if (Array.isArray(ctx.seen) && ctx.seen[ctx.player.y]) ctx.seen[ctx.player.y][ctx.player.x] = true;
      if (Array.isArray(ctx.visible) && ctx.visible[ctx.player.y]) ctx.visible[ctx.player.y][ctx.player.x] = true;
    }
  } catch (_) {}

  // Persist immediately
  try { save(ctx, true); } catch (_) {}

  // Ensure visuals are refreshed via StateSync
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  return true;
}