# Boot / Load-Order Modularization (Slice C)

## Outcome
`src/main.js` now imports a small set of **boot manifest** modules under `src/boot/*` instead of listing every game module inline.

This keeps the boot order explicit and stable while reducing merge conflicts and making the entrypoint easier to scan.

## Key invariants

### 1) Preserve evaluation order
The boot modules are imported in a strict sequence from `src/main.js`.

Each boot module contains **imports only** (no top-level executable code), so the only behavior is: **evaluate the imported modules in the listed order**.

### 2) Stable entrypoint
- The entrypoint remains: `src/main.js`
- `index.html` should still load it via:
  ```html
  <script type="module" src="/src/main.js"></script>
  ```

### 3) The “start the game” boundary stays visible
`/core/engine/game_orchestrator.js` remains imported directly by `src/main.js` (not hidden inside a boot module) so it’s obvious where the boot sequence ends and the orchestrator begins.

## New file layout

```
src/main.js
src/boot/
  00_core.js
  01_utils.js
  02_world_primitives.js
  03_data_registries.js
  04_entities_and_adapters.js
  05_dungeon_core.js
  06_services.js
  07_combat.js
  08_ui_and_rendering.js
  09_player.js
  10_ai_and_worldgen.js
  11_runtime_orchestration.js
```

## QA / acceptance gates
Run:
```bash
npm run lint:strict
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Quick manual smoke checks:
- Load the game normally (no params)
- Open/close: inventory, loot, shop, god/help/character panels
- Enter dungeon, fight, pick up loot
- Optional: `?smoketest=1` (runner should load and execute)
