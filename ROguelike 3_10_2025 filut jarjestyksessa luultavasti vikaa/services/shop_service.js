/**
 * ShopService: centralized helpers for shop schedules and queries.
 *
 * Exports (window.ShopService):
 * - minutesOfDay(h, m=0, dayMinutes=1440)
 * - isOpenAt(shop, minutes)
 * - isShopOpenNow(ctx, shop=null)  // uses ctx.time
 * - shopScheduleStr(shop)
 * - shopAt(ctx, x, y)
 */
(function () {
  function minutesOfDay(h, m, dayMinutes) {
    var DAY = (typeof dayMinutes === "number" && isFinite(dayMinutes)) ? dayMinutes : 24 * 60;
    var hh = (h | 0), mm = (m | 0);
    var v = (hh * 60 + mm) % DAY;
    if (v < 0) v += DAY;
    return v;
  }

  function isOpenAt(shop, minutes) {
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    var o = shop.openMin | 0, c = shop.closeMin | 0;
    if (o === c) return false; // treat as closed all day
    return (c > o) ? (minutes >= o && minutes < c) : (minutes >= o || minutes < c);
  }

  function isShopOpenNow(ctx, shop) {
    try {
      var t = ctx && ctx.time ? ctx.time : null;
      var minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
      if (!shop) {
        return !!(t && t.phase === "day");
      }
      return isOpenAt(shop, minutes);
    } catch (_) {
      return false;
    }
  }

  function shopScheduleStr(shop) {
    if (!shop) return "";
    var h2 = function (min) {
      var hh = ((min / 60) | 0) % 24;
      return String(hh).padStart(2, "0");
    };
    return "Opens " + h2(shop.openMin) + ":00, closes " + h2(shop.closeMin) + ":00";
  }

  function shopAt(ctx, x, y) {
    var list = Array.isArray(ctx && ctx.shops) ? ctx.shops : [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s && s.x === x && s.y === y) return s;
    }
    return null;
  }

  window.ShopService = {
    minutesOfDay: minutesOfDay,
    isOpenAt: isOpenAt,
    isShopOpenNow: isShopOpenNow,
    shopScheduleStr: shopScheduleStr,
    shopAt: shopAt
  };
})();