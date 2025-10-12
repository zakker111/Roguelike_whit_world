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
import * as RenderCore from "./render_core.js";
import * as RenderOverworld from "./render_overworld.js";
import * as RenderTown from "./render_town.js";
import * as RenderDungeon from "./render_dungeon.js";

export function draw(ctx) {
  const view = RenderCore.computeView(ctx);

  if (ctx.mode === "world") {
    return RenderOverworld.draw(ctx, view);
  } else if (ctx.mode === "town") {
    return RenderTown.draw(ctx, view);
  } else {
    return RenderDungeon.draw(ctx, view);
  }
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Render = { draw };
}