// Single entry module that imports all game modules in the correct order.
// Fully browser-native (no bundler required). index.html should load this via:
//   <script type="module" src="/src/main.js"></script>

// Import groups. These are pure side-effect import manifests and must preserve order.
import '/src/boot/00_core.js';
import '/src/boot/01_utils.js';
import '/src/boot/02_world_primitives.js';
import '/src/boot/03_data_registries.js';
import '/src/boot/04_entities_and_adapters.js';
import '/src/boot/05_dungeon_core.js';
import '/src/boot/06_services.js';
import '/src/boot/07_combat.js';
import '/src/boot/08_ui_and_rendering.js';
import '/src/boot/09_player.js';
import '/src/boot/10_ai_and_worldgen.js';
import '/src/boot/11_runtime_orchestration.js';

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
  // Log build + origin so players can confirm they’re on the expected deployment.
  try {
    const meta = document.querySelector('meta[name="app-version"]');
    const ver = meta ? String(meta.getAttribute('content') || '') : '';
    if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') {
      window.Logger.log(`[Build] version=${ver || 'dev'} origin=${location.origin}`, 'notice');
    }
  } catch (_) {}

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

      // Vite build compatibility: use glob import so production builds can
      // statically include smoketest modules. In non-bundled browser usage,
      // import.meta.glob is undefined; the try/catch keeps that mode working.
      let smokeModules = null;
      try { smokeModules = import.meta.glob('/smoketest/**/*.js'); } catch (_) { smokeModules = null; }

      const legacy = params.get('legacy') === '1';
      const injectList = [
        // Helpers
        '/smoketest/helpers/dom.js',
        '/smoketest/helpers/gamedata.js',
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
        '/smoketest/scenarios/ui_layout.js',
        '/smoketest/scenarios/world.js',
        '/smoketest/scenarios/region.js',
        '/smoketest/scenarios/determinism.js',
        '/smoketest/scenarios/town_flows.js',
        '/smoketest/scenarios/skeleton_key_chest.js',
        '/smoketest/scenarios/dungeon_persistence.js',
        '/smoketest/scenarios/dungeon_stairs_transitions.js',
        '/smoketest/scenarios/town_diagnostics.js',
        '/smoketest/scenarios/api.js',
        '/smoketest/scenarios/encounters.js',
        '/smoketest/scenarios/gm_mechanic_hints.js',
        '/smoketest/scenarios/gm_intent_decisions.js',
        '/smoketest/scenarios/gm_seed_reset.js',
        '/smoketest/scenarios/gm_boredom_interest.js',
        '/smoketest/scenarios/gm_boredom_milestones.js',
        '/smoketest/scenarios/gm_disable_switch.js',
        '/smoketest/scenarios/gm_bridge_markers.js',
        '/smoketest/scenarios/gm_bridge_faction_travel.js',
        '/smoketest/scenarios/gm_bottle_map.js',
        '/smoketest/scenarios/gm_bottle_map_fishing_pity.js',
        '/smoketest/scenarios/gm_survey_cache.js',
        '/smoketest/scenarios/gm_survey_cache_spawn_gate.js',
        '/smoketest/scenarios/gm_rng_persistence.js',
        '/smoketest/scenarios/gm_scheduler_arbitration.js',
        '/smoketest/scenarios/quest_board_gm_markers.js',
        // Orchestrator (default) - load last so scenarios are ready
        '/smoketest/runner/runner.js'
      ];

      if (legacy) {
        injectList.push('/smoketest/smoketest_runner.js');
      }
      for (const url of injectList) {
        try {
          if (smokeModules && smokeModules[url]) {
            await smokeModules[url]();
          } else {
            await import(url);
          }
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