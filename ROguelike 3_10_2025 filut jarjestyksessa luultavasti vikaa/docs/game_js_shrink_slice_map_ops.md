# core/game.js shrink slice — Map ops extraction (bounds + walkability)

## Summary
This slice reduces in-file “map policy” logic in `core/game.js` by extracting the following helpers into a dedicated engine module:

- `inBounds(x,y)`
- `isWalkable(x,y)` (including inn-upstairs overlay logic)

## New helper module
- `core/engine/game_map_ops.js`
  - Primary export: `createMapOps(getCtx)`
  - Back-compat export: `createGameMapOps` (alias)

## What changed
### 1) Moved map policy code out of core/game.js
The full bodies of:
- `inBounds(x,y)`
- `isWalkable(x,y)`

…now live in `core/engine/game_map_ops.js`.

### 2) core/game.js delegates to the extracted ops
`core/game.js` now instantiates once:

```js
const mapOps = createGameMapOps(getCtx);
```

…and keeps the public API identical by delegating:
- `inBounds(x,y) => mapOps.inBounds(x,y)`
- `isWalkable(x,y) => mapOps.isWalkable(x,y)`

## Invariants (must remain true)
- `getCtx()` continues to expose `ctx.inBounds` and `ctx.isWalkable` with the same signatures.
- No behavior changes:
  - still prefers `ctx.Utils.inBounds` and `ctx.Utils.isWalkableTile` when available
  - still honors the inn-upstairs overlay rules
  - still uses the same fallback tile whitelist when Utils is unavailable

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Static sanity checks:
- `core/game.js` no longer contains the large inline inn-upstairs + tile whitelist logic.
- No external files import `core/engine/game_map_ops.js` (intended to remain internal).
