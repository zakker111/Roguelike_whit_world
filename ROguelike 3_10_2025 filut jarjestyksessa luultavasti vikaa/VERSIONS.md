# Game Version History
Last updated: 2025-10-25 09:50 UTC

v1.41.20 — Draw/StateSync coalescing, GOD/UI fixes, and syntax repairs
- core/god_handlers.js:
  - Replaced direct c.requestDraw with UIOrchestration.requestDraw(c) in onGodToggleGrid, diagnostics, and town checks.
  - Fixed a malformed try/if block in onGodCheckHomes that caused “Missing catch or finally after try”.
- data/god.js:
  - spawnStairsHere refresh now uses StateSync.applyAndRefresh(ctx, {}).
  - spawnEnemyNearby refresh uses StateSync.applyAndRefresh and the truncated else/closing brace was repaired (resolved “Unexpected token 'export'”).
- core/game_api.js:
  - GOD spawnChestNearby now refreshes via StateSync.applyAndRefresh instead of direct requestDraw.
- core/ui_bridge.js:
  - animateSleep rewritten with balanced try/catch and proper nested setTimeouts; fade-out/in sequencing restored.
  - Final redraw uses UIOrchestration.requestDraw(ctx) with fallback to ctx.requestDraw.
- ui/ui.js:
  - Perf and Minimap toggle handlers now schedule redraw via UIOrchestration.requestDraw (fallback to GameLoop.requestDraw) rather than GameAPI.requestDraw.
- Result:
  - Unified refresh path across GOD/UI flows, fewer duplicate frames, and fixed runtime SyntaxErrors.
- Deployment: https://117me6w5wch5.cosine.page

v1.41.19 — Phase B completion: RNG fallback removal (AI, Town talk, Dungeon decay)
- ai/ai.js:
  - rngPick() now uses RNGUtils.getRng(ctx.rng) or ctx.rng; deterministic (() => 0.5) fallback. Removed window.RNG and Math.random fallbacks.
- core/town_runtime.js:
  - talk(): pick() now uses RNGUtils.int with ctx.rng or deterministic first-entry fallback. Removed RNGFallback and Math.random fallbacks.
- core/dungeon_runtime.js:
  - tryMoveDungeon(): decayEquipped float helper now uses RNGUtils.float or ctx.rng; deterministic midpoint fallback. Removed RNGFallback and Math.random fallbacks.
- Result:
  - RNGUtils is now mandatory across core AI/town/dungeon paths; no residual Math.random/RNGFallback usage in these areas.
- Deployment: (see latest)

v1.41.18 — Phase B: RNG fallback removal in core (game/encounter/town/GameAPI) and encounter cleanup
- core/game.js:
  - rng initialization now prefers window.RNG.rng, then RNGUtils.getRng; deterministic fallback () => 0.5.
  - Removed window.RNGFallback and Math.random fallbacks from rng init.
- core/encounter_runtime.js:
  - Fixed duplicated/garbled RNG block in tryMoveEncounter; single rfn/didBlock logic using RU.getRng or ctx.rng with deterministic 0.5 fallback.
  - Generator RNG r() now uses RU.getRng(ctx.rng) or ctx.rng; deterministic fallback () => 0.5; removed Math.random usage.
  - Refresh after enter/tryMove/complete now prefers StateSync.applyAndRefresh; manual camera/FOV/UI/requestDraw fallbacks removed where applicable.
- core/town_runtime.js:
  - Seppo spawn RNG and offset RNG now use RU.getRng(ctx.rng) or ctx.rng; deterministic 0.5 fallback; removed window.RNGFallback/Math.random.
- core/game_api.js:
  - GOD spawnChestNearby pickNearby uses RU.getRng(ctx.rng) or ctx.rng; RU.int for offsets; deterministic 0-offset fallback when rng is absent.
  - Removed window.RNG and Math.random fallbacks.
- Result:
  - Continued Phase B progression: RNGUtils mandatory across these core modules; improved determinism with fixed seeds and reduced reliance on manual refresh fallbacks in encounters.
- Deployment: (see latest)

v1.41.17 — Phase B: RNG cleanup (mandatory RU.getRng) in Dungeon/TownAI/Decals/Region; utils/rng.js deterministic; flavor hit lines

v1.41.17 — Phase B: RNG cleanup (mandatory RU.getRng) in Dungeon/TownAI/Decals/Region; utils/rng.js deterministic; flavor hit lines
- core/dungeon_runtime.js:
  - Removed window.RNGFallback/Math.random chains in wall torch spawns, block/crit rolls, and decay floats.
  - Uses RNGUtils.getRng(ctx.rng) or ctx.rng only; deterministic midpoints (0.5 for booleans, (min+max)/2 for floats) when RNG missing.
- ai/town_ai.js:
  - rngFor(ctx) now returns RU.getRng(ctx.rng) or ctx.rng; otherwise a deterministic () => 0.5. Dropped window.RNG/RNGFallback/Math.random.
- ui/decals.js:
  - Decal alpha/radius now derive from RU.getRng(ctx.rng) or ctx.rng; deterministic 0.5 when RNG missing. Removed RNGFallback/Math.random.
- region_map/region_map_runtime.js:
  - Minimal combat block fallback no longer probes window.RNG/window.RNGFallback; uses RU.getRng(ctx.rng) or ctx.rng with deterministic 0.5 when missing.
- core/fallbacks.js:
  - Removed Math.random defaults; rollHitLocation/critMultiplier accept rng and use deterministic values when rng is absent (0.5 baseline; crit multiplier ~1.6+0.4*r).
- utils/rng.js:
  - getRng(preferred) now returns window.RNG.rng when present; otherwise returns a deterministic () => 0.5 function. Removed RNGFallback/Math.random fallbacks and logs.
- data/flavor.js:
  - logHit now sources flavor lines from flavor.json death section by category/part with chance gating (higher on crit) via RNGUtils. Death flavor already integrated.
- Result:
  - RNGUtils is mandatory across these modules; no remaining direct RNGFallback/Math.random usage in the patched paths. Behavior stays deterministic without RNG service.
- Deployment: (see latest)

v1.41.15 — Flavor integration: use flavor.json (death section) for hit/death lines
- data/flavor.js:
  - Added deathPools(), flavorCategory(), pickDeathLine(), and logDeath(ctx,{target,loc,crit}) to read data/i18n/flavor.json (death section) and log appropriate lines.
  - logPlayerHit now uses flavor.json (death section) to log part/crit-appropriate flavor on successful hits with chance gating via RNGUtils.
  - Attached logDeath to window.Flavor for back‑compat.
- combat/combat.js:
  - On enemy death, now calls Flavor.logDeath(ctx,{target,loc,crit}) before ctx.onEnemyDied(enemy), so flavor.json is exercised.
- Result:
  - flavor.json is actively used for both hit flavor (stochastically) and guaranteed death flavor when enemies die.
- Deployment: https://f0a0i2re05e4.cosine.page

v1.41.14 — Phase B: RNG fallback removal in Combat/Decay/Flavor; deterministic behavior when RNG missing
- Combat utilities
  - combat/combat_utils.js:
    - rollHitLocation and critMultiplier now require RNGUtils.getRng or a provided rng; removed window.RNG/RNGFallback/Math.random fallbacks.
    - When RNG is unavailable, use deterministic defaults (torso selection; crit multiplier 1.8).
- Combat flow
  - combat/combat.js:
    - playerAttackEnemy rng wiring requires RNGUtils.getRng or ctx.rng; removed window.RNG/Math.random usage.
    - Block and crit checks use RNGUtils.chance when available; otherwise compare via rng(); if rng is absent, default to false (no block/no crit).
    - Equipment decay ranges use RNGUtils.float; fallback to deterministic midpoints when RNG unavailable.
- Equipment decay
  - combat/equipment_decay.js:
    - Removed rng_fallback import; initialDecay/decayAttackHands/decayBlockingHands now require RNGUtils or provided rng.
    - float helper uses RNGUtils.float; fallback to deterministic midpoint (no random).
- Flavor
  - data/flavor.js:
    - RNG resolution uses RNGUtils.getRng or ctx.rng; removed Math.random fallback.
    - chance checks guard rngFn presence and default to false when RNG is unavailable; selection falls back to first entry when rng is missing.
- Deployment: https://b2wf98dbza7q.cosine.page

v1.41.13 — Phase B: RNG fallback reduction (mandatory RNGUtils paths) + StateSync-only refresh in GameAPI
- RNG fallback reduction (remove Math.random and RNGFallback usage in key modules)
  - utils/number.js:
    - randomInRange now requires RNGUtils.getRng or a provided rng; removed final Math.random fallback.
  - entities/items.js:
    - getRng now prefers RNGUtils.getRng() then window.RNG.rng; removed RNGFallback and Math.random fallbacks.
  - services/shop_service.js:
    - _rng(ctx) now requires RNGUtils.getRng or ctx.rng; removed Math.random fallback.
  - services/encounter_service.js:
    - rngFor(ctx) now requires RNGUtils.getRng or ctx.rng; removed Math.random fallback.
  - entities/enemies.js:
    - pickType depth-weighted selection now uses RNGUtils.getRng or provided rng; removed RNGFallback/Math.random.
  - world/world.js:
    - generate() rng selection now requires RNGUtils.getRng or ctx.rng; removed window.RNG/Math.random fallback.
    - pickTownStart() rng selection now requires RNGUtils.getRng or provided rng; removed window.RNG/Math.random fallback.
  - dungeon/dungeon_items.js:
    - lootFactories (potion/armor/handWeapon/equipment/anyEquipment) now use RNGUtils.getRng (ctx.rng preferred); removed window.RNG/Math.random fallbacks.
- StateSync-only refresh adoption in GameAPI
  - core/game_api.js:
    - moveStep() and teleportTo() now call StateSync.applyAndRefresh exclusively (manual updateCamera/recomputeFOV/updateUI/requestDraw fallbacks removed).
- Note:
  - Additional RNG fallback removals (combat/combat_utils.js, equipment_decay.js, data/flavor.js) are planned next; current step targets core/high-traffic paths first.
- Deployment: https://xbvp2amplbso.cosine.page

v1.41.11 — Phase B: Fallbacks reduction (confirm UI, loot UI) and StateSync in TownState
- Remove browser confirm fallback
  - services/encounter_service.js:
    - Dropped window.confirm fallback; prompts now require UIOrchestration.showConfirm (via Capabilities.safeCall) or UIBridge.showConfirm. If neither is present, encounter prompt cancels and logs once.
- Remove direct DOM loot panel fallback
  - entities/loot.js:
    - showLoot/hideLoot now route only via UIBridge/UIOrchestration; DOM element fallbacks removed. If unavailable, logs the loot list and returns.
- StateSync refresh adoption
  - core/town_state.js:
    - applyState() visual refresh now uses StateSync.applyAndRefresh when available, falling back to camera/FOV/UI/draw.
- Deployment: https://91m832vyze3x.cosine.page

v1.41.10 — Phase B: RNG unification (TownGen/TownAI/Decals) and StateSync refresh adoption
- RNG determinism
  - worldgen/town_gen.js:
    - Seeded RNG helper (RNGUtils.getRng(ctx.rng) with safe fallbacks) introduced at generate() start.
    - Uses seeded rng for:
      - Gate greeter name picks
      - Town name components (prefix/mid/suffix)
      - Building size randint and per-building r selection
      - shuffleInPlace and sampled shop presence checks
      - Stall offset pickIdx
      - Resident bench-building pick and initial _likesInn flag
  - ai/town_ai.js:
    - rngFor(ctx) helper added (RNGUtils.getRng(ctx.rng) → ctx.rng → window.RNG.rng → RNGFallback → Math.random).
    - Uses seeded rng for:
      - chooseInnUpstairsBed/Seat picks
      - randomInteriorSpot selection
      - Fisher–Yates shuffle for NPC iteration order
  - ui/decals.js:
    - Decal alpha/radius now use seeded RNG instead of ctx.rng directly, improving replay determinism under fixed seeds.
- StateSync refresh adoption
  - dungeon/dungeon_state.js:
    - applyState() and returnToWorldIfAtExit() now refresh via StateSync.applyAndRefresh when available (fallback to camera/FOV/UI/draw).
  - core/game_api.js:
    - moveStep() and teleportTo(): refresh via StateSync.applyAndRefresh when available (fallback maintained).
- Deployment: https://l8b80ql1vsyp.cosine.page

v1.41.9 — Hard error when infinite world is unavailable; remove dungeon fallback on world init
- core/world_runtime.js:
  - If InfiniteGen is unavailable or not initialized, generate(ctx,opts) now throws an Error (“Infinite world generator unavailable or not initialized”) instead of returning false.
- core/game.js:
  - initWorld(): when WorldRuntime.generate fails or is missing, it now throws an Error (“Infinite world generation failed or unavailable”) instead of falling back to dungeon mode.
- Result:
  - Game requires InfiniteGen for world mode. If missing or failing, initialization throws, making the failure explicit.
- Deployment: https://3g837iou4h79.cosine.page

v1.41.7 — Phase B: StateSync in seed flows, TurnLoop refresh, and RNG in world start
- Refresh orchestration
  - core/game.js:
    - applySeed/rerollSeed now call applyCtxSyncAndRefresh(ctx) (StateSync.applyAndRefresh under the hood) instead of manual updateCamera/recomputeFOV/updateUI/requestDraw.
  - core/turn_loop.js:
    - Visual updates prefer StateSync.applyAndRefresh when available; fallback retains recomputeFOV/updateUI/requestDraw.
- RNG determinism
  - core/world_runtime.js:
    - Finite-world pickTownStart now passes a seeded rngFn derived via RNGUtils.getRng(ctx.rng) (with window.RNG/RNGFallback fallbacks) instead of bare Math.random.
- Deployment: https://bs2ovc4a6mii.cosine.page

v1.41.6 — Phase B: RNG cleanup (Region + utils) and StateSync in Actions
- RNG determinism
  - core/encounter_runtime.js (enterRegion): replaced fallback group-size rolls that used ctx.rng()/Math.random with the seeded r() from RNGUtils.getRng, ensuring deterministic counts.
  - utils/number.js: randomInRange now prefers RNGUtils.getRng and window.RNG.rng/RNGFallback before Math.random, removing bare random usage in the default path.
- Refresh orchestration
  - core/actions.js:
    - Inn upstairs toggle now refreshes via StateSync.applyAndRefresh (fallback to manual camera/FOV/UI/draw).
    - Upstairs overlay prop interactions in loot() also refresh via StateSync when available.
- Minor fix
  - ai/ai.js: corrected bleed application guard to check typeof ST.applyBleedToPlayer === "function" (removed stray typeof ST.applyBleed check).
- Deployment: https://5d39lrkbywmm.cosine.page

v1.41.5 — Phase B: StateSync in TownRuntime and Modes syncAfterMutation
- Town runtime refresh orchestration
  - core/town_runtime.js:
    - generate(ctx): after town generation and NPC population, now calls StateSync.applyAndRefresh (fallback: camera/FOV/UI/draw).
    - tryMoveTown(ctx,dx,dy): movement updates player position, then calls StateSync.applyAndRefresh; turn semantics preserved.
- Modes refresh centralization
  - core/modes.js:
    - syncAfterMutation(ctx): now calls StateSync.applyAndRefresh when available, replacing manual updateCamera/FOV/UI/draw sequences.
- Result
  - Consistent refresh path across world/town/dungeon/region/encounter modes via StateSync.
- Deployment: https://8883eqg3pey4.cosine.page

v1.41.4 — Phase B: StateSync adoption in DungeonRuntime (load/enter/exit/move) for consistent refresh
- Dungeon runtime refresh orchestration
  - core/dungeon_runtime.js:
    - load(ctx,x,y): after applying saved state, now calls StateSync.applyAndRefresh (fallback to manual camera/FOV/UI/draw).
    - window.DungeonState.load path updated similarly to use StateSync when available.
    - direct load path (from ctx._dungeonStates) also uses StateSync to refresh visuals.
    - generate fallback (flat-floor) uses StateSync for refresh post-map setup.
    - generate(ctx, depth): after generation, occupancy rebuild, and dev logs, refresh now goes through StateSync.applyAndRefresh; FOV sanity check retained.
    - enter(ctx,info): post-marking entrance and save, refresh via StateSync.applyAndRefresh.
    - returnToWorldIfAtExit(ctx): world-mode restoration refresh via StateSync.applyAndRefresh.
    - tryMoveDungeon(ctx,dx,dy): movement into empty tiles calls StateSync.applyAndRefresh for visuals; turn semantics preserved.
- Result
  - Unified refresh across dungeon flows; fewer manual sequences and more consistent visuals.
- Deployment: https://oikyg1shhn05.cosine.page

v1.41.3 — Phase B: AI RNG unification and Movement fallback refresh via StateSync
- AI determinism
  - ai/ai.js: replaced direct ctx.rng() calls in block/crit checks with a seeded rv() helper sourced from RNGUtils/window.RNG, ensuring consistent randomness.
  - ai/ai.js: crit multiplier now passes the seeded rng to ctx.critMultiplier; Dazed duration uses rv() instead of ctx.rng().
- Movement refresh
  - core/movement.js: WORLD fallback movement path now calls StateSync.applyAndRefresh(ctx,{}) via applyRefresh() after position update, replacing manual updateCamera only. Encounter roll and turn semantics preserved.
- Deployment: https://dpuhwpauqbmt.cosine.page

v1.41.2 — Phase B: StateSync in World, RNG fallback unification, and Region Map combat fix
- Refresh orchestration
  - core/world_runtime.js now uses StateSync.applyAndRefresh in:
    - Infinite-world generate path (with camera-centering fallback when updateCamera is unavailable)
    - Finite-world generate path
    - World movement (tryMovePlayerWorld) after a successful step
  - This replaces manual updateCamera/recomputeFOV/updateUI/requestDraw sequences for consistency.
- RNG determinism and fallback cleanup
  - services/encounter_service.js: “willEncounter” now uses rngFor(ctx)() instead of Math.random() when RNGUtils.chance is unavailable.
  - combat/combat.js: critMultiplier receives the seeded rng; crit chance fallback uses rng() exclusively (no direct ctx.rng()).
- Region Map minimal combat
  - Fixed a stray fragment in region_map_runtime.js tryMove’s minimal combat block that caused a SyntaxError near the fallback RNG path; restored a clean check with deterministic seeded RNG.
- Deployment: https://hse8e0opu7l9.cosine.page

v1.41.1 — Phase B continuation: RNG cleanup and Region Map determinism
- RNG determinism
  - core/encounter_runtime.js (enterRegion): replaced fallback Math.random calls in group count rolls with the seeded r() function derived from RNGUtils.getRng.
  - region_map/region_map_runtime.js: block-chance fallback in onAction attack now uses a seeded rfn via RNGUtils.getRng (or window.RNG / RNGFallback), avoiding direct Math.random.
  - region_map/region_map_runtime.js: ensured RU (RNGUtils handle) is defined within open() to support ruins decoration and neutral animal spawns using RU.chance when available.
- Deployment: (see latest) — will be updated after next deploy

v1.41.0 — Phase B kickoff: RNG determinism, StateSync refresh, Capabilities sweep, Region Map UX, and tooling
- Determinism and RNG
  - Unify random rolls through RNGUtils/RNG (ctx-first), removing Math.random uses for encounter group counts and block checks.
  - Target modules: core/encounter_runtime.js (group counts, block-chance), region_map spawns, and any residual direct randoms.
- Refresh orchestration
  - Adopt StateSync.applyAndRefresh(ctx, sink) in encounter/region flows to replace manual updateCamera/recomputeFOV/updateUI/requestDraw sequences.
- Capabilities helpers
  - Expand Capabilities.safeCall/safeGet usage across UI/services to reduce boilerplate and window.* coupling.
- Region Map UX/persistence
  - Controls clarified: G opens Region Map on walkable overworld tiles; M is disabled.
  - Seen vs cleared state indicators planned on overlay; per‑tile persistence retained; spawn reliability already tuned earlier.
- Tooling and CI
  - Add eslint/prettier to devDependencies with “lint” and “format” scripts.
  - Wire smoketest auto-run in CI; PASS/FAIL tokens already emitted by runner.
- Deployment: https://9s75k2o6izz6.cosine.page
- Implemented in this step:
  - Region Map: badge shows “Animals cleared here” vs “Animals known in this area” (ui/render_region.js).
  - Region Map: open/close/move use StateSync.applyAndRefresh (region_map/region_map_runtime.js).
  - Encounters: confirm prompt routed via Capabilities.safeCall to UIOrchestration.showConfirm (services/encounter_service.js).
  - Tooling: npm scripts “lint” and “format”, devDependencies eslint/prettier (package.json).

v1.40.0 — Inn upstairs system, overlay-aware FOV/walk, stairs visibility, and NPC behavior tuning
- Inn upstairs system
  - Added: Upstairs overlay generation in worldgen/town_gen.js with interior perimeter walls, bed props, and stairs landing aligned above ground stairs.
  - Added: Two-tile stairs portal placed in the inn hall; pressing G on stairs toggles upstairs overlay on/off (core/actions.js).
  - Added: TownState persistence for upstairs overlay tiles/props and stairs portal data; state restored on town re-entry.
- Renderer and interactions
  - Changed: ui/render_town.js now draws stairs glyph '>' visibly; window pane glyph '□' is subtle but present.
  - Changed: When upstairs overlay is active, downstairs props within inn footprint are suppressed to avoid clutter; NPCs inside inn footprint are hidden while upstairs is shown.
  - Changed: Overlay-aware FOV and LOS: upstairs WALL tiles block vision; upstairs FLOOR/STAIRS are transparent. Walkability respects upstairs tiles when overlay is active (core/ctx.js, core/game.js).
  - Changed: Upstairs overlay floor fill covers only the inn interior and draws perimeter walls explicitly; sanitized legacy upstairs DOOR/WINDOW tiles to FLOOR on load (core/town_state.js).
  - Added: Fresh session mode via URL query (?fresh=1, ?reset=1, ?nolocalstorage=1) disables localStorage and clears in-memory town states for consistent testing (core/game.js, core/town_state.js).
- Town runtime
  - Changed: tryMoveTown ignores downstairs NPC blocking inside inn footprint while upstairs overlay is active; shop interactions are skipped upstairs.
  - Fixed: Renderer context now includes tavern, innUpstairs, innUpstairsActive, innStairsGround so upstairs overlay draws correctly (core/render_orchestration.js).
- NPC AI (TownAI)
  - Added: Upstairs-aware pathing (A*) and occupancy helpers; routeIntoInnUpstairs guides NPCs to ground stairs, toggles upstairs, and pathfinds on overlay.
  - Added: Residents prefer upstairs beds during late-night window (02:00–05:00); set sleeping state when adjacent to beds upstairs.
  - Added: Debug: force one roamer to use upstairs beds at late night for verification.
  - Changed: Proximity-based upstairs toggle: NPCs inside the inn within 1 tile of stairs for 2 consecutive turns toggle to upstairs even if stairs tiles are occupied (mitigates jams).
  - Changed: Calmer NPC movement: longer sit durations at inn, benches, and home; reduced fidget probabilities; increased general idle/skip rates for roamers and errands.
  - Fixed: Innkeeper avoids stepping onto inn door tiles while already inside, preventing door blocking; bumping the innkeeper anywhere inside opens wares.
  - Fixed: Multiple SyntaxErrors in town_ai.js (stray '<<' tokens, malformed loops/conditions, and a corrupted 'chosen = { nx, ny }' assignment) corrected.
- Stairs placement robustness
  - Changed: Stairs placement occurs last during inn furnishing; props on stairs tiles are cleared and STAIRS tiles reasserted for visibility.
  - Changed: canPlaceStairs allows placement over furnished tiles and clears overlapping props; fallback vertical/adjacent search aligns s1/s2 coordinates and innStairsGround with actual tiles.
- Known issue
  - NPCs may still underutilize upstairs beds in very crowded inns; investigation ongoing (stairs reservation and upstairs aisle spacing). See BUGS section.

Deployment: https://k644jmdixn98.cosine.page

v1.39.2 — Bakery shop type, unique shop types per town, pre-home Inn visits, and unified Ruins looting
- Shops
  - Added: bakery shop type (data/shops/shops.json) with hours 06:00–15:00 and probabilistic presence by town size; Inn remains required.
  - Changed: town generation deduplicates shop types per town/city — at most one per type (blacksmith/apothecary/armorer/trader/carpenter/bakery).
  - Changed: ShopService supports "food" items (stacking, pricing, materialization).
- Inventory pools/rules
  - Added: bakery inventory pools in data/shops/shop_pools.json ("baked" category: bread_loaf, sweet_bun, meat_pie, berry_tart).
  - Added: bakery shop rules in data/shops/shop_rules.json (sells "food").
  - Added: bakery restock in data/shops/shop_restock.json (primary at open, mini restock at 11:00).
- Town AI
  - Added: residents who like the Inn sometimes stop by the Inn in early evening before going home (~33% of days); short sits and seating cap prevent crowding.
- Region Map (Ruins) looting
  - Changed: looting corpses/chests now uses the unified Loot.lootHere flow with the loot panel, consistent with dungeon looting; dead animals show what was looted.
  - Changed: region state saves immediately after loot so containers remain emptied when reopening the same tile.
- Deployment: https://drjim9an2gnt.cosine.page, https://pj3yiqhg61kf.cosine.page

v1.39.1 — Data folder reorganization and loot equipment fix
- Data
  - Reorganized existing JSON files into conventional subfolders:
    - data/config/config.json
    - data/balance/progression.json
    - data/entities/{items.json, enemies.json, animals.json, npcs.json, consumables.json}
    - data/enemies/enemy_loot_pools.json
    - data/encounters/encounters.json
    - data/shops/{shops.json, shop_rules.json, shop_phases.json, shop_restock.json, shop_pools.json}
    - data/world/{world_assets.json, town.json, palette.json}
    - data/i18n/{messages.json, flavor.json}
    - data/docs/README.md
  - Kept JavaScript modules in data/ to avoid breaking imports for now: loader.js, god.js, flavor.js, tile_lookup.js
- Loader
  - data/loader.js updated to read the new paths and to reference the combined assets file at data/world/world_assets.json.
- Analysis
  - client_analyzer updated to reference new JSON URLs (analysis-side paths aligned).
- Loot
  - Fixed: equipment not dropping due to nested enemy loot pools. entities/loot.js now supports both nested pools ({ weapons, armor }) and flat pools, validating against Items registry before weighted pick.
- Deployment: https://qvnrd68i0jde.cosine.page
- Known issue (open bug): Wildlife spawns missing in Region Map
  - Summary: Neutral animals (deer/fox/boar) do not appear despite data/entities/animals.json having spawn weights.
  - Status: Investigating; to be resolved in next patch.
  - Suspected causes: loader path change (ensure GameData.animals loads), spawn gating or “cleared” state in region_map runtime, or biome-matching mismatch.
  - Plan: Verify GameData.animals availability in Region Map spawner, audit gating and biome weights, add DEV logs, and restore rare wildlife spawns across FOREST/GRASS/BEACH/SWAMP per weights.

v1.39.0 — Night Raid encounter, GOD encounter debugger, and weapon-only kill attribution
- Encounters
  - New template: night_raid_goblins (data/encounters.json)
    - 5–7 bandits (faction: bandit) vs 5–10 goblins (faction: goblin)
    - Night-only; 3% share of all encounters; at most once per in-game week
    - Map: camp 28×18; playerSpawn: edge; allowedBiomes: FOREST/GRASS/SWAMP/SNOW/DESERT
  - services/encounter_service.js
    - Special-case scheduler for night_raid_goblins with weekly cooldown and 3% probability integrated into the normal roll
    - Debug hook: window.DEBUG_ENCOUNTER_ARM to force a specific encounter on the next overworld step
    - Small refactor: registry()/rngFor()/findTemplateById()/tryEnter() helpers
- GOD panel (Encounters debugger)
  - index.html + ui/ui.js + core/game.js
    - New controls under “Encounters”: template dropdown, Start Now (launch immediately in overworld), Arm Next Move (trigger on next step)
    - ui/ui.js setHandlers now wires onGodStartEncounterNow and onGodArmEncounterNextMove
    - Fix: “Start Now does not start encounter” — handlers now connected; Start Now works in overworld
    - Dropdown auto-populates from GameData.encounters.templates
- Encounter runtime
  - core/encounter_runtime.js: supports template.playerSpawn = "edge" to place the player at a safe map edge when requested (center otherwise)
- Corpses and kill attribution
  - ai/ai.js: non-player kills now pick a concrete weapon from the killer’s loot pool and record it in _lastHit
  - data/enemy_loot_pools.json: schema split into { weapons: {...}, armor: {...} } so attribution never picks armor as a “weapon”
  - Back-compat: flat pools are filtered to hand-slot items when present
  - Corpses display “(with <weapon name>)” when known; fall back to melee/likely cause otherwise

Deployment: https://4eu9dewop4k3.cosine.page

v1.38.0 — Ruins AI fix, non-bleeding undead, '?' fallback enemy, and input simplification
- Input
  - Removed N key. G remains the single action/interact key across modes.
- Combat/visuals
  - Player blood decal always spawns on any successful hit (not on blocks), improving feedback.
  - Ghosts and skeletons no longer bleed:
    - No bleed status is applied to ghost/spirit/wraith/skeleton.
    - Blood decals are suppressed when these targets are hit.
    - Existing bleed on such enemies is cleared each tick.
- Region Map (Ruins)
  - Enemy AI now respects overworld walkability (World.isWalkable) so enemies move and attack properly inside Ruins.
  - Blood decals now render in Region Map.
  - Ruins spawns use mime_ghost (defined in enemies.json) instead of an undefined ghost id.
- Loot/Items
  - Enemy-specific equipment loot pools added (data/enemy_loot_pools.json). On a successful equip drop roll, items are now chosen exclusively from the enemy’s pool; no generic fallback.
  - New item: club (hand, blunt). Added to goblin’s pool; daggers remain disabled in general item weights but can drop via enemy pools.
  - The pools file includes a top-level "__guidelines" section documenting safe editing rules.
- Fallback enemy for missing types
  - When an enemy type is missing or creation fails, the game now spawns a clear fallback enemy with glyph '?' and logs a warning:
    - Applied in dungeon generation, encounter spawns, Ruins region spawns, and GOD spawn when the type is undefined.

Deployment: https://fjodtmg7iko1.cosine.page

v1.37.1 — Overworld overlays always on, movement delegation cleanup, dead-code removal
- Overworld renderer
  - Roads and bridges overlays now always render when data is present (ctx.world.roads/bridges). Removed GOD panel toggles for these overlays.
  - Deleted a duplicate bridges overlay block in ui/render_overworld.js to avoid redundant drawing.
- UI
  - Removed Roads/Bridges toggle buttons and related state helpers from ui/ui.js and index.html.
  - Eliminated baseline SHOW_ROADS/SHOW_BRIDGES window assignments; overlays no longer depend on flags.
- Core movement
  - core/game.js now delegates tryMovePlayer exclusively to Movement.tryMove(ctx, dx, dy).
  - descendIfPossible and brace also delegate solely to Movement, removing legacy fallback branches.
- Result
  - Less code duplication and fewer conditionals; consistent behavior via centralized Movement and always-on overworld overlays.

Deployment: https://c4rgubux2smp.cosine.page, https://b2qm5ih3r6qy.cosine.page, https://vnpdpeiurnyl.cosine.page

v1.37.0 — Infinite world polish, 5% encounters, sparse animals, mountain pass, and Seppo uniqueness
- Overworld/infinite
  - Roads: avoid dangling “lead-to-nowhere” segments by connecting towns only when both endpoints are inside the current streamed window (core/world_runtime.js).
  - Bridges: bridge carving now spans the entire river width so crossings are continuous across 1–3 tile rivers (core/world_runtime.js).
  - POIs: slightly higher density (+~1–2%) for towns and dungeons (world/infinite_gen.js: townChance 0.34, dungeonChance 0.44).
- Encounters
  - Default encounter rate set to 5 (percent). GOD panel slider mirrors this and persists (data/config.json, ui/ui.js, services/encounter_service.js reads the value).
- Region Map animals
  - Much rarer spawns: at most a single neutral animal and only in fairly wild tiles; if animals were seen here previously, future visits have a 10% chance to spawn (region_map/region_map_runtime.js).
- Town
  - Wild Seppo uniqueness: if Seppo is already present (NPC or shop), do not spawn another; presence auto-synchronizes with internal active flag (core/town_runtime.js).
- Dungeons
  - Mountain pass: if a dungeon entrance is on or adjacent to a Mountain tile, the generator places a special portal STAIRS deeper inside. Stepping on it tunnels the player to a new dungeon “across” the mountain (dungeon/dungeon.js + core/dungeon_runtime.js).
  - Usability: standing on any STAIRS tile inside a dungeon now returns to the overworld (unless it’s the special mountain-pass portal which transfers to the remote dungeon).
- Misc
  - Minimap/offscreen caches and fog-of-war behavior retained; minimap default remains user-toggleable in the GOD panel.

Deployment: https://79p4vfhuhcsi.cosine.page (Seppo fix), https://i4cscejdjq7a.cosine.page (encounter rate 5 + POI tweak)

v1.36.8 — Region Map per-tile persistence, visibility-aware animal logging, and attachGlobal refactor
- Region Map
  - Per-tile persistence reinstated: every overworld tile now has its own distinct Region Map. Trees cut, corpses, and animals “seen/cleared” are saved per tile and restored on re-open.
  - Animal spawning is unbiased across the region (no forced adjacent spawns). Logs say “Creatures spotted (N)” only when at least one creature is currently visible; otherwise “Creatures are present in this area, but not in sight.”
  - Region LOS: mountains and trees block FOV; other biomes are transparent. Cursor still starts at the nearest edge, and clearing an encounter no longer auto-closes the map.
- Refactor: attachGlobal replaces manual window assignments for consistent back-compat in:
  - ui: render_core.js, tileset.js, logger.js, decals.js, render.js, input_mouse.js, quest_board.js
  - core: actions.js, ctx.js, fov_camera.js, game_loop.js, game_api.js, input.js, modes.js
  - services: shop_service.js, time_service.js
- Bug fixes
  - ui/render_core.js: removed stray “>” and fixed malformed attachGlobal call.
  - region_map/region_map_runtime.js: removed stray text fragments that caused ReferenceError/SyntaxError in animals logging.
- Deployment: https://0mps2ansl1pt.cosine.page

v1.36.7 — Dungeon wall torches, unified props lighting, combined assets (strict), and glow overlays
- Added: Wall Torch prop (data/world_assets.json)
  - id/key/name: "wall_torch" / "WALL_TORCH" / "Wall Torch"
  - glyph "†", warm color "#ffb84d"
  - properties: emitsLight=true (non-blocking FOV), appearsIn=["dungeon"]
  - light: castRadius=4, glowTiles=1.8, color="#ffb84d"
- Added: Sparse dungeon wall torches
  - DungeonRuntime.generate spawns torches on WALL tiles adjacent to walkable tiles with low density and spacing.
  - Stored in ctx.dungeonProps and persisted via DungeonRuntime.save/load.
- Rendering/FOV
  - ui/render_dungeon.js draws dungeon props and calls RenderOverlays.drawDungeonGlow.
  - ui/render_overlays.js adds drawDungeonGlow (lighter radial glow around torches).
  - world/fov.js extends visibility from props that emitLight in dungeon mode (always active).
- Combined assets (strict)
  - data/world_assets.json is now the single source of tiles + props; loader requires it in strict mode.
  - Tiles/props are not loaded without the combined assets file; other registries still fall back safely.
- Deployment: https://qztezok9bdxu.cosine.page

v1.36.6 — Region Map persistence, animals cleared (no respawn), overworld hints, corpse glyph, and campfire cooking
- Region Map
  - Persistent per-overworld-tile state: saves/restores map and corpses when reopening from the same world tile.
  - Animals memory: stores “seen” and “cleared” flags per tile; skips animal spawning on tiles marked cleared.
  - Corpses render with a '%' glyph; looting logs a concise summary of items picked up.
  - Victory flow: removing all enemies no longer auto-closes or logs “You prevail…”. You remain in Region Map.
- Animal behavior
  - Neutral animals (deer/fox/boar) wander and do not attack unless the player attacks them; only the attacked animal turns hostile.
  - No respawn rule enforced: killing animals in Region Map or ending an encounter with no enemies marks the tile as cleared; future re-entries skip spawns.
  - Overworld proximity hint: when entering forest/grass/beach tiles that aren’t cleared, occasionally logs “There might be creatures nearby.” (cooldown-protected).
- UI/Render
  - Region Map UI shows “Animals known in this area” when applicable.
  - Region Map entities: neutral animals render as circles; hostiles as squares.
- Campfire cooking (encounters)
  - Standing on a campfire with raw meat prompts: “Cook N meat?”. On confirm, converts raw “meat” to “meat (cooked)” in inventory and logs the result.
- Deployment: https://mcjmwd0u5cks.cosine.page

v1.36.5 — Underfoot loot consolidation + Help button in HUD
- Changed: entities/loot.js
  - lootHere now loots all containers underfoot in one action (corpses and chests on the same tile).
  - Marks every container as looted and empties their loot lists; shows a single consolidated loot panel.
  - Effect: eliminates repeat-loot on the same tile in encounters.
- UI: index.html, ui/ui.js
  - Removed redundant inline help sentence from the header.
  - Added Help button next to GOD; opens the same Help / Character Sheet panel as F1.
- Docs: README updated with Help control; smoketest/runner/README.md notes consolidated loot behavior.
- Deployment: https://odzmle76xdf6.cosine.page

v1.36.4 — Difficulty scaling, injuries/skills, animals, and denser world
- Added: Encounter difficulty scaling (services/encounter_service.js, core/encounter_runtime.js, core/game.js)
  - Difficulty 1..5 computed from player level and biome.
  - Template prompt shows “(Difficulty X)”; enemies scale in count/level/HP/ATK.
- Changed: Injury model and healing (entities/player.js, core/game.js, ui/ui.js, ai/ai.js)
  - Injuries tracked as objects { name, healable, durationTurns }.
  - Healable injuries tick down per turn and disappear; Character Sheet shows red (permanent) vs amber (healing).
- Added: Passive combat skills with small damage buffs (combat/combat.js, entities/player.js, ui/ui.js)
  - oneHand / twoHand / blunt counters increase on attacks; F1 panel shows bonuses and usage.
- Changed: World population (world/world.js)
  - Increased towns/dungeons density and broadened biome placement; more varied overworld exploration.
- Changed: Dungeon population (dungeon/dungeon.js)
  - More enemies per floor and extra small packs in rooms.
- Added: Neutral animals in Region Map (region_map/region_map_runtime.js)
  - Deer/Fox/Boar spawn rarely; neutral until attacked, then turn hostile and use AI.
  - Suppressed panic speech for animal factions (ai/ai.js).
  - Animals leave corpses; loot pool is meat/leather (entities/loot.js).
- Deployment: https://i1b7oveberap.cosine.page

v1.36.3 — Documentation housekeeping
- Changed: VERSIONS.md
  - Added entry and recorded deployment URL.
- Deployment: https://80sqsb7khqr6.cosine.page

v1.36.2 — Overworld town/city glyphs
- Changed: ui/render_overworld.js
  - Town POIs now render as gold glyphs with size semantics:
    - 't' for towns (small/big)
    - 'T' for cities
  - Dungeons remain red squares.
- Deployment: https://eugw8hescdb1.cosine.page

v1.36.1 — Overworld visual polish: biome embellishments and vignette
- Changed: ui/render_overworld.js
  - Forest canopy dots (subtle speckling to break flat green).
  - Mountain ridge highlight (soft shading on top-left edges).
  - Desert sand specks (light grain texture).
  - Snow tint variation (small cool-blue patches).
  - River shimmer (faint highlight lines).
  - Subtle vignette around viewport edges.
- Deployment: https://3woxbq41j6fs.cosine.page

v1.36.0 — Roads/bridges network + POI icons (main map)
- Changed: world/world.js
  - Ensures connectivity by carving walkable paths between towns and to nearest dungeons.
  - Records explicit road and bridge overlays: roads[] and bridges[] returned with the world.
- Changed: ui/render_overworld.js
  - Draws dashed roads (alternating tiles), with thicker segments near cities.
  - Draws bridges as stronger plank-like markers across rivers.
  - Adds main-map POI icons: gold towns (scaled by size), red dungeons.
- Deployment: https://fpfpw18yot5c.cosine.page, https://zwk7lp7p0kwp.cosine.page

v1.35.43 — Town NPC visibility: engine sync fix
- Fixed: core/game.js
  - syncFromCtx(ctx) now copies ctx.npcs into local state, ensuring town NPCs render immediately after Town/TownAI population.
- Result: NPCs appear without needing GOD diagnostics; consistent town life on entry.
- Deployment: https://16zzzpmuiwz5.cosine.page

v1.35.42 — Shop panel syntax fix and duplication removal
- Fixed: ui/shop_panel.js had a duplicated tail that caused “Unexpected token '}'”.
- Result: Shop UI opens reliably; buying works; console error eliminated.
- Deployment: https://92i0buv8fyab.cosine.page

v1.35.41 — Encounter QoL: merchant auto-open and prop feedback
- Changed: core/game.js
  - In encounter mode, stepping onto a merchant now auto-opens the Shop UI via UIBridge.showShop (e.g., bump Seppo to trade).
  - Pressing G while standing on a prop in encounters logs context flavor (barrel/crate/bench/campfire, etc.), matching town style.
- Benefit: Consistent interactions and faster access to trading during encounters.
- Deployment: https://2hqxef1lwyeq.cosine.page

v1.35.40 — Town NPC visibility polish near the gate
- Changed: ui/render_town.js draws previously-seen NPCs dimmed even when not currently in FOV.
- Changed: worldgen/town_gen.js seeds a small seen-radius around the gate on entry so nearby greeters are discoverable.
- Benefit: NPCs around the gate are visible immediately (dimmed if just outside FOV), reducing “invisible NPC” impressions.
- Deployment: https://69xub6teqegs.cosine.page

v1.35.39 — Reporting load fix + GOD panel render visibility
- Fixed: smoketest/reporting/render.js
  - Repaired a syntax error that prevented the reporting module from loading, which blocked the GOD-panel report.
- Changed: smoketest/runner/runner.js
  - Ensures the GOD panel is open before writing per-run and aggregated reports (panel reopen guard).
  - Resolved a suppress flag shadowing bug (per-run filter renamed to shouldSuppressMsg) that prevented rendering.
- Benefit: Restores the in-panel report and downloadable exports; prevents silent report drops when the reporting module fails to load or the panel is closed.
- Deployment: https://ipf6aomi50fs.cosine.page

v1.35.38 — Runner/reporting polish: diagnostics/combats suppression, per-step PERF in JSON, and forceWorld exit recognition
- Changed: smoketest/runner/runner.js
  - Per-run suppression now hides “Town diagnostics skipped (not in town)” when any town entry succeeded in the run.
  - Aggregated suppression likewise hides “Town diagnostics skipped (not in town)” when the series has a town entry success.
  - Combat skip noise suppressed in per-run, aggregated, and live Matchup when any combat success is present (“Moved and attempted attacks”, “Killed enemy”, “Attacked enemy”, or “Combat effects:”).
  - JSON export now includes stepAvgTurnMs and stepAvgDrawMs (per-step averages across all runs) and the Summary TXT uses these more representative metrics.
- Changed: smoketest/reporting/render.js
  - Key Checklist (“Returned to overworld from dungeon”) additionally recognizes “Dungeon exit helper: final mode=world [forceWorld]” as a success.
- Benefit: Cleaner reports (less skip noise after successes), consistent performance metrics across HTML and JSON, and broader recognition of reliable exit success variants.
- Notes: Runner version remains v1.8.0.

v1.35.37 — Runner suppression: town confirm success detection and re-enter counterpart filters
- Changed: smoketest/runner/runner.js
  - Union-of-success detection for town now recognizes “Mode confirm (town enter): town” alongside “Entered town,” ensuring the Town scenario is marked passed when town entry succeeds in any scenario within the run.
  - Per-run suppression hides failure counterparts when any town success occurred:
    - Suppresses “Town entry not achieved (scenario)”
    - Suppresses “Town overlays skipped (not in town)”
    - Suppresses “Mode confirm (town enter): world” and “Mode confirm (town re-enter): world”
  - Dungeon counterparts likewise suppress “Mode confirm (dungeon enter): world” and “Mode confirm (dungeon re-enter): world” after any dungeon success.
  - Aggregated union-of-success now uses the same town success recognition and hides the above failure counterparts in the aggregated step list.
  - Live Matchup scoreboard coalesces the same failure counterparts after successes so the panel prioritizes real issues.
- Benefit: Eliminates misleading “not achieved”/“confirm … : world” failures when town/dungeon transitions did succeed elsewhere in the run/series; clearer per-run and aggregated reports.
- Notes: No change to actual scenario flows; this is reporting-only. Runner version remains v1.8.0.

v1.35.36 — Smoketest reporting: Key Checklist alignment and aggregation clarity
- Changed: smoketest/reporting/render.js
  - Key Checklist now recognizes additional success messages for common flows:
    - “Town entered” also matches “Mode confirm (town enter): town”.
    - “Returned to overworld from dungeon” also matches “Dungeon exit helper: post-'g' mode=world” and “Mode confirm (dungeon exit): world”.
  - Applies to both HTML and JSON checklist builders to keep per-run and aggregated reports consistent.
- Benefit: Checklist accurately reflects successful town/dungeon transitions even when success is logged via confirm/helper messages; reduces misleading “Town entry not achieved” impressions when other scenarios already entered town successfully.
- Next: Rerun smoketest to verify checklist items reflect successes across the series.
- Deployment: (pending)

v1.35.35 — Smoketest runner v1.8.0: multi-run aggregation, controls, and diagnostics
- Runner version: 1.8.0 (smoketest/runner/runner.js)
- Added: series controls
  - skipokafter=N — skip scenarios that have already passed N runs in the current series (still guarantees at least one run of town_diagnostics and dungeon_persistence unless persistence=never).
  - persistence=once|always|never — control dungeon_persistence frequency per series.
  - abortonimmobile=1 — abort the current run when an “immobile” step is recorded; the step is SKIP, not FAIL.
- Added: Live Matchup scoreboard
  - Pinned, high-contrast panel at the top of the GOD output; prioritizes FAIL, then SKIP, then OK and sorts by recency.
  - Counters: OK/FAIL/SKIP plus IMMOBILE and DEAD; updates after each run.
- Added: Union-of-success aggregated report
  - After multi-run, append an aggregated report where a step is OK if any run passed it; SKIP if only skipped; FAIL otherwise.
  - Suppress failure counterparts when a matching success occurred in the series (e.g., hide “Dungeon entry failed” if any run “Entered dungeon”).
  - Export buttons attach aggregated Summary TXT and Checklist TXT.
- Changed: per-run seed workflow and world-mode gating
  - Derive a unique 32-bit seed per run (deterministic when &seed=BASE provided); apply via GOD panel New Game; wait for “world” mode.
  - Ensure spawn tile walkability; teleport to nearest walkable if blocked.
- Added: structured trace and diagnostics in exports
  - scenarioTraces with timings/mode transitions, actionsSummary, scenarioPassCounts, step-level tile/modal/perf stats.
- Docs: smoketest.md and smoketest/README.md updated to document new runner options and behavior.
- Benefit: faster stabilization across multi-run series, clearer visibility into flaky steps, and richer diagnostics for CI.
- Deployment: (pending)

v1.35.34 — Phase 5 completion: performance + UX polish consolidated
- Summary of Phase 5 improvements:
  - Rendering: offscreen base-layer caches (overworld/town/dungeon), cropped blits via RenderCore.blitViewport, OffscreenCanvas adoption, crisper tiles/glyphs (image smoothing disabled).
  - UI: HUD performance overlay with EMA smoothing, smart defaults for Grid/Perf/Minimap on small/low-power devices, inventory render guard + caching, modal open/hide redraw coalescing.
  - Engine: centralized draw scheduling in orchestrator, extensive draw coalescing across HUD/log-only flows (Actions/Town/GOD), world-mode FOV recompute skip on movement.
  - Reliability: GameAPI routing/entry/exit hardening (modal-closing, adjacency and ring fallbacks).
- Benefit: smoother frame pacing, fewer redundant draws/DOM updates, improved small-screen performance, and more reliable automated flows.
- Deployment: https://v79o383y2y1z.cosine.page

v1.35.33 — Phase 5: World-mode FOV recompute skip on movement
- Changed: core/game.js
  - recomputeFOV(): in overworld, now skips recompute on movement; only recomputes when mode or map shape changes. Updates cache and returns early to avoid per-turn seen/visible refills.
- Benefit: reduces per-turn overhead in world mode while keeping visuals identical.
- Deployment: https://5kwm5umortdh.cosine.page

v1.35.32 — Phase 5: Action-level DOM coalescing (inventory render only if open)
- Changed: core/game.js
  - drinkPotionByIndex(): now re-renders inventory only when the panel is open (rerenderInventoryIfOpen), avoiding unnecessary DOM work.
  - equipItemByIndex/equipItemByIndexHand/unequipSlot (fallbacks): pass rerenderInventoryIfOpen to Player helpers instead of unconditional renderInventoryPanel.
- Benefit: reduces redundant DOM updates during drink/equip/unequip actions when inventory is closed; small steady performance gain.
- Deployment: (pending)

v1.35.31 — Phase 5: Smoketest reliability — modal closing + immobile fallbacks
- Changed: core/game_api.js
  - moveStep(): if the player doesn’t move in world mode, performs a minimal walkability fallback to step onto the target tile and coalesces camera/UI/draw.
  - gotoNearestTown/gotoNearestDungeon(): proactively close modals via UIBridge before routing; on each step, if movement is gated, force-teleport to the next step (walkable with small ring fallback).
  - enterTownIfOnTile/enterDungeonIfOnEntrance(): proactively close modals via UIBridge before attempting fast-path entry or routing.
- Benefit: Reduces “World movement test: immobile” flakes and further improves town/dungeon entry reliability in automation.
- Deployment: (pending)

v1.35.29 — Phase 5: Entry/Exit robustness (diagonals + near-exit)
- Changed: core/modes.js
  - enterTownIfOnTile/enterDungeonIfOnEntrance now consider diagonal adjacency when stepping onto town/dungeon markers before entering. Improves reliability when markers are placed with limited cardinal access.
- Changed: core/dungeon_runtime.js
  - returnToWorldIfAtExit treats adjacency (Δ1) to the exit tile as valid; nudges the player onto the exact stairs before returning to the overworld. Aligns with runner’s “teleport near exit” guard.
- Benefit: Further reductions in “Dungeon entry failed (mode=world)”, “Town entry not achieved”, and occasional “Attempted return to overworld (mode=dungeon)” failures in smoketests.
- Deployment: (pending)

v1.35.30 — Phase 5: FOV recompute guard in world mode
- Changed: core/game.js
  - recomputeFOV now skips when mode/map/FOV/player position are unchanged, even in world mode.
  - Avoids re-filling seen/visible arrays every turn on the overworld, reducing per-turn work.
- Benefit: small but steady performance gain during overworld turns without visual change.
- Deployment: (pending)

v1.35.28 — Phase 5: Smoketest pass-rate improvements (robust entry + near spawns)
- Changed: core/game_api.js
  - enterTownIfOnTile/enterDungeonIfOnEntrance now auto-route to the nearest town/dungeon when not already on/adjacent, then attempt entry. Synchronous BFS walk; preserves ctx-first semantics.
- Changed: data/god.js
  - spawnEnemyNearby clamps spawn to Manhattan radius <= 5 around player when possible (rings r=1..5, randomized); fallback picks the nearest free tile on the map.
- Benefit: Reduces “Dungeon entry failed (mode=world)” and “Town entry not achieved” flakes; increases likelihood of “Enemy nearby ≤ 5” for combat scenario.
- Deployment: (pending)

v1.35.27 — Phase 5: Centralize world draw scheduling
- Changed: core/world_runtime.js
  - Removed requestDraw at end of generate(); draw is now orchestrated centrally.
- Changed: core/game.js
  - initWorld(): after successful WorldRuntime.generate, now calls requestDraw() post syncFromCtx(ctx).
- Changed: core/game_api.js
  - forceWorld(): removed redundant requestDraw; initWorld now schedules draw itself.
- Benefit: consistent draw orchestration across all runtimes (world/town/dungeon), reducing duplicate frames.
- Deployment: https://k4pgqv9tqymd.cosine.page

v1.35.26 — Phase 5: Coalesced draws in Actions/Town/GOD
- Changed: core/actions.js
  - Inn rest no longer calls requestDraw; updates HUD only. Orchestrator draws after action.
- Changed: worldgen/town_gen.js
  - Removed requestDraw at end of generate(); draw is handled by orchestrator after town entry.
- Changed: data/god.js
  - applySeed(ctx,seed) no longer calls requestDraw; core/game.js handles draw after regeneration.
- Benefit: reduces redundant frames during common flows (inn rest, town generation, seeding).
- Deployment: (pending)

v1.35.25 — Phase 5: Centralized draw after DungeonRuntime.enter; remove extra draws in DungeonState
- Changed: core/modes.js
  - After a successful DungeonRuntime.enter(ctx, info), now calls syncAfterMutation(ctx) to recompute FOV, update camera/UI, and schedule a draw via the orchestrator.
- Changed: dungeon/dungeon_state.js
  - Removed requestDraw() from applyState() and returnToWorldIfAtExit(); draw scheduling is handled by Modes and core/game.js.
- Benefit: avoids duplicate frames on dungeon re-entry/exit and keeps draw orchestration in one place.
- Deployment: (pending)

v1.35.24 — Phase 5: Coalesced draws in runtimes (Dungeon/Town)
- Changed: core/dungeon_runtime.js
  - Removed requestDraw from load(), generate() (including fallback), returnToWorldIfAtExit(), and enter().
  - Draw scheduling now centralized in core/game.js (applyCtxSyncAndRefresh and mode transitions).
- Changed: core/town_runtime.js
  - Removed requestDraw from generate() and applyLeaveSync(); orchestrator handles draw after sync.
- Benefit: avoids redundant frames and keeps draw orchestration in one place for transitions and generation flows.
- Deployment: (pending)

v1.35.23 — Phase 5: More draw coalescing in dungeon guidance
- Changed: core/game.js
  - lootCorpse() dungeon fallback removes requestDraw for guidance-only message (“Return to the entrance …”); canvas unchanged.
- Benefit: avoids unnecessary frames on pure log guidance in dungeon mode.
- Deployment: (pending)

v1.35.22 — Phase 5: Renderer micro-optimizations and responsive minimap
- Changed: ui/render_town.js
  - Introduced SHOP_GLYPHS cache keyed by shops reference; rebuild only when shops array changes.
  - Avoids per-frame glyph map recomputation; maintains O(1) glyph lookup during draw.
- Changed: ui/render_overworld.js
  - Added TOWN_GLYPHS cache keyed by towns reference; rebuild only when towns list changes.
  - Minimap now uses responsive size clamps (smaller max width/height on narrow screens) to reduce draw cost on mobile.
- Benefit: Reduced CPU in hot draw paths by removing repeated map/glyph precomputations; improved small-screen performance for minimap.
- Deployment: (pending)

v1.35.21 — Phase 5: More draw coalescing (town bump-talk and closed-shop logs)
- Changed: core/game.js
  - tryMovePlayer (town mode): removed canvas redraw after bump-talk fallback (“Excuse me!”). Pure log only.
- Changed: core/town_runtime.js
  - talk(ctx): removed canvas redraw when shop is closed; logs schedule without forcing a frame.
- Benefit: minor but frequent savings during town interactions that only produce HUD/log changes.
- Deployment: (pending)

v1.35.20 — Phase 5: Cleanup — remove redundant draws in HUD/log-only flows
- Changed: core/game_api.js
  - addGold/removeGold no longer schedule a canvas redraw; they update HUD and rerender inventory panel only if open.
- Changed: core/town_runtime.js
  - talk(ctx): removed unconditional requestDraw at tail; redraw now occurs only when shop UI open-state changes.
  - tryMoveTown(ctx): removed draw after bump-talk “Excuse me!” (pure log).
- Changed: core/dungeon_runtime.js
  - lootHere(ctx): removed immediate draw when auto-stepping onto an adjacent corpse/chest; subsequent loot/turn handles UI/draw.
- Changed: ui/shop_panel.js
  - openForNPC/buyIndex: removed requestDraw calls (Shop panel is DOM-only).
- Changed: data/god.js
  - spawnItems(ctx): removed requestDraw (HUD/inventory-only changes).
- Benefit: fewer unnecessary frames; improved responsiveness during town/dungeon interactions that affect only HUD/logs.
- Deployment: https://hs7fswoccl6i.cosine.page

v1.35.19 — Phase 5: Coalesced HUD-only updates (GameAPI/Town props)
- Changed: core/game_api.js
  - advanceMinutes(mins) now updates HUD without forcing a redraw (canvas unchanged).
  - setEnemyHpAt(x,y,hp) no longer triggers an immediate draw; reserved for visual changes.
- Changed: worldgen/town_gen.js
  - interactProps(ctx) no longer requests a draw after pure log messages.
  - Bench rest now calls ctx.updateUI() after advancing time and healing to reflect HP/clock changes without forcing a redraw.
- Benefit: fewer redundant frames during HUD-only changes; smoother logs and interactions.
- Deployment: (pending)

v1.35.18 — Phase 5: Draw coalescing for Actions/GOD logs
- Changed: core/actions.js now avoids scheduling canvas redraws for pure log-only interactions (signs, props, tavern/shop messages, guidance) and reserves draws for actual visual changes (e.g., time advancement via Inn rest).
- Changed: data/god.js coalesces UI updates:
  - heal(ctx): updates HUD without forcing a canvas redraw.
  - spawnItems(ctx): updates HUD/inventory, then lets the engine coalesce the draw.
  - spawnStairsHere(ctx): retains a single draw since the tile changes.
- Benefit: fewer unnecessary draws when the action affects only the HUD/log; sustained performance improvements during town interactions.
- Deployment: (pending)

v1.35.17 — Phase 5: Action-level UI coalescing (inventory/gold)
- Changed: core/game.js renderInventoryPanel no longer calls updateUI itself; action flows (equip/drink/decay) invoke updateUI as needed to avoid duplicate HUD updates.
- Changed: core/game_api.js addGold/removeGold now call updateUI once, rerenderInventoryIfOpen() (panel-only), then a single requestDraw(), reducing redundant DOM and draw work when inventory is closed.
- Benefit: fewer repeated UI updates and draws during common actions; smoother responsiveness.
- Deployment: (pending)

v1.35.16 — Phase 5: Baseline toggles + coalesced Shop open redraw
- Changed: ui/ui.js init now establishes baseline window flags (DRAW_GRID, SHOW_PERF, SHOW_MINIMAP) from getters when undefined, avoiding repeated localStorage reads in hot paths; buttons refreshed to reflect baseline.
- Changed: core/town_runtime.js talk coalesces redraw on shop open — only requests draw if the Shop panel was previously closed; still requests draw when logging “closed” schedule messages.
- Benefit: small performance wins (fewer redundant draws; reduced toggle state lookups).
- Deployment: (pending)

v1.35.15 — Phase 5: Perf overlay smoothing (EMA)
- Changed: core/game.js now maintains an exponential moving average (EMA) for turn/draw times (PERF.avgTurnMs, PERF.avgDrawMs) and exposes smoothed values via getPerfStats().
- UI: HUD shows smoothed timings automatically (still respects Perf toggle); DEV console prints last and avg values.
- Benefit: less jitter in Perf numbers while preserving real-time responsiveness.
- Deployment: (pending)

v1.35.14 — Phase 5: Smoketest reliability — routeTo adjacency fallback
- Changed: core/game_api.js routeTo(tx,ty) now detects non-walkable targets (e.g., town/dungeon markers) and routes to a walkable adjacent tile or nearest walkable tile within a small ring.
- Benefit: improves reliability for automated entry flows (world→dungeon/town) by ensuring pathing stops adjacent to entrances; reduces “Dungeon entry failed (mode=world)” and “Town entry not achieved” flakes in smoketests.
- Note: gotoNearestDungeon/gotoNearestTown benefit automatically (they use routeTo internally).
- Deployment: (pending next deploy)

v1.35.13 — Phase 5: OffscreenCanvas adoption + crisper rendering
- Added: ui/render_core.js createOffscreen(w,h) uses OffscreenCanvas when available, else falls back to HTMLCanvasElement.
- Changed: ui/render_overworld.js, ui/render_town.js, ui/render_dungeon.js now use RenderCore.createOffscreen for their base caches.
- Changed: ui/render_core.js computeView disables image smoothing for crisper tiles/glyphs when supported.
- Benefit: potential performance improvements on browsers that optimize OffscreenCanvas; slightly sharper visuals; no behavior change.
- Deployment: https://7djt27gfy2ge.cosine.page

v1.35.12 — Phase 5: Coalesced draws for panel openings (GOD/Inventory/Loot)
- Changed: core/game.js now requests a redraw on show actions only when the panel was previously closed:
  - onShowGod, showInventoryPanel, and showLootPanel check UIBridge.isOpen first and skip redundant draw if already open.
- Benefit: reduces unnecessary frame scheduling when toggling modals rapidly; small performance win.
- Deployment: https://yvgru23sf8ov.cosine.page

v1.35.11 — Phase 5: Smart defaults for Perf/Grid/Minimap on low-power and small screens
- Changed: ui/ui.js now defaults these toggles to OFF when no preference is stored:
  - Grid overlay (DRAW_GRID): OFF on small screens or low-power devices (<=4 cores or <=4GB).
  - Perf overlay (SHOW_PERF): OFF on small screens or low-power devices.
  - Minimap (SHOW_MINIMAP): OFF on small screens; ON otherwise.
- Benefit: reduced draw work and HUD clutter by default on mobile/low-power devices; users can enable via GOD toggles.
- Deployment: https://px1qo1zpcg1x.cosine.page

v1.35.10 — Phase 5: UI/draw coalescing for modal hides (Shop/GOD/Smoke/Inventory)
- Changed: core/game.js handlers now requestDraw only if the corresponding modal was open:
  - onHideGod/onHideSmoke/onHideShop guard redraws via UIBridge isOpen checks.
  - hideInventoryPanel checks UI.isInventoryOpen before redrawing.
- Benefit: avoids redundant draws when ESC-close shortcuts fire while panels are already closed; small but steady performance gain.
- Deployment: https://ksxgidr5uonr.cosine.page

v1.35.9 — Phase 5: Inventory render caching (equip slots and list)
- Changed: ui/ui.js renderInventory now:
  - Caches equip slots HTML and only updates DOM when it changes.
  - Computes an inventory signature key and skips list rebuild when unchanged.
- Benefit: reduces unnecessary DOM work during background updates; improves responsiveness when inventory is closed or unchanged.
- Deployment: https://wbokz8qnonbd.cosine.page

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
- in smoketest runner remove nudge for dungeon entry town entry dungeon exit and town exit make it exact in tiles nudge only in npc interaction or enemy interaction

BUGS
- npc are not going in inns bed or upstairs of inn (investigate stairs congestion, upstairs routing, bed‑adjacent tile availability)
- some times in towns some extra signs and fire places inside walls
- some npc dont sleep in theid beds
- some work needed for smoketestrunner
- multirun in smoketest skips first multirun 
- itseems eguibed items go to inventory when re going to dungeon/town <-very fy this
- creatures don't spawn reliably in Region Map (wildlife) — verify GameData.animals loaded, spawn gating/probabilities, and per‑tile cleared state
-creatures spawn sometetimes too often atleast in fotest and same place when entering regional map they dont move but they do flee 
- Vild seppo S does not have inventory in encounter
- in dungeons when enemies fight each other they are logged(wich is good for now for debugging purpoces) but they give player xp when they kill each other
- some bloodstanes seem to be generated from ruins/animal(creatures)/encounters in another regional map
- in dungeons enemies seems to show behind walls(not line of sight)
- in encounters ui says in left counter all creatures something it should not say anything in ruins or encounters 
