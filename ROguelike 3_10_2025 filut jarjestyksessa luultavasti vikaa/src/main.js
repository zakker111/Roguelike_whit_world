// Single entry module that imports all game modules in the correct order.
// Fully browser-native (no bundler required). index.html should load this via:
//   <script type="module" src="/src/main.js"></script>

// Core context and deterministic RNG service
import '/core/ctx.js';
import '/core/rng_service.js';
import '/core/state/state_sync.js';
import '/core/engine/boot_monitor.js';

// Utilities
import '/utils/utils.js';
import '/utils/bounds.js';
import '/utils/item_describe.js';
import '/utils/rng.js';
import '/utils/tiles_validation.js';

// World and LOS/FOV primitives
import '/world/infinite_gen.js';
import '/world/world.js';
import '/world/los.js';
import '/world/fov.js';

// Data registries (ensure config/palette/tiles ready before consumers)
import '/data/loader.js';
import '/data/flavor.js';
import '/data/god.js';
import '/core/god/controls.js';
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
import '/services/weather_service.js';
import '/services/shop_service.js';
import '/services/props_service.js';
import '/services/encounter_service.js';
import '/services/messages.js';
import '/services/flavor_service.js';
import '/services/quest_service.js';
import '/services/combat_service.js';

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

import '/ui/render_region.js';
import '/ui/render.js';
import '/ui/decals.js';
import '/ui/ui.js';
import '/ui/components/fishing_modal.js';
import '/ui/components/lockpick_modal.js';
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

// Finally: game orchestrator (boots world, sets up input, starts loop/render)
// Minimal orchestrator keeps current boot-in-game.js behavior behind a stable entrypoint.
import '/core/engine/game_orchestrator.js';

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
  // Log active palette after Logger is ready (covers URL-param load that happened before Logger)
  try {
    const GD = (typeof window !== 'undefined' ? window.GameData : null);
    const sel = (typeof localStorage !== 'undefined' ? (localStorage.getItem('PALETTE') || 'default') : 'default');
    if (GD && GD.palette) {
      // Resolve path from manifest if available
      let path = null;
      try {
        const list = Array.isArray(GD.palettes) ? GD.palettes : null;
        if (list) {
          const hit = list.find(p => String(p.id || '') === String(sel));
          if (hit && hit.path) path = hit.path;
        }
      } catch (_) {}
      if (!path) {
        path = sel === 'default' ? 'data/world/palette.json' : (sel === 'alt' ? 'data/world/palette_alt.json' : String(sel));
      }
      if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') {
        window.Logger.log(`[Palette] Active ${sel} (${path})`, 'notice');
      }
    }
  } catch (_) {}
});

// Optional smoke test loader: load when ?smoketest=1 via dynamic imports,
// still fully browser-side and respecting import order.
(async function () {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('smoketest') === '1') {
      try { if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') window.Logger.log('[SMOKE] loader: detected ?smoketest=1, dynamic importing runner', 'notice', { category: 'Smoketest' }); } catch (_) {}
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
        // DEV data validation (includes palette overlays checks)
        '/smoketest/validate_data.js',
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
        '/smoketest/scenarios/region.js',
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
          try {
            if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') {
              window.Logger.log('[SMOKE] loader: failed to import ' + url, 'bad', { category: 'Smoketest', error: (e && e.message) ? e.message : String(e), url });
            }
          } catch (_) {}
        }
      }
      window.SMOKETEST_REQUESTED = true;
    } else {
      try { if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') window.Logger.log('[SMOKE] loader: no smoketest param', 'notice', { category: 'Smoketest' }); } catch (_) {}
    }
  } catch (e) {
    try {
      if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') {
        window.Logger.log('[SMOKE] loader: error', 'bad', { category: 'Smoketest', error: (e && e.message) ? e.message : String(e) });
      }
    } catch (_) {}
  }
})();

// DEV-only: run validation checks (including palette overlays) even without smoketest runner
(async function () {
  try {
    const params = new URLSearchParams(location.search);
    const isDev = (params.get('dev') === '1') || (typeof localStorage !== 'undefined' && localStorage.getItem('DEV') === '1') || (typeof window !== 'undefined' && window.DEV);
    if (isDev) {
      try { await import('/smoketest/validate_data.js'); } catch (_) {}
      // After registries are ready, build and log a summary via ValidationRunner
      try {
        const GD = (typeof window !== 'undefined' ? window.GameData : null);
        const VR = (typeof window !== 'undefined' ? window.ValidationRunner : null);
        if (GD && GD.ready && typeof GD.ready.then === 'function' && VR && typeof VR.run === 'function') {
          GD.ready.then(() => { try { VR.run(); VR.logSummary(null); } catch (_) {} });
        }
      } catch (_) {}
    }
  } catch (_) {}
})();