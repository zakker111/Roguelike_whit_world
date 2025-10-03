/**
 * GameLoop: minimal render loop and draw scheduler.
 * Exposes:
 * - GameLoop.requestDraw(): mark a frame dirty
 * - GameLoop.start(getRenderCtx): start RAF loop; calls Render.draw(getRenderCtx())
 */
(function () {
  const GL = {};
  let needsDraw = true;

  GL.requestDraw = function requestDraw() {
    needsDraw = true;
  };

  function drawOnce(getRenderCtx) {
    if (!needsDraw) return;
    if (window.Render && typeof Render.draw === "function") {
      try {
        const ctx = (typeof getRenderCtx === "function") ? getRenderCtx() : null;
        Render.draw(ctx);
      } catch (e) {
        try { console.error("[GameLoop] draw error:", e); } catch (_) {}
      }
    }
    needsDraw = false;
  }

  GL.start = function start(getRenderCtx) {
    function frame() {
      drawOnce(getRenderCtx);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  window.GameLoop = GL;
})();