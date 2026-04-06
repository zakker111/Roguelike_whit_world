// Fishing modal wrappers (Hold-the-bar mini-game)

export function isFishingOpen() {
  try {
    return !!(typeof window !== 'undefined' && window.FishingModal && typeof window.FishingModal.isOpen === 'function' && window.FishingModal.isOpen());
  } catch (_) { return false; }
}

export function showFishing(ctx, opts) {
  try {
    if (typeof window !== 'undefined' && window.FishingModal && typeof window.FishingModal.show === 'function') {
      window.FishingModal.show(ctx, opts || {});
    }
  } catch (_) {}
}

export function hideFishing(ctx) {
  try {
    if (typeof window !== 'undefined' && window.FishingModal && typeof window.FishingModal.hide === 'function') {
      window.FishingModal.hide();
    }
  } catch (_) {}
}
