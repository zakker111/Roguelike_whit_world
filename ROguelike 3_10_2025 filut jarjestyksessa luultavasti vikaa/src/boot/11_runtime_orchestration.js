// Boot slice 11: runtime orchestration and facades.

import '/core/modes/actions.js';
import '/core/town/state.js';
import '/core/modes/modes.js';
import '/core/engine/game_loop.js';
import '/core/input.js';
import '/core/game_api.js';
import '/core/engine/fov_camera.js';
import '/core/inventory_controller.js';
import '/core/inventory_flow.js';
import '/core/town/runtime.js';
import '/core/dungeon/runtime.js';
import '/core/encounter/runtime.js';
// EncounterInteractions: G-based interactions inside encounters (campfires, captives, merchants)
import '/core/encounter_interactions.js';
import '/core/bridge/ui_bridge.js';
import '/region_map/region_map_runtime.js';
import '/core/facades/occupancy.js';
import '/core/world_runtime.js';
import '/core/gm/runtime.js';
import '/core/state/game_state.js';
import '/core/engine/turn_loop.js';
import '/core/engine/game_fov.js';
import '/core/modes/transitions.js';
import '/core/bridge/ui_orchestration.js';
import '/core/movement.js';
import '/core/loot_flow.js';
import '/core/engine/render_orchestration.js';
import '/core/death_flow.js';
import '/core/capabilities.js';
import '/core/god/handlers.js';
import '/core/validation_runner.js';
import '/analysis/world_stats.js';
import '/analysis/world_stats_bridges.js';
