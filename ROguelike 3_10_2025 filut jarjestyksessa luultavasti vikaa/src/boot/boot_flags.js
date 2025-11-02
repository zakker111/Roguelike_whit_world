/**
 * Boot flags and persisted preferences:
 * - ?dev=1 sets DEV mode and persists to localStorage
 * - ?dev=0 clears DEV mode
 * - ?mirror=1 or ?mirror=0 toggles side log mirror and persists
 * Also restores persisted values when params absent.
 * Runs immediately on module load.
 */
(function () {
  try {
    const params = new URLSearchParams(location.search);

    // DEV flag
    if (params.get('dev') === '1') { window.DEV = true; localStorage.setItem('DEV', '1'); }
    if (params.get('dev') === '0') { window.DEV = false; localStorage.removeItem('DEV'); }
    if (localStorage.getItem('DEV') === '1') window.DEV = true;

    // Side log mirror
    if (params.get('mirror') === '1') { window.LOG_MIRROR = true; localStorage.setItem('LOG_MIRROR', '1'); }
    if (params.get('mirror') === '0') { window.LOG_MIRROR = false; localStorage.setItem('LOG_MIRROR', '0'); }

    if (typeof window.LOG_MIRROR === 'undefined') {
      const m = localStorage.getItem('LOG_MIRROR');
      if (m === '1') window.LOG_MIRROR = true;
      else if (m === '0') window.LOG_MIRROR = false;
      // default: enabled unless user turned it off
    }
  } catch (_) {}
})();