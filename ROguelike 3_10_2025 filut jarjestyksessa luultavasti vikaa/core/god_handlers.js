/**
 * GOD UI Handlers: builds GOD-mode handler functions wired to ctx and modules.
 *
 * buildGodHandlers(getCtx, helpers) -> { ...handlers }
 * helpers: {
 *   setFovRadius(v), requestDraw(), setAlwaysCrit(v), setCritPart(part),
 *   applySeed(seed), rerollSeed(), requestLeaveTown()
 * }
 */
import * as God from '../data/god.js';

export function buildGodHandlers(getCtx, helpers = {}) {
  const h = Object.assign({
    setFovRadius: (v) => {},
    requestDraw: () => {},
    setAlwaysCrit: (v) => {},
    setCritPart: (part) => {},
    applySeed: (seed) => {},
    rerollSeed: () => {},
    requestLeaveTown: () => {},
  }, helpers);

  return {
    onGodHeal: () => God.heal(getCtx()),
    onGodSpawn: () => God.spawnItems(getCtx()),
    onGodSpawnEnemy: () => God.spawnEnemyNearby(getCtx()),
    onGodSpawnStairs: () => God.spawnStairsHere(getCtx()),
    onGodSetFov: (v) => h.setFovRadius(v),
    onGodToggleGrid: (v) => {
      // UI already persists window.DRAW_GRID; just request a redraw
      try { h.requestDraw(); } catch (_) {}
    },
    onGodSetAlwaysCrit: (v) => h.setAlwaysCrit(!!v),
    onGodSetCritPart: (part) => h.setCritPart(part),
    onGodApplySeed: (seed) => h.applySeed(seed),
    onGodRerollSeed: () => h.rerollSeed(),
    onTownExit: () => h.requestLeaveTown(),
    onGodCheckHomes: () => {
      const ctx = getCtx();
      if (ctx.mode !== "town") {
        ctx.log("Home route check is available in town mode only.", "warn");
        h.requestDraw();
        return;
      }
      try {
        // Ensure town NPCs are populated before running the check
        if ((!Array.isArray(ctx.npcs) || ctx.npcs.length === 0) && window.TownAI && typeof TownAI.populateTown === "function") {
          TownAI.populateTown(ctx);
          // Sync back any mutations
          if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV();
        }
      } catch (_) {}

      if (window.TownAI && typeof TownAI.checkHomeRoutes === "function") {
        const res = TownAI.checkHomeRoutes(ctx) || {};
        const totalChecked = (typeof res.total === "number")
          ? res.total
          : ((res.reachable || 0) + (res.unreachable || 0));
        const skippedStr = res.skipped ? `, ${res.skipped} skipped` : "";
        const summaryLine = `Home route check: ${(res.reachable || 0)}/${totalChecked} reachable, ${(res.unreachable || 0)} unreachable${skippedStr}.`;
        ctx.log(summaryLine, (res.unreachable || 0) ? "warn" : "good");
        let extraLines = [];
        if (res.residents && typeof res.residents.total === "number") {
          const r = res.residents;
          extraLines.push(`Residents: ${r.atHome}/${r.total} at home, ${r.atTavern}/${r.total} at inn.`);
        } else {
          extraLines.push("No residents were counted; ensure town NPCs are populated.");
        }
        if (Array.isArray(res.residentsAwayLate) && res.residentsAwayLate.length) {
          extraLines.push(`Late-night (02:00–05:00): ${res.residentsAwayLate.length} resident(s) away from home and inn:`);
          res.residentsAwayLate.slice(0, 10).forEach(d => {
            extraLines.push(`- ${d.name} at (${d.x},${d.y})`);
          });
          if (res.residentsAwayLate.length > 10) {
            extraLines.push(`...and ${res.residentsAwayLate.length - 10} more.`);
          }
        }
        if (res.skipped) {
          extraLines.push(`Skipped ${res.skipped} NPCs not expected to have homes (e.g., pets).`);
        }
        if (res.unreachable && Array.isArray(res.details)) {
          res.details.slice(0, 8).forEach(d => {
            extraLines.push(`- ${d.name}: ${d.reason}`);
          });
          if (res.details.length > 8) extraLines.push(`...and ${res.details.length - 8} more.`);
        }
        try {
          const el = document.getElementById("god-check-output");
          if (el) {
            const html = [summaryLine].concat(extraLines).map(s => `<div>${s}</div>`).join("");
            el.innerHTML = html;
          }
        } catch (_) {}
        extraLines.forEach(line => ctx.log(line, "info"));
        h.requestDraw();
      } else {
        ctx.log("TownAI.checkHomeRoutes not available.", "warn");
      }
    },
    onGodCheckInnTavern: () => {
      const ctx = getCtx();
      if (ctx.mode !== "town") {
        ctx.log("Inn check is available in town mode only.", "warn");
        h.requestDraw();
        return;
      }
      const list = Array.isArray(ctx.shops) ? ctx.shops : [];
      const inns = list.filter(s => (s.name || "").toLowerCase().includes("inn"));
      const line = `Inn: ${inns.length} inn(s).`;
      ctx.log(line, inns.length ? "info" : "warn");
      const lines = [];
      inns.slice(0, 6).forEach((s, i) => {
        lines.push(`- Inn ${i + 1} at door (${s.x},${s.y})`);
      });
      try {
        const el = document.getElementById("god-check-output");
        if (el) {
          const html = [line].concat(lines).map(s => `<div>${s}</div>`).join("");
          el.innerHTML = html;
        }
      } catch (_) {}
      lines.forEach(l => ctx.log(l, "info"));
      h.requestDraw();
    },
    onGodDiagnostics: () => {
      const ctx = getCtx();
      const mods = {
        Enemies: !!ctx.Enemies, Items: !!ctx.Items, Player: !!ctx.Player,
        UI: !!ctx.UI, Logger: !!ctx.Logger, Loot: !!ctx.Loot,
        Dungeon: !!ctx.Dungeon, DungeonItems: !!ctx.DungeonItems,
        FOV: !!ctx.FOV, AI: !!ctx.AI, Input: !!ctx.Input,
        Render: !!ctx.Render, Tileset: !!ctx.Tileset, Flavor: !!ctx.Flavor,
        World: !!ctx.World, Town: !!ctx.Town, TownAI: !!ctx.TownAI,
        DungeonState: !!ctx.DungeonState
      };
      const rngSrc = (typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function") ? "RNG.service" : "mulberry32.fallback";
      const seedStr = (typeof window !== "undefined" && window.RNG && typeof RNG.getSeed === "function")
        ? (String((Number(RNG.getSeed()) >>> 0)) || "(random)")
        : "(random)";
      ctx.log("Diagnostics:", "notice");
      ctx.log(`- Determinism: ${rngSrc}  Seed: ${seedStr}`, "info");
      ctx.log(`- Mode: ${ctx.mode}  Floor: ${ctx.floor}  FOV: ${ctx.fovRadius || 8}`, "info");
      ctx.log(`- Map: ${ctx.map.length}x${(ctx.map[0] ? ctx.map[0].length : 0)}`, "info");
      ctx.log(`- Entities: enemies=${ctx.enemies.length} corpses=${ctx.corpses.length} npcs=${ctx.npcs.length}`, "info");
      ctx.log(`- Modules: ${Object.keys(mods).filter(k=>mods[k]).join(", ")}`, "info");
      const perf = (typeof ctx.getPerfStats === "function") ? ctx.getPerfStats() : { lastTurnMs: 0, lastDrawMs: 0 };
      ctx.log(`- PERF last turn: ${Number(perf.lastTurnMs || 0).toFixed(2)}ms, last draw: ${Number(perf.lastDrawMs || 0).toFixed(2)}ms`, "info");
      h.requestDraw();
    },
    onGodRunSmokeTest: () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("smoketest", "1");
        if (window.DEV || localStorage.getItem("DEV") === "1") {
          url.searchParams.set("dev", "1");
        }
        const countEl = document.getElementById("god-smoke-count");
        if (countEl) {
          const n = parseInt(countEl.value, 10);
          if (Number.isFinite(n) && n > 0) {
            url.searchParams.set("smokecount", String(n));
          }
        }
        getCtx().log("GOD: Reloading with smoketest=1…", "notice");
        window.location.href = url.toString();
      } catch (e) {
        try { console.error(e); } catch (_) {}
        try {
          getCtx().log("GOD: Failed to construct URL; reloading with ?smoketest=1", "warn");
        } catch (_) {}
        window.location.search = "?smoketest=1";
      }
    },
  };
}