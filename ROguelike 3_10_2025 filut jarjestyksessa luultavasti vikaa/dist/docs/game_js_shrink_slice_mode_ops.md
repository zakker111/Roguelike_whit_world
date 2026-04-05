# core/game.js shrink slice — Mode ops extraction (mode transitions + exits)

## Summary
This slice reduces in-file mode transition boilerplate in `core/game.js` by extracting a small set of ctx-first wrappers into a dedicated engine module.

The extracted wrappers primarily route between:
- `ModesTransitions` (enter/leave town/dungeon)
- `core/modes/exit.js` (`exitToWorld` orchestrator for leaving town/dungeon)

## New helper module
- `core/engine/game_mode_ops.js`
  - Primary export: `createModeOps({ getCtx, applyCtxSyncAndRefresh, log, modHandle })`
  - Back-compat export: `createGameModeOps` (alias)

## What moved
The following wrappers now live in `core/engine/game_mode_ops.js`:
- `enterTownIfOnTile()`
- `enterDungeonIfOnEntrance()`
- `leaveTownNow()`
- `requestLeaveTown()`
- `returnToWorldFromTown()` (uses `exitToWorld(..., { reason: "gate" })`)
- `returnToWorldIfAtExit()` (uses `exitToWorld(..., { reason: "stairs" })`)

## core/game.js changes
`core/game.js` now instantiates once:

```js
const modeOps = createGameModeOps({
  getCtx,
  applyCtxSyncAndRefresh,
  log,
  modHandle
});
```

…and preserves its public API by delegating behavior-identically:
- `enterTownIfOnTile() => modeOps.enterTownIfOnTile()`
- `enterDungeonIfOnEntrance() => modeOps.enterDungeonIfOnEntrance()`
- `leaveTownNow() => modeOps.leaveTownNow()`
- `requestLeaveTown() => modeOps.requestLeaveTown()`
- `returnToWorldFromTown() => modeOps.returnToWorldFromTown()`
- `returnToWorldIfAtExit() => modeOps.returnToWorldIfAtExit()`

## Invariants (must remain true)
- These wrappers remain available through the `core/game.js` surface (for GameAPI + smoke tests).
- No behavior changes:
  - still calls `ModesTransitions.*` when present
  - still exits town via `exitToWorld(ctx, { reason: "gate" })` with the same hint logging behavior
  - still exits dungeon via `exitToWorld(ctx, { reason: "stairs" })`

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Static sanity checks:
- `core/game.js` no longer contains the `exitToWorld(...reason: "gate"|"stairs")` call sites.
- `core/engine/game_mode_ops.js` is internal (no imports from outside `core/game.js`).
