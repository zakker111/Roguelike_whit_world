# core/game.js shrink slice — World ops extraction (initWorld + escort)

## Summary
This slice reduces `core/game.js` by extracting world-generation and world-travel wrappers into a dedicated helper.

Target functions (currently in `core/game.js`):
- `initWorld()`
- `startEscortAutoTravel()`

## Why this is a good next slice
- **Very low coupling**: these functions already delegate into `WorldRuntime`.
- **Clear dependencies**: `getCtx`, `applyCtxSyncAndRefresh`, `modHandle`, and map sizes.
- **Low regression risk**: behavior should remain identical (still uses `WorldRuntime.generate` and the same refresh path).

## Proposed new helper module
- `core/engine/game_world_ops.js`
  - Primary export: `createWorldOps({ getCtx, applyCtxSyncAndRefresh, modHandle, MAP_COLS, MAP_ROWS })`
  - Back-compat export: `createGameWorldOps` (alias)

Returned API:
- `initWorld()`
- `startEscortAutoTravel()`

## Implementation sketch
1. Create `core/engine/game_world_ops.js`.
2. Move the wrappers as-is:
   - `initWorld()` still:
     - validates `WorldRuntime.generate`
     - calls `WR.generate(ctx, { width: MAP_COLS, height: MAP_ROWS })`
     - calls `applyCtxSyncAndRefresh(ctx)`
   - `startEscortAutoTravel()` still:
     - checks `ctx.world`
     - calls `WR.startEscortAutoTravel(ctx)` when available
3. In `core/game.js`:
   - instantiate once: `const worldOps = createGameWorldOps({ getCtx, applyCtxSyncAndRefresh, modHandle, MAP_COLS, MAP_ROWS });`
   - replace local functions with delegations.
4. Keep ctx surface unchanged (`ctx.initWorld` should still exist and behave the same).

## Invariants (must remain true)
- World generation failure modes remain fail-fast and throw the same error messages.
- After `initWorld()`:
  - world map exists and player is placed as before
  - camera/FOV/UI refresh still happens via `applyCtxSyncAndRefresh(ctx)`
- Escort auto travel still starts only when `ctx.world` exists.

## QA gates
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Manual quick checks:
- Start a new run: overworld spawns; no blank map.
- Trigger escort auto-travel (if feature available): it starts and does not spam errors.
