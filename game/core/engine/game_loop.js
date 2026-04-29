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
  if (typeof window !== "undefined" && window.Render && typeof window.Render.draw === "function") {
    try {
      const ctx = (typeof getRenderCtx === "function") ? getRenderCtx() : null;
      const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      window.Render.draw(ctx);
      const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const dt = t1 - t0;
      try { if (ctx && typeof ctx.onDrawMeasured === "function") ctx.onDrawMeasured(dt); } catch (_) {}
    } catch (e) {
      try { console.error("[GameLoop] draw error:", e); } catch (_) {}
    }
  }
  needsDraw = false;
}

export function start(getRenderCtx) {
  let running = false;

  function frame() {
    if (!running) return;
    drawOnce(getRenderCtx);
    requestAnimationFrame(frame);
  }

  function onVisibilityChange() {
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (hidden) {
      running = false;
    } else {
      if (!running) {
        running = true;
        requestAnimationFrame(frame);
      }
    }
  }

  running = true;
  requestAnimationFrame(frame);

  try {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
  } catch (_) {}
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("GameLoop", { requestDraw, start });