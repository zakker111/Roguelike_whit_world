# Game Version History
Last updated: 2025-10-03 19:05 UTC

This file tracks notable changes to the game across iterations. Versions here reflect functional milestones rather than semantic releases.

Conventions
- Added: new features or modules
- Changed: behavior or structure adjustments
- Fixed: bug fixes
- UI: user interface-only changes
- Dev: refactors, tooling, or internal changes

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

Bugs
- chek there is not sleep walkers some npc have z top of them dont sure is thiss still existing
- when inn god panel in routes it shows unendifid/17 it is not correct chek too that inn is used
- inns dont have invidual rooms and not enought beds
- some npc stay at their homes at day time 
- some npc dont sleep in theid beds
- residents go home at night but they get stuck in door if bed is just adjacent tile of door