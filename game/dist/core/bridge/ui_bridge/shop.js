export function isShopOpen() {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.isOpen === "function") {
      return !!window.ShopUI.isOpen();
    }
  } catch (_) {}
  return false;
}

export function showShop(ctx, npc) {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.openForNPC === "function") {
      window.ShopUI.openForNPC(ctx, npc);
      return;
    }
  } catch (_) {}
}

export function hideShop(ctx) {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.hide === "function") {
      window.ShopUI.hide();
      return;
    }
  } catch (_) {}
}

export function buyShopIndex(ctx, idx) {
  try {
    if (typeof window !== "undefined" && window.ShopUI && typeof window.ShopUI.buyIndex === "function") {
      window.ShopUI.buyIndex(ctx, idx);
    }
  } catch (_) {}
}
