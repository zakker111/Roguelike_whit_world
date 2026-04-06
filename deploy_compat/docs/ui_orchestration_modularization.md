# UIOrchestration Modularization (Slice A)

## Outcome
`core/bridge/ui_orchestration.js` has been split into focused modules under `core/bridge/ui_orchestration/` while preserving the stable import entrypoint and the `window.UIOrchestration` global.

### Stable entrypoint preserved
- External callers should continue to import:
  - `core/bridge/ui_orchestration.js`
- That file is now a thin shim that re-exports from:
  - `core/bridge/ui_orchestration/index.js`

### Global attach preserved
- `window.UIOrchestration` is attached in exactly one place:
  - `core/bridge/ui_orchestration/index.js`

## Why modularize UIOrchestration?
`UIOrchestration` is a dependency hub:
- gameplay modules call it to open/close modals and schedule redraws
- smoketests patch/wrap it (e.g. confirm prompts)
- it needs to remain extremely stable

Splitting it improves:
- readability
- reducing merge conflicts
- keeping future UI additions localized (new modal = new module)

## New file layout

```
core/bridge/ui_orchestration.js          # stable shim (re-exports only)
core/bridge/ui_orchestration/
  index.js                               # exports + attachGlobal("UIOrchestration", ...)
  shared.js                              # module handles (UIBridge/InventoryController/GameLoop/Render)
  draw.js                                # requestDraw(ctx)
  stats.js                               # updateStats(ctx)
  inventory.js                           # inventory panel wrappers
  loot.js                                # loot panel wrappers
  panels.js                              # gameover/god/help/character/shop/smoke/sleep wrappers
  confirm.js                             # confirm modal wrappers
  quest_board.js                         # quest board wrappers
  lockpick.js                            # lockpick modal wrappers
  follower.js                            # follower inspect view model + modal wrappers
```

## API surface (current)
The shim re-exports these functions (and the global exposes the same keys):

- Draw/Stats:
  - `requestDraw(ctx)`
  - `updateStats(ctx)`

- Inventory:
  - `renderInventory(ctx)`
  - `showInventory(ctx)`, `hideInventory(ctx)`, `isInventoryOpen(ctx)`

- Loot:
  - `showLoot(ctx, list)`, `hideLoot(ctx)`, `isLootOpen(ctx)`

- Panels:
  - `showGameOver(ctx)`, `hideGameOver(ctx)`
  - `showGod(ctx)`, `hideGod(ctx)`, `isGodOpen(ctx)`
  - `showHelp(ctx)`, `hideHelp(ctx)`, `isHelpOpen(ctx)`
  - `showCharacter(ctx)`, `hideCharacter(ctx)`, `isCharacterOpen(ctx)`
  - `showShop(ctx, npc)`, `hideShop(ctx)`, `isShopOpen(ctx)`, `buyShopIndex(ctx, idx)`
  - `showSmoke(ctx)`, `hideSmoke(ctx)`, `isSmokeOpen(ctx)`
  - `showSleep(ctx, opts)`, `hideSleep(ctx)`, `isSleepOpen(ctx)`, `animateSleep(ctx, minutes, cb)`

- Confirm:
  - `showConfirm(ctx, text, pos, onOk, onCancel)`
  - `cancelConfirm(ctx)`, `isConfirmOpen(ctx)`
  - `isAnyModalOpen(ctx)`

- Quest Board:
  - `showQuestBoard(ctx)`, `hideQuestBoard(ctx)`, `isQuestBoardOpen(ctx)`

- Lockpick:
  - `showLockpick(ctx, opts)`, `hideLockpick(ctx)`, `isLockpickOpen(ctx)`

- Followers:
  - `showFollower(ctx, runtime)`, `hideFollower(ctx)`, `isFollowerOpen(ctx)`

## Invariants / rules

### Import rule (avoid double-instantiation)
- Outside `core/bridge/ui_orchestration/*`, import **only**:
  - `core/bridge/ui_orchestration.js`

Avoid importing `core/bridge/ui_orchestration/index.js` directly from elsewhere.

### Side effects live in `index.js`
- Only `core/bridge/ui_orchestration/index.js` should call `attachGlobal`.
- All other modules should be side-effect free.

### Draw scheduling is centralized
- Only call `requestDraw(ctx)` when panel open-state changes (the wrappers already do this).
- Avoid redundant direct `ctx.requestDraw()` calls in call sites.

## How to add a new modal
1. Create a new module file under `core/bridge/ui_orchestration/` (e.g. `crafting.js`).
2. Implement `showX/hideX/isXOpen` by delegating to `UIBridge`.
3. Export it from `index.js`.
4. Add it to the `attachGlobal("UIOrchestration", { ... })` object.

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Key regressions this slice can cause:
- `window.UIOrchestration` missing (boot-order / side-effect regression)
- confirm UI not available to GMBridge travel/marker flows
- follower modal failing due to view model shape drift
