# Folder barrels (Workstream 1.3)

This repo uses ES modules and has several “entrypoint” files that are meant to be stable (e.g. `core/bridge/gm_bridge.js`), plus many internal modules.

A **folder barrel** is an `index.js` file that re-exports a curated set of modules from a directory, so callers can import from one stable location.

## Goals
- Reduce import noise (fewer long import lists and fewer deep paths).
- Make it easier to treat some modules as **public surfaces** and others as **internal**.
- Improve refactor velocity by reducing the number of call sites that need updating when files move.

## Barrels added
### 1) `core/engine/index.js`
Exports only “stable” engine helpers that are intentionally reused.

Currently exported:
- `createGameCombatOps`
- `createGameInventoryOps`
- `createGameMapOps`
- `createGameRenderOps`
- `createGameTimeOps`
- `createGameWorldOps`
- `createGameModeOps`
- `createGameShopOps`

### 2) `core/bridge/index.js`
Exports only stable bridge entrypoints:
- `core/bridge/gm_bridge.js`
- `core/bridge/ui_bridge.js`
- `core/bridge/ui_orchestration.js`

### 3) `services/index.js`
Exports services modules:
- `combat_service.js`, `encounter_service.js`, `marker_service.js`, `shop_service.js`, etc.

## Usage guidelines
### Do
- Import from a barrel when you’re using a **stable public surface**.
- Keep the barrel small and curated.
- Prefer *entrypoint* files in barrels (e.g. `core/bridge/gm_bridge.js`, not `core/bridge/gm_bridge/index.js`).

### Don’t
- Don’t export internal/private modules from barrels.
- Don’t make barrels depend on files that also import from the barrel (easy way to create cycles).
- Don’t add `export *` from deeply nested folders unless you intend them to become public API.

## Example
Before:
```js
import { createGameMapOps } from "./engine/game_map_ops.js";
import { createGameRenderOps } from "./engine/game_render_ops.js";
```

After:
```js
import { createGameMapOps, createGameRenderOps } from "./engine/index.js";
```

## QA
After adding or changing barrels:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```
