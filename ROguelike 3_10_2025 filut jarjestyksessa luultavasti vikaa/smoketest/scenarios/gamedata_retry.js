(function () {
  // SmokeTest Scenario: GameData fetch retry/backoff
  // Simulates a transient fetch failure and verifies GameData.loadPalette succeeds via fetchJson retries.

  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  function has(fn) { try { return typeof fn === "function"; } catch (_) { return false; } }

  async function run(ctx) {
    const record = (ctx && ctx.record) || function () {};
    const recordSkip = (ctx && ctx.recordSkip) || function () {};

    const GD = (typeof window !== "undefined" ? window.GameData : null);
    if (!GD || !GD.ready || !has(GD.loadPalette)) {
      recordSkip("GameData retry skipped (GameData/loadPalette not available)");
      return true;
    }

    try { await GD.ready; } catch (_) {}

    const origFetch = (typeof window !== "undefined" ? window.fetch : null);
    if (!has(origFetch)) {
      recordSkip("GameData retry skipped (window.fetch not available)");
      return true;
    }

    let paletteCalls = 0;
    let injectedFail = 0;
    const prevPalette = (function () {
      try {
        const v = (typeof localStorage !== "undefined" && localStorage) ? (localStorage.getItem("PALETTE") || "default") : "default";
        return String(v || "default");
      } catch (_) {
        return "default";
      }
    })();

    function shouldIntercept(url) {
      try {
        const s = String(url || "");
        return s.indexOf("data/world/palette_alt.json") !== -1;
      } catch (_) {
        return false;
      }
    }

    try {
      window.fetch = function (url, opts) {
        if (shouldIntercept(url)) {
          paletteCalls += 1;
          if (paletteCalls === 1) {
            injectedFail += 1;
            return Promise.reject(new TypeError("smoketest injected network failure"));
          }
        }
        return origFetch(url, opts);
      };

      const ok = await GD.loadPalette("alt");
      record(!!ok, "GameData.loadPalette('alt') succeeds after transient fetch failure");
      record(injectedFail === 1, "GameData retry: injected failure hit exactly once");
      record(paletteCalls >= 2, "GameData retry: palette fetch attempted at least twice");
    } catch (e) {
      record(false, "GameData retry scenario failed: " + (e && e.message ? e.message : String(e)));
    } finally {
      try { window.fetch = origFetch; } catch (_) {}
      try {
        // Restore previous palette selection so other scenarios aren't affected.
        if (prevPalette && prevPalette !== "alt" && has(GD.loadPalette)) {
          await GD.loadPalette(prevPalette);
        }
      } catch (_) {}
    }

    return true;
  }

  window.SmokeTest.Scenarios.gamedata_retry = { run };
})();
