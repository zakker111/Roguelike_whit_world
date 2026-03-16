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
  - Extracted combat + inventory wrapper boilerplate into:
    - `core/engine/game_combat_ops.js`
    - `core/engine/game_inventory_ops.js`
  - Extracted bounds + walkability policy into:
    - `core/engine/game_map_ops.js`
  - Extracted render pipeline into:
    - `core/engine/render_orchestration.js` (build render ctx)
    - `core/engine/game_loop.js` (RAF + draw batching)
    - `core/engine/game_render_ops.js` (core/game.js wrappers: getRenderCtx + requestDraw)
  - Extracted time wrappers into:
    - `core/engine/game_time_ops.js` (core/game.js wrappers: minutesUntil + advanceTimeMinutes + fastForwardMinutes)
  - **Extracted loot ops + panel routing (Slice F)** into:
    - `core/loot_flow.js` (exports + `window.LootFlow`)
    - `core/game.js` loot wrappers now delegate to `LootFlow.show/hide/loot`
  - **Extracted mode transition + exit wrappers (Slice G)** into:
    - `core/engine/game_mode_ops.js`
    - `core/game.js` mode wrappers now delegate to `modeOps.*`
  - **Extracted shop wrappers (Slice H)** into:
    - `core/engine/game_shop_ops.js`
    - `core/game.js` shop wrappers now delegate to `shopOps.*`

- **CI quality gates**
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
- Phase 6 + Phase 0 acceptance harness pass

### 2) Lock down post-split invariants (GMBridge + UIOrchestration + UIBridge)
Small hygiene items to prevent regressions:

- **Import rule (GMBridge):** from outside `core/bridge/gm_bridge/*`, only import `core/bridge/gm_bridge.js`.
- **Import rule (UIOrchestration):** from outside `core/bridge/ui_orchestration/*`, only import `core/bridge/ui_orchestration.js`.
- **Import rule (UIBridge):** from outside `core/bridge/ui_bridge/*`, only import `core/bridge/ui_bridge.js`.
- Ensure each global attach occurs exactly once:
  - `window.GMBridge` from `core/bridge/gm_bridge/index.js`
  - `window.UIOrchestration` from `core/bridge/ui_orchestration/index.js`
  - `window.UIBridge` from `core/bridge/ui_bridge/index.js`

### 3) Next slice (recommended): core/game.js shrink — World Ops (Slice J)
`core/game.js` still contains a couple of thin world wrappers that are ideal for extraction:

- `initWorld()` (WorldRuntime.generate + refresh)
- `startEscortAutoTravel()` (WorldRuntime.startEscortAutoTravel)

Proposed low-risk slice:
1. Create `core/engine/game_world_ops.js` exporting `createWorldOps({ getCtx, applyCtxSyncAndRefresh, modHandle, MAP_COLS, MAP_ROWS })`.
2. Move wrappers into it (behavior-identical).
3. In `core/game.js`, instantiate once and delegate (keep ctx/GameAPI surface unchanged).

Reference doc:
- `docs/game_js_shrink_slice_world_ops.md`

### 4) Optional repo hygiene: add a lockfile
If you want fully deterministic CI installs and faster caches:
- commit a `package-lock.json` and switch CI to `npm ci`) Immediate: keep the latest hotfix green (v1.50.36)
The most recent change was a low-risk refactor + follow-up hotfix:
- Time wrappers moved behind `core/engine/game_time_ops.js`
- Hotfix: restore missing `createGameShopOps` import in `core/game.js`

Next action:
- Re-run the standard gates (CI or local) and ensure **no boot-time ReferenceErrors**.

### 4) Recommended repo hygiene: add a lockfile
For deterministic CI installs and fewer “it works locally” surprises:
- commit `package-lock.json`
- switch CI to `npm ci`

### 5) Next refactor slice (pick one)
Default recommendation: **Workstream 1.3 (barrels)**, because it is low risk and reduces import noise.

- **Option A (recommended): Workstream 1.3 — folder barrels**
  - Add `core/engine/index.js`, `core/bridge/index.js`, `services/index.js`
  - Rule: barrels export *stable public surfaces only*

- **Option B: Workstream 2.1 — ctx service registry**
  - Introduce `ctx.mods`/`ctx.services` as canonical lookup
  - Make `getMod(ctx, name)` prefer `ctx.mods[name]`

## Notes / constraints
- This plan assumes we keep the current module style (**globals + ctx hybrid**) and do not change hosting/import strategy.
