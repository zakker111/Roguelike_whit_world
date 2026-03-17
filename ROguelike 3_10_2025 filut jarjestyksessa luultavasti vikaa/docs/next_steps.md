# Next Engineering Steps

For the day-to-day workflow for making changes in small, manageable phases (“slices”), see:
- `docs/phase_workflow.md`

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
  - `src/main.js` imports grouped boot manifests under `src/boot/*`
  - Module evaluation order preserved (boot manifests contain imports only)
  - Boot manifests use barrels as import aggregators where it helps keep lists short:
    - `src/boot/06_services.js` imports `'/services/index.js'`
    - `src/boot/11_runtime_orchestration.js` imports `'/core/bridge/index.js'`

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
    - `npm run check:docs-catalog`
    - `npm run build`
    - `npm run acceptance:phase6`
    - `npm run acceptance:phase0`

- **Repo hygiene**
  - Removed stray duplicate top-level folder typo variant (`... vikoa/`).

## Next planned tasks (recommended order)

Work policy going forward:
- Keep work in **small slices** (one boundary/invariant at a time).
- Follow the default workflow in `docs/phase_workflow.md`.

### 1) Keep quality gates green
Run the exact gates locally (or rely on CI for the authoritative signal):

```bash
npm run lint:strict
npm run check:docs-catalog
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

### 3) Folder barrels (Workstream 1.3)
Status: **completed (with initial adoption)**

- Barrels are available:
  - `core/engine/index.js`
  - `core/bridge/index.js`
  - `services/index.js`
- Reference:
  - `docs/folder_barrels.md`
- Initial adoption shipped (examples):
  - Boot manifests: `src/boot/06_services.js`, `src/boot/11_runtime_orchestration.js`
  - Worldgen: `worldgen/town_gen.js`, `worldgen/town/shops_core.js`
  - UI: `ui/components/lockpick_modal.js`

### 4) Next recommended task: continue adopting barrels + prevent regressions
Pick one (or both):

- **A) Continue adopting barrels in additional call sites (low risk, gradual)**
  - Barrels are already used in boot and a few low-risk modules; continue expanding gradually.
  - Prefer adopting in high-churn areas that are unlikely to create cycles.
  - Avoid touching modules that are known to be cycle-prone until later.

- **B) Add a guardrail lint rule (medium risk, optional)**
  - Add ESLint `no-restricted-imports` rules that enforce stable entrypoints:
    - disallow deep imports into `core/bridge/gm_bridge/*`, `core/bridge/ui_bridge/*`, `core/bridge/ui_orchestration/*`
    - optionally disallow direct imports of `core/engine/game_*_ops.js` outside `core/game.js` (keep helpers internal)

### 5) Optional repo hygiene: add a lockfile
If you want fully deterministic CI installs and faster caches:
- commit a `package-lock.json`
- switch CI to `npm ci`

## Notes / constraints
- This plan assumes we keep the current module style (**globals + ctx hybrid**) and do not change hosting/import strategy.
