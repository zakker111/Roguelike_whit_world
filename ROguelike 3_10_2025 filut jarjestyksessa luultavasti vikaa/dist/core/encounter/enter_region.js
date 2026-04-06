/**
 * Encounter enterRegion (Phase 4 extraction): starts an encounter within existing Region Map mode.
 */
import { getMod } from "../../utils/access.js";

export function enterRegion(ctx, info) {
  if (!ctx || ctx.mode !== "region" || !ctx.map || !Array.isArray(ctx.map) || !ctx.map.length) return false;
  // Reset clear-announcement guard for region-embedded encounters too (no session flags module used here)
  const template = info && info.template ? info.template : { id: "ambush_forest", name: "Ambush", groups: [ { type: "bandit", count: { min: 2, max: 3 } } ] };
  const difficulty = Math.max(1, Math.min(5, (info && typeof info.difficulty === "number") ? (info.difficulty | 0) : 1));
  ctx.encounterDifficulty = difficulty;

  const WT = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : (ctx.World && ctx.World.TILES) ? ctx.World.TILES : null;
  const isWalkableWorld = (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function")
    ? window.World.isWalkable
    : (ctx.World && typeof ctx.World.isWalkable === "function") ? ctx.World.isWalkable : null;

  const H = ctx.map.length;
  const W = ctx.map[0] ? ctx.map[0].length : 0;
  if (!W || !H) return false;
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const r = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));

  // Initialize encounter state on region
  if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
  ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];

  // Helper: free spawn spot (walkable region tile, not on player, not duplicate)
  const placements = [];
  function walkableAt(x, y) {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    const t = ctx.map[y][x];
    if (isWalkableWorld) return !!isWalkableWorld(t);
    if (!WT) return true;
    // Fallback: avoid water/river/mountain
    return !(t === WT.WATER || t === WT.RIVER || t === WT.MOUNTAIN);
  }
  function free(x, y) {
    if (!walkableAt(x, y)) return false;
    if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return false;
    if (placements.some(p => p.x === x && p.y === y)) return false;
    return true;
  }

  // Determine total enemies from groups
  const groups = Array.isArray(template.groups) ? template.groups : [];
  const totalWanted = groups.reduce((acc, g) => {
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    const n = (RU && typeof RU.int === "function")
      ? RU.int(min, max, ctx.rng)
      : Math.max(min, Math.min(max, min + Math.floor((r() * (max - min + 1)))));
    return acc + n;
  }, 0);

  // Seed at least one placement near the player within FOV range to ensure visibility
  (function seedNearPlayer() {
    try {
      const px = (ctx.player.x | 0), py = (ctx.player.y | 0);
      const maxR = Math.max(3, Math.min(6, ((ctx.fovRadius | 0) || 8) - 1));
      outer:
      for (let r2 = 2; r2 <= maxR; r2++) {
        // Sample 16 directions around the ring
        const dirs = [
          [ r2,  0], [ 0,  r2], [-r2,  0], [ 0, -r2],
          [ r2,  1], [ 1,  r2], [-1,  r2], [-r2,  1],
          [-r2, -1], [-1, -r2], [ 1, -r2], [ r2, -1],
          [ r2,  2], [ 2,  r2], [-2,  r2], [-r2,  2],
        ];
        for (const d of dirs) {
          const x = px + d[0], y = py + d[1];
          if (free(x, y)) { placements.push({ x, y }); break outer; }
        }
      }
    } catch (_) {}
  })();

  // Collect edge-ring placements inward to avoid spawning adjacent to player
  let ring = 0, placed = placements.length | 0;
  while (placed < totalWanted && ring < Math.max(W, H)) {
    for (let x = 1 + ring; x < W - 1 - ring && placed < totalWanted; x++) {
      const y1 = 1 + ring, y2 = H - 2 - ring;
      if (free(x, y1)) { placements.push({ x, y: y1 }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x, y2)) { placements.push({ x, y: y2 }); placed++; }
    }
    for (let y = 2 + ring; y < H - 2 - ring && placed < totalWanted; y++) {
      const x1 = 1 + ring, x2 = W - 2 - ring;
      if (free(x1, y)) { placements.push({ x: x1, y }); placed++; }
      if (placed >= totalWanted) break;
      if (free(x2, y)) { placements.push({ x: x2, y }); placed++; }
    }
    ring++;
  }

  // Materialize enemies; honor group.type when provided
  let pIdx = 0;
  const depth = Math.max(1, (ctx.floor | 0) || 1);
  const deriveFaction = (t) => {
    const s = String(t || "").toLowerCase();
    if (s.includes("bandit")) return "bandit";
    if (s.includes("orc")) return "orc";
    return "monster";
  };
  for (const g of groups) {
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    let n = (RU && typeof RU.int === "function")
      ? RU.int(min, max, ctx.rng)
      : Math.max(min, Math.min(max, min + Math.floor((r() * (max - min + 1)))));
    // Difficulty raises group size modestly
    n = Math.max(min, Math.min(placements.length - pIdx, n + Math.max(0, (ctx.encounterDifficulty || 1) - 1)));
    for (let i = 0; i < n && pIdx < placements.length; i++) {
      const p = placements[pIdx++];
      const type = (g && typeof g.type === "string" && g.type) ? g.type : null;
      let e = type ? createEnemyOfType(ctx, p.x, p.y, depth, type) : createDungeonEnemyAt(ctx, p.x, p.y, depth);
      if (!e) { continue; }
      // Difficulty scaling: raise level/HP/ATK with diminishing returns
      try {
        const d = Math.max(1, Math.min(5, ctx.encounterDifficulty || 1));
        e.level = Math.max(1, (e.level | 0) + (d - 1));
        const hpMult = 1 + 0.25 * (d - 1);
        const atkMult = 1 + 0.20 * (d - 1);
        e.hp = Math.max(1, Math.round(e.hp * hpMult));
        e.atk = Math.max(0.1, Math.round(e.atk * atkMult * 10) / 10);
      } catch (_) {}
      try {
        e.faction = (g && g.faction) ? String(g.faction) : deriveFaction(e.type);
      } catch (_) {}
      ctx.enemies.push(e);
    }
  }

  // Build occupancy for region map
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}

  // Mark encounter-active in region and notify
  try { ctx.log && ctx.log(`${template.name || "Encounter"} begins here.`, "notice"); } catch (_) {}
  ctx.encounterInfo = { id: template.id, name: template.name || "Encounter" };
  if (!ctx.region) ctx.region = {};
  ctx.region._isEncounter = true;

  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  return true;

  // Helpers: enemy factories
  function createDungeonEnemyAt(ctxLocal, x, y, depth) {
    try {
      if (typeof ctxLocal.enemyFactory === "function") {
        const e = ctxLocal.enemyFactory(x, y, depth);
        if (e) return e;
      }
    } catch (_) {}
    try {
      const EM = ctxLocal.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
      if (EM && typeof EM.pickType === "function") {
        const type = EM.pickType(depth, ctxLocal.rng);
        const td = EM.getTypeDef && EM.getTypeDef(type);
        if (td) {
          const level = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctxLocal.rng) : depth;
          return {
            x, y,
            type,
            glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
            hp: td.hp(depth),
            atk: td.atk(depth),
            xp: td.xp(depth),
            level,
            announced: false
          };
        }
      }
    } catch (_) {}
    return { x, y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, faction: "monster", announced: false };
  }
  function createEnemyOfType(ctxLocal, x, y, depth, type) {
    try {
      const EM = ctxLocal.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
      if (EM && typeof EM.getTypeDef === "function") {
        const td = EM.getTypeDef(type);
        if (td) {
          const level = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctxLocal.rng) : depth;
          return {
            x, y,
            type,
            glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
            hp: td.hp(depth),
            atk: td.atk(depth),
            xp: td.xp(depth),
            level,
            announced: false
          };
        }
      }
    } catch (_) {}
    return { x, y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, faction: "monster", announced: false };
  }
}