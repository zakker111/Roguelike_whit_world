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

import { getTileDef } from "../data/tile_lookup.js";

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
  // Local RNG value helper: RNGUtils or ctx.rng; deterministic 0.5 when unavailable
  const rv = () => {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        const rfn = window.RNGUtils.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
        return rfn();
      }
    } catch (_) {}
    if (typeof ctx.rng === "function") return ctx.rng();
    return 0.5;
  };
  const randFloat = U && U.randFloat ? U.randFloat : (ctx.randFloat || ((a,b,dec=1)=>{const r=rv();const v=a+r*(b-a);const p=Math.pow(10,dec);return Math.round(v*p)/p;}));
  const randInt = U && U.randInt ? U.randInt : (ctx.randInt || ((min,max)=>{const r=rv();return Math.floor(r*(max-min+1))+min;}));
  const chance = U && U.chance ? U.chance : (ctx.chance || ((p)=>{const r=rv();return r<p;}));
  const Cap = U && U.capitalize ? U.capitalize : (s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  const senseRange = 8;

  // Walkability that respects Region Map tiles (using tiles.json for region) as well as dungeon
  function walkableAt(x, y) {
    try {
      if (!ctx.inBounds || !ctx.inBounds(x, y)) return false;
    } catch (_) {
      // best-effort bounds check
      const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
      const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    }
    // In region mode, prefer tiles.json properties for the "region" mode (honors RUIN_WALL, BERRY_BUSH, etc.).
    try {
      if (ctx.mode === "region") {
        const tile = ctx.map[y][x];
        const def = getTileDef("region", tile);
        if (def && def.properties && typeof def.properties.walkable === "boolean") {
          return !!def.properties.walkable;
        }
        const WT = (typeof window !== "undefined" && window.World) ? window.World : (ctx.World || null);
        if (WT && typeof WT.isWalkable === "function") return !!WT.isWalkable(tile);
        // Fallback: treat water/river/mountain as blocked
        const WTTiles = WT && WT.TILES ? WT.TILES : null;
        if (WTTiles) return !(tile === WTTiles.WATER || tile === WTTiles.RIVER || tile === WTTiles.MOUNTAIN);
      }
    } catch (_) {}
    // Default to ctx.isWalkable (dungeon/town)
    try { return !!ctx.isWalkable(x, y); } catch (_) {}
    return true;
  }

  // Faction helpers: consume explicit faction from data; no type-based inference.
  // Different non-neutral factions are hostile to each other. Player is a distinct faction.
  const factionOf = (en) => {
    if (!en) return "monster";
    if (en.faction) return String(en.faction);
    // Default to "monster" when missing; ensure data/entities/enemies.json provides faction for all entries.
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
          const blocked = !walkableAt(x, y) || (!ignorePlayer && player.x === x && player.y === y);
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
    const blocked = !walkableAt(x, y) || (player.x === x && player.y === y);
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

  function nearestHostileInLOS(e, maxRange) {
    const eFac = factionOf(e);
    const limit = (typeof maxRange === "number" && maxRange > 0) ? maxRange : senseRange;
    let best = null;
    let bestDist = Infinity;
    for (const other of enemies) {
      if (!other || other === e) continue;
      const oFac = factionOf(other);
      if (!isHostileTo(eFac, oFac)) continue;
      const dx = other.x - e.x;
      const dy = other.y - e.y;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > limit) continue;
      if (!hasLOS(ctx, e.x, e.y, other.x, other.y)) continue;
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best ? { kind: "enemy", x: best.x, y: best.y, ref: best, faction: factionOf(best) } : null;
  }

  for (const e of enemies) {
    const eFac = factionOf(e);
    const isFollower = !!(e && e._isFollower);

    // Ensure enemies have a maxHp baseline for healing logic.
    if (typeof e.maxHp !== "number" || e.maxHp <= 0) {
      e.maxHp = typeof e.hp === "number" ? e.hp : 1;
    }

    // Caravan ambush guards: give them a small stash of healing potions and let them use them at low HP.
    try {
      const isCaravanAmbush = ctx.mode === "encounter"
        && ctx.encounterInfo
        && String(ctx.encounterInfo.id || "").toLowerCase() === "caravan_ambush";
      const isGuard = (eFac === "guard");
      if (isCaravanAmbush && isGuard) {
        // Initialize potion count once per enemy: 0–2 potions that heal 6 HP each.
        if (!e._guardPotionsInit) {
          e._guardPotionsInit = true;
          e.guardPotions = randInt(0, 2);
        }
        // Use a potion when low on health, if any left.
        if (e.guardPotions > 0 && typeof e.hp === "number" && typeof e.maxHp === "number") {
          const lowThreshold = Math.max(3, Math.floor(e.maxHp * 0.4));
          if (e.hp > 0 && e.hp <= lowThreshold) {
            const before = e.hp;
            e.hp = Math.min(e.maxHp, e.hp + 6);
            e.guardPotions -= 1;
            const healed = e.hp - before;
            if (healed > 0) {
              try {
                ctx.log && ctx.log(`Guard drinks a healing potion and recovers ${healed} HP.`, "info");
              } catch (_) {}
            }
            // After drinking a potion, the guard spends their turn.
            continue;
          }
        }
      }
    } catch (_) {}

    // Choose a target among player and hostile factions
    // Neutral animals do not target or pursue the player unless made hostile.
    // Guards in special encounters can start neutral to the player via e._ignorePlayer.
    let target = null;
    let bestDist = Infinity;
    const considerPlayer = !isFollower && (eFac !== "animal") && !e._ignorePlayer;
    if (considerPlayer) {
      target = { kind: "player", x: player.x, y: player.y, ref: null, faction: "player" };
      bestDist = Math.abs(player.x - e.x) + Math.abs(player.y - e.y);
    }

    // Use spatial index for nearest hostile enemy. Followers only consider
    // enemies that are within their own line of sight.
    const idxCand = isFollower ? nearestHostileInLOS(e, senseRange) : nearestHostileFor(e);
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
      // Reduce yelling frequency: one immediate yell on first sight, then at most once every 5 turns.
      if (typeof e._arghCd === "number" && e._arghCd > 0) e._arghCd -= 1;
      const pdistNow = Math.abs(player.x - e.x) + Math.abs(player.y - e.y);
      if (pdistNow <= senseRange && hasLOS(ctx, e.x, e.y, player.x, player.y)) {
        if (!e._arghDoneOnce) {
          try { ctx.log("Argh!", "flavor", { category: "Combat", side: "enemy" }); } catch (_) {}
          e._arghDoneOnce = true;
          e._arghCd = 5;
        } else if ((e._arghCd | 0) <= 0) {
          if (chance(0.30)) {
            try { ctx.log("Argh!", "flavor", { category: "Combat", side: "enemy" }); } catch (_) {}
            e._arghCd = 5;
          }
        }
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
      if (isFollower) {
        // Followers without a visible hostile target follow the player instead
        const dxp = player.x - e.x;
        const dyp = player.y - e.y;
        const distP = Math.abs(dxp) + Math.abs(dyp);
        const followRange = 2;
        if (distP > followRange) {
          const sx = dxp === 0 ? 0 : (dxp > 0 ? 1 : -1);
          const sy = dyp === 0 ? 0 : (dyp > 0 ? 1 : -1);
          const primary = Math.abs(dxp) > Math.abs(dyp)
            ? [{ x: sx, y: 0 }, { x: 0, y: sy }]
            : [{ x: 0, y: sy }, { x: sx, y: 0 }];

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
        }
      } else if (chance(0.4)) {
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
        if (rv() < ctx.getPlayerBlockChance(loc)) {
          const attackerName = e.name || Cap(e.type || "enemy");
          ctx.log(`You block ${attackerName}'s attack to your ${loc.part}.`, "block", { category: "Combat", side: "player" });
          if (ctx.Flavor && typeof ctx.Flavor.onBlock === "function") {
            ctx.Flavor.onBlock(ctx, { side: "player", attacker: e, defender: player, loc });
          }
          ctx.decayBlockingHands();
          ctx.decayEquipped("hands", randFloat(0.3, 1.0, 1));
          continue;
        }
        const level = (typeof e.level === "number" && e.level > 0) ? e.level : 1;
        const typeScale = (typeof e.damageScale === "number" && e.damageScale > 0) ? e.damageScale : 1.0;
        const baseMult = 1 + 0.15 * Math.max(0, level - 1);
        const globalMult = (ctx.enemyDamageMultiplier ? ctx.enemyDamageMultiplier(level) : baseMult);
        let raw = e.atk * globalMult * typeScale * (loc.mult || 1);

        // Caravan ambush guards: slightly lower base damage, then scale a bit with player level.
        try {
          const isCaravanAmbush = ctx.mode === "encounter"
            && ctx.encounterInfo
            && String(ctx.encounterInfo.id || "").toLowerCase() === "caravan_ambush";
          const eFac2 = factionOf(e);
          if (isCaravanAmbush && eFac2 === "guard") {
            const pLv = (player && typeof player.level === "number") ? player.level : 1;
            const lvlScale = Math.min(1.25, 0.6 + (pLv / 12)); // ~0.6 at low level, up to ~1.25
            raw *= 0.7 * lvlScale; // reduce base damage a bit, then scale with player level
          }
        } catch (_) {}

        let isCrit = false;
        const critChance = Math.max(0, Math.min(0.5, 0.10 + (loc.critBonus || 0)));
        if (rv() < critChance) {
          isCrit = true;
          raw *= (ctx.critMultiplier ? ctx.critMultiplier(rv) : (1.6 + rv() * 0.4));
        }
        const dmg = ctx.enemyDamageAfterDefense(raw);
        player.hp -= dmg;
        try { if (typeof ctx.addBloodDecal === "function") ctx.addBloodDecal(player.x, player.y, isCrit ? 1.4 : 1.0); } catch (_) {}

        const attackerName = e.name || Cap(e.type || "enemy");
        if (isCrit) ctx.log(`Critical! ${attackerName} hits your ${loc.part} for ${dmg}.`, "crit", { category: "Combat", side: "enemy" });
        else ctx.log(`${attackerName} hits your ${loc.part} for ${dmg}.`, "info", { category: "Combat", side: "enemy" });
        const ST = ctx.Status || (typeof window !== "undefined" ? window.Status : null);
        if (isCrit && loc.part === "head" && ST && typeof ST.applyDazedToPlayer === "function") {
          const dur = 1 + Math.floor(rv() * 2);
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
        // Enemy vs enemy attack (no defense reduction for simplicity; allow block + crits + logs)
        const blockChance = (typeof ctx.getEnemyBlockChance === "function") ? ctx.getEnemyBlockChance(target.ref, loc) : 0;
        if (rv() < blockChance) {
          try {
            const attackerName = e.name || Cap(e.type || "enemy");
            const defenderName = target.ref.name || Cap(target.ref.type || "enemy");
            ctx.log && ctx.log(
              `${defenderName} blocks ${attackerName}'s attack to the ${loc.part}.`,
              "block",
              { category: "Combat", side: "enemy" }
            );
          } catch (_) {}

          // Follower weapon decay on blocked attack (always light)
          if (isFollower) {
            try {
              const FI = (typeof window !== "undefined" ? window.FollowersItems : null);
              if (FI && typeof FI.decayFollowerHands === "function") {
                FI.decayFollowerHands(ctx, e._followerId || e.type || e.id, { light: true });
              }
            } catch (_) {}
          }
        } else {
          const level = (typeof e.level === "number" && e.level > 0) ? e.level : 1;
          const typeScale = (typeof e.damageScale === "number" && e.damageScale > 0) ? e.damageScale : 1.0;
          const baseMult = 1 + 0.15 * Math.max(0, level - 1);
          const globalMult = (ctx.enemyDamageMultiplier ? ctx.enemyDamageMultiplier(level) : baseMult);
          let raw = e.atk * globalMult * typeScale * (loc.mult || 1);
          const isCrit = rv() < Math.max(0, Math.min(0.5, 0.10 + (loc.critBonus || 0)));
          if (isCrit) raw *= (ctx.critMultiplier ? ctx.critMultiplier(rv) : (1.6 + rv() * 0.4));
          const dmg = Math.max(0.1, Math.round(raw * 10) / 10);
          target.ref.hp -= dmg;

          // Follower weapon decay after a successful hit (light vs normal based on crit)
          if (isFollower) {
            try {
              const FI = (typeof window !== "undefined" ? window.FollowersItems : null);
              if (FI && typeof FI.decayFollowerHands === "function") {
                FI.decayFollowerHands(ctx, e._followerId || e.type || e.id, { light: !isCrit });
              }
            } catch (_) {}
          }

          // If the defender is a follower, apply armor decay on the hit location
          try {
            if (target.ref && target.ref._isFollower) {
              const FI = (typeof window !== "undefined" ? window.FollowersItems : null);
              if (FI && typeof FI.decayFollowerEquipped === "function") {
                const part = loc.part;
                const armorSlot = (part === "torso" || part === "head" || part === "legs" || part === "hands") ? part : null;
                if (armorSlot) {
                  const critWear = isCrit ? 1.6 : 1.0;
                  let wear = 0.5;
                  if (part === "torso") wear = randFloat(0.8, 2.0, 1);
                  else if (part === "head") wear = randFloat(0.3, 1.0, 1);
                  else if (part === "legs") wear = randFloat(0.4, 1.3, 1);
                  else if (part === "hands") wear = randFloat(0.3, 1.0, 1);
                  FI.decayFollowerEquipped(ctx, target.ref._followerId || target.ref.type || target.ref.id, armorSlot, wear * critWear);
                }
              }
            }
          } catch (_) {}

          // Record last hit so death flavor can attribute killer, hit location, and likely weapon
          try {
            const killerType = String(e.type || "enemy");

            // Follower-specific weapon lookup: prefer actual equipped weapon names.
            function weaponNameForFollower(ctxLocal, followerEntity) {
              try {
                if (!ctxLocal || !ctxLocal.player || !Array.isArray(ctxLocal.player.followers)) return null;
                if (!followerEntity || !followerEntity._isFollower) return null;
                const fid = followerEntity._followerId != null ? String(followerEntity._followerId) : String(followerEntity.type || "");
                if (!fid) return null;
                const rec = ctxLocal.player.followers.find(f => f && String(f.id) === fid);
                if (!rec || !rec.equipment || typeof rec.equipment !== "object") return null;
                const eq = rec.equipment;
                // Prefer right hand, then left, then any hand item with atk, then any named item.
                const candidates = [];
                if (eq.right) candidates.push(eq.right);
                if (eq.left) candidates.push(eq.left);
                // If neither hand had something, scan all slots for an equipped weapon-like item.
                if (!candidates.length) {
                  const slots = ["head", "torso", "legs", "hands"];
                  for (let i = 0; i < slots.length; i++) {
                    const it = eq[slots[i]];
                    if (it && (typeof it.atk === "number" || typeof it.name === "string")) {
                      candidates.push(it);
                    }
                  }
                }
                const pick = candidates.find(it => typeof it.atk === "number") || candidates[0];
                if (!pick) return null;
                return pick.name || pick.id || null;
              } catch (_) {
                return null;
              }
            }

            function rngPick(r) {
              try {
                const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
                if (RU && typeof RU.getRng === "function") {
                  const base = (typeof r === "function") ? r : ((typeof ctx.rng === "function") ? ctx.rng : undefined);
                  return RU.getRng(base);
                }
              } catch (_) {}
              if (typeof r === "function") return r;
              if (typeof ctx.rng === "function") return ctx.rng;
              // Deterministic fallback when RNG service is unavailable
              return () => 0.5;
            }

            function pickWeighted(entries, rfn) {
              if (!Array.isArray(entries) || entries.length === 0) return null;
              let total = 0;
              for (const en of entries) total += (en.w || 0);
              if (total <= 0) return entries[0].key || entries[0].value || entries[0];
              let roll = rfn() * total;
              for (const en of entries) {
                const w = en.w || 0;
                if (roll < w) return en.key || en.value || null;
                roll -= w;
              }
              return entries[0].key || entries[0].value || entries[0];
            }

            function weaponNameFromEnemyPool(killer) {
              try {
                const IT = (typeof window !== "undefined" ? window.Items : null);
                const EN = (typeof window !== "undefined" ? window.Enemies : null);
                if (!EN || typeof EN.getDefById !== "function" || !killer) return null;
                const key = String(killer).toLowerCase();
                const def = EN.getDefById(key);
                if (!def || !def.lootPools || typeof def.lootPools !== "object") return null;

                // Prefer explicit weapons pool if present; otherwise treat flat entries as keys
                let weaponEntries = null;
                if (def.lootPools.weapons && typeof def.lootPools.weapons === "object") {
                  weaponEntries = Object.keys(def.lootPools.weapons).map(k => ({ key: k, w: Math.max(0, Number(def.lootPools.weapons[k] || 0)) }));
                } else {
                  const flat = [];
                  const src = def.lootPools;
                  for (const k of Object.keys(src)) {
                    const w = Math.max(0, Number(src[k] || 0));
                    if (!(w > 0)) continue;
                    // Validate item key exists and is a hand-slot weapon
                    if (!IT || typeof IT.getTypeDef !== "function") continue;
                    const idef = IT.getTypeDef(k);
                    if (idef && idef.slot === "hand") flat.push({ key: k, w });
                  }
                  weaponEntries = flat;
                }
                if (!weaponEntries || weaponEntries.length === 0) return null;

                const rfn = rngPick();
                const chosenKey = pickWeighted(weaponEntries, rfn);
                if (!chosenKey || !IT || typeof IT.createByKey !== "function") return null;
                const tier = EN && typeof EN.equipTierFor === "function" ? EN.equipTierFor(key) : 1;
                const item = IT.createByKey(chosenKey, tier, rfn);
                return item && item.name ? item.name : null;
              } catch (_) { return null; }
            }

            // Prefer real follower weapon name when the killer is a follower; fall back to enemy loot pool.
            let weapName = null;
            if (e && e._isFollower) {
              weapName = weaponNameForFollower(ctx, e);
            }
            if (!weapName) {
              weapName = weaponNameFromEnemyPool(killerType);
            }

            const viaStr = weapName ? `with ${weapName}` : "melee";
            const killerDisplayName = e.name || Cap(e.type || "enemy");
            target.ref._lastHit = {
              by: killerType,
              part: loc.part,
              crit: isCrit,
              dmg,
              weapon: weapName,
              via: viaStr,
              killerName: killerDisplayName,
              isFollower: !!(e && e._isFollower)
            };
          } catch (_) {}

          try {
            const ttype = String(target.ref.type || "");
            const ethereal = /ghost|spirit|wraith|skeleton/i.test(ttype);
            if (!ethereal && dmg > 0 && typeof ctx.addBloodDecal === "function") {
              ctx.addBloodDecal(target.ref.x, target.ref.y, isCrit ? 1.2 : 0.9);
            }
          } catch (_) {}
          try {
            const attackerName = e.name || Cap(e.type || "enemy");
            const defenderName = target.ref.name || Cap(target.ref.type || "enemy");
            if (isCrit) {
              ctx.log(
                `Critical! ${attackerName} hits ${defenderName}'s ${loc.part} for ${dmg}.`,
                "crit",
                { category: "Combat", side: "enemy" }
              );
            } else {
              ctx.log(
                `${attackerName} hits ${defenderName}'s ${loc.part} for ${dmg}.`,
                "info",
                { category: "Combat", side: "enemy" }
              );
            }
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