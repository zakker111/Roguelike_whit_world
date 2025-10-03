/**
 * TownHelpers: town-related utilities extracted from game.js.
 *
 * API (globals on window.TownHelpers):
 *  - talkNearbyNPC(ctx) -> boolean
 *  - shopAt(ctx, x, y) -> shop|null
 *  - isShopOpenNow(ctx, shop?) -> boolean
 *  - shopScheduleStr(ctx, shop) -> string
 *  - ensureTownSpawnClear(ctx)
 *  - spawnGateGreeters(ctx, count=4)
 *  - isFreeTownFloor(ctx, x, y) -> boolean
 *  - manhattan(ctx, ax, ay, bx, by) -> number
 *  - clearAdjacentNPCsAroundPlayer(ctx)
 *  - interactTownProps(ctx) -> boolean
 */
(function () {
  function talkNearbyNPC(ctx) {
    if (ctx.mode !== "town") return false;
    const targets = [];
    for (const n of (ctx.npcs || [])) {
      const d = Math.abs(n.x - ctx.player.x) + Math.abs(n.y - ctx.player.y);
      if (d <= 1) targets.push(n);
    }
    if (targets.length === 0) {
      if (ctx.log) ctx.log("There is no one to talk to here.");
      return false;
    }
    const npc = targets[Math.floor(ctx.rng() * targets.length)];
    const line = npc.lines[Math.floor(ctx.rng() * npc.lines.length)];
    if (ctx.log) ctx.log(`${npc.name}: ${line}`, "info");
    if (ctx.requestDraw) ctx.requestDraw();
    return true;
  }

  function shopAt(ctx, x, y) {
    if (!Array.isArray(ctx.shops)) return null;
    return ctx.shops.find(s => s.x === x && s.y === y) || null;
  }

  function minutesOfDay(h, m = 0) { return ((h | 0) * 60 + (m | 0)) % (24 * 60); }

  function isOpenAt(shop, minutes) {
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    const o = shop.openMin, c = shop.closeMin;
    if (o === c) {
      return false;
    }
    if (c > o) return minutes >= o && minutes < c;
    return minutes >= o || minutes < c;
  }

  function isShopOpenNow(ctx, shop = null) {
    const t = (typeof ctx.getClock === "function") ? ctx.getClock() : (ctx.time || { hours: 12, minutes: 0, phase: "day" });
    const minutes = t.hours * 60 + t.minutes;
    if (!shop) {
      return t.phase === "day";
    }
    return isOpenAt(shop, minutes);
  }

  function shopScheduleStr(ctx, shop) {
    if (!shop) return "";
    const h2 = (min) => {
      const hh = ((min / 60) | 0) % 24;
      return String(hh).padStart(2, "0");
    };
    return `Opens ${h2(shop.openMin)}:00, closes ${h2(shop.closeMin)}:00`;
  }

  function ensureTownSpawnClear(ctx) {
    const Tn = ctx.Town || window.Town;
    if (Tn && typeof Tn.ensureSpawnClear === "function") {
      Tn.ensureSpawnClear(ctx);
      return;
    }
    if (ctx.log) ctx.log("Town.ensureSpawnClear not available.", "warn");
  }

  function spawnGateGreeters(ctx, count = 4) {
    const Tn = ctx.Town || window.Town;
    if (Tn && typeof Tn.spawnGateGreeters === "function") {
      Tn.spawnGateGreeters(ctx, count);
      return;
    }
    if (ctx.log) ctx.log("Town.spawnGateGreeters not available.", "warn");
  }

  function isFreeTownFloor(ctx, x, y) {
    const Utils = ctx.Utils || window.Utils;
    if (Utils && typeof Utils.isFreeTownFloor === "function") {
      return Utils.isFreeTownFloor(ctx, x, y);
    }
    if (!ctx.inBounds(x, y)) return false;
    if (ctx.map[y][x] !== ctx.TILES.FLOOR && ctx.map[y][x] !== ctx.TILES.DOOR) return false;
    if (x === ctx.player.x && y === ctx.player.y) return false;
    if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === x && n.y === y)) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  function manhattan(ctx, ax, ay, bx, by) {
    const Utils = ctx.Utils || window.Utils;
    if (Utils && typeof Utils.manhattan === "function") {
      return Utils.manhattan(ax, ay, bx, by);
    }
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  function clearAdjacentNPCsAroundPlayer(ctx) {
    const neighbors = [
      { x: ctx.player.x + 1, y: ctx.player.y },
      { x: ctx.player.x - 1, y: ctx.player.y },
      { x: ctx.player.x, y: ctx.player.y + 1 },
      { x: ctx.player.x, y: ctx.player.y - 1 },
    ];
    for (const pos of neighbors) {
      const idx = (ctx.npcs || []).findIndex(n => n.x === pos.x && n.y === pos.y);
      if (idx !== -1) {
        ctx.npcs.splice(idx, 1);
      }
    }
  }

  function interactTownProps(ctx) {
    const Town = ctx.Town || window.Town;
    if (Town && typeof Town.interactProps === "function") {
      return !!Town.interactProps(ctx);
    }
    return false;
  }

  window.TownHelpers = {
    talkNearbyNPC,
    shopAt,
    isShopOpenNow,
    shopScheduleStr,
    ensureTownSpawnClear,
    spawnGateGreeters,
    isFreeTownFloor,
    manhattan,
    clearAdjacentNPCsAroundPlayer,
    interactTownProps,
  };
})();