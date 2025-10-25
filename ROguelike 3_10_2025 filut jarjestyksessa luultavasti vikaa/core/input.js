/**
 * Input
 * Keyboard bindings and dispatch to game handlers, with modal priority.
 *
 * Exports (ESM + window.Input):
 * - init(handlers): installs keydown listener. `handlers` can include:
 *   { isDead, isInventoryOpen, isLootOpen, isGodOpen, isShopOpen, isSmokeOpen, onRestart, onShowInventory, onHideInventory,
 *     onHideLoot, onHideGod, onHideShop, onHideSmoke, onShowGod, onMove(dx,dy), onWait, onLoot, adjustFov(delta) }
 * - destroy(): removes listener.
 *
 * Rules and priorities
 * - If a modal is open (inventory/loot/GOD/shop), Escape closes it and other keys are ignored.
 * - Movement only when no modal is open.
 * - Movement: Arrow keys (4-dir) and Numpad (8-dir). Wait: Numpad5.
 * - Inventory: I. Loot/Action: G.
 * - GOD panel: P to open. FOV adjust: [-] and [+]/[=] (also Numpad +/-).
 * - Region Map: M to open/close.
 */

const KEY_DIRS = {
  // Numpad
  Numpad8: {x:0,y:-1}, Numpad2: {x:0,y:1}, Numpad4: {x:-1,y:0}, Numpad6: {x:1,y:0},
  Numpad7: {x:-1,y:-1}, Numpad9: {x:1,y:-1}, Numpad1: {x:-1,y:1}, Numpad3: {x:1,y:1},
  // Arrow keys (4-directional)
  ArrowUp: {x:0,y:-1}, ArrowDown: {x:0,y:1}, ArrowLeft: {x:-1,y:0}, ArrowRight: {x:1,y:0},
};

let _handlers = null;
let _onKey = null;

export function init(handlers) {
  _handlers = handlers || {};
  if (_onKey) {
    window.removeEventListener("keydown", _onKey);
  }
  _onKey = (e) => {
    // Dead screen: only R restarts (Enter disabled)
    if (_handlers.isDead && _handlers.isDead()) {
      if (e.key && (e.key.toLowerCase() === "r")) {
        e.preventDefault();
        _handlers.onRestart && _handlers.onRestart();
      }
      return;
    }

    // Confirm modal gating: block all keys while confirm is open; Esc cancels it
    if (_handlers.isConfirmOpen && _handlers.isConfirmOpen()) {
      const isEsc = e.key === "Escape" || e.key === "Esc";
      e.preventDefault();
      if (isEsc && _handlers.onCancelConfirm) {
        _handlers.onCancelConfirm();
      }
      return;
    }

    // Close top-most modals first: GOD, Shop, then Inventory/Loot
    if (_handlers.isGodOpen && _handlers.isGodOpen()) {
      const isEsc = e.key === "Escape" || e.key === "Esc";
      if (isEsc) {
        e.preventDefault();
        _handlers.onHideGod && _handlers.onHideGod();
      } else {
        e.preventDefault();
      }
      return;
    }
    if (_handlers.isShopOpen && _handlers.isShopOpen()) {
      const isEsc = e.key === "Escape" || e.key === "Esc";
      if (isEsc) {
        e.preventDefault();
        _handlers.onHideShop && _handlers.onHideShop();
      } else {
        e.preventDefault();
      }
      return;
    }
    if (_handlers.isSmokeOpen && _handlers.isSmokeOpen()) {
      const isEsc = e.key === "Escape" || e.key === "Esc";
      if (isEsc) {
        e.preventDefault();
        _handlers.onHideSmoke && _handlers.onHideSmoke();
      } else {
        e.preventDefault();
      }
      return;
    }
    // Sleep panel (Inn beds) gating after Smoke
    if (_handlers.isSleepOpen && _handlers.isSleepOpen()) {
      const isEsc = e.key === "Escape" || e.key === "Esc";
      if (isEsc) {
        e.preventDefault();
        _handlers.onHideSleep && _handlers.onHideSleep();
      } else {
        e.preventDefault();
      }
      return;
    }

    // Help / Controls gating: block movement and other keys while open; Esc closes it
    if (_handlers.isHelpOpen && _handlers.isHelpOpen()) {
      const isEsc = e.key === "Escape" || e.key === "Esc";
      if (isEsc) {
        e.preventDefault();
        _handlers.onHideHelp && _handlers.onHideHelp();
      } else {
        e.preventDefault();
      }
      return;
    }

    if (_handlers.isInventoryOpen && _handlers.isInventoryOpen()) {
      const isEsc = e.key === "Escape" || e.key === "Esc";
      if (e.key && (e.key.toLowerCase() === "i" || isEsc)) {
        e.preventDefault();
        _handlers.onHideInventory && _handlers.onHideInventory();
      } else {
        e.preventDefault();
      }
      return;
    }

    if (_handlers.isLootOpen && _handlers.isLootOpen()) {
      e.preventDefault();
      _handlers.onHideLoot && _handlers.onHideLoot();
      return;
    }

    // Inventory toggle
    if ((e.key && e.key.toLowerCase() === "i") || e.code === "KeyI") {
      e.preventDefault();
      _handlers.onShowInventory && _handlers.onShowInventory();
      return;
    }

    // GOD panel toggle
    if ((e.key && e.key.toLowerCase() === "p") || e.code === "KeyP") {
      e.preventDefault();
      _handlers.onShowGod && _handlers.onShowGod();
      return;
    }

    // Region Map toggle
    if ((e.key && e.key.toLowerCase() === "m") || e.code === "KeyM") {
      e.preventDefault();
      if (_handlers.isRegionMapOpen && _handlers.isRegionMapOpen()) {
        _handlers.onHideRegionMap && _handlers.onHideRegionMap();
      } else {
        _handlers.onShowRegionMap && _handlers.onShowRegionMap();
      }
      return;
    }

    // Help / Controls panel (F1)
    if (e.key === "F1") {
      e.preventDefault();
      if (_handlers.isHelpOpen && _handlers.isHelpOpen()) {
        _handlers.onHideHelp && _handlers.onHideHelp();
      } else {
        _handlers.onShowHelp && _handlers.onShowHelp();
      }
      return;
    }

    // FOV adjust
    if (e.code === "BracketLeft" || e.key === "[" || e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-") {
      e.preventDefault();
      _handlers.adjustFov && _handlers.adjustFov(-1);
      return;
    }
    if (e.code === "BracketRight" || e.key === "]" || e.code === "Equal" || e.code === "NumpadAdd" || e.key === "=") {
      e.preventDefault();
      _handlers.adjustFov && _handlers.adjustFov(1);
      return;
    }

    // Movement
    const key = e.code;
    if (KEY_DIRS[key]) {
      e.preventDefault();
      const d = KEY_DIRS[key];
      _handlers.onMove && _handlers.onMove(d.x, d.y);
      return;
    }

    // Wait
    if (key === "Numpad5") {
      e.preventDefault();
      _handlers.onWait && _handlers.onWait();
      return;
    }

    // Action / interact (G)
    if (e.key && e.key.toLowerCase() === "g") {
      e.preventDefault();
      _handlers.onHideLoot && _handlers.onHideLoot();
      _handlers.onLoot && _handlers.onLoot();
      return;
    }

    // Brace (B): defensive stance for one turn (dungeon mode), increases block chance this turn
    if (e.key && e.key.toLowerCase() === "b") {
      e.preventDefault();
      if (_handlers.onBrace) _handlers.onBrace();
      return;
    }

    // If loot panel still open, hide it by default
    if (_handlers.isLootOpen && _handlers.isLootOpen()) {
      _handlers.onHideLoot && _handlers.onHideLoot();
    }
  };
  window.addEventListener("keydown", _onKey);
}

export function destroy() {
  if (_onKey) {
    window.removeEventListener("keydown", _onKey);
    _onKey = null;
  }
  _handlers = null;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Input", { init, destroy });