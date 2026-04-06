/**
 * Overworld roads and bridges overlays.
 *
 * Bridges feature has been retired in favor of SHALLOW fords.
 * Infinite/world generation and runtime helpers now rely on SHALLOW tiles
 * (walkable shallow water) as the only representation for river crossings,
 * so this renderer intentionally does nothing.
 */

// Kept as a no-op to avoid dangling imports; callers may still invoke drawBridges(ctx, view).
export function drawBridges(ctx, view) {
  void ctx; void view;
}