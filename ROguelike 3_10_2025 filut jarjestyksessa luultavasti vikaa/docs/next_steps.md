# Next Engineering Steps

## Where we are now
Completed work that should be considered “baseline” going forward:

- **GMBridge modularization (Slice 1)**
  - Implementation lives in `core/bridge/gm_bridge/*`
  - Back-compat entrypoint preserved: `core/bridge/gm_bridge.js`
  - `window.GMBridge` attach happens in `core/bridge/gm_bridge/index.js`

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

### 1) Confirm quality gates are green
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

### 2) Lock down post-split invariants for GMBridge
Small hygiene items to prevent regressions:

- **Import rule:** from outside `core/bridge/gm_bridge/*`, only import `core/bridge/gm_bridge.js`.
- Ensure `window.GMBridge` is attached exactly once (only from `core/bridge/gm_bridge/index.js`).

### 3) If CI fails: fix the failure with the smallest behavior-preserving change
Common failure buckets to check first:
- Playwright missing browser deps in CI (should be solved by `npx playwright install --with-deps chromium`)
- Accidental double-sync on mode transition (Phase 6 is sensitive to this)
- Missing export in the GMBridge shim (call sites expect named exports)

### 4) Choose the next modularization slice
After gates are green, pick exactly one “next slice”:

- **A. UI Bridge cleanup**: split `core/bridge/ui_orchestration.js` into focused submodules.
- **B. Continue shrinking `core/game.js`**: extract one policy block at a time into `core/engine/*`.
- **C. Boot/load order cleanup**: reduce `src/main.js` import manifest by grouping into domain boot modules.

Recommended default if no preference: **A (UI Bridge cleanup)**.

## Notes / constraints
- This plan assumes we keep the current module style (**globals + ctx hybrid**) and do not change hosting/import strategy.
