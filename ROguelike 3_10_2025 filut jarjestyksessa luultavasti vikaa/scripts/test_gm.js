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

const VOLATILE_KEYS = new Set(["createdAt", "ms", "stack"]);

function stripVolatile(v) {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (!v || typeof v !== "object") return v;

  const out = {};
  for (const k of Object.keys(v)) {
    if (VOLATILE_KEYS.has(k)) continue;
    out[k] = stripVolatile(v[k]);
  }
  return out;
}

function findMismatch(a, b, path = "$") {
  if (Object.is(a, b)) return null;

  const ta = Array.isArray(a) ? "array" : (a === null ? "null" : typeof a);
  const tb = Array.isArray(b) ? "array" : (b === null ? "null" : typeof b);
  if (ta !== tb) return { path, a, b };

  if (ta === "array") {
    if (a.length !== b.length) return { path: `${path}.length`, a: a.length, b: b.length };
    for (let i = 0; i < a.length; i++) {
      const m = findMismatch(a[i], b[i], `${path}[${i}]`);
      if (m) return m;
    }
    return null;
  }

  if (ta === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return { path: `${path}.{keys}`, a: ka, b: kb };
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return { path: `${path}.{keys}[${i}]`, a: ka[i], b: kb[i] };
    }
    for (const k of ka) {
      const m = findMismatch(a[k], b[k], `${path}.${k}`);
      if (m) return m;
    }
    return null;
  }

  return { path, a, b };
}

function assertDeterministic(label, a, b) {
  const sa = stripVolatile(a);
  const sb = stripVolatile(b);
  const m = findMismatch(sa, sb);
  if (!m) return;
  fail(`[gm] determinism regression in ${label}: mismatch at ${m.path}`, { a: m.a, b: m.b });
}

// 1) Unit-style GMRuntime sim (pure GMRuntime calls)
{
  const report1 = runGmSim();
  const report2 = runGmSim();

  // eslint-disable-next-line no-console
  console.log("[gm] gm_sim:", report1.ok ? "PASS" : "FAIL");
  if (!report1.ok) fail("gm_sim failed", report1);
  if (!report2.ok) fail("gm_sim failed (2nd run)", report2);

  assertDeterministic("gm_sim", report1, report2);
  // eslint-disable-next-line no-console
  console.log("[gm] gm_sim determinism:", "PASS");
}

// 2) Integration-style emission sim (Modes.__gmEvent -> GMRuntime.onEvent + intents)
//    We provide a global `window` in Node so legacy attachGlobal() calls can expose Modes.
{
  // Provide a minimal browser-like global so `attachGlobal(\"Modes\", ...)` works.
  // (This is only for tests; it does not ship to the browser build.)
  globalThis.window = globalThis;

  // Importing modes attaches `window.Modes` (including `__gmEvent`).
  await import("../core/modes/modes.js");

  const Modes = globalThis.Modes;
  if (!Modes || typeof Modes.__gmEvent !== "function") {
    fail("Modes.__gmEvent missing after importing core/modes/modes.js");
  }

  const { runGmEmissionSim } = await import("../core/gm/emission_sim.js");

  const report1 = runGmEmissionSim({ gmEvent: Modes.__gmEvent });
  const report2 = runGmEmissionSim({ gmEvent: Modes.__gmEvent });

  // eslint-disable-next-line no-console
  console.log("[gm] gm_emission_sim:", report1.ok ? "PASS" : (report1.warning ? "WARN" : "FAIL"));

  if (!report1.ok) fail("gm_emission_sim failed", report1);
  if (report1.warning) fail("gm_emission_sim produced a warning (treating as failure in CI)", report1);
  if (!report2.ok) fail("gm_emission_sim failed (2nd run)", report2);
  if (report2.warning) fail("gm_emission_sim produced a warning (treating as failure in CI) (2nd run)", report2);

  assertDeterministic("gm_emission_sim", report1, report2);
  // eslint-disable-next-line no-console
  console.log("[gm] gm_emission_sim determinism:", "PASS");
}

// eslint-disable-next-line no-console
console.log("[gm] all tests PASS");
