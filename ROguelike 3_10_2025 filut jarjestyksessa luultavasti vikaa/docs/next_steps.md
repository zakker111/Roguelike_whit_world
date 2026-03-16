# Next Engineering Steps

## Where we are now
Completed work that should be considered “baseline” going forward:

- **GMBridge modularization (Slice 1)**
  - Implementation lives in `core/bridge/gm_bridge/*`
  - Back-compat entrypoint preserved: `core/bridge/gm_bridge.js`
  - `window.GMBridge` attach happens in `core/bridge/gm_bridge/index.js`

- **UIOrchestration modularization (Slice A)**
  - Implementation lives in `core/bridge/ui_orchestration/*`
  - Back-compat entrypoint preserved: `core/bridge/ui_orchestration.js`
  - `window.UIOrchestration` attach happens in `core/bridge/ui_orchestration/index.js`

- **UIBridge modularization (Slice B)**
  - Implementation lives in `core/bridge/ui_bridge/*`
  - Back-compat entrypoint preserved: `core/bridge/ui_bridge.js`
  - `window.UIBridge` attach happens in `core/bridge/ui_bridge/index.js`

- **Boot / load-order cleanup (Slice C)**
  - `src/main.js` now imports grouped boot manifests under `src/boot/*`
  - Module evaluation order preserved (boot manifests contain imports only)

- **Incremental `core/game.js` shrink (low risk)**
  - Extracted player creation into `core/engine/player_boot.js`
  - Extracted RNG init/seed read into `core/engine/rng_boot.js`
  - `core/game.js` now uses those helpers (behavior-preserving refactor)

- **CI now includes acceptance gates**
  - `.github/workflows/ci.yml` runs:
    - `npm run lint:strict`
    - `npm run build`
    - `npm run acceptance:phase6`
    - `npm run acceptance:phase0`

## Next planned tasks (recommended order)

### 1) Keep quality gates green
Run the exact gates locally (or rely on CI for the authoritative signal):

```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Acceptance criteria:
- No new lint warnings/errors
- No bundling/runtime import errors
- Phase 6 + Phase 0 scenarios pass

### 2) Lock down post-split invariants (GMBridge + UIOrchestration + UIBridge)
Small hygiene items to prevent regressions:

- **Import rule (GMBridge):** from outside `core/bridge/gm_bridge/*`, only import `core/bridge/gm_bridge.js`.
- **Import rule (UIOrchestration):** from outside `core/bridge/ui_orchestration/*`, only import `core/bridge/ui_orchestration.js`.
- **Import rule (UIBridge):** from outside `core/bridge/ui_bridge/*`, only import `core/bridge/ui_bridge.js`.
- Ensure each global attach occurs exactly once:
  - `window.GMBridge` from `core/bridge/gm_bridge/index.js`
  - `window.UIOrchestration` from `core/bridge/ui_orchestration/index.js`
  - `window.UIBridge` from `core/bridge/ui_bridge/index.js`

### 3) Next slice choice
Pick exactly one “next slice” (recommended order):

- **A. Continue shrinking `core/game.js`**: extract one policy block at a time into `core/engine/*`.
- **B. UI-level modularization**: if any UI modules remain huge (e.g. `ui/ui.js`), pick a thin refactor slice.

Recommended default if no preference: **A (shrink `core/game.js`)**.

### 4) Optional repo hygiene: add a lockfile
If you want fully deterministic CI installs and faster caches:
- commit a `package-lock.json` and switch CI back to `npm ci`

## Notes / constraints
- This plan assumes we keep the current module style (**globals + ctx hybrid**) and do not change hosting/import strategy.
