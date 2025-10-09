/**
 * Input
 * Keyboard bindings and dispatch to game handlers, with modal priority.
 *
 * Exports (window.Input):
 * - init(handlers): installs keydown listener. `handlers` can include:
 *   { isDead, isInventoryOpen, isLootOpen, isGodOpen, isShopOpen, onRestart, onShowInventory, onHideInventory,
 *     onHideLoot, onHideGod, onHideShop, onShowGod, onMove(dx,dy), onWait, onLoot, onDescend, adjustFov(delta) }
 * - destroy(): removes listener.
 *
 * Rules and priorities
 * - If a modal is open (inventory/loot/GOD/shop), Escape closes it and other keys are ignored.
 * - Movement only when no modal is open.
 * - Movement: Arrow keys (4-dir) and Numpad (8-dir). Wait: Numpad5.
 * - Inventory: I. Loot/Action: G. Descend: N.
 * - GOD panel: P to open. FOV adjust: [-] and [+]/[=] (also Numpad +/-).
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
        if (e.key && (e.key.toLowerCase() === "r")) {
          e.preventDefault();
          _handlers.onRestart && _handlers.onRestart();
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

      if (_handlers.i      if (_handlers.isLootOpen && _handlers.isLootOpen()) {
        e.preventDefault();
        _handlers.onHideLoot && _handlers.onHideLoo        
      if ((e.key && 
      if ((e.key && e.key.toLowerCase() === "i") || e.code === "KeyI") {
        e.preventDefault();
        _handlers.onShowInventory && _handlers.onShowInventor        
      
      if ((e.k      
      if ((e.key && e.key.toLowerCase() === "p") || e.code === "KeyP") {
        e.preventDefault();
        _handlers.onShowGod && _handlers.onShowGo        
      
      if (e.co      
      if (e.code === "BracketLeft" || e.key === "[" || e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-") {
        e.preventDefault();
        _handlers.adjustFov && _handlers.adjustFov(              if (e.c      }
      if (e.code === "BracketRight" || e.key === "]" || e.code === "Equal" || e.code === "NumpadAdd" || e.key === "=") {
        e.preventDefault();
        _handlers.adjustFov && _handlers.adjustFov        
      
      const ke      
      const key = e.code;
      if (KEY_DIRS[key]) {
        e.preventDefault();
        const d = KEY_DIRS[key];
        _handlers.onMove && _handlers.onMove(d.x, d        
      
      if (key       
      if (key === "Numpad5") {
        e.preventDefault();
        _handlers.onWait && _handlers.onWai        
      
      if (e.ke      
      if (e.key && e.key.toLowerCase() === "g") {
        e.preventDefault();
        _handlers.onHideLoot && _handlers.onHideLoot();
        _handlers.onLoot && _handlers.onLoo        
      
      if ((e.k      
      if ((e.key && e.key.toLowerCase() === "n")) {
        e.preventDefault();
        _handlers.onHideLoot && _handlers.onHideLoot();
        _handlers.onDescend && _handlers.onDescen        
      
      if (_han      
      if (_handlers.isLootOpen && _handlers.isLootOpen()) {
        _handlers.onHideLoot && _handlers.o    };
    window.add    };
    window.addEventListener("ke
  function destroy()
  function destroy()       if (_onKey) {
      window.removeEventListener("keydown", _onKey);
          _handlers =    }
    _
  window.Input = { i
  window.Input = { init, destroy };
})();