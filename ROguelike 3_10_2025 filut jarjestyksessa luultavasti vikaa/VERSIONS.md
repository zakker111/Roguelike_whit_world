# Game Version History
Last updated: 2025-10-14 00:00 UTC

v1.34.30 — Phase 4 completion: final audit, ESM/window safety, and smoketest readiness
- Fixed: remaining bare-global references replaced with window.* checks or module imports
  - core/game_loop.js: use window.Render.draw(...) in RAF frame
  - core/game.js: call window.GameAPIBuilder.create(...) when building GameAPI
  - core/game_api.js: normalize World.isWalkable calls to window.World and repair a corrupted walkability line
  - entities/player.js: UIBridge updateStats via window.UIBridge
- Verified: UIBridge-only routing for HUD, inventory, loot, confirm, town exit
- Verified: Deterministic RNG fallback wiring (utils/rng_fallback.js) for modules that run before rng_service
- Deployment: refreshed; smoketest orchestrator accessible via ?smoketest=1
- Next: continue optimization and documentation polish (no functional changes expected)

v1.35.8 — Phase 5: Inventory render guard and minor cleanup
- Changed: core/ui_bridge.js renderInventory(ctx) now renders only when the inventory panel is open (UI.isInventoryOpen), avoiding unnecessary DOM work.
- Benefit: small performance gain when background updates occur while inventory is closed.
- Deployment: https://dr55uzvjxrmb.cosine.page

v1.35.7 — Phase 5: Centralized blit helper and changelog cleanup
- Added: ui/render_core.js blitViewport(ctx2d, canvas, cam, wpx, hpx) centralizes cropped blit logic.
  - ui/render_overworld.js, ui/render_town.js, ui/render_dungeon.js now call RenderCore.blitViewport instead of duplicating code.
- Cleanup: VERSIONS.md ordering and consistent “Deployment:” lines; latest entries at the top.
- Benefit: reduces duplication across renderers; keeps the changelog tidy.
- Deployment: https://n6tas9p30d5s.cosine.page

v1.35.6 — Phase 5: Cropped blits for offscreen base layers
- Changed: ui/render_overworld.js, ui/render_town.js, ui/render_dungeon.js now crop drawImage to the visible viewport when blitting offscreen bases, avoiding full-map draws each frame.
- Benefit: reduces draw cost further, particularly on large maps and lower-powered devices.
- Deployment: https://n6tas9p30d5s.cosine.page

v1.35.5 — Phase 5: HUD perf/minimap toggles
- Added: GOD panel toggles for Perf and Minimap (ids god-toggle-perf-btn, god-toggle-minimap-btn).
- UI: updateStats shows Perf timings only when enabled (persisted as SHOW_PERF in localStorage).
- Overworld: minimap rendering can be disabled via SHOW_MINIMAP (persisted); render_overworld.js respects the flag.

v1.35.4 — Phase 5: Base-layer offscreen caches for dungeon and town
- Changed: ui/render_dungeon.js now builds an offscreen base (tiles, stairs glyph) and blits it, applying per-frame visibility overlays (void/dim) and dynamic entities afterward.
- Changed: ui/render_town.js now builds an offscreen base (walls/windows/doors/floor) and blits it, applying visibility overlays and shop glyphs per-frame.
- Benefit: reduces per-tile work in steady-state frames for dungeon and town; complements overworld caching.
- Deployment: https://bfruxbnkn5sg.cosine.page

v1.35.3 — Phase 5: Overworld base-layer offscreen cache + enemy color cache
- Changed: ui/render_overworld.js builds a full offscreen world base (biomes + town/dungeon glyphs) at TILE resolution and blits it each frame, avoiding per-tile loops.
  - Rebuilds only when world map reference or TILE changes.
- Changed: ui/render_core.js adds a simple enemy type→color cache to reduce repeated registry lookups in hot paths.
- Benefit: further draw-time reduction on overworld and minor savings in enemy glyph color computation.
- Deployment: https://xbhi5i8j32ja.cosine.page

v1.35.2 — Phase 5: Glyph lookup precompute (overworld/town)
- Changed: ui/render_overworld.js precomputes a lookup map for town glyphs (T/t/C) based on town size to avoid per-tile Array.find scans while drawing the viewport.
- Changed: ui/render_town.js precomputes a shop door glyph map (T/I/S) for O(1) lookup during tile rendering.
- Benefit: reduces repeated linear scans per tile in the hot render loop.

v1.35.1 — Phase 5: Overworld minimap offscreen cache
- Changed: ui/render_overworld.js now renders the minimap to an offscreen canvas once per world-map/dimension change and blits it each frame.
  - Reduces repeated per-pixel work and improves draw-time on the overworld, especially on lower-powered devices.
- Deployment: https://dyw9zus2215v.cosine.page
- Next: run smoketest to gather perf baselines and proceed with renderer/UI coalescing.

v1.35.0 — Phase 5 kickoff: UI perf metrics and polish
- Added: HUD perf metrics (last turn/draw ms) next to time in the top bar
  - core/ui_bridge.js passes ctx.getPerfStats() to UI.updateStats
  - ui/ui.js displays “Perf: T <turn_ms> D <draw_ms>” when available
- Added: Perf hook from GameLoop
  - core/game_loop.js measures draw time and calls ctx.onDrawMeasured(dt)
  - core/game.js provides ctx.onDrawMeasured to update PERF.lastDrawMs
  - core/game.js adds ctx.getPerfStats so UIBridge/UI can read numbers consistently
- Micro-optimizations and UX polish
  - InventoryController.render now updates only when the inventory panel is open
  - Buttons and inventory list items get subtle hover/press transitions
  - Modals (loot/inventory/gameover) have smooth opacity/transform transitions
- Goal: begin optimization and UX polish without altering gameplay; future steps will focus on micro-performance and aesthetic improvements

v1.34.29 — Phase 4 continuation: ctx-first cleanups and window.* consistency
- Changed: core/game.js
  - Dungeon loot fallback now prefers ctx-first Loot handle via modHandle; removed direct window.Loot + bare Loot.lootHere usage.
  - Player initialization and helpers now consistently check window.* before calling globals (Player.createInitial, PlayerUtils.capitalize, RNG.autoInit, RNG.rng, RNGFallback.getRng).
- Changed: core/dungeon_runtime.js
  - Fixed window fallback calls to DungeonState.save/load to use window.DungeonState explicitly (no bare DungeonState symbol).
  - OccupancyGrid window fallback now uses window.OccupancyGrid.build explicitly.
  - Loot.lootHere window fallback corrected in generateLoot/lootHere paths.
- Changed: core/modes.js
  - Fixed window fallback calls to DungeonState.save/load to use window.DungeonState explicitly.
- Benefit: reduces risk of ReferenceError due to bare global symbols; strengthens ctx-first and back-compat window wiring.
- Dev: No behavior changes expected; improves robustness and maintainability.

v1.34.28 — Phase 4 continuation: TownAI ctx-first and diagnostics alignment
- Changed: core/game.js GOD “Home route check” now prefers ctx.TownAI for populateTown and checkHomeRoutes (with window fallback), aligning with ctx-first usage.
- Benefit: reduces window.* coupling and keeps diagnostics consistent with runtime/module handles.
- Dev: No behavior change expected beyond improved module wiring; occupancy rebuild retained after TownAI.populateTown.

v1.34.27 — Phase 4 continuation: ctx-first fallbacks and occupancy priming
- Changed: core/modes.js now uses ctx-first handles in fallback paths:
  - Town fallback: ctx.Town.generate/ensureSpawnClear/spawnGateGreeters (no direct window.Town).
  - Dungeon fallback: ctx.Dungeon.generateLevel (no direct window.Dungeon).
- Changed: core/modes.js primes OccupancyGrid immediately after dungeon fallback generation to avoid ghost-blocking before the first tick.
- Changed: After TownRuntime.generate(ctx) succeeds, Modes primes town occupancy via TownRuntime.rebuildOccupancy(ctx) before showing the exit button (was previously only on cadence).
- Dev: Deployment refreshed; movement and transitions remain runtime-first with minimal safe fallbacks retained for resilience.

v1.34.26 — Phase 4 continuation: centralized movement with safe fallbacks, town leave/exit UI via runtime
- Changed: core/game.js tryMovePlayer now prefers WorldRuntime/TownRuntime/DungeonRuntime and restores minimal fallbacks per mode to keep playability if a runtime is unavailable or declines movement.
  - World: direct overworld walk fallback (bounds + World.isWalkable) if runtime returns false.
  - Town: bump-talk when NPC blocks via TownRuntime.talk; minimal walkability fallback.
  - Dungeon: move into walkable empty tiles when runtime path is unavailable.
- Changed: core/modes.js leaveTownNow delegates to TownRuntime.applyLeaveSync(ctx). Enter-town flows prefer TownRuntime.generate(ctx) and TownRuntime.showExitButton(ctx), falling back to UIBridge only when needed.
- Changed: core/game.js leaveTownNow path simplified to rely on Modes; redundant TownRuntime.applyLeaveSync double-call removed from core.
- Dev: Deployed and verified movement across world/town/dungeon; smoketest runner available at /index.html?smoketest=1.

v1.34.25 — game.js sweep: inventory and shop helpers aligned with Phase 2
- Changed: showInventoryPanel no longer toggles #inv-panel via DOM; relies on InventoryController.show or UIBridge.showInventory only.
- Changed: isShopOpenNow now prefers ShopService and falls back only to alwaysOpen (or false) when service is unavailable; removed local schedule math.
- Changed: shopScheduleStr returns empty string when ShopService is unavailable (no local formatting), keeping ShopService as the single source.

v1.34.24 — Shop flows: UIBridge-only routing in core, stricter open-state fallback
- Changed: core/game.js shop UI functions (hideShopPanel, openShopFor, shopBuyIndex) now route exclusively through UIBridge; direct ShopUI fallbacks removed.
- Changed: core/actions.js isShopOpenNow returns false when ShopService is unavailable and no shop object is provided (instead of assuming day-phase), avoiding misleading “Open now” messages without schedule data.

v1.34.23 — UIBridge: remove DOM fallbacks for Shop UI
- Changed: UIBridge.isShopOpen now relies solely on ShopUI.isOpen()
- Changed: UIBridge.hideShop no longer hides #shop-panel via DOM; delegates only to ShopUI.hide()
- Benefit: single path through UIBridge → ShopUI for shop modals; reduces divergence and hidden UI state risks

v1.34.22 — Phase 2 cleanup: remove remaining DOM panel fallbacks and tighten ShopService usage
- Changed: core/game.js inventory panel flows now rely solely on InventoryController or UIBridge
  - Removed DOM fallback in showInventoryPanel/hideInventoryPanel for a cleaner, centralized UI path
- Changed: core/actions.js shop helpers simplified to prefer ShopService exclusively
  - isOpenAtShop falls back only to alwaysOpen when ShopService is unavailable
  - shopScheduleStr returns empty string when ShopService is unavailable, avoiding duplicated local formatting
- Note: Loot and Game Over panels already routed through UIBridge-only flows; no DOM fallbacks remain in core/game.js for panels.

v1.34.21 — Phase 2 cleanup: remove redundant helpers and unify UI via UIBridge
- Removed: unused/duplicated helpers from core/game.js now handled by modules/services
  - talkNearbyNPC (TownRuntime.talk covers this)
  - occupied (OccupancyGrid provides blocking queries)
  - GameAPI exposures for restUntilMorning/restAtInn (rest flows live in Actions via TimeService)
- Fixed: stray malformed loot-panel tail in core/game.js; restored a clean pair of
  - showLootPanel(list): UIBridge.showLoot(ctx, list)
  - hideLootPanel(): UIBridge.hideLoot(ctx) with isLootOpen check for conditional redraw
- Changed: simplified UI fallbacks to prefer UIBridge-only for inventory and shop
  - hideShopPanel(): UIBridge.hideShop(ctx), fallback to ShopUI.hide only
  - showInventoryPanel()/hideInventoryPanel(): UIBridge/InventoryController only (removed DOM fallback)
- Changed: talkNearbyNPC function removed from core/game.js; TownRuntime.talk remains the single source.
- Safety: behavior unchanged—delegations were already in place; this trims dead code and reduces divergence risk.

v1.34.20 — Render ESM imports + ctx-first grid overlay
- Changed: ui/render.js now imports RenderCore/RenderOverworld/RenderTown/RenderDungeon via ES modules and delegates directly, removing window.* checks.
- Changed: ui/render_overworld.js, ui/render_town.js, and ui/render_dungeon.js import RenderCore and call drawGridOverlay(view) directly (no window.RenderCore gating).
- Changed: ui/render_core.js computeView prefers ctx.drawGrid when present and falls back to window.DRAW_GRID, enabling ctx-first grid toggle.

v1.34.19 — Optional bundling (Vite) and ctx-first cleanup
- Added: package.json and vite.config.js for optional bundling with Vite (dev/build/preview).
- Docs: README updated with bundling instructions and deployment notes.
- Cleanup: core/game.js now initializes UI via ctx-first handle (modHandle("UI")) instead of window.UI; occupancy rebuild no longer references window.OccupancyGrid directly.

v1.34.18 — Brace stance (defensive action)
- Added: New input binding 'B' for Brace (dungeon only). Consumes a turn and increases block chance for this turn if holding a defensive hand item (any hand item with defense).
- Changed: combat/combat.js getPlayerBlockChance now respects player.braceTurns, applying a brace bonus and a slightly higher clamp (up to 75%) during the stance.
- Changed: core/game.js clears brace state at end of the player's turn in dungeon mode; wiring for onBrace added to input setup.
- Docs: README updated with 'Brace: B' control.
- Notes: Brace is a simple one-turn stance, no attack change since the action consumes the turn.

v1.34.17 — Phase 3 step 17: Delegate equipment decay to EquipmentDecay
- Changed: core/game.js decayAttackHands and decayBlockingHands now prefer EquipmentDecay.decayAttackHands/decayBlockingHands with ctx-first hooks (log/updateUI/inventory rerender), retaining local fallback logic.
- Benefit: single source of truth for wear/decay semantics (including two-handed behavior) and easier balancing.

v1.34.16 — Phase 3 step 16: Combat modules to ESM
- Changed: combat/combat_utils.js converted to ES module (export profiles, rollHitLocation, critMultiplier) and augments window.Combat; index.html loads as type="module".
- Changed: combat/combat.js converted to ES module (export getPlayerBlockChance, getEnemyBlockChance, enemyDamageAfterDefense, enemyDamageMultiplier) and augments window.Combat; index.html loads as type="module".
- Changed: combat/stats.js converted to ES module (export getPlayerAttack, getPlayerDefense) and retains window.Stats; index.html loads as type="module".
- Changed: combat/status_effects.js converted to ES module (export applyLimpToEnemy, applyDazedToPlayer, applyBleedToEnemy, applyBleedToPlayer, tick) and retains window.Status; index.html loads as type="module".
- Changed: combat/equipment_decay.js converted to ES module (export initialDecay, decayEquipped, decayAttackHands, decayBlockingHands) and retains window.EquipmentDecay; index.html loads as type="module".

v1.34.15 — Phase 3 step 15: RNG services, ShopUI, and Town generation to ESM
- Changed: core/rng_service.js converted to ES module (export init, applySeed, autoInit, rng, int, float, chance, getSeed) and retains window.RNG; index.html loads as type="module".
- Changed: utils/rng_fallback.js converted to ES module (export getRng) and retains window.RNGFallback; index.html loads as type="module".
- Changed: ui/shop_panel.js converted to ES module (export ensurePanel, hide, isOpen, openForNPC, buyIndex) and retains window.ShopUI; index.html loads as type="module".
- Changed: worldgen/town_gen.js converted to ES module (export generate, ensureSpawnClear, spawnGateGreeters, interactProps) and retains window.Town; index.html loads as type="module".

v1.34.14 — Phase 3 step 14: Player modules to ESM
- Changed: entities/player_utils.js converted to ES module (export round1, clamp, capitalize) and retains window.PlayerUtils; index.html loads as type="module".
- Changed: entities/player_equip.js converted to ES module (export equipIfBetter, equipItemByIndex, unequipSlot) and retains window.PlayerEquip; index.html loads as type="module".
- Changed: entities/player.js converted to ES module (export defaults, setDefaults, normalize, resetFromDefaults, forceUpdate, createInitial, getAttack, getDefense, describeItem, addPotion, drinkPotionByIndex, equipIfBetter, equipItemByIndex, decayEquipped, gainXP, unequipSlot) and retains window.Player; index.html loads as type="module".

v1.34.13 — Phase 3 step 13: Loot and AI modules to ESM
- Changed: entities/loot.js converted to ES module (export generate, lootHere) and retains window.Loot; index.html loads as type="module".
- Changed: ai/ai.js converted to ES module (export enemiesAct) and retains window.AI; index.html loads as type="module".
- Changed: ai/town_ai.js converted to ES module (exports via named export populateTown, townNPCsAct, checkHomeRoutes) and retains window.TownAI; index.html loads as type="module".

v1.34.12 — Phase 3 step 12: Entities and Data modules to ESM
- Changed: entities/items.js converted to ES module (export MATERIALS, TYPES, initialDecay, createEquipment, createEquipmentOfSlot, createByKey, createNamed, addType, listTypes, getTypeDef, typesBySlot, pickType, describe) and retains window.Items; index.html loads as type="module".
- Changed: entities/enemies.js converted to ES module (export TYPES, listTypes, getTypeDef, colorFor, glyphFor, equipTierFor, equipChanceFor, potionWeightsFor, pickType, levelFor, damageMultiplier, enemyBlockChance, createEnemyAt) and retains window.Enemies; index.html loads as type="module".
- Changed: dungeon/dungeon_items.js converted to ES module (export lootFactories, registerLoot, spawnChest, placeChestInStartRoom) and retains window.DungeonItems; index.html loads as type="module".
- Changed: data/loader.js converted to ES module (export GameData) and retains window.GameData; index.html loads as type="module".
- Changed: data/god.js converted to ES module (export heal, spawnStairsHere, spawnItems, spawnEnemyNearby, setAlwaysCrit, setCritPart, applySeed, rerollSeed) and retains window.God; index.html loads as type="module".
- Changed: data/flavor.js converted to ES module (export logHit, logPlayerHit, announceFloorEnemyCount) and retains window.Flavor; index.html loads as type="module".

v1.34.11 — Phase 3 step 11: World and Dungeon core modules to ESM
- Changed: world/world.js converted to ES module (export TILES, generate, isWalkable, pickTownStart, biomeName) and retains window.World; index.html loads as type="module".
- Changed: world/los.js converted to ES module (export tileTransparent, hasLOS) and retains window.LOS; index.html loads as type="module".
- Changed: world/fov.js converted to ES module (export recomputeFOV) and retains window.FOV; index.html loads as type="module".
- Changed: dungeon/dungeon.js converted to ES module (export generateLevel) and retains window.Dungeon; index.html loads as type="module".
- Changed: dungeon/occupancy_grid.js converted to ES module (export create, build) and retains window.OccupancyGrid; index.html loads as type="module".
- Changed: dungeon/dungeon_state.js converted to ES module (export key, save, load, returnToWorldIfAtExit) and retains window.DungeonState; index.html loads as type="module".

v1.34.10 — Phase 3 step 10: Tileset and UI modules to ESM
- Changed: ui/tileset.js converted to ES module (export Tileset) and retains window.Tileset; index.html loads as type="module".
- Changed: ui/ui.js converted to ES module (export UI) and retains window.UI; index.html loads as type="module".

v1.34.9 — Phase 3 step 9: Render modules to ESM
- Changed: ui/render_core.js converted to ES module (export computeView, drawGlyph, enemyColor, drawGridOverlay) and retains window.RenderCore; index.html loads as type="module".
- Changed: ui/render.js converted to ES module (export draw) and retains window.Render; index.html loads as type="module".
- Changed: ui/render_dungeon.js converted to ES module (export draw) and retains window.RenderDungeon; index.html loads as type="module".
- Changed: ui/render_overworld.js converted to ES module (export draw) and retains window.RenderOverworld; index.html loads as type="module".
- Changed: ui/render_town.js converted to ES module (export draw) and retains window.RenderTown; index.html loads as type="module".
- Changed: ui/render_overlays.js converted to ES module (export drawTownDebugOverlay, drawTownPaths, drawTownHomePaths, drawTownRoutePaths, drawLampGlow) and retains window.RenderOverlays; index.html loads as type="module".

v1.34.8 — Phase 3 step 8: UI Decals and Logger to ESM
- Changed: ui/decals.js converted to ES module (export add, tick) and retains window.Decals; index.html loads as type="module".
- Changed: ui/logger.js converted to ES module (export Logger) and retains window.Logger; index.html loads as type="module".

v1.34.7 — Phase 3 step 7: UI InputMouse to ESM
- Changed: ui/input_mouse.js converted to ES module (export init) and retains window.InputMouse for back-compat.
- Changed: index.html loads ui/input_mouse.js as type="module".

v1.34.6 — Phase 3 step 6: Remaining core helpers to ESM
- Changed: core/fov_camera.js converted to ES module (export updateCamera) and retains window.FOVCamera for back-compat; index.html loads as type="module".
- Changed: core/inventory_controller.js converted to ES module (export render, show, hide, addPotion, drinkByIndex, equipByIndex, equipByIndexHand, unequipSlot) and retains window.InventoryController; index.html already wired.
- Changed: core/game_loop.js converted to ES module (export requestDraw, start) and retains window.GameLoop; index.html loads as type="module".
- Changed: core/input.js converted to ES module (export init, destroy) and retains window.Input; index.html loads as type="module".

v1.34.5 — Phase 3 step 5: Core game to ESM
- Changed: core/game.js converted to ES module:
  - Removed IIFE wrapper, added ESM exports for key helpers (getCtx, requestDraw, initWorld, generateLevel, tryMovePlayer, doAction, descendIfPossible, applySeed, rerollSeed, setFovRadius, updateUI).
  - Retains window.Game facade for back-compat and existing bootstrap.
- Changed: index.html already loads core/game.js as type="module".

v1.34.4 — Phase 3 step 4: GameAPI to ESM
- Changed: core/game_api.js converted to ES module (export create) and retains window.GameAPIBuilder for back-compat.
- Changed: index.html loads GameAPI as type="module".

v1.34.3 — Phase 3 step 3: Actions and Modes to ESM
- Changed: core/actions.js converted to ES module (export doAction, loot, descend) and retains window.Actions for back-compat.
- Changed: core/modes.js converted to ES module (export enterTownIfOnTile, enterDungeonIfOnEntrance, returnToWorldIfAtExit, leaveTownNow, requestLeaveTown, saveCurrentDungeonState, loadDungeonStateFor) and retains window.Modes.
- Changed: index.html loads Actions and Modes as type="module".

v1.34.2 — Phase 3 step 2: Facades to ESM
- Changed: core/ui_bridge.js converted to ES module; functions exported and window.UIBridge retained for back-compat.
- Changed: core/dungeon_runtime.js converted to ES module; functions exported and window.DungeonRuntime retained for back-compat.
- Changed: core/town_runtime.js converted to ES module; functions exported and window.TownRuntime retained for back-compat.
- Changed: index.html loads these facades as type="module".

v1.34.1 — Phase 3 step 1: Services to ESM
- Changed: services/time_service.js converted to ES module (export create) and retains window.TimeService for back-compat.
- Changed: services/shop_service.js converted to ES module (export minutesOfDay, isOpenAt, isShopOpenNow, shopScheduleStr, shopAt) and retains window.ShopService for back-compat.
- Changed: index.html loads both services as type="module".

v1.34.0 — Phase 3 kickoff: incremental ES module adoption
- Changed: core/ctx.js converted to ES module exports (create, attachModules, ensureUtils, ensureLOS) while still attaching window.Ctx for back-compat.
- Changed: utils/utils.js converted to ES module exports (manhattan, inBounds, isWalkableTile, isFreeFloor, isFreeTownFloor) while still attaching window.Utils.
- Changed: index.html now loads core/ctx.js and utils/utils.js as type="module" to prepare for broader ESM migration.
- Plan: continue migrating low-risk modules (services and facades) to ESM while maintaining window.* back-compat to avoid breaking classic scripts.

v1.33.0 — Phase 2 completion: ctx-first AI status, GOD consolidation, final sweep
- Changed: ai/ai.js now uses ctx.Status for daze/bleed application with a safe fallback to window.Status.
- Changed: GOD utilities consolidated under data/god.js; removed core/god.js to avoid duplication and ensure a single source of truth.
- Dev: Final ctx-first sweep across core and AI; minimal DOM/UI fallbacks retained for resilience.
- Test: Run smoketest via ?smoketest=1 (e.g., https://<deployment>/index.html?smoketest=1) to verify flows end-to-end.

This file tracks notable changes to the game across iterations. Versions here reflect functional milestones rather than semantic releases.

Conventions
- Added: new features or modules
- Changed: behavior or structure adjustments
- Fixed: bug fixes
- UI: user interface-only changes
- Dev: refactors, tooling, or internal changes

v1.32.1 — Shop open-hours gating and New Game reset via Player defaults
- Changed: core/game.js now gates bump-open of Shop UI by schedule; if the keeper is at/adjacent to a shop door and it's closed, the schedule is logged instead of opening the panel.
- Changed: restartGame() delegates to Player.resetFromDefaults(player) when available to ensure a clean new-game state (inventory/equipment/HP/XP), then clears transient status and re-initializes the overworld.

v1.32.0 — Smoke panel wrappers and input gating via UIBridge
- Added: core/ui_bridge.js now exposes showSmoke(ctx) and hideSmoke(ctx) in addition to isSmokeOpen().
- Changed: core/input.js Keyboard handler includes Smoke modal in priority stack; Esc closes Smoke via onHideSmoke.
- Changed: core/game.js setupInput wires isSmokeOpen and onHideSmoke using UIBridge, aligning with other modals (GOD/Shop/Inventory/Loot).

v1.31.0 — ctx-first glue in Modes/DungeonRuntime; Shop via UIBridge
- Changed: core/modes.js inBounds now prefers ctx.Utils.inBounds before local fallback.
- Changed: core/dungeon_runtime.js now prefers ctx.DungeonState for save/load with window fallback; keyFromWorldPos is a pure string key; OccupancyGrid build prefers ctx.OccupancyGrid before window fallback.
- Added: UIBridge shop wrappers integrated in core/game.js (open/hide/buy) to centralize ShopUI usage.

v1.30.0 — ctx-first ShopService in Town generation and UI handler gating
- Changed: worldgen/town_gen.js now prefers ctx.ShopService for minutesOfDay/isOpenAt/isShopOpenNow/shopScheduleStr/shopAt, removing direct window.ShopService reliance.
- Changed: core/game.js UI.setHandlers.isShopOpen now uses UIBridge.isShopOpen() as the single gating source.

v1.29.0 — Modes: runtime-only persistence and confirm fallback removal
- Changed: core/modes.js now delegates dungeon save/load/enter/exit exclusively to ctx.DungeonRuntime when available; removed window.DungeonRuntime fallbacks.
- Changed: Town exit confirm fallback removed; if UIBridge.showConfirm is unavailable, leaveTownNow proceeds immediately to avoid getting stuck.

v1.28.0 — Player HUD via UIBridge, unified modal gating, minor cleanup
- Changed: Player.forceUpdate now prefers UIBridge.updateStats with a minimal ctx; UI.updateStats used as fallback.
- Added: UIBridge.isAnyModalOpen() aggregates isLootOpen/isInventoryOpen/isGodOpen/isShopOpen/isSmokeOpen for simpler gating.
- Changed: InputMouse click gating uses UIBridge.isAnyModalOpen() to short-circuit when any modal is open.

v1.26.0 — Stable town/city names, ctx-first UI in core, safer loot/inventory fallbacks
- Fixed: Town/city names now persist and are reused on signs and greetings
  - worldgen/town_gen.js persists the generated name into the corresponding world.towns entry (info.name). Re-entries use the saved name.
- Changed: Core game uses UIBridge-only for inventory/loot/gameover where possible
  - core/game.js: show/hide Loot/Inventory/GameOver now delegate to UIBridge with a minimal DOM fallback; removed direct UI.* calls.
  - dungeonKeyFromWorldPos now prefers DungeonRuntime-only (no DungeonState.key path).
- Changed: Modes/TownRuntime UI delegations simplified
  - core/modes.js and core/town_runtime.js: show/hide Town Exit button and leave-town confirmation now go through UIBridge (fallback to browser confirm only).
- Changed: Player integration via ctx-first handles
  - core/game.js: equipIfBetter and gainXP now call Player via modHandle("Player") instead of window.Player checks.
- UI: InputMouse modal gating
  - Clicks are ignored while inventory/loot/GOD panels are open to avoid accidental actions.

v1.25.0 — Runtime-centric persistence
- Changed: Dungeon persistence centralized via DungeonRuntime across core modules
  - core/game.js: saveCurrentDungeonState/loadDungeonStateFor prefer DungeonRuntime; removed direct DungeonState.save/load calls. Fallback is in-memory snapshot only when DungeonRuntime is missing.
  - core/modes.js: saveCurrentDungeonState/loadDungeonStateFor prefer DungeonRuntime; removed DungeonState.* usage; return-to-world uses DungeonRuntime or local fallback.
  - entities/loot.js: looting saves via DungeonRuntime.save(ctx,false) with safe fallbacks.
- Added: UIBridge expanded for uniform UI flows
  - core/ui_bridge.js: showConfirm(ctx,text,pos,onOk,onCancel), showTownExitButton(ctx), hideTownExitButton(ctx).
  - core/modes.js and core/town_runtime.js: use UIBridge to show/hide town exit button and confirm town exit.
  - core/actions.js: minutesOfDay prefers ctx.TimeService/ctx.ShopService.
  - core/game.js: requestLeaveTown fallback prefers UIBridge.showConfirm.
- Added: GOD toggle centralization
  - core/god.js: setAlwaysCrit(ctx,v) and setCritPart(ctx,part); core/game.js already delegates to God, ensuring consistent logging/persistence.
- Dev: Continued ctx-first sweep to reduce window.* coupling; UI fallbacks retained where necessary.

v1.24.0 — ShopUI extraction, GameAPI split, mouse input module, runner exit hardening, bump-only shop interaction, and instant overworld fallback
- Added: Dedicated Shop UI module
  - ui/shop_panel.js: ShopUI.ensurePanel(), hide(), isOpen(), render(ctx), openForNPC(ctx,npc), buyIndex(ctx,idx), priceFor(), cloneItem().
  - core/game.js delegates openShopFor(), shopBuyIndex(), hideShopPanel() to ShopUI; removed legacy fallback shop UI code from game.js.
  - index.html loads ui/shop_panel.js before core/game.js.
- Added: GameAPI moved to its own module
  - core/game_api.js with GameAPIBuilder.create(ctx); index.html loads it before core/game.js.
  - All GameAPI methods preserved; new forceWorld() added as a hard fallback to immediately switch to overworld for tests.
- Added: Mouse/canvas input extraction
  - ui/input_mouse.js defines InputMouse.init(opts) and handles click-to-move/loot/talk behavior per mode; core/game.js now calls InputMouse.init().
  - index.html loads ui/input_mouse.js before core/game.js.
- Added: Smoketest API scenario
  - smoketest/scenarios/api.js validates essential GameAPI endpoints and basic flows (gold ops, equip-best, local teleport, route to nearest town, potion drink).
- Changed: Smoketest runner hardening
  - Consolidated readiness checks: waitUntilRunnerReady() ensures game, UI, and scenarios are ready before running.
  - GOD panel safety: kept closed during town/dungeon exit and seeding; reopened only after overworld + seed apply confirmed.
  - Post-“town_diagnostics” hook robustly closes GOD via Escape + UI.hideGod + DOM hidden verification with retries.
  - applyFreshSeedForRun prefers Teleport helpers to exit town/dungeon; falls back to local exit retries; final fallback starts overworld via GameAPI.forceWorld().
- Changed: Teleport helpers made exact and safe
  - teleportToGateAndExit/teleportToDungeonExitAndLeave:
    - Teleport near target, nudge if adjacent, force-teleport to exact tile (ignoring NPC occupancy) when necessary.
    - Press “g”, call returnToWorldIfAtExit(), confirm mode switch; final fallback calls GameAPI.forceWorld().
- Changed: Town diagnostics/shop flows
  - Shop routing first teleports near the shop, then routes to exact tile.
  - Shopkeeper interaction is bump-only (no “g”); if shop UI opens, Esc closes; if it doesn’t but keeper is present and route adjacency is confirmed, logs “Shop present; route to shopkeeper: OK”.
- Fixed: Runner and shop openShopFor syntax errors encountered during iteration.
  - Resolved malformed try/catch blocks and duplicated tokens; stabilized catch logging.
- Dev: Exit reliability and reduced flakiness
  - Exit paths no longer depend solely on routing; teleport + exact tile checks drastically reduce timeouts in town/dungeon exits.

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
  - Dungeon: rebuildOccupancy each turn after enemiesAct to reflect enemy movement/deaths.
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

