# smoketest/runner

Core runner orchestration and lifecycle.

Files
- init.js — bootstraps the runner, installs console/error capture, exposes SmokeTest globals.
- runner.js — default orchestrator: coordinates the scenario pipeline, runSeries (honors `smokecount`), URL param parsing, budgets. Legacy fallback via `&legacy=1`.
- banner.js — handles the floating UI banner and GOD panel status injection.

Notes
- With `?smoketest=1`, runner.js auto‑runs the orchestrator after the game is ready.
- The legacy monolithic runner (`smoketest/smoketest_runner.js`) is only injected when `&legacy=1` is present.