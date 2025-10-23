/**
 * AI: enemy perception, movement, and attack routine.
 *
 * Exports (ESM + window.AI):
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

export function enemiesAct(ctx) {
  const { player, enemies } = ctx;
  const U = (ctx && ctx.utils) ? ctx.utils : null;
  // Local RNG value helper to reduce nested ternaries and avoid syntax pitfalls
  const rv = () => {
    if (ctx.rng) return ctx.rng();
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") return window.RNG.rng();
    if (typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function") return window.RNGFallback.getRng()();
    return Math.random();
  };
  const randFloat = U && U.randFloat ? U.randFloat : (ctx.randFloat || ((a,b,dec=1)=>{const r=rv();const v=a+r*(b-a);const p=Math.pow(10,dec);return Math.round(v*p)/p;}));
  const randInt = U && U.randInt ? U.randInt : (ctx.randInt || ((min,max)=>{const r=rv();return Math.floor(r*(max-min+1))+min;}));
  const chance = U && U.chance ? U.chance : (ctx.chance || ((p)=>{const r=rv();return r<p;}));
  const Cap = U && U.capitalize ? U.capitalize : (s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  const senseRange = 8;

  // Faction helpers (minimal matrix: different factions are hostile, all hostile to player)
  const factionOf = (en) => {
    if (!en) return "neutral";
    if (en.faction) return String(en.faction);
    const t = String(en.type || "").toLowerCase();
    if (t.includes("bandit")) return "bandit";
    if (t.includes("orc")) return "orc";
    return "monster";
  };
  const isHostileTo = (fa, fb) => {
    if (fa === "neutral" || fb === "neutral") return false;
    if (fa === fb) return false;
    return true;
  };

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

  // Build a one-shot occupancy set for this tick when no grid is provided; avoids per-call allocations
  const occSet = (!occ || typeof occ.isFree !== "function")
    ? (() => {
        const s = new Set();
        for (let i = 0; i < enemies.length; i++) {
          const en = enemies[i];
          s.add(occKey(en.x, en.y));
        }
        return s;
      })()
    : null;

  // Occ helpers to update occupancy across implementations (grid or simple Set)
  function occClearEnemy(occRef, x, y) {
    if (!occRef) return;
    if (typeof occRef.clearEnemy === "function") {
      occRef.clearEnemy(x, y);
    } else if (occSet && typeof occSet.delete === "function") {
      try { occSet.delete(occKey(x, y)); } catch (_) {}
    } else if (typeof occRef.delete === "function") {
      try { occRef.delete(occKey(x, y)); } catch (_) {}
    }
  }
  function occSetEnemy(occRef, x, y) {
    if (!occRef) return;
    if (typeof occRef.setEnemy === "function") {
      occRef.setEnemy(x, y);
    } else if (occSet && typeof occSet.add === "function") {
      try { occSet.add(occKey(x, y)); } catch (_) {}
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
    // Fallback: check enemies only via precomputed set
    return !occSet.has(occKey(x, y));
  };

  // Spatial index for enemies to reduce nearest-hostile search from O(n^2) on average.
  // Bucket enemies into fixed-size grid cells, then scan nearby cells first.
  const CELL = 6; // tiles per cell (tunable); larger cells fewer buckets, smaller cells more precise
  function cellKey(cx, cy) { return ((cy & 0xffff) << 16) | (cx & 0xffff); }
  const buckets = new Map();
  for (const en of enemies) {
    const cx = Math.floor(en.x / CELL);
    const cy = Math.floor(en.y / CELL);
    const key = cellKey(cx, cy);
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(en);
  }
  function scanRing(cx, cy, ring = 0) {
    const list = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const k = cellKey(cx + dx, cy + dy);
        const arr = buckets.get(k);
        if (arr && arr.length) list.push(arr);
      }
    }
    return list;
  }
  function nearestHostileFor(e) {
    const eFac = factionOf(e);
    const cx = Math.floor(e.x / CELL);
    const cy = Math.floor(e.y / CELL);
    let best = null;
    let bestDist = Infinity;

    // Try local ring, then expanded ring
    for (let ring = 0; ring <= 2; ring++) {
      const cells = scanRing(cx, cy, ring);
      if (!cells.length && ring === 0) continue;
      for (const arr of cells) {
        for (const other of arr) {
          if (!other || other === e) continue;
          const oFac = factionOf(other);
          if (!isHostileTo(eFac, oFac)) continue;
          const d = Math.abs(other.x - e.x) + Math.abs(other.y - e.y);
          if (d < bestDist) {
            bestDist = d;
            best = other;
          }
        }
      }
      if (best) break;
    }

    // Fallback to global scan if no local candidate found
    if (!best) {
      for (const other of enemies) {
        if (!other || other === e) continue;
        const oFac = factionOf(other);
        if (!isHostileTo(eFac, oFac)) continue;
        const d = Math.abs(other.x - e.x) + Math.abs(other.y - e.y);
        if (d < bestDist) {
          bestDist = d;
          best = other;
        }
      }
    }
    return best ? { kind: "enemy", x: best.x, y: best.y, ref: best, faction: factionOf(best) } : null;
  }

  for (const e of enemies) {
    const eFac = factionOf(e);

    // Choose a target among player and hostile factions
    // Neutral animals do not target or pursue the player unless made hostile.
    let target = null;
    let bestDist = Infinity;
    if (eFac !== "animal") {
      target = { kind: "player", x: player.x, y: player.y, ref: null, faction: "player" };
      bestDist = Math.abs(player.x - e.x) + Math.abs(player.y - e.y);
    }

    // Use spatial index for nearest hostile enemy
    const idxCand = nearestHostileFor(e);
    if (idxCand) {
      const d = Math.abs(idxCand.x - e.x) + Math.abs(idxCand.y - e.y);
      if (d < bestDist) {
        bestDist = d;
        target = idxCand;
      }
    }

    const dx = target ? (target.x - e.x) : 0;
    const dy = target ? (target.y - e.y) : 0;
    const dist = target ? (Math.abs(dx) + Math.abs(dy)) : Infinity;

    // Low-HP panic/flee (generic for all enemies)
    if (typeof e.hp === "number" && e.hp <= 2) {
      if (!(e._panicTurns > 0) && chance(0.2)) {
        e._panicTurns = 3;
      }
      if (typeof e._panicYellCd === "number" && e._panicYellCd > 0) e._panicYellCd -= 1;
      if ((e._panicYellCd | 0) <= 0 && (e._panicTurns | 0) > 0 && chance(0.35)) {
        // Animals should not speak; suppress panic lines for animal factions
        const fac = factionOf(e);
        if (fac !== "animal" && fac !== "animal_hostile") {
          try { ctx.log("I don't want to die!", "flavor"); } catch (_) {}
        }
        e._panicYellCd = 6;
      }
    }

    // Compute away-from-target (used by panic and mime_ghost against player)
    const sxAway = dx === 0 ? 0 : (dx > 0 ? -1 : 1);
    const syAway = dy === 0 ? 0 : (dy > 0 ? -1 : 1);
    const primaryAway = Math.abs(dx) > Math.abs(dy)
      ? [{ x: sxAway, y: 0 }, { x: 0, y: syAway }]
      : [{ x: 0, y: syAway }, { x: sxAway, y: 0 }];

    // If panicking, prefer to flee instead of fighting when possible
    if ((e._panicTurns | 0) > 0) {
      let fled = false;
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
      if (fled) continue;
    }

    // Special behavior: mime_ghost logic only cares about player proximity/LOS
    if (e.type === "mime_ghost") {
      if (typeof e._arghCd === "number" && e._arghCd > 0) e._arghCd -= 1;
      if ((e._arghCd | 0) <= 0 && chance(0.15)) {
        try { ctx.log("Argh!", "flavor"); } catch (_) {}
        e._arghCd = 3;
      }

      const pdx = player.x - e.x;
      const pdy = player.y - e.y;
      const pdist = Math.abs(pdx) + Math.abs(pdy);

      if (pdist === 1) {
        if (!chance(0.35)) {
          let moved = false;
          const pxAway = Math.abs(pdx) > Math.abs(pdy)
            ? [{ x: (pdx > 0 ? -1 : 1), y: 0 }, { x: 0, y: (pdy > 0 ? -1 : 1) }]
            : [{ x: 0, y: (pdy > 0 ? -1 : 1) }, { x: (pdx > 0 ? -1 : 1), y: 0 }];
          for (const d of pxAway) {
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
                occClearEnemy(occ, e.x, e.y);
                e.x = nx; e.y = ny;
                occSetEnemy(occ, e.x, e.y);
                moved = true;
                break;
              }
            }
          }
          if (moved) continue;
        }
      } else {
        if (pdist <= senseRange && hasLOS(ctx, e.x, e.y, player.x, player.y)) {
          let moved = false;
          const pxAway = Math.abs(pdx) > Math.abs(pdy)
            ? [{ x: (pdx > 0 ? -1 : 1), y: 0 }, { x: 0, y: (pdy > 0 ? -1 : 1) }]
            : [{ x: 0, y: (pdy > 0 ? -1 : 1) }, { x: (pdx > 0 ? -1 : 1), y: 0 }];
          for (const d of pxAway) {
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
                occClearEnemy(occ, e.x, e.y);
                e.x = nx; e.y = ny;
                occSetEnemy(occ, e.x, e.y);
                moved = true;
                break;
              }
            }
          }
          if (moved) continue;
        }
      }
    }

    // If no target (e.g., neutral animal), optionally wander and skip attacks
    if (!target) {
      if (chance(0.4)) {
        const d = WANDER_DIRS[randInt(0, WANDER_DIRS.length - 1)];
        const nx = e.x + d.x, ny = e.y + d.y;
        if (isFree(nx, ny)) {
          occClearEnemy(occ, e.x, e.y);
          e.x = nx; e.y = ny;
          occSetEnemy(occ, e.x, e.y);
        }
      }
      continue;
    }

    // Adjacent attack vs chosen target
    if (dist === 1) {
      const loc = ctx.rollHitLocation();

      if (target.kind === "player") {
        if (ctx.rng() < ctx.getPlayerBlockChance(loc)) {
          ctx.log(`You block the ${e.type || "enemy"}'s attack to your ${loc.part}.`, "block");
          if (ctx.Flavor && typeof ctx.Flavor.onBlock === "function") {
            ctx.Flavor.onBlock(ctx, { side: "player", attacker: e, defender: player, loc });
          }
          ctx.decayBlockingHands();
          ctx.decayEquipped("hands", randFloat(0.3, 1.0, 1));
          continue;
        }
        let raw = e.atk * (ctx.enemyDamageMultiplier ? ctx.enemyDamageMultiplier(e.level) : (1 + 0.15 * Math.max(0, (e.level || 1) - 1))) * (loc.mult || 1);
        let isCrit = false;
        const critChance = Math.max(0, Math.min(0.5, 0.10 + (loc.critBonus || 0)));
        if (ctx.rng() < critChance) {
          isCrit = true;
          raw *= (ctx.critMultiplier ? ctx.critMultiplier() : (1.6 + ctx.rng() * 0.4));
        }
        const dmg = ctx.enemyDamageAfterDefense(raw);
        player.hp -= dmg;
        try { if (typeof ctx.addBloodDecal === "function") ctx.addBloodDecal(player.x, player.y, isCrit ? 1.4 : 1.0); } catch (_) {}
        if (isCrit) ctx.log(`Critical! ${Cap(e.type)} hits your ${loc.part} for ${dmg}.`, "crit");
        else ctx.log(`${Cap(e.type)} hits your ${loc.part} for ${dmg}.`);
        const ST = ctx.Status || (typeof window !== "undefined" ? window.Status : null);
        if (isCrit && loc.part === "head" && ST && typeof ST.applyDazedToPlayer === "function") {
          const dur = (ctx.rng ? (1 + Math.floor(ctx.rng() * 2)) : 1);
          try { ST.applyDazedToPlayer(ctx, dur); } catch (_) {}
        }
        if (isCrit && ST && typeof ST.applyBleedToPlayer === "function") {
          try { ST.applyBleedToPlayer(ctx, 2); } catch (_) {}
        }
        if (ctx.Flavor && typeof ctx.Flavor.logHit === "function") {
          ctx.Flavor.logHit(ctx, { attacker: e, loc, crit: isCrit, dmg });
        }
        const critWear = isCrit ? 1.6 : 1.0;
        let wear = 0.5;
        if (loc.part === "torso") wear = randFloat(0.8, 2.0, 1);
        else if (loc.part === "head") wear = randFloat(0.3, 1.0, 1);
        else if (loc.part === "legs") wear = randFloat(0.4, 1.3, 1);
        else if (loc.part === "hands") wear = randFloat(0.3, 1.0, 1);
        ctx.decayEquipped(loc.part, wear * critWear);

        // Persistent injury tracker (cosmetic role; shown in Character Sheet via F1)
        try {
          if (!Array.isArray(player.injuries)) player.injuries = [];
          // Small chances, higher on crit. Limit duplicates.
          const addInjury = (name, { healable = true, durationTurns = 40 } = {}) => {
            if (!name) return;
            // avoid duplicates by name
            const exists = player.injuries.some(it => (typeof it === "string" ? it === name : it && it.name === name));
            if (!exists) {
              player.injuries.push({ name, healable, durationTurns: healable ? Math.max(10, durationTurns | 0) : 0 });
              // keep list short
              if (player.injuries.length > 24) player.injuries.splice(0, player.injuries.length - 24);
              try { ctx.log && ctx.log(`You suffer ${name}.`, "warn"); } catch (_) {}
            }
          };
          const r = rv();
          if (loc.part === "hands") {
            // Rare missing finger on crit; otherwise bruised knuckles
            if (isCrit && r < 0.08) addInjury("missing finger", { healable: false, durationTurns: 0 });
            else if (r < 0.20) addInjury("bruised knuckles", { healable: true, durationTurns: 30 });
          } else if (loc.part === "legs") {
            if (isCrit && r < 0.10) addInjury("sprained ankle", { healable: true, durationTurns: 80 });
            else if (r < 0.25) addInjury("bruised leg", { healable: true, durationTurns: 40 });
          } else if (loc.part === "head") {
            if (isCrit && r < 0.12) addInjury("facial scar", { healable: false, durationTurns: 0 });
            else if (r < 0.20) addInjury("black eye", { healable: true, durationTurns: 60 });
          } else if (loc.part === "torso") {
            if (isCrit && r < 0.10) addInjury("deep scar", { healable: false, durationTurns: 0 });
            else if (r < 0.22) addInjury("rib bruise", { healable: true, durationTurns: 50 });
          }
        } catch (_) {}

        if (player.hp <= 0) {
          player.hp = 0;
          if (typeof ctx.onPlayerDied === "function") ctx.onPlayerDied();
          return;
        }
        continue;
      } else if (target.kind === "enemy" && target.ref) {
        // Enemy vs enemy attack (no defense reduction for simplicity; allow block base)
        const blockChance = (typeof ctx.getEnemyBlockChance === "function") ? ctx.getEnemyBlockChance(target.ref, loc) : 0;
        if (ctx.rng() < blockChance) {
          try { ctx.log && ctx.log(`${Cap(target.ref.type)} blocks ${Cap(e.type)}'s attack.`, "block"); } catch (_) {}
        } else {
          let raw = e.atk * (ctx.enemyDamageMultiplier ? ctx.enemyDamageMultiplier(e.level) : (1 + 0.15 * Math.max(0, (e.level || 1) - 1))) * (loc.mult || 1);
          const isCrit = ctx.rng() < Math.max(0, Math.min(0.5, 0.10 + (loc.critBonus || 0)));
          if (isCrit) raw *= (ctx.critMultiplier ? ctx.critMultiplier() : (1.6 + ctx.rng() * 0.4));
          const dmg = Math.max(0.1, Math.round(raw * 10) / 10);
          target.ref.hp -= dmg;
          try { if (dmg > 0 && typeof ctx.addBloodDecal === "function") ctx.addBloodDecal(target.ref.x, target.ref.y, isCrit ? 1.2 : 0.9); } catch (_) {}
          try {
            ctx.log(`${Cap(e.type)} hits ${Cap(target.ref.type)} for ${dmg}.`, isCrit ? "crit" : "info");
          } catch (_) {}
          if (target.ref.hp <= 0 && typeof ctx.onEnemyDied === "function") {
            ctx.onEnemyDied(target.ref);
          }
        }
        continue;
      }
    }

    // movement/approach
    if (e.immobileTurns && e.immobileTurns > 0) {
      e.immobileTurns -= 1;
      continue;
    } else if (bestDist <= senseRange) {
      // Move toward chosen target
      const sx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
      const sy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
      const primary = Math.abs(dx) > Math.abs(dy) ? [{x:sx,y:0},{x:0,y:sy}] : [{x:0,y:sy},{x:sx,y:0}];

      let moved = false;
      for (const d of primary) {
        const nx = e.x + d.x;
        const ny = e.y + d.y;
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
        occSetEnemy(occ, e.x, e.y);
      }
    }
  }
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.AI = {
    enemiesAct,
  };
}