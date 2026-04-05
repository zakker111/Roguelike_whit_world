(function () {
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Scenarios = window.SmokeTest.Scenarios || {};

  async function run(ctx) {
    const record = ctx.record || function () {};
    const recordSkip = ctx.recordSkip || function () {};

    try {
      const G = window.GameAPI || {};
      const getMode = (typeof G.getMode === "function") ? () => G.getMode() : () => null;

      // Preconditions
      if (getMode() !== "world") {
        recordSkip("Region scenario skipped (not in world)");
        return true;
      }

      const opened = (typeof ctx.ensureRegionOnce === "function") ? await ctx.ensureRegionOnce() : false;
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
