/**
 * AI: enemy perception, movement, and attack routine.
 *
 * Exports (window.AI):
 * - enemiesAct(ctx): runs one AI turn for all enemies on the map
 *
 * ctx (expected subset):
 * {
 *   // state
 *   player, enemies, map, TILES,
 *   // geometry
 *   inBounds(x,y), isWalkable(x,y),
 *   // randomness
 *   rng(), utils?: { randInt, randFloat, chance, capitalize },
 *   // combat helpers and effects
 *   rollHitLocation(), critMultiplier(), getPlayerBlockChance(loc),
 *   enemyDamageAfterDefense(raw), randFloat(min,max,dec),
 *   decayBlockingHands(), decayEquipped(slot, amt),
 *   // UI/log
 *   log(msg, type?), updateUI?,
 *   // lifecycle
 *   onPlayerDied?(), // called when HP <= 0
 *   // LOS
 *   los?: { tileTransparent(ctx,x,y), hasLOS(ctx,x0,y0,x1,y1) }
 * }
 */
(function () {
  // Reusable direction arrays to avoid per-tick allocations
  const ALT_DIRS = Object.freeze([{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]);
  const WANDER_DIRS = ALT_DIRS;

  function occKey(x, y) {
    // 16-bit safe packing for maps up to 65535 in each dimension
    return ((y & 0xffff) << 16) | (x & 0xffff);
  }

  function tileTransparent(ctx, x, y) {
    // Delegate to shared LOS module to keep behavior consistent across the codebase.
    if (ctx.los && typeof ctx.los.tileTransparent === "function") {
      return ctx.los.tileTransparent(ctx, x, y);
    }
    // As a safety net, use a minimal transparency check; Ctx.ensureLOS should provide ctx.los.
    if (!ctx.inBounds || !ctx.inBounds(x, y)) return false;
    return ctx.map[y][x] !== ctx.TILES.WALL;
  }

  function hasLOS(ctx, x0, y0, x1, y1) {
    // Always prefer the shared LOS implementation. Ctx.ensureLOS guarantees availability.
    if (ctx.los && typeof ctx.los.hasLOS === "function") {
      return ctx.los.hasLOS(ctx, x0, y0, x1, y1);
    }
    // Safety fallback: assume LOS if we lack the module (should not happen).
    return true;
  }

  function enemiesAct(ctx) {
    const { player, enemies } = ctx;
    const U = (ctx && ctx.utils) ? ctx.utils : null;
    const randFloat = U && U.randFloat ? U.randFloat : (ctx.randFloat || ((a,b,dec=1)=>{const v=a+(ctx.rng?ctx.rng():Math.random())*(b-a);const p=Math.pow(10,dec);return Math.round(v*p)/p;}));
    const randInt = U && U.randInt ? U.randInt : (ctx.randInt || ((min,max)=>Math.floor((ctx.rng?ctx.rng():Math.random())*(max-min+1))+min));
    const chance = U && U.chance ? U.chance : (ctx.chance || ((p)=>(ctx.rng?ctx.rng():Math.random())<p));
    const Cap = U && U.capitalize ? U.capitalize : (s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

    const senseRange = 8;

    // Use shared OccupancyGrid if available for movement updates
    const occ = (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function" && typeof ctx.occupancy.setEnemy === "function" && typeof ctx.occupancy.isFree === "function")
      ? ctx.occupancy
      : {
          // Lightweight shim so movement code can call delete/add without errors.
          delete() {},
          add() {},
          isFree(x, y, opts) {
            const ignorePlayer = !!(opts && opts.ignorePlayer);
            const blocked = !ctx.isWalkable(x, y) || (!ignorePlayer && player.x === x && player.y === y);
            if (blocked) return false;
            const key = occKey(x, y);
            for (const en of enemies) {
              if (occKey(en.x, en.y) === key) return false;
            }
            return true;
          }
        };

    // Occ helpers to update occupancy across implementations (grid or simple Set)
    function occClearEnemy(occRef, x, y) {
      if (!occRef) return;
      if (typeof occRef.clearEnemy === "function") {
        occRef.clearEnemy(x, y);
      } else if (typeof occRef.delete === "function") {
        try { occRef.delete(occKey(x, y)); } catch (_) {}
      }
    }
    function occSetEnemy(occRef, x, y) {
      if (!occRef) return;
      if (typeof occRef.setEnemy === "function") {
        occRef.setEnemy(x, y);
      } else if (typeof occRef.add === "function") {
        try { occRef.add(occKey(x, y)); } catch (_) {}
      }
    }

    // Prefer shared OccupancyGrid if provided in ctx; fallback to per-turn set
    let isFree = (x, y) => {
      const blocked = !ctx.isWalkable(x, y) || (player.x === x && player.y === y);
      if (blocked) return false;
      if (occ && typeof occ.isFree === "function") {
        return occ.isFree(x, y, { ignorePlayer: true });
      }
      // Fallback: check enemies only
      return !new Set(enemies.map(en => occKey(en.x, en.y))).has(occKey(x, y));
    };

    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      // Low-HP panic/flee (generic for all enemies)
      // If enemy HP is very low, small chance to enter a short panic state and try to flee,
      // occasionally yelling they don't want to die.
      if (typeof e.hp === "number" && e.hp <= 2) {
        // start or refresh panic with small chance
        if (!(e._panicTurns > 0) && chance(0.2)) {
          e._panicTurns = 3;
        }
        // yell occasionally with cooldown
        if (typeof e._panicYellCd === "number" && e._panicYellCd > 0) e._panicYellCd -= 1;
        if ((e._panicYellCd | 0) <= 0 && (e._panicTurns | 0) > 0 && chance(0.35)) {
          try { ctx.log("I don't want to die!", "flavor"); } catch (_) {}
          e._panicYellCd = 6;
        }
      }

      // Compute away-from-player preferred directions (used by panic and mime_ghost)
      const sxAway = dx === 0 ? 0 : (dx > 0 ? -1 : 1);
      const syAway = dy === 0 ? 0 : (dy > 0 ? -1 : 1);
      const primaryAway = Math.abs(dx) > Math.abs(dy)
        ? [{ x: sxAway, y: 0 }, { x: 0, y: syAway }]
        : [{ x: 0, y: syAway }, { x: sxAway, y: 0 }];

      // If panicking, prefer to flee instead of fighting when possible
      if ((e._panicTurns | 0) > 0) {
        let fled = false;
        // If adjacent, strong preference to step away instead of attacking
        const tryDirs = primaryAway.concat(ALT_DIRS);
        for (const d of tryDirs) {
          const nx = e.x + d.x, ny = e.y + d.y;
          if (isFree(nx, ny)) {
            occClearEnemy(occ, e.x, e.y);
            e.x = nx; e.y = ny;
            occSetEnemy(occ, e.x, e.y);
            fled = true;
            break;
          }
        }
        e._panicTurns -= 1;
        if (fled) continue; // used turn to flee
        // If couldn't flee, fall through to normal behavior (may attack if adjacent)
      }

      // Special behavior: mime_ghost tends to flee, shouts "Argh!", and only sometimes attacks
      if (e.type === "mime_ghost") {
        // lightweight shout cooldown to avoid spam
        if (typeof e._arghCd === "number" && e._arghCd > 0) e._arghCd -= 1;
        if ((e._arghCd | 0) <= 0 && chance(0.15)) {
          try { ctx.log("Argh!", "flavor"); } catch (_) {}
          e._arghCd = 3;
        }

        // If adjacent: 35% chance to attack; otherwise try to step away
        if (dist === 1) {
          if (!chance(0.35)) {
            let moved = false;
            for (const d of primaryAway) {
              const nx = e.x + d.x, ny = e.y + d.y;
              if (isFree(nx, ny)) {
                occClearEnemy(occ, e.x, e.y);
                e.x = nx; e.y = ny;
                occSetEnemy(occ, e.x, e.y);
                moved = true;
                break;
              }
            }
            if (!moved) {
              for (const d of ALT_DIRS) {
                const nx = e.x + d.x, ny = e.y + d.y;
                if (isFree(nx, ny)) {
                  occ.delete(occKey(e.x, e.y));
                  e.x = nx; e.y = ny;
                  occ.add(occKey(e.x, e.y));
                  moved = true;
                  break;
                }
              }
            }
            if (moved) continue; // skipped attack this turn
          }
          // else fall through to default adjacent attack below
        } else {
          // Not adjacent: if senses the player with LOS, try to move away
          if (dist <= senseRange && hasLOS(ctx, e.x, e.y, player.x, player.y)) {
            let moved = false;
            for (const d of primaryAway) {
              const nx = e.x + d.x, ny = e.y + d.y;
              if (isFree(nx, ny)) {
                occClearEnemy(occ, e.x, e.y);
                e.x = nx; e.y = ny;
                occSetEnemy(occ, e.x, e.y);
                moved = true;
                break;
              }
            }
            if (!moved) {
              for (const d of ALT_DIRS) {
                const nx = e.x + d.x, ny = e.y + d.y;
                if (isFree(nx, ny)) {
                  occ.delete(occKey(e.x, e.y));
                  e.x = nx; e.y = ny;
                  occ.add(occKey(e.x, e.y));
                  moved = true;
                  break;
                }
              }
            }
            if (moved) continue; // handled movement; next enemy
          }
          // otherwise let default wander logic later handle it
        }
      }

      // attack if adjacent
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        const loc = ctx.rollHitLocation();

        // Player attempts to block with hand/position
        if (ctx.rng() < ctx.getPlayerBlockChance(loc)) {
          ctx.log(`You block the ${e.type || "enemy"}'s attack to your ${loc.part}.`, "block");
          // Optional flavor for blocks
          if (ctx.Flavor && typeof ctx.Flavor.onBlock === "function") {
            ctx.Flavor.onBlock(ctx, { side: "player", attacker: e, defender: player, loc });
          }
          // Blocking uses gear
          ctx.decayBlockingHands();
          ctx.decayEquipped("hands", randFloat(0.3, 1.0, 1));
          continue;
        }

        // Compute damage with location and crit; then reduce by defense
        let raw = e.atk * (ctx.enemyDamageMultiplier ? ctx.enemyDamageMultiplier(e.level) : (1 + 0.15 * Math.max(0, (e.level || 1) - 1))) * (loc.mult || 1);
        let isCrit = false;
        const critChance = Math.max(0, Math.min(0.5, 0.10 + (loc.critBonus || 0)));
        if (ctx.rng() < critChance) {
          isCrit = true;
          raw *= (ctx.critMultiplier ? ctx.critMultiplier() : (1.6 + ctx.rng() * 0.4));
        }
        const dmg = ctx.enemyDamageAfterDefense(raw);
        player.hp -= dmg;
        // Blood decal on the player's tile when damaged
        try {
          if (dmg > 0 && typeof ctx.addBloodDecal === "function") {
            ctx.addBloodDecal(player.x, player.y, isCrit ? 1.4 : 1.0);
          }
        } catch (_) {}
        if (isCrit) ctx.log(`Critical! ${Cap(e.type)} hits your ${loc.part} for ${dmg}.`, "crit");
        else ctx.log(`${Cap(e.type)} hits your ${loc.part} for ${dmg}.`);
        // Apply status effects
        if (isCrit && loc.part === "head" && typeof window !== "undefined" && window.Status && typeof Status.applyDazedToPlayer === "function") {
          const dur = (ctx.rng ? (1 + Math.floor(ctx.rng() * 2)) : 1); // 1-2 turns
          try { Status.applyDazedToPlayer(ctx, dur); } catch (_) {}
        }
        // Bleed on critical hits to the player (short duration)
        if (isCrit && typeof window !== "undefined" && window.Status && typeof Status.applyBleedToPlayer === "function") {
          try { Status.applyBleedToPlayer(ctx, 2); } catch (_) {}
        }
        if (ctx.Flavor && typeof ctx.Flavor.logHit === "function") {
          ctx.Flavor.logHit(ctx, { attacker: e, loc, crit: isCrit, dmg });
        }

        // Item decay on being hit (only struck location)
        const critWear = isCrit ? 1.6 : 1.0;
        let wear = 0.5;
        if (loc.part === "torso") wear = randFloat(0.8, 2.0, 1);
        else if (loc.part === "head") wear = randFloat(0.3, 1.0, 1);
        else if (loc.part === "legs") wear = randFloat(0.4, 1.3, 1);
        else if (loc.part === "hands") wear = randFloat(0.3, 1.0, 1);
        ctx.decayEquipped(loc.part, wear * critWear);
        if (player.hp <= 0) {
          player.hp = 0;
          if (typeof ctx.onPlayerDied === "function") ctx.onPlayerDied();
          return;
        }
        continue;
      }

      // movement/approach
      if (e.immobileTurns && e.immobileTurns > 0) {
        // crippled legs: cannot move this turn (but still allowed to attack when adjacent above)
        e.immobileTurns -= 1;
        continue;
      } else if (dist <= senseRange) {
        // Prefer to chase if LOS; otherwise attempt a cautious step toward the player
        const sx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
        const sy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
        const primary = Math.abs(dx) > Math.abs(dy) ? [{x:sx,y:0},{x:0,y:sy}] : [{x:0,y:sy},{x:sx,y:0}];

        let moved = false;
        for (const d of primary) {
          const nx = e.x + d.x;
          const ny = e.y + d.y;
          if (isFree(nx, ny)) {
            occ.delete(occKey(e.x, e.y));
            e.x = nx; e.y = ny;
            occ.add(occKey(e.x, e.y));
            moved = true;
            break;
          }
        }
        if (!moved) {
          // try alternate directions (simple wiggle)
          for (const d of ALT_DIRS) {
            const nx = e.x + d.x;
            const ny = e.y + d.y;
            if (isFree(nx, ny)) {
                occClearEnemy(occ, e.x, e.y);
                e.x = nx; e.y = ny;
                occSetEnemy(occ, e.x, e.y);
                break;
              }
          }
        }
      } else if (chance(0.4)) {
        // random wander (moderate chance when far away)
        const d = WANDER_DIRS[randInt(0, WANDER_DIRS.length - 1)];
        const nx = e.x + d.x, ny = e.y + d.y;
        if (isFree(nx, ny)) {
          occClearEnemy(occ, e.x, e.y);
          e.x = nx; e.y = ny;
          occ.add(occKey(e.x, e.y));
        }
      }
    }
  }

  window.AI = {
    enemiesAct,
  };
})();