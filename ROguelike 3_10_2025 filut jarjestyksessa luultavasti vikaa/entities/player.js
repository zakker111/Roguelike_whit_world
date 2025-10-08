/**
 * Player: creation, stats, inventory/equipment, decay, potions, XP/leveling.
 *
 * Exports (window.Player):
 * - createInitial, getAttack, getDefense, describeItem
 * - addPotion, drinkPotionByIndex
 * - equipIfBetter, equipItemByIndex, unequipSlot
 * - decayEquipped, gainXP
 * - defaults/setDefaults, normalize, resetFromDefaults, forceUpdate
 *
 * Notes:
 * - Equipment operations delegate to PlayerEquip.
 * - round1 and other helpers prefer PlayerUtils where present.
 */
(function () {
  const round1 = (window.PlayerUtils && typeof PlayerUtils.round1 === "function")
    ? PlayerUtils.round1
    : (n) => Math.round(n * 10) / 10;

  // Editable defaults for new game. Change these to customize starting attributes.
  const DEFAULT_EQUIPMENT = { left: null, right: null, head: null, torso: null, legs: null, hands: null };
  const defaults = {
    x: 0,
    y: 0,
    hp: 20,
    maxHp: 40,
    atk: 1,
    level: 1,
    xp: 0,
    xpNext: 20,
    inventory: [
      { kind: "gold", amount: 50, name: "gold" },
      { kind: "potion", heal: 6, count: 1, name: "average potion (+6 HP)" }
    ],
    equipment: { ...DEFAULT_EQUIPMENT },
  };

  function clone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : obj;
  }

  function normalize(p) {
    if (typeof p.maxHp !== "number" || p.maxHp <= 0) p.maxHp = 10;
    if (typeof p.hp !== "number") p.hp = p.maxHp;
    if (p.hp > p.maxHp) p.maxHp = p.hp;
    if (p.hp < 0) p.hp = 0;
    if (typeof p.level !== "number" || p.level < 1) p.level = 1;
    if (typeof p.atk !== "number") p.atk = 1;
    if (typeof p.xp !== "number") p.xp = 0;
    if (typeof p.xpNext !== "number" || p.xpNext <= 0) p.xpNext = 20;
    if (!Array.isArray(p.inventory)) p.inventory = [];
    const eq = p.equipment && typeof p.equipment === "object" ? p.equipment : {};
    p.equipment = Object.assign({ ...DEFAULT_EQUIPMENT }, eq);
    return p;
  }

  function createInitial() {
    // Build from defaults with deep clones to avoid sharing references
    const p = normalize({
      x: defaults.x,
      y: defaults.y,
      hp: defaults.hp,
      maxHp: defaults.maxHp,
      atk: defaults.atk,
      level: defaults.level,
      xp: defaults.xp,
      xpNext: defaults.xpNext,
      inventory: clone(defaults.inventory) || [],
      equipment: clone(defaults.equipment) || { ...DEFAULT_EQUIPMENT },
    });

    // Ensure the player starts with a basic stick in inventory.
    // Prefer registry-driven item if available; otherwise fall back to a named hand item.
    try {
      let stick = null;
      if (window.Items && typeof Items.createByKey === "function") {
        stick = Items.createByKey("stick", 1);
      }
      if (!stick && window.Items && typeof Items.createNamed === "function") {
        stick = Items.createNamed({ slot: "hand", tier: 1, name: "stick", atk: 1.0 });
      }
      if (stick) {
        try { stick.decay = 99; } catch (_) {}
        p.inventory.push(stick);
      }
    } catch (_) {}

    return p;
  }

  
  function getAttack(player) {
    let bonus = 0;
    const eq = player.equipment || {};
    if (eq.left && typeof eq.left.atk === "number") bonus += eq.left.atk;
    if (eq.right && typeof eq.right.atk === "number") bonus += eq.right.atk;
    if (eq.hands && typeof eq.hands.atk === "number") bonus += eq.hands.atk;
    const levelBonus = Math.floor((player.level - 1) / 2);
    return round1(player.atk + bonus + levelBonus);
  }

  function getDefense(player) {
    let def = 0;
    const eq = player.equipment || {};
    if (eq.left && typeof eq.left.def === "number") def += eq.left.def;
    if (eq.right && typeof eq.right.def === "number") def += eq.right.def;
    if (eq.head && typeof eq.head.def === "number") def += eq.head.def;
    if (eq.torso && typeof eq.torso.def === "number") def += eq.torso.def;
    if (eq.legs && typeof eq.legs.def === "number") def += eq.legs.def;
    if (eq.hands && typeof eq.hands.def === "number") def += eq.hands.def;
    return round1(def);
  }

  function describeItem(item) {
    // Prefer centralized description from Items module if available
    if (window.Items && typeof Items.describe === "function") {
      return Items.describe(item);
    }
    if (!item) return "";
    if (item.kind === "equip") {
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      return `${item.name}${parts.length ? " (" + parts.join(", ") + ")" : ""}`;
    }
    if (item.kind === "potion") {
      const heal = item.heal ?? 3;
      const base = item.name || `potion (+${heal} HP)`;
      const count = item.count && item.count > 1 ? ` x${item.count}` : "";
      return `${base}${count}`;
    }
    return item.name || "item";
  }

  function addPotion(player, heal = 3, name = `potion (+${heal} HP)`) {
    const existing = player.inventory.find(i => i.kind === "potion" && (i.heal ?? 3) === heal);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
    } else {
      player.inventory.push({ kind: "potion", heal, count: 1, name });
    }
  }

  function drinkPotionByIndex(player, idx, hooks = {}) {
    if (!player.inventory || idx < 0 || idx >= player.inventory.length) return;
    const it = player.inventory[idx];
    if (!it || it.kind !== "potion") return;

    const heal = it.heal ?? 3;
    const prev = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    const gained = player.hp - prev;
    if (hooks.log) {
      if (gained > 0) hooks.log(`You drink a potion and restore ${gained.toFixed(1)} HP (HP ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "good");
      else hooks.log(`You drink a potion but feel no different (HP ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "warn");
    }

    if (it.count && it.count > 1) {
      it.count -= 1;
    } else {
      player.inventory.splice(idx, 1);
    }
    if (hooks.updateUI) hooks.updateUI();
    if (hooks.renderInventory) hooks.renderInventory();
  }

  function equipIfBetter(player, item, hooks = {}) {
    if (window.PlayerEquip && typeof PlayerEquip.equipIfBetter === "function") {
      return PlayerEquip.equipIfBetter(player, item, hooks);
    }
    throw new Error("PlayerEquip module is required: PlayerEquip.equipIfBetter not found");
  }

  function equipItemByIndex(player, idx, hooks = {}) {
    if (window.PlayerEquip && typeof PlayerEquip.equipItemByIndex === "function") {
      return PlayerEquip.equipItemByIndex(player, idx, hooks);
    }
    throw new Error("PlayerEquip module is required: PlayerEquip.equipItemByIndex not found");
  }

  function decayEquipped(player, slot, amount, hooks = {}) {
    const it = player.equipment?.[slot];
    if (!it) return;
    const before = it.decay || 0;
    it.decay = Math.min(100, round1(before + amount));
    if (it.decay >= 100) {
      if (hooks.log) hooks.log(`${(it.name || "Item")[0].toUpperCase()}${(it.name || "Item").slice(1)} breaks and is destroyed.`, "bad");
      player.equipment[slot] = null;
      if (hooks.updateUI) hooks.updateUI();
      if (hooks.onInventoryChange) hooks.onInventoryChange();
    } else if (Math.floor(before) !== Math.floor(it.decay)) {
      if (hooks.onInventoryChange) hooks.onInventoryChange();
    }
  }

  function gainXP(player, amount, hooks = {}) {
    player.xp += amount;
    if (hooks.log) hooks.log(`You gain ${amount} XP.`);
    while (player.xp >= player.xpNext) {
      player.xp -= player.xpNext;
      player.level += 1;
      player.maxHp += 2;
      player.hp = player.maxHp;
      if (player.level % 2 === 0) player.atk += 1;
      player.xpNext = Math.floor(player.xpNext * 1.3 + 10);
      if (hooks.log) hooks.log(`You are now level ${player.level}. Max HP increased.`, "good");
    }
    if (hooks.updateUI) hooks.updateUI();
  }

  function unequipSlot(player, slot, hooks = {}) {
    if (window.PlayerEquip && typeof PlayerEquip.unequipSlot === "function") {
      return PlayerEquip.unequipSlot(player, slot, hooks);
    }
    throw new Error("PlayerEquip module is required: PlayerEquip.unequipSlot not found");
  }

  // Apply current defaults to an existing player (used when starting a new game)
  function resetFromDefaults(player) {
    const fresh = normalize({
      x: defaults.x,
      y: defaults.y,
      hp: defaults.hp,
      maxHp: defaults.maxHp,
      atk: defaults.atk,
      level: defaults.level,
      xp: defaults.xp,
      xpNext: defaults.xpNext,
      inventory: clone(defaults.inventory) || [],
      equipment: clone(defaults.equipment) || {},
    });
    for (const k of Object.keys(fresh)) {
      player[k] = Array.isArray(fresh[k]) ? fresh[k].slice() :
                  (fresh[k] && typeof fresh[k] === "object" ? JSON.parse(JSON.stringify(fresh[k])) : fresh[k]);
    }
    forceUpdate(player);
    return player;
  }

  // Force HUD refresh and broadcast a change event
  function forceUpdate(player) {
    if (window.UI && typeof UI.updateStats === "function") {
      UI.updateStats(player, window.floor || 1, getAttack.bind(null, player), getDefense.bind(null, player));
    }
    window.dispatchEvent(new CustomEvent("player:changed", { detail: { player } }));
  }

  // Update defaults at runtime (e.g., Player.setDefaults({ hp: 30, maxHp: 30 }))
  function setDefaults(partial) {
    if (!partial || typeof partial !== "object") return defaults;
    // shallow merge then normalize
    Object.assign(defaults, partial);
    const norm = normalize(clone(defaults));
    // write back normalized values so future createInitial/resetFromDefaults use them
    Object.assign(defaults, norm);
    return defaults;
  }

  window.Player = {
    // configuration
    defaults,
    setDefaults,
    normalize,
    resetFromDefaults,
    forceUpdate,
    // core API
    createInitial,
    getAttack,
    getDefense,
    describeItem,
    addPotion,
    drinkPotionByIndex,
    equipIfBetter,
    equipItemByIndex,
    decayEquipped,
    gainXP,
    unequipSlot,
  };
})();