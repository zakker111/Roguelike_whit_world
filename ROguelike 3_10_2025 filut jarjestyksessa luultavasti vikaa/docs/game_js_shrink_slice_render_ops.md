# core/game.js shrink slice — Render ops extraction (render ctx + draw scheduling)

## Summary
This slice reduces “render driver plumbing” inside `core/game.js` by extracting:

- `getRenderCtx()` assembly (RenderOrchestration integration + perf hook)
- `requestDraw()` scheduling (batching and suppress-draw gating)

…into a dedicated engine helper module.

## New helper module
- `core/engine/game_render_ops.js`
  - Primary export: `createRenderOps(getCtx)`
  - Back-compat export: `createGameRenderOps` (alias)

## What will move out of core/game.js
### 1) Render context assembly
The current `getRenderCtx()` logic:
- resolves `RenderOrchestration` via module handle
- builds the render ctx
- attaches `onDrawMeasured(ms)` to feed `core/facades/perf.js`

### 2) Draw scheduling
The current draw batching / gating logic:
- `_suppressDraw` flag used during fast-forward operations
- `requestDraw()` that prefers `GameLoop.requestDraw()`

## Invariants (must remain true)
- `ctx.getRenderCtx()` still works the same way for Render.
- `ctx.requestDraw()` still works and respects suppress/batching rules.
- No extra draws per turn:
  - the Perf overlay “Draw: Xms” remains stable
  - modal open/close should still trigger a single redraw (UIOrchestration)

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
