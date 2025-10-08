# smoketest/helpers

Shared helper modules actually used by the orchestrator and scenarios.

Files
- dom.js — safe element getters, click/set helpers, key dispatch, polling (waitUntilTrue), sleep.
- budget.js — shared SmokeTest.Config and deadline-based budget helper.
- logging.js — banner/status/log/panel helpers.
- movement.js — routing helpers (routeTo, routeAdjTo, bumpToward).

Notes
- Loaded before capabilities/reporting/runner/scenarios by index.html when `?smoketest=1`.