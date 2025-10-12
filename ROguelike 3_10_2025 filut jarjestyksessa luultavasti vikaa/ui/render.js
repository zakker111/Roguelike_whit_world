/**
 * Render orchestrator: delegates to mode-specific renderers.
 *
 * Exports (ESM + window.Render):
 * - draw(ctx)
 *
 * Notes:
 * - Uses RenderCore to compute view and shared helpers.
 * - Delegates to RenderOverworld/RenderTown/RenderDungeon for drawing.
 */

export function draw(ctx) {
  const view = (typeof window !== "undefined" && window.RenderCore && typeof RenderCore.computeView === "function")
    ? RenderCore.computeView(ctx)
    : null;
  if (!view) {
    // Fallback: minimal render via dungeon renderer if available
    try {
      if (typeof window !== "undefined" && window.RenderDungeon && typeof RenderDungeon.draw === "function") {
        return RenderDungeon.draw(ctx, Object.assign({
          ctx2d: ctx.ctx2d, TILE: ctx.TILE, COLORS: ctx.COLORS, TILES: ctx.TILES,
          cam: ctx.camera || { x: 0, y: 0, width: ctx.COLS * ctx.TILE, height: ctx.ROWS * ctx.TILE },
          tileOffsetX: 0, tileOffsetY: 0, startX: 0, startY: 0, endX: ctx.COLS - 1, endY: ctx.ROWS - 1
        }, ctx));
      }
    } catch (_) {}
    return;
  }

  if (ctx.mode === "world") {
    if (typeof window !== "undefined" && window.RenderOverworld && typeof RenderOverworld.draw === "function") {
      return RenderOverworld.draw(ctx, view);
    }
  } else if (ctx.mode === "town") {
    if (typeof window !== "undefined" && window.RenderTown && typeof RenderTown.draw === "function") {
      return RenderTown.draw(ctx, view);
    }
  } else {
    if (typeof window !== "undefined" && window.RenderDungeon && typeof RenderDungeon.draw === "function") {
      return RenderDungeon.draw(ctx, view);
    }
  }
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Render = { draw };
}