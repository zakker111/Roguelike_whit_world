/**
 * SandboxRuntime: experimental sandbox mode room for focused testing.
 *
 * Exports (ESM + window.SandboxRuntime):
 * - enter(ctx, options)
 *
 * Notes:
 * - Step 1 MVP: only supports entering a small self-contained dungeon-style room.
 * - Later steps will add spawn helpers, flags, and panel integration.
 */

import { attachGlobal } from "../../utils/global.js";

/**
 * Allocate a rows x cols boolean grid, initialized to the given value.
 */
function makeBoolGrid(rows, cols, value) {
  const v = !!value;
  const out = new Array(rows);
  for (let y = 0; y < rows; y++) {
    const row = new Array(cols);
    for (let x = 0; x < cols; x++) row[x] = v;
    out[y] = row;
  }
  return out;
}

/**
 * Build a simple rectangular dungeon room: walls around the border, floor inside.
 * Uses ctx.TILES when available; falls back to numeric 0/1 if tiles are missing.
 */
function buildRoomMap(ctx, cols, rows) {
  const T = ctx && ctx.TILES ? ctx.TILES : null;
  const WALL = T && typeof T.WALL !== "undefined" ? T.WALL : 1;
  const FLOOR = T && typeof T.FLOOR !== "undefined" ? T.FLOOR : 0;

  const map = new Array(rows);
  for (let y = 0; y < rows; y++) {
    const row = new Array(cols);
    const edgeY = y === 0 || y === rows - 1;
    for (let x = 0; x < cols; x++) {
      const edgeX = x === 0 || x === cols - 1;
      // Perimeter walls, interior floor
      row[x] = (edgeX || edgeY) ? WALL : FLOOR;
    }
    map[y] = row;
  }
  return map;
}

/**
 * Enter sandbox mode by replacing the active map with a small test room.
 *
 * This does NOT attempt to save/restore previous game state; it is an
 * isolated developer tool. Exiting back to a normal run is handled by
 * the caller (e.g., via the existing restart/new-game flow).
 */
export function enter(ctx, options = {}) {
  if (!ctx) return;
  const cols = (options && options.cols) || 30;
  const rows = (options && options.rows) || 20;

  const map = buildRoomMap(ctx, cols, rows);
  const seen = makeBoolGrid(rows, cols, false);
  const visible = makeBoolGrid(rows, cols, false);

  // Mark mode + simple flags so other systems can detect sandbox.
  ctx.mode = "sandbox";
  ctx.isSandbox = true;
  ctx.sandboxFlags = ctx.sandboxFlags || {};
  ctx.sandboxFlags.fovEnabled = true;
  ctx.sandboxFlags.aiEnabled = true;
  ctx.sandboxPanelOpen = false;

  // Replace local map/visibility. These arrays are shared with core/game.js
  // via getCtx(), so downstream modules will see the updated room.
  ctx.map = map;
  ctx.seen = seen;
  ctx.visible = visible;

  // Clear runtime collections specific to the current map.
  ctx.enemies = Array.isArray(ctx.enemies) ? [] : [];
  ctx.npcs = Array.isArray(ctx.npcs) ? [] : [];
  ctx.townProps = Array.isArray(ctx.townProps) ? [] : [];
  ctx.corpses = Array.isArray(ctx.corpses) ? [] : [];
  ctx.dungeonProps = Array.isArray(ctx.dungeonProps) ? [] : [];
  ctx.decals = Array.isArray(ctx.decals) ? [] : [];

  // Place player roughly at the center of the room.
  if (ctx.player) {
    ctx.player.x = (cols / 2) | 0;
    ctx.player.y = (rows / 2) | 0;
  }

  // Let existing helpers rebuild FOV/camera/UI if present.
  try {
    if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
  } catch (_) {}
  try {
    if (typeof ctx.updateCamera === "function") ctx.updateCamera();
  } catch (_) {}
  try {
    if (typeof ctx.updateUI === "function") ctx.updateUI();
  } catch (_) {}
  try {
    if (typeof ctx.requestDraw === "function") ctx.requestDraw();
  } catch (_) {}
}

// Back-compat: attach to window so Ctx.attachModules can pick it up later.
attachGlobal("SandboxRuntime", { enter });