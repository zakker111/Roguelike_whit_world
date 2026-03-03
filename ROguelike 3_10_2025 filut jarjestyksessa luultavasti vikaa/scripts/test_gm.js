/**
 * Node-based GM tests (no browser required).
 *
 * This intentionally uses no external test runner to keep the repo lightweight.
 * CI calls this via `npm test`.
 */

import { runGmSim } from "../core/gm/sim/gm_sim_core.js";

function fail(msg, extra) {
  // eslint-disable-next-line no-console
  console.error(msg);
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.error(extra);
  }
  process.exit(1);
}

// 1) Unit-style GMRuntime sim (pure GMRuntime calls)
{
  const report = runGmSim();
  // eslint-disable-next-line no-console
  console.log("[gm] gm_sim:", report.ok ? "PASS" : "FAIL");
  if (!report.ok) fail("gm_sim failed", report);
}

// 2) Integration-style emission sim (Modes.__gmEvent -> GMRuntime.onEvent + intents)
//    We provide a global `window` in Node so legacy attachGlobal() calls can expose Modes.
{
  // Provide a minimal browser-like global so `attachGlobal("Modes", ...)` works.
  // (This is only for tests; it does not ship to the browser build.)
  globalThis.window = globalThis;

  // Importing modes attaches `window.Modes` (including `__gmEvent`).
  await import("../core/modes/modes.js");

  const Modes = globalThis.Modes;
  if (!Modes || typeof Modes.__gmEvent !== "function") {
    fail("Modes.__gmEvent missing after importing core/modes/modes.js");
  }

  const { runGmEmissionSim } = await import("../core/gm/emission_sim.js");

  const report = runGmEmissionSim({ gmEvent: Modes.__gmEvent });
  // eslint-disable-next-line no-console
  console.log("[gm] gm_emission_sim:", report.ok ? "PASS" : (report.warning ? "WARN" : "FAIL"));

  if (!report.ok) fail("gm_emission_sim failed", report);
  if (report.warning) fail("gm_emission_sim produced a warning (treating as failure in CI)", report);
}

// eslint-disable-next-line no-console
console.log("[gm] all tests PASS");
