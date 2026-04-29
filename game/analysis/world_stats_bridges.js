(function () {
  if (typeof window === "undefined") return;

  let params;
  try {
    params = new URLSearchParams(window.location.search || "");
  } catch (_) {
    return;
  }
  if (params.get("worldstats_bridges") !== "1") return;

  function log(msg, level, extra) {
    try {
      const Logger = window.Logger;
      if (Logger && typeof Logger.log === "function") {
        Logger.log(msg, level || "notice", Object.assign({ category: "World" }, extra || {}));
      }

      var panel = document.getElementById("world-bridges-panel");
      if (!panel) {
        panel = document.createElement("pre");
        panel.id = "world-bridges-panel";
        panel.style.position = "absolute";
        panel.style.left = "4px";
        panel.style.top = "220px";
        panel.style.zIndex = "9999";
        panel.style.fontSize = "11px";
        panel.style.color = "#e5e7eb";
        panel.style.background = "rgba(0,0,0,0.6)";
        panel.style.padding = "4px 6px";
        panel.style.maxWidth = "420px";
        panel.style.whiteSpace = "pre-wrap";
        panel.style.pointerEvents = "none";
        document.body.appendChild(panel);
      }

      panel.textContent += msg + "\n";
    } catch (_) {}
  }

  function resolveCtx() {
    try {
      const GAPI = (typeof window !== "undefined" ? window.GameAPI : null);
      if (GAPI && typeof GAPI.getCtx === "function") {
        const c = GAPI.getCtx();
        if (c && typeof c === "object") return c;
      }
    } catch (_) {}
    try {
      const G = (typeof window !== "undefined" ? window.Game : null);
      if (G && G.ctx && typeof G.ctx === "object") return G.ctx;
    } catch (_) {}
    return null;
  }

  function tileLabel(T, id) {
    try {
      for (const key in T) {
        if (Object.prototype.hasOwnProperty.call(T, key) && T[key] === id) return key;
      }
    } catch (_) {}
    return "id=" + id;
  }

  function runAnalysis(world, map, T) {
    const height = map.length;
    const width = map[0] ? map[0].length : 0;
    if (!width || !height) {
      log("[WorldBridges] World map is empty; nothing to analyze", "warn");
      return;
    }

    const originX = (typeof world.originX === "number" ? world.originX : 0) | 0;
    const originY = (typeof world.originY === "number" ? world.originY : 0) | 0;

    const riverId = T && Object.prototype.hasOwnProperty.call(T, "RIVER") ? T.RIVER : null;
    const waterId = T && Object.prototype.hasOwnProperty.call(T, "WATER") ? T.WATER : null;
    const shallowId = T && Object.prototype.hasOwnProperty.call(T, "SHALLOW") ? T.SHALLOW : null;

    let riverTiles = 0;
    let waterTiles = 0;
    let shallowTiles = 0;

    for (let y = 0; y < height; y++) {
      const row = map[y];
      if (!row || row.length !== width) continue;
      for (let x = 0; x < width; x++) {
        const id = row[x];
        if (id === riverId) riverTiles++;
        if (id === waterId) waterTiles++;
        if (id === shallowId) shallowTiles++;
      }
    }

    const bridges = Array.isArray(world.bridges) ? world.bridges : [];
    const totalBridges = bridges.length;

    let bridgesInWindow = 0;
    let bridgesOnRiver = 0;
    let bridgesOnWater = 0;
    let bridgesOnShallow = 0;
    let bridgesOnOther = 0;

    const samples = [];
    const maxSamples = 10;

    for (let i = 0; i < bridges.length; i++) {
      const b = bridges[i];
      if (!b) continue;
      const ax = typeof b.x === "number" ? b.x : null;
      const ay = typeof b.y === "number" ? b.y : null;
      if (ax == null || ay == null) continue;

      const lx = ax - originX;
      const ly = ay - originY;
      if (lx < 0 || lx >= width || ly < 0 || ly >= height) continue;

      bridgesInWindow++;

      const row = map[ly];
      const id = row && row[lx];

      if (id === shallowId) {
        bridgesOnShallow++;
      } else if (id === riverId) {
        bridgesOnRiver++;
      } else if (id === waterId) {
        bridgesOnWater++;
      } else {
        bridgesOnOther++;
      }

      if (samples.length < maxSamples) {
        const name = tileLabel(T, id);
        samples.push("[WorldBridges] bridge #" + (samples.length + 1) + " at (" + ax + "," + ay + ") tile=" + name + " (" + id + ")");
      }
    }

    log("[WorldBridges] Window size=" + width + "x" + height + " origin=(" + originX + "," + originY + ")", "notice");

    if (riverId != null || waterId != null || shallowId != null) {
      log(
        "[WorldBridges] Tiles in window: RIVER=" +
          (riverId != null ? riverTiles : "n/a") +
          ", WATER=" +
          (waterId != null ? waterTiles : "n/a") +
          ", SHALLOW=" +
          (shallowId != null ? shallowTiles : "n/a"),
        "notice"
      );
    } else {
      log("[WorldBridges] Tiles in window: tile ids for RIVER/WATER/SHALLOW not found in InfiniteGen.TILES", "warn");
    }

    log("[WorldBridges] Bridges: total=" + totalBridges + ", inWindow=" + bridgesInWindow, "notice");

    if (bridgesInWindow > 0) {
      log(
        "[WorldBridges] Bridges by tile: WATER=" +
          bridgesOnWater +
          ", RIVER=" +
          bridgesOnRiver +
          ", SHALLOW=" +
          bridgesOnShallow +
          ", OTHER=" +
          bridgesOnOther,
        "notice"
      );
    }

    for (let i = 0; i < samples.length; i++) {
      log(samples[i], "notice");
    }
  }

  function tryRunOnce() {
    const IG = window.InfiniteGen;
    const RNG = window.RNG;
    const WR = window.WorldRuntime;

    if (!IG || typeof IG.create !== "function" || !RNG || typeof RNG.getSeed !== "function") {
      log("[WorldBridges] InfiniteGen or RNG not ready; aborting", "warn");
      return "abort";
    }
    if (!WR || typeof WR.generate !== "function") {
      log("[WorldBridges] WorldRuntime missing or incomplete; aborting", "warn");
      return "abort";
    }

    const ctx = resolveCtx();
    if (!ctx || typeof ctx !== "object") {
      return "retry";
    }

    const world = ctx.world;
    if (!world || typeof world !== "object") {
      return "retry";
    }

    if (!Array.isArray(world.bridges)) {
      log("[WorldBridges] ctx.world.bridges missing or not an array; aborting", "warn");
      return "done";
    }

    const map = (world.map && Array.isArray(world.map)) ? world.map : (Array.isArray(ctx.map) ? ctx.map : null);
    if (!map || !map.length || !Array.isArray(map[0])) {
      log("[WorldBridges] World map missing or malformed; aborting", "warn");
      return "done";
    }

    if (typeof world.originX !== "number" || typeof world.originY !== "number") {
      log("[WorldBridges] World originX/originY missing; aborting", "warn");
      return "done";
    }

    const seedRaw = RNG.getSeed();
    const seed = seedRaw != null ? (Number(seedRaw) >>> 0) : null;
    const gen = IG.create(seedRaw);
    const T = (gen && gen.TILES) ? gen.TILES : {};

    if (seed != null) {
      log("[WorldBridges] Seed=" + seed, "notice");
    } else {
      log("[WorldBridges] Seed=(unknown)", "notice");
    }

    runAnalysis(world, map, T);
    return "done";
  }

  function waitForCtxAndRun() {
    let attempts = 0;
    const maxAttempts = 40;
    const delayMs = 250;

    function step() {
      let result;
      try {
        result = tryRunOnce();
      } catch (e) {
        log(
          "[WorldBridges] Error: " + (e && e.message ? e.message : String(e)),
          "error"
        );
        return;
      }
      if (result === "done" || result === "abort") return;
      attempts++;
      if (attempts >= maxAttempts) {
        log("[WorldBridges] Game ctx/world/bridges not ready after waiting; aborting", "warn");
        return;
      }
      setTimeout(step, delayMs);
    }

    step();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(waitForCtxAndRun, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(waitForCtxAndRun, 0);
    });
  }
})();
