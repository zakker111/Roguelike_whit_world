// game_shop_ops.js
// Extracted ShopService wrappers from core/game.js (Slice H).

export function createShopOps({ getCtx, modHandle }) {
  const ctx = () => (typeof getCtx === "function" ? getCtx() : null);

  function isShopOpenNow(shop = null) {
    const SS = typeof modHandle === "function" ? modHandle("ShopService") : null;
    if (SS && typeof SS.isShopOpenNow === "function") {
      return SS.isShopOpenNow(ctx(), shop || null);
    }
    return false;
  }

  function shopScheduleStr(shop) {
    const SS = typeof modHandle === "function" ? modHandle("ShopService") : null;
    if (SS && typeof SS.shopScheduleStr === "function") {
      return SS.shopScheduleStr(shop);
    }
    return "";
  }

  return { isShopOpenNow, shopScheduleStr };
}

// Back-compat naming to match the other game_*_ops modules.
export const createGameShopOps = createShopOps;
