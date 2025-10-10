/**
 * Render orchestrator: delegates to mode-specific renderers.
 *
 * Exports (window.Render):
 * - draw(ctx)
 *
 * Notes:
 * - Uses RenderCore to compute view and shared helpers.
 * - Delegates to RenderOverworld/RenderTown/RenderDungeon for drawing.
 */
(function () {
  function draw(ctx) {
    const view = (window.RenderCore && typeof RenderCore.computeView === "function")
      ? RenderCore.computeView(ctx)
      : null;
    if (!view) {
      // Fallback: minimal render via dungeon renderer if available
      try {
        if (window.RenderDungeon && typeof RenderDungeon.draw === "function") {
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
      if (window.RenderOverworld && typeof RenderOverworld.draw === "function") {
        return RenderOverworld.draw(ctx, view);
      }
    } else if (ctx.mode === "town") {
      if (window.RenderTown && typeof RenderTown.draw === "function") {
        return RenderTown.draw(ctx, view);
      }
    } else {
      if (window.RenderDungeon && typeof RenderDungeon.draw === "function") {
        return RenderDungeon.draw(ctx, view);
      }
    }
  }

  window.Render = { draw };
})();