import { getGameData } from "../../utils/access.js";
import { parseHHMM } from "../../services/time_service.js";

/**
 * Compute minutes-of-day for shop schedules, delegating to ShopService when available.
 */
export function minutesOfDay(ctx, h, m = 0) {
  try {
    if (ctx && ctx.ShopService && typeof ctx.ShopService.minutesOfDay === "function") {
      return ctx.ShopService.minutesOfDay(h, m, 24 * 60);
    }
  } catch (_) {}
  return ((h | 0) * 60 + (m | 0)) % (24 * 60);
}

/**
 * Build a schedule object from a shop definition row (GameData.shops).
 * Mirrors the original scheduleFromData logic in town_gen.js.
 */
export function scheduleFromData(ctx, row) {
  if (!row) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
  if (row.alwaysOpen) return { openMin: 0, closeMin: 0, alwaysOpen: true };
  const o = parseHHMM(row.open);
  const c = parseHHMM(row.close);
  if (o == null || c == null) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
  return { openMin: o, closeMin: c, alwaysOpen: false };
}

/**
 * Load shop definitions from GameData (or use the legacy fallback list).
 * This is the data source for town shop selection when strict prefabs are not enforced.
 */
export function loadShopDefs(ctx, strictNow) {
  const GD9 = getGameData(ctx);
  let shopDefs = strictNow
    ? []
    : ((GD9 && Array.isArray(GD9.shops)) ? GD9.shops.slice(0) : [
        { type: "inn",        name: "Inn",        alwaysOpen: true },
        { type: "blacksmith", name: "Blacksmith", open: "08:00", close: "17:00" },
        { type: "apothecary", name: "Apothecary", open: "09:00", close: "18:00" },
        { type: "armorer",    name: "Armorer",    open: "08:00", close: "17:00" },
        { type: "trader",     name: "Trader",     open: "08:00", close: "18:00" },
      ]);

  try {
    const idxInn = shopDefs.findIndex(d =>
      String(d.type || "").toLowerCase() === "inn" ||
      /inn/i.test(String(d.name || ""))
    );
    if (idxInn > 0) {
      const innDef = shopDefs.splice(idxInn, 1)[0];
      shopDefs.unshift(innDef);
    }
  } catch (_) {}

  return shopDefs;
}

/**
 * Vary number of shops by town size (small/big/city).
 * Directly moved from town_gen.js.
 */
export function shopLimitBySize(sizeKey) {
  if (sizeKey === "small") return 3;
  if (sizeKey === "city")  return 8;
  return 5; // big
}

/**
 * Compute presence chance for a shop definition given town size, using
 * def.chanceBySize when available, otherwise the legacy defaults.
 */
export function chanceFor(def, sizeKey) {
  try {
    const c = def && def.chanceBySize ? def.chanceBySize : null;
    if (c && typeof c[sizeKey] === "number") {
      const v = c[sizeKey];
      return (v < 0 ? 0 : (v > 1 ? 1 : v));
    }
  } catch (_) {}
  // Defaults if not specified in data
  if (sizeKey === "city") return 0.75;
  if (sizeKey === "big")  return 0.60;
  return 0.50; // small
}

/**
 * Fisher–Yates shuffle used for shop sampling. Uses rng() passed in from caller.
 */
export function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}