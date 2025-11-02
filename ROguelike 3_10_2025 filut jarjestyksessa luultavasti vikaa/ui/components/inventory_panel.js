/**
 * InventoryPanel: Inventory and Equipment UI extracted from ui/ui.js
 *
 * Exports (ESM + window.InventoryPanel):
 * - init(UI)
 * - render(player, describeItem)
 * - show()
 * - hide()
 * - isOpen()
 */
let _UI = null;
let _equipState = { leftEmpty: true, rightEmpty: true };

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}
function invPanel() { return byId("inv-panel"); }
function invList() { return byId("inv-list"); }
function equipSlotsEl() { return byId("equip-slots"); }

/**
 * Wire event delegation for inventory interactions
 */
export function init(UI) {
  _UI = UI;

  // Unequip via clicking equipped slot label
  const slots = equipSlotsEl();
  slots?.addEventListener("click", (ev) => {
    const span = ev.target.closest("span.name[data-slot]");
    if (!span) return;
    const slot = span.dataset.slot;
    if (slot && _UI && typeof _UI.handlers.onUnequip === "function") {
      _UI.handlers.onUnequip(slot);
    }
  });

  // Inventory list: equip/equip-hand/drink/eat
  const panel = invPanel();
  panel?.addEventListener("click", (ev) => {
    const li = ev.target.closest("li");
    if (!li || !li.dataset.index) return;
    const idx = parseInt(li.dataset.index, 10);
    if (!Number.isFinite(idx)) return;
    const kind = li.dataset.kind;

    if (kind === "equip") {
      const slot = li.dataset.slot || "";
      const twoH = li.dataset.twohanded === "true";
      if (twoH) {
        ev.preventDefault();
        if (_UI && typeof _UI.handlers.onEquip === "function") _UI.handlers.onEquip(idx);
        return;
      }
      if (slot === "hand") {
        ev.preventDefault();
        ev.stopPropagation();
        // If exactly one hand is empty, equip to that hand immediately
        const leftEmpty = !!_equipState.leftEmpty;
        const rightEmpty = !!_equipState.rightEmpty;
        if (leftEmpty !== rightEmpty) {
          const hand = leftEmpty ? "left" : "right";
          if (_UI && typeof _UI.handlers.onEquipHand === "function") _UI.handlers.onEquipHand(idx, hand);
          return;
        }
        // Otherwise show hand chooser near the clicked element
        const rect = li.getBoundingClientRect();
        if (_UI && typeof _UI.showHandChooser === "function") {
          _UI.showHandChooser(rect.left, rect.bottom + 6, (hand) => {
            if (hand && (hand === "left" || hand === "right")) {
              if (_UI && typeof _UI.handlers.onEquipHand === "function") _UI.handlers.onEquipHand(idx, hand);
            }
          });
        }
      } else {
        ev.preventDefault();
        if (_UI && typeof _UI.handlers.onEquip === "function") _UI.handlers.onEquip(idx);
      }
    } else if (kind === "potion" || kind === "drink") {
      ev.preventDefault();
      if (_UI && typeof _UI.handlers.onDrink === "function") _UI.handlers.onDrink(idx);
    } else if (kind === "food") {
      ev.preventDefault();
      if (_UI && typeof _UI.handlers.onEat === "function") _UI.handlers.onEat(idx);
    }
  });
}

/**
 * Render inventory equipment slots and inventory list
 */
export function render(player, describeItem) {
  // Compute current equip occupancy
  try {
    _equipState = {
      leftEmpty: !(player && player.equipment && player.equipment.left),
      rightEmpty: !(player && player.equipment && player.equipment.right),
    };
  } catch (_) {
    _equipState = { leftEmpty: true, rightEmpty: true };
  }

  // Equipment slots
  const slotsEl = equipSlotsEl();
  if (slotsEl) {
    const slots = [
      ["left", "Left hand"],
      ["right", "Right hand"],
      ["head", "Head"],
      ["torso", "Torso"],
      ["legs", "Legs"],
      ["hands", "Hands"],
    ];
    const html = slots.map(([key, label]) => {
      const it = player.equipment[key];
      if (it) {
        const name = (typeof describeItem === "function") ? describeItem(it)
          : ((typeof window !== "undefined" && window.ItemDescribe && typeof window.ItemDescribe.describe === "function")
              ? window.ItemDescribe.describe(it)
              : (it.name || "item"));
        const dec = Math.max(0, Math.min(100, Number(it.decay || 0)));
        const title = `Decay: ${dec.toFixed(0)}%`;
        return `<div class="slot"><strong>${label}:</strong> <span class="name" data-slot="${key}" title="${title}" style="cursor:pointer; text-decoration:underline dotted;">${name}</span></div>`;
      } else {
        return `<div class="slot"><strong>${label}:</strong> <span class="name"><span class='empty'>(empty)</span></span></div>`;
      }
    }).join("");
    if (html !== render._lastEquipHTML) {
      slotsEl.innerHTML = html;
      render._lastEquipHTML = html;
    }
  }

  // Inventory list
  const listEl = invList();
  if (listEl) {
    const key = Array.isArray(player.inventory)
      ? player.inventory.map(it => [
          it.kind || "misc",
          it.slot || "",
          it.name || "",
          (typeof it.atk === "number" ? it.atk : ""),
          (typeof it.def === "number" ? it.def : ""),
          (typeof it.decay === "number" ? it.decay : ""),
          (typeof it.count === "number" ? it.count : ""),
          (typeof it.amount === "number" ? it.amount : "")
        ].join("|")).join(";;")
      : "";
    if (key !== render._lastInvListKey) {
      listEl.innerHTML = "";
      (player.inventory || []).forEach((it, idx) => {
        const li = document.createElement("li");
        li.dataset.index = String(idx);

        // Determine if this material is edible (berries, cooked meat)
        const nm = String(it && (it.type || it.name) || "").toLowerCase();
        const isBerries = (it && it.kind === "material") && (nm === "berries");
        const isCookedMeat = (it && it.kind === "material") && (nm === "meat_cooked" || nm === "meat (cooked)");
        const isFood = isBerries || isCookedMeat;

        li.dataset.kind = isFood ? "food" : (it.kind || "misc");

        // Base label
        const baseLabel = (typeof describeItem === "function")
          ? describeItem(it)
          : ((typeof window !== "undefined" && window.ItemDescribe && typeof window.ItemDescribe.describe === "function")
              ? window.ItemDescribe.describe(it)
              : (it.name || "item"));
        let label = baseLabel;

        if (it.kind === "potion" || it.kind === "drink") {
          const count = (it.count && it.count > 1) ? ` x${it.count}` : "";
          label = `${baseLabel}${count}`;
        } else if (it.kind === "gold") {
          const amount = Number(it.amount || 0);
          label = `${baseLabel}: ${amount}`;
        } else if (it.kind === "equip") {
          const stats = [];
          if (typeof it.atk === "number") stats.push(`+${Number(it.atk).toFixed(1)} atk`);
          if (typeof it.def === "number") stats.push(`+${Number(it.def).toFixed(1)} def`);
          if (stats.length) label = `${baseLabel} (${stats.join(", ")})`;
        } else if (isFood) {
          const count = (typeof it.amount === "number" ? it.amount : (typeof it.count === "number" ? it.count : 1));
          const suffix = count > 1 ? ` x${count}` : "";
          label = `${baseLabel}${suffix}`;
        }

        if (it.kind === "equip" && it.slot === "hand") {
          li.dataset.slot = "hand";
          const dec = Math.max(0, Math.min(100, Number(it.decay || 0)));
          if (it.twoHanded) {
            li.dataset.twohanded = "true";
            li.title = `Two-handed • Decay: ${dec.toFixed(0)}%`;
          } else {
            let autoHint = "";
            if (_equipState) {
              if (_equipState.leftEmpty && !_equipState.rightEmpty) autoHint = " (Left is empty)";
              else if (_equipState.rightEmpty && !_equipState.leftEmpty) autoHint = " (Right is empty)";
            }
            li.title = `Click to equip${autoHint ? autoHint : " (choose hand)"} • Decay: ${dec.toFixed(0)}%`;
          }
          li.style.cursor = "pointer";
        } else if (it.kind === "equip") {
          li.dataset.slot = it.slot || "";
          const dec = Math.max(0, Math.min(100, Number(it.decay || 0)));
          li.title = `Click to equip • Decay: ${dec.toFixed(0)}%`;
          li.style.cursor = "pointer";
        } else if (it.kind === "potion" || it.kind === "drink") {
          li.style.cursor = "pointer";
          li.title = "Click to drink";
        } else if (isFood) {
          li.style.cursor = "pointer";
          li.title = isCookedMeat ? "Click to eat (+2 HP)" : "Click to eat (+1 HP)";
        } else {
          li.style.opacity = "0.7";
          li.style.cursor = "default";
        }

        li.textContent = label;
        listEl.appendChild(li);
      });
      render._lastInvListKey = key;
    }
  }
}

export function show() {
  const p = invPanel();
  if (p) {
    // Close loot if necessary via UI if available
    try { if (_UI && typeof _UI.isLootOpen === "function" && _UI.isLootOpen()) _UI.hideLoot(); } catch (_) {}
    p.hidden = false;
  }
}
export function hide() {
  const p = invPanel();
  if (p) p.hidden = true;
}
export function isOpen() {
  const p = invPanel();
  return !!(p && !p.hidden);
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("InventoryPanel", { init, render, show, hide, isOpen });