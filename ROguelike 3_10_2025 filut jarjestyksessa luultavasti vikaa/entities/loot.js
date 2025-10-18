/**
 * Loot subsystem: enemy drops and player looting.
 *
 * Exports (ESM + window.Loot):
 * - generate(ctx, source): returns an array of drop items for a defeated enemy (gold, maybe potion, maybe equipment)
 * - lootHere(ctx): resolve looting on the player's tile (corpses and chests); applies auto-equip and UI hooks.
 *
 * Design:
 * - UI-agnostic; uses small hooks on ctx (log/updateUI/renderInventory/showLoot/hideLoot), with DOM fallbacks if UI is absent.
 * - Prefers Items module for data-driven equipment; otherwise generates sensible fallbacks.
 * - Deterministic when ctx.rng is provided.
 *
 * ctx (expected subset):
 * {
 *   player, corpses, rng, randInt, chance, utils:{randFloat, round1},
 *   describeItem(), equipIfBetter(), addPotionToInventory(), initialDecay(),
 *   log(), updateUI(), renderInventory(), showLoot(list), hideLoot(), turn(),
 *   Items?, Enemies?
 * }
 */

/**
 * Choose a potion tier based on enemy type.
 * Prefers Enemies.potionWeightsFor(type) when available; otherwise uses sane defaults.
 * Returns a plain item object: { kind: "potion", name, heal }
 */
function pickPotion(ctx, source) {
  // Prefer JSON-driven consumables when available; fallback to enemy-weighted defaults
  const CD = (typeof window !== "undefined" && window.GameData && window.GameData.consumables) ? window.GameData.consumables : null;
  const potions = (CD && Array.isArray(CD.potions)) ? CD.potions : null;
  const r = ctx.rng();

  function weightedPick(list) {
    const total = list.reduce((s, it) => s + (Number(it.weight) || 0), 0);
    if (total <= 0) return list[0];
    let x = r * total;
    for (const it of list) {
      const w = Number(it.weight) || 0;
      if (x < w) return it;
      x -= w;
    }
    return list[0];
  }

  if (potions && potions.length) {
    const chosen = weightedPick(potions);
    return { name: chosen.name || "potion", kind: "potion", heal: Number(chosen.heal) || 3 };
  }

  // Fallback: use enemy-type weighting when JSON not present
  const t = source?.type || "goblin";
  let wL = 0.6, wA = 0.3, wS = 0.1;
  const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
  if (EM && typeof EM.potionWeightsFor === "function") {
    const w = EM.potionWeightsFor(t) || {};
    wL = typeof w.lesser === "number" ? w.lesser : wL;
    wA = typeof w.average === "number" ? w.average : wA;
    wS = typeof w.strong === "number" ? w.strong : wS;
  } else {
    if (t === "troll") { wL = 0.5; wA = 0.35; wS = 0.15; }
    if (t === "ogre")  { wL = 0.4; wA = 0.35; wS = 0.25; }
  }
  const rr = ctx.rng();
  if (rr < wL) return { name: "lesser potion (+3 HP)", kind: "potion", heal: 3 };
  if (rr < wL + wA) return { name: "average potion (+6 HP)", kind: "potion", heal: 6 };
  return { name: "strong potion (+10 HP)", kind: "potion", heal: 10 };
}

/**
 * Create an equipment item when Items.createEquipment is unavailable.
 * Uses ctx.utils.randFloat and ctx.rng to pick a slot and generate tier-appropriate stats and names.
 * This ensures the game remains playable without the Items module.
 */
function fallbackEquipment(ctx, tier) {
  const material = tier === 1 ? "rusty" : tier === 2 ? "iron" : "steel";
  const categories = ["hand", "head", "torso", "legs", "hands"];
  const cat = categories[ctx.randInt(0, categories.length - 1)];

  if (cat === "hand") {
    if (ctx.rng() < 0.65) {
      const w = ["sword", "axe", "bow"][ctx.randInt(0, 2)];
      const ranges = tier === 1 ? [0.5, 2.4] : tier === 2 ? [1.2, 3.4] : [2.2, 4.0];
      let atk = ctx.utils.randFloat(ranges[0], ranges[1], 1);
      if (w === "axe") atk = Math.min(4.0, ctx.utils.round1(atk + ctx.utils.randFloat(0.1, 0.5, 1)));
      return { kind: "equip", slot: "hand", name: `${material} ${w}`, atk, tier, decay: ctx.initialDecay(tier) };
    } else {
      const ranges = tier === 1 ? [0.4, 2.0] : tier === 2 ? [1.2, 3.2] : [2.0, 4.0];
      const def = ctx.utils.randFloat(ranges[0], ranges[1], 1);
      return { kind: "equip", slot: "hand", name: `${material} shield`, def, tier, decay: ctx.initialDecay(tier) };
    }
  }

  if (cat === "head") {
    const ranges = tier === 1 ? [0.2, 1.6] : tier === 2 ? [0.8, 2.8] : [1.6, 3.6];
    const def = ctx.utils.randFloat(ranges[0], ranges[1], 1);
    const name = tier >= 3 ? `${material} great helm` : `${material} helmet`;
    return { kind: "equip", slot: "head", name, def, tier, decay: ctx.initialDecay(tier) };
  }

  if (cat === "torso") {
    const ranges = tier === 1 ? [0.6, 2.6] : tier === 2 ? [1.6, 3.6] : [2.4, 4.0];
    const def = ctx.utils.randFloat(ranges[0], ranges[1], 1);
    const name = tier >= 3 ? `${material} plate armor` : (tier === 2 ? `${material} chainmail` : `${material} leather armor`);
    return { kind: "equip", slot: "torso", name, def, tier, decay: ctx.initialDecay(tier) };
  }

  if (cat === "legs") {
    const ranges = tier === 1 ? [0.3, 1.8] : tier === 2 ? [1.0, 3.0] : [1.8, 3.8];
    const def = ctx.utils.randFloat(ranges[0], ranges[1], 1);
    return { kind: "equip", slot: "legs", name: `${material} leg armor`, def, tier, decay: ctx.initialDecay(tier) };
  }

  if (cat === "hands") {
    const ranges = tier === 1 ? [0.2, 1.2] : tier === 2 ? [0.8, 2.4] : [1.2, 3.0];
    const def = ctx.utils.randFloat(ranges[0], ranges[1], 1);
    const name = tier >= 2 ? `${material} gauntlets` : `${material} gloves`;
    const drop = { kind: "equip", slot: "hands", name, def, tier, decay: ctx.initialDecay(tier) };
    if (tier >= 2 && ctx.chance(0.5)) {
      const atk = tier === 2 ? ctx.utils.randFloat(0.1, 0.6, 1) : ctx.utils.randFloat(0.2, 1.0, 1);
      drop.atk = atk;
    }
    return drop;
  }

  const atk = ctx.utils.randFloat(0.8 + 0.4 * (tier - 1), 2.4 + 0.8 * (tier - 1), 1);
  return { kind: "equip", slot: "hand", name: `${material} sword`, atk, tier, decay: ctx.initialDecay(tier) };
}

/**
 * Build the drop list for a defeated enemy.
 * Always grants some gold, may add:
 * - a potion (weighted by enemy type)
 * - equipment (tier and chance driven by Enemies helpers when available)
 * Returns: Array of items (gold/potion/equip/...)
 */
export function generate(ctx, source) {
  const type = (source && source.type) ? String(source.type).toLowerCase() : "goblin";

  // Special case: neutral animals drop meat/leather; no gold/equipment
  if (type === "deer" || type === "boar" || type === "fox") {
    const drops = [];
    const r = (typeof ctx.rng === "function") ? ctx.rng : Math.random;
    // Meat amount: deer 2–3, boar 2–4, fox 1–2
    let meatAmt = 1;
    if (type === "deer") meatAmt = 2 + ((r() < 0.6) ? 1 : 0);
    else if (type === "boar") meatAmt = 2 + ((r() < 0.8) ? 2 : (r() < 0.4 ? 1 : 0));
    else meatAmt = 1 + ((r() < 0.5) ? 1 : 0);
    drops.push({ kind: "material", name: "meat", type: "meat", amount: meatAmt });

    // Leather chance and amount: higher for boar/deer
    let leatherAmt = 0;
    if (type === "deer") leatherAmt = (r() < 0.75) ? (1 + ((r() < 0.5) ? 1 : 0)) : 0;
    else if (type === "boar") leatherAmt = (r() < 0.85) ? (1 + ((r() < 0.6) ? 1 : 0)) : 0;
    else leatherAmt = (r() < 0.35) ? 1 : 0;
    if (leatherAmt > 0) drops.push({ kind: "material", name: "leather", type: "leather", amount: leatherAmt });

    return drops;
  }

  const drops = [];
  const baseCoins = ctx.randInt(1, 6);
  const bonus = source ? Math.floor((source.xp || 0) / 10) : 0;
  const coins = baseCoins + bonus;
  drops.push({ name: `${coins} gold`, kind: "gold", amount: coins });

  if (ctx.chance(0.35)) {
    drops.push(pickPotion(ctx, source));
  }

  const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
  const tier = (EM && typeof EM.equipTierFor === "function") ? EM.equipTierFor(type) : (type === "ogre" ? 3 : (type === "troll" ? 2 : 1));
  const equipChance = (EM && typeof EM.equipChanceFor === "function") ? EM.equipChanceFor(type) : (type === "ogre" ? 0.75 : (type === "troll" ? 0.55 : 0.35));
  if (ctx.chance(equipChance)) {
    const ItemsMod = (ctx.Items || (typeof window !== "undefined" ? window.Items : null));
    if (ItemsMod && typeof ItemsMod.createEquipment === "function") {
      drops.push(ItemsMod.createEquipment(tier, ctx.rng));
    } else {
      drops.push(fallbackEquipment(ctx, tier));
    }
  }
  return drops;
}

/**
 * Show a small modal panel listing the acquired item names.
 * Uses UI.showLoot when present, otherwise writes directly to the fallback DOM panel.
 */
function showLoot(ctx, list) {
  // Prefer UIBridge when available; else DOM fallback
  try {
    const UB = (ctx && ctx.UIBridge) || null;
    if (UB && typeof UB.showLoot === "function") {
      UB.showLoot(ctx, list || []);
      return;
    }
  } catch (_) {}
  const panel = document.getElementById("loot-panel");
  const ul = document.getElementById("loot-list");
  if (!panel || !ul) return;
  ul.innerHTML = "";
  (list || []).forEach(name => {
    const li = document.createElement("li");
    li.textContent = name;
    ul.appendChild(li);
  });
  panel.hidden = false;
}

/**
 * Hide the loot panel. Uses UI.hideLoot when present or a simple DOM toggle otherwise.
 */
function hideLoot(ctx) {
  // Prefer UIBridge when available; else DOM fallback
  try {
    const UB = (ctx && ctx.UIBridge) || null;
    if (UB && typeof UB.hideLoot === "function") {
      UB.hideLoot(ctx);
      return;
    }
  } catch (_) {}
  const panel = document.getElementById("loot-panel");
  if (!panel) return;
  panel.hidden = true;
}

/**
 * Loot whatever is at the player's tile:
 * - If a chest/corpse has items, transfer them (auto-equip if strictly better).
 * - Mark the container as looted and show a short summary panel.
 * - Consume a turn for the player (ctx.turn()).
 *
 * Side effects:
 * - May mutate player.inventory/equipment and HP (when drinking potions)
 * - Updates HUD via ctx.updateUI and logs summary lines
 * - Rerenders inventory panel if open (to reflect auto-equip/stacking changes)
 */
export function lootHere(ctx) {
  const { player, corpses } = ctx;

  // Loot only when the player is exactly on the corpse/chest tile
  const here = corpses.filter(c => c && c.x === player.x && c.y === player.y);

  if (here.length === 0) {
    ctx.log("There is no corpse here to loot.");
    return;
  }

  const container = here.find(c => Array.isArray(c.loot) && c.loot.length > 0);
  if (!container) {
    here.forEach(c => c.looted = true);
    if (here.some(c => c.kind === "chest")) ctx.log("The chest is empty.");
    else ctx.log("All corpses here have nothing of value.");
    // Persist the looted state immediately and consume a turn,
    // so revisiting the dungeon remembers emptied chests/corpses.
    try {
      if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.save === "function") {
        ctx.DungeonRuntime.save(ctx, false);
      }
    } catch (_) {}
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    if (typeof ctx.turn === "function") ctx.turn();
    return;
  }

  if (container.kind === "chest") {
    ctx.log("You open the chest.", "info");
  }

  const acquired = [];
  for (const item of container.loot) {
    if (item && item.kind === "equip") {
      const equipped = ctx.equipIfBetter(item);
      acquired.push(equipped ? `equipped ${ctx.describeItem(item)}` : ctx.describeItem(item));
      if (!equipped) {
        player.inventory.push(item);
      } else {
        // Rerender inventory if open (prefer UIBridge)
        let invOpen = false;
        try {
          const UB = (ctx && ctx.UIBridge) || null;
          if (UB && typeof UB.isInventoryOpen === "function") {
            invOpen = !!UB.isInventoryOpen();
          }
        } catch (_) {}
        if (invOpen && typeof ctx.renderInventory === "function") ctx.renderInventory();
      }
    } else if (item && item.kind === "gold") {
      const existing = player.inventory.find(i => i && i.kind === "gold");
      if (existing) existing.amount += item.amount;
      else player.inventory.push({ kind: "gold", amount: item.amount, name: "gold" });
      acquired.push(item.name || `${item.amount} gold`);
    } else if (item && item.kind === "potion") {
      const heal = item.heal || 3;
      if (player.hp >= player.maxHp) {
        ctx.addPotionToInventory(heal, item.name);
        acquired.push(`${item.name || `potion (+${heal} HP)`}`);
      } else {
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + heal);
        const gained = player.hp - before;
        ctx.log(`You drink a potion and restore ${gained.toFixed(1)} HP (HP ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}).`, "good");
        acquired.push(item.name || `potion (+${heal} HP)`);
      }
    } else if (item) {
      player.inventory.push(item);
      acquired.push(item.name || (item.kind || "item"));
    }
  }

  ctx.updateUI();
  container.loot = [];
  container.looted = true;
  // Persist dungeon state immediately so revisits remember emptied chest/corpse
  try {
    if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.save === "function") {
      ctx.DungeonRuntime.save(ctx, false);
    }
  } catch (_) {}

  showLoot(ctx, acquired);
  ctx.log(`You loot: ${acquired.join(", ")}.`);
  if (typeof ctx.turn === "function") ctx.turn();
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Loot = {
    generate,
    lootHere,
  };
}