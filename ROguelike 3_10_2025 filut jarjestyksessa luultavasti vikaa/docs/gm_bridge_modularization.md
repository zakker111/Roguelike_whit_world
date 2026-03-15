# GMBridge Modularization Plan (Slice 1)

## Goal
Split `core/bridge/gm_bridge.js` into smaller, cohesive modules **without changing runtime behavior**, and keep all current call sites working (notably `core/world/move.js`, `core/modes/actions.js`, `core/world/scan_pois.js`).

This is the first “low-risk” modularization slice because it is mostly **file organization** + **dependency hygiene**, and it has strong regression coverage via:
- `npm run acceptance:phase6`
- `npm run acceptance:phase0`

## Constraints (locked)
- Keep JavaScript.
- Keep absolute imports elsewhere (`/core/...`) unchanged.
- Preserve the current external import path: **`core/bridge/gm_bridge.js`**.
- Preserve the current public API surface.

## Current GMBridge API surface (must remain stable)
`core/bridge/gm_bridge.js` currently exports and attaches on `window.GMBridge`:
- `maybeHandleWorldStep(ctx)`
- `handleMarkerAction(ctx)`
- `useInventoryItem(ctx, item, idx)`
- `onEncounterComplete(ctx, info)`
- `onWorldScanRect(ctx, { x0, y0, w, h })`
- `onWorldScanTile(ctx, { wx, wy, tile })`
- `ensureGuaranteedSurveyCache(ctx)`
- `reconcileMarkers(ctx)`
- `maybeAwardBottleMapFromFishing(ctx)`

## Proposed module layout
Create a directory with focused files:

```
core/bridge/gm_bridge/
  index.js                 # public exports + attachGlobal("GMBridge", ...)
  shared.js                # small shared helpers (pure or near-pure)
  world_scan.js            # onWorldScanRect/onWorldScanTile/ensureGuaranteedSurveyCache
  world_step.js            # maybeHandleWorldStep + guard_fine + travel encounter confirm
  markers.js               # handleMarkerAction + marker dispatch + gm.* marker lookup
  bottle_map.js            # bottle-map helpers: reconcile plan + marker handler
  survey_cache.js          # survey-cache marker handler + marker removal helper
  encounters.js            # onEncounterComplete
  inventory.js             # useInventoryItem
```

And convert the old file into a stable compatibility shim:

```
core/bridge/gm_bridge.js    # re-export from gm_bridge/index.js ONLY
```

### Why this split works in this repo
- `core/world/move.js` imports `../bridge/gm_bridge.js` directly. Keeping this file as the stable “entry” avoids touching high-risk movement code.
- GMBridge is already conceptually split in the file by responsibility (scan hooks, world-step hooks, markers, inventory, encounter completion), so the separation matches existing boundaries.

## Responsibility boundaries (what goes where)

### `shared.js`
Keep these here to prevent cycles:
- `isGmEnabled(ctx)`
- `applySyncAfterGmTransition(ctx)`
- `hasEncounterTemplate(ctx, id)`

Rule: keep `shared.js` as dependency-light (only `getGameData/getMod` imports), so all other modules can depend on it.

### `world_step.js`
Owns:
- `maybeHandleWorldStep(ctx)`
- `handleGuardFineTravelEvent(ctx, GM)`

Notes:
- Must keep the “single sync boundary” rule respected (GMBridge itself calls `applySyncAfterGmTransition(ctx)` in some flows, and movement applies it if mode changed).
- Must keep the “template readiness” gate (`hasEncounterTemplate`) for travel encounter intents.

### `markers.js`
Owns:
- `handleMarkerAction(ctx)`
- `findGmMarkerAtPlayer(ctx)`

Dispatches to:
- bottle map marker handler
- survey cache marker handler

### `bottle_map.js`
Owns:
- `reconcileMarkers(ctx)` implementation pieces for bottle map (plan extraction + apply)
- `handleBottleMapMarker(ctx, marker)`
- `maybeAwardBottleMapFromFishing(ctx)`

### `survey_cache.js`
Owns:
- `handleSurveyCacheMarker(ctx, marker)`
- `removeSurveyCacheMarker(ctx, MS, { instanceId, absX, absY })`

### `encounters.js`
Owns:
- `onEncounterComplete(ctx, info)`

### `inventory.js`
Owns:
- `useInventoryItem(ctx, item, idx)`

## Implementation steps (exact order)

### Step 0: mechanical safety checks
- Confirm no module imports `core/bridge/gm_bridge/index.js` directly.
  - Policy: **only import `core/bridge/gm_bridge.js` from outside the gm_bridge folder**.
  - This avoids double-instantiation via different ESM specifiers.

### Step 1: create new folder + `shared.js`
- Create `core/bridge/gm_bridge/shared.js`.
- Move/copy helper functions (`isGmEnabled`, `applySyncAfterGmTransition`, `hasEncounterTemplate`) into it.
- Export them (named exports).

### Step 2: split modules one-by-one
For each new module:
- copy code from the current file
- adjust relative imports (`../../..`) as needed
- export the function(s) as named exports
- keep function names the same to preserve stack traces

Recommended sequence to minimize dependency churn:
1. `survey_cache.js` (self-contained)
2. `bottle_map.js` (largest internal helper set)
3. `markers.js` (depends on bottle_map + survey_cache)
4. `world_scan.js` (depends on survey_cache state helpers only)
5. `inventory.js` (depends on bottle_map helpers)
6. `encounters.js` (depends on survey_cache + bottle_map helpers)
7. `world_step.js` (depends on shared + startGmFactionEncounter)

### Step 3: add `core/bridge/gm_bridge/index.js`
- Re-export the stable API surface:
  - `export { maybeHandleWorldStep } from './world_step.js'` etc.
- Call `attachGlobal('GMBridge', { ... })` **here**.
- Ensure `attachGlobal` happens exactly once.

### Step 4: turn `core/bridge/gm_bridge.js` into a shim
Replace the file contents with:
- `export * from './gm_bridge/index.js';`

Do not attach globals from this shim.

### Step 5: run QA gates
Run in this order (fastest signal first):
1. `npm run lint:strict`
2. `npm run build`
3. `npm run acceptance:phase6`
4. `npm run acceptance:phase0`

## Known risks + mitigations

### Risk: ESM double-instantiation via different specifiers
If some code imports both:
- `../bridge/gm_bridge.js`
- `../bridge/gm_bridge/index.js`

…then the attachGlobal side-effect could run twice.

Mitigation:
- “External import rule” above.
- Keep `index.js` as an internal detail.

### Risk: circular dependencies between marker logic and bottle-map helpers
Mitigation:
- keep `shared.js` small and dependency-light
- keep bottle-map reconcile helpers inside `bottle_map.js` (called from both world-step + marker paths)

### Risk: relative import mistakes when moving files
Mitigation:
- move in small commits
- rely on `npm run build` as a fast failure detector (missing file paths are immediate)

## Acceptance criteria for this slice
- No changes required in `core/world/move.js`, `core/modes/actions.js`, or `core/world/scan_pois.js`.
- Phase 6 and Phase 0 acceptance runs remain green.
- `window.GMBridge` exists and exposes the same keys.
- No additional boot-time console errors.

## Follow-on opportunities (after the split)
Once this is done, we can simplify the code further with very low risk:
- Extract bottle-map reconcile plan normalization into a dedicated helper module (pure functions).
- Standardize confirm prompts via a tiny helper (`showGmConfirm(ctx, spec)`), reducing repeated try/catch.
- Add a small smoketest helper for confirm handling (already repeated across multiple GM scenarios).
