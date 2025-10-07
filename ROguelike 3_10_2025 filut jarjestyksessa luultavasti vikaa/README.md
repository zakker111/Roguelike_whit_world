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

Data-first configuration
- Core registries are loaded from JSON via data/loader.js and consumed by modules:
  - data/items.json — equipment types and stat ranges (used by entities/items.js)
  - data/enemies.json — enemy types, visuals, weights, stat formulas
    - entities/enemies.js is now a thin adapter; all enemy definitions live in JSON only.
  - data/npcs.json — NPC archetypes and lines (used by AI/Town modules when present)
  - data/consumables.json — potion/consumable registries
  - data/shops.json — shop types, names, and hours (used by worldgen/town_gen.js and ShopService)
  - data/town.json — town layout parameters (sizes, plaza, roads, buildings, props)
- If a JSON fails to load, modules fall back gracefully to safe defaults, and a notice is logged.

JSON schema quick reference
- data/enemies.json (array)
  - id/key: string
  - glyph: string (single character)
  - color: string (hex)
  - tier: number (1..n), influences level adjustment
  - blockBase: number (0..1), base block chance modifier
  - weightByDepth: array of [minDepth, weight]
  - hp/atk/xp: array of [minDepth, base, slope] — base + slope*(depth-minDepth)
  - potionWeights: { lesser, average, strong }
  - equipChance: number (0..1)
- data/shops.json (array)
  - type: string (e.g., blacksmith, apothecary, inn)
  - name: string
  - open: "HH:MM" (optional if alwaysOpen)
  - close: "HH:MM" (optional if alwaysOpen)
  - alwaysOpen: boolean
- data/town.json (object)
  - sizes: { small:{W,H}, big:{W,H}, city:{W,H} }
  - plaza: { small:{w,h}, big:{w,h}, city:{w,h} }
  - roads: { xStride, yStride }
  - buildings: { max, blockW, blockH }
  - props: { benchLimit:{small,big,city}, plantTryFactor }

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

Town generation (data-first)
- Town size, plaza dimensions, road spacing, building density and props are driven by data/town.json:
  - sizes: map W/H per size (small/big/city)
  - plaza: inner plaza width/height per size
  - roads: xStride/yStride for the block grid
  - buildings: max count and block dimensions used for placement
  - props: benchLimit per size and plantTryFactor
- Shops are selected from data/shops.json and placed in buildings nearest to the plaza.
- Schedules: "open"/"close" times use HH:MM; "alwaysOpen" is supported.

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
- Scenario selection:
  - Use ?smoke=world,dungeon,town,combat,inventory,perf,overlays to run targeted subsets (comma-separated).
  - Omit ?smoke to run all scenarios.
- CI tokens:
  - PASS/FAIL: a hidden element with id "smoke-pass-token" containing "PASS" or "FAIL".
  - Compact JSON: a hidden element with id "smoke-json-token" containing a compact summary: { ok, passCount, failCount, skipCount, seed, caps, determinism }.
- Results are shown in the GOD panel and can be downloaded as JSON/TXT.

Notes
- Modules should prefer ctx.* handles over window.*.
- UI panels follow ESC-to-close consistently.
- Input prioritizes closing modals before movement.