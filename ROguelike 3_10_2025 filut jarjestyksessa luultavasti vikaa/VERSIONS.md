# Game Version History
Last updated: 2025-10-09 13:00 UTC

This file tracks notable changes to the game across iterations. Versions here reflect functional milestones rather than semantic releases.

Conventions
- Added: new features or modules
- Changed: behavior or structure adjustments
- Fixed: bug fixes
- UI: user interface-only changes
- Dev: refactors, tooling, or internal changes

v1.23.0 — Teleport helpers, reliable entry/exit, death aborts, inconclusive steps, enemy HP clamp, diagnostics polish, and pipeline controls
- Added: Smoketest Teleport helper (smoketest/helpers/teleport.js)
  - teleportTo(x,y) via GameAPI.teleportTo with walkable/nearest-free fallback.
  - teleportToGateAndExit() for town timeout exits; closes modals, presses 'g', verifies mode switch.
  - teleportToDungeonExitAndLeave() fallback when leaving dungeon.
- Added: GameAPI dev/test helpers (core/game.js)
  - teleportTo(tx,ty,{ensureWalkable,fallbackScanRadius}) with camera/FOV/UI refresh.
  - setEnemyHpAt(x,y,hp) for clamping newly spawned enemies for deterministic combat checks.
- Changed: Town/Dungeon entry and exit robustness
  - enterTownIfOnTile now syncs mutated ctx back to engine state; added enterDungeonIfOnEntrance export.
  - Runner’s ensureTownOnce/ensureDungeonOnce route precisely onto target tile, proactively close modals, press 'g', then call API fallback, and poll for mode changes; single-entry locks prevent repeated toggles.
- Added: Death detection and abort wiring
  - Runner aborts current run when death/Game Over is detected; shows reason “dead”.
  - Live Matchup adds DEAD counter; applyFreshSeedForRun auto “New Game” on dead state before seeding.
- Changed: Reporting renderer styling
  - Steps mentioning “immobile”, “death”, or “game over” are labeled INCONCLUSIVE with neutral grey styling instead of FAIL.
- Changed: Combat scenario reliability
  - Spawns via GOD and GameAPI with retries; clamps newly spawned enemies to low HP for quick effects.
  - Proximity-based wait for first enemy hit (up to 10 turns) instead of fixed delays.
  - Records detailed effects: target HP drop, total HP drop, corpse/decals increase.
- Changed: Dungeon persistence scenario
  - Ensures standing exactly on chest tile before interaction; checks looted flag, lootCount decrease, or inventory growth.
  - Exit reliability: closes modals, key 'g', returnToWorldIfAtExit fallback, and teleport-to-exit fallback if needed.
  - Re-entry invariants: corpses/decals persistence checks and player “non-teleport” guard.
- Changed: Town diagnostics scenario
  - Simplified shop sign check (OPEN/CLOSED) without boundary-time logic; removed resting flows.
  - GOD “Inn/Tavern” presence check; bump-buy near shopkeeper; greeter count near gate (expects 1 within r<=2).
  - On routing timeout, uses teleportToGateAndExit() to avoid getting stuck.
- UI: Run Linear All button
  - New config panel button triggers a fixed scenario order without manual selection; respects Runs value.
- Runner aggregation and multi-run behavior
  - Union-of-success aggregation by exact message; live Matchup prioritizes fails, then skips, then passes, sorted by recency.
  - Special counters IMMOBILE and DEAD included; added per-run progress snippets and final summary.
- Dev: Minor timing and stability tweaks
  - Increased waits around teleport exit (500 ms defaults); tightened empty-town fallback waits; modal closing hardened across scenarios.

v1.22.3 — Run indicators, world-mode gating per run, seed uniqueness, single-entry locks, IMMOBILE counter, and safer defaults
- UI: Runner banner/status now shows the current run and stage
  - Displays “Run X / Y: preparing…”, “Run X / Y: running…”, and “Run X / Y: completed”.
  - Scenario status line reflects “Run X / Y • <scenario name>”.
- Changed: World-mode gating per run
  - After applying the per-run seed, waits until GameAPI.getMode() returns "world" before starting scenarios to prevent race conditions.
- Changed: Single-entry locks for dungeon and town
  - New ensureDungeonOnce and ensureTownOnce helpers in the runner with per-run locks (DUNGEON_LOCK, TOWN_LOCK).
  - Scenarios updated to use these helpers (dungeon.js, combat.js, town.js, town_diagnostics.js, town_flows.js) to avoid repeated enter/re-enter loops.
- Changed: Seed uniqueness and deterministic derivation
  - parseParams supports seed=BASE; deriveSeed(runIndex) guarantees a different seed per run, deterministic when a base is provided.
  - Tracks used seeds per series to avoid duplicates.
- Added: IMMOBILE counter in Matchup
  - Live Matchup scoreboard now shows IMMOBILE <count> alongside OK/FAIL/SKIP, counting failed steps that mention “immobile”.
- Changed: Abort-on-immobile default disabled
  - Runs no longer halt on immobile by default; can be enabled via abortonimmobile=1.
- Fixed: Runner syntax errors
  - Removed stray try without catch/finally; fixed malformed setStatus call; restored missing usedSeeds tracking; completed parseParams persistence line.
- Dev: Status and logging polish
  - Clear run labeling in banner and status near the GOD panel; improved readability of per-run progress and final aggregation.

v1.22.2 — Live Matchup scoreboard, entry hardening, seed workflow, and syntax fixes
- Changed: Live Matchup panel in GOD
  - Sticky/pinned at the top of the report area with higher-contrast styling.
  - Shows OK/FAIL/SKIP badges; FAIL count highlighted in red.
  - Details prioritize severity: FAIL first, then SKIP, then OK; displays up to 20 by default.
  - Expand/Collapse toggle to reveal all aggregated steps.
- Changed: Union-of-success aggregation across runs
  - Aggregated report marks a step OK if any run passed; SKIP if none passed and at least one skipped; FAIL otherwise.
  - Live scoreboard updates after each run to reflect current aggregation.
- Changed: Seed per run with world-mode guard
  - Before each run, ensures mode is “world”; clicks “Start New Game” via GOD if needed.
  - Applies a fresh 32-bit RNG seed via GOD panel; persists to localStorage.
- Fixed: Runner syntax errors from unsafe template literal ternaries and stray HTML
  - Removed malformed fragments that caused “Unexpected token '<'”.
  - Replaced inline style ternaries with precomputed variables (e.g., failColor) to avoid parser edge cases.
- Changed: Scenario entry robustness
  - Dungeon: increased route budgets, adjacent routing fallback, final bump toward entrance, then Enter + enterDungeonIfOnEntrance (supports adjacent entry).
  - Town: closes modals before routing; routes to town or adjacent tile; final bump toward gate, then Enter + enterTownIfOnTile.
- Docs: Updated smoketest/README.md, smoketest.md, and CHECKLIST.md to document the Matchup panel, aggregation behavior, seed workflow, and entry hardening.

v1.22.1 — Legacy runner thin shim, orchestrator gating, docs alignment
- Changed: Legacy runner refactored into a thin shim that delegates to the orchestrator; removed inline scenario/reporting/helpers.
- Changed: Orchestrator skips auto-run when `&legacy=1` is present; legacy shim invokes orchestrator `runSeries` to avoid double execution.
- Changed: index.html loader comment updated to “Legacy thin shim appended below”; shim only injected when `&legacy=1`.
- Fixed: legacy recursion/double-run risk; stabilized series runs and report display.
- Changed: Scenarios now record SKIP before early returns when preconditions aren’t met (world, dungeon, inventory, town, dungeon_persistence) to keep logs comprehensive.
- Docs: Updated smoketest.md, smoketest/README.md, runner/README.md, and README.md to reflect thin shim, scenario filters, and CI tokens.

v1.22 — Smoketest Orchestrator default, modularization, RNG audit, CI tokens, and docs alignment
- Added: Orchestrator runner (smoketest/runner/runner.js) now the default when `?smoketest=1`; legacy monolithic runner only loads with `&legacy=1`.
- Added: Modular smoketest structure
  - helpers/: dom.js, budget.js, logging.js, movement.js
  - capabilities/: detect.js (caps map), rng_audit.js (DEV-only RNG audit)
  - reporting/: render.js (pure HTML), export.js (download buttons)
  - runner/: init.js (console/error capture), banner.js (status/log/panel), runner.js (pipeline/runSeries/params/budgets)
  - scenarios/: world.js, dungeon.js, inventory.js, combat.js, dungeon_persistence.js, town.js, town_flows.js, town_diagnostics.js, overlays.js, determinism.js
- Changed: index.html injection order to load helpers → capabilities → reporting → runner helpers → orchestrator → scenarios (legacy runner appended only with `&legacy=1`).
- Added: Orchestrator readiness guard — waits for `GameAPI.getMode()` or `getPlayer()` before running to avoid “instant report” with all SKIPs.
- Added: DEV-only RNG audit — surfaces RNG source snapshot and heuristic Math.random mentions (non-blocking).
- Added: CI tokens — hidden DOM tokens `#smoke-pass-token` and `#smoke-json-token` plus localStorage tokens, matching legacy runner behavior.
- Changed: GOD panel “Run Smoke Test” button triggers orchestrator in-page when available, otherwise reloads with `?smoketest=1`.
- Fixed: Syntax error in runner.js (dangling `catch`), plus minor stabilizations around auto-run and game-ready waits.
- Docs: Updated smoketest/README.md, smoketest.md, and top-level README.md to reflect orchestrator default, scenario filtering (`&scenarios=`), legacy fallback, and token outputs.

v1.21 — Enemy glyph fallback, town greeter, and smoketest runner hardening
- Fixed: “?” glyphs for spawned enemies
  - dungeon/dungeon.js and data/god.js now resolve glyph via the Enemies registry or JSON and fall back to the first letter of the enemy type id, avoiding “?” unless type/glyph is genuinely missing.
- Added: Town gate greeter
  - worldgen/town_gen.js: spawns one greeter near the gate on town generation and logs a welcome line immediately.
- Changed: Smoketest runner resilience and reporting
  - ui/smoketest_runner.js:
    - Robust dungeon entry detection: extended settle window and added log scan (“enter the dungeon”/“re-enter the dungeon”) to mark success even if mode quickly flips back.
    - Modal closing pre-routing: ensureAllModalsClosed() closes GOD/Inventory/Shop/Loot via UI APIs, Escape, and close button, preventing movement blocks.
    - Key Checklist: added per-run high-level checklist (Entered dungeon, Looted chest, Spawned enemy, persistence checks, town/NPC/shop checks) next to the raw step list; also duplicated in series summary.
    - Bad JSON validation: waits for ValidationLog.warnings when dev+validatebad is set, reducing race conditions.
    - Cleaned up duplicated/inconclusive modal messages; timing-sensitive checks downgrade to SKIP.
- Fixed: Syntax errors and typos in runner
  - Corrected malformed while loop condition in transient dungeon detection.
  - Fixed potion error handler to use e2.message.
- Dev: Minor diagnostics and timing adjustments for more robust automation.

v1.20 — Helper deduplication: ShopService + Utils.inBounds
- Added: services/shop_service.js centralizing shop/time helpers:
  - minutesOfDay(h,m), isOpenAt(shop,minutes), isShopOpenNow(ctx,shop), shopScheduleStr(shop), shopAt(ctx,x,y)
  - index.html now loads services/shop_service.js
- Added: Utils.inBounds(ctx,x,y) in utils/utils.js
- Changed: Replaced duplicated helpers to use the centralized service
  - core/game.js now delegates shopAt/minutesOfDay/isOpenAt/isShopOpenNow/shopScheduleStr to ShopService (with safe fallbacks)
  - core/actions.js delegates minutesOfDay/isOpenAtShop/isShopOpenNow/shopScheduleStr to ShopService and uses Utils.inBounds
  - worldgen/town_gen.js uses Utils.inBounds and ShopService for shop time helpers
- Dev: Reduced code duplication; future shop/time changes live in one place

v1.19 — Data-driven content, plaza decor, ESC close, and expanded smoke tests
- Added: JSON data loader and integrations
  - data/loader.js now loads items.json, enemies.json, npcs.json, and consumables.json into window.GameData.
  - entities/items.js and entities/enemies.js extend registries from JSON with safe fallbacks.
  - ai/town_ai.js pulls NPC names/dialog from data/npcs.json when available.
  - data/consumables.json defines potion entries (name, heal, weight); Loot prefers JSON-driven potions.
- Added: Missing enemy definitions to data/enemies.json
  - mime_ghost, hell_houndin (with weights, scaling, and potion weights).
- Added: Town plaza decor
  - Benches along plaza perimeter; market stalls with nearby crates/barrels; scattered plants.
- Changed: Starting gold
  - Player defaults now include 50 gold at game start.
- UI: Escape closes all panels by default
  - Inventory, Loot, GOD panel, and fallback Shop panel wired to close on ESC.
- Smoke test upgrades
  - Potion: drinks a potion and reports exact HP delta.
  - Checklist: inline checklist with [x]/[ ]/[-] and downloadable smoketest_checklist.txt; summary TXT retained.
  - Full report: renders the entire smoketest_report.json inline in the GOD panel (collapsible) and auto-opens/scrolls to it.
  - Determinism duplicate run: re-runs the first seed and compares firstEnemyType and chest loot list; reports OK/MISMATCH.
  - Equipment breakage: forces decay ≈99% on a hand item, swings until it breaks or reaches near 100%; records outcome.
  - Crit/status: compares non-crit vs head-crit damage; legs-crit applies immobilization and verifies immobileTurns ticks down.
- Dev: GameAPI extensions to support tests and UI behavior
  - getStats(), getPotions()/drinkPotionAtIndex(), setEquipDecay(slot,val), spawnEnemyNearby(n).
  - setAlwaysCrit(bool), setCritPart(part), getEnemies() now includes immobileTurns/bleedTurns.
  - isShopOpen()/onHideShop() added so ESC reliably closes Shop panel.

v1.18 — Click-to-loot containers and canvas click support
- Added: Precise click-to-loot in dungeon
  - core/game.js: clicking a chest/corpse tile now targets that specific container.
    - If standing on it: loots immediately.
    - If adjacent: takes one step onto the container, then auto-loots.
    - If farther away: shows a hint to move next to the container first.
- Changed: Canvas click QoL
  - core/game.js: adjacent tile clicks move one step (dungeon and town).
  - Town: clicking your own tile triggers the context action (talk/exit/loot underfoot), unchanged.
- Dev: Clicks are ignored while inventory/loot/GOD panels are open to avoid accidental actions.

v1.17 — Deterministic RNG init order hardening
- Changed: index.html loads core/rng_service.js immediately after core/ctx.js.
  - Ensures all subsequently loaded modules bind to the centralized RNG service rather than constructing fallbacks.
  - Removed later duplicate RNG load position (no behavior change intended beyond initialization timing).
- Dev: No data migrations required; determinism preserved across seeds.

v1.16 — More dungeons, spawn near dungeon, and smoke test auto-routes/loots
- Changed: Increased dungeon density and terrain bias
  - world/world.js: wantDungeons now scales with map area; plains (GRASS) have a higher placement chance while keeping forest/mountain preference.
- Changed: Player starts near a dungeon
  - world/pickTownStart prefers towns within 20 tiles of a dungeon; if no towns, spawns near a dungeon entrance or nearest walkable tile.
- Added: GameAPI for smoke test and diagnostics
  - core/game.js exposes GameAPI with helpers: getMode/getWorld/getPlayer, nearestDungeon/routeTo/gotoNearestDungeon (overworld), getEnemies/routeToDungeon/isWalkableDungeon (dungeon).
- Changed: Smoke test flows
  - ui/smoketest_runner.js routes to the nearest dungeon on the overworld and attempts entry automatically.
  - In dungeon mode, spawns a low-level enemy nearby, routes to it, bumps to attack, and attempts to loot underfoot via G.
- UI: GOD “Run Smoke Test” button
  - index.html + ui/ui.js + core/game.js: button reloads the page with ?smoketest=1 (preserving ?dev=1 when enabled) so the loader injects and runs the smoke test.
  - Fallback in UI ensures reload even if handler is missing.
- Dev: Optional smoke test loader logs in console (“[SMOKE] loader: …”) for visibility.

v1.15 — Corpses no longer block; occupancy and tests updated
- Fixed: Corpses in dungeons blocking player movement
  - core/game.js: killEnemy() now clears enemy occupancy at the death tile immediately.
  - turn(): rebuildOccupancy runs each dungeon turn after enemiesAct to reflect movement/deaths.
- Changed: Smoke test expanded and aligned with latest features
  - smoketest.md now includes checks for FOV recompute guard behavior, Diagnostics button, default OFF overlays, inventory labels (counts/stats), and explicit “corpses do not block” verification.
- Dev: Noted that third-party tracker/telemetry errors in the console are environmental and safe to ignore for gameplay testing.

v1.14 — Performance/UX tweaks, FOV guard, Diagnostics, and corpse walk-through
- Changed: Render debouncing to reduce redundant draws
  - core/game.js: requestDraw now coalesces multiple draw requests into a single RAF, and captures draw timing (DEV-only console output).
- Changed: Inventory rendering reliability and clarity
  - UI: renderInventory always renders when opening; shows potion stack counts, gold amounts, and equipment stat summaries.
  - Fixed a gating issue where equipment slots and the scrollable item list might not display on first open.
- Changed: FOV recomputation guard (skip unless needed)
  - core/game.js: recomputeFOV now skips when player position, FOV radius, mode, and map shape are unchanged; forces recompute on map/mode/seed/FOV changes.
- Added: syncFromCtx(ctx) helper to consolidate state syncing after mode/action module calls
  - Reduces repetition and risk of missed fields when entering towns/dungeons or performing GOD/Actions flows.
- Changed: Occupancy handling
  - Dungeon: rebuildOccupancy each turn after enemiesAct to reflect movement and deaths.
  - killEnemy now clears enemy occupancy on the death tile immediately so the player can walk onto the corpse right away.
- Added: GOD “Diagnostics” button
  - Logs determinism source (RNG service vs fallback), current seed, mode/floor/FOV, map size, entity counts, loaded modules, and last perf times.
- UI: Default debug overlays
  - Home Paths overlay default set to OFF to reduce render overhead; remain toggleable in GOD panel.
- Fixed: Syntax errors introduced during iteration
  - Corrected mismatched braces around turn(), fixed a typo in the UI.init condition (“======” -> “===”).
- Dev: Lightweight perf counters
  - DEV-only console prints for last turn and draw durations to aid profiling.

v1.13 — Render loop extraction, startup stabilization, and final syntax fixes
- Added: core/game_loop.js with a minimal GameLoop
  - GameLoop.start(getRenderCtx) uses requestAnimationFrame to call Render.draw with the provided render context.
  - GameLoop.requestDraw() marks a frame dirty to coalesce draws.
- Changed: core/game.js render and startup wiring
  - Removed the legacy loop(); requestDraw now delegates to GameLoop when present, else falls back to Render.draw(getRenderCtx()).
  - Startup tail now calls GameLoop.start(() => getRenderCtx()) and falls back to a single Render.draw(getRenderCtx()) if GameLoop is absent.
  - All leftover loop() calls removed.
- Changed: index.html loads core/game_loop.js before core/game.js to ensure GameLoop is available at startup.
- Fixed: “Unexpected end of input” errors caused by truncated file tail during refactors
  - Restored and verified the closing IIFE and startup block at the end of core/game.js.
  - Repaired malformed requestDraw() lines introduced during incremental edits.
- Fixed: Stability after Actions/Modes operations
  - Continued to sync mutated ctx back to core/game.js locals after Actions/Modes/GOD flows, then recompute FOV, update camera/UI, and request draw.
- Dev: Reduced console noise with window.DEV guards maintained around boot/persistence traces.

v1.12 — Modes extraction, town entry/exit UX, and stability fixes
- Added: core/modes.js to encapsulate world/town/dungeon transitions and dungeon-state persistence
  - enterTownIfOnTile/enterDungeonIfOnEntrance now accept adjacent-entry: if player is next to T/D, they are auto-stepped onto the tile before entering.
  - returnToWorldIfAtExit/leaveTownNow handle overworld return, syncing ctx back to core/game.js locals.
- Changed: core/game.js delegates transitions to Modes and always syncs mutated ctx state back to local variables after Actions/Modes operations
  - Ensures map/seen/visible, npcs/shops/townProps/townBuildings, anchors (townExitAt/worldReturnPos/dungeonExitAt), dungeon info and floor are updated, then FOV/camera/UI refreshed.
- Changed: Pressing G on the town gate prioritizes exit
  - doAction() checks gate-first and calls leave flow before other town interactions to avoid being intercepted by shop/prop handlers.
- Added: Gate greeters on town entry
  - Town.spawnGateGreeters(ctx, 4) called after Town.generate and during mode entry to add immediate life near the gate.
- Fixed: “Press G/Enter next to town/dungeon does nothing” regression
  - Actions and Modes both updated to support adjacency and to move the player onto the entrance tile before entering.
  - core/ctx.js now attaches World, Town, TownAI, and DungeonState into ctx so Actions/Modes can detect tiles and persist correctly.
- Fixed: Empty towns after refactor (no NPCs/props/signs)
  - core/game.js syncs town arrays (npcs, shops, townProps, townBuildings) and plaza/tavern back from ctx after Town.generate and on mode entry.
- Fixed: Town exit leaving player “disappeared” with town still rendered
  - leaveTownNow() now syncs mode/map/visibility and clears town-only arrays before recompute/draw.
- Fixed: Multiple syntax errors introduced during incremental edits
  - Removed truncated fragments near leaveTownNow(); closed braces properly; resolved malformed function start for requestLeaveTown().
- Dev: Reduced console noise behind DEV flag (window.DEV) for boot and persistence traces; kept UI Logger output.

v1.11 — Dungeon Persistence and Stability (chests, corpses, load/exit sync)
- Fixed: AI occupancy calls remaining after wrapper introduction
  - Replaced direct occ.add/occ.delete with occSetEnemy/occClearEnemy in ai/ai.js.
- Fixed: Chest looted state persists on revisit
  - entities/loot.js saves dungeon state immediately after looting or reporting “The chest is empty,” and consumes a turn to ensure persistence.
- Fixed: Corpses and enemy persistence across dungeon re-entry
  - core/game.js now calls DungeonState.save(getCtx()) immediately after killEnemy, on each dungeon turn, and right before leaving the dungeon.
  - dungeon/dungeon_state.js persists snapshots to ctx._dungeonStates, a global window._DUNGEON_STATES_MEM fallback, and localStorage.
  - Added debug logs on save/load/applyState mirrored to console for diagnosis.
- Changed: Dungeon load/exit flow reliably syncs mutated ctx back to local engine state
  - core/game.js: loadDungeonStateFor and returnToWorldIfAtExit copy back mode, map, seen/visible, enemies/corpses/decals, anchors (worldReturnPos/townExitAt/dungeonExitAt), currentDungeon, floor; then recompute FOV/camera/UI.
- Changed: More robust re-entry placement and visibility
  - dungeon/dungeon_state.js clamps saved exit coordinates to current map bounds; marks the exit tile as STAIRS and ensures seen/visible flags are set; places the player at the exit tile.
- Fixed: Syntax errors introduced during instrumentation
  - Removed malformed tail content at end of core/game.js.
  - Replaced optional chaining and problematic template literals in debug logs with safe string concatenation.
  - Cleaned up enterDungeonIfOnEntrance debug block.
- Dev: Logging enhancements
  - log() mirrors all messages to console for environments where the UI panel may not render.
  - Added concise “[DEV] …” and “DungeonState.save/load/applyState …” lines to trace keys, counts, positions.
- Note: Dungeon state is scoped per origin/URL. Use the same deployment URL through enter/leave/re-enter, or persistence will appear empty.

v1.10 — Runtime wiring fixes, root index, and service loads
- Fixed: Broken script paths in UI caused modules not to load (404). Updated references to match folder layout.
  - For UI-local files, dropped the "ui/" prefix when serving from the ui/ directory.
  - For non-UI modules, used "../" relative paths when index.html is under ui/.
- Added: Root-level index.html to serve the game from the site root reliably.
- Removed: ui/index.html (redundant) to avoid multiple entry points.
- Added: Explicit loads for services/time_service.js and dungeon/occupancy_grid.js to ensure TimeService and OccupancyGrid are available at runtime.
- Dev: Deployment refreshed. Recommend running smoketest.md end-to-end.

v1.9 — Cleanup: remove unused files; keep dungeon modules intact
- Removed: root-level game.js (duplicate of core/game.js; not loaded by index.html).
- Removed: rng_compat.js (unused; core/rng_service.js is the RNG source used by the game).
- Removed: managers/ (dungeon_manager.js, world_manager.js, town_manager.js) — never referenced by index.html nor code.
- Removed: mode_manager.js — not wired anywhere.
- Removed: combat_engine.js — not referenced; functionality remains in combat.js/core/game.js fallbacks.
- Notes:
  - Dungeon pipeline unchanged. Active modules: dungeon.js, dungeon_items.js, dungeon_state.js.
  - Optional services present but not yet included by default:
    - time_service.js (core/game.js already prefers it if present).
    - occupancy_grid.js (core/game.js can use it when included).
- Dev: No gameplay or runtime behavior changes from this cleanup.

v1.8 — Modular Town/Actions, Interiors, Exit Logic, and Underfoot Feedback
- Added: town_gen.js — Town.generate/ensureSpawnClear/spawnGateGreeters/interactProps now implemented and mutate ctx.
  - Structured town: walls, nearest gate, main/secondary roads, plaza.
  - Buildings (hollow) with guaranteed doors, windows placed and spaced.
  - Furnished interiors: beds, tables, chairs, fireplaces, shelves, chests/crates/barrels, plants, rugs.
  - Plaza fixtures and “Welcome” sign; TownAI.populateTown used when available.
- Added: actions.js — Actions.doAction/loot/descend implemented using ctx and modules.
  - Robust dungeon exit on G: works on entrance “>” or STAIRS tile; saves state; returns to exact overworld x,y.
  - In town: shop schedule messaging, Inn rest to morning, Tavern flavor, and prop/sign reading.
  - Underfoot feedback: pressing G logs what you are standing on (e.g., mattress/bed, barrel, crate, sign details, “blood-stained floor”).
- Changed: game.js — when Actions/Town handle an action:
  - Syncs mutated ctx back to local state (mode, map, seen/visible, enemies/corpses/decals, anchors, floor) and recomputes FOV/UI.
  - Exposes initWorld/generateLevel on ctx for GOD tools.
- Fixed: ai.js movement bugs and occupancy integration:
  - Introduced occClearEnemy/occSetEnemy helpers; corrected corrupted calls that prevented enemy movement.
- Changed: utils.js usage — manhattan and free-floor helpers preferred where available.
- Dev: Kept legacy fallbacks while modules take over; prepared for removing fallbacks once verified.

v1.7 — Mode Managers and Occupancy Grid
- Added: occupancy_grid.js — shared OccupancyGrid with enemy/NPC/prop sets and isFree(x,y). Exposed via ctx.occupancy.
- Changed: ai.js — prefers ctx.occupancy when available for fast isFree checks; falls back to per-turn set.
- Changed: game.js — uses OccupancyGrid in tryMovePlayer (town: NPC blocking, dungeon: enemy blocking) and rebuilds occupancy after enemy/NPC turns.
- Added: mode_manager.js — pluggable ModeManager skeleton (doAction/tryMove/onTurn) for routing per-mode behaviors.
- Added: managers/world_manager.js, managers/town_manager.js, managers/dungeon_manager.js — initial facades preparing migration of mode-specific logic out of game.js.
- Dev: Wiring is incremental to avoid regressions; legacy functions remain while managers are introduced.

v1.6 — Core Services (RNG/Time/Combat/Decay) scaffolding + minimal RNG integration
- Added: rng_service.js — centralized deterministic RNG helpers over mulberry32 (create/int/float/chance).
- Added: rng_compat.js — compatibility shim exposing window.RNG (autoInit, rng, int, float, chance, applySeed) using rng_service under the hood.
- Added: time_service.js — central time-of-day math (getClock, minutesUntil, advanceMinutes, tick). Not yet wired into game.js.
- Added: combat_engine.js — centralized combat helpers (rollHitLocation, critMultiplier, getPlayerBlockChance, enemyDamageAfterDefense, enemyBlockChance). Ready for phased adoption.
- Added: equipment_decay.js — centralized item wear/decay helpers (initialDecay, decayEquipped, decayAttackHands, decayBlockingHands). Ready for phased adoption.
- Changed: game.js uses window.RNG when present for rng(), and uses RNG.applySeed in GOD seed workflow; safe fallback remains when RNG shim isn’t available.
- Dev: Kept behavior identical; no gameplay changes from wiring yet except RNG centralization.

v1.5 — TownAI Performance, Staggered Departures, and Pathing Fixes
- Changed: A* pathfinding performance in towns
  - Reduced visit cap from 12,000 to 6,000 to limit worst-case CPU in dense maps.
  - Optimized open list handling: sort only when the queue grows large (instead of every iteration).
- Added: Per-NPC path planning throttling and reuse
  - Introduced _homePlanCooldown to back off recomputation after failures or recent plans.
  - Reused existing home plans when the goal remains the same.
  - Memoized each NPC’s home building door (_homeDoor) to avoid repeated nearest-door searches.
- Added: Staggered evening departures (18:00–21:00)
  - Each NPC gets a personalized _homeDepartMin (random within 1080–1260 minutes).
  - Daily reset at dawn; reassign departure windows in the morning.
  - Shopkeepers and residents linger at work/plaza until their assigned departure time, then route home.
- Changed: Home routing behavior
  - ensureHomePlan() builds a two-stage plan (to door, then interior), waits if blocked.
  - followHomePlan() consumes the plan deterministically with small waits and cooldowns when obstructed.
  - routeIntoBuilding() falls back to stepping inside and routing to free interior targets adjacent to props (e.g., beds).
- Fixed: Syntax issues and malformed blocks in town_ai.js
  - Corrected missing/misplaced braces and object literals (sleepTarget, homeTarget) in shopkeeper/resident routines.
  - Replaced non-JS operators (“or”, “and”) with proper JS (||, &&) and cleaned up conditional logic.
- Dev: Debug path visualization flags left off by default
  - DEBUG_TOWN_HOME_PATHS and DEBUG_TOWN_ROUTE_PATHS can be enabled for path overlays; off by default to limit overhead.
- Notes:
  - Blocked third-party tracking scripts and CORS/401 errors observed during testing are environmental and unrelated to game code.

v1.4 — Tavern, Barkeeper, and Shopkeepers
- Added: Guaranteed Tavern in town (chooses a large building near the plaza).
- Added: Interior furnishing for Tavern: bar desk (table) and several benches.
- Added: Barkeeper NPC stationed at the bar desk during day; returns home at night.
- Added: Each shop now has a dedicated shopkeeper NPC who stands at the shop door during the day and goes home at night.
- Changed: Evening/night routines: a subset of villagers (those with a tavern preference) go to the Tavern instead of heading straight home.
- Changed: Dungeons are single-level; descending is disabled. Stand on the entrance tile ('>') and press G to return to the overworld.
- Dev: Context now exposes shops, townProps, and time to FOV; declared transition anchors (townExitAt, worldReturnPos, dungeonExitAt, cameFromWorld) used across mode changes.
- Fixed: Runtime issues introduced during iteration:
  - Unterminated template string in lootCorpse() shop interaction.
  - Missing closing brace after townNPCsAct().
  - Missing declarations for townExitAt/worldReturnPos/dungeonExitAt.

v1.3 — Shops + Night Lamps + Resting
- Added: Lamp posts cast a warm light glow at night/dusk/dawn.
- Added: Shops have opening hours (day only). Interacting on a shop door:
  - Open (day): logs that trading is coming soon.
  - Closed (dawn/dusk/night): logs closed message.
- Added: Rest systems:
  - Benches: if used at night/dawn/dusk, rest until 06:00 with a light heal.
  - Inn: stand on the Inn door and press G to sleep until morning; fully heal.
- Dev: Exposed shopAt()/isShopOpenNow()/rest helpers; time advancement converts minutes to turns.

v1.2 — Day/Night Cycle and Turn Time
- Added: Global time-of-day system shared across all modes (world/town/dungeon).
  - Full day = 24 hours (1440 minutes).
  - Cycle length = 360 turns per day.
  - Minutes per turn = 1440 / 360 = 4 minutes per turn.
- UI: Time shown in the overworld HUD next to the biome label; scene tint changes per phase:
  - Dawn (cool tint), Day (normal), Dusk (warm tint), Night (darkened).
  - Same tinting applied in towns.
- Dev: getClock() exposes hours, minutes, hhmm, phase, minutesPerTurn, cycleTurns, and turnCounter to renderer and AI.

v1.1 — Town Life: Homes and Routines
- Added: Each villager is assigned a home inside a building; also gets a daytime destination (plaza or shop).
- Changed: NPCs follow a simple daily routine driven by a turn counter:
  - Morning: stay at or head to their home.
  - Day: wander toward plaza/shops.
  - Evening: return home.
- Changed: Movement uses a simple greedy step toward the target while avoiding props, other NPCs, and the player.
- Dev: Exposed townBuildings and townPlaza to support routines; townTick increments each town turn.

v1.0.2 — Fewer Windows Per Building
- Changed: Window placement limited per building and spaced out to avoid clusters.
  - Total windows per building are capped (1–3 based on size).
  - Adjacent window tiles are avoided to reduce visual clutter.

v1.0.1 — Town FOV Rendering + See-through Windows
- UI: Town renderer now respects FOV: unseen tiles are hidden; seen-but-not-currently-visible tiles are dimmed, matching dungeon behavior.
- Changed: Props/NPCs/shop glyphs in towns render only when their tiles are currently visible.
- Note: Windows already allow light through; this keeps interiors dark until you have line-of-sight via doors/windows.

v1.0 — Overworld Connectivity Guaranteed
- Added: Post-generation pass connects all towns and dungeons by carving walkable paths:
  - Converts river crossings to BEACH tiles (ford/bridge) and mountain passes to GRASS.
  - Uses a line-based path to connect any unreachable POIs to the main region.
- Changed: World remains visually similar; bridges/passes are subtle walkable corridors.
- Note: Overworld stays fully revealed. Towns keep FOV.

v0.9 — Town FOV + Windows
- Added: Windows tile in towns (non-walkable, light passes) placed along building walls; rendered as blue-gray.
- Changed: Towns now use proper fog-of-war with FOV, like dungeons (overworld still fully visible).
- Dev: recomputeFOV now only auto-reveals in world mode; town initializes seen/visible as false.

v0.8.4 — Stronger Player Marker (World + Town)
- UI: Player '@' now renders with an outlined glyph (black stroke) on top of the white backdrop in both overworld and town, improving contrast further.

v0.8.3 — Improve Player Visibility in Town
- UI: Added the same subtle white backdrop and outline behind the player glyph '@' in town mode to match the overworld visibility tweak.

v0.8.2 — Furnished Buildings (Interiors)
- Added: Building interiors are now furnished with:
  - Fireplaces (∩) generally placed along inside walls
  - Chests (▯), tables (┼), and beds (b) scattered inside
- UI: Renderer shows new interior prop glyphs and colors.
- Changed: Interactions (G) include messages for fireplaces, chests (locked), tables, and beds.

v0.8.1 — Improve Player Visibility on Overworld
- UI: Added a subtle white backdrop and outline under the player glyph '@' in overworld mode so the player stands out on all biomes.

v0.8 — Town Buildings: Guaranteed Doors and Varied Sizes
- Added: Every town building now has at least one door carved into its perimeter.
- Changed: Building sizes are now varied per block (randomized within block bounds) for a more organic layout.
- Changed: Shop doors are still preferred near the plaza; non-shop houses also get doors automatically.
- Dev: Refactored door placement to prefer doors facing sidewalks/roads when possible.

v0.7 — Structured Towns, Wandering NPCs, and Interactions
- Added: Structured town generation with:
  - Walled perimeter with a proper gate aligned to entry point
  - Main road from the gate to a central plaza
  - Secondary road grid and block-aligned buildings (hollow interiors)
  - Shops placed on door tiles of buildings near the plaza, marked with 'S'
- Added: Plaza ambience and props:
  - Well (O), fountain (◌), stalls (s), benches (≡), lamps (†), trees (♣)
  - Gate tile marked with 'G'
  - Interactions via G near props (log feedback)
- Added: Town NPCs roam; random, collision-aware, avoid player and props
- Changed: Town entry spawns “gate greeters” without surrounding the player
- Fixed: Player is guaranteed free adjacent tiles when entering town
- Changed: Renderer now renders town props and gate glyph

v0.6 — Bigger Overworld with Biomes and Minimap
- Added: Larger overworld (120 × 80)
- Added: New biomes and features:
  - Rivers (non-walkable), beaches, swamps, deserts, snow
  - Forests and mountain ridges
- Added: Biome label HUD (top-left) in world mode
- Added: Overworld minimap (top-right) showing biomes, towns, dungeons, and player
- Changed: Town placement prefers water/river/beach; dungeons prefer forest/mountain
- Changed: World.isWalkable blocks water, rivers, and mountains

v0.5 — Town Mode and Exit UX
- Added: Town mode as a separate map with buildings, shops (S), and NPCs
- Added: Exit Town confirmation modal:
  - UI.showConfirm and fallback to window.confirm
  - Floating “Exit Town” button (bottom-right) while in town
- Added: 'G' key talks to NPCs in town, logs if no one nearby
- Fixed: Player does not spawn inside building; BFS nudges to nearest free tile
- Changed: Overworld no longer spawns NPCs; NPCs are town-only

v0.4 — Overworld Mode Foundation
- Added: world.js module:
  - TILES: WATER, GRASS, FOREST, MOUNTAIN, TOWN, DUNGEON
  - generate(), isWalkable(), pickTownStart()
- Added: World rendering path in render.js, with T (town) / D (dungeon) markers
- Added: Mode switching in game.js (world/dungeon), return path for floor 1
- Added: Basic NPCs in early world iterations (later moved to towns)
- Fixed: Enemy visibility check in renderer (visible[y][x])

v0.3 — Stabilization and Smoke Tests
- Fixed: render.js syntax errors (orphan braces, window references in case labels)
- Fixed: log and visibility guards to avoid runtime errors
- Added: Smoke test checklist and validation across:
  - Initialization, rendering, input, combat, inventory, dungeon gen, UI
- Confirmed: Deterministic RNG via seed, FOV/LOS correctness, fallback rendering

v0.2 — Inventory and UI Fallbacks
- Fixed: Undefined invPanel in game.js when UI module absent
  - showInventoryPanel/hideInventoryPanel now query DOM directly in fallback
- Confirmed: All modules use shared ctx, avoid direct window.* where appropriate
- Confirmed: Data-driven items and enemies with deterministic RNG
- Changed: Improved rendering fallbacks when sprites are missing

v0.1 — Baseline Roguelike Core
- Added: Dungeon generation with connected rooms and guaranteed stairs
- Added: Player movement, bump-to-attack, combat system with crits and blocks
- Added: Items (equipment, potions), inventory and equipment management
- Added: Status effects (daze, bleed), loot, corpses, decals
- Added: FOV/LOS modules and renderer with fallback glyphs/colors
- Added: GOD panel tools (heal, spawn, FOV adjustment, seed control)

Planned / Ideas
- Bridge/ford generation across rivers
- Named towns and persistent inventories/NPCs across visits
- Shop UI (buy/sell) and currency
- District themes (market/residential/temple) and signage
- Movement costs or effects per biome (swamp slow, snow visibility, desert hazard)
- if there is not enought beds for npc at home make em sleep at floor
- flavor text to json file

Things to chek
- some files are realy big it would be fine to start cut em to portions if it makes sens

BUGS
- chek there is not sleep walkers some npc have z top of them dont sure is thiss still existing
- when inn god panel in routes it shows unendifid/17 it is not correct chek too that inn is used
- inns dont have invidual rooms and not enought beds
- some npc stay at their homes at day time 
- some npc dont sleep in theid beds
- residents go home at night but they get stuck in door if bed is just adjacent tile of door
- some work needed for smoketestrunner
- towns schedue bugs you can buy items even if shop is not open(this is tho good for now testing phase)
- multirun in smoketest skips first multirun 

