(function () {
  // SmokeTest Scenario: GMBridge + unified markers
  // Validates:
  // - MarkerService exists and can add/remove markers safely.
  // - QuestService.triggerAtMarkerIfHere does NOT delete gm.* markers.
  // - Pressing 'g' on a gm.* marker is consumed by GMBridge (so Region Map does not open).

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));

    const G = window.GameAPI || null;
    if (!G || !has(G.getCtx) || !has(G.getMode)) {
      recordSkip("GMBridge markers skipped (GameAPI not available)");
      return true;
    }

    const gctx = G.getCtx();
    if (!gctx || gctx.mode !== "world") {
      recordSkip("GMBridge markers skipped (not in world mode)");
      return true;
    }

    const MS = window.MarkerService || null;
    record(!!MS, "MarkerService is available on window");
    if (!MS || !has(MS.add) || !has(MS.remove) || !has(MS.findAtPlayer)) {
      record(false, "MarkerService has expected functions (add/remove/findAtPlayer)");
      return true;
    }

    const GMBridge = window.GMBridge || null;
    record(!!GMBridge, "GMBridge is available on window");

    // Pick a safe walkable non-town/non-dungeon tile near the current player.
    const p0 = has(G.getPlayer) ? G.getPlayer() : { x: 0, y: 0 };
    const w = has(G.getWorld) ? G.getWorld() : null;
    const WT = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : null;

    let target = null;
    try {
      if (w && w.map && WT && typeof window.World.isWalkable === "function") {
        const W = w.width | 0;
        const H = w.height | 0;
        for (let r = 0; r <= 8 && !target; r++) {
          for (let dy = -r; dy <= r && !target; dy++) {
            for (let dx = -r; dx <= r && !target; dx++) {
              const x = (p0.x | 0) + dx;
              const y = (p0.y | 0) + dy;
              if (x < 0 || y < 0 || x >= W || y >= H) continue;
              const t = w.map[y] && w.map[y][x];
              if (t == null) continue;
              if (t === WT.TOWN || t === WT.DUNGEON) continue;
              if (!window.World.isWalkable(t)) continue;
              target = { x, y };
            }
          }
        }
      }
    } catch (_) {}

    if (target && has(G.teleportTo)) {
      try {
        const okTp = !!G.teleportTo(target.x, target.y, { ensureWalkable: true, fallbackScanRadius: 4 });
        record(okTp, `Teleport near player to safe tile (${target.x},${target.y})`);
      } catch (_) {
        record(false, "Teleport to safe tile threw");
      }
    } else {
      record(true, "Teleport skipped (no safe tile found or GameAPI.teleportTo missing)");
    }

    // Add a gm.* marker exactly underfoot.
    const p = has(G.getPlayer) ? G.getPlayer() : p0;
    const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
    const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;
    const absX = ox + (p.x | 0);
    const absY = oy + (p.y | 0);

    const gmId = "gm_test_marker";
    const m = MS.add(gctx, {
      x: absX,
      y: absY,
      kind: "gm.test",
      glyph: "X",
      paletteKey: "questMarker",
      instanceId: gmId
    });

    record(!!m, "MarkerService.add can place a gm.* marker underfoot");

    // Press 'g' and confirm we did NOT enter the Region Map.
    // Input handling listens to e.key, so emitting key='g' is enough.
    try {
      const ev = new KeyboardEvent("keydown", { key: "g", code: "g", bubbles: true });
      window.dispatchEvent(ev);
    } catch (_) {}

    await sleep(220);

    const modeAfter = has(G.getMode) ? G.getMode() : "";
    record(modeAfter === "world", `Pressing 'g' on gm.* marker does not open Region Map (mode=${modeAfter})`);

    // Ensure marker still exists (QuestService trigger should not delete gm.* markers).
    let stillThere = false;
    try {
      const at = MS.findAtPlayer(gctx);
      const markers = Array.isArray(at) ? at : (at ? [at] : []);
      stillThere = !!markers.find(mm => mm && String(mm.instanceId || "") === gmId);
    } catch (_) {}
    record(stillThere, "gm.* marker remains after pressing 'g' (not deleted by QuestService)");

    // Cleanup marker so we don't leak state across scenarios.
    try {
      MS.remove(gctx, (mm) => mm && String(mm.instanceId || "") === gmId);
    } catch (_) {}

    return true;
  }

  window.SmokeTest.Scenarios.gm_bridge_markers = { run };
})();
