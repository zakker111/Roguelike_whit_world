# UIBridge Modularization (Slice B)

## Outcome
`core/bridge/ui_bridge.js` has been split into focused modules under `core/bridge/ui_bridge/` while preserving the stable import entrypoint and the `window.UIBridge` global.

### Stable entrypoint preserved
- External callers should continue to import:
  - `core/bridge/ui_bridge.js`
- That file is now a thin shim that re-exports from:
  - `core/bridge/ui_bridge/index.js`

### Global attach preserved
- `window.UIBridge` is attached in exactly one place:
  - `core/bridge/ui_bridge/index.js`

## Why modularize UIBridge?
`UIBridge` mixes:
- thin delegates into `window.UI` / `window.ShopUI` / modal singletons
- a large DOM-heavy implementation (Sleep panel + fade animation)

Splitting it makes future changes safer (less merge conflict and easier review) without changing behavior.

## New file layout

```
core/bridge/ui_bridge.js              # stable shim (re-exports only)
core/bridge/ui_bridge/
  index.js                            # exports + window.UIBridge attach
  shared.js                           # hasUI()
  stats.js                            # updateStats(ctx)
  inventory.js                        # inventory panel wrappers
  loot.js                             # loot panel wrappers
  panels.js                           # gameover/god/help/character wrappers
  follower.js                         # follower modal wrappers
  shop.js                             # shop panel wrappers
  smoke.js                            # smoke panel wrappers
  confirm.js                          # confirm modal wrappers
  quest_board.js                      # quest board wrappers
  fishing.js                          # fishing mini-game wrappers
  lockpick.js                         # lockpick mini-game wrappers
  sleep.js                            # sleep panel + fade animation
  modals.js                           # isAnyModalOpen()
```

## Import rule (avoid double-instantiation)
Outside `core/bridge/ui_bridge/*`, import **only**:
- `core/bridge/ui_bridge.js`

Avoid importing `core/bridge/ui_bridge/index.js` directly from elsewhere.

## QA gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Key regressions this slice can cause:
- `window.UIBridge` missing (boot-order / attach regression)
- Sleep panel no longer opens (DOM module not loaded)
- `isAnyModalOpen()` missing a modal or throwing
