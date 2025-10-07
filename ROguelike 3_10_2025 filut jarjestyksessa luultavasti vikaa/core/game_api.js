/**
 * GameAPI: extracted public API for smoke tests and diagnostics.
 * Uses window.__getGameCtx() to query live state and helper methods.
 */
(function () {
  function ctx() { return (typeof window.__getGameCtx === "function") ? window.__getGameCtx() : null; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function isWalkableOverworld(x, y) {
    var c = ctx();
    if (!c || !c.world || !c.world.map) return false;
    var t = c.world.map[y] && c.world.map[y][x];
    try { return (typeof window.World === "object" && typeof window.World.isWalkable === "function") ? window.World.isWalkable(t) : true; } catch (_) { return true; }
  }

  function nearestCoord(list, sx, sy) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var dd = Math.abs(e.x - sx) + Math.abs(e.y - sy);
      if (dd < bestD) { bestD = dd; best = { x: e.x, y: e.y }; }
    }
    return best;
  }

  function routeBFS(gridWidth, gridHeight, walkableFn, start, target) {
    var q = [start];
    var prev = new Map();
    var seen = new Set([start.x + "," + start.y]);
    var dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    while (q.length) {
      var cur = q.shift();
      if (cur.x === target.x && cur.y === target.y) break;
      for (var i = 0; i < dirs.length; i++) {
        var d = dirs[i];
        var nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        var key = nx + "," + ny;
        if (seen.has(key)) continue;
        if (!walkableFn(nx, ny)) continue;
        seen.add(key);
        prev.set(key, cur);
        q.push({ x: nx, y: ny });
      }
    }
    var path = [];
    var curKey = target.x + "," + target.y;
    if (!prev.has(curKey) && !(start.x === target.x && start.y === target.y)) return [];
    var cur = { x: target.x, y: target.y };
    while (!(cur.x === start.x && cur.y === start.y)) {
      path.push(cur);
      var p = prev.get(cur.x + "," + cur.y);
      if (!p) break;
      cur = p;
    }
    path.reverse();
    return path;
  }

  function routeOverworld(tx, ty) {
    var c = ctx();
    if (!c || !c.world || !c.world.map) return [];
    var w = c.world.width, h = c.world.height;
    var start = { x: c.player.x, y: c.player.y };
    var target = { x: tx, y: ty };
    return routeBFS(w, h, isWalkableOverworld, start, target);
  }

  function routeDungeon(tx, ty) {
    var c = ctx();
    if (!c || !c.map) return [];
    var w = c.map[0] ? c.map[0].length : 0;
    var h = c.map.length;
    var start = { x: c.player.x, y: c.player.y };
    var target = { x: tx, y: ty };
    var walkableFn = function (x, y) {
      try { return (typeof c.isWalkable === "function") ? c.isWalkable(x, y) : true; } catch (_) { return true; }
    };
    return routeBFS(w, h, walkableFn, start, target);
  }

  function gotoByRoute(path, stepDelayMs) {
    return new Promise(function (resolve) {
      var i = 0;
      function step() {
        try {
          var c = ctx();
          if (!c) return resolve(false);
          if (i >= path.length) return resolve(true);
          var s = path[i++];
          var dx = Math.sign(s.x - c.player.x);
          var dy = Math.sign(s.y - c.player.y);
          if (typeof window.GameAPI !== "undefined" && typeof window.GameAPI.moveStep === "function") {
            window.GameAPI.moveStep(dx, dy);
          } else {
            try { c.player.x += dx; c.player.y += dy; c.updateCamera(); c.turn(); } catch (_) {}
          }
          setTimeout(step, clamp(stepDelayMs || 60, 20, 400));
        } catch (_) { resolve(false); }
      }
      step();
    });
  }

  window.GameAPI = {
    getMode: function () { var c = ctx(); return c ? c.mode : ""; },
    getWorld: function () { var c = ctx(); return c ? c.world : null; },
    getPlayer: function () { var c = ctx(); return c ? { x: c.player.x, y: c.player.y } : { x: 0, y: 0 }; },
    moveStep: function (dx, dy) { try { var c = ctx(); if (!c) return; if (typeof window.Input === "object" && typeof window.Input.onMove === "function") { window.Input.onMove(dx, dy); } else { c.player.x += dx; c.player.y += dy; c.updateCamera(); c.turn(); } } catch (_) {} },

    isWalkableOverworld: isWalkableOverworld,

    nearestDungeon: function () {
      var c = ctx();
      if (!c || !c.world || !Array.isArray(c.world.dungeons)) return null;
      return nearestCoord(c.world.dungeons, c.player.x, c.player.y);
    },
    nearestTown: function () {
      var c = ctx();
      if (!c || !c.world || !Array.isArray(c.world.towns)) return null;
      return nearestCoord(c.world.towns, c.player.x, c.player.y);
    },

    routeTo: routeOverworld,
    gotoNearestDungeon: async function () {
      var t = this.nearestDungeon();
      if (!t) return true;
      var path = this.routeTo(t.x, t.y);
      if (!path || !path.length) return false;
      return await gotoByRoute(path, 60);
    },
    gotoNearestTown: async function () {
      var t = this.nearestTown();
      if (!t) return true;
      var path = this.routeTo(t.x, t.y);
      if (!path || !path.length) return false;
      return await gotoByRoute(path, 60);
    },

    enterTownIfOnTile: function () {
      try { if (window.Modes && typeof window.Modes.enterTownIfOnTile === "function") { return !!window.Modes.enterTownIfOnTile(ctx()); } } catch (_) {}
      return false;
    },

    // Map data
    getEnemies: function () {
      var c = ctx();
      var es = c && c.enemies ? c.enemies : [];
      return es.map(function (e) { return { x: e.x, y: e.y, hp: e.hp, type: e.type, immobileTurns: e.immobileTurns || 0, bleedTurns: e.bleedTurns || 0 }; });
    },
    getNPCs: function () {
      var c = ctx();
      var ns = c && c.npcs ? c.npcs : [];
      return ns.map(function (n, i) { return { i: i, x: n.x, y: n.y, name: n.name }; });
    },
    getTownProps: function () {
      var c = ctx();
      var ps = c && c.townProps ? c.townProps : [];
      return ps.map(function (p) { return { x: p.x, y: p.y, type: p.type || "" }; });
    },
    getDungeonExit: function () {
      var c = ctx();
      return (c && c.dungeonExitAt) ? { x: c.dungeonExitAt.x, y: c.dungeonExitAt.y } : null;
    },
    getCorpses: function () {
      var c = ctx(); var cs = c && c.corpses ? c.corpses : [];
      return cs.map(function (c0) { return { kind: c0.kind || "corpse", x: c0.x, y: c0.y, looted: !!c0.looted, lootCount: Array.isArray(c0.loot) ? c0.loot.length : 0 }; });
    },
    getChestsDetailed: function () {
      var c = ctx(); var cs = c && c.corpses ? c.corpses : []; var list = [];
      for (var i = 0; i < cs.length; i++) {
        var c0 = cs[i];
        if (c0 && c0.kind === "chest") {
          var items = Array.isArray(c0.loot) ? c0.loot : [];
          var names = items.map(function (it) {
            if (!it) return "(null)";
            if (it.name) return it.name;
            if (it.kind === "equip") {
              var stats = [];
              if (typeof it.atk === "number") stats.push("+" + it.atk + " atk");
              if (typeof it.def === "number") stats.push("+" + it.def + " def");
              return (it.slot || "equip") + (stats.length ? " (" + stats.join(", ") + ")" : "");
            }
            if (it.kind === "potion") return it.name || "potion";
            return it.kind || "item";
          });
          list.push({ x: c0.x, y: c0.y, items: names });
        }
      }
      return list;
    },

    // Inventory/equipment
    getInventory: function () {
      var c = ctx(); var inv = c && c.player && Array.isArray(c.player.inventory) ? c.player.inventory : [];
      return inv.map(function (it, i) { return { i: i, kind: it.kind, slot: it.slot, name: it.name, atk: it.atk, def: it.def, decay: it.decay, count: it.count, twoHanded: !!it.twoHanded }; });
    },
    getEquipment: function () {
      var c = ctx(); var eq = c && c.player && c.player.equipment ? c.player.equipment : {};
      function info(it) { return it ? { name: it.name, slot: it.slot, atk: it.atk, def: it.def, decay: it.decay, twoHanded: !!it.twoHanded } : null; }
      return { left: info(eq.left), right: info(eq.right), head: info(eq.head), torso: info(eq.torso), legs: info(eq.legs), hands: info(eq.hands) };
    },
    getStats: function () {
      var c = ctx(); try { return { atk: c.getPlayerAttack(), def: c.getPlayerDefense(), hp: c.player.hp, maxHp: c.player.maxHp, level: c.player.level }; } catch (_) { return { atk: 0, def: 0, hp: c.player.hp, maxHp: c.player.maxHp, level: c.player.level }; }
    },
    equipItemAtIndex: function (idx) { try { var c = ctx(); c && typeof c.equipItemByIndex === "function" ? c.equipItemByIndex(idx | 0) : null; return true; } catch (_) { return false; } },
    equipItemAtIndexHand: function (idx, hand) { try { var c = ctx(); c && typeof c.equipItemByIndexHand === "function" ? c.equipItemByIndexHand(idx | 0, String(hand || "left")) : null; return true; } catch (_) { return false; } },
    unequipSlot: function (slot) { try { var c = ctx(); c && typeof c.unequipSlot === "function" ? c.unequipSlot(String(slot)) : null; return true; } catch (_) { return false; } },

    // Potions
    getPotions: function () {
      var c = ctx(); var inv = c && c.player && Array.isArray(c.player.inventory) ? c.player.inventory : [];
      var out = [];
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i];
        if (it && it.kind === "potion") { out.push({ i: i, heal: it.heal, count: it.count, name: it.name }); }
      }
      return out;
    },
    drinkPotionAtIndex: function (idx) { try { var c = ctx(); c && typeof c.drinkPotionByIndex === "function" ? c.drinkPotionByIndex(idx | 0) : null; return true; } catch (_) { return false; } },

    // Currency
    getGold: function () {
      try { var c = ctx(); var g = c.player.inventory.find(function (i) { return i && i.kind === "gold"; }); return g && typeof g.amount === "number" ? g.amount : 0; } catch (_) { return 0; }
    },
    addGold: function (amt) {
      try { var c = ctx(); var amount = Number(amt) || 0; if (amount <= 0) return false;
        var g = c.player.inventory.find(function (i) { return i && i.kind === "gold"; });
        if (!g) { g = { kind: "gold", amount: 0, name: "gold" }; c.player.inventory.push(g); }
        g.amount += amount; c.updateUI(); c.renderInventory(); return true;
      } catch (_) { return false; }
    },
    removeGold: function (amt) {
      try { var c = ctx(); var amount = Number(amt) || 0; if (amount <= 0) return true;
        var g = c.player.inventory.find(function (i) { return i && i.kind === "gold"; });
        if (!g) return false; g.amount = Math.max(0, (g.amount | 0) - amount); c.updateUI(); c.renderInventory(); return true;
      } catch (_) { return false; }
    },

    // Town buildings/props
    getNPCHomeByIndex: function (idx) {
      try {
        var c = ctx(); var ns = c.npcs || []; if (idx < 0 || idx >= ns.length) return null;
        var n = ns[idx]; var b = n && n._home && n._home.building ? n._home.building : null; if (!b) return null;
        var props = (Array.isArray(c.townProps) ? c.townProps.filter(function (p) { return (p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1); }) : [])
          .map(function (p) { return { x: p.x, y: p.y, type: p.type || "" }; });
        return { building: { x: b.x, y: b.y, w: b.w, h: b.h, door: b.door ? { x: b.door.x, y: b.door.y } : null }, props: props };
      } catch (_) { return null; }
    },

    equipBestFromInventory: function () {
      var c = ctx(); var equipped = []; var inv = Array.isArray(c.player.inventory) ? c.player.inventory.slice(0) : [];
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i];
        if (it && it.kind === "equip") {
          try {
            if (c.equipIfBetter && c.equipIfBetter(it)) {
              var idx = c.player.inventory.indexOf(it);
              if (idx !== -1) c.player.inventory.splice(idx, 1);
              equipped.push(it.name || "equip");
            }
          } catch (_) {}
        }
      }
      return equipped;
    },

    // Shops/time/perf
    getShops: function () {
      var c = ctx(); var ss = c && c.shops ? c.shops : [];
      return ss.map(function (s) { return { x: s.x, y: s.y, name: s.name || "", alwaysOpen: !!s.alwaysOpen, openMin: s.openMin, closeMin: s.closeMin }; });
    },
    isShopOpenNowFor: function (shop) { try { var c = ctx(); return !!(typeof window.ShopService === "object" && typeof window.ShopService.isShopOpenNow === "function" ? window.ShopService.isShopOpenNow(c, shop || null) : false); } catch (_) { return false; } },
    getShopSchedule: function (shop) { try { return (typeof window.ShopService === "object" && typeof window.ShopService.shopScheduleStr === "function") ? window.ShopService.shopScheduleStr(shop) : ""; } catch (_) { return ""; } },

    checkHomeRoutes: function () { try { return (typeof window.TownAI === "object" && typeof window.TownAI.checkHomeRoutes === "function") ? window.TownAI.checkHomeRoutes(ctx()) || null : null; } catch (_) { return null; } },
    getClock: function () { var c = ctx(); return c ? c.time : { hhmm: "00:00", hours: 0, minutes: 0, phase: "day" }; },
    advanceMinutes: function (mins) { try { var c = ctx(); if (!c) return false; var v = (Number(mins) || 0) | 0; var before = c.time; if (typeof window.TimeService === "object" && typeof window.TimeService.advanceMinutes === "function") { var tc = c.time.turnCounter || 0; var tc2 = window.TimeService.advanceMinutes(tc, v); } c.updateUI(); c.requestDraw(); return true; } catch (_) { return false; } },
    restUntilMorning: function () { try { var c = ctx(); if (typeof c.restUntilMorning === "function") c.restUntilMorning(); } catch (_) {} },
    restAtInn: function () { try { var c = ctx(); if (typeof c.restAtInn === "function") c.restAtInn(); } catch (_) {} },
    getPerf: function () { try { var c = ctx(); return (typeof c.getPerf === "function") ? c.getPerf() : { lastTurnMs: 0, lastDrawMs: 0 }; } catch (_) { return { lastTurnMs: 0, lastDrawMs: 0 }; } },
    getDecalsCount: function () { var c = ctx(); return Array.isArray(c.decals) ? c.decals.length : 0; },
    returnToWorldIfAtExit: function () { try { var c = ctx(); return (typeof window.Modes === "object" && typeof window.Modes.returnToWorldIfAtExit === "function") ? !!window.Modes.returnToWorldIfAtExit(c) : false; } catch (_) { return false; } },

    // Crit/status toggles
    setAlwaysCrit: function (v) { try { var c = ctx(); if (typeof c.setAlwaysCrit === "function") c.setAlwaysCrit(!!v); return true; } catch (_) { return false; } },
    setCritPart: function (part) { try { var c = ctx(); if (typeof c.setCritPart === "function") c.setCritPart(String(part || "")); return true; } catch (_) { return false; } },
    getPlayerStatus: function () { try { var c = ctx(); return { hp: c.player.hp, maxHp: c.player.maxHp, dazedTurns: c.player.dazedTurns | 0 }; } catch (_) { return { hp: 0, maxHp: 0, dazedTurns: 0 }; } },
    setPlayerDazedTurns: function (n) { try { var c = ctx(); c.player.dazedTurns = Math.max(0, (Number(n) || 0) | 0); return true; } catch (_) { return false; } },

    // Walkability/visibility
    isWalkableDungeon: function (x, y) { var c = ctx(); return c ? (c.inBounds(x, y) && c.isWalkable(x, y)) : false; },
    getVisibilityAt: function (x, y) { try { var c = ctx(); if (!c || !c.inBounds(x | 0, y | 0)) return false; return !!(c.visible[y | 0] && c.visible[y | 0][x | 0]); } catch (_) { return false; } },
    getTiles: function () { var c = ctx(); return c ? { WALL: c.TILES.WALL, FLOOR: c.TILES.FLOOR, DOOR: c.TILES.DOOR, STAIRS: c.TILES.STAIRS, WINDOW: c.TILES.WINDOW } : { WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3, WINDOW: 4 }; },
    getTile: function (x, y) { try { var c = ctx(); if (!c || !c.inBounds(x | 0, y | 0)) return null; return c.map[y | 0][x | 0]; } catch (_) { return null; } },
    hasEnemy: function (x, y) { try { var c = ctx(); if (c.occupancy && typeof c.occupancy.hasEnemy === "function") return !!c.occupancy.hasEnemy(x | 0, y | 0); return c.enemies.some(function (e) { return (e.x | 0) === (x | 0) && (e.y | 0) === (y | 0); }); } catch (_) { return false; } },
    hasNPC: function (x, y) { try { var c = ctx(); if (c.occupancy && typeof c.occupancy.hasNPC === "function") return !!c.occupancy.hasNPC(x | 0, y | 0); return c.npcs.some(function (n) { return (n.x | 0) === (x | 0) && (n.y | 0) === (y | 0); }); } catch (_) { return false; } },
    hasLOS: function (x0, y0, x1, y1) { try { var c = ctx(); if (c.los && typeof c.los.hasLOS === "function") return !!c.los.hasLOS(c, x0 | 0, y0 | 0, x1 | 0, y1 | 0); } catch (_) {} return false; },

    routeToDungeon: routeDungeon
  };
})();