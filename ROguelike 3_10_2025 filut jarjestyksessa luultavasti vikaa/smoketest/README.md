# Smoketest (browser runner)

This folder houses the browser-driven smoketest system injected by `index.html` when `?smoketest=1` is present. It exercises core gameplay flows (world, dungeon, town, combat, inventory, overlays), collects diagnostics, and renders an on‑screen report in the GOD panel with export buttons.

How to run
- Serve locally:
  - `node server.js` (recommended), then open `http://localhost:8080/index.html?smoketest=1&dev=1`
  - or `python3 -m http.server`, then open `http://localhost:8000/index.html?smoketest=1&dev=1`
- Useful URL params:
  - `&smokecount=N` — run the suite N times (orchestrator honors this)
  - `&scenarios=world,dungeon,inventory,combat,town,overlays,determinism` — filter scenario pipeline (legacy style `&smoke=` also supported)
  - `&legacy=1` — use the legacy monolithic runner instead of the orchestrator
  - `&phase=2` — used by reload‑phase determinism check
  - `&validatebad=1` (or `&badjson=1`) with `&dev=1` — inject malformed JSON for validator checks

What gets injected (in order) when `?smoketest=1`
- Helpers:
  - `smoketest/helpers/dom.js` — DOM/event helpers (safeClick, setInput, key, sleep, waitUntilTrue)
  - `smoketest/helpers/budget.js` — shared `SmokeTest.Config` and time budget helpers
  - `smoketest/helpers/logging.js` — banner/status/log/panel helpers
  - `smoketest/helpers/movement.js` — routing helpers (routeTo, routeAdjTo, bumpToward)
- Capabilities:
  - `smoketest/capabilities/detect.js` — centralized GameAPI capability detection
- Reporting:
  - `smoketest/reporting/render.js` — pure HTML renderers (header, checklist, details)
  - `smoketest/reporting/export.js` — export buttons (Report JSON, Summary TXT, Checklist TXT)
- Runner helpers:
  - `smoketest/runner/init.js` — console/error capture hooks
  - `smoketest/runner/banner.js` — banner/status/log/panel delegation
- Orchestrator:
  - `smoketest/runner/runner.js` — default scenario pipeline and runSeries()
- Scenarios:
  - `smoketest/scenarios/world.js`
  - `smoketest/scenarios/dungeon.js`
  - `smoketest/scenarios/inventory.js`
  - `smoketest/scenarios/combat.js`
  - `smoketest/scenarios/dungeon_persistence.js`
  - `smoketest/scenarios/town.js`
  - `smoketest/scenarios/town_flows.js`
  - `smoketest/scenarios/town_diagnostics.js`
  - `smoketest/scenarios/overlays.js`
  - `smoketest/scenarios/determinism.js`
- Legacy runner:
  - `smoketest/smoketest_runner.js` — monolithic runner (injected only when `&legacy=1` is present)

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

Outputs
- GOD panel report with:
  - Header (PASS/FAIL, steps, issue count, runner version, caps)
  - Key checklist, passed/failed/skipped, step details
  - Export buttons (Report JSON, Summary TXT, Checklist TXT)
- Tokens for CI/automation:
  - DOM: hidden `#smoke-pass-token` (PASS/FAIL), `#smoke-json-token` (compact JSON)
  - Storage: `localStorage["smoke-pass-token"]`, `localStorage["smoke-json-token"]`

Notes
- Orchestrator is the default. Use `&legacy=1` only if you need to compare with the monolithic runner.
- Scenario filtering via `&scenarios=` (or legacy `&smoke=`) lets you run a subset in CI or local checks.

Known
- If you still see only one run with `&smokecount=N`, ensure you are on the orchestrator (no `&legacy=1`) and that `?smoketest=1` is present on the URL. The orchestrator’s `runSeries()` honors `smokecount`.