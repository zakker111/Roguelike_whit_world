Core engine and orchestration

Purpose
- Central runtime, input, turn loop, mode lifecycles, draw scheduling, UI coordination, and deterministic RNG service.

Key modules
- ctx.js — shared global context and handles for systems.
- rng_service.js — deterministic RNG with seed persistence and GOD integration.
- state_sync.js — lightweight state mirrors and storage sync helpers.
- actions.js — gameplay actions entry points and bump/interact flows.
- movement.js — movement helpers and turn hooks across modes.
- modes.js — mode registry and simple mode switches.
- modes_transitions.js — guarded transitions between world/town/dungeon/encounter.
- world_runtime.js — orchestrator for overworld loop and FOV recompute guards.
- town_runtime.js — orchestrator for town loop (schedules, shop hours).
- dungeon_runtime.js — orchestrator for dungeon loop (stairs, persistence).
- encounter_runtime.js — orchestrator for encounter maps and exits.
- game_loop.js — main loop, draw scheduling, and perf budgeting.
- turn_loop.js — per-turn execution and effect resolution.
- input.js — keyboard input handling and modal gating priorities.
- game_api.js — capability facade exposed to smoketest and dev tools.
- game_orchestrator.js — boot sequence: init world, setup input/UI, start loop.
- inventory_controller.js — inventory/equip flows and hand chooser.
- inventory_flow.js — UI-driven inventory open/close and equip interactions.
- loot_flow.js — looting panels and underfoot multi-container consolidation.
- death_flow.js — simple game over flow and restart.
- game_state.js — top-level game state container.
- game_fov.js, fov_camera.js — FOV/LOS camera helpers and recompute scheduling.
- occupancy_facade.js — occupancy queries bridging world/dungeon grids.
- ui_bridge.js — single UI interaction path (inventory, loot, shop, GOD, smoke).
- ui_orchestration.js — HUD panel lifecycle and GOD handlers integration.
- render_orchestration.js — centralized draw orchestration; modules avoid direct requestDraw.
- capabilities.js — feature flags for smoketest and diagnostics.
- god_handlers.js — GOD panel button wiring and toggles (grid/perf/minimap, diagnostics).

Notes
- Prefer ctx.* handles over window.* for module communication.
- Movement/actions are ignored while any modal is open; ESC closes the top modal.