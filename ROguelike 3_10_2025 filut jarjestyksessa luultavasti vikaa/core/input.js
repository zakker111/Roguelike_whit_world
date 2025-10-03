/**
 * Input: keyboard bindings and dispatch to game handlers.
 *
 * Exports (window.Input):
 * - init(handlers): installs keydown listener. `handlers` can include:
 *   { isDead, isInventoryOpen, isLootOpen, isGodOpen, onRestart, onShowInventory, onHideInventory,
 *     onHideLoot, onHideGod, onShowGod, onMove(dx,dy), onWait, onLoot, onDescend, adjustFov(delta) }
 * - destroy(): removes listener.
 *
 * Movement: Arrow keys (4-dir) and Numpad (8-dir). Wait: Numpad5. Inventory: I. Loot: G. Descend: N or Enter.
 * GOD panel: P to open; Esc to close when open. FOV adjust: [-] and [+]/[=] (also Numpad +/-).
 */
(() => {
  const KEY_DIRS = {
    // Numpad
    Numpad8: {x:0,y:-1}, Numpad2: {x:0,y:1}, Numpad4: {x:-1,y:0}, Numpad6: {x:1,y:0},
    Numpad7: {x:-1,y:-1}, Numpad9: {x:1,y:-1}, Numpad1: {x:-1,y:1}, Numpad3: {x:1,y:1},
    // Arrow keys (4-directional)
    ArrowUp: {x:0,y:-1}, ArrowDown: {x:0,y:1}, ArrowLeft: {x:-1,y:0}, ArrowRight: {x:1,y:0},
  };

  let _handlers = null;
  let _onKey = null;

  function init(handlers) {
    _handlers = handlers || {};
    if (_onKey) {
      window.removeEventListener("keydown", _onKey);
    }
    _onKey = (e) => {
      
      if (_handlers.isDead && _handlers.isDead()) {
        if (e.key && (e.key.toLowerCase() === "r" || e.key === "Enter")) {
          e.preventDefault();
          _handlers.onRestart && _handlers.onRestart();
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

      
      if (e.key && e.key.toLowerCase() === "i") {
        e.preventDefault();
        _handlers.onShowInventory && _handlers.onShowInventory();
        return;
      }

      
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

      
      if (e.key && e.key.toLowerCase() === "p") {
        e.preventDefault();
        _handlers.onShowGod && _handlers.onShowGod();
        return;
      }

      
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

      
      const key = e.code;
      if (KEY_DIRS[key]) {
        e.preventDefault();
        const d = KEY_DIRS[key];
        _handlers.onMove && _handlers.onMove(d.x, d.y);
        return;
      }

      
      if (key === "Numpad5") {
        e.preventDefault();
        _handlers.onWait && _handlers.onWait();
        return;
      }

      
      if (e.key && e.key.toLowerCase() === "g") {
        e.preventDefault();
        _handlers.onHideLoot && _handlers.onHideLoot();
        _handlers.onLoot && _handlers.onLoot();
        return;
      }

      
      if ((e.key && e.key.toLowerCase() === "n") || e.key === "Enter") {
        e.preventDefault();
        _handlers.onHideLoot && _handlers.onHideLoot();
        _handlers.onDescend && _handlers.onDescend();
        return;
      }

      
      if (_handlers.isLootOpen && _handlers.isLootOpen()) {
        _handlers.onHideLoot && _handlers.onHideLoot();
      }
    };
    window.addEventListener("keydown", _onKey);
  }

  function destroy() {
    if (_onKey) {
      window.removeEventListener("keydown", _onKey);
      _onKey = null;
    }
    _handlers = null;
  }

  window.Input = { init, destroy };
})();