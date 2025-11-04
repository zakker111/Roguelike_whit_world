// Single entry module that imports all game modules in the correct order.
// Fully browser-native (no bundler required). index.html should load this via:
//   <script type="module" src="/src/main.js"></script>

// Core context and deterministic RNG service
import '/core/ctx.js';
import '/core/rng_service.js';
import '/core/state_sync.js';

// Utilities
import '/utils/utils.js';
import '/utils/bounds.js';
import '/utils/item_describe.js';
import '/utils/rng.js';

// World and LOS/FOV primitives
import '/world/infinite_gen.js';
import '/world/world.js';
import '/world/los.js';
import '/world/fov.js';

// Data registries (ensure config/palette/tiles ready before consumers)
import '/data/loader.js';
import '/data/flavor.js';
import '/data/god.js';
import '/data/tile_lookup.js';

// Entities and dungeon adapters
import '/entities/items.js';
import '/entities/enemies.js';
import '/dungeon/dungeon_items.js';
import '/entities/loot.js';

// Dungeon core
import '/dungeon/occupancy_grid.js';
import '/dungeon/dungeon_state.js';
import '/dungeon/dungeon.js';

// Services
import '/services/time_service.js';
import '/services/shop_service.js';
import '/services/props_service.js';
import '/services/encounter_service.js';
import '/services/messages.js';
import '/services/flavor_service.js';
import '/services/quest_service.js';

// Combat modules
import '/combat/combat_utils.js';
import '/combat/combat.js';
import '/combat/stats.js';
import '/combat/status_effects.js';
import '/combat/equipment_decay.js';

// UI and rendering
import '/ui/logger.js';
import '/ui/tileset.js';
import '/ui/render_core.js';
import '/ui/render_overworld.js';
import '/ui/render_town.js';
import '/ui/render_dungeon.js';
import '/ui/render_overlays.js';
import '/ui/render_region.js';
import '/ui/render.js';
import '/ui/decals.js';
import '/ui/ui.js';
import '/ui/components/fishing_modal.js';
import '/ui/shop_panel.js';
import '/ui/quest_board.js';
import '/ui/input_mouse.js';

// Player and equipment
import '/entities/player_utils.js';
import '/entities/player_equip.js';
import '/entities/player.js';

// AI and worldgen
import '/ai/ai.js';
import '/ai/town_ai.js';
import '/worldgen/town_gen.js';

// Core runtime orchestration and facades
import '/core/actions.js';
import '/core/town_state.js';
import '/core/modes.js';
import '/core/game_loop.js';
import '/core/input.js';
import '/core/game_api.js';
import '/core/fov_camera.js';
import '/core/inventory_controller.js';
import '/core/inventory_flow.js';
import '/core/town_runtime.js';
import '/core/dungeon_runtime.js';
import '/core/encounter_runtime.js';
import '/core/ui_bridge.js';
import '/region_map/region_map_runtime.js';
import '/core/occupancy_facade.js';
import '/core/world_runtime.js';
import '/core/game_state.js';
import '/core/turn_loop.js';
import '/core/game_fov.js';
import '/core/modes_transitions.js';
import '/core/ui_orchestration.js';
import '/core/movement.js';
import '/core/loot_flow.js';
import '/core/render_orchestration.js';
import '/core/death_flow.js';
import '/core/capabilities.js';
import '/core/god_handlers.js';

// Finally: game orchestrator (boots world, sets up input, starts loop/render)
// Minimal orchestrator keeps current boot-in-game.js behavior behind a stable entrypoint.
import '/core/game_orchestrator.js';

// Boot diagnostics: log RNG source and seed once registries are loaded.
(function () {
  try {
    var src = (typeof window !== 'undefined' && window.RNG && typeof window.RNG.rng === 'function') ? 'RNG.service' : 'mulberry32.fallback';
    var seed = '(random)';
    if (typeof window !== 'undefined' && window.RNG && typeof window.RNG.getSeed === 'function') {
      var s = window.RNG.getSeed();
      if (s != null) seed = String((Number(s) >>> 0));
    } else {
      try {
        var sRaw = localStorage.getItem('SEED');
        if (sRaw != null) seed = String((Number(sRaw) >>> 0));
      } catch (_) {}
    }
    if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') {
      window.Logger.log('Boot: RNG=' + src + '  Seed=' + seed, 'notice');
    } else if (typeof window !== 'undefined' && window.DEV) {
      console.debug('[BOOT] RNG=' + src + '  Seed=' + seed);
    }
  } catch (_) {}
})();

// Initialize Logger once DOM is ready; modules above have attached window.Logger
document.addEventListener('DOMContentLoaded', function () {
  try {
    if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.init === 'function') {
      // Keep existing HUD defaults; second arg is max log entries per panel
      window.Logger.init(undefined, 80);
    }
  } catch (e) {}
});

// Optional smoke test loader: load when ?smoketest=1 via dynamic imports,
// still fully browser-side and respecting import order.
(async function () {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('smoketest') === '1') {
      console.log('[SMOKE] loader: detected ?smoketest=1, dynamic importing runner');
      const legacy = params.get('legacy') === '1';
      const injectList = [
        // Helpers
        '/smoketest/helpers/dom.js',
        '/smoketest/helpers/budget.js',
        '/smoketest/helpers/logging.js',
        '/smoketest/helpers/movement.js',
        '/smoketest/helpers/teleport.js',
        // Capabilities
        '/smoketest/capabilities/detect.js',
        '/smoketest/capabilities/rng_audit.js',
        // Reporting
        '/smoketest/reporting/render.js',
        '/smoketest/reporting/export.js',
        // Runner helpers
        '/smoketest/runner/init.js',
        '/smoketest/runner/banner.js',
        // Scenarios (load all before orchestrator to ensure availability)
        '/smoketest/scenarios/dungeon.js',
        '/smoketest/scenarios/town.js',
        '/smoketest/scenarios/inventory.js',
        '/smoketest/scenarios/combat.js',
        '/smoketest/scenarios/overlays.js',
        '/smoketest/scenarios/world.js',
        '/smoketest/scenarios/determinism.js',
        '/smoketest/scenarios/town_flows.js',
        '/smoketest/scenarios/dungeon_persistence.js',
        '/smoketest/scenarios/town_diagnostics.js',
        '/smoketest/scenarios/api.js',
        '/smoketest/scenarios/encounters.js',
        // Orchestrator (default) - load last so scenarios are ready
        '/smoketest/runner/runner.js'
      ];
      if (legacy) {
        injectList.push('/smoketest/smoketest_runner.js');
      }
      for (const url of injectList) {
        try {
          await import(url);
        } catch (e) {
          console.error('[SMOKE] loader: failed to import', url, e);
        }
      }
      window.SMOKETEST_REQUESTED = true;
    } else {
      console.log('[SMOKE] loader: no smoketest param');
    }
  } catch (e) {
    console.error('[SMOKE] loader: error', e);
  }
})();