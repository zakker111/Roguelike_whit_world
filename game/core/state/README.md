Core State Modules (grouped under core/state)

Purpose
- Consolidate state-related helpers and documentation in one place.
- Provide clear, ctx-first utilities for visibility grids, persistence resets, and engine/UI refresh.

Modules
- game_state.js
  - ensureVisibilityShape(ctx): Ensures ctx.seen and ctx.visible match current map dimensions (rows/cols).
  - applySyncAndRefresh(ctx): Calls updateCamera, recomputeFOV, updateUI, requestDraw in order.
  - Notes: Prefer StateSync.applyAndRefresh(ctx,{}) elsewhere for unified refresh; this helper is a minimal fallback.

- persistence.js
  - clearPersistentGameStorage(ctx): Clears localStorage keys and in-memory mirrors for dungeon/town/region states.
  - Keys removed: DUNGEON_STATES_V1, TOWN_STATES_V1, REGION_CUTS_V1, REGION_ANIMALS_V1/V2, REGION_STATE_V1.
  - Resets window._DUNGEON_STATES_MEM and window._TOWN_STATES_MEM to empty objects (when available).
  - Notes: Does not clear SEED or UI toggles; use GOD “New Game” flows to preserve preferences.

- state_sync.js
  - applyLocal(ctx, sink): Copies ctx fields into a local orchestrator sink (setMode/setMap/etc.).
  - applyAndRefresh(ctx, sink): Calls applyLocal then performs a standardized visual refresh.
  - Sink schema:
    - setMode(v), setMap(v), setSeen(v), setVisible(v), setWorld(v)
    - setEnemies(v), setCorpses(v), setDecals(v), setNpcs(v)
    - setEncounterProps(v), setDungeonProps(v)
    - setEncounterBiome(v), setEncounterObjective(v)
    - setShops(v), setTownProps(v), setTownBuildings(v)
    - setTownPlaza(v), setTavern(v), setInnUpstairs(v), setInnUpstairsActive(v), setInnStairsGround(v)
    - setWorldReturnPos(v), setRegion(v), setTownExitAt(v), setDungeonExitAt(v)
    - setDungeonInfo(v), setFloor(v)
  - Notes:
    - Prefer StateSync.applyAndRefresh(ctx,{}) after any mode transition or state mutation for consistent refresh across camera/FOV/UI/draw.
    - Modules use ctx.StateSync or getMod(ctx,"StateSync") with back-compat window.StateSync.

Conventions
- All functions are ctx-first.
- Avoid direct window.* calls except for optional back-compat attachment via utils/global.attachGlobal.
- Visual refresh is centralized via StateSync; modules refrain from calling requestDraw directly unless strictly necessary.