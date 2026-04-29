(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    const record = ctx.record || function () {};
    const recordSkip = ctx.recordSkip || function () {};
    const sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms | 0)));

    async function waitForMode(target, timeoutMs) {
      const end = Date.now() + Math.max(0, timeoutMs | 0);
      while (Date.now() < end) {
        try {
          if (typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === target) return true;
        } catch { /* ignore transient mode-read errors while waiting */ }
        await sleep(50);
      }
      try { return typeof window.GameAPI.getMode === "function" && window.GameAPI.getMode() === target; } catch { return false; }
    }

    async function waitUntil(fn, timeoutMs) {
      const end = Date.now() + Math.max(0, timeoutMs | 0);
      while (Date.now() < end) {
        try { if (fn()) return true; } catch { /* ignore transient predicate errors while waiting */ }
        await sleep(50);
      }
      try { return !!fn(); } catch { return false; }
    }

    function isWalkableTile(WorldMod, tile) {
      try {
        return WorldMod && typeof WorldMod.isWalkable === "function" ? !!WorldMod.isWalkable(tile) : true;
      } catch {
        return true;
      }
    }

    function findInteriorLootTile(region, WorldMod) {
      if (!region || !Array.isArray(region.map) || !region.map.length) return null;
      const map = region.map;
      const h = map.length;
      const w = map[0] ? map[0].length : 0;
      const exits = Array.isArray(region.exitTiles) ? region.exitTiles : [];
      const isExit = (x, y) => exits.some(e => e && (e.x | 0) === (x | 0) && (e.y | 0) === (y | 0));
      const cx = (region.width / 2) | 0;
      const cy = (region.height / 2) | 0;
      for (let r = 0; r < Math.max(w, h); r++) {
        for (let y = Math.max(1, cy - r); y < Math.min(h - 1, cy + r + 1); y++) {
          for (let x = Math.max(1, cx - r); x < Math.min(w - 1, cx + r + 1); x++) {
            if (isExit(x, y)) continue;
            if (!isWalkableTile(WorldMod, map[y][x])) continue;
            return { x, y };
          }
        }
      }
      return null;
    }

    try {
      const G = window.GameAPI || {};
      const RM = (typeof window !== "undefined") ? window.RegionMapRuntime : null;
      const Logger = (typeof window !== "undefined") ? window.Logger : null;
      const WorldMod = (typeof window !== "undefined") ? window.World : null;
      const logEl = (typeof document !== "undefined") ? document.getElementById("log") : null;
      const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;

      if (typeof G.getCtx !== "function" || typeof G.openRegionMap !== "function" || typeof G.applyCtxSyncAndRefresh !== "function" || !RM || typeof RM.onAction !== "function" || typeof RM.close !== "function") {
        recordSkip("Region scenario skipped (region runtime hooks unavailable)");
        return true;
      }

      if (typeof G.forceWorld === "function" && getMode() !== "world") {
        try { G.forceWorld(); } catch { /* forceWorld is optional in some harness states */ }
        await waitForMode("world", 4000);
      }

      const opened = !!G.openRegionMap();
      if (!opened || !(await waitForMode("region", 4000))) {
        record(false, "Region open failed (mode=" + (getMode() || "unknown") + ")");
        return false;
      }
      record(true, "Region open: OK");

      const liveCtx = G.getCtx();
      const region = liveCtx && liveCtx.region ? liveCtx.region : null;
      const testTile = findInteriorLootTile(region, WorldMod);
      if (!region || !testTile) {
        recordSkip("Region mixed loot regression skipped (no interior walkable tile found)");
        const closed = !!RM.close(G.getCtx());
        if (closed) await waitForMode("world", 4000);
        return true;
      }

      const testX = testTile.x | 0;
      const testY = testTile.y | 0;
      const patchCtx = G.getCtx();
      patchCtx.player.x = testX;
      patchCtx.player.y = testY;
      patchCtx.region.cursor.x = testX;
      patchCtx.region.cursor.y = testY;
      patchCtx.corpses = [
        { kind: "corpse", x: testX, y: testY, looted: false, _examined: true, loot: [{ kind: "gold", amount: 1, name: "gold" }], meta: { victim: "bandit" } },
        { kind: "chest", x: testX, y: testY, looted: false, _examined: true, loot: [{ kind: "gold", amount: 2, name: "gold" }] }
      ];
      G.applyCtxSyncAndRefresh(patchCtx);

      const settled = await waitUntil(() => {
        try {
          const c = G.getCtx();
          const cursor = c && c.region ? c.region.cursor : null;
          const corpses = (typeof G.getCorpses === "function") ? (G.getCorpses() || []) : [];
          return !!(cursor && (cursor.x | 0) === testX && (cursor.y | 0) === testY && corpses.filter(v => v && (v.x | 0) === testX && (v.y | 0) === testY).length >= 2);
        } catch {
          return false;
        }
      }, 1200);
      if (!settled) {
        record(false, "Region mixed loot regression failed: injected state did not settle");
        return false;
      }

      try {
        if (Logger && typeof Logger.clear === "function") Logger.clear();
        else if (logEl) logEl.textContent = "";
      } catch { /* clearing the log is best-effort for the smoke assertion */ }
      await sleep(80);

      const acted = !!RM.onAction(G.getCtx());
      await sleep(200);
      const logText = logEl ? String(logEl.textContent || "") : "";
      const afterLoot = (typeof G.getCorpses === "function") ? (G.getCorpses() || []) : [];
      const sameTileAfterLoot = afterLoot.filter(c => c && (c.x | 0) === testX && (c.y | 0) === testY);
      const lootedAll = sameTileAfterLoot.length >= 2 && sameTileAfterLoot.every(c => !!c.looted && (c.lootCount | 0) === 0);
      const lootLogged = logText.includes("You loot:");
      const mislabeled = logText.includes("You open the chest.") || logText.includes("You open the chests.");
      const mixedLootOk = acted && lootLogged && lootedAll && !mislabeled;
      record(mixedLootOk, "Region mixed loot: corpse+chest underfoot avoids chest-only wording");
      if (!mixedLootOk) return false;

      const closed = !!RM.close(G.getCtx());
      if (!closed || !(await waitForMode("world", 4000))) {
        recordSkip("Region persistence check skipped (region close failed before reload)");
      } else {
        const reopened = !!G.openRegionMap();
        if (!reopened || !(await waitForMode("region", 4000))) {
          record(false, "Region persistence reopen failed (mode=" + (getMode() || "unknown") + ")");
          return false;
        }
        const restored = await waitUntil(() => {
          try {
            const corpses = (typeof G.getCorpses === "function") ? (G.getCorpses() || []) : [];
            const sameTile = corpses.filter(c => c && (c.x | 0) === testX && (c.y | 0) === testY);
            return sameTile.length >= 2
              && sameTile.some(c => String(c.kind || "").toLowerCase() === "chest")
              && sameTile.some(c => String(c.kind || "").toLowerCase() === "corpse")
              && sameTile.every(c => !!c.looted && (c.lootCount | 0) === 0);
          } catch {
            return false;
          }
        }, 1200);
        record(restored, "Region persistence preserves chest kind after reopen");
        if (!restored) return false;
      }

      const okExit = !!RM.close(G.getCtx());
      if (!okExit || !(await waitForMode("world", 4000))) {
        record(false, "Region exit failed (mode=" + (getMode() || "unknown") + ")");
        return false;
      }
      record(true, "Region exit: OK");
      return true;
    } catch (e) {
      record(false, "Region scenario failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  window.SmokeTest.Scenarios.Region = { run };
})();
