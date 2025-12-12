/**
 * Town schedules: shared helpers for deciding where NPCs
 * should tend to be (home, work, plaza, inn) based on time of day.
 *
 * This is used by debugging overlays (route paths) and can also
 * be reused by higher-level AI decisions.
 */

import { inWindow, isOpenAt } from "./town_helpers.js";

function currentTargetFor(ctx, n, minutesNow, phaseNow) {
  if (!n) return null;

  // Shopkeepers: work zone near open hours, home outside.
  if (n.isShopkeeper) {
    const shop = n._shopRef || null;
    const o = shop ? shop.openMin : 8 * 60;
    const c = shop ? shop.closeMin : 18 * 60;
    const arriveStart = (o - 60 + 1440) % 1440;
    const leaveEnd = (c + 30) % 1440;
    const shouldBeAtWorkZone = inWindow(arriveStart, leaveEnd, minutesNow, 1440);
    const openNow = isOpenAt(shop, minutesNow, 1440);
    if (shouldBeAtWorkZone) {
      if (openNow && n._workInside && shop && shop.building) {
        return n._workInside;
      } else if (n._work) {
        return n._work;
      }
    } else if (n._home) {
      return n._home.bed ? n._home.bed : { x: n._home.x, y: n._home.y };
    }
    return null;
  }

  // Residents: home evenings, work/plaza days, home in morning/night.
  if (n.isResident) {
    if (phaseNow === "evening") {
      return n._home ? (n._home.bed ? n._home.bed : { x: n._home.x, y: n._home.y }) : null;
    } else if (phaseNow === "day") {
      return n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
    } else if (phaseNow === "morning") {
      return n._home ? { x: n._home.x, y: n._home.y } : null;
    } else {
      return n._home ? { x: n._home.x, y: n._home.y } : null;
    }
  }

  // Others: simple pattern based on phase.
  if (phaseNow === "morning") {
    return n._home ? { x: n._home.x, y: n._home.y } : null;
  } else if (phaseNow === "day") {
    return (n._work || ctx.townPlaza);
  } else {
    return n._home ? { x: n._home.x, y: n._home.y } : null;
  }
}

export { currentTargetFor };