/**
 * Overworld roads and bridges overlays.
 */
import { getTileDefByKey } from "../../data/tile_lookup.js";



export function drawBridges(ctx, view) {
  // Bridges have been retired in favor of SHALLOW fords.
  // Infinite/world generation and runtime helpers now rely on SHALLOW tiles
  // (walkable shallow water) as the only representation for river crossings,
  // so we no longer draw separate bridge overlays on top of them.
}