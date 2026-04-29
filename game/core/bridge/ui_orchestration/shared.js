export function U(ctx) {
  try {
    return ctx?.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
  } catch (_) {
    return null;
  }
}

export function IC(ctx) {
  try {
    return ctx?.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  } catch (_) {
    return null;
  }
}

export function GL() {
  try {
    return (typeof window !== "undefined" ? window.GameLoop : null);
  } catch (_) {
    return null;
  }
}

export function R() {
  try {
    return (typeof window !== "undefined" ? window.Render : null);
  } catch (_) {
    return null;
  }
}
