/**
 * GameInventory: inventory and equipment flows extracted from game.js
 *
 * API (globals on window.GameInventory):
 *  - drinkPotionByIndex(ctx, idx)
 *  - equipIfBetter(ctx, item) -> boolean
 *  - renderInventoryPanel(ctx)
 *  - showInventoryPanel(ctx)
 *  - hideInventoryPanel(ctx)
 *  - equipItemByIndex(ctx, idx)
 *  - equipItemByIndexHand(ctx, idx, hand)
 *  - unequipSlot(ctx, slot)
 */
(function () {
  function renderInventoryPanel(ctx) {
    if (ctx.UI && typeof ctx.UI.renderInventory === "function") {
      if (ctx.updateUI) ctx.updateUI();
      ctx.UI.renderInventory(ctx.player, ctx.describeItem || ((it)=>it?.name||"item"));
    }
  }

  function showInventoryPanel(ctx) {
    renderInventoryPanel(ctx);
    if (ctx.UI && typeof ctx.UI.showInventory === "function") {
      ctx.UI.showInventory();
    } else {
      const panel = document.getElementById("inv-panel");
      if (panel) panel.hidden = false;
    }
    if (ctx.requestDraw) ctx.requestDraw();
  }

  function hideInventoryPanel(ctx) {
    if (ctx.UI && typeof ctx.UI.hideInventory === "function") {
      ctx.UI.hideInventory();
      if (ctx.requestDraw) ctx.requestDraw();
      return;
    }
    const panel = document.getElementById("inv-panel");
    if (!panel) return;
    panel.hidden = true;
    if (ctx.requestDraw) ctx.requestDraw();
  }

  function drinkPotionByIndex(ctx, idx) {
    if (ctx.Player && typeof ctx.Player.drinkPotionByIndex === "function") {
      ctx.Player.drinkPotionByIndex(ctx.player, idx, {
        log: ctx.log,
        updateUI: ctx.updateUI,
        renderInventory: () => renderInventoryPanel(ctx),
      });
      return;
    }
    if (!ctx.player.inventory || idx < 0 || idx >= ctx.player.inventory.length) return;
    const it = ctx.player.inventory[idx];
    if (!it || it.kind !== "potion") return;

    const heal = it.heal ?? 3;
    const prev = ctx.player.hp;
    ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + heal);
    const gained = ctx.player.hp - prev;
    if (ctx.log) {
      if (gained > 0) ctx.log(`You drink a potion and restore ${gained.toFixed(1)} HP (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "good");
      else ctx.log(`You drink a potion but feel no different (HP ${ctx.player.hp.toFixed(1)}/${ctx.player.maxHp.toFixed(1)}).`, "warn");
    }

    if (it.count && it.count > 1) {
      it.count -= 1;
    } else {
      ctx.player.inventory.splice(idx, 1);
    }
    if (ctx.updateUI) ctx.updateUI();
    renderInventoryPanel(ctx);
  }

  function equipIfBetter(ctx, item) {
    if (ctx.Player && typeof ctx.Player.equipIfBetter === "function") {
      return ctx.Player.equipIfBetter(ctx.player, item, {
        log: ctx.log,
        updateUI: ctx.updateUI,
        renderInventory: () => renderInventoryPanel(ctx),
        describeItem: (it) => (ctx.describeItem ? ctx.describeItem(it) : (it?.name || "item")),
      });
    }
    if (!item || item.kind !== "equip") return false;
    const slot = item.slot;
    const current = ctx.player.equipment[slot];
    const newScore = (item.atk || 0) + (item.def || 0);
    const curScore = current ? ((current.atk || 0) + (current.def || 0)) : -Infinity;
    const better = !current || newScore > curScore + 1e-9;

    if (better) {
      ctx.player.equipment[slot] = item;
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      const statStr = parts.join(", ");
      if (ctx.log) ctx.log(`You equip ${item.name} (${slot}${statStr ? ", " + statStr : ""}).`);
      if (ctx.updateUI) ctx.updateUI();
      renderInventoryPanel(ctx);
      return true;
    }
    return false;
  }

  function equipItemByIndex(ctx, idx) {
    if (ctx.Player && typeof ctx.Player.equipItemByIndex === "function") {
      ctx.Player.equipItemByIndex(ctx.player, idx, {
        log: ctx.log,
        updateUI: ctx.updateUI,
        renderInventory: () => renderInventoryPanel(ctx),
        describeItem: (it) => (ctx.describeItem ? ctx.describeItem(it) : (it?.name || "item")),
      });
      return;
    }
    if (!ctx.player.inventory || idx < 0 || idx >= ctx.player.inventory.length) return;
    const item = ctx.player.inventory[idx];
    if (!item || item.kind !== "equip") {
      if (ctx.log) ctx.log("That item cannot be equipped.");
      return;
    }
    const slot = item.slot || "hand";
    const prev = ctx.player.equipment[slot];
    ctx.player.inventory.splice(idx, 1);
    ctx.player.equipment[slot] = item;
    const statStr = ("atk" in item) ? `+${item.atk} atk` : ("def" in item) ? `+${item.def} def` : "";
    if (ctx.log) ctx.log(`You equip ${item.name} (${slot}${statStr ? ", " + statStr : ""}).`);
    if (prev) {
      ctx.player.inventory.push(prev);
      if (ctx.log) ctx.log(`You stow ${(ctx.describeItem ? ctx.describeItem(prev) : (prev?.name || "item"))} into your inventory.`);
    }
    if (ctx.updateUI) ctx.updateUI();
    renderInventoryPanel(ctx);
  }

  function equipItemByIndexHand(ctx, idx, hand) {
    if (ctx.Player && typeof ctx.Player.equipItemByIndex === "function") {
      ctx.Player.equipItemByIndex(ctx.player, idx, {
        log: ctx.log,
        updateUI: ctx.updateUI,
        renderInventory: () => renderInventoryPanel(ctx),
        describeItem: (it) => (ctx.describeItem ? ctx.describeItem(it) : (it?.name || "item")),
        preferredHand: hand,
      });
      return;
    }
    equipItemByIndex(ctx, idx);
  }

  function unequipSlot(ctx, slot) {
    if (ctx.Player && typeof ctx.Player.unequipSlot === "function") {
      ctx.Player.unequipSlot(ctx.player, slot, {
        log: ctx.log,
        updateUI: ctx.updateUI,
        renderInventory: () => renderInventoryPanel(ctx),
      });
      return;
    }
    const eq = ctx.player.equipment || {};
    const valid = ["left","right","head","torso","legs","hands"];
    if (!valid.includes(slot)) return;
    if ((slot === "left" || slot === "right") && eq.left && eq.right && eq.left === eq.right && eq.left.twoHanded) {
      const item = eq.left;
      eq.left = null; eq.right = null;
      ctx.player.inventory.push(item);
      if (ctx.log) ctx.log(`You unequip ${(ctx.describeItem ? ctx.describeItem(item) : (item?.name || "item"))} (two-handed).`);
      if (ctx.updateUI) ctx.updateUI();
      renderInventoryPanel(ctx);
      return;
    }
    const it = eq[slot];
    if (!it) return;
    eq[slot] = null;
    ctx.player.inventory.push(it);
    if (ctx.log) ctx.log(`You unequip ${(ctx.describeItem ? ctx.describeItem(it) : (it?.name || "item"))} from ${slot}.`);
    if (ctx.updateUI) ctx.updateUI();
    renderInventoryPanel(ctx);
  }

  window.GameInventory = {
    renderInventoryPanel,
    showInventoryPanel,
    hideInventoryPanel,
    drinkPotionByIndex,
    equipIfBetter,
    equipItemByIndex,
    equipItemByIndexHand,
    unequipSlot,
  };
})();