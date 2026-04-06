# core/game.js shrink slice — Loot ops extraction (LootFlow)

## Summary
This slice reduces loot-related UI routing and action boilerplate in `core/game.js` by extracting ctx-first loot helpers into a dedicated module:

- `LootFlow.show(ctx, list)` (open loot panel)
- `LootFlow.hide(ctx)` (close loot panel)
- `LootFlow.loot(ctx)` (context loot action; delegates to `Actions.loot`)

## New helper module
- `core/loot_flow.js`
  - ESM exports: `show(ctx, list)`, `hide(ctx)`, `loot(ctx)`
  - Attached global: `window.LootFlow`
  - Loaded during boot via `src/boot/11_runtime_orchestration.js`

## What changed
### 1) core/game.js delegates loot interactions to LootFlow
`core/game.js` keeps its public wrappers (so the ctx surface stays stable), but delegates the bodies:

- `lootCorpse() -> LootFlow.loot(getCtx())`
- `showLootPanel(list) -> LootFlow.show(getCtx(), list)`
- `hideLootPanel() -> LootFlow.hide(getCtx())`

### 2) Draw scheduling is centralized via UIOrchestration
`LootFlow.show/hide` call `UIOrchestration.showLoot/hideLoot` when present and do not call `requestDraw()` directly.

This keeps draw scheduling and “open-state” gating centralized in UIOrchestration.

### 3) Safe fallbacks remain in place
If `LootFlow` is unavailable, `core/game.js` falls back to:
- `UIOrchestration.showLoot/hideLoot` for panel open/close
- a minimal `log("Nothing to loot here.")` for `lootCorpse()`

## Invariants (must remain true)
- `getCtx()` continues to expose:
  - `ctx.showLoot(list)` and `ctx.hideLoot()`
- `lootCorpse()` remains gated by `isDead`.
- No loot rule changes:
  - loot generation remains owned by `DungeonRuntime.generateLoot` / `Loot.generate`
  - loot transfer underfoot remains owned by dungeon/runtime logic (see `core/dungeon/loot.js`)

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Static sanity checks:
- `core/game.js` loot panel helpers are thin delegates (no direct draw scheduling).
- `src/boot/11_runtime_orchestration.js` imports `core/loot_flow.js` exactly once.
