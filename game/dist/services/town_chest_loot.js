/**
 * Shared town chest loot helper.
 *
 * NOTE: Behavior must match the original `awardChestLoot(ctx)` that lived in
 * `ui/components/lockpick_modal.js`.
 */

export function awardTownChestLoot(ctx) {
  if (!ctx || !ctx.player) return null;
  const result = { gold: 0, items: [] };
  try {
    const inv = ctx.player.inventory || (ctx.player.inventory = []);
    let rngFn = null;
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        rngFn = window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
      }
    } catch (_) {}
    if (!rngFn) rngFn = (typeof ctx.rng === "function") ? ctx.rng : Math.random;

    // Gold
    const goldAmount = 12 + Math.floor(rngFn() * 24); // 12–35
    if (goldAmount > 0) {
      let gold = inv.find(it => it && it.kind === "gold");
      if (!gold) {
        gold = { kind: "gold", amount: 0, name: "gold" };
        inv.push(gold);
      }
      gold.amount = (gold.amount | 0) + goldAmount;
      result.gold = goldAmount;
    }

    // Small chance for an equipment item
    let awardedItem = null;
    try {
      if (typeof window !== "undefined" && window.Items && typeof window.Items.createEquipment === "function") {
        const tRoll = rngFn();
        const tier = tRoll < 0.12 ? 2 : 1;
        awardedItem = window.Items.createEquipment(tier, rngFn) || null;
      }
    } catch (_) {}
    if (awardedItem) {
      inv.push(awardedItem);
      const desc = (ctx.describeItem && typeof ctx.describeItem === "function")
        ? ctx.describeItem(awardedItem)
        : (awardedItem.name || "something interesting");
      result.items.push(desc);
    }

    try {
      if (typeof ctx.updateUI === "function") ctx.updateUI();
      if (typeof ctx.rerenderInventoryIfOpen === "function") ctx.rerenderInventoryIfOpen();
    } catch (_) {}
  } catch (_) {}
  return result;
}
