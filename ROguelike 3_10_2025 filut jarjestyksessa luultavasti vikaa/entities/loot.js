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
 * Uses enemy.lootPools.potions weights and materializes a potion from GameData.consumables when available.
 * Returns a plain item object: { kind: "potion", name, heal, count:1 }
 */
function pickPotion(ctx, source) {
  const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
  const def = EM && typeof EM.getDefById === "function" ? EM.getDefById(source?.type || "") : null;
  const potW = def && def.lootPools && def.lootPools.potions ? def.lootPools.potions : null;
  if (!potW) return null;

  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const rfn = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);
  const rv = (typeof rfn === "function") ? rfn() : 0.5;

  const wL = Number(potW.lesser || 0);
  const wA = Number(potW.average || 0);
  const wS = Number(potW.strong || 0);
  const total = wL + wA + wS;
  if (!(total > 0)) return null;

  let tier = "strong";
  let roll = rv * total;
  if (roll < wL) tier = "lesser";
  else if (roll < wL + wA) tier = "average";
  else tier = "strong";

  // Try to fetch potion def from data/entities/consumables.json
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const list = GD && GD.consumables && Array.isArray(GD.consumables.potions) ? GD.consumables.potions : null;
    if (list) {
      const id = `potion_${tier}`;
      const c = list.find(p => p && String(p.id || "").toLowerCase() === id);
      if (c) {
        return { kind: "potion", heal: Number(c.heal || 0) || 0, count: 1, name: c.name || ("potion (+" + (c.heal || 0) + " HP)") };
      }
      // Fallback: choose by typical heals when ids differ
      const healWanted = tier === "lesser" ? 3 : (tier === "average" ? 6 : 10);
      const c2 = list.find(p => (p && Number(p.heal || 0) === healWanted));
      if (c2) {
        return { kind: "potion", heal: healWanted, count: 1, name: c2.name || ("potion (+" + healWanted + " HP)") };
      }
    }
  } catch (_) {}

  // Final fallback to hardcoded names
  if (tier === "lesser") return { name: "lesser potion (+3 HP)", kind: "potion", heal: 3, count: 1 };
  if (tier === "average") return { name: "average potion (+6 HP)", kind: "potion", heal: 6, count: 1 };
  return { name: "strong potion (+10 HP)", kind: "potion", heal: 10, count: 1 };
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
  // Seeded RNG for decisions within fallback equipment
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const rnd = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : null);

  if (cat === "hand") {
    if ((typeof rnd === "function" ? rnd() : 0.5) < 0.65) {
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
 * Enemy-biased equipment picker:
 
 * - Each enemy id maps to { itemKey: weight, ... }.
 * - Picks an item key by weight, clamps tier to the item's minTier, and creates via Items.createByKey.
 * Returns: item object or null if no suitable pool/entries.
 */
function pickEnemyBiasedEquipment(ctx, enemyType, tier) {
  try {
    const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
    const def = EM && typeof EM.getDefById === "function" ? EM.getDefById(enemyType) : null;
    const pool = def && def.lootPools ? def.lootPools : null;
    if (!pool) return null;

    const ItemsMod = (ctx.Items || (typeof window !== "undefined" ? window.Items : null));
    if (!ItemsMod || typeof ItemsMod.getTypeDef !== "function" || typeof ItemsMod.createByKey !== "function") return null;

    // Build candidates that exist in Items registry and have positive weight
    const entries = [];
    function pushFrom(obj) {
      if (!obj || typeof obj !== "object") return;
      for (const key of Object.keys(obj)) {
        const w = Number(obj[key] || 0);
        if (!(w > 0)) continue;
        const tdef = ItemsMod.getTypeDef(key);
        if (!tdef) continue;
        entries.push({ key, def: tdef, w });
      }
    }

    if (pool.weapons || pool.armor) {
      pushFrom(pool.weapons);
      pushFrom(pool.armor);
    } else {
      pushFrom(pool);
    }

    if (!entries.length) return null;

    const rng = (function () {
      try {
        if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
          return window.RNGUtils.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
        }
      } catch (_) {}
      return (typeof ctx.rng === "function") ? ctx.rng : null;
    })();

    let total = 0;
    for (const e of entries) total += e.w;
    if (!(total > 0)) return null;

    let r = (typeof rng === "function") ? (rng() * total) : (total / 2);
    let chosen = entries[0];
    for (const e of entries) {
      if (r < e.w) { chosen = e; break; }
      r -= e.w;
    }

    const minT = Math.max(1, Number(chosen.def.minTier || 1));
    const finalTier = Math.max(minT, Math.min(3, Number(tier || 1)));
    const item = ItemsMod.createByKey(chosen.key, finalTier, rng);
    return item || null;
  } catch (_) { return null; }
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

  // Helper: material registry lookup for pretty names
  function materialNameFor(id) {
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const M = GD && GD.materials && (Array.isArray(GD.materials.materials) ? GD.materials.materials : GD.materials.list);
      if (Array.isArray(M)) {
        const entry = M.find(m => m && String(m.id).toLowerCase() === String(id).toLowerCase());
        if (entry && entry.name) return String(entry.name);
      }
    } catch (_) {}
    return String(id);
  }

  // Helper: roll material drops from JSON pools if present
  function rollMaterialsFromPools(enemy) {
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const pools = GD && GD.materialPools ? GD.materialPools : null;
      if (!pools || typeof pools !== "object") return null;

      const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
      const rng = (RU && typeof RU.getRng === "function")
        ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((typeof ctx.rng === "function") ? ctx.rng : null);
      const chance = (p) => {
        try {
          if (RU && typeof RU.chance === "function") return RU.chance(p, rng);
        } catch (_) {}
        return p >= 1; // deterministic yes only for p>=1 when no RNG
      };
      const randint = (min, max) => {
        if (min > max) { const t = min; min = max; max = t; }
        if (typeof rng === "function") {
          const r = rng();
          return min + Math.floor(r * (max - min + 1));
        }
        return Math.floor((min + max) / 2);
      };

      const eType = (enemy && enemy.type) ? String(enemy.type).toLowerCase() : String(type || "");
      const faction = (enemy && enemy.faction) ? String(enemy.faction).toLowerCase() : null;

      // Pools can define per-enemy and per-faction lists
      const byEnemy = pools.enemies && pools.enemies[eType];
      const byFaction = faction && pools.factions && pools.factions[faction];
      const base = Array.isArray(byEnemy) ? byEnemy
                : Array.isArray(byFaction) ? byFaction
                : null;
      if (!base) return null;

      const out = [];
      for (const entry of base) {
        if (!entry || !entry.id) continue;
        const p = (typeof entry.chance === "number") ? entry.chance : 1;
        if (p < 1 && !chance(p)) continue;
        const min = Math.max(0, Number(entry.min != null ? entry.min : 1) | 0);
        const max = Math.max(min, Number(entry.max != null ? entry.max : min) | 0);
        const amt = randint(min, max);
        if (amt > 0) {
          out.push({ kind: "material", type: String(entry.id), name: materialNameFor(entry.id), amount: amt });
        }
      }
      return out;
    } catch (_) { return null; }
  }

  // Special case: neutral animals drop meat/leather; prefer JSON pools when available
  if (type === "deer" || type === "boar" || type === "fox") {
    const jsonDrops = rollMaterialsFromPools(source);
    if (Array.isArray(jsonDrops) && jsonDrops.length > 0) {
      return jsonDrops;
    }
    const drops = [];
    const rngFn = (function () {
      try {
        if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
          return window.RNGUtils.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
        }
      } catch (_) {}
      return (typeof ctx.rng === "function") ? ctx.rng : null;
    })();
    const chance = (p) => {
      try {
        if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.chance === "function") {
          return window.RNGUtils.chance(p, rngFn);
        }
      } catch (_) {}
      // Deterministic: no random gating when rng unavailable
      return false;
    };

    // Meat amount: deer 2–3, boar 2–4, fox 1–2
    let meatAmt = 1;
    if (type === "deer") meatAmt = 2 + (chance(0.6) ? 1 : 0);
    else if (type === "boar") meatAmt = 2 + (chance(0.8) ? 2 : (chance(0.4) ? 1 : 0));
    else meatAmt = 1 + (chance(0.5) ? 1 : 0);
    drops.push({ kind: "material", name: "meat", type: "meat", amount: meatAmt });

    // Leather chance and amount: higher for boar/deer
    let leatherAmt = 0;
    if (type === "deer") leatherAmt = chance(0.75) ? (1 + (chance(0.5) ? 1 : 0)) : 0;
    else if (type === "boar") leatherAmt = chance(0.85) ? (1 + (chance(0.6) ? 1 : 0)) : 0;
    else leatherAmt = chance(0.35) ? 1 : 0;
    if (leatherAmt > 0) drops.push({ kind: "material", name: "leather", type: "leather", amount: leatherAmt });

    return drops;
  }

  const drops = [];
  const baseCoins = ctx.randInt(1, 6);
  const bonus = source ? Math.floor((source.xp || 0) / 10) : 0;
  const coins = baseCoins + bonus;
  drops.push({ name: `${coins} gold`, kind: "gold", amount: coins });

  // Potion drop: only when enemy has embedded potions weights in its lootPools
  (function maybeDropPotion() {
    const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
    const def = EM && typeof EM.getDefById === "function" ? EM.getDefById(type) : null;
    const hasPotionsInPool = !!(def && def.lootPools && def.lootPools.potions);
    if (!hasPotionsInPool) return;
    const dropChance = 0.50;
    if (ctx.chance(dropChance)) {
      const pot = pickPotion(ctx, source);
      if (pot) drops.push(pot);
    }
  })();

  const EM = (ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null));
  const tier = (EM && typeof EM.equipTierFor === "function") ? EM.equipTierFor(type) : (type === "ogre" ? 3 : (type === "troll" ? 2 : 1));
  const equipChance = (EM && typeof EM.equipChanceFor === "function") ? EM.equipChanceFor(type) : (type === "ogre" ? 0.75 : (type === "troll" ? 0.55 : 0.35));
  if (ctx.chance(equipChance)) {
    // Only use enemy-specific loot pool; no general fallback
    const biased = pickEnemyBiasedEquipment(ctx, type, tier);
    if (biased) {
      drops.push(biased);
    }
  }

  // Rare special-case drop: bandits can very rarely carry a fishing pole (tool)
  if (type === "bandit") {
    try {
      const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
      const rfn = (RU && typeof RU.getRng === "function")
        ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((typeof ctx.rng === "function") ? ctx.rng : null);
      const roll = (typeof rfn === "function") ? rfn() : 1.0; // deterministic: no drop if no RNG
      // ~1% chance
      if (roll < 0.01) {
        drops.push({ kind: "tool", type: "fishing_pole", name: "fishing pole", decay: 0 });
      }
    } catch (_) {}
  }

  return drops;
}

/**
 * Show a small modal panel listing the acquired item names.
 * Uses UI.showLoot when present, otherwise writes directly to the fallback DOM panel.
 */
function showLoot(ctx, list) {
  // Route solely via UIOrchestration; no direct UIBridge usage
  try {
    const UIO = (ctx && ctx.UIOrchestration) || (typeof window !== "undefined" ? window.UIOrchestration : null);
    if (UIO && typeof UIO.showLoot === "function") {
      UIO.showLoot(ctx, list || []);
      return;
    }
  } catch (_) {}
  // If loot UI is unavailable, log and return
  try { ctx.log && ctx.log(`Loot: ${Array.isArray(list) ? list.join(", ") : ""}`, "info"); } catch (_) {}
}

/**
 * Hide the loot panel. Uses UI.hideLoot when present or a simple DOM toggle otherwise.
 */
function hideLoot(ctx) {
  // Route solely via UIOrchestration; no direct UIBridge usage
  try {
    const UIO = (ctx && ctx.UIOrchestration) || (typeof window !== "undefined" ? window.UIOrchestration : null);
    if (UIO && typeof UIO.hideLoot === "function") {
      UIO.hideLoot(ctx);
      return;
    }
  } catch (_) {}
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

  const containers = here.filter(c => Array.isArray(c.loot) && c.loot.length > 0);
  if (containers.length === 0) {
    here.forEach(c => c.looted = true);
    const chests = here.filter(c => String(c.kind || "").toLowerCase() === "chest").length;
    const corpsesCount = here.length - chests;
    if (chests > 0 && corpsesCount === 0) {
      ctx.log(chests === 1 ? "You search the chest but find nothing." : "You search the chests but find nothing.");
    } else if (corpsesCount > 0 && chests === 0) {
      ctx.log(corpsesCount === 1 ? "You search the corpse but find nothing." : "You search the corpses but find nothing.");
    } else {
      ctx.log("You search the area but find nothing.");
    }
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

  // If any chest underfoot, announce opening once
  if (containers.some(c => String(c.kind || "").toLowerCase() === "chest")) {
    ctx.log("You open the chest.", "info");
  }

  const acquired = [];
  for (const container of containers) {
    for (const item of container.loot) {
      if (item && item.kind === "equip") {
        const equipped = ctx.equipIfBetter(item);
        const desc = (typeof ctx.describeItem === "function")
          ? ctx.describeItem(item)
          : ((typeof window !== "undefined" && window.ItemDescribe && typeof window.ItemDescribe.describe === "function")
              ? window.ItemDescribe.describe(item)
              : (item.name || item.kind || "item"));
        acquired.push(equipped ? `equipped ${desc}` : desc);
        if (!equipped) {
          player.inventory.push(item);
        } else {
          // Rerender inventory if open via UIOrchestration
          let invOpen = false;
          try {
            const UIO = (ctx && ctx.UIOrchestration) || (typeof window !== "undefined" ? window.UIOrchestration : null);
            if (UIO && typeof UIO.isInventoryOpen === "function") {
              invOpen = !!UIO.isInventoryOpen(ctx);
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
    // Mark this container emptied
    container.loot = [];
    container.looted = true;
  }

  ctx.updateUI();
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