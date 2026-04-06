// Lockpicking modal wrappers (pin-grid lock mini-game)

export function isLockpickOpen() {
  try {
    return !!(typeof window !== 'undefined' && window.LockpickModal && typeof window.LockpickModal.isOpen === 'function' && window.LockpickModal.isOpen());
  } catch (_) { return false; }
}

export function showLockpick(ctx, opts) {
  try {
    if (typeof window !== 'undefined' && window.LockpickModal && typeof window.LockpickModal.show === 'function') {
      window.LockpickModal.show(ctx, opts || {});
    }
  } catch (_) {}
}

export function hideLockpick(ctx) {
  try {
    if (typeof window !== 'undefined' && window.LockpickModal && typeof window.LockpickModal.hide === 'function') {
      window.LockpickModal.hide();
    }
  } catch (_) {}
}
