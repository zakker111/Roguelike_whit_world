# smoketest/runner

Core runner orchestration and lifecycle.

Files
- init.js — bootstraps the runner, installs console/error capture, exposes SmokeTest globals.
- runner.js — default orchestrator: coordinates the scenario pipeline, runSeries (honors `smokecount`), URL param parsing, budgets. Skips auto‑run when `&legacy=1` is present.
- banner.js — handles the floating UI banner and GOD panel status injection.
- smoketest_runner.js — legacy thin shim that delegates to the orchestrator (`SmokeTest.Run.run` / `runSeries`). No inline scenario logic.

Notes
- With `?smoketest=1` and without `&legacy=1`, runner.js auto‑runs the orchestrator after the game is ready.
- In legacy mode (`?smoketest=1&legacy=1`), the thin shim is injected, and the orchestrator does not auto‑run; the shim invokes the orchestrator.