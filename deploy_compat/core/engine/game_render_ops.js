import { measureDraw as perfMeasureDraw } from "../facades/perf.js";

function modHandle(ctx, name) {
  try {
    if (ctx && ctx[name]) return ctx[name];
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window[name]) return window[name];
  } catch (_) {}
  return null;
}

export function createRenderOps(getCtx) {
  const ctx = () => (typeof getCtx === "function" ? getCtx() : null);

  // Suppress draw flag used for fast-forward time (sleep/wait simulations)
  let suppressDraw = false;

  function getRenderCtx() {
    const c = ctx();
    const RO = modHandle(c, "RenderOrchestration");
    if (!RO || typeof RO.getRenderCtx !== "function") return null;

    const base = RO.getRenderCtx(c);
    if (!base) return base;

    // Perf sink: delegate to core/facades/perf.js
    try {
      base.onDrawMeasured = (ms) => {
        try { perfMeasureDraw(ms); } catch (_) {}
      };
    } catch (_) {}
    return base;
  }

  function requestDraw() {
    if (suppressDraw) return;
    const c = ctx();
    const GL = modHandle(c, "GameLoop");
    if (GL && typeof GL.requestDraw === "function") {
      GL.requestDraw();
    }
  }

  function setSuppressDraw(v) {
    suppressDraw = !!v;
  }

  return {
    getRenderCtx,
    requestDraw,
    setSuppressDraw,
  };
}

// Back-compat naming to match the other game_*_ops modules.
export const createGameRenderOps = createRenderOps;
