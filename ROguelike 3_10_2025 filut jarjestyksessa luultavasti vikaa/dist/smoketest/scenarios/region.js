(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    const record = ctx.record || function () {};
    const recordSkip = ctx.recordSkip || function () {};

    try {
      const G = window.GameAPI || {};
      const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;

      if (typeof ctx.ensureRegionOnce !== "function") {
        recordSkip("Region scenario skipped (ensureRegionOnce unavailable)");
        return true;
      }

      const opened = await ctx.ensureRegionOnce();
      if (!opened || getMode() !== "region") {
        record(false, "Region open failed (mode=" + (getMode() || "unknown") + ")");
        return false;
      }
      record(true, "Region open: OK");

      const okExit = (typeof ctx.exitRegionToWorld === "function") ? await ctx.exitRegionToWorld() : false;
      if (!okExit) {
        record(false, "Region exit failed (mode=" + (getMode() || "unknown") + ")");
        return false;
      }
      record(true, "Region exit: OK");

      return true;
    } catch (e) {
      record(false, "Region scenario failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  window.SmokeTest.Scenarios.Region = { run };
})();
