/**
 * InputMouse: canvas click handling (Step 6).
 * Delegates click-to-move and click-to-loot behavior out of core/game.js.
 */
(function () {
  function init(opts) {
    try {
      var canvasId = (opts && opts.canvasId) ? String(opts.canvasId) : "game";
      var canvasEl = document.getElementById(canvasId);
      if (!canvasEl) return;

      var TILE = (opts && typeof opts.TILE === "number") ? opts.TILE : 32;
      var getCamera = (opts && typeof opts.getCamera === "function") ? opts.getCamera : function () { return { x: 0, y: 0 }; };
      var getMode = (opts && typeof opts.getMode === "function") ? opts.getMode : function () { return "world"; };
      var inBounds = (opts && typeof opts.inBounds === "function") ? opts.inBounds : function () { return false; };
      var isWalkable = (opts && typeof opts.isWalkable === "function") ? opts.isWalkable : function () { return false; };
      var getPlayer = (opts && typeof opts.getPlayer === "function") ? opts.getPlayer : function () { return { x: 0, y: 0 }; };
      var getEnemies = (opts && typeof opts.getEnemies === "function") ? opts.getEnemies : function () { return []; };
      var getCorpses = (opts && typeof opts.getCorpses === "function") ? opts.getCorpses : function () { return []; };
      var tryMovePlayer = (opts && typeof opts.tryMovePlayer === "function") ? opts.tryMovePlayer : function () {};
      var lootCorpse = (opts && typeof opts.lootCorpse === "function") ? opts.lootCorpse : function () {};
      var doAction = (opts && typeof opts.doAction === "function") ? opts.doAction : function () {};

      function hasContainerAt(x, y) {
        try {
          var corpses = getCorpses();
          for (var i = 0; i < corpses.length; i++) {
            var c = corpses[i];
            if (c && c.x === x && c.y === y && (!c.looted || (Array.isArray(c.loot) && c.loot.length > 0))) {
              return c;
            }
          }
          return null;
        } catch (_) {
          return null;
        }
      }

      canvasEl.addEventListener("click", function (ev) {
        try {
          // If UI modals are open, let them handle clicks
          try {
            var UB = (typeof window !== "undefined" ? window.UIBridge : null);
            if (UB && typeof UB.isLootOpen === "function" && UB.isLootOpen()) return;
            if (UB && typeof UB.isInventoryOpen === "function" && UB.isInventoryOpen()) return;
            if (UB && typeof UB.isGodOpen === "function" && UB.isGodOpen()) return;
          } catch (_) {}
          // Also respect ShopUI state
          try {
            var SU = (typeof window !== "undefined" ? window.ShopUI : null);
            if (SU && typeof SU.isOpen === "function" && SU.isOpen()) return;
          } catch (_) {}
          if (window.UI) {
            if (typeof UI.isLootOpen === "function" && UI.isLootOpen()) return;
            if (typeof UI.isInventoryOpen === "function" && UI.isInventoryOpen()) return;
            if (typeof UI.isGodOpen === "function" && UI.isGodOpen()) return;
            if (typeof UI.isSmokeOpen === "function" && UI.isSmokeOpen()) return;
          }

          var mode = getMode();
          if (mode !== "dungeon" && mode !== "town") return;

          var camera = getCamera() || { x: 0, y: 0 };
          var rect = canvasEl.getBoundingClientRect();
          var px = ev.clientX - rect.left;
          var py = ev.clientY - rect.top;

          // Map pixel to tile coordinates considering camera
          var tx = Math.floor((camera.x + Math.max(0, px)) / TILE);
          var ty = Math.floor((camera.y + Math.max(0, py)) / TILE);

          if (!inBounds(tx, ty)) return;

          var p = getPlayer();

          if (mode === "dungeon") {
            var targetContainer = hasContainerAt(tx, ty);

            if (targetContainer) {
              // If clicked on our own tile and there is a container here, loot it
              if (tx === p.x && ty === p.y) {
                lootCorpse();
                return;
              }
              // If adjacent to the clicked container, step onto it and loot
              var md = Math.abs(tx - p.x) + Math.abs(ty - p.y);
              if (md === 1) {
                var dx = Math.sign(tx - p.x);
                var dy = Math.sign(ty - p.y);
                tryMovePlayer(dx, dy);
                // If we arrived on the container, auto-loot
                setTimeout(function () {
                  try {
                    var pNow = getPlayer();
                    if (pNow.x === tx && pNow.y === ty) lootCorpse();
                  } catch (_) {}
                }, 0);
                return;
              }
              // Not adjacent: inform the player
              try { if (window.Logger && typeof Logger.log === "function") Logger.log("Move next to the chest/corpse and click it to loot.", "info"); } catch (_) {}
              return;
            }

            // If no container was clicked, allow simple adjacent click-to-move QoL
            var md2 = Math.abs(tx - p.x) + Math.abs(ty - p.y);
            if (md2 === 1) {
              var dx2 = Math.sign(tx - p.x);
              var dy2 = Math.sign(ty - p.y);
              tryMovePlayer(dx2, dy2);
            }
            return;
          }

          if (mode === "town") {
            // In town, click on player's tile performs the context action (talk/exit/loot if chest underfoot)
            if (tx === p.x && ty === p.y) {
              doAction();
              return;
            }
            // Adjacent tile click: small QoL move
            var md3 = Math.abs(tx - p.x) + Math.abs(ty - p.y);
            if (md3 === 1) {
              var dx3 = Math.sign(tx - p.x);
              var dy3 = Math.sign(ty - p.y);
              tryMovePlayer(dx3, dy3);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  window.InputMouse = { init: init };
})();