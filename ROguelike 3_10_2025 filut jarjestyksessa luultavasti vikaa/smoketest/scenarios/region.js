(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    const record = ctx.record || function () {};
    const recordSkip = ctx.recordSkip || function () {};
    const sleep = ctx.sleep || (ms => new Promise(r => setTimeout(r, ms | 0)));

    try {
      const G = window.GameAPI || {};
      const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;
      const getWorld = (typeof G.getWorld === "function") ? () => G.getWorld() : () => null;
      const getPlayer = (typeof G.getPlayer === "function") ? () => G.getPlayer() : () => ({ x: 0, y: 0 });

      const keypress = async (code, waitMs) => {
        try {
          if (typeof ctx.key === "function") {
            ctx.key(code);
          } else {
            const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
            try { window.dispatchEvent(ev); } catch (_) {}
            try { document.dispatchEvent(ev); } catch (_) {}
          }
        } catch (_) {}
        await sleep(waitMs | 0);
      };

      // Preconditions
      if (getMode() !== "world") {
        recordSkip("Region scenario skipped (not in world)");
        return true;
      }

      // Ensure we're standing on a valid overworld tile for Region Map
      const W = window.World || {};
      const WT = W.TILES || {};
      const world = getWorld();
      let p = getPlayer();

      const inBounds = (x, y) => {
        const H = world && world.map ? world.map.length : 0;
        const Ww = H ? (world.map[0] ? world.map[0].length : 0) : 0;
        return (x >= 0 && y >= 0 && x < Ww && y < H);
      };
      const tileAt = (x, y) => (inBounds(x, y) ? world.map[y][x] : null);
      const isWalkable = (t) => {
        try { return typeof W.isWalkable === "function" ? !!W.isWalkable(t) : true; } catch (_) { return true; }
      };
      const isAllowedForRegion = (t) => {
        // Disallow towns/dungeons; allow other walkables (RUINS allowed)
        if (t === WT.TOWN || t === WT.DUNGEON) return false;
        return isWalkable(t);
      };

      let here = tileAt(p.x, p.y);
      if (!isAllowedForRegion(here)) {
        // Try a single-step nudge to a neighboring allowed tile (cardinals)
        const dirs = [
          { key: "ArrowLeft", dx: -1, dy: 0 },
          { key: "ArrowRight", dx: 1, dy: 0 },
          { key: "ArrowUp", dx: 0, dy: -1 },
          { key: "ArrowDown", dx: 0, dy: 1 },
        ];
        let moved = false;
        for (const d of dirs) {
          const nx = p.x + d.dx, ny = p.y + d.dy;
          if (!inBounds(nx, ny)) continue;
          const t = tileAt(nx, ny);
          if (!isAllowedForRegion(t)) continue;
          await keypress(d.key, 140);
          const p2 = getPlayer();
          if (p2.x === nx && p2.y === ny) {
            moved = true;
            p = p2;
            break;
          }
        }
        if (!moved) {
          recordSkip("Region scenario skipped (no allowed neighboring overworld tile)");
          return true;
        }
      }

      // Open Region Map
      let opened = false;
      try {
        if (typeof G.openRegionMap === "function") {
          opened = !!G.openRegionMap();
          await sleep(220);
        }
      } catch (_) {}

      if (!opened && getMode() !== "region") {
        // Fallback: press 'g'
        await keypress("g", 260);
        // Small fallback: try again once if mode did not change
        if (getMode() !== "region") {
          await keypress("g", 300);
        }
      }

      if (getMode() !== "region") {
        record(false, "Region open failed (mode stayed in world)");
        return false;
      }
      record(true, "Region open: OK");

      // Move to a valid exit tile inside Region Map (orange edge exit), then press 'g' to close
      try {
        const ctxG = (typeof G.getCtx === "function") ? G.getCtx() : null;
        const region = (ctxG && ctxG.region) ? ctxG.region : null;
        const width = (region && typeof region.width === "number") ? (region.width | 0) : 0;
        const height = (region && typeof region.height === "number") ? (region.height | 0) : 0;

        // RegionMapRuntime exposes explicit exit tiles; use them.
        let exits = (region && Array.isArray(region.exitTiles)) ? region.exitTiles : null;
        if (!exits || !exits.length) {
          // Fallback to the 4 canonical exits described in RegionMapRuntime docs.
          exits = [
            { x: (width / 2) | 0, y: 0 },
            { x: (width / 2) | 0, y: Math.max(0, height - 1) },
            { x: 0, y: (height / 2) | 0 },
            { x: Math.max(0, width - 1), y: (height / 2) | 0 },
          ];
        }

        const cur0 = getPlayer();
        // Choose nearest exit by manhattan distance.
        let target = exits[0];
        let bestD = Infinity;
        for (let i = 0; i < exits.length; i++) {
          const ex = exits[i];
          const d = Math.abs((ex.x | 0) - (cur0.x | 0)) + Math.abs((ex.y | 0) - (cur0.y | 0));
          if (d < bestD) { bestD = d; target = ex; }
        }

        const maxSteps = 240;
        let steps = 0;
        while (getMode() === "region" && steps < maxSteps) {
          const cur = getPlayer();
          if ((cur.x | 0) === (target.x | 0) && (cur.y | 0) === (target.y | 0)) break;
          let pressed = false;
          if (cur.x > target.x) { await keypress("ArrowLeft", 60); pressed = true; }
          else if (cur.x < target.x) { await keypress("ArrowRight", 60); pressed = true; }
          else if (cur.y > target.y) { await keypress("ArrowUp", 60); pressed = true; }
          else if (cur.y < target.y) { await keypress("ArrowDown", 60); pressed = true; }
          if (!pressed) break;
          steps++;
        }

        // Press 'g' on the designated exit tile to close.
        await keypress("g", 260);
        if (getMode() !== "world") {
          // Some browsers need a second key event.
          await keypress("g", 320);
        }

        const okExit = (getMode() === "world");
        record(okExit, okExit ? "Region exit: OK" : "Region exit failed (mode not world)");
      } catch (e) {
        record(false, "Region movement/exit failed: " + (e && e.message ? e.message : String(e)));
        return false;
      }

      return true;
    } catch (e) {
      record(false, "Region scenario failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  window.SmokeTest.Scenarios.Region = { run };
})();