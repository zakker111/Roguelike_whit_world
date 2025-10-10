# smoketest/runner

Core runner orchestration and lifecycle.

Files
- init.js — bootstraps the runner, installs console/error capture, exposes SmokeTest globals.
- runner.js — default orchestrator: coordinates the scenario pipeline, runSeries (honors `smokecount`), URL param parsing, budgets. Skips auto‑run when `&legacy=1` is present. Uses consolidated readiness checks.
- banner.js — handles the floating UI banner and GOD panel status injection.
- smoketest_runner.js — legacy thin shim that delegates to the orchestrator (`SmokeTest.Run.run` / `runSeries`). No inline scenario logic.

Notes
- With `?smoketest=1` and without `&legacy=1`, runner.js auto‑runs the orchestrator after readiness:
  - waitUntilRunnerReady(timeout) verifies mode/player, scenarios loaded, UI baseline (GOD control), and canvas present.
- Exit/seeding hardening in `applyFreshSeedForRun`:
  - Closes all modals and keeps GOD panel hidden during exit and seeding to avoid swallowed keys.
  - Prefers Teleport helpers to leave town/dungeon (teleport exactly to gate/stairs, nudge if adjacent, press `g`, call API fallback, verify mode).
  - Final fallback calls `GameAPI.forceWorld()` to guarantee overworld before seeding.
  - Reopens GOD only after seed application is confirmed and mode is `world`.
- New/Documented URL params recognized by runner:
  - `&smokecount=N` — number of runs in the series.
  - `&scenarios=csv` — explicit scenario list; otherwise default order is used.
  - `&skipokafter=N` — once a scenario has passed in N runs, it is skipped in later runs.
  - `&persistence=once|always|never` — frequency for the dungeon persistence scenario.
  - `&seed=BASE` — base RNG seed used to derive per‑run seeds deterministically.
  - `&abortonimmobile=1` — abort current run on immobile detection; otherwise records and continues.
  - `&dev=1` — enable DEV logs.
  - `&legacy=1` — load legacy shim; orchestrator does not auto‑run.