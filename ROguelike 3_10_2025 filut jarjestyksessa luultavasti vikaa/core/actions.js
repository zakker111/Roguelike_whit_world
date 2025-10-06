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
(function () {
  function inBounds(ctx, x, y) {
    try {
      if (window.Utils && typeof Utils.inBounds === "function") return Utils.inBounds(ctx, x, y);
    } catch (_) {}
    const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
    return x >= 0 && y >= 0 && x < cols && y < rows;
  }

  function doAction(ctx) {
    // Hide loot UI if open
    try { if (ctx.UI && typeof UI.hideLoot === "function") UI.hideLoot(); } catch (_) {}

    if (ctx.mode === "world") {
      const t = (ctx.world && ctx.world.map) ? ctx.world.map[ctx.player.y][ctx.player.x] : null;
      if (ctx.World && ctx.World.TILES) {
        const WT = ctx.World.TILES;
        // Helper: if not standing exactly on TOWN/DUNGEON, allow entering if adjacent (QoL)
        function tryEnterAdjacent(kindTile) {
          const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
          for (const d of dirs) {
            const nx = ctx.player.x + d.dx, ny = ctx.player.y + d.dy;
            if (!inBounds(ctx, nx, ny)) continue;
            if (ctx.world.map[ny][nx] === kindTile) {
              // step onto tile and signal success
              ctx.player.x = nx; ctx.player.y = ny;
              return true;
            }
          }
          return false;
        }

        if (t === WT.TOWN || tryEnterAdjacent(WT.TOWN)) {
          // Enter town
          ctx.worldReturnPos = { x: ctx.player.x, y: ctx.player.y };
          ctx.mode = "town";
          if (ctx.Town && typeof Town.generate === "function") {
            Town.generate(ctx);
            if (typeof Town.ensureSpawnClear === "function") Town.ensureSpawnClear(ctx);
            ctx.townExitAt = { x: ctx.player.x, y: ctx.player.y };
            // Optional greeters kept minimal
            if (typeof Town.spawnGateGreeters === "function") Town.spawnGateGreeters(ctx, 0);
            if (ctx.UI && typeof UI.showTownExitButton === "function") UI.showTownExitButton();
            ctx.log(`You enter ${ctx.townName ? "the town of " + ctx.townName : "the town"}.`, "notice");
            ctx.requestDraw();
            return true;
          }
        } else if (t === WT.DUNGEON || tryEnterAdjacent(WT.DUNGEON)) {
          // Enter dungeon (single floor)
          ctx.cameFromWorld = true;
          ctx.worldReturnPos = { x: ctx.player.x, y: ctx.player.y };

          // Lookup dungeon info from world
          let info = null;
          try {
            const list = Array.isArray(ctx.world?.dungeons) ? ctx.world.dungeons : [];
            info = list.find(d => d.x === ctx.player.x && d.y === ctx.player.y) || null;
          } catch (_) { info = null; }
          if (!info) info = { x: ctx.player.x, y: ctx.player.y, level: 1, size: "medium" };
          ctx.dungeon = info;
          ctx.dungeonInfo = info;

          // Try loading existing state
          if (ctx.DungeonState && typeof DungeonState.load === "function" && DungeonState.load(ctx, info.x, info.y)) {
            ctx.log(`You re-enter the dungeon (Difficulty ${ctx.floor}${info.size ? ", " + info.size : ""}).`, "notice");
            ctx.requestDraw();
            return true;
          }

          ctx.floor = Math.max(1, info.level | 0);
          ctx.mode = "dungeon";
          if (ctx.Dungeon && typeof Dungeon.generateLevel === "function") {
            ctx.startRoomRect = ctx.startRoomRect || null;
            Dungeon.generateLevel(ctx, ctx.floor);
          }
          // Mark entrance as exit
          ctx.dungeonExitAt = { x: ctx.player.x, y: ctx.player.y };
          if (inBounds(ctx, ctx.player.x, ctx.player.y)) {
            ctx.map[ctx.player.y][ctx.player.x] = ctx.TILES.STAIRS;
            if (ctx.visible[ctx.player.y]) ctx.visible[ctx.player.y][ctx.player.x] = true;
            if (ctx.seen[ctx.player.y]) ctx.seen[ctx.player.y][ctx.player.x] = true;
          }
          if (ctx.DungeonState && typeof DungeonState.save === "function") {
            DungeonState.save(ctx);
          }
          ctx.log(`You enter the dungeon (Difficulty ${ctx.floor}${info.size ? ", " + info.size : ""}).`, "notice");
          ctx.requestDraw();
          return true;
        }
      }
      // Unhandled tile in world: allow fallback movement handlers to proceed
      return false;
    }

    if (ctx.mode === "town") {
      // Prefer Town interactions (props, talk)
      if (ctx.Town && typeof Town.interactProps === "function") {
        const handled = Town.interactProps(ctx);
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

  function shopAt(ctx, x, y) {
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

  function loot(ctx) {
    if (ctx.mode === "town") {
      // If standing on a shop door, show schedule and flavor
      const s = shopAt(ctx, ctx.player.x, ctx.player.y);
      if (s) {
        const openNow = isShopOpenNow(ctx, s);
        const schedule = shopScheduleStr(ctx, s);
        const nameLower = (s.name || "").toLowerCase();
        if (nameLower === "inn") {
          ctx.log(`Inn: ${schedule}. ${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
          ctx.log("You enter the inn.", "notice");
          // Inns provide resting; allow rest regardless
          restAtInn(ctx);
          return true;
        }
        if (nameLower === "tavern") {
          ctx.log(`Tavern: ${schedule}. ${openNow ? "Open now." : "Closed now."}`, openNow ? "good" : "warn");
          const phase = (ctx.time && ctx.time.phase) || "day";
          if (phase === "night" || phase === "dusk") ctx.log("You step into the tavern. It's lively inside.", "notice");
          else if (phase === "day") ctx.log("You enter the tavern. A few patrons sit quietly.", "info");
          else ctx.log("You enter the tavern.", "info");
          ctx.requestDraw();
          return true;
        }
        if (openNow) ctx.log(`The ${s.name || "shop"} is open. (Trading coming soon)`, "notice");
        else ctx.log(`The ${s.name || "shop"} is closed. ${schedule}`, "warn");
        ctx.requestDraw();
        return true;
      }
      // Prefer props interaction; if not handled, describe underfoot prop explicitly.
      if (ctx.Town && typeof Town.interactProps === "function") {
        const handled = Town.interactProps(ctx);
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
      // Return to overworld when on the entrance tile (">") or stairs tile,
      // regardless of cameFromWorld flag.
      const onExit =
        (ctx.dungeonExitAt && ctx.player.x === ctx.dungeonExitAt.x && ctx.player.y === ctx.dungeonExitAt.y) ||
        (inBounds(ctx, ctx.player.x, ctx.player.y) && ctx.map[ctx.player.y][ctx.player.x] === ctx.TILES.STAIRS);

      if (ctx.world && onExit) {
        // Persist current dungeon state before leaving
        if (ctx.DungeonState && typeof DungeonState.save === "function") {
          DungeonState.save(ctx);
        }
        // Return to world immediately
        ctx.mode = "world";
        ctx.enemies.length = 0;
        ctx.corpses.length = 0;
        ctx.decals.length = 0;
        ctx.map = ctx.world.map;
        // Restore exact overworld position:
        // Prefer stored worldReturnPos; otherwise fall back to known dungeon entrance coords.
        let rx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : null;
        let ry = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : null;
        if (rx == null || ry == null) {
          const info = ctx.dungeon || ctx.dungeonInfo;
          if (info && typeof info.x === "number" && typeof info.y === "number") {
            rx = info.x; ry = info.y;
          }
        }
        // Final safety: clamp to map bounds
        if (rx == null || ry == null) {
          rx = Math.max(0, Math.min(ctx.world.map[0].length - 1, ctx.player.x));
          ry = Math.max(0, Math.min(ctx.world.map.length - 1, ctx.player.y));
        }
        ctx.player.x = rx; ctx.player.y = ry;

        if (ctx.FOV && typeof FOV.recomputeFOV === "function") {
          FOV.recomputeFOV(ctx);
        }
        if (typeof ctx.updateUI === "function") ctx.updateUI();
        ctx.log("You climb back to the overworld.", "notice");
        ctx.requestDraw();
        return true;
      }

      // Dungeon loot via Loot module
      if (ctx.Loot && typeof Loot.lootHere === "function") {
        Loot.lootHere(ctx);
        return true;
      }
      // If standing on a blood decal, describe it
      if (hasDecalAt(ctx, ctx.player.x, ctx.player.y)) {
        ctx.log("The floor here is stained with blood.", "info");
        ctx.requestDraw();
        return true;
      }
      // Guidance if not at exit
      ctx.log("Return to the entrance (the hole '>') and press G to leave.", "info");
      return true;
    }

    return false;
  }

  function descend(ctx) {
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

  // ---- Shop schedule helpers (centralized via ShopService) ----
  function minutesOfDay(h, m) {
    try {
      const day = (TimeService && typeof TimeService.create === "function") ? TimeService.create({}).DAY_MINUTES : 1440;
      if (window.ShopService && typeof ShopService.minutesOfDay === "function") return ShopService.minutesOfDay(h, m, day);
    } catch (_) {}
    const DAY = 1440;
    return (((h | 0) * 60 + (m | 0)) % DAY + DAY) % DAY;
  }
  function isOpenAtShop(ctx, shop, minutes) {
    if (window.ShopService && typeof ShopService.isOpenAt === "function") return ShopService.isOpenAt(shop, minutes);
    if (!shop) return false;
    if (shop.alwaysOpen) return true;
    if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
    const o = shop.openMin, c = shop.closeMin;
    if (o === c) return false;
    return c > o ? (minutes >= o && minutes < c) : (minutes >= o || minutes < c);
  }
  function isShopOpenNow(ctx, shop) {
    if (window.ShopService && typeof ShopService.isShopOpenNow === "function") return ShopService.isShopOpenNow(ctx, shop);
    const t = ctx.time;
    const minutes = t ? (t.hours * 60 + t.minutes) : 12 * 60;
    if (!shop) return t && t.phase === "day";
    return isOpenAtShop(ctx, shop, minutes);
  }
  function shopScheduleStr(ctx, shop) {
    if (window.ShopService && typeof ShopService.shopScheduleStr === "function") return ShopService.shopScheduleStr(shop);
    if (!shop) return "";
    const h2 = (min) => {
      const hh = ((min / 60) | 0) % 24;
      return String(hh).padStart(2, "0");
    };
    return `Opens ${h2(shop.openMin)}:00, closes ${h2(shop.closeMin)}:00`;
  }

  // ---- Inn rest helpers ----
  function restAtInn(ctx) {
    // Advance to 06:00 and fully heal
    try {
      if (typeof TimeService !== "undefined" && TimeService && typeof TimeService.create === "function") {
        const TS = TimeService.create({ dayMinutes: 24 * 60, cycleTurns: 360 });
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

  window.Actions = { doAction, loot, descend };
})();