# smoketest/core

Core runner orchestration and lifecycle.

Suggested files:
- init.js — bootstraps the runner, installs console/error capture, exposes SmokeTest globals.
- runner.js — coordinates runOnce/runSeries, budgets, URL param parsing.
- banner.js — handles the floating UI banner and GOD panel status injection.