/**
 * Actions: context-sensitive actions (interact/loot/descend) orchestrated via ctx.
 *
 * API:
 *   Actions.doAction(ctx) -> handled:boolean
 *   Actions.loot(ctx) -> handled:boolean
 *   Actions.descend(ctx) -> handled:boolean
 *
 * Notes:
 * - Uses only ctx and other modules (UI, Loot, DungeonState, Town, World).
 * - Mutates ctx where appropriate (mode transitions, logging, UI).
 */

// Helpers
function inBounds(ctx, x, y) {
  try {
    if (ctx.Utils && typeof ctx.Utils.inBounds === "function") return ctx.Utils.inBounds(ctx, x, y);
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.inBounds === "function") return window.Utils.inBounds(ctx, x, y);
  } catch (_) {}
  const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function shopAt(ctx, x, y) {
  try {
    if (ctx.ShopService && typeof ctx.ShopService.shopAt === "function") {
      return ctx.ShopService.shopAt(ctx, x, y);
    }
  } catch (_) {}
  const shops = Array.isArray(ctx.shops) ? ctx.shops : [];
  return shops.find(s => s.x === x && s.y === y) || null;
}

function hasDecalAt(ctx, x, y) {
  const list = Array.isArray(ctx.decals) ? ctx.decals : [];
  return list.some(d => d && d.x === x && d.y === y && typeof d.a === "number" && d.a > 0.02);
}

function propAt(ctx, x, y) {
  const props = Array.isArray(ctx.townProps) ? ctx.townProps : [];
  return props.find(p => p && p.x === x && p.y === y) || null;
}

function describeProp(ctx, p) {
  if (!p) return false;
  const name = p.name || p.type || "prop";
  switch (p.type) {
    case "bed":
      ctx.log("You stand on a mattress.", "info"); return true;
    case "barrel":
      ctx.log("You stand next to a barrel.", "info"); return true;
    case "crate":
      ctx.log("You stand next to a crate.", "info"); return true;
    case "chest":
      ctx.log("You stand next to a chest.", "info"); return true;
    case "table":
      ctx.log("You stand next to a table.", "info"); return true;
    case "chair":
      ctx.log("You stand next to a chair.", "info"); return true;
    case "fireplace":
      ctx.log("You stand by a fireplace.", "info"); return true;
    case "rug":
      ctx.log("You stand on a rug.", "info"); return true;
    case "plant":
      ctx.log("You stand next to a potted plant.", "info"); return true;
    case "lamp":
      ctx.log("You stand by a lamp post.", "info"); return true;
    case "stall":
      ctx.log("You stand beside a market stall.", "info"); return true;
    case "well":
      ctx.log("You stand beside the town well.", "info"); return true;
    case "fountain":
      ctx.log("You stand near a fountain.", "info"); return true;
    case "shelf":
      ctx.log("You stand next to a shelf.", "info"); return true;
    case "sign": {
      // If this sign is next to a shop, show its schedule; else show name
      const near = [
        { x: p.x, y: p.y },
        { x: p.x + 1, y: p.y },
        { x: p.x - 1, y: p.y },
        { x: p.x, y: p.y + 1 },
        { x: p.x, y: p.y - 1 },
      ];
      let shop = null;
      for (const c of near) {
        const s = shopAt(ctx, c.x, c.y);
        if (s) { shop = s; break; }
      }
      if (shop) {
        const openNow = isShopOpenNow(ctx, shop);
        const sched = shopScheduleStr(ctx, shop);
        ctx.log(`Sign: ${(p.name || "Sign")}. ${sched} — ${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
      } else {
        ctx.log(`Sign: ${(p.name || "Sign")}`, "info");
      }
      return true;
    }
    default:
      ctx.log(`You stand on ${name}.`, "info"); return true;
  }
}

// Shop schedule helpers (centralized via ShopService)
function isOpenAtShop(ctx, shop, minutes) {
  if (ctx.ShopService && typeof ctx.ShopService.isOpenAt === "function") return ctx.ShopService.isOpenAt(shop, minutes);
  // Minimal fallback: unknown schedule => treat as closed unless explicitly alwaysOpen
  if (!shop) return false;
  return !!shop.alwaysOpen;
}
function isShopOpenNow(ctx, shop) {
  if (ctx.ShopService && typeof ctx.ShopService.isShopOpenNow === "function") return ctx.ShopService.isShopOpenNow(ctx, shop);
  const t = ctx.time;
  const minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
  if (!shop) return false;
  return isOpenAtShop(ctx, shop, minutes);
}
function shopScheduleStr(ctx, shop) {
  if (ctx.ShopService && typeof ctx.ShopService.shopScheduleStr === "function") return ctx.ShopService.shopScheduleStr(shop);
  return "";
}

// Inn rest helpers
function restAtInn(ctx) {
  // Advance to 06:00 and fully heal
  try {
    const TSM = ctx.TimeService;
    if (TSM && typeof TSM.create === "function") {
      const TS = TSM.create({ dayMinutes: 24 * 60, cycleTurns: 360 });
      const clock = ctx.time;
      const curMin = clock ? (clock.hours * 60 + clock.minutes) : 0;
      const goalMin = 6 * 60;
      let delta = goalMin - curMin; if (delta <= 0) delta += 24 * 60;
      if (typeof ctx.advanceTimeMinutes === "function") {
        ctx.advanceTimeMinutes(delta);
      }
    }
  } catch (_) {}
  const prev = ctx.player.hp;
  ctx.player.hp = ctx.player.maxHp;
  ctx.log(`You spend the night at the inn. You wake up fully rested at ${(ctx.time && ctx.time.hhmm) || "06:00"}.`, "good");
  if (typeof ctx.updateUI === "function") ctx.updateUI();
  ctx.requestDraw();
}

// Public API
export function doAction(ctx) {
  // Hide loot UI if open
  try {
    const UB = ctx && ctx.UIBridge;
    if (UB && typeof UB.hideLoot === "function") UB.hideLoot(ctx);
  } catch (_) {}

  if (ctx.mode === "world") {
    // Delegate world entry actions to Modes to avoid duplication
    try {
      if (ctx.Modes && typeof ctx.Modes.enterTownIfOnTile === "function") {
        const okTown = !!ctx.Modes.enterTownIfOnTile(ctx);
        if (okTown) return true;
      }
    } catch (_) {}
    try {
      if (ctx.Modes && typeof ctx.Modes.enterDungeonIfOnEntrance === "function") {
        const okDun = !!ctx.Modes.enterDungeonIfOnEntrance(ctx);
        if (okDun) return true;
      }
    } catch (_) {}
    // Unhandled tile in world: allow fallback movement handlers to proceed
    return false;
  }

  if (ctx.mode === "town") {
    // Prefer Town interactions (props, talk)
    if (ctx.Town && typeof ctx.Town.interactProps === "function") {
      const handled = ctx.Town.interactProps(ctx);
      if (handled) return true;
    }
    const s = shopAt(ctx, ctx.player.x, ctx.player.y);
    if (s) {
      // Defer to loot which handles shop messaging
      return loot(ctx);
    }
    // Nothing else: allow fallback
    return false;
  }

  if (ctx.mode === "dungeon") {
    // Try loot (includes return-to-world on exit)
    const handled = loot(ctx);
    if (handled) return true;
    // Otherwise allow fallback
    return false;
  }

  // Default: let fallback handle
  return false;
}

export function loot(ctx) {
  if (ctx.mode === "town") {
    // If standing on a shop door, show schedule and flavor
    const s = shopAt(ctx, ctx.player.x, ctx.player.y);
    if (s) {
      const openNow = isShopOpenNow(ctx, s);
      const sched = shopScheduleStr(ctx, s);
      const schedPart = sched ? `${sched}. ` : "";
      const nameLower = (s.name || "").toLowerCase();
      if (nameLower === "inn") {
        ctx.log(`Inn: ${schedPart}${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
        ctx.log("You enter the inn.", "notice");
        // Inns provide resting; allow rest regardless
        restAtInn(ctx);
        return true;
      }
      if (nameLower === "tavern") {
        ctx.log(`Tavern: ${schedPart}${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
        const phase = (ctx.time && ctx.time.phase) || "day";
        if (phase === "night" || phase === "dusk") ctx.log("You step into the tavern. It's lively inside.", "notice");
        else if (phase === "day") ctx.log("You enter the tavern. A few patrons sit quietly.", "info");
        else ctx.log("You enter the tavern.", "info");
        ctx.requestDraw();
        return true;
      }
      if (openNow) ctx.log(`The ${s.name || "shop"} is open. (Trading coming soon)`, "notice");
      else ctx.log(`The ${s.name || "shop"} is closed.${sched ? " " + sched : ""}`, "warn");
      ctx.requestDraw();
      return true;
    }
    // Prefer props interaction; if not handled, describe underfoot prop explicitly.
    if (ctx.Town && typeof ctx.Town.interactProps === "function") {
      const handled = ctx.Town.interactProps(ctx);
      if (handled) return true;
    }
    const p = propAt(ctx, ctx.player.x, ctx.player.y);
    if (p) {
      describeProp(ctx, p);
      ctx.requestDraw();
      return true;
    }
    // If standing on a blood decal, describe it
    if (hasDecalAt(ctx, ctx.player.x, ctx.player.y)) {
      ctx.log("The floor here is stained with blood.", "info");
      ctx.requestDraw();
      return true;
    }
    // Nothing to loot in town
    ctx.log("Nothing to do here.");
    return true;
  }

  if (ctx.mode === "world") {
    ctx.log("Nothing to loot here.");
    return true;
  }

  if (ctx.mode === "dungeon") {
    // Prefer centralized return flow
    try {
      if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.returnToWorldIfAtExit === "function") {
        const ok = ctx.DungeonRuntime.returnToWorldIfAtExit(ctx);
        if (ok) return true;
      }
    } catch (_) {}

    // Delegate to Loot.lootHere if available
    try {
      if (ctx.DungeonRuntime && typeof ctx.DungeonRuntime.lootHere === "function") {
        ctx.DungeonRuntime.lootHere(ctx);
        return true;
      }
    } catch (_) {}
    if (ctx.Loot && typeof ctx.Loot.lootHere === "function") {
      ctx.Loot.lootHere(ctx);
      return true;
    }

    // If standing on a blood decal, describe it
    if (hasDecalAt(ctx, ctx.player.x, ctx.player.y)) {
      ctx.log("The floor here is stained with blood.", "info");
      ctx.requestDraw();
      return true;
    }
    // Guidance if not handled
    ctx.log("Return to the entrance (the hole '>') and press G to leave.", "info");
    return true;
  }

  return false;
}

export function descend(ctx) {
  if (ctx.mode === "world" || ctx.mode === "town") {
    // Reuse action to enter town/dungeon if on appropriate tile
    return doAction(ctx);
  }
  if (ctx.mode === "dungeon") {
    ctx.log("This dungeon has no deeper levels. Return to the entrance (the hole '>') and press G to leave.", "info");
    return true;
  }
  const here = ctx.map[ctx.player.y][ctx.player.x];
  if (here === ctx.TILES.STAIRS) {
    ctx.log("There is nowhere to go down from here.", "info");
  } else {
    ctx.log("You need to stand on the staircase (brown tile marked with '>').", "info");
  }
  return true;
}

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.Actions = { doAction, loot, descend };
}