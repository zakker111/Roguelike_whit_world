/**
 * Occupancy Facade
 * Centralizes building/updating occupancy grid from the current ctx state.
 *
 * Exports (ESM + window.OccupancyFacade):
 * - rebuild(ctx, overrides?)  // sets ctx.occupancy using OccupancyGrid if available, returns occupancy or null
 */
export function rebuild(ctx, overrides) {
  if (!ctx) return null;
  try {
    const OG = ctx.OccupancyGrid || (typeof window !== "undefined" ? window.OccupancyGrid : null);
    if (OG && typeof OG.build === "function") {
      const source = {
        map: ctx.map,
        enemies: ctx.enemies,
        npcs: ctx.npcs,
        props: ctx.townProps,
        player: ctx.player,
      };
      const payload = overrides && typeof overrides === "object" ? Object.assign(source, overrides) : source;
      const grid = OG.build(payload);
      ctx.occupancy = grid;
      try {
        if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
          const enemies = Array.isArray(ctx.enemies) ? ctx.enemies.length : 0;
          const npcs = Array.isArray(ctx.npcs) ? ctx.npcs.length : 0;
          const props = Array.isArray(ctx.townProps) ? ctx.townProps.length : 0;
          const w = (grid && grid.width) ? (grid.width | 0) : 0;
          const h = (grid && grid.height) ? (grid.height | 0) : 0;
          window.Logger.log("[Occupancy] Rebuilt", "notice", { category: "Occupancy", enemies, npcs, props, w, h });
        }
      } catch (_) {}
      return grid || null;
    }
  } catch (_) {}
  return null;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("OccupancyFacade", { rebuild });