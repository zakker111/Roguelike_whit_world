(function () {
  // SmokeTest Scenario: Bottle Map fishing pity timer
  // Validates:
  // - Repeated eligible "fishing successes" (simulated by calling the award helper)
  //   eventually award a bottle_map via GMBridge.maybeAwardBottleMapFromFishing(ctx).

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  function isBottleMapItem(it) {
    try {
      if (!it) return false;
      const k = String(it.kind || "").toLowerCase();
      if (k !== "tool") return false;
      const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
      return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
    } catch (_) {
      return false;
    }
  }

  function removeBottleMapsFromInventory(gctx) {
    let removed = 0;
    try {
      const inv = (gctx && gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : null;
      if (!inv) return 0;
      for (let i = inv.length - 1; i >= 0; i--) {
        if (isBottleMapItem(inv[i])) {
          inv.splice(i, 1);
          removed++;
        }
      }
    } catch (_) {}
    return removed;
  }

  function hasBottleMapInInventory(gctx) {
    try {
      const inv = (gctx && gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : [];
      return inv.some(isBottleMapItem);
    } catch (_) {
      return false;
    }
  }

  function readSmaxFromConfig() {
    try {
      const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config) ? window.GameData.config : null;
      const f = cfg && cfg.gm && cfg.gm.bottleMap && cfg.gm.bottleMap.fishing ? cfg.gm.bottleMap.fishing : null;
      const v = f && typeof f.Smax === "number" && Number.isFinite(f.Smax) ? (f.Smax | 0) : null;
      if (v != null && v > 0) return v;
    } catch (_) {}
    return 180;
  }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));
    const ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) || null;

    const G = window.GameAPI || null;
    const GM = window.GMRuntime || null;
    const GMB = window.GMBridge || null;

    if (!G || !has(G.getCtx) || !has(G.getMode)) {
      recordSkip("Bottle Map fishing pity skipped (GameAPI not available)");
      return true;
    }

    if (!GM || !has(GM.getState) || !GMB || !has(GMB.maybeAwardBottleMapFromFishing)) {
      recordSkip("Bottle Map fishing pity skipped (GMRuntime/GMBridge missing)");
      return true;
    }

    // Ensure overworld mode (same recovery strategy as gm_bottle_map).
    try {
      const mode0 = has(G.getMode) ? String(G.getMode() || "") : "";
      if (mode0 && mode0 !== "world") {
        try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}
        try {
          if (mode0 === "encounter" && has(G.completeEncounter)) G.completeEncounter("withdraw");
          else if (mode0 === "dungeon" && has(G.returnToWorldIfAtExit)) G.returnToWorldIfAtExit();
          else if (mode0 === "town") {
            if (has(G.returnToWorldFromTown)) G.returnToWorldFromTown();
            else if (has(G.leaveTownNow)) G.leaveTownNow();
            else if (has(G.requestLeaveTown)) G.requestLeaveTown();
          }
        } catch (_) {}
        if (has(G.forceWorld)) {
          try { G.forceWorld(); } catch (_) {}
          await sleep(240);
        }
      }
    } catch (_) {}

    const gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("Bottle Map fishing pity skipped (not in world mode)");
      return true;
    }

    // Ensure no modal UI is intercepting key input.
    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(3); } catch (_) {}

    const gm = GM.getState(gctx);
    if (!gm || typeof gm !== "object") {
      record(false, "Bottle Map fishing pity: GM state missing");
      return true;
    }

    // Snapshot state so we can restore it (avoid destabilizing later scenarios).
    const oldEnabled = gm.enabled !== false;
    const oldBoredom = (gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)) ? gm.boredom.level : 0;

    // Ensure gm.threads.bottleMap exists.
    let bm = null;
    try {
      if (gm.threads && typeof gm.threads === "object" && gm.threads.bottleMap && typeof gm.threads.bottleMap === "object") {
        bm = gm.threads.bottleMap;
      } else {
        if (!gm.threads || typeof gm.threads !== "object") gm.threads = {};
        gm.threads.bottleMap = { active: false };
        bm = gm.threads.bottleMap;
      }
    } catch (_) {
      if (!gm.threads || typeof gm.threads !== "object") gm.threads = {};
      gm.threads.bottleMap = { active: false };
      bm = gm.threads.bottleMap;
    }

    const oldActive = !!(bm.active === true);
    const oldFishing = (bm.fishing && typeof bm.fishing === "object") ? Object.assign({}, bm.fishing) : null;

    // Force eligibility.
    gm.enabled = true;
    gm.boredom = (gm.boredom && typeof gm.boredom === "object") ? gm.boredom : (gm.boredom = {});
    gm.boredom.level = 1.0;

    // Ensure thread inactive so the award helper isn't blocked.
    bm.active = false;

    // Ensure fishing state exists and reset its counters so the test is deterministic.
    bm.fishing = (bm.fishing && typeof bm.fishing === "object") ? bm.fishing : (bm.fishing = {});
    bm.fishing.eligibleSuccesses = 0;
    bm.fishing.totalSuccesses = 0;
    bm.fishing.lastAwardTurn = -999999;
    bm.fishing.awardCount = 0;

    const removedBefore = removeBottleMapsFromInventory(gctx);
    record(true, `Bottle Map fishing pity: cleared bottle_map from inventory (removed=${removedBefore})`);
    record(!hasBottleMapInInventory(gctx), "Bottle Map fishing pity: inventory has no bottle_map before loop");

    try { if (typeof gctx.updateUI === "function") gctx.updateUI(); } catch (_) {}
    try { if (typeof gctx.rerenderInventoryIfOpen === "function") gctx.rerenderInventoryIfOpen(); } catch (_) {}

    const Smax = readSmaxFromConfig();
    record(true, `Bottle Map fishing pity: using Smax=${Smax}`);

    const maxTries = (Smax | 0) + 5;
    let got = false;
    let gotAt = -1;

    for (let i = 0; i < maxTries; i++) {
      let ok = false;
      try { ok = !!GMB.maybeAwardBottleMapFromFishing(gctx); } catch (_) { ok = false; }
      if (ok || hasBottleMapInInventory(gctx)) {
        got = true;
        gotAt = i + 1;
        break;
      }
    }

    record(got, `Bottle Map fishing pity: awarded within ${maxTries} calls (gotAt=${gotAt})`);

    // Cleanup: remove any awarded bottle map and restore state.
    const removedAfter = removeBottleMapsFromInventory(gctx);
    if (removedAfter) {
      record(true, `Bottle Map fishing pity: cleanup removed bottle_map (removedAfter=${removedAfter})`);
    }

    try { if (typeof gctx.updateUI === "function") gctx.updateUI(); } catch (_) {}
    try { if (typeof gctx.rerenderInventoryIfOpen === "function") gctx.rerenderInventoryIfOpen(); } catch (_) {}

    try {
      gm.enabled = oldEnabled;
      if (gm.boredom) gm.boredom.level = oldBoredom;
      bm.active = oldActive;
      if (oldFishing) bm.fishing = Object.assign({}, oldFishing);
    } catch (_) {}

    return true;
  }

  window.SmokeTest.Scenarios.gm_bottle_map_fishing_pity = { run };
})();
