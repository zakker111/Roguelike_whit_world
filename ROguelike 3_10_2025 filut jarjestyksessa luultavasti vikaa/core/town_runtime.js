/**
 * TownRuntime: generation and helpers for town mode.
 *
 * Exports (window.TownRuntime):
 * - generate(ctx): populates ctx.map/visible/seen/npcs/shops/props/buildings/etc.
 * - ensureSpawnClear(ctx)
 * - spawnGateGreeters(ctx, count=4)
 * - isFreeTownFloor(ctx, x, y)
 * - talk(ctx): bump-talk with nearby NPCs; returns true if handled
 */
(function () {
  function generate(ctx) {
    const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
    if (Tn && typeof Tn.generate === "function") {
      const handled = Tn.generate(ctx);
      if (handled) {
        // Greeters at gate: Town.generate should ensure one; allow module to add none if unnecessary
        if (typeof Tn.spawnGateGreeters === "function") {
          try { Tn.spawnGateGreeters(ctx, 0); } catch (_) {}
        }
        // Post-gen camera/FOV/UI
        try { ctx.updateCamera(); } catch (_) {}
        try { ctx.recomputeFOV(); } catch (_) {}
        try { ctx.updateUI(); } catch (_) {}
        try { ctx.requestDraw(); } catch (_) {}
        return true;
      }
    }
    ctx.log && ctx.log("Town module missing; unable to generate town.", "warn");
    return false;
  }

  function ensureSpawnClear(ctx) {
    const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
    if (Tn && typeof Tn.ensureSpawnClear === "function") {
      Tn.ensureSpawnClear(ctx);
      return;
    }
    ctx.log && ctx.log("Town.ensureSpawnClear not available.", "warn");
  }

  function spawnGateGreeters(ctx, count) {
    const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
    if (Tn && typeof Tn.spawnGateGreeters === "function") {
      Tn.spawnGateGreeters(ctx, count);
      return;
    }
    ctx.log && ctx.log("Town.spawnGateGreeters not available.", "warn");
  }

  function isFreeTownFloor(ctx, x, y) {
    const U = (typeof window !== "undefined" ? window.Utils : null);
    if (U && typeof U.isFreeTownFloor === "function") {
      return !!U.isFreeTownFloor(ctx, x, y);
    }
    if (!ctx.inBounds(x, y)) return false;
    const t = ctx.map[y][x];
    if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) return false;
    if (x === ctx.player.x && y === ctx.player.y) return false;
    if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === x && n.y === y)) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  function talk(ctx) {
    if (ctx.mode !== "town") return false;
    const targets = [];
    const npcs = ctx.npcs || [];
    for (const n of npcs) {
      const d = Math.abs(n.x - ctx.player.x) + Math.abs(n.y - ctx.player.y);
      if (d <= 1) targets.push(n);
    }
    if (targets.length === 0) {
      ctx.log && ctx.log("There is no one to talk to here.");
      return false;
    }
    const pick = (arr, rng) => arr[(arr.length === 1) ? 0 : Math.floor((rng ? rng() : Math.random()) * arr.length) % arr.length];
    const npc = pick(targets, ctx.rng);
    const lines = Array.isArray(npc.lines) && npc.lines.length ? npc.lines : ["Hey!", "Watch it!", "Careful there."];
    const line = pick(lines, ctx.rng);
    ctx.log && ctx.log(`${npc.name || "Villager"}: ${line}`, "info");
    ctx.requestDraw && ctx.requestDraw();
    return true;
  }

  window.TownRuntime = { generate, ensureSpawnClear, spawnGateGreeters, isFreeTownFloor, talk };
})();