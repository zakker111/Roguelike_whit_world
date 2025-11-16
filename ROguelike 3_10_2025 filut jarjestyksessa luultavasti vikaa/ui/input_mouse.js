/**
 * InputMouse: canvas click handling (Step 6).
 * Delegates click-to-move and click-to-loot behavior out of core/game.js.
 *
 * Click semantics by mode:
 * - world: adjacent click moves one step via core tryMovePlayer; non-walkable suppressed; encounter rolls after move.
 * - dungeon: adjacent click-to-move; clicking a chest/corpse on your tile loots; adjacent click on a container steps onto it then auto-loots.
 * - town: click on player's tile triggers context action (talk/exit/loot underfoot); adjacent clicks move one step.
 *
 * Event routing order:
 * - If any modal is open (UIOrchestration.isAnyModalOpen), the click is ignored here.
 * - Otherwise map pixel to tile using camera, then dispatch by mode.
 */

// Prefer Capabilities for optional module access
import "/core/capabilities.js";

export function init(opts) {
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
        // If any modal is open, let it handle clicks
        try {
          var hasAnyModalOpen = (opts && typeof opts.isAnyModalOpen === "function") ? opts.isAnyModalOpen : null;
          if (hasAnyModalOpen ? hasAnyModalOpen() : (function () {
            try {
              var ctxForUI = (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.getCtx === "function") ? window.GameAPI.getCtx() : null;
              var Cap = (typeof window !== "undefined" ? window.Capabilities : null);
              if (Cap && typeof Cap.safeCall === "function") {
                var res = Cap.safeCall(ctxForUI, "UIOrchestration", "isAnyModalOpen", ctxForUI);
                if (res && res.ok) return !!res.result;
              }
              var UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
              if (UIO && typeof UIO.isAnyModalOpen === "function") return !!UIO.isAnyModalOpen(ctxForUI);
            } catch (_) {}
            return false;
          })()) return;
        } catch (_) {}

        var mode = getMode();
        // Support click-to-move in world, dungeon and town
        if (mode !== "dungeon" && mode !== "town" && mode !== "world") return;

        var camera = getCamera() || { x: 0, y: 0 };
        var rect = canvasEl.getBoundingClientRect();
        var px = ev.clientX - rect.left;
        var py = ev.clientY - rect.top;

        // Map pixel to tile coordinates considering camera
        var tx = Math.floor((camera.x + Math.max(0, px)) / TILE);
        var ty = Math.floor((camera.y + Math.max(0, py)) / TILE);

        if (!inBounds(tx, ty)) return;

        var p = getPlayer();

        if (mode === "world") {
          // Adjacent click moves one step via core tryMovePlayer (which defers to WorldRuntime)
          var mdw = Math.abs(tx - p.x) + Math.abs(ty - p.y);
          if (mdw === 1) {
            var dxw = Math.sign(tx - p.x);
            var dyw = Math.sign(ty - p.y);
            tryMovePlayer(dxw, dyw);
          }
          return;
        }

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
            try { if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") window.Logger.log("Move next to the chest/corpse and click it to loot.", "info"); } catch (_) {}
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

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("InputMouse", { init });