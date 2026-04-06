# core/game.js shrink slice — Time ops extraction (time facade wrappers)

## Summary
This slice reduces `core/game.js` boilerplate by extracting time wrappers into a dedicated helper:

- `minutesUntil(hour, minute)`
- `advanceTimeMinutes(mins)`
- `fastForwardMinutes(mins)` (delegates to `Movement.fastForwardMinutes(ctx, mins)`)

## New helper module
- `core/engine/game_time_ops.js`
  - Primary export: `createTimeOps({ getCtx, log, rng, modHandle })`
  - Back-compat export: `createGameTimeOps` (alias)

## What changed
- `core/game.js` now instantiates:
  ```js
  const timeOps = createGameTimeOps({ getCtx, log, rng: () => rng(), modHandle });
  ```
- The existing public functions delegate to `timeOps.*`, keeping the GameAPI surface identical.

## Invariants (must remain true)
- Sleeping / waiting still advances time and emits the same log messages.
- Fast-forward still drives NPC/AI via `Movement.fastForwardMinutes`.
- No extra RNG consumption beyond what existed before (time/weather uses injected rng).

## QA gates
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```
