/**
 * Apply persisted preferences to DOM before UI initialization.
 * Currently: hide the right-side live log mirror when LOG_MIRROR is false.
 * Runs immediately on module load.
 */
(function () {
  try {
    const el = document.getElementById('log-right');
    if (el && window.LOG_MIRROR === false) {
      el.style.display = 'none';
    }
  } catch (_) {}
})();