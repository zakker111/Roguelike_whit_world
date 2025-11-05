/**
 * Normalize preview path issues: if the page is loaded as /index.html/index.html,
 * redirect to a single /index.html to avoid broken relative imports.
 * Runs immediately on module load.
 */
(function () {
  try {
    const p = String(location.pathname || '');
    if (p.indexOf('/index.html/index.html') !== -1) {
      const url = new URL(location.href);
      url.pathname = '/index.html';
      location.replace(url.toString());
    }
  } catch (_) {}
})();