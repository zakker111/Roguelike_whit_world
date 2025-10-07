/**
 * ClickHandlers: canvas click interactions for dungeon/town.
 * Extracted from core/game.js to slim it down.
 *
 * Behavior:
 * - Dungeon: click chest/corpse underfoot to loot; click adjacent to move; if not adjacent, show hint.
 * - Town: click on player's tile to perform context action (G); click adjacent to move a step.
 *
 * Initialization is safe idempotent and runs on DOMContentLoaded.
 * Relies on window.__getGameCtx() exposed by core/game.js.
 */
(function () {
  function init() {
    try {
      var canvasEl = document.getElementById("game");
      if (!canvasEl || typeof window.__getGameCtx !== "function") return;
      var ctx = window.__getGameCtx();

      function inBounds(x, y) {
        try { return !!ctx.inBounds && ctx.inBounds(x, y); } catch (_) { return false; }
      }
      function hasContainerAt(x, y) {
        try {
          var corpses = ctx.corpses || [];
          for (var i = 0; i < corpses.length; i++) {
            var c = corpses[i];
            if (!c) continue;
            if (c.x === x && c.y === y) {
              var hasLoot = Array.isArray(c.loot) ? c.loot.length > 0 : false;
              if (!c.looted || hasLoot) return c;
            }
          }
          return null;
        } catch (_) { return null; }
      }

      function tileFromEvent(ev) {
        var rect = canvasEl.getBoundingClientRect();
        var px = ev.clientX - rect.left;
        var py = ev.clientY - rect.top;
        var TILE = ctx.TILE || 32;
        var camera = ctx.camera || { x: 0, y: 0, width: 0, height: 0 };
        var tx = Math.floor((camera.x + Math.max(0, px)) / TILE);
        var ty = Math.floor((camera.y + Math.max(0, py)) / TILE);
        return { tx: tx, ty: ty };
      }

      function tryMovePlayer(dx, dy) {
        try {
          // core/game.js exposes move via Input or local function; prefer Input
          if (window.Input && typeof window.Input.onMove === "function") {
            window.Input.onMove(dx, dy);
            return;
          }
        } catch (_) {}
        // As a fallback, call ctx.turn after mutating player directly if helpers exist
        try {
          ctx.player.x += dx;
          ctx.player.y += dy;
          ctx.updateCamera();
          ctx.turn();
        } catch (_) {}
      }

      function doAction() {
        try {
          // Prefer Actions.doAction via ctx, else local loot
          if (window.Actions && typeof window.Actions.doAction === "function") {
            var c = window.__getGameCtx();
            var handled = window.Actions.doAction(c);
            if (handled) {
              // sync happens within core
              return;
            }
          }
        } catch (_) {}
        try { ctx.hideLoot && ctx.hideLoot(); } catch (_) {}
        try { ctx.showLoot && ctx.showLoot([]); } catch (_) {}
      }

      canvasEl.addEventListener("click", function (ev) {
        try {
          // Let modals take priority
          if (window.UI) {
            if (typeof UI.isLootOpen === "function" && UI.isLootOpen()) return;
            if (typeof UI.isInventoryOpen === "function" && UI.isInventoryOpen()) return;
            if (typeof UI.isGodOpen === "function" && UI.isGodOpen()) return;
            // Shop panel (fallback) also blocks canvas clicks
            try {
              var shopOpen = !!(document.getElementById("shop-panel") && document.getElementById("shop-panel").hidden === false);
              if (shopOpen) return;
            } catch (_) {}
          }

          var c = window.__getGameCtx();
          var mode = c.mode;
          if (mode !== "dungeon" && mode !== "town") return;

          var t = tileFromEvent(ev);
          var tx = t.tx, ty = t.ty;
          if (!inBounds(tx, ty)) return;

          if (mode === "dungeon") {
            var targetContainer = hasContainerAt(tx, ty);
            if (targetContainer) {
              if (tx === c.player.x && ty === c.player.y) {
                // Loot underfoot
                if (typeof window.Actions !== "undefined" && typeof window.Actions.loot === "function") {
                  window.Actions.loot(c);
                } else {
                  // Fallback: call ctx.turn so loot panel can open via core
                  try { c.turn(); } catch (_) {}
                }
                return;
              }
              var md = Math.abs(tx - c.player.x) + Math.abs(ty - c.player.y);
              if (md === 1) {
                var dx = Math.sign(tx - c.player.x);
                var dy = Math.sign(ty - c.player.y);
                tryMovePlayer(dx, dy);
                // auto-loot after arriving
                setTimeout(function () {
                  try {
                    var cc = window.__getGameCtx();
                    if (cc.player.x === tx && cc.player.y === ty) {
                      if (window.Actions && typeof window.Actions.loot === "function") {
                        window.Actions.loot(cc);
                      }
                    }
                  } catch (_) {}
                }, 0);
                return;
              }
              c.log("Move next to the chest/corpse and click it to loot.", "info");
              return;
            }
            var md2 = Math.abs(tx - c.player.x) + Math.abs(ty - c.player.y);
            if (md2 === 1) {
              var dx2 = Math.sign(tx - c.player.x);
              var dy2 = Math.sign(ty - c.player.y);
              tryMovePlayer(dx2, dy2);
            }
            return;
          }

          if (mode === "town") {
            if (tx === c.player.x && ty === c.player.y) {
              doAction();
              return;
            }
            var md3 = Math.abs(tx - c.player.x) + Math.abs(ty - c.player.y);
            if (md3 === 1) {
              var dx3 = Math.sign(tx - c.player.x);
              var dy3 = Math.sign(ty - c.player.y);
              tryMovePlayer(dx3, dy3);
            }
          }
        } catch (_) {}
      }, false);
    } catch (_) {}
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  window.ClickHandlers = { init: init };
  onReady(init);
})();