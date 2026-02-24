(function () {
  // SmokeTest Scenario: Skeleton key opens a locked town chest
  // Validates:
  // - Player in town mode can use a skeleton key to open a locked chest.
  // - Using the skeleton key awards 12..35 gold (town chest loot rule).
  // - The chest is marked opened.
  // - The skeleton key is consumed.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};
    const sleep = (ctx && ctx.sleep) || (ms => new Promise(r => setTimeout(r, ms | 0)));

    const G = window.GameAPI || null;
    if (!G || !has(G.getCtx) || !has(G.getMode)) {
      recordSkip("Skeleton key chest skipped (GameAPI not available)");
      return true;
    }

    const PS = window.PropsService || null;
    if (!PS || !has(PS.interact)) {
      recordSkip("Skeleton key chest skipped (PropsService.interact not available)");
      return true;
    }

    // Enter town mode.
    try { if (ctx && has(ctx.ensureAllModalsClosed)) await ctx.ensureAllModalsClosed(8); } catch (_) {}
    try {
      if (ctx && has(ctx.ensureTownOnce)) {
        await ctx.ensureTownOnce();
      }
    } catch (_) {}

    if (G.getMode() !== "town") {
      recordSkip("Skeleton key chest skipped (not in town mode)");
      return true;
    }

    const townCtx = G.getCtx();
    if (!townCtx || townCtx.mode !== "town") {
      recordSkip("Skeleton key chest skipped (town ctx unavailable)");
      return true;
    }

    const getGoldAmount = () => {
      try {
        const c = has(G.getCtx) ? G.getCtx() : townCtx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        let sum = 0;
        for (const it of inv) {
          if (!it) continue;
          const k = String(it.kind || it.type || "").toLowerCase();
          if (k !== "gold") continue;
          sum += (typeof it.amount === "number") ? it.amount : (Number(it.amount) || 0);
        }
        return sum | 0;
      } catch (_) {
        return 0;
      }
    };

    const UIO = window.UIOrchestration || null;
    const origShowConfirm = (UIO && has(UIO.showConfirm)) ? UIO.showConfirm : null;

    // Inject state and run interaction.
    let chest = null;
    try {
      // Auto-accept confirm prompts to avoid UI flake.
      if (UIO && has(UIO.showConfirm)) {
        UIO.showConfirm = function (_ctx2, _text, _pos, onOk, _onCancel) {
          try { if (typeof onOk === "function") onOk(); } catch (_) {}
        };
      }

      // Ensure skeleton key in inventory.
      const inv = (townCtx.player && Array.isArray(townCtx.player.inventory)) ? townCtx.player.inventory : (townCtx.player.inventory = []);
      for (let i = inv.length - 1; i >= 0; i--) {
        const it = inv[i];
        if (!it) continue;
        const kind = String(it.kind || "").toLowerCase();
        const type = String(it.type || "").toLowerCase();
        const name = String(it.name || "").toLowerCase();
        if (kind === "tool" && (type === "skeleton_key" || name.includes("skeleton key"))) {
          inv.splice(i, 1);
        }
      }
      inv.push({ kind: "tool", type: "skeleton_key", name: "skeleton key", decay: 0 });
      try { if (typeof townCtx.updateUI === "function") townCtx.updateUI(); } catch (_) {}

      const goldBefore = getGoldAmount();

      // Place a locked chest at the player's current position.
      const px = (townCtx.player && typeof townCtx.player.x === "number") ? (townCtx.player.x | 0) : 0;
      const py = (townCtx.player && typeof townCtx.player.y === "number") ? (townCtx.player.y | 0) : 0;
      const townProps = Array.isArray(townCtx.townProps) ? townCtx.townProps : (townCtx.townProps = []);

      for (let i = townProps.length - 1; i >= 0; i--) {
        const p = townProps[i];
        if (p && p.x === px && p.y === py && String(p.type || "").toLowerCase() === "chest") {
          townProps.splice(i, 1);
        }
      }
      chest = { x: px, y: py, type: "chest", opened: false };
      townProps.push(chest);

      record(true, "Injected skeleton key and locked chest at player position");

      const handled = !!PS.interact(townCtx, chest);
      record(handled, "PropsService.interact handled chest");

      // Allow UI/inventory update calls to settle.
      await sleep(60);

      const goldAfter = getGoldAmount();
      const delta = (goldAfter | 0) - (goldBefore | 0);

      record(chest && chest.opened === true, "Skeleton key opens locked chest (prop.opened=true)");
      record(delta >= 12 && delta <= 35, `Gold increased by 12..35 (delta=${delta})`);

      const hasKeyAfter = inv.some(it => {
        if (!it) return false;
        const kind = String(it.kind || "").toLowerCase();
        const type = String(it.type || "").toLowerCase();
        const name = String(it.name || "").toLowerCase();
        return kind === "tool" && (type === "skeleton_key" || name.includes("skeleton key"));
      });
      record(!hasKeyAfter, "Skeleton key consumed");

      return true;
    } catch (e) {
      record(false, "Skeleton key chest scenario failed: " + (e && e.message ? e.message : String(e)));
      return true;
    } finally {
      // Restore confirm hook.
      try {
        if (UIO && origShowConfirm) UIO.showConfirm = origShowConfirm;
      } catch (_) {}

      // Cleanup injected state (best-effort).
      try {
        const c = has(G.getCtx) ? G.getCtx() : townCtx;
        const inv = (c && c.player && Array.isArray(c.player.inventory)) ? c.player.inventory : [];
        for (let i = inv.length - 1; i >= 0; i--) {
          const it = inv[i];
          if (!it) continue;
          const kind = String(it.kind || "").toLowerCase();
          const type = String(it.type || "").toLowerCase();
          const name = String(it.name || "").toLowerCase();
          if (kind === "tool" && (type === "skeleton_key" || name.includes("skeleton key"))) {
            inv.splice(i, 1);
          }
        }
      } catch (_) {}
      try {
        const c = has(G.getCtx) ? G.getCtx() : townCtx;
        const tps = (c && Array.isArray(c.townProps)) ? c.townProps : [];
        if (chest) {
          for (let i = tps.length - 1; i >= 0; i--) {
            const p = tps[i];
            if (p && p.x === chest.x && p.y === chest.y && String(p.type || "") === String(chest.type || "")) {
              tps.splice(i, 1);
            }
          }
        }
      } catch (_) {}

      try { if (townCtx && typeof townCtx.updateUI === "function") townCtx.updateUI(); } catch (_) {}
    }
  }

  window.SmokeTest.Scenarios.skeleton_key_chest = { run };
})();
