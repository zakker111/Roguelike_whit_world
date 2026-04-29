# smoketest/capabilities

Capability detection and diagnostics.

Files
- detect.js — central GameAPI capability map (e.g., getMode, routeTo, gotoNearestTown, getEnemies, getPerf). Used by the orchestrator and scenarios.
- rng_audit.js — DEV‑only audit that surfaces RNG source and heuristic Math.random mentions. Runs when `?dev=1` (or `localStorage.DEV = "1"`).

Notes
- Loaded before runner; `detect()` is the single source of truth for caps.
- `rng_audit.js` is optional; the orchestrator calls it at the start of a run when DEV mode is enabled.