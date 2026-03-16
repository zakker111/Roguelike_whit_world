# core/game.js shrink slice — Render ops extraction (render ctx + draw scheduling)

## Summary
This slice reduces “render driver plumbing” in `core/game.js` by extracting:

- render context assembly (`getRenderCtx(ctx)`)
- draw scheduling / coalescing (`GameLoop.requestDraw()` + `GameLoop.start()`)

## New helper modules
- `core/engine/render_orchestration.js`
  - Export: `getRenderCtx(ctx)`
  - Attached global: `window.RenderOrchestration.getRenderCtx`
- `core/engine/game_loop.js`
  - Exports: `requestDraw()`, `start(getRenderCtx)`
  - Attached global: `window.GameLoop.requestDraw/start`

## What changed
### 1) Render context assembly moved out of core/game.js
`core/engine/render_orchestration.js` now owns the construction of the object passed to `Render.draw(...)`.

`core/game.js` keeps a thin wrapper `getRenderCtx()` that:
- delegates to `RenderOrchestration.getRenderCtx(getCtx())`
- wires `onDrawMeasured(ms)` into `core/facades/perf.js` for the HUD perf overlay

### 2) Draw scheduling moved out of core/game.js
`core/engine/game_loop.js` now owns:
- coalescing multiple draw requests into a single draw per animation frame
- the `requestAnimationFrame` loop (`GameLoop.start(getRenderCtx)`)

`core/game.js::requestDraw()` now delegates to `GameLoop.requestDraw()` (and still honors the local “suppress draw” flag).

### 3) Loop startup is delegated via bootstrap helper
`core/game_bootstrap.js::startLoopImpl(...)` starts `GameLoop` when available and falls back to a single `Render.draw(getRenderCtx())`.

## Invariants (must remain true)
- `getRenderCtx()` continues to return a render context with the same surface expected by `Render.draw`.
- `ctx.requestDraw()` (injected via `getCtx()`) remains the single supported draw scheduling hook for other modules.
- No behavior changes:
  - no extra draws per input/turn
  - perf overlay still receives draw timing via `onDrawMeasured`

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Static sanity checks:
- `core/game.js` no longer contains large inline render context assembly.
- `core/game.js::requestDraw()` does not call `Render.draw(...)` directly (draws are centralized via `GameLoop`).
