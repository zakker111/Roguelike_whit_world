# Smoketest (browser runner)

This folder houses the browser-driven smoketest runner that is injected into the page when you append `?smoketest=1` to the URL. It exercises core gameplay flows (world, dungeon, town, combat, inventory, overlays), collects diagnostics, and renders an on‑screen report in the GOD panel with export buttons.

How to run
- Serve the project locally:
  - `node server.js` (recommended) and open `http://localhost:8080/index.html?smoketest=1&dev=1`
  - or `python3 -m http.server` and open `http://localhost:8000/index.html?smoketest=1&dev=1`
- Optional parameters:
  - `&smokecount=N` for multiple runs
  - `&phase=2` used by the runner’s reload-phase determinism check
  - `&validatebad=1` (or `&badjson=1`) with `&dev=1` to inject malformed JSON for validator checks

What gets injected
- `smoketest/smoketest_runner.js` — the main runner; auto-injected by `index.html` when `?smoketest=1` is present.
- Modularization (in progress):
  - `smoketest/helpers/dom.js` — DOM/event helpers, budgets, logging (loaded before the runner)
  - `smoketest/capabilities/detect.js` — GameAPI capability detection (loaded before the runner)

Key assets expected by the page
- Core/runtime and utilities:
  - `core/ctx.js`, `core/rng_service.js`, `utils/utils.js`, `utils/rng_fallback.js`
- Data registries and adapters:
  - `data/loader.js`, `data/flavor.js`, `data/god.js`
  - `entities/items.js`, `entities/enemies.js`, `entities/loot.js`, `dungeon/dungeon_items.js`
- Dungeon core:
  - `dungeon/occupancy_grid.js`, `dungeon/dungeon_state.js`, `dungeon/dungeon.js`
- Services:
  - `services/time_service.js`, `services/shop_service.js`
- UI and renderer:
  - `ui/logger.js`, `ui/tileset.js`, `ui/render.js`, `ui/decals.js`, `ui/ui.js`
- Player, AI, worldgen:
  - `entities/player_utils.js`, `entities/player_equip.js`, `entities/player.js`
  - `ai/ai.js`, `ai/town_ai.js`, `worldgen/town_gen.js`
- World and core runtime:
  - `world/world.js`, `world/los.js`, `world/fov.js`
  - `core/actions.js`, `core/modes.js`, `core/game_loop.js`, `core/input.js`, `core/game.js`

Notes
- The runner writes a detailed report to the GOD panel and exposes compact PASS/FAIL tokens in the DOM for CI.
- The legacy Node description (“node smoketest/smoke.js”) is not used here; the smoketest is browser-driven.


Bugs 
- run counter doesnt run counted runs it runs only once even if runs are ste to more