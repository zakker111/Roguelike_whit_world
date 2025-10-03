/**
 * GameActions: extracts bulky interaction/movement logic from game.js.
 * 
 * API (globals on window.GameActions):
 *  - tryMovePlayer(ctx, dx, dy)
 *  - doAction(ctx)
 *  - descendIfPossible(ctx)
 *  - loot(ctx)
 * 
 * Relies on ctx created by Ctx.create(base) in game.js, which provides:
 *   - state: mode, world, player, enemies, corpses, decals, map, seen, visible, npcs, shops, townProps, townBuildings, townExitAt, dungeonExitAt
 *   - constants: TILE, ROWS, COLS, TILES
 *   - helpers/hooks: inBounds, isWalkable, enemyColor, updateCamera, recomputeFOV, updateUI, requestDraw
 *   - combat helpers: rollHitLocation, critMultiplier, enemyDamageAfterDefense, enemyDamageMultiplier,
 *   - decay helpers: decayEquipped, decayBlockingHands, addBloodDecal
 *   - UI flows: showLoot, hideLoot, renderInventory, log
 *   - actions: turn(), initWorld(), generateLevel(depth)
 */
(function () {
  function tryMovePlayer(ctx, dx, dy) {
    if (ctx.isDead) return;

    // WORLD MODE: move over overworld tiles (no NPCs here)
    if (ctx.mode === "world") {
      const nx = ctx.player.x + dx;
      const ny = ctx.player.y + dy;
      const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
      if (!wmap) return;
      const rows = wmap.length, cols = rows ? (wmap[0] ? wmap[0].length : 0) : 0;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
      if (ctx.World && typeof ctx.World.isWalkable === "function" && ctx.World.isWalkable(wmap[ny][nx])) {
        ctx.player.x = nx; ctx.player.y = ny;
        if (typeof ctx.updateCamera === "function") ctx.updateCamera();
        if (typeof ctx.turn === "function") ctx.turn();
      }
      return;
    }

    // TOWN MODE: block NPC tiles, use local isWalkable
    if (ctx.mode === "town") {
      const nx = ctx.player.x + dx;
      const ny = ctx.player.y + dy;
      if (!ctx.inBounds(nx, ny)) return;
      const hasOG = (typeof ctx.occupancy?.hasNPC === "function") ? ctx.occupancy.hasNPC(nx, ny) : (Array.isArray(ctx.npcs) ? ctx.npcs.some(n => n.x === nx && n.y === ny) : false);
      if (hasOG) {
        const npc = Array.isArray(ctx.npcs) ? ctx.npcs.find(n => n.x === nx && n.y === ny) : null;
        if (ctx.log) {
          const lines = Array.isArray(npc?.lines) && npc.lines.length ? npc.lines : ["Hey!", "Watch it!", "Careful there."];
          const li = Math.floor(ctx.rng() * lines.length);
          ctx.log(`${(npc?.name) || "Villager"}: ${lines[li]}`, "info");
        }
        if (ctx.requestDraw) ctx.requestDraw();
        return;
      }
      if (ctx.isWalkable(nx, ny)) {
        ctx.player.x = nx; ctx.player.y = ny;
        if (ctx.updateCamera) ctx.updateCamera();
        if (ctx.turn) ctx.turn();
      }
      return;
    }

    // DUNGEON MODE:
    // Dazed: skip action if dazedTurns > 0
    if (ctx.player.dazedTurns && ctx.player.dazedTurns > 0) {
      ctx.player.dazedTurns -= 1;
      if (ctx.log) ctx.log("You are dazed and lose your action this turn.", "warn");
      if (ctx.turn) ctx.turn();
      return;
    }
    const nx = ctx.player.x + dx;
    const ny = ctx.player.y + dy;
    if (!ctx.inBounds(nx, ny)) return;

    const enemy = Array.isArray(ctx.enemies) ? ctx.enemies.find(e => e.x === nx && e.y === ny) : null;
    if (enemy) {
      const capitalize = (ctx.PlayerUtils && typeof ctx.PlayerUtils.capitalize === "function")
        ? ctx.PlayerUtils.capitalize
        : (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

      let loc = (typeof ctx.rollHitLocation === "function") ? ctx.rollHitLocation() : { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 };
      const alwaysCrit = !!(window.ALWAYS_CRIT);
      const forcedCritPart = (typeof window.ALWAYS_CRIT_PART === "string") ? window.ALWAYS_CRIT_PART : "";
      if (alwaysCrit && forcedCritPart) {
        const profiles = {
          torso: { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.00 },
          head:  { part: "head",  mult: 1.1, blockMod: 0.85, critBonus: 0.15 },
          hands: { part: "hands", mult: 0.9, blockMod: 0.75, critBonus: -0.05 },
          legs:  { part: "legs",  mult: 0.95, blockMod: 0.75, critBonus: -0.03 },
        };
        if (profiles[forcedCritPart]) loc = profiles[forcedCritPart];
      }

      const getEnemyBlockChance = (ctx.Enemies && typeof ctx.Enemies.enemyBlockChance === "function")
        ? (e, l) => ctx.Enemies.enemyBlockChance(e, l)
        : (e, l) => {
            const base = e.type === "ogre" ? 0.10 : e.type === "troll" ? 0.08 : 0.06;
            return Math.max(0, Math.min(0.35, base * (l?.blockMod || 1.0)));
          };

      if (ctx.rng() < getEnemyBlockChance(enemy, loc)) {
        if (ctx.log) ctx.log(`${capitalize(enemy.type || "enemy")} blocks your attack to the ${loc.part}.`, "block");
        if (typeof ctx.decayBlockingHands === "function") ctx.decayBlockingHands(true);
        if (typeof ctx.decayEquipped === "function") ctx.decayEquipped("hands", (typeof ctx.randFloat === "function") ? ctx.randFloat(0.2, 0.7, 1) : 0.4);
        if (ctx.turn) ctx.turn();
        return;
      }

      const getPlayerAttack = (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack : (() => 1);
      let dmg = getPlayerAttack() * loc.mult;
      let isCrit = false;
      const critChance = Math.max(0, Math.min(0.6, 0.12 + (loc.critBonus || 0)));
      if (alwaysCrit || ctx.rng() < critChance) {
        isCrit = true;
        dmg *= (typeof ctx.critMultiplier === "function") ? ctx.critMultiplier() : 1.8;
      }
      dmg = Math.max(0, (typeof ctx.round1 === "function") ? ctx.round1(dmg) : Math.round(dmg * 10) / 10);
      enemy.hp -= dmg;

      if (dmg > 0 && typeof ctx.addBloodDecal === "function") {
        ctx.addBloodDecal(enemy.x, enemy.y, isCrit ? 1.6 : 1.0);
      }

      if (ctx.log) {
        if (isCrit) ctx.log(`Critical! You hit the ${enemy.type || "enemy"}'s ${loc.part} for ${dmg}.`, "crit");
        else ctx.log(`You hit the ${enemy.type || "enemy"}'s ${loc.part} for ${dmg}.`);
      }
      try {
        const Flavor = ctx.Flavor || window.Flavor;
        if (Flavor && typeof Flavor.logPlayerHit === "function") Flavor.logPlayerHit(ctx, { target: enemy, loc, crit: isCrit, dmg });
      } catch (_) {}
      if (isCrit && loc.part === "legs" && enemy.hp > 0) {
        const Status = ctx.Status || window.Status;
        if (Status && typeof Status.applyLimpToEnemy === "function") {
          Status.applyLimpToEnemy(ctx, enemy, 2);
        } else {
          enemy.immobileTurns = Math.max(enemy.immobileTurns || 0, 2);
          if (ctx.log) ctx.log(`${capitalize(enemy.type || "enemy")} staggers; its legs are crippled and it can't move for 2 turns.`, "notice");
        }
      }
      {
        const Status = ctx.Status || window.Status;
        if (isCrit && enemy.hp > 0 && Status && typeof Status.applyBleedToEnemy === "function") {
          Status.applyBleedToEnemy(ctx, enemy, 2);
        }
      }

      if (enemy.hp <= 0 && typeof ctx.onEnemyDied === "function") {
        ctx.onEnemyDied(enemy);
      }

      if (typeof ctx.decayEquipped === "function") ctx.decayEquipped("hands", (typeof ctx.randFloat === "function") ? ctx.randFloat(0.3, 1.0, 1) : 0.6);
      if (ctx.turn) ctx.turn();
      return;
    }

    const blockedByEnemy = (typeof ctx.occupancy?.hasEnemy === "function") ? ctx.occupancy.hasEnemy(nx, ny) : (Array.isArray(ctx.enemies) ? ctx.enemies.some(e => e.x === nx && e.y === ny) : false);
    if (ctx.isWalkable(nx, ny) && !blockedByEnemy) {
      ctx.player.x = nx;
      ctx.player.y = ny;
      if (ctx.updateCamera) ctx.updateCamera();
      if (ctx.turn) ctx.turn();
    }
  }

  function loot(ctx) {
    if (ctx.isDead) return;

    // Prefer Actions module for all interaction/loot flows across modes
    if (ctx.Actions && typeof ctx.Actions.loot === "function") {
      const handled = ctx.Actions.loot(ctx);
      if (handled) {
        if (ctx.updateCamera) ctx.updateCamera();
        if (ctx.recomputeFOV) ctx.recomputeFOV();
        if (ctx.updateUI) ctx.updateUI();
        if (ctx.requestDraw) ctx.requestDraw();
        return;
      }
    }

    // Dungeon-only fallback: loot ground or guide user
    if (ctx.mode === "dungeon") {
      if (ctx.Loot && typeof ctx.Loot.lootHere === "function") {
        ctx.Loot.lootHere(ctx);
        return;
      }
      if (ctx.log) ctx.log("Return to the entrance (the hole '>') and press G to leave.", "info");
      if (ctx.requestDraw) ctx.requestDraw();
      return;
    }

    // World/town default
    if (ctx.log) ctx.log("Nothing to do here.");
  }

  function doAction(ctx) {
    if (ctx.hideLoot) ctx.hideLoot();

    // Town gate exit takes priority over other interactions
    if (ctx.mode === "town" && ctx.townExitAt && ctx.player.x === ctx.townExitAt.x && ctx.player.y === ctx.townExitAt.y) {
      const Modes = ctx.Modes || window.Modes;
      if (typeof Modes?.leaveTownNow === "function") {
        Modes.leaveTownNow(ctx);
        return;
      }
    }

    if (ctx.Actions && typeof ctx.Actions.doAction === "function") {
      const handled = ctx.Actions.doAction(ctx);
      if (handled) {
        if (ctx.updateCamera) ctx.updateCamera();
        if (ctx.recomputeFOV) ctx.recomputeFOV();
        if (ctx.updateUI) ctx.updateUI();
        if (ctx.requestDraw) ctx.requestDraw();
        return;
      }
    }

    const Modes = ctx.Modes || window.Modes;

    if (ctx.mode === "world") {
      // Debug: report current tile underfoot
      try {
        const t = ctx.world && ctx.world.map ? ctx.world.map[ctx.player.y][ctx.player.x] : null;
        const WT = ctx.World && ctx.World.TILES;
        if (WT && typeof ctx.log === "function") {
          const name = (t === WT.TOWN) ? "TOWN" : (t === WT.DUNGEON) ? "DUNGEON" : "other";
          ctx.log(`[TRACE] Action in world on tile: ${name} at (${ctx.player.x},${ctx.player.y})`, "info");
        }
      } catch (_) {}

      const didTown = (typeof Modes?.enterTownIfOnTile === "function") ? !!Modes.enterTownIfOnTile(ctx) : false;
      if (!didTown) {
        if (typeof Modes?.enterDungeonIfOnEntrance === "function") Modes.enterDungeonIfOnEntrance(ctx);
      }
      return;
    }

    if (ctx.mode === "town") {
      if (typeof Modes?.leaveTownNow === "function") {
        if (ctx.townExitAt && ctx.player.x === ctx.townExitAt.x && ctx.player.y === ctx.townExitAt.y) {
          Modes.leaveTownNow(ctx);
          return;
        }
      }
      loot(ctx);
      return;
    }

    if (ctx.mode === "dungeon") {
      loot(ctx);
      return;
    }

    loot(ctx);
  }

  function descendIfPossible(ctx) {
    if (ctx.Actions && typeof ctx.Actions.descend === "function") {
      const handled = ctx.Actions.descend(ctx);
      if (handled) return;
    }
    const Modes = ctx.Modes || window.Modes;
    if (ctx.mode === "world" || ctx.mode === "town") {
      doAction(ctx);
      return;
    }
    if (ctx.mode === "dungeon") {
      if (ctx.log) ctx.log("This dungeon has no deeper levels. Return to the entrance (the hole '>') and press G to leave.", "info");
      return;
    }
    const here = ctx.map[ctx.player.y][ctx.player.x];
    if (here === ctx.TILES.STAIRS) {
      if (ctx.log) ctx.log("There is nowhere to go down from here.", "info");
    } else {
      if (ctx.log) ctx.log("You need to stand on the staircase (brown tile marked with '>').", "info");
    }
  }

  window.GameActions = {
    tryMovePlayer,
    doAction,
    descendIfPossible,
    loot,
  };
})();