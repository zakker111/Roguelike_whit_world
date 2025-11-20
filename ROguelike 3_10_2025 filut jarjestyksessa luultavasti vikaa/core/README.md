Core engine and orchestration

Purpose
- Central runtime, input, turn loop, mode lifecycles, draw scheduling, UI coordination, and deterministic RNG service.

Module groups (structure)
- engine/
  - game_loop.js — main loop, draw scheduling, perf budgeting (window.GameLoop).
  - turn_loop.js — per-turn execution and effect resolution (window.TurnLoop).
  - game_fov.js, fov_camera.js — FOV/LOS camera helpers and recompute scheduling.
  - render_orchestration.js — builds Render context; central draw orchestration (window.RenderOrchestration).
  - game_orchestrator.js — boot sequence: init world, setup input/UI, start loop (window.GameOrchestrator).
- bridge/
  - ui_bridge.js — single UI interaction path (inventory, loot, shop, GOD, smoke, sleep, quest board) (window.UIBridge).
  - ui_orchestration.js — HUD/panel lifecycle wrappers and conditional draw scheduling (window.UIOrchestration).
- state/
  - game_state.js — visibility shape helper + minimal refresh fallback (window.GameState).
  - persistence.js — persistent storage clearing helpers (window.Persistence).
  - state_sync.js — applyLocal/applyAndRefresh for ctx→orchestrator sync and unified refresh (window.StateSync).

Key modules (ctx-first)
- ctx.js — shared global context and handles for systems.
- rng_service.js — deterministic RNG with seed persistence and GOD integration.
- actions.js — gameplay actions entry points and bump/interact flows.
- movement.js — movement helpers and turn hooks across modes.
- modes.js — mode registry and simple mode switches.
- modes_transitions.js — guarded transitions between world/town/dungeon/encounter.
- world_runtime.js — orchestrator for overworld loop and FOV recompute guards.
- town_runtime.js — orchestrator for town loop (schedules, shop hours).
- dungeon_runtime.js — orchestrator for dungeon loop (stairs, persistence).
- encounter_runtime.js — orchestrator for encounter maps and exits.
- input.js — keyboard input handling and modal gating priorities.
- game_api.js — capability facade exposed to smoketest and dev tools.
- inventory_controller.js — inventory/equip flows and hand chooser.
- inventory_flow.js — UI-driven inventory open/close and equip interactions.
- loot_flow.js — looting panels and underfoot multi-container consolidation.
- death_flow.js — simple game over flow and restart.
- occupancy_facade.js — occupancy queries bridging world/dungeon grids.
- capabilities.js — feature flags for smoketest and diagnostics.
- god_handlers.js — GOD panel button wiring and toggles (grid/perf/minimap, diagnostics).

Notes
- Files kept at legacy paths (core/*.js) that were moved now proxy-export to their new locations in engine/, bridge/, or state/ to avoid breaking imports.
  - Proxies: render_orchestration.js, turn_loop.js, game_orchestrator.js → engine/
  - ui_bridge.js, ui_orchestration.js → bridge/
  - game_state.js, persistence.js, state_sync.js → state/
- Prefer ctx.* handles over window.* for module communication.
- Movement/actions are ignored while any modal is open; ESC closes the top modal.