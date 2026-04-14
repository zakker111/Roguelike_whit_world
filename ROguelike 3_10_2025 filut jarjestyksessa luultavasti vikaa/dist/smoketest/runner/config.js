const DEFAULT_SCENARIOS = "world,region,encounters,dungeon,dungeon_stairs_transitions,inventory,combat,town,overlays,determinism";
const GM_PHASE6_SCENARIOS = "gm_seed_reset,gm_boredom_interest,gm_bridge_faction_travel,gm_bridge_markers,gm_bottle_map,gm_survey_cache";

export function parseParams() {
  try {
    const u = new URL(window.location.href);
    const p = (name, def) => u.searchParams.get(name) || def;

    // Convenience selectors (avoid copying long scenario lists).
    // gmphase6=1 maps to the GM v0.3 pipeline doc Phase-6 acceptance set.
    const gmPhase6 = (p("gmphase6", "0") === "1");

    // Support both legacy "smoke" and new "scenarios" params
    const legacySel = (p("smoke", "") || "").trim();

    let sel = legacySel
      ? legacySel
      : p("scenarios", DEFAULT_SCENARIOS);

    if (gmPhase6) {
      sel = GM_PHASE6_SCENARIOS;
    }

    return {
      smoketest: p("smoketest", "0") === "1",
      dev: p("dev", "0") === "1",
      smokecount: Number(p("smokecount", "1")) || 1,
      legacy: p("legacy", "0") === "1",
      // Optional: disable orchestrator auto-run so headless harnesses can call runSeries() explicitly.
      autorun: p("autorun", "1") !== "0",
      scenarios: sel.split(",").map(s => s.trim()).filter(Boolean),
      // New: skip scenarios after they have passed a given number of runs (0 = disabled)
      skipokafter: Number(p("skipokafter", "0")) || 0,
      // Control dungeon persistence scenario frequency: "once" (default), "always", or "never"
      persistence: (p("persistence", "once") || "once").toLowerCase(),
      // Optional base seed override; if provided, seeds are derived deterministically per run
      seed: (function() {
        const v = p("seed", "");
        if (!v) return null;
        const n = Number(v);
        return Number.isFinite(n) ? (n >>> 0) : null;
      })(),
      // Abort current run as soon as an immobile condition is detected in any scenario (default: disabled)
      abortonimmobile: (p("abortonimmobile", "0") === "1"),
      // Guard against a scenario promise hanging forever inside runSeries().
      scenariotimeoutms: Math.max(5000, Number(p("scenariotimeoutms", "45000")) || 45000)
    };
  } catch (_) {
    return {
      smoketest: false,
      dev: false,
      smokecount: 1,
      legacy: false,
      autorun: true,
      scenarios: [],
      skipokafter: 0,
      persistence: "once",
      seed: null,
      abortonimmobile: false,
      scenariotimeoutms: 45000
    };
  }
}
