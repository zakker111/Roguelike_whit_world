/**
 * DungeonItems: scripted dungeon props such as chests.
 *
 * Exports (ESM + window.DungeonItems):
 * - placeChestInStartRoom(ctx): convenience for a starter chest in the start room
 * - spawnChest(ctx, options): generic chest spawner with configurable loot/tier/position/decay
 * - registerLoot(name, fn): add custom loot generators
 * - lootFactories: bundled loot generator functions (potion, armor, handWeapon, equipment(slot), anyEquipment)
 *
 * Chest representation:
 * - Stored in ctx.corpses as { kind: "chest", x, y, loot, looted: false }
 * - Loot items are standard { kind: "equip" | "potion" | ... }
 */

// Utilities
function setDecayIfEquip(item, decay = 99) {
  if (item && item.kind === "equip") item.decay = decay;
  return item;
}

// --- Built-in loot factories ---
export const lootFactories = {
  potion: (ctx) => {
    const rng = ctx.rng || ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
      ? window.RNG.rng
      : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
          ? window.RNGFallback.getRng()
          : Math.random));
    const r = rng();
    if (r < 0.5) return { name: "lesser potion (+3 HP)", kind: "potion", heal: 3 };
    if (r < 0.85) return { name: "average potion (+6 HP)", kind: "potion", heal: 6 };
    return { name: "strong potion (+10 HP)", kind: "potion", heal: 10 };
  },

  armor: (ctx, opts = {}) => {
    const tier = opts.tier ?? 2;
    const rng = ctx.rng || ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
      ? window.RNG.rng
      : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
          ? window.RNGFallback.getRng()
          : Math.random));
    const slots = ["head", "torso", "legs", "hands"];
    const slot = slots[Math.floor(rng() * slots.length)];
    const ItemsMod = (ctx.Items || (typeof window !== "undefined" ? window.Items : null));
    if (ItemsMod && typeof ItemsMod.createEquipmentOfSlot === "function") {
      return setDecayIfEquip(ItemsMod.createEquipmentOfSlot(slot, tier, rng), opts.decayAll ?? 99);
    }
    // fallback
    const nameBy = { head: "helmet", torso: "leather armor", legs: "leg armor", hands: "gloves" };
    return setDecayIfEquip({ kind: "equip", slot, name: `iron ${nameBy[slot] || "armor"}`, def: 1.0, tier, decay: 10 }, opts.decayAll ?? 99);
  },

  handWeapon: (ctx, opts = {}) => {
    const tier = opts.tier ?? 2;
    const rng = ctx.rng || ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
      ? window.RNG.rng
      : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
          ? window.RNGFallback.getRng()
          : Math.random));
    const ItemsMod = (ctx.Items || (typeof window !== "undefined" ? window.Items : null));
    if (ItemsMod && typeof ItemsMod.createByKey === "function") {
      const keys = ["sword", "axe", "bow"];
      // allow two-handed at higher tiers with small chance
      if (tier >= 2 && rng() < 0.2) keys.push("two_handed_axe");
      const key = keys[Math.floor(rng() * keys.length)];
      return setDecayIfEquip(ItemsMod.createByKey(key, tier, rng), opts.decayAll ?? 99);
    }
    // fallback
    return setDecayIfEquip({ kind: "equip", slot: "hand", name: "iron sword", atk: 1.5, tier, decay: 8 }, opts.decayAll ?? 99);
  },

  equipment: (ctx, opts = {}) => {
    const tier = opts.tier ?? 2;
    const slot = opts.slot || "hand";
    const rng = ctx.rng || ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
      ? window.RNG.rng
      : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
          ? window.RNGFallback.getRng()
          : Math.random));
    const ItemsMod = (ctx.Items || (typeof window !== "undefined" ? window.Items : null));
    if (ItemsMod && typeof ItemsMod.createEquipmentOfSlot === "function") {
      return setDecayIfEquip(ItemsMod.createEquipmentOfSlot(slot, tier, rng), opts.decayAll ?? 99);
    }
    // fallback simple
    if (slot === "hand") return setDecayIfEquip({ kind: "equip", slot: "hand", name: "iron sword", atk: 1.5, tier, decay: 8 }, opts.decayAll ?? 99);
    return setDecayIfEquip({ kind: "equip", slot, name: `iron ${slot}`, def: 1.0, tier, decay: 10 }, opts.decayAll ?? 99);
  },

  anyEquipment: (ctx, opts = {}) => {
    const rng = ctx.rng || ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
      ? window.RNG.rng
      : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
          ? window.RNGFallback.getRng()
          : Math.random));
    const tier = opts.tier ?? 2;
    const slots = ["hand", "head", "torso", "legs", "hands"];
    const slot = slots[Math.floor(rng() * slots.length)];
    return lootFactories.equipment(ctx, { ...opts, slot, tier });
  },
};

// Allow runtime registration of custom loot factories
export function registerLoot(name, fn) {
  if (!name || typeof fn !== "function") return false;
  lootFactories[name] = fn;
  return true;
}

// --- Chest helpers ---
function findSpotInStartRoom(ctx) {
  const r = ctx.startRoomRect;
  if (!r) return { x: ctx.player.x, y: ctx.player.y };
  const prefers = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];
  for (const d of prefers) {
    const x = ctx.player.x + d.dx, y = ctx.player.y + d.dy;
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) {
      if (ctx.inBounds(x, y) && ctx.map[y][x] === ctx.TILES.FLOOR &&
          !(ctx.player.x === x && ctx.player.y === y) &&
          !ctx.enemies.some(e => e.x === x && e.y === y)) {
        return { x, y };
      }
    }
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (ctx.inBounds(x, y) && ctx.map[y][x] === ctx.TILES.FLOOR &&
          !(ctx.player.x === x && ctx.player.y === y) &&
          !ctx.enemies.some(e => e.x === x && e.y === y)) {
        return { x, y };
      }
    }
  }
  return { x: ctx.player.x, y: ctx.player.y };
}

function makeChestAt(ctx, x, y, loot, announce = true) {
  if (!Array.isArray(ctx.corpses)) ctx.corpses = [];
  ctx.corpses.push({ kind: "chest", x, y, loot: loot.slice(), looted: false });
  if (announce && typeof ctx.log === "function") {
    ctx.log("You notice a chest nearby.", "good");
  }
}

// Generic chest spawner
// options: {
//   where: "start" | {x,y} | function(ctx) -> {x,y}
//   tier: 1|2|3 (default 2)
//   decayAll: number|undefined (default 99)  // set for equipment items
//   loot: array of strings (names in lootFactories) or functions (ctx, opts) -> item
//   announce: boolean (default true)
// }
export function spawnChest(ctx, options = {}) {
  const opts = Object.assign({ where: "start", tier: 2, decayAll: 99, loot: [], announce: true }, options);
  let pos;
  if (typeof opts.where === "function") pos = opts.where(ctx);
  else if (opts.where === "start") pos = findSpotInStartRoom(ctx);
  else if (opts.where && typeof opts.where === "object") pos = { x: opts.where.x, y: opts.where.y };
  else pos = findSpotInStartRoom(ctx);

  const loot = [];
  for (const entry of opts.loot) {
    if (typeof entry === "function") {
      const it = entry(ctx, { tier: opts.tier, decayAll: opts.decayAll });
      if (it) loot.push(it);
    } else if (typeof entry === "string" && lootFactories[entry]) {
      const it = lootFactories[entry](ctx, { tier: opts.tier, decayAll: opts.decayAll });
      if (it) loot.push(it);
    }
  }
  makeChestAt(ctx, pos.x, pos.y, loot, opts.announce);
}

// Backward-compatible starter chest
export function placeChestInStartRoom(ctx) {
  if (!ctx || !ctx.startRoomRect) return;
  if (!Array.isArray(ctx.corpses)) ctx.corpses = [];
  const already = ctx.corpses.find(c => c && c.kind === "chest");
  if (already) return;
  spawnChest(ctx, {
    where: "start",
    tier: 2,
    decayAll: 99,
    loot: ["potion", "armor", "handWeapon"],
    announce: true,
  });
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.DungeonItems = {
    // API
    spawnChest,
    placeChestInStartRoom,
    registerLoot,
    lootFactories,
  };
}