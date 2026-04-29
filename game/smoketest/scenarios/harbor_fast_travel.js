(function () {
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
    if (!G || !has(G.getCtx) || !has(G.getMode) || !has(G.nearestTown)) {
      recordSkip("Harbor fast travel skipped (GameAPI helpers unavailable)");
      return true;
    }

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
      const opened = await waitUntil(() => isConfirmOpen(), 2000, 80);
      if (!opened) return false;
      try { key("Enter"); } catch (_) {}
      return await waitUntil(() => !isConfirmOpen(), 2000, 80);
    };

    async function ensureWorldMode() {
      try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}
      let mode = "";
      try { mode = has(G.getMode) ? G.getMode() : ""; } catch (_) {}
      if (mode === "world") return true;
      try {
        if (mode === "town") {
          if (has(G.leaveTownNow)) G.leaveTownNow();
        } else if (mode === "encounter" && has(G.completeEncounter)) {
          G.completeEncounter("withdraw");
        } else if (mode === "dungeon" && has(G.returnToWorldIfAtExit)) {
          G.returnToWorldIfAtExit();
        }
      } catch (_) {}
      await waitUntilMode("world", 2500);
      try { return G.getMode() === "world"; } catch (_) { return false; }
    }

    const okWorld = await ensureWorldMode();
    if (!okWorld) {
      recordSkip("Harbor fast travel skipped (not in world mode)");
      return true;
    }

    const worldCtx = G.getCtx();
    const WT = worldCtx && worldCtx.World ? worldCtx.World.TILES : null;
    if (!WT || !worldCtx || !Array.isArray(worldCtx.world?.towns)) {
      recordSkip("Harbor fast travel skipped (world state unavailable)");
      return true;
    }

    const nearestTown = G.nearestTown();
    record(!!nearestTown, "Found nearest town in current world window");
    if (!nearestTown) return true;

    const originAbsX = (worldCtx.world.originX | 0) + (nearestTown.x | 0);
    const originAbsY = (worldCtx.world.originY | 0) + (nearestTown.y | 0);
    const originTown = worldCtx.world.towns.find(t =>
      t &&
      (t.x | 0) === originAbsX &&
      (t.y | 0) === originAbsY
    ) || null;
    record(!!originTown, "Found harbor town target in overworld");
    if (!originTown) return true;

    originTown.harborDir = "E";
    originTown.harborWater = "coast";
    for (let step = 1; step <= 2; step++) {
      const wx = (nearestTown.x | 0) + step;
      const wy = nearestTown.y | 0;
      if (worldCtx.map[wy] && typeof worldCtx.map[wy][wx] !== "undefined") {
        worldCtx.map[wy][wx] = WT.WATER;
        worldCtx.world.map[wy][wx] = WT.WATER;
      }
    }
    record(true, "Marked nearest town as a deterministic harbor origin");

    let destinationTown = worldCtx.world.towns.find(t => t && t !== originTown && t.harborDir) || null;
    if (!destinationTown) {
      let seeded = false;
      const candidates = [
        { x: (nearestTown.x | 0) + 8, y: nearestTown.y | 0 },
        { x: (nearestTown.x | 0) - 8, y: nearestTown.y | 0 },
        { x: nearestTown.x | 0, y: (nearestTown.y | 0) + 8 },
        { x: nearestTown.x | 0, y: (nearestTown.y | 0) - 8 },
      ];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.x < 2 || c.y < 2 || c.y >= worldCtx.map.length - 2 || c.x >= (worldCtx.map[0] ? worldCtx.map[0].length - 2 : 0)) continue;
        const absX = (worldCtx.world.originX | 0) + c.x;
        const absY = (worldCtx.world.originY | 0) + c.y;
        const already = worldCtx.world.towns.some(t => t && (t.x | 0) === absX && (t.y | 0) === absY);
        if (already) continue;
        worldCtx.map[c.y][c.x] = WT.TOWN;
        worldCtx.world.map[c.y][c.x] = WT.TOWN;
        for (let step = 1; step <= 2; step++) {
          const wx = c.x + step;
          if (worldCtx.map[c.y] && typeof worldCtx.map[c.y][wx] !== "undefined") {
            worldCtx.map[c.y][wx] = WT.WATER;
            worldCtx.world.map[c.y][wx] = WT.WATER;
          }
        }
        destinationTown = {
          x: absX,
          y: absY,
          size: "small",
          kind: "town",
          name: "Smokeport",
          harborDir: "E",
          harborWater: "coast"
        };
        worldCtx.world.towns.push(destinationTown);
        seeded = true;
        break;
      }
      record(seeded, "Seeded fallback harbor destination for smoke");
      if (!seeded) return true;
    } else {
      record(true, "Existing secondary harbor destination found");
    }

    if (has(G.teleportTo)) {
      G.teleportTo(nearestTown.x, nearestTown.y, { ensureWalkable: false, fallbackScanRadius: 0 });
    }
    if (has(G.enterTownIfOnTile)) G.enterTownIfOnTile();
    await waitUntilMode("town", 2500);
    const townCtx = G.getCtx();
    const inTown = G.getMode() === "town";
    const currentTownRec = inTown && townCtx.worldReturnPos && Array.isArray(townCtx.world?.towns)
      ? townCtx.world.towns.find(t =>
          t &&
          (t.x | 0) === (townCtx.worldReturnPos.x | 0) &&
          (t.y | 0) === (townCtx.worldReturnPos.y | 0)
        )
      : null;
    const harborTown = inTown && !!(
      townCtx.townKind === "port" ||
      townCtx.townHarborDir ||
      (currentTownRec && (currentTownRec.kind === "port" || currentTownRec.harborDir))
    );
    record(harborTown, "Entered harbor town");
    if (!harborTown) return true;

    try { if (typeof ensureAllModalsClosed === "function") await ensureAllModalsClosed(4); } catch (_) {}

    const captain = Array.isArray(townCtx.npcs)
      ? townCtx.npcs.find(n => n && n.isHarborCaptain)
      : null;
    record(!!captain, "Harbor captain NPC spawned");
    if (!captain) return true;

    if (has(G.addGold)) G.addGold(500);
    const goldBefore = has(G.getGold) ? G.getGold() : 0;
    const originReturn = townCtx.worldReturnPos ? { x: townCtx.worldReturnPos.x | 0, y: townCtx.worldReturnPos.y | 0 } : null;

    let movedNextToCaptain = false;
    const adj = [
      { x: (captain.x | 0) + 1, y: captain.y | 0 },
      { x: (captain.x | 0) - 1, y: captain.y | 0 },
      { x: captain.x | 0, y: (captain.y | 0) + 1 },
      { x: captain.x | 0, y: (captain.y | 0) - 1 }
    ];
    for (let i = 0; i < adj.length; i++) {
      if (has(G.teleportTo) && G.teleportTo(adj[i].x, adj[i].y, { ensureWalkable: true, fallbackScanRadius: 1 })) {
        movedNextToCaptain = true;
        break;
      }
    }
    record(movedNextToCaptain, "Moved adjacent to harbor captain");
    if (!movedNextToCaptain) return true;

    const TR = townCtx.TownRuntime || (typeof window !== "undefined" ? window.TownRuntime : null);
    let talkOpened = false;
    try {
      if (TR && typeof TR.talk === "function") {
        talkOpened = !!TR.talk(townCtx, captain.x | 0, captain.y | 0);
      }
    } catch (_) {}
    if (!talkOpened) {
      const dx = Math.sign((captain.x | 0) - (G.getPlayer().x | 0));
      const dy = Math.sign((captain.y | 0) - (G.getPlayer().y | 0));
      key(dx === -1 ? "ArrowLeft" : dx === 1 ? "ArrowRight" : (dy === -1 ? "ArrowUp" : "ArrowDown"));
    }

    const confirmed = await acceptConfirm();
    record(confirmed, "Harbor captain opens confirm dialog");
    if (!confirmed) return true;

    const moved = await waitUntil(() => {
      try {
        const c = G.getCtx();
        const ret = c && c.worldReturnPos ? { x: c.worldReturnPos.x | 0, y: c.worldReturnPos.y | 0 } : null;
        return !!(ret && originReturn && (ret.x !== originReturn.x || ret.y !== originReturn.y) && G.getMode() === "town");
      } catch (_) {
        return false;
      }
    }, 5000, 100);

    const afterCtx = G.getCtx();
    const goldAfter = has(G.getGold) ? G.getGold() : goldBefore;
    const afterReturn = afterCtx && afterCtx.worldReturnPos ? { x: afterCtx.worldReturnPos.x | 0, y: afterCtx.worldReturnPos.y | 0 } : null;
    const destinationRec = afterCtx && afterCtx.worldReturnPos && Array.isArray(afterCtx.world?.towns)
      ? afterCtx.world.towns.find(t =>
          t &&
          (t.x | 0) === (afterCtx.worldReturnPos.x | 0) &&
          (t.y | 0) === (afterCtx.worldReturnPos.y | 0)
        )
      : null;
    const destinationIsHarbor = !!(
      afterCtx &&
      (
        afterCtx.townKind === "port" ||
        afterCtx.townHarborDir ||
        (destinationRec && (destinationRec.kind === "port" || destinationRec.harborDir))
      )
    );

    record(moved, "Harbor travel completed");
    record(goldAfter === goldBefore - 200, `Harbor fare charged exactly once (before=${goldBefore}, after=${goldAfter})`);
    record(!!(afterReturn && originReturn && (afterReturn.x !== originReturn.x || afterReturn.y !== originReturn.y)), "Destination harbor differs from origin");
    record(destinationIsHarbor, "Arrived in another harbor town");

    return true;
  }

  window.SmokeTest.Scenarios.HarborFastTravel = { run };
  window.SmokeTest.Scenarios.harbor_fast_travel = { run };
})();
