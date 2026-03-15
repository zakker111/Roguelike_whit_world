# Refactor & Modularization Plan (Engineering)

## Scope
This plan focuses on **modularizing and refactoring the runtime code** to improve maintainability, testability, and long-term iteration speed, while preserving current gameplay behavior.

In this repo, the biggest structural pressures come from:
- a **large orchestration surface** (`core/game.js`, and the "import-order" entrypoint `src/main.js`)
- many modules that still behave like **global singletons** (`window.*`) even though a ctx-first architecture exists
- mode transitions (world/town/dungeon/encounter/region) that are correct but easy to regress
- GM integration and other bridges that act as "policy" modules and tend to grow (e.g. `core/bridge/gm_bridge.js`)

## Current architecture snapshot (relevant to modularization)

### Entrypoint and load order
- `index.html` loads `src/main.js`.
- `src/main.js` is a **manual import-order manifest**.
  - It ensures side-effect modules attach globals (`window.*`) before downstream consumers run.
  - This is reliable, but becomes difficult to maintain as the module graph grows.

### Runtime orchestration
- `core/game.js` is still a "center of gravity" for:
  - state ownership and per-turn orchestration
  - mode switching and mode-specific state
  - linking UI + services + world/dungeon runtime
- Many newer subsystems already exist as cohesive modules (`core/engine/*`, `core/modes/*`, `core/state/*`, `core/facades/*`).

### Bridges and services
- Bridges live in `core/bridge/*` and are the integration points where:
  - input/movement triggers policy (`GMBridge.maybeHandleWorldStep(ctx)`)
  - UI flows are orchestrated (`UIOrchestration.showConfirm`, inventory panels)
- Services (`services/*`) are mostly globals and are accessed either via `ctx.*` handles or `window.*`.

## Refactor principles (guardrails)

1. **Behavior-preserving refactors only**
   - No gameplay tuning inside refactor PRs.
   - If a behavior change is required, isolate it and gate it with a smoketest.

2. **Small surface-area edits**
   - Prefer extract-and-forward (move code behind a stable function) over large rewrites.

3. **Ctx-first transitions are non-negotiable**
   - Any code path that changes `ctx.mode` must:
     - do so via ctx-first APIs (e.g. `Modes.enterEncounter(ctx, ...)`)
     - apply exactly one sync/refresh boundary after the mode change (`GameAPI.applyCtxSyncAndRefresh(ctx)` or equivalent)

4. **Every modularization step is gated**
   - Minimum QA gate before/after each refactor:
     - `npm run lint:strict`
     - `npm run build`
     - `npm run acceptance:phase6`
     - `npm run acceptance:phase0`

## Decisions required (choose one per row)

These choices affect how aggressive the refactor can be.

| Decision | Option A | Option B | Option C |
|---|---|---|---|
| Module style | Keep current "globals + ctx" hybrid | Move toward "ctx-only" (globals only as dev facade) | Full DI container (explicit service registry)
| Import paths | Keep absolute imports (`/core/...`) | Migrate to relative imports | Use Vite alias + base-safe paths
| Language | JavaScript | Add JSDoc types + `@ts-check` | Migrate to TypeScript
| Compatibility target | Works when served from repo root only | Must work under subpath hosting | Must work both in bundler and no-bundler modes

## Workstreams (recommended order)

### Workstream 1: Stabilize module boundaries without changing behavior
Goal: reduce file sizes and tighten ownership boundaries.

**1.1 Split `core/bridge/gm_bridge.js` into focused submodules**
Suggested split:
- `core/bridge/gm_bridge/index.js` (public exports + attachGlobal)
- `core/bridge/gm_bridge/world_step.js` (faction travel + reconcile markers)
- `core/bridge/gm_bridge/markers.js` (marker interactions)
- `core/bridge/gm_bridge/encounters.js` (onEncounterComplete hooks)
- `core/bridge/gm_bridge/inventory.js` (bottle map item activation)

Guardrails:
- keep current exported API surface stable (`maybeHandleWorldStep`, `handleMarkerAction`, `onEncounterComplete`, `useInventoryItem`, `reconcileMarkers`)
- keep `core/world/move.js` import unchanged (it imports the GMBridge module directly)

**1.2 Shrink `core/game.js` by extracting "policy blocks" into `core/engine/*`**
`core/game.js` already imports many facades and engine modules, but still contains large state and mode-specific blocks.

Suggested extractions:
- `core/engine/session_boot.js` (URL param behavior like `?fresh=1`, version-migration hooks)
- `core/engine/mode_state.js` (mode-owned state structures and reset semantics)
- `core/engine/world_step_hooks.js` (post-move hooks currently inline)

**1.3 Create folder-level barrels to simplify import lists**
- `core/engine/index.js`
- `core/bridge/index.js`
- `services/index.js`

Rule: barrels should export *stable public surfaces only*; avoid re-exporting deep internals unless needed.

---

### Workstream 2: Reduce `window.*` coupling (incremental)
Goal: make runtime behavior more testable and easier to reason about.

**2.1 Introduce a single “service registry” on ctx**
- `ctx.mods` (or `ctx.services`) becomes the canonical lookup.
- `utils/access.js::getMod(ctx, name)` continues to work, but prefers `ctx.mods[name]`.

**2.2 Convert global attachers to "install" functions**
Current pattern: modules side-effect import and attach themselves to `window.*`.

Target pattern:
- Each subsystem exports `install(ctx)` or `installGlobals()`.
- `src/main.js` (or a new bootstrap) calls install functions in order.

This reduces implicit side effects while preserving order.

---

### Workstream 3: Simplify boot/load order (`src/main.js`)
Goal: reduce the giant import manifest to a small number of domain imports.

Approaches:
- **A (minimal):** keep `src/main.js` but replace long lists with a handful of "domain boot" modules
  - e.g. `import '/boot/data.js'`, `import '/boot/services.js'`, `import '/boot/ui.js'`, `import '/boot/core.js'`
- **B (structured):** generate `src/main.js` from a manifest (similar to `scripts/gen_manifest.js`) to avoid manual drift

Recommendation: start with A.

---

### Workstream 4: Import path hygiene and subpath hosting
Goal: make the codebase resilient when hosted under a subpath.

Current reality:
- `index.html` uses `<base href="./" />`, but `src/main.js` uses absolute imports like `/core/...`.

Options:
1. Migrate to relative imports (largest change, but simplest runtime behavior)
2. Use Vite aliases and ensure built assets rewrite correctly
3. Keep absolute imports but enforce a hosting rule: must be served from site root

## Refactor targets (high ROI)

### Target: `core/game.js`
Why:
- still large and central
- easy for unrelated changes to cause accidental coupling

Refactor objective:
- game loop stays, but most subsystems are delegated to:
  - `core/engine/*`
  - `core/modes/*`
  - `core/facades/*`

### Target: Bridges
- `core/bridge/gm_bridge.js`
- `core/bridge/ui_orchestration.js`

Objective:
- bridges should be thin "integration policy" layers calling:
  - GMRuntime
  - MarkerService
  - Modes
  - UIOrchestration

### Target: duplicated UI confirm + wait helpers in smoketests
While not production code, the smoketests are now critical QA infrastructure.

Objective:
- create a shared helper in `smoketest/helpers/ui.js` for:
  - `waitUntil`
  - confirm open/accept
  - ensure world mode

## QA strategy for refactor PRs

### Mandatory checks
- `npm run lint:strict`
- `npm run build`
- `npm run acceptance:phase6` (GM integration stability)
- `npm run acceptance:phase0` (baseline boot + cross-mode stability)

### In-review checklist
- Any moved function keeps name and signature unless the call sites are updated in the same PR
- No new direct `window.*` dependencies unless behind a facade/bridge
- Mode transition correctness:
  - confirm `ctx.mode` changes happen via `Modes.*`
  - confirm sync boundary is applied once

## Suggested first refactor slice (low risk)

If you want the smallest safe start:
1. Extract `core/bridge/gm_bridge.js` into submodules while keeping exports identical.
2. Add a barrel `core/bridge/gm_bridge/index.js` that re-exports.
3. Run `acceptance:phase6` and `acceptance:phase0` before/after.

This provides immediate modularization value without touching the more fragile `core/game.js`.
