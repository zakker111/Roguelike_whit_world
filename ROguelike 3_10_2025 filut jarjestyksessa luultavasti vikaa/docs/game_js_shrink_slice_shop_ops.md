# core/game.js shrink slice — Shop ops extraction (ShopService)

## Summary
This slice reduces thin ShopService routing boilerplate in `core/game.js` by extracting shop-related wrappers into a dedicated engine helper.

## New helper module
- `core/engine/game_shop_ops.js`
  - Primary export: `createShopOps({ getCtx, modHandle })`
  - Back-compat export: `createGameShopOps` (alias)

## What moved
The following wrappers now live in `core/engine/game_shop_ops.js`:
- `isShopOpenNow(shop = null)`
- `shopScheduleStr(shop)`

## core/game.js changes
`core/game.js` now instantiates once:

```js
const shopOps = createGameShopOps({ getCtx, modHandle });
```

…and preserves its public API by delegating behavior-identically:
- `isShopOpenNow(shop) => shopOps.isShopOpenNow(shop)`
- `shopScheduleStr(shop) => shopOps.shopScheduleStr(shop)`

## Invariants (must remain true)
- `buildGameAPI()` continues to expose:
  - `isShopOpenNow(shop)`
  - `shopScheduleStr(shop)`
- No behavior changes (still routes to `ShopService.isShopOpenNow` / `ShopService.shopScheduleStr` when present).

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```
