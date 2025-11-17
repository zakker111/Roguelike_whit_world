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
 *
 * doAction(ctx) overview:
 * - world: attempts to enter town/dungeon/ruins on the current tile if applicable.
 * - town: interacts with props (including inn upstairs overlay), talks to NPCs, and shows shop schedules.
 * - dungeon: guidance and loot underfoot; exiting requires standing on '>' and pressing G.
 * - encounter: exit via STAIRS or loot underfoot, consistent with dungeon behavior.
 */

import { getMod } from "../utils/access.js";

// Helpers
function inBounds(ctx, x, y) {
  // Prefer centralized Bounds utility if available
  try {
    if (typeof window !== "undefined" && window.Bounds && typeof window.Bounds.inBounds === "function") {
      return window.Bounds.inBounds(ctx, x, y);
    }
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

function overlayPropAt(ctx, x, y) {
  try {
    if (ctx.innUpstairsActive && ctx.innUpstairs && Array.isArray(ctx.innUpstairs.props)) {
      return ctx.innUpstairs.props.find(p => p && p.x === x && p.y === y) || null;
    }
  } catch (_) {}
  return null;
}

function describeProp(ctx, p) {
  if (!p) return false;
  // Prefer data-driven interactions via PropsService + props.json
  try {
    const PS = (typeof window !== "undefined" ? window.PropsService : (ctx.PropsService || null));
    if (PS && typeof PS.interact === "function") {
      return !!PS.interact(ctx, p);
    }
  } catch (_) {}
  // Fallback: generic message
  const name = p.name || p.type || "prop";
  try { ctx.log && ctx.log(`You stand on ${name}.`, "info"); } catch (_) {}
  return true;
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
  // Pure HUD/time update; canvas unchanged — orchestrator will coalesce draw if needed
}

// Public API
function isInnStairsTile(ctx, x, y) {
  try {
    const arr = Array.isArray(ctx.innStairsGround) ? ctx.innStairsGround : [];
    if (arr.some(s => s && s.x === x && s.y === y)) return true;
  } catch (_) {}
  // Fallback: treat any STAIRS tile inside the inn building as the portal
  try {
    const b = ctx && ctx.tavern && ctx.tavern.building ? ctx.tavern.building : null;
    if (b) {
      const inside = (x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1);
      if (inside && ctx.map && ctx.map[y] && ctx.map[y][x] === ctx.TILES.STAIRS) return true;
    }
  } catch (_) {}
  return false;
}

export function doAction(ctx) {
  // Hide loot UI if open
  try {
    const UIO = (ctx && ctx.UIOrchestration) || (typeof window !== "undefined" ? window.UIOrchestration : null);
    if (UIO && typeof UIO.hideLoot === "function") UIO.hideLoot(ctx);
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
    try {
      if (ctx.Modes && typeof ctx.Modes.enterRuinsIfOnTile === "function") {
        const okRuins = !!ctx.Modes.enterRuinsIfOnTile(ctx);
        if (okRuins) return true;
      }
    } catch (_) {}
    // Unhandled tile in world: allow fallback movement handlers to proceed
    return false;
  }

  if (ctx.mode === "town") {
    // Inn upstairs overlay: toggle when standing on inn stairs portal tiles (handle before generic prop/shop interactions)
    try {
      if (isInnStairsTile(ctx, ctx.player.x, ctx.player.y)) {
        const now = !!ctx.innUpstairsActive;
        ctx.innUpstairsActive = !now;
        if (ctx.innUpstairsActive) {
          ctx.log && ctx.log("You ascend to the inn's upstairs.", "info");
        } else {
          ctx.log && ctx.log("You return to the inn's hall.", "info");
        }
        // Unified refresh via StateSync (mandatory)
        try {
          const SS = ctx.StateSync || getMod(ctx, "StateSync");
          if (SS && typeof SS.applyAndRefresh === "function") {
            SS.applyAndRefresh(ctx, {});
          }
        } catch (_) {}
        return true;
      }
    } catch (_) {}

    // When upstairs overlay is active, prefer interaction with upstairs props
    try {
      if (ctx.innUpstairsActive) {
        const pUp = overlayPropAt(ctx, ctx.player.x, ctx.player.y);
        if (pUp) {
          // Use PropsService if available; fallback to generic description
          const PS = (typeof window !== "undefined" ? window.PropsService : (ctx.PropsService || null));
          if (PS && typeof PS.interact === "function") {
            PS.interact(ctx, pUp);
          } else {
            describeProp(ctx, pUp);
          }
          // Unified refresh via StateSync (mandatory)
          try {
            const SS = ctx.StateSync || getMod(ctx, "StateSync");
            if (SS && typeof SS.applyAndRefresh === "function") {
              SS.applyAndRefresh(ctx, {});
            }
          } catch (_) {}
          return true;
        }
      }
    } catch (_) {}

    // Prefer Town interactions (props, talk)
    if (ctx.Town && typeof ctx.Town.interactProps === "function") {
      const handled = ctx.Town.interactProps(ctx);
      if (handled) return true;
    }
    // Skip shop interactions inside inn when upstairs overlay is active
    if (!(ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building &&
          ctx.player.x > ctx.tavern.building.x && ctx.player.x < ctx.tavern.building.x + ctx.tavern.building.w - 1 &&
          ctx.player.y > ctx.tavern.building.y && ctx.player.y < ctx.tavern.building.y + ctx.tavern.building.h - 1)) {
      const s = shopAt(ctx, ctx.player.x, ctx.player.y);
      if (s) {
        // Defer to loot which handles shop messaging
        return loot(ctx);
      }
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
    // Upstairs overlay props interaction takes precedence when active
    try {
      if (ctx.innUpstairsActive) {
        const pUp = overlayPropAt(ctx, ctx.player.x, ctx.player.y);
        if (pUp) {
          const PS = (typeof window !== "undefined" ? window.PropsService : (ctx.PropsService || null));
          if (PS && typeof PS.interact === "function") {
            PS.interact(ctx, pUp);
          } else {
            describeProp(ctx, pUp);
          }
          // Pure interaction/log; draw/UI will be requested by effect(s) as needed
          return true;
        }
      }
    } catch (_) {}

    // If standing on a shop door, show schedule and flavor
    // Skip shop interactions inside inn when upstairs overlay is active
    if (!(ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building &&
          ctx.player.x > ctx.tavern.building.x && ctx.player.x < ctx.tavern.building.x + ctx.tavern.building.w - 1 &&
          ctx.player.y > ctx.tavern.building.y && ctx.player.y < ctx.tavern.building.y + ctx.tavern.building.h - 1)) {
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
          // Pure log messaging; no visual change -> no draw
          return true;
        }
        if (openNow) ctx.log(`The ${s.name || "shop"} is open. (Trading coming soon)`, "notice");
        else ctx.log(`The ${s.name || "shop"} is closed.${sched ? " " + sched : ""}`, "warn");
        // Pure schedule/log messaging; no visual change -> no draw
        return true;
      }
    }
    // Prefer props interaction; if not handled, describe underfoot prop explicitly.
    if (ctx.Town && typeof ctx.Town.interactProps === "function") {
      const handled = ctx.Town.interactProps(ctx);
      if (handled) return true;
    }
    const p = propAt(ctx, ctx.player.x, ctx.player.y);
    if (p) {
      describeProp(ctx, p);
      // Pure log; do not force a draw
      return true;
    }
    // If standing on a blood decal, describe it
    if (hasDecalAt(ctx, ctx.player.x, ctx.player.y)) {
      ctx.log("The floor here is stained with blood.", "info");
      // Pure log; do not force a draw
      return true;
    }
    // Nothing to loot in town
    ctx.log("Nothing to do here.");
    return true;
  }

  if (ctx.mode === "world") {
    ctx.log("Nothing to loot here.");
    // Pure log; do not force a draw
    return true;
  }

  // Encounter: exit like Region Map; press G on an exit to leave.
  if (ctx.mode === "encounter") {
    const here = (ctx.map && ctx.map[ctx.player.y] && ctx.map[ctx.player.y][ctx.player.x]);
    if (here === ctx.TILES.STAIRS) {
      try {
        const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
        if (ER && typeof ER.complete === "function") ER.complete(ctx, "withdraw");
      } catch (_) {}
      return true;
    }
    // Otherwise prefer to loot underfoot using Loot subsystem
    try {
      const L = ctx.Loot || (typeof window !== "undefined" ? window.Loot : null);
      if (L && typeof L.lootHere === "function") {
        L.lootHere(ctx);
        return true;
      }
    } catch (_) {}
    // If standing on a blood decal, describe it
    if (hasDecalAt(ctx, ctx.player.x, ctx.player.y)) {
      ctx.log("The ground here is stained with blood.", "info");
      return true;
    }
    ctx.log("Nothing to do here.", "info");
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
      // Pure log; do not force a draw
      return true;
    }
    // Guidance if not handled
    ctx.log("Return to the entrance (the hole '>') and press G to leave.", "info");
    // Pure guidance; do not force a draw
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

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Actions", { doAction, loot, descend });