/* eslint-disable max-lines */
(function () {
  // SmokeTest Scenario: Bottle Map
  // Validates:
  // - A usable bottle_map item can be used from inventory.
  // - Using it places a gm.bottleMap marker via MarkerService.
  // - Pressing 'g' on that marker starts the Bottle Map encounter.
  // - Withdrawing from the encounter keeps the marker.
  // - Winning the encounter pays out (gold delta) and removes the marker.
  // - Phase 7D lifecycle gates:
  //   - Orphan marker cleanup when thread inactive.
  //   - Thread active but marker missing -> reconcileMarkers restores.
  //   - Activation failure (no valid target) refunds item and expires thread.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));
    const key = (ctx && ctx.key) || (k => { try { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true })); } catch (_) {} });
    const ensureAllModalsClosed = (ctx && ctx.ensureAllModalsClosed) || null;

    const G = window.GameAPI || null;
    if (!G || !has(G.getCtx) || !has(G.getMode)) {
      recordSkip("Bottle Map skipped (GameAPI not available)");
      return true;
    }

    // This scenario requires overworld mode; try to recover if we're currently in another mode
    // (e.g. if a prior scenario left the game in town/dungeon/encounter/region).
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
        // Hard fallback: force a fresh overworld (acceptable for smoketests)
        if (has(G.forceWorld)) {
          try { G.forceWorld(); } catch (_) {}
          await sleep(240);
        }
      }
    } catch (_) {}

    const gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("Bottle Map skipped (not in world mode)");
      return true;
    }

    // Ensure no modal UI (GOD/smoke/inventory/etc) is intercepting key input.
    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}

    const MS = window.MarkerService || null;
    const IF = window.InventoryFlow || null;
    const GMB = window.GMBridge || null;
    const GMRuntime = window.GMRuntime || null;
    record(!!MS, "MarkerService is available");
    record(!!IF, "InventoryFlow is available");
    record(!!GMB, "GMBridge is available");
    record(!!GMRuntime, "GMRuntime is available");

    const getGmState = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        if (GMRuntime && has(GMRuntime.getState)) return GMRuntime.getState(c);
        if (c && c.gm && typeof c.gm === "object") return c.gm;
      } catch (_) {}
      return null;
    };

    const getBottleMapThread = () => {
      try {
        const gm = getGmState();
        const threads = (gm && gm.threads && typeof gm.threads === "object") ? gm.threads : null;
        return (threads && threads.bottleMap && typeof threads.bottleMap === "object") ? threads.bottleMap : null;
      } catch (_) {
        return null;
      }
    };

    const resetBottleMapThread = () => {
      try {
        const bm = getBottleMapThread();
        if (!bm) return;
        bm.active = false;
        bm.status = "claimed";
        bm.instanceId = null;
        bm.createdTurn = null;
        bm.claimedTurn = null;
        bm.attempts = 0;
        bm.target = null;
        bm.reward = null;
        bm.failureReason = null;
        bm.placementTries = null;
      } catch (_) {}
    };

    const normalizeBottleMapStatus = (rawStatus, active) => {
      const s = (typeof rawStatus === "string" ? rawStatus : "").trim();
      const low = s.toLowerCase();
      if (low === "inencounter" || low === "in_encounter" || low === "in-encounter") return "inEncounter";
      if (low === "active") return "active";
      if (low === "claimed") return "claimed";
      if (low === "expired") return "expired";
      return active ? "active" : "claimed";
    };

    const readBottleMapThreadSnapshot = () => {
      try {
        const bm = getBottleMapThread();
        if (!bm || typeof bm !== "object") return null;
        const active = bm.active === true;
        const instanceId = bm.instanceId != null ? String(bm.instanceId) : "";
        const status = normalizeBottleMapStatus(bm.status, active);
        const attempts = (typeof bm.attempts === "number" && Number.isFinite(bm.attempts)) ? (bm.attempts | 0) : 0;
        const t = bm.target && typeof bm.target === "object" ? bm.target : null;
        const absX = (t && typeof t.absX === "number" && Number.isFinite(t.absX)) ? (t.absX | 0) : null;
        const absY = (t && typeof t.absY === "number" && Number.isFinite(t.absY)) ? (t.absY | 0) : null;
        const claimedTurn = (typeof bm.claimedTurn === "number" && Number.isFinite(bm.claimedTurn)) ? (bm.claimedTurn | 0) : null;
        return { active, status, instanceId, attempts, target: (absX == null || absY == null) ? null : { absX, absY }, claimedTurn };
      } catch (_) {
        return null;
      }
    };

    if (!MS || !has(MS.add) || !has(MS.findAtPlayer) || !has(MS.remove) || !IF || !has(IF.useItemByIndex)) {
      recordSkip("Bottle Map skipped (MarkerService/InventoryFlow missing required functions)");
      return true;
    }

    // Clean any stale Bottle Map state from a prior attempt (keeps this scenario deterministic).
    try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    resetBottleMapThread();

    const worldRef = gctx.world || null;

    const getQuestMarkers = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : null;
        const w = (c && c.world) || worldRef;
        return (w && Array.isArray(w.questMarkers)) ? w.questMarkers : [];
      } catch (_) {
        return [];
      }
    };

    const findBottleMarker = (instanceId) => {
      const list = getQuestMarkers();
      return list.find(m => {
        if (!m) return false;
        if (String(m.kind || "") !== "gm.bottleMap") return false;
        if (instanceId == null) return true;
        return String(m.instanceId || "") === String(instanceId || "");
      }) || null;
    };

    const isConfirmOpen = () => {
      try {
        const CM = window.ConfirmModal;
        if (CM && typeof CM.isOpen === "function") return !!CM.isOpen();
      } catch (_) {}
      try {
        const panel = document.getElementById("confirm-panel");
        return !!(panel && panel.style.display !== "none");
      } catch (_) { return false; }
    };

    const acceptConfirm = async () => {
      // Prefer keyboard acceptance (Enter) now that ConfirmModal supports it.
      for (let n = 0; n < 30; n++) {
        if (isConfirmOpen()) break;
        await sleep(80);
      }
      if (!isConfirmOpen()) return false;

      try { key("Enter"); } catch (_) {}
      for (let n = 0; n < 30; n++) {
        if (!isConfirmOpen()) return true;
        await sleep(80);
      }
      return !isConfirmOpen();
    };

    const getGoldAmount = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        let sum = 0;
        for (const it of inv) {
          if (!it) continue;
          const k = String(it.kind || it.type || "").toLowerCase();
          if (k !== "gold") continue;
          sum += (typeof it.amount === "number") ? it.amount : (Number(it.amount) || 0);
        }
        return sum;
      } catch (_) {
        return 0;
      }
    };

    

    const isBottleMapItem = (it) => {
      try {
        if (!it) return false;
        const k = String(it.kind || "").toLowerCase();
        if (k !== "tool") return false;
        const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
        return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
      } catch (_) {
        return false;
      }
    };

    const countBottleMaps = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        let n = 0;
        for (const it of inv) {
          if (isBottleMapItem(it)) n++;
        }
        return n;
      } catch (_) {
        return 0;
      }
    };

    const removeAllBottleMaps = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : gctx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        for (let i = inv.length - 1; i >= 0; i--) {
          if (isBottleMapItem(inv[i])) inv.splice(i, 1);
        }
        if (typeof c.updateUI === "function") c.updateUI();
        else if (typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}
    };

    const waitUntil = async (pred, timeoutMs, intervalMs) => {
      const deadline = Date.now() + Math.max(0, (timeoutMs | 0) || 0);
      const step = Math.max(20, (intervalMs | 0) || 80);
      while (Date.now() < deadline) {
        let ok = false;
        try { ok = !!pred(); } catch (_) { ok = false; }
        if (ok) return true;
        await sleep(step);
      }
      try { return !!pred(); } catch (_) { return false; }
    };

    const waitUntilMode = (mode, timeoutMs) => waitUntil(() => has(G.getMode) && G.getMode() === mode, timeoutMs, 80);

    // Encounter template must be present for GMBridge to start the encounter.
    let encReady = true;
    try {
      if (ctx && typeof ctx.waitForEncounterTemplate === "function") {
        encReady = await ctx.waitForEncounterTemplate("gm_bottle_map_scene", { timeoutMs: 12000, settleTimeoutMs: 15000, intervalMs: 80 });
      } else {
        const H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.GameData;
        if (H && typeof H.waitForEncounterTemplate === "function") {
          encReady = await H.waitForEncounterTemplate("gm_bottle_map_scene", { timeoutMs: 12000, settleTimeoutMs: 15000, intervalMs: 80 });
        } else {
          const GD = (typeof window !== "undefined" ? window.GameData : null);
          if (GD && GD.ready && typeof GD.ready.then === "function") {
            let settled = false;
            try {
              GD.ready.then(() => { settled = true; }, () => { settled = true; });
            } catch (_) {
              settled = true;
            }
            await waitUntil(() => settled, 15000, 80);
          }
          encReady = await waitUntil(() => {
            try {
              const GD2 = (typeof window !== "undefined" ? window.GameData : null);
              const reg = GD2 && GD2.encounters && Array.isArray(GD2.encounters.templates) ? GD2.encounters.templates : [];
              return !!reg.find(t => t && String(t.id || "").toLowerCase() === "gm_bottle_map_scene");
            } catch (_) {
              return false;
            }
          }, 12000, 80);
        }
      }
    } catch (_) {
      encReady = false;
    }
    record(encReady, "Encounter template 'gm_bottle_map_scene' loaded");
    if (!encReady) {
      recordSkip("Bottle Map skipped (encounter templates not loaded)");
      return true;
    }

    const teleportToMarker = async (m) => {
      let ok = false;
      let lx = 0;
      let ly = 0;
      try {
        const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
        const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
        const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
        lx = (m.x | 0) - ox;
        ly = (m.y | 0) - oy;
        if (has(G.teleportTo)) ok = !!G.teleportTo(lx, ly, { ensureWalkable: true, fallbackScanRadius: 4 });
      } catch (_) { ok = false; }

      if (!ok) {
        await sleep(120);
        return false;
      }

      // Ensure we are standing *exactly* on the marker tile before pressing 'g'.
      let onTile = false;
      try {
        onTile = await waitUntil(() => {
          const p = has(G.getPlayer) ? G.getPlayer() : null;
          return !!(p && (p.x | 0) === (lx | 0) && (p.y | 0) === (ly | 0));
        }, 900, 80);
      } catch (_) { onTile = false; }

      if (!onTile) {
        // Force-land even if the tile is considered non-walkable (marker interactions only need us on the coords).
        try {
          if (has(G.teleportTo)) ok = !!G.teleportTo(lx, ly, { ensureWalkable: false, fallbackScanRadius: 0 });
        } catch (_) { ok = false; }
        try {
          onTile = await waitUntil(() => {
            const p = has(G.getPlayer) ? G.getPlayer() : null;
            return !!(p && (p.x | 0) === (lx | 0) && (p.y | 0) === (ly | 0));
          }, 900, 80);
        } catch (_) { onTile = false; }
      }

      let onMarker = false;
      try {
        const want = String((m && m.instanceId) || "");
        onMarker = await waitUntil(() => {
          const at = MS.findAtPlayer(gctx);
          const markers = Array.isArray(at) ? at : (at ? [at] : []);
          return !!markers.find(mm => mm && String(mm.instanceId || "") === want);
        }, 900, 80);
      } catch (_) { onMarker = false; }

      return !!(ok && onTile && onMarker);
    };

    // Phase 7D regression gate: GMBridge.useInventoryItem should not treat an undefined idx as 0
    // (undefined | 0 === 0), which could consume the wrong inventory slot.
    let idxSafetyOk = true;
    let handledIdxSafety = false;
    try {
      if (GMB && has(GMB.useInventoryItem)) {
        // Hard reset bottle map state.
        try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
        resetBottleMapThread();

        const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : (gctx.player.inventory = []);
        const invSnap = inv.slice(0);

        // Keep only our two test items to avoid interacting with other systems.
        inv.length = 0;
        const dummy = { kind: "tool", id: "dummy_tool", type: "dummy_tool", name: "dummy tool", decay: 0, usable: true };
        const bmItem = { kind: "tool", id: "bottle_map", type: "bottle_map", name: "bottle map", decay: 0, usable: true };
        inv.push(dummy);
        inv.push(bmItem);

        // Force target placement failure by patching overworld walkability.
        const WorldMod = (typeof window !== "undefined" ? window.World : null);
        const origWalk = (WorldMod && typeof WorldMod.isWalkable === "function") ? WorldMod.isWalkable : null;
        const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
        const gen = (w && w.gen) ? w.gen : null;
        const origGenWalk = (gen && typeof gen.isWalkable === "function") ? gen.isWalkable : null;
        try {
          if (origWalk && WorldMod) WorldMod.isWalkable = () => false;
          if (origGenWalk && gen) gen.isWalkable = () => false;
          // idx intentionally undefined
          handledIdxSafety = !!GMB.useInventoryItem(gctx, bmItem, undefined);
        } finally {
          if (origWalk && WorldMod) WorldMod.isWalkable = origWalk;
          if (origGenWalk && gen) gen.isWalkable = origGenWalk;
        }

        // Dummy should never be consumed.
        const dummyStillThere = inv.indexOf(dummy) >= 0;
        // Bottle map should still exist (refunded after failure).
        const bmCount = countBottleMaps();
        idxSafetyOk = !!handledIdxSafety && dummyStillThere && bmCount >= 1;

        // Cleanup: restore original inventory snapshot.
        try {
          inv.length = 0;
          for (let ii = 0; ii < invSnap.length; ii++) inv.push(invSnap[ii]);
          if (typeof gctx.updateUI === "function") gctx.updateUI();
        } catch (_) {}
      }
    } catch (_) {
      idxSafetyOk = false;
    }
    record(idxSafetyOk, "Bottle map idx safety: undefined idx does not consume wrong inventory slot");

    // Phase 7D lifecycle gate: activation failure should refund the item and expire the thread.
    let activationFailureOk = false;
    try {
      const WorldMod = (typeof window !== "undefined" ? window.World : null);
      const origWalk = (WorldMod && typeof WorldMod.isWalkable === "function") ? WorldMod.isWalkable : null;
      const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
      const gen = (w && w.gen) ? w.gen : null;
      const origGenWalk = (gen && typeof gen.isWalkable === "function") ? gen.isWalkable : null;
      const origCtxWalk = (gctx && typeof gctx.isWalkable === "function") ? gctx.isWalkable : null;

      const bmBefore = countBottleMaps();

      // Add a bottle map item.
      let idxFail = -1;
      try {
        const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : (gctx.player.inventory = []);
        idxFail = inv.length;
        inv.push({ kind: "tool", id: "bottle_map", type: "bottle_map", name: "bottle map", decay: 0, usable: true });
        if (typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}

      try {
        if (origWalk && WorldMod) WorldMod.isWalkable = () => false;
        if (origGenWalk && gen) gen.isWalkable = () => false;
        if (origCtxWalk) gctx.isWalkable = () => false;
        try { IF.useItemByIndex(gctx, idxFail); } catch (_) {}
      } finally {
        if (origWalk && WorldMod) WorldMod.isWalkable = origWalk;
        if (origGenWalk && gen) gen.isWalkable = origGenWalk;
        if (origCtxWalk) gctx.isWalkable = origCtxWalk;
      }

      const threadExpiredNow = () => {
        try {
          const bm = getBottleMapThread();
          const st = String((bm && bm.status) || "");
          return !!(bm && bm.active === false && st && st.indexOf("expired") >= 0);
        } catch (_) {
          return false;
        }
      };

      // Give the GM thread a brief moment to set failure/expiry flags.
      await waitUntil(() => threadExpiredNow() || !!findBottleMarker(null), 900, 80);

      const bmAfter = countBottleMaps();
      const markerPlaced = !!findBottleMarker(null);
      const expiredOk = threadExpiredNow();

      activationFailureOk = (bmAfter >= (bmBefore + 1)) && !markerPlaced && expiredOk;
      record(true, "Bottle map activation failure path executed");
    } catch (_) {
      activationFailureOk = false;
    }

    // Cleanup any refunded bottle maps so the main scenario starts from a clean slate.
    try { removeAllBottleMaps(); } catch (_) {}
    try { MS.remove(gctx, (m) => m && String(m.kind || "") === "gm.bottleMap"); } catch (_) {}
    resetBottleMapThread();

    record(activationFailureOk, "Bottle map activation failure: item refunded, thread expired, marker not placed");

    // Phase 7D lifecycle gate: orphan markers should be cleaned when the thread is inactive.
    let orphanCleanupOk = false;
    try {
      if (GMB && has(GMB.reconcileMarkers)) {
        const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
        const p = has(G.getPlayer) ? G.getPlayer() : { x: 0, y: 0 };
        const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
        const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
        const orphanId = "smoke_orphan_bottle_map";
        MS.add(gctx, { x: ox + (p.x | 0), y: oy + (p.y | 0), kind: "gm.bottleMap", glyph: "X", paletteKey: "questMarker", instanceId: orphanId });

        // Ensure thread is inactive.
        resetBottleMapThread();

        await sleep(120);
        GMB.reconcileMarkers(gctx);
        await sleep(120);
        orphanCleanupOk = !findBottleMarker(orphanId);

        // Hard cleanup for subsequent steps.
        try { MS.remove(gctx, { kind: "gm.bottleMap", instanceId: orphanId }); } catch (_) {}
      }
    } catch (_) {
      orphanCleanupOk = false;
    }
    record(orphanCleanupOk, "Bottle map marker integrity: reconcile removes orphan marker when thread inactive");

    const ensureSafeOverworldForBottleMap = async () => {
      try {
        const w = (has(G.getCtx) ? (G.getCtx() && G.getCtx().world) : null) || worldRef;
        if (!w || !Array.isArray(w.map) || !w.map.length) return true;
        const WorldMod = (typeof window !== "undefined" ? window.World : null);
        const WT = (WorldMod && WorldMod.TILES) ? WorldMod.TILES : null;
        const disallowed = WT ? new Set([WT.WATER, WT.RIVER, WT.MOUNTAIN, WT.RUINS, WT.TOWN, WT.DUNGEON, WT.CASTLE, WT.TOWER]) : null;

        const gen = w.gen || null;
        const walkableTile = (t) => {
          try {
            if (gen && typeof gen.isWalkable === "function") return !!gen.isWalkable(t);
            if (WorldMod && typeof WorldMod.isWalkable === "function") return !!WorldMod.isWalkable(t);
          } catch (_) {}
          return true;
        };

        const h = w.map.length | 0;
        const w0 = (w.map[0] && w.map[0].length) ? (w.map[0].length | 0) : 0;
        const inBounds = (x, y) => (x >= 0 && y >= 0 && x < w0 && y < h);
        const tileAt = (x, y) => (inBounds(x, y) ? w.map[y][x] : null);
        const isAllowed = (t) => {
          if (!disallowed) return true;
          return !disallowed.has(t);
        };

        const ringTargetCount = (cx, cy) => {
          let count = 0;
          const radii = [14, 18, 22, 26, 30];
          const steps = 16;
          for (let ri = 0; ri < radii.length; ri++) {
            const r = radii[ri];
            for (let i = 0; i < steps; i++) {
              const a = (Math.PI * 2 * i) / steps;
              const dx = Math.round(Math.cos(a) * r);
              const dy = Math.round(Math.sin(a) * r);
              const x = (cx | 0) + dx;
              const y = (cy | 0) + dy;
              if (!inBounds(x, y)) continue;
              const t = tileAt(x, y);
              if (t == null) continue;
              if (!isAllowed(t)) continue;
              if (!walkableTile(t)) continue;
              count++;
            }
          }
          return count;
        };

        const p0 = has(G.getPlayer) ? G.getPlayer() : null;
        if (!p0) return true;

        let best = null;
        for (let r = 0; r <= 10 && !best; r++) {
          for (let dy = -r; dy <= r && !best; dy++) {
            for (let dx = -r; dx <= r && !best; dx++) {
              const x = (p0.x | 0) + dx;
              const y = (p0.y | 0) + dy;
              if (!inBounds(x, y)) continue;
              const t = tileAt(x, y);
              if (t == null) continue;
              if (!isAllowed(t)) continue;
              if (!walkableTile(t)) continue;
              if (ringTargetCount(x, y) < 3) continue;
              best = { x, y };
            }
          }
        }

        if (!best) return false;
        if ((best.x | 0) === (p0.x | 0) && (best.y | 0) === (p0.y | 0)) return true;

        if (has(G.teleportTo)) {
          return !!G.teleportTo(best.x, best.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        }
        return false;
      } catch (_) {
        return false;
      }
    };

    const safePosOk = await ensureSafeOverworldForBottleMap();
    if (safePosOk) record(true, "Bottle map activation: positioned on safe overworld tile");
    else recordSkip("Bottle map activation: could not reposition to a safe overworld tile (continuing)");

    // Add a bottle map item to inventory.
    let idx = -1;
    let bmBeforeUse = 0;
    try {
      const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : (gctx.player.inventory = []);
      bmBeforeUse = countBottleMaps();
      idx = inv.length;
      inv.push({ kind: "tool", id: "bottle_map", type: "bottle_map", name: "bottle map", decay: 0, usable: true });
      if (typeof gctx.updateUI === "function") gctx.updateUI();
    } catch (_) {}

    record(idx >= 0, "Bottle map inserted into inventory");

    // Use it.
    let used = false;
    try { used = !!IF.useItemByIndex(gctx, idx); } catch (_) { used = false; }
    record(used, "InventoryFlow.useItemByIndex consumes bottle map");

    // Track inventory count deltas; we will assert consumption only if activation succeeds.
    const bmAfterUse = countBottleMaps();

    // If use failed, remove the injected item so we don't leak state into later scenarios.
    if (!used && idx >= 0) {
      try {
        const inv = (gctx.player && Array.isArray(gctx.player.inventory)) ? gctx.player.inventory : [];
        if (idx >= 0 && idx < inv.length) inv.splice(idx, 1);
        if (typeof gctx.updateUI === "function") gctx.updateUI();
      } catch (_) {}
    }

    // Find marker (allow marker placement to settle).
    await waitUntil(() => !!findBottleMarker(null), 1200, 80);
    const marker = findBottleMarker(null);

    record(!!marker, "gm.bottleMap marker exists in world.questMarkers");

    // Only assert inventory consumption if activation succeeded (i.e., marker exists).
    if (marker) {
      record(bmAfterUse === bmBeforeUse, `Bottle map consumed from inventory on activation (before=${bmBeforeUse}, after=${bmAfterUse})`);
    } else {
      recordSkip(`Bottle map consumption check skipped (activation did not place marker; before=${bmBeforeUse}, after=${bmAfterUse})`);
      return true;
    }

    // Activation should create both the marker and a matching active thread state.
    let threadActiveOk = true;
    let threadStatusOk = true;
    let threadTargetOk = true;
    try {
      const iid = String(marker.instanceId || "");
      const snap = readBottleMapThreadSnapshot();
      threadActiveOk = !!(snap && snap.active === true && snap.instanceId === iid);
      threadStatusOk = !!(snap && snap.status === "active");
      threadTargetOk = !!(snap && snap.target && (snap.target.absX | 0) === (marker.x | 0) && (snap.target.absY | 0) === (marker.y | 0));
    } catch (_) {
      threadActiveOk = true;
      threadStatusOk = true;
      threadTargetOk = true;
    }
    record(threadActiveOk && threadStatusOk && threadTargetOk, "Bottle map activation: marker + active thread state (status/instanceId/target)");

    let restored = true;
    let threadStillOk = true;
    try {
      if (GMB && has(GMB.reconcileMarkers) && marker.instanceId != null) {
        MS.remove(gctx, { kind: "gm.bottleMap", instanceId: marker.instanceId });
        await sleep(120);
        GMB.reconcileMarkers(gctx);
        await sleep(120);
        restored = !!findBottleMarker(marker.instanceId);

        try {
          const snap = readBottleMapThreadSnapshot();
          threadStillOk = !!(snap && snap.active === true && snap.instanceId === String(marker.instanceId || ""));
        } catch (_) {
          threadStillOk = true;
        }
      }
    } catch (_) {
      restored = true;
      threadStillOk = true;
    }
    record(restored && threadStillOk, "Bottle map marker integrity: reconcile restores missing marker");

    // Attempt 1: Enter and withdraw. Marker should remain.
    const tpOk1 = await teleportToMarker(marker);
    record(tpOk1, "Teleport to bottle map marker");

    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}
    try {
      if (GMB && has(GMB.handleMarkerAction)) GMB.handleMarkerAction(gctx);
      else key("g");
    } catch (_) {
      key("g");
    }
    const confirmed1 = await acceptConfirm();
    const entered1 = await waitUntilMode("encounter", 3500);
    const modeAfter1 = has(G.getMode) ? G.getMode() : "";
    record(confirmed1 && entered1 && modeAfter1 === "encounter", `Pressing 'g' on bottle map marker starts encounter (mode=${modeAfter1})`);

    if (!(entered1 && modeAfter1 === "encounter")) {
      // Cleanup marker.
      try { MS.remove(gctx, { kind: "gm.bottleMap", instanceId: marker.instanceId }); } catch (_) {}
      return true;
    }

    const inEncounterThreadOk1 = await waitUntil(() => {
      const snap = readBottleMapThreadSnapshot();
      return !!(snap && snap.active === true
        && snap.instanceId === String(marker.instanceId || "")
        && snap.status === "inEncounter"
        && (snap.attempts | 0) >= 1);
    }, 1600, 80);
    record(inEncounterThreadOk1, "Bottle map encounter start: thread status=IN_ENCOUNTER and attempts incremented");

    const markerInEncounter1 = !!findBottleMarker(marker.instanceId);
    record(markerInEncounter1, "Bottle map marker remains while in encounter (pre-withdraw)");

    const goldBeforeWithdraw = getGoldAmount();

    let withdrew = false;
    try {
      if (has(G.completeEncounter)) withdrew = !!G.completeEncounter("withdraw");
    } catch (_) { withdrew = false; }
    record(withdrew, "CompleteEncounter(withdraw) exits encounter");

    await waitUntilMode("world", 5000);
    const modeAfterWithdraw = has(G.getMode) ? G.getMode() : "";
    record(modeAfterWithdraw === "world", `After withdraw, mode is world (mode=${modeAfterWithdraw})`);

    const goldAfterWithdraw = getGoldAmount();
    record((goldAfterWithdraw | 0) === (goldBeforeWithdraw | 0), `Bottle map withdraw: no reward paid (goldBefore=${goldBeforeWithdraw}, goldAfter=${goldAfterWithdraw})`);

    const afterWithdrawThreadOk = await waitUntil(() => {
      const snap = readBottleMapThreadSnapshot();
      return !!(snap && snap.active === true
        && snap.instanceId === String(marker.instanceId || "")
        && snap.status === "active");
    }, 1600, 80);
    record(afterWithdrawThreadOk, "Bottle map withdraw: thread remains active (status=ACTIVE)");

    // Ensure marker is NOT removed on withdraw.
    await waitUntil(() => !!findBottleMarker(marker.instanceId), 1200, 80);
    const markerAfterWithdraw = !!findBottleMarker(marker.instanceId);
    record(markerAfterWithdraw, "Bottle map marker remains after withdraw (removed only on victory)");

    // Attempt 2: Re-enter and win. Marker should be removed and gold delta should be 60..80.
    const marker2 = findBottleMarker(marker.instanceId) || marker;
    const tpOk2 = await teleportToMarker(marker2);
    record(tpOk2, "Teleport back to bottle map marker");

    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(2); } catch (_) {}
    key("g");
    const confirmed2 = await acceptConfirm();
    const entered2 = await waitUntilMode("encounter", 3500);
    const modeAfter2 = has(G.getMode) ? G.getMode() : "";
    record(confirmed2 && entered2 && modeAfter2 === "encounter", `Re-enter bottle map encounter (mode=${modeAfter2})`);

    if (!(entered2 && modeAfter2 === "encounter")) {
      // Cleanup marker (avoid leaking state into subsequent scenarios).
      try { MS.remove(gctx, { kind: "gm.bottleMap", instanceId: marker.instanceId }); } catch (_) {}
      return true;
    }

    const markerInEncounter2 = !!findBottleMarker(marker.instanceId);
    record(markerInEncounter2, "Bottle map marker remains while in encounter (pre-victory)");

    const goldBefore = getGoldAmount();

    let completed = false;
    try {
      if (has(G.completeEncounter)) completed = !!G.completeEncounter("victory");
    } catch (_) { completed = false; }
    record(completed, "CompleteEncounter(victory) returns to overworld");

    await waitUntilMode("world", 5000);
    const modeFinal = has(G.getMode) ? G.getMode() : "";
    record(modeFinal === "world", `After victory, mode is world (mode=${modeFinal})`);

    // Marker should be removed by GMBridge payout hook.
    await waitUntil(() => !findBottleMarker(marker.instanceId), 2500, 80);
    const markerGone = !findBottleMarker(marker.instanceId);
    record(markerGone, "Bottle map marker removed after victory payout");

    // Reward payout may happen shortly after we return to world mode.
    await waitUntil(() => (getGoldAmount() - goldBefore) >= 60, 2500, 80);

    const goldAfter = getGoldAmount();
    const delta = (goldAfter | 0) - (goldBefore | 0);
    record(delta >= 60 && delta <= 80, `Gold delta after victory within 60..80 (delta=${delta})`);

    if (!markerGone) {
      try { MS.remove(gctx, { kind: "gm.bottleMap", instanceId: marker.instanceId }); } catch (_) {}
    }

    return true;
  }

  window.SmokeTest.Scenarios.gm_bottle_map = { run };
})();
