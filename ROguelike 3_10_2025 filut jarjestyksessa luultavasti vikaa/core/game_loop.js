/**
 * GameLoop: minimal render loop and draw scheduler.
 * Exposes:
 * - GameLoop.requestDraw(): mark a frame dirty
 * - GameLoop.start(getRenderCtx): start RAF loop; calls Render.draw(getRenderCtx())
 */

let needsDraw = true;

export function requestDraw() {
  needsDraw = true;
}

function drawOnce(getRenderCtx) {
  if (!needsDraw) return;
  if (typeof window !== "undefined" && window.Render && typeof Render.draw === "function") {
    try {
      const ctx = (typeof getRenderCtx === "function") ? getRenderCtx() : null;
      Render.draw(ctx);
    } catch (e) {
      try { console.error("[GameLoop] draw error:", e); } catch (_) {}
    }
  }
  needsDraw = false;
}

export function start(getRenderCtx) {
  function frame() {
    drawOnce(getRenderCtx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.GameLoop = { requestDraw, start };
}