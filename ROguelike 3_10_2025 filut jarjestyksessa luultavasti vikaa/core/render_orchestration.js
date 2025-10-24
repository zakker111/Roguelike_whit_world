/**
 * RenderOrchestration: build a render context object for Render.draw from ctx.
 *
 * Exports (ESM + window.RenderOrchestration):
 * - getRenderCtx(ctx)
 */

function mod(name) {
  try {
    const w = (typeof window !== "undefined") ? window : {};
    return w[name] || null;
  } catch (_) { return null; }
}

function computeColors() {
  try {
    const PAL = (typeof window !== "undefined" && window.GameData && window.GameData.palette && typeof window.GameData.palette === "object")
      ? window.GameData.palette
      : null;
    return {
      wall: (PAL && PAL.tiles && PAL.tiles.wall) || "#1b1f2a",
      wallDark: (PAL && PAL.tiles && PAL.tiles.wallDark) || "#131722",
      floor: (PAL && PAL.tiles && PAL.tiles.floor) || "#0f1320",
      floorLit: (PAL && PAL.tiles && PAL.tiles.floorLit) || "#0f1628",
      player: (PAL && PAL.entities && PAL.entities.player) || "#9ece6a",
      enemy: (PAL && PAL.entities && PAL.entities.enemyDefault) || "#f7768e",
      enemyGoblin: (PAL && PAL.entities && PAL.entities.goblin) || "#8bd5a0",
      enemyTroll: (PAL && PAL.entities && PAL.entities.troll) || "#e0af68",
      enemyOgre: (PAL && PAL.entities && PAL.entities.ogre) || "#f7768e",
      item: (PAL && PAL.entities && PAL.entities.item) || "#7aa2f7",
      corpse: (PAL && PAL.entities && PAL.entities.corpse) || "#c3cad9",
      corpseEmpty: (PAL && PAL.entities && PAL.entities.corpseEmpty) || "#6b7280",
      dim: (PAL && PAL.overlays && PAL.overlays.dim) || "rgba(13, 16, 24, 0.75)"
    };
  } catch (_) {
    return {
      wall: "#1b1f2a",
      wallDark: "#131722",
      floor: "#0f1320",
      floorLit: "#0f1628",
      player: "#9ece6a",
      enemy: "#f7768e",
      enemyGoblin: "#8bd5a0",
      enemyTroll: "#e0af68",
      enemyOgre: "#f7768e",
      item: "#7aa2f7",
      corpse: "#c3cad9",
      corpseEmpty: "#6b7280",
      dim: "rgba(13, 16, 24, 0.75)"
    };
  }
}

export function getRenderCtx(ctx) {
  const canvas = (typeof document !== "undefined") ? document.getElementById("game") : null;
  const ctx2d = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  const colors = ctx.COLORS || computeColors();
  const tiles = ctx.TILES || (mod("Game") && mod("Game").TILES) || { WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3, WINDOW: 4 };

  const enemyColorFn = (t) => {
    try {
      const EM = ctx.Enemies || mod("Enemies");
      if (EM && typeof EM.colorFor === "function") return EM.colorFor(t);
    } catch (_) {}
    return colors.enemy;
  };

  return {
    ctx2d,
    TILE: ctx.TILE, ROWS: ctx.ROWS, COLS: ctx.COLS, COLORS: colors, TILES: tiles,
    map: ctx.map, seen: ctx.seen, visible: ctx.visible,
    player: ctx.player, enemies: ctx.enemies, corpses: ctx.corpses, decals: ctx.decals,
    camera: ctx.camera,
    mode: ctx.mode,
    world: ctx.world,
    region: ctx.region,
    npcs: ctx.npcs,
    shops: ctx.shops,
    townProps: ctx.townProps,
    townBuildings: ctx.townBuildings,
    townExitAt: ctx.townExitAt,
    // Inn upstairs overlay fields (needed by RenderTown)
    tavern: ctx.tavern,
    innUpstairs: ctx.innUpstairs,
    innUpstairsActive: !!ctx.innUpstairsActive,
    innStairsGround: Array.isArray(ctx.innStairsGround) ? ctx.innStairsGround : [],
    encounterProps: ctx.encounterProps,
    encounterBiome: ctx.encounterBiome,
    dungeonProps: ctx.dungeonProps,
    enemyColor: enemyColorFn,
    time: ctx.time,
    // onDrawMeasured to be set by orchestrator (game.js) for PERF capture
    onDrawMeasured: null
  };
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("RenderOrchestration", { getRenderCtx });