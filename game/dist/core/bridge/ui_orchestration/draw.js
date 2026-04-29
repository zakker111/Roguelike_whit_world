import { log as fallbackLog } from "../../../utils/fallback.js";
import { GL, R } from "./shared.js";

export function requestDraw(ctx) {
  // Prefer ctx.requestDraw if provided by orchestrator
  try {
    if (ctx && typeof ctx.requestDraw === "function") {
      ctx.requestDraw();
      return;
    }
  } catch (_) {}

  // Next, GameLoop.requestDraw
  try {
    const gl = GL();
    if (gl && typeof gl.requestDraw === "function") {
      gl.requestDraw();
      return;
    }
  } catch (_) {}

  // Fallback: ask Render to draw if we have a render context provider
  try {
    const r = R();
    if (r && typeof r.draw === "function" && typeof ctx?.getRenderCtx === "function") {
      try {
        fallbackLog(
          "uiOrchestration.requestDraw.renderFallback",
          "GameLoop.requestDraw unavailable; falling back to direct Render.draw."
        );
      } catch (_) {}
      r.draw(ctx.getRenderCtx());
    }
  } catch (_) {}
}
