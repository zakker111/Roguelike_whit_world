Tiny Roguelike — Developer Guide

Quick start
- Open index.html in a browser.
- Movement: Arrows or Numpad (8-direction with numpad).
- Action (G): interact/loot/enter/exit depending on context.
- Inventory: I. GOD panel: P. Wait: Numpad5 or the Wait button.
- To run smoke tests: append ?smoketest=1 to the URL, optionally &smokecount=3.

Module load order (index.html)
- Core: ctx.js, rng_service.js
  - Context handles and deterministic RNG must load first.
- World, LOS, FOV, Dungeon
- UI: logger.js, ui.js, tileset.js, render.js
- Player + services (time_service, shop_service)
- Data and registries (loader.js, items.js, dungeon_items.js, flavor.js)
- Utilities
- AI: ai.js, town_ai.js
- Helpers: decals.js, occupancy_grid.js, dungeon_state.js
- GOD helpers
- Actions, worldgen/town_gen.js, modes, game_loop
- Input, Game
  - Input must load before Game so Game can install handlers.

Flags and URL parameters
- dev=1: enable DEV mode (extra console logs). dev=0 disables and clears localStorage DEV.
- mirror=1|0: side log mirror on/off. Persists to localStorage LOG_MIRROR.
- smoketest=1: inject and run the smoke test runner (ui/smoketest_runner.js).
  - smokecount=N: number of runs to execute (1–20).
- Seed is persisted to localStorage SEED. GOD panel shows and lets you apply seeds.

Determinism and RNG
- RNG is centralized via core/rng_service.js (window.RNG).
- If RNG.service is not available, modules use utils/rng_fallback.js to get a deterministic PRNG seeded from SEED (or time-based).
- Boot and GOD Diagnostics log the RNG source and current seed.

Town occupancy cadence
- Occupancy grid rebuild cadence is set modestly (every 2 ticks) to reduce ghost-blocking after NPC movement bursts.

Linting and formatting
- ESLint config in .eslintrc.json:
  - Browser + ES2021 env; known globals declared; rules: no-undef, no-redeclare, no-shadow, consistent-return, prefer-const, etc.
- Prettier config in .prettierrc:
  - Single quotes, semicolons, trailing commas (ES5), 2 spaces, print width 100.
- Run manually:
  - npx eslint .
  - npx prettier -c .
  - npx prettier -w . (to format)

Smoke testing
- The runner covers:
  - Boot diagnostics and seed application
  - Overworld routing to dungeon/town, transitions
  - Dungeon combat, loot, equipment, decay, crit/status
  - Dungeon persistence (re-enter check)
  - Town NPC interactions, shops, home routes, inn resting
  - Performance snapshot
- Results are shown in the GOD panel and can be downloaded as JSON/TXT.

Notes
- Modules should prefer ctx.* handles over window.*.
- UI panels follow ESC-to-close consistently.
- Input prioritizes closing modals before movement.