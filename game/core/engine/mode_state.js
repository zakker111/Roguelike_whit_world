/**
 * ModeState
 *
 * Centralizes initialization of the world/town/region-related state variables
 * that core/game.js keeps as local `let` bindings.
 *
 * This is intentionally a small, plain JS helper so core/game.js can destructure
 * the defaults while preserving existing semantics (fresh arrays/objects per call).
 */

export function createInitialModeState() {
  return {
    // Game modes: "world" (overworld) or "dungeon" (roguelike floor)
    mode: "world",

    // Overworld + region overlay
    world: null,  // { map, width, height, towns, dungeons }
    region: null, // { width, height, map:number[][], cursor:{x,y}, exitTiles:[{x,y}], enterWorldPos:{x,y} }

    // Town mode state
    npcs: [],
    shops: [],
    townProps: [],
    townBuildings: [],
    townPlaza: null,
    tavern: null,

    // Inn upstairs overlay state
    innUpstairs: null,
    innUpstairsActive: false,
    innStairsGround: [],

    // World/town/dungeon transition anchors
    townExitAt: null,
    worldReturnPos: null,
    dungeonExitAt: null,
    cameFromWorld: false,
    currentDungeon: null,

    // Multi-floor tower runtime state (managed by DungeonRuntime)
    towerRun: null,
  };
}
