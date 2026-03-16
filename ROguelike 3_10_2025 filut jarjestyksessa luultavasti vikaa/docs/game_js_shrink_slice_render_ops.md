# core/game.js shrink slice — Render ops extraction (render ctx + draw scheduling)

## Summary
This slice reduces “render driver plumbing” inside `core/game.js` by extracting:

- `getRenderCtx()` assembly (RenderOrchestration integration + perf hook)
- `requestDraw()` scheduling (draw batching + suppress-draw gating)

…into a dedicated engine helper module.

## New helper module
- `core/engine/game_render_ops.js`
  - Primary export: `createRenderOps(getCtx)`
  - Back-compat export: `createGameRenderOps` (alias)

## What changed
### 1) Render context assembly moved out of core/game.js
The logic that:
- resolves `RenderOrchestration` via ctx-first module handle
- builds the render ctx
- attaches `onDrawMeasured(ms)` to feed `core/facades/perf.js`

…now lives in `core/engine/game_render_ops.js::getRenderCtx()`.

### 2) Draw scheduling moved out of core/game.js
The logic that:
- checks an internal `suppressDraw` flag
- calls `GameLoop.requestDraw()` (ctx-first; falls back to `window.GameLoop`)

…now lives in `core/engine/game_render_ops.js::requestDraw()`.

### 3) core/game.js now delegates
`core/game.js` now instantiates once:

```js
const renderOps = createGameRenderOps(getCtx);
```

…and keeps the public API identical by delegating:
- `getRenderCtx() => renderOps.getRenderCtx()`
- `requestDraw() => renderOps.requestDraw()`

## Invariants (must remain true)
- `ctx.getRenderCtx()` still works the same way for Render.
- `ctx.requestDraw()` still works and respects suppress/batching rules.
- No extra draws per turn:
  - the Perf overlay “Draw: Xms” remains stable
  - modal open/close triggers a single redraw (UIOrchestration)

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Manual quick checks:
- open/close Inventory, Loot, God, Help: redraw happens once per toggle
- hold movement keys for a few seconds: no unexpected “double draw” behavior
