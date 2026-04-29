import { getMod } from "../../../utils/access.js";
import { isGmEnabled } from "./shared.js";
import {
  isBottleMapItem,
  getBottleMapActivateFromItemFn,
  normalizeBottleMapInstanceId,
  reconcileMarkers,
} from "./bottle_map.js";

/**
 * Inventory "use" hook: called from InventoryFlow.useItemByIndex.
 */
export function useInventoryItem(ctx, item, idx) {
  if (!ctx || !item) return false;
  if (!isBottleMapItem(item)) return false;

  if (!isGmEnabled(ctx)) return false;

  if (ctx.mode !== "world") {
    try { if (typeof ctx.log === "function") ctx.log("The map can only be used in the overworld.", "warn"); } catch (_) {}
    return true;
  }

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS) {
    try { if (typeof ctx.log === "function") ctx.log("Nothing happens.", "warn"); } catch (_) {}
    return true;
  }

  const activateFn = getBottleMapActivateFromItemFn(GM);

  if (!activateFn) {
    try { if (typeof ctx.log === "function") ctx.log("[GM] Bottle Map runtime not available; cannot activate.", "warn"); } catch (_) {}
    return true;
  }

  // Consume the item.
  // Defensive: InventoryFlow should pass a valid idx, but avoid (idx|0) pitfalls
  // (e.g. undefined|0 === 0) which could delete the wrong inventory slot.
  let consumed = false;
  try {
    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);

    let i = -1;
    if (typeof idx === "number" && Number.isFinite(idx)) i = (idx | 0);

    // Prefer strict identity match to avoid consuming the wrong item.
    if (i < 0 || i >= inv.length || inv[i] !== item) {
      const byRef = inv.indexOf(item);
      if (byRef >= 0) i = byRef;
    }

    // If the resolved index isn't a bottle map, abort.
    if (i >= 0 && i < inv.length && inv[i] && !isBottleMapItem(inv[i])) i = -1;

    if (i < 0 || i >= inv.length) {
      try { if (typeof ctx.log === "function") ctx.log("The Bottle Map slips from your fingers. Nothing happens.", "warn"); } catch (_) {}
      return true;
    }

    inv.splice(i, 1);
    consumed = true;
  } catch (_) {
    return true;
  }

  // Safety: never start a Bottle Map thread if we failed to consume the map.
  if (!consumed) return true;

  let res = null;
  try { res = activateFn(ctx) || null; } catch (_) { res = null; }

  const ok = !!(res && (res.ok === true || res.activated === true || res.success === true));

  if (!ok) {
    const refund = res && (res.refundItem || res.refund || res.refundSpec || res.refundItemSpec || null);

    // Default to refunding the consumed map unless the runtime explicitly provides `refundItem: null`.
    let shouldRefund = true;
    try {
      if (res && Object.prototype.hasOwnProperty.call(res, "refundItem") && res.refundItem == null) shouldRefund = false;
    } catch (_) {}

    if (shouldRefund) {
      try {
        const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
        inv.push(refund || item);
      } catch (_) {}
    }

    const reason = res && res.reason != null ? String(res.reason) : "activateFailed";

    if (reason === "alreadyActive" || reason === "already_active") {
      try { if (typeof ctx.log === "function") ctx.log("The Bottle Map already points to a location.", "info"); } catch (_) {}
    } else {
      try { if (typeof ctx.log === "function") ctx.log("The Bottle Map's ink runs and becomes unreadable.", "warn"); } catch (_) {}
    }

    // Preserve legacy telemetry when activation fails due to target placement.
    if (reason === "targetPlacementFailed" || reason === "targetPlacement" || reason === "noTarget") {
      try { GM.onEvent(ctx, { type: "gm.bottleMap.expired", interesting: false, payload: { reason: "targetPlacementFailed" } }); } catch (_) {}
    }

    try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    return true;
  }

  const markerSpec = res && (res.markerSpec || res.marker || res.markerToAdd || res.markerSpecToAdd || null);
  let instanceId = normalizeBottleMapInstanceId(res && (res.instanceId || res.activeInstanceId || res.threadInstanceId));

  if (markerSpec) {
    try { MS.add(ctx, markerSpec); } catch (_) {}
    if (!instanceId) instanceId = normalizeBottleMapInstanceId(markerSpec.instanceId);
  }

  // Remove stale/mismatched markers as directed by GMRuntime.
  try { reconcileMarkers(ctx); } catch (_) {}

  if (instanceId) {
    try { GM.onEvent(ctx, { type: "gm.bottleMap.activated", interesting: true, payload: { instanceId } }); } catch (_) {}
  }

  try { if (typeof ctx.log === "function") ctx.log("You study the Bottle Map. An X appears on your world map.", "notice"); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}

  return true;
}
