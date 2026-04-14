export const SMOKE_SCENARIOS = [
  { id: "world", label: "World", importPath: "/smoketest/scenarios/world.js", resolver: "World.run", phase0: true },
  { id: "region", label: "Region Map", importPath: "/smoketest/scenarios/region.js", resolver: "Region.run", phase0: true },
  { id: "inventory", label: "Inventory", importPath: "/smoketest/scenarios/inventory.js", resolver: "Inventory.run", phase0: true },
  { id: "dungeon", label: "Dungeon", importPath: "/smoketest/scenarios/dungeon.js", resolver: "Dungeon.run", phase0: true },
  { id: "combat", label: "Combat", importPath: "/smoketest/scenarios/combat.js", resolver: "Combat.run", phase0: false },
  { id: "dungeon_persistence", label: "Dungeon Persistence", importPath: "/smoketest/scenarios/dungeon_persistence.js", resolver: "Dungeon.Persistence.run", phase0: false },
  { id: "dungeon_stairs_transitions", label: "Dungeon Stairs Transitions", importPath: "/smoketest/scenarios/dungeon_stairs_transitions.js", resolver: "Dungeon.StairsTransitions.run", phase0: false },
  { id: "town", label: "Town", importPath: "/smoketest/scenarios/town.js", resolver: "Town.run", phase0: true },
  { id: "town_rumor_status", label: "Town rumor status", importPath: "/smoketest/scenarios/town_rumor_status.js", resolver: "town_rumor_status.run", phase0: true },
  { id: "town_thief_chase", label: "Town thief chase", importPath: "/smoketest/scenarios/town_thief_chase.js", resolver: "town_thief_chase.run", phase0: false },
  { id: "town_diagnostics", label: "Town Diagnostics", importPath: "/smoketest/scenarios/town_diagnostics.js", resolver: "Town.Diagnostics.run", phase0: false },
  { id: "harbor_fast_travel", label: "Harbor fast travel", importPath: "/smoketest/scenarios/harbor_fast_travel.js", resolver: "HarborFastTravel.run", phase0: false },
  { id: "overlays", label: "Overlays", importPath: "/smoketest/scenarios/overlays.js", resolver: "Overlays.run", phase0: true },
  { id: "ui_layout", label: "UI Layout (Canvas Stability)", importPath: "/smoketest/scenarios/ui_layout.js", resolver: "UILayout.run", phase0: false },
  { id: "determinism", label: "Determinism", importPath: "/smoketest/scenarios/determinism.js", resolver: "Determinism.run", phase0: false },
  { id: "encounters", label: "Encounters", importPath: "/smoketest/scenarios/encounters.js", resolver: "encounters.run", phase0: true },
  { id: "api", label: "API", importPath: "/smoketest/scenarios/api.js", resolver: "API.run", phase0: false },
  { id: "town_flows", label: "Town Flows", importPath: "/smoketest/scenarios/town_flows.js", resolver: "Town.Flows.run", phase0: false },
  { id: "skeleton_key_chest", label: "Skeleton Key + Locked Chest", importPath: "/smoketest/scenarios/skeleton_key_chest.js", resolver: "skeleton_key_chest.run", phase0: false },
  { id: "gm_mechanic_hints", label: "GM: Mechanic hints (unused only)", importPath: "/smoketest/scenarios/gm_mechanic_hints.js", resolver: "GMMechanicHints.run", phase0: false },
  { id: "gm_intent_decisions", label: "GM: Intent decisions (entrance + mechanic hint)", importPath: "/smoketest/scenarios/gm_intent_decisions.js", resolver: "GMIntentDecisions.run", phase0: false },
  { id: "gm_seed_reset", label: "GM: Seed reset (apply seed clears GM state)", importPath: "/smoketest/scenarios/gm_seed_reset.js", resolver: "gm_seed_reset.run", phase0: true },
  { id: "gm_boredom_interest", label: "GM: Boredom interest weighting (Phase 3)", importPath: "/smoketest/scenarios/gm_boredom_interest.js", resolver: "gm_boredom_interest.run", phase0: true },
  { id: "gm_boredom_milestones", label: "GM: Boredom relief on milestones (town/dungeon/ruins/encounter)", importPath: "/smoketest/scenarios/gm_boredom_milestones.js", resolver: "gm_boredom_milestones.run", phase0: false },
  { id: "gm_bridge_markers", label: "GMBridge + Markers", importPath: "/smoketest/scenarios/gm_bridge_markers.js", resolver: "gm_bridge_markers.run", phase0: true },
  { id: "quest_board_gm_markers", label: "Quest Board: GM Markers", importPath: "/smoketest/scenarios/quest_board_gm_markers.js", resolver: "quest_board_gm_markers.run", phase0: true },
  { id: "quest_board_thread_status", label: "Quest Board: Bandit thread status", importPath: "/smoketest/scenarios/quest_board_thread_status.js", resolver: "quest_board_thread_status.run", phase0: true },
  { id: "caravan_thread_status", label: "Quest Board: Missing Caravan thread status", importPath: "/smoketest/scenarios/caravan_thread_status.js", resolver: "caravan_thread_status.run", phase0: true },
  { id: "gm_panel_smoke", label: "GM Panel (Smoke)", importPath: "/smoketest/scenarios/gm_panel_smoke.js", resolver: "gm_panel_smoke.run", phase0: true },
  { id: "gm_bridge_faction_travel", label: "GMBridge: Faction travel (guard fine confirm)", importPath: "/smoketest/scenarios/gm_bridge_faction_travel.js", resolver: "gm_bridge_faction_travel.run", phase0: true },
  { id: "gm_bottle_map", label: "GM: Bottle Map", importPath: "/smoketest/scenarios/gm_bottle_map.js", resolver: "gm_bottle_map.run", phase0: true },
  { id: "gm_bottle_map_fishing_pity", label: "GM: Bottle Map (fishing pity)", importPath: "/smoketest/scenarios/gm_bottle_map_fishing_pity.js", resolver: "gm_bottle_map_fishing_pity.run", phase0: false },
  { id: "gm_survey_cache", label: "GM: Survey Cache", importPath: "/smoketest/scenarios/gm_survey_cache.js", resolver: "gm_survey_cache.run", phase0: true },
  { id: "gm_survey_cache_spawn_gate", label: "GM: Survey Cache (spawn gate)", importPath: "/smoketest/scenarios/gm_survey_cache_spawn_gate.js", resolver: "gm_survey_cache_spawn_gate.run", phase0: false },
  { id: "gm_disable_switch", label: "GM: Disable switch (gm.enabled=false)", importPath: "/smoketest/scenarios/gm_disable_switch.js", resolver: "gm_disable_switch.run", phase0: false },
  { id: "gm_rng_persistence", label: "GM: RNG persistence (soft reload continuity)", importPath: "/smoketest/scenarios/gm_rng_persistence.js", resolver: "gm_rng_persistence.run", phase0: false },
  { id: "gm_scheduler_arbitration", label: "GM: Scheduler arbitration (RNG-free)", importPath: "/smoketest/scenarios/gm_scheduler_arbitration.js", resolver: "gm_scheduler_arbitration.run", phase0: false },
  { id: "gm_town_incidents", label: "GM: Town incidents", importPath: "/smoketest/scenarios/gm_town_incidents.js", resolver: "gm_town_incidents.run", phase0: true },
  { id: "logging_filters", label: "Logging: filters + LOG_LEVEL=all", importPath: "/smoketest/scenarios/logging_filters.js", resolver: "logging_filters.run", phase0: false }
];

export const SMOKE_SCENARIOS_BY_ID = Object.freeze(
  SMOKE_SCENARIOS.reduce((acc, scenario) => {
    acc[scenario.id] = scenario;
    return acc;
  }, Object.create(null))
);

export const SMOKE_SCENARIO_IMPORTS = Object.freeze(
  SMOKE_SCENARIOS.map((scenario) => scenario.importPath)
);

export const PHASE0_SCENARIO_IDS = Object.freeze(
  SMOKE_SCENARIOS.filter((scenario) => scenario.phase0).map((scenario) => scenario.id)
);

export function resolveScenarioByPath(root, dottedPath) {
  try {
    if (!root || typeof dottedPath !== "string" || !dottedPath) return null;
    const parts = dottedPath.split(".").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      cur = cur ? cur[parts[i]] : null;
      if (cur == null) return null;
    }
    return typeof cur === "function" ? cur : null;
  } catch (_) {
    return null;
  }
}
