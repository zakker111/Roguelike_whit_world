(function () {
  // SmokeTest Scenario: GM boredom relief on exploration milestones
  // Verifies that entering town/dungeon/ruins and encounter enter/exit provide
  // meaningful boredom relief (not just minor telemetry).

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, Math.max(0, ms | 0))));

    const G = (typeof window !== "undefined") ? (window.GameAPI || null) : null;
    const GM = (typeof window !== "undefined") ? (window.GMRuntime || null) : null;

    if (!G || !has(G.getCtx) || !GM || !has(GM.getState) || !has(GM.onEvent)) {
      recordSkip("GM boredom milestones skipped (GameAPI.getCtx or GMRuntime.getState/onEvent missing)");
      return true;
    }

    const Teleport = (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Teleport) || null;

    async function waitUntilMode(target, timeoutMs) {
      const deadline = Date.now() + Math.max(250, timeoutMs | 0);
      while (Date.now() < deadline) {
        try {
          if (has(G.getMode) && G.getMode() === target) return true;
        } catch (_) {}
        await sleep(80);
      }
      try { return has(G.getMode) && G.getMode() === target; } catch (_) { return false; }
    }

    function getGmFromLiveCtx() {
      try {
        const c = G.getCtx();
        if (!c) return null;
        return GM.getState(c);
      } catch (_) {
        return null;
      }
    }

    function forceBoredom(turns) {
      const gm = getGmFromLiveCtx();
      if (!gm) return false;
      gm.enabled = true;
      if (!gm.boredom || typeof gm.boredom !== "object") gm.boredom = {};
      gm.boredom.turnsSinceLastInterestingEvent = (turns | 0);
      gm.boredom.lastInterestingEvent = null;
      gm.boredom.lastNudgeTurn = -999999;
      return true;
    }

    function snapshotTurns() {
      const gm = getGmFromLiveCtx();
      if (!gm || !gm.boredom) return null;
      return gm.boredom.turnsSinceLastInterestingEvent | 0;
    }

    function snapshotLastTier() {
      const gm = getGmFromLiveCtx();
      try {
        const ev = gm && gm.debug && gm.debug.lastEvent ? gm.debug.lastEvent : null;
        const tier = ev && typeof ev.interestTier === "string" ? ev.interestTier : null;
        return tier;
      } catch (_) {
        return null;
      }
    }

    function assertSignificant(label, beforeTurns, afterTurns) {
      const delta = (beforeTurns | 0) - (afterTurns | 0);
      // With interestTier:"medium" the runtime applies a ~30% partial nudge.
      // From a 150 baseline this should reduce by ~45 turns.
      const ok = delta >= 30;
      record(ok, `${label}: boredom relief delta >= 30 turns (${beforeTurns} -> ${afterTurns}, delta=${delta})`);
      const tier = snapshotLastTier();
      record(tier === "medium" || tier === "major", `${label}: last interestTier is medium/major (got ${tier})`);
    }

    // Ensure we start in overworld.
    try {
      if (has(G.getMode) && G.getMode() !== "world" && has(G.forceWorld)) {
        G.forceWorld();
        await waitUntilMode("world", 4000);
      }
    } catch (_) {}

    if (!has(G.getMode) || G.getMode() !== "world") {
      recordSkip("GM boredom milestones skipped (not in world)");
      return true;
    }

    // --- Town entry ---
    try {
      forceBoredom(150);
      const before = snapshotTurns();
      if (before == null) {
        recordSkip("GM boredom milestones skipped (GM boredom state missing)");
        return true;
      }

      if (has(G.gotoNearestTown)) await G.gotoNearestTown();
      if (has(G.enterTownIfOnTile)) G.enterTownIfOnTile();
      await waitUntilMode("town", 8000);

      const after = snapshotTurns();
      if (has(G.getMode) && G.getMode() === "town" && after != null) {
        assertSignificant("Town entry", before, after);
      } else {
        record(false, "Town entry: failed to enter town");
        return false;
      }

      // Exit town back to world.
      if (Teleport && has(Teleport.teleportToGateAndExit)) {
        await Teleport.teleportToGateAndExit(ctx, { closeModals: true, waitMs: 650 });
        await waitUntilMode("world", 6000);
      } else if (has(G.returnToWorldFromTown)) {
        G.returnToWorldFromTown();
        await waitUntilMode("world", 6000);
      }
    } catch (e) {
      record(false, "Town milestones failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }

    // --- Dungeon entry ---
    try {
      if (!has(G.getMode) || G.getMode() !== "world") {
        recordSkip("Dungeon milestones skipped (not back in world)");
      } else {
        forceBoredom(150);
        const before = snapshotTurns();
        if (has(G.gotoNearestDungeon)) await G.gotoNearestDungeon();
        if (has(G.enterDungeonIfOnEntrance)) G.enterDungeonIfOnEntrance();
        await waitUntilMode("dungeon", 8000);

        const after = snapshotTurns();
        if (has(G.getMode) && G.getMode() === "dungeon" && after != null) {
          assertSignificant("Dungeon entry", before, after);
        } else {
          record(false, "Dungeon entry: failed to enter dungeon");
          return false;
        }

        // Exit dungeon back to world.
        if (Teleport && has(Teleport.teleportToDungeonExitAndLeave)) {
          await Teleport.teleportToDungeonExitAndLeave(ctx, { closeModals: true, waitMs: 650 });
          await waitUntilMode("world", 8000);
        } else if (has(G.returnToWorldIfAtExit)) {
          G.returnToWorldIfAtExit();
          await waitUntilMode("world", 8000);
        }
      }
    } catch (e) {
      record(false, "Dungeon milestones failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }

    // --- Ruins entry (best-effort, may not exist in current chunk) ---
    try {
      if (has(G.getMode) && G.getMode() === "world") {
        const ctxG = G.getCtx();
        const world = has(G.getWorld) ? G.getWorld() : null;
        const WT = (window.World && window.World.TILES) ? window.World.TILES : null;
        const ruinsTile = WT ? WT.RUINS : null;
        let found = null;

        if (world && Array.isArray(world.map) && world.map.length && ruinsTile != null) {
          const p = has(G.getPlayer) ? G.getPlayer() : { x: 0, y: 0 };
          const H = world.map.length;
          const W = world.map[0] ? world.map[0].length : 0;
          const maxR = 16;
          for (let r = 0; r <= maxR && !found; r++) {
            for (let dy = -r; dy <= r && !found; dy++) {
              const y = (p.y | 0) + dy;
              if (y < 0 || y >= H) continue;
              for (let dx = -r; dx <= r; dx++) {
                const x = (p.x | 0) + dx;
                if (x < 0 || x >= W) continue;
                if (world.map[y][x] === ruinsTile) {
                  found = { x, y };
                  break;
                }
              }
            }
          }
        }

        if (!found) {
          recordSkip("Ruins milestones skipped (no RUINS tile found near player)");
        } else {
          forceBoredom(150);
          const before = snapshotTurns();

          // Land on the RUINS tile and enter.
          if (has(G.teleportTo)) {
            G.teleportTo(found.x, found.y, { ensureWalkable: false, fallbackScanRadius: 0 });
            await sleep(120);
          }
          const Modes = window.Modes || null;
          if (Modes && has(Modes.enterRuinsIfOnTile) && ctxG) {
            Modes.enterRuinsIfOnTile(ctxG);
          }
          await waitUntilMode("region", 8000);

          const after = snapshotTurns();
          if (has(G.getMode) && G.getMode() === "region" && after != null) {
            assertSignificant("Ruins entry", before, after);
          } else {
            record(false, "Ruins entry: failed to enter ruins/region");
            return false;
          }

          // Exit region back to world by pressing 'g' twice.
          try {
            if (ctx && has(ctx.key)) {
              ctx.key("g");
              await sleep(250);
              ctx.key("g");
              await sleep(350);
            }
          } catch (_) {}

          if (has(G.getMode) && G.getMode() !== "world" && has(G.forceWorld)) {
            G.forceWorld();
          }
          await waitUntilMode("world", 6000);
        }
      }
    } catch (e) {
      record(false, "Ruins milestones failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }

    // --- Encounter enter/exit ---
    try {
      if (has(G.getMode) && G.getMode() !== "world") {
        recordSkip("Encounter milestones skipped (not in world)");
        return true;
      }

      forceBoredom(150);
      const beforeEnter = snapshotTurns();

      if (has(G.enterEncounter)) {
        G.enterEncounter(null, "FOREST");
      }
      await waitUntilMode("encounter", 8000);
      const afterEnter = snapshotTurns();
      if (has(G.getMode) && G.getMode() === "encounter" && afterEnter != null) {
        assertSignificant("Encounter enter", beforeEnter, afterEnter);
      } else {
        record(false, "Encounter enter: failed to enter encounter");
        return false;
      }

      forceBoredom(150);
      const beforeExit = snapshotTurns();

      if (has(G.completeEncounter)) {
        G.completeEncounter("withdraw");
      }
      await waitUntilMode("world", 8000);
      const afterExit = snapshotTurns();
      if (has(G.getMode) && G.getMode() === "world" && afterExit != null) {
        assertSignificant("Encounter exit", beforeExit, afterExit);
      } else {
        record(false, "Encounter exit: failed to return to world");
        return false;
      }
    } catch (e) {
      record(false, "Encounter milestones failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }

    return true;
  }

  window.SmokeTest.Scenarios.gm_boredom_milestones = { run };
})();
