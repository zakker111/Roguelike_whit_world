/**
 * EncounterRuntime: compact, single-scene skirmishes triggered from overworld.
 *
 * Exports (ESM + window.EncounterRuntime):
 * - enter(ctx, info): switches to encounter mode and generates a tactical map
 * - tryMoveEncounter(ctx, dx, dy): movement during encounter (bump to attack)
 * - tick(ctx): drives AI and completes encounter on kill-all
 */
// Module-level flag to avoid spamming "Area clear" logs across ctx recreations
let _clearAnnounced = false;

function createDungeonEnemyAt(ctx, x, y, depth) {
  // Prefer the same factory used by dungeon floors
  try {
    if (typeof ctx.enemyFactory === "function") {
      const e = ctx.enemyFactory(x, y, depth);
      if (e) return e;
    }
  } catch (_) {}
  // Use Enemies registry to pick a type by depth (JSON-only)
  try {
    const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
    if (EM && typeof EM.pickType === "function") {
      const type = EM.pickType(depth, ctx.rng);
      const td = EM.getTypeDef && EM.getTypeDef(type);
      if (td) {
        const level = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth;
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
  // Fallback enemy: visible '?' for debugging
  try { ctx.log && ctx.log("Fallback enemy spawned (auto-pick failed).", "warn"); } catch (_) {}
  return { x, y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, faction: "monster", announced: false };
}

// Create a specific enemy type defined in data/enemies.json; JSON-only (no fallbacks).
function createEnemyOfType(ctx, x, y, depth, type) {
  try {
    const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
    if (EM && typeof EM.getTypeDef === "function") {
      const td = EM.getTypeDef(type);
      if (td) {
        const level = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth;
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
  // Fallback enemy: visible '?' for debugging
  try { ctx.log && ctx.log("Fallback enemy spawned (auto-pick failed).", "warn"); } catch (_) {}
  return { x, y, type: "fallback_enemy", glyph: "?", hp: 3, atk: 1, xp: 5, level: depth, faction: "monster", announced: false };
}

export function enter(ctx, info) {
  if (!ctx || !ctx.world || !ctx.world.map) return false;
  // Reset clear-announcement guard for this encounter session
  _clearAnnounced = false;

  const template = info && info.template ? info.template : { id: "ambush_forest", name: "Ambush", map: { w: 24, h: 16 }, groups: [ { count: { min: 2, max: 3 } } ] };
  const biome = info && info.biome ? String(info.biome).toUpperCase() : null;
  const difficulty = Math.max(1, Math.min(5, (info && typeof info.difficulty === "number") ? (info.difficulty | 0) : 1));
  ctx.encounterBiome = biome;
  ctx.encounterDifficulty = difficulty;

  // Remember return position in overworld
  const worldX = ctx.player.x | 0;
  const worldY = ctx.player.y | 0;
  ctx.worldReturnPos = { x: worldX, y: worldY };

  // Switch to encounter mode and build a small tactical map
  const W = Math.max(18, Math.min(60, (template.map && template.map.w) ? template.map.w : 24));
  const H = Math.max(12, Math.min(40, (template.map && template.map.h) ? template.map.h : 16));

  ctx.mode = "encounter";
  // Use dungeon-style tiles (Render falls back to dungeon renderer for unknown modes)
  const T = ctx.TILES;

  // Decor/state helpers
  const hutCenters = [];
  const chestSpots = new Set();
  const encProps = [];
  const keyFor = (x, y) => `${x},${y}`;

  // Simple generator set for varied arenas (kept intentionally minimal)
  // Do not enclose the map with border walls; outer-of-bounds already prevents walking outside.
  function genEmpty() {
    const m = Array.from({ length: H }, () => Array(W).fill(T.FLOOR));
    return m;
  }
  function genAmbushForest(rng) {
    const m = genEmpty();
    const clusters = Math.max(3, Math.floor((W * H) / 80));
    for (let i = 0; i < clusters; i++) {
      const cx = 2 + Math.floor((rng() * (W - 4)));
      const cy = 2 + Math.floor((rng() * (H - 4)));
      const r = 1 + Math.floor(rng() * 2); // radius 1..2
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
          if ((dx*dx + dy*dy) <= (r*r) && rng() < 0.85) m[y][x] = T.WALL; // tree clump
        }
      }
    }
    // Clear a circle around center so player has breathing room
    const px = (W / 2) | 0, py = (H / 2) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = px + dx, y = py + dy;
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.FLOOR;
      }
    }
    return m;
  }
  function genCamp(rng) {
    const m = genEmpty();
    // Place 2–4 small huts (3x3 walls with one door)
    const huts = 2 + Math.floor(rng() * 3);
    const taken = [];
    const hutDoors = [];
    for (let i = 0; i < huts; i++) {
      let tries = 0;
      while (tries++ < 80) {
        const x0 = 2 + Math.floor(rng() * (W - 5));
        const y0 = 2 + Math.floor(rng() * (H - 5));
        // avoid overlapping centers
        if (taken.some(t => Math.abs(t.x - x0) < 4 && Math.abs(t.y - y0) < 4)) continue;
        taken.push({ x: x0, y: y0 });
        // hut perimeter
        for (let x = x0; x < x0 + 3; x++) { m[y0][x] = T.WALL; m[y0 + 2][x] = T.WALL; }
        for (let y = y0; y < y0 + 3; y++) { m[y][x0] = T.WALL; m[y][x0 + 2] = T.WALL; }
        // carve a random door and record its outward direction
        const side = Math.floor(rng() * 4);
        if (side === 0) { m[y0][x0 + 1] = T.DOOR; hutDoors.push({ x: x0 + 1, y: y0, dx: 0, dy: -1 }); }
        else if (side === 1) { m[y0 + 2][x0 + 1] = T.DOOR; hutDoors.push({ x: x0 + 1, y: y0 + 2, dx: 0, dy: 1 }); }
        else if (side === 2) { m[y0 + 1][x0] = T.DOOR; hutDoors.push({ x: x0, y: y0 + 1, dx: -1, dy: 0 }); }
        else { m[y0 + 1][x0 + 2] = T.DOOR; hutDoors.push({ x: x0 + 2, y: y0 + 1, dx: 1, dy: 0 }); }
        // record hut center for chest placement
        hutCenters.push({ x: x0 + 1, y: y0 + 1 });
        break;
      }
    }
    // Add a central clearing
    const px = (W / 2) | 0, py = (H / 2) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m[py + dy][px + dx] = T.FLOOR;

    // Helper: check free floor and not colliding with existing props
    const propUsed = () => new Set(encProps.map(p => `${p.x},${p.y}`));
    function canPlace(x, y) {
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
      if (m[y][x] !== T.FLOOR) return false;
      const k = `${x},${y}`;
      if (propUsed().has(k)) return false;
      return true;
    }

    // Add 2 decorative campfires near center and benches around them
    const fireCandidates = [
      { x: px + 2, y: py }, { x: px - 2, y: py },
      { x: px, y: py + 2 }, { x: px, y: py - 2 }
    ];
    let fires = 0;
    for (const f of fireCandidates) {
      if (fires >= 2) break;
      if (canPlace(f.x, f.y)) {
        encProps.push({ x: f.x, y: f.y, type: "campfire" });
        fires++;
        // place up to two benches adjacent
        const benchCandidates = [
          { x: f.x + 1, y: f.y }, { x: f.x - 1, y: f.y },
          { x: f.x, y: f.y + 1 }, { x: f.x, y: f.y - 1 }
        ];
        let benches = 0;
        for (const b of benchCandidates) {
          if (benches >= 2) break;
          if (canPlace(b.x, b.y)) {
            encProps.push({ x: b.x, y: b.y, type: "bench" });
            benches++;
          }
        }
      }
    }

    // Add crates/barrels just outside hut doors
    for (const d of hutDoors) {
      const ox = d.x + d.dx, oy = d.y + d.dy;
      const side1 = { x: d.x + d.dy, y: d.y - d.dx };
      const side2 = { x: d.x - d.dy, y: d.y + d.dx };
      const choices = [ { x: ox, y: oy }, side1, side2 ];
      for (const c of choices) {
        if (canPlace(c.x, c.y)) {
          const kind = (rng() < 0.5) ? "crate" : "barrel";
          encProps.push({ x: c.x, y: c.y, type: kind });
          break;
        }
      }
    }

    return m;
  }
  function genRuins(rng) {
    const m = genEmpty();
    // Scatter short wall segments
    const segs = Math.max(4, Math.floor((W + H) / 6));
    for (let i = 0; i < segs; i++) {
      const len = 2 + Math.floor(rng() * 5);
      const x0 = 2 + Math.floor(rng() * (W - 4));
      const y0 = 2 + Math.floor(rng() * (H - 4));
      const horiz = rng() < 0.5;
      for (let k = 0; k < len; k++) {
        const x = x0 + (horiz ? k : 0);
        const y = y0 + (horiz ? 0 : k);
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.WALL;
      }
    }
    // Clear spawn pocket
    const px = (W / 2) | 0, py = (H / 2) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = px + dx, y = py + dy;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.FLOOR;
    }
    return m;
  }
  function genArena(rng) {
    const m = genEmpty();
    // Plus-shaped barriers
    const cx = (W / 2) | 0, cy = (H / 2) | 0;
    for (let x = 2; x < W - 2; x++) { if (Math.abs(x - cx) > 1) m[cy][x] = T.WALL; }
    for (let y = 2; y < H - 2; y++) { if (Math.abs(y - cy) > 1) m[y][cx] = T.WALL; }
    // Open few gaps
    m[cy][2 + Math.floor(rng() * Math.max(1, cx - 3))] = T.DOOR;
    m[cy][(W - 3) - Math.floor(rng() * Math.max(1, cx - 3))] = T.DOOR;
    m[2 + Math.floor(rng() * Math.max(1, cy - 3))][cx] = T.DOOR;
    m[(H - 3) - Math.floor(rng() * Math.max(1, cy - 3))][cx] = T.DOOR;
    return m;
  }

  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const r = (RU && typeof RU.getRng === "function") ? RU.getRng(ctx.rng) : ((typeof ctx.rng === "function") ? ctx.rng : Math.random);
  let genId = (template && template.map && template.map.generator) ? String(template.map.generator) : "";
  let map = null;

  // Auto-select generator by biome when not specified or set to "auto"
  const b = (biome || "").toUpperCase();
  if (!genId || genId.toLowerCase() === "auto") {
    if (b === "FOREST") genId = "ambush_forest";
    else if (b === "GRASS") genId = "arena";
    else if (b === "DESERT") genId = "ruins";
    else if (b === "BEACH") genId = "arena";
    else if (b === "SNOW") genId = "ruins";
    else if (b === "SWAMP") genId = "ambush_forest";
    else genId = "ambush_forest";
  }

  const id = genId.toLowerCase();
  if (id === "ambush_forest" || id === "ambush" || id === "forest") map = genAmbushForest(r);
  else if (id === "camp" || id === "bandit_camp" || id === "camp_small") map = genCamp(r);
  else if (id === "ruins" || id === "ruin") map = genRuins(r);
  else if (id === "arena" || id === "cross") map = genArena(r);
  else map = genEmpty();

  ctx.map = map;
  ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.encounterProps = encProps;
  ctx.encounterObjective = null;

  // Special case: traveling merchant encounter (e.g., Wild Seppo)
  try {
    const isSeppo = (template && ((template.merchant && String(template.merchant.vendor).toLowerCase() === "seppo") || String(template.id || "").toLowerCase() === "wild_seppo"));
    if (isSeppo) {
      // Place merchant on a safe floor tile near the player but not on top of them, away from chests/exits/props
      const used = new Set(encProps.map(p => keyFor(p.x, p.y)));
      function canPlace(x, y) {
        if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
        if (map[y][x] !== T.FLOOR) return false;
        if (x === ctx.player.x && y === ctx.player.y) return false;
        if (used.has(keyFor(x, y))) return false;
        if (chestSpots.has(keyFor(x, y))) return false;
        // Avoid exits
        if (map[y][x] === T.STAIRS) return false;
        return true;
      }
      const cx0 = (W / 2) | 0, cy0 = (H / 2) | 0;
      let mx = -1, my = -1;
      // Try a small ring search around center, then around player
      outer1:
      for (let r1 = 2; r1 <= 5; r1++) {
        for (let dx = -r1; dx <= r1; dx++) {
          const dy = r1 - Math.abs(dx);
          const xs = [cx0 + dx, cx0 - dx];
          const ys = [cy0 + dy, cy0 - dy];
          for (const xx of xs) for (const yy of ys) {
            const x = xx | 0, y = yy | 0;
            if (canPlace(x, y)) { mx = x; my = y; break outer1; }
          }
        }
      }
      if (mx < 0) {
        const px0 = ctx.player.x | 0, py0 = ctx.player.y | 0;
        outer2:
        for (let r2 = 2; r2 <= 6; r2++) {
          for (let dx = -r2; dx <= r2; dx++) {
            const dy = r2 - Math.abs(dx);
            const xs = [px0 + dx, px0 - dx];
            const ys = [py0 + dy, py0 - dy];
            for (const xx of xs) for (const yy of ys) {
              const x = xx | 0, y = yy | 0;
              if (canPlace(x, y)) { mx = x; my = y; break outer2; }
            }
          }
        }
      }
      if (mx >= 0) {
        encProps.push({ x: mx, y: my, type: "merchant", name: "Seppo", vendor: "seppo" });
      }
    }
  } catch (_) {}

  // Add simple exit tiles near each edge so the player can always walk out.
  // These use the STAIRS tile, consistent with dungeon exit semantics.
  try {
    const cx = (W / 2) | 0, cy = (H / 2) | 0;
    const exits = [
      { x: 1, y: cy },            // West edge
      { x: W - 2, y: cy },        // East edge
      { x: cx, y: 1 },            // North edge
      { x: cx, y: H - 2 },        // South edge
    ];
    for (const e of exits) {
      if (e.x > 0 && e.y > 0 && e.x < W - 1 && e.y < H - 1) {
        map[e.y][e.x] = T.STAIRS;
        // Ensure a small clearing around the exit so it's accessible
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = e.x + dx, y = e.y + dy;
            if (x > 0 && y > 0 && x < W - 1 && y < H - 1) {
              if (map[y][x] === T.WALL) map[y][x] = T.FLOOR;
            }
          }
        }
      }
    }
  } catch (_) {}

  // Spawn player: support edge spawn hint from template for easier debugging/entry safety
  (function placePlayer() {
    const hint = (template && (template.playerSpawn || template.spawn || template.player)) ? (template.playerSpawn || template.spawn || template.player) : null;
    if (typeof hint === "string" && hint.toLowerCase() === "edge") {
      // Try to place at a random edge clearing (prefer stairs/exits if already carved)
      const edges = [
        { x: 1, y: (H / 2) | 0 },
        { x: W - 2, y: (H / 2) | 0 },
        { x: (W / 2) | 0, y: 1 },
        { x: (W / 2) | 0, y: H - 2 },
      ];
      for (const e of edges) {
        if (e.x > 0 && e.y > 0 && e.x < W - 1 && e.y < H - 1 && map[e.y][e.x] !== T.WALL) {
          ctx.player.x = e.x; ctx.player.y = e.y;
          return;
        }
      }
    }
    // Default: near center
    const px = (W / 2) | 0, py = (H / 2) | 0;
    ctx.player.x = px; ctx.player.y = py;
  })();

  // Place chests inside huts (center tile). Fill with simple loot.
  try {
    const L = ctx.Loot || (typeof window !== "undefined" ? window.Loot : null);
    for (let i = 0; i < hutCenters.length; i++) {
      const c = hutCenters[i];
      if (c.x <= 0 || c.y <= 0 || c.x >= W - 1 || c.y >= H - 1) continue;
      if (map[c.y][c.x] !== T.FLOOR) continue;
      // Avoid placing on player start
      if (c.x === ctx.player.x && c.y === ctx.player.y) continue;
      const loot = (L && typeof L.generate === "function") ? (L.generate(ctx, { type: "bandit", xp: 10 }) || []) : [{ name: "5 gold", kind: "gold", amount: 5 }];
      ctx.corpses.push({ kind: "chest", x: c.x, y: c.y, loot, looted: loot.length === 0 });
      chestSpots.add(keyFor(c.x, c.y));
    }
  } catch (_) {}

  // Objectives: surviveTurns, reachExit, rescueTarget
  (function setupObjective() {
    try {
      const obj = (template && template.objective) ? template.objective : null;
      if (!obj || !obj.type) return;
      const t = String(obj.type).toLowerCase();
      if (t === "surviveturns") {
        const turns = Math.max(1, (obj.turns | 0) || 8);
        ctx.encounterObjective = { type: "surviveTurns", turnsRemaining: turns, status: "active" };
        try { ctx.log && ctx.log(`Objective: Survive for ${turns} turns.`, "notice"); } catch (_) {}
      } else if (t === "reachexit") {
        ctx.encounterObjective = { type: "reachExit", status: "active" };
        try { ctx.log && ctx.log("Objective: Reach an exit (>).", "notice"); } catch (_) {}
      } else if (t === "rescuetarget") {
        // Place a non-blocking captive prop on a safe floor tile away from player
        function canPlace(x, y) {
          if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
          if (map[y][x] !== T.FLOOR) return false;
          if (x === ctx.player.x && y === ctx.player.y) return false;
          if (chestSpots.has(keyFor(x, y))) return false;
          // avoid exits
          if (map[y][x] === T.STAIRS) return false;
          // avoid existing props
          if (encProps.some(p => p.x === x && p.y === y)) return false;
          return true;
        }
        let tx = -1, ty = -1;
        // Prefer hut centers if available
        for (const c of hutCenters) {
          if (canPlace(c.x, c.y)) { tx = c.x; ty = c.y; break; }
        }
        if (tx < 0) {
          // Search ring around player
          const maxR = Math.max(3, Math.min(10, ((ctx.fovRadius | 0) || 8)));
          const px = (W / 2) | 0, py = (H / 2) | 0;
          outer:
          for (let r = 3; r <= maxR; r++) {
            for (let dx = -r; dx <= r; dx++) {
              const xs = [px + dx, px - dx];
              const ys = [py + (r - Math.abs(dx)), py - (r - Math.abs(dx))];
              for (const x0 of xs) for (const y0 of ys) {
                const x = x0 | 0, y = y0 | 0;
                if (canPlace(x, y)) { tx = x; ty = y; break outer; }
              }
            }
          }
        }
        if (tx >= 0) {
          encProps.push({ x: tx, y: ty, type: "captive" });
          ctx.encounterObjective = { type: "rescueTarget", status: "active", rescued: false, target: { x: tx, y: ty } };
          try { ctx.log && ctx.log("Objective: Rescue the captive (stand on them), then reach an exit (>) to leave.", "notice"); } catch (_) {}
        } else {
          // Fallback to survive turns if placement failed
          const turns = Math.max(1, (obj.turns | 0) || 6);
          ctx.encounterObjective = { type: "surviveTurns", turnsRemaining: turns, status: "active" };
          try { ctx.log && ctx.log(`Objective: Survive for ${turns} turns.`, "notice"); } catch (_) {}
        }
      }
    } catch (_) {}
  })();

  // Spawn enemies per template groups (counts only)
  const groups = Array.isArray(template.groups) ? template.groups : [];
  const totalWanted = groups.reduce((acc, g) => {
    const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
    const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
    const n = (RU && typeof RU.int === "function")
      ? RU.int(min, max, ctx.rng)
      : Math.max(min, Math.min(max, min + Math.floor((r() * (max - min + 1)))));
    return acc + n;
  }, 0);

  const placements = [];
  function free(x, y) {
    if (x <= 0 || y <= 0 || x >= W - 1) return false;
    if (y >= H - 1) return false;
    if (x === ctx.player.x && y === ctx.player.y) return false;
    if (placements.some(p => p.x === x && p.y === y)) return false;
    if (chestSpots.has(keyFor(x, y))) return false;
    return map[y][x] === T.FLOOR;
    }

  // Seed at least one placement near the player within FOV range to ensure visibility
  (function seedNearPlayer() {
    try {
      const px = (ctx.player.x | 0), py = (ctx.player.y | 0);
      const maxR = Math.max(3, Math.min(6, ((ctx.fovRadius | 0) || 8) - 1));
      outer:
      for (let r = 2; r <= maxR; r++) {
        const dirs = [
          [ r,  0], [ 0,  r], [-r,  0], [ 0, -r],
          [ r,  1], [ 1,  r], [-1,  r], [-r,  1],
          [-r, -1], [-1, -r], [ 1, -r], [ r, -1],
          [ r,  2], [ 2,  r], [-2,  r], [-r,  2],
        ];
        for (const d of dirs) {
          const x = px + d[0], y = py + d[1];
          if (free(x, y)) { placements.push({ x, y }); break outer; }
        }
      }
    } catch (_) {}
  })();

  // Place enemies around edges moving inward until placed
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

  // Materialize enemies; honor group.type when provided (e.g., bandit camp spawns bandits)
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
    n = Math.max(min, Math.min(placements.length - pIdx, n + Math.max(0, ctx.encounterDifficulty - 1)));
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
      // Assign faction from group or derived from type
      try {
        e.faction = (g && g.faction) ? String(g.faction) : deriveFaction(e.type);
      } catch (_) {}
      ctx.enemies.push(e);
    }
  }

  // Rebuild occupancy and refresh via StateSync
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      ctx.updateCamera && ctx.updateCamera();
      ctx.recomputeFOV && ctx.recomputeFOV();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
  } catch (_) {}

  // Announce difficulty
  try {
    const d = Math.max(1, Math.min(5, ctx.encounterDifficulty || 1));
    ctx.log && ctx.log(`Difficulty: ${d} (${d > 3 ? "tough" : d > 1 ? "moderate" : "easy"})`, "info");
  } catch (_) {}

  try {
    const hasMerchant = Array.isArray(encProps) && encProps.some(p => p && (p.type === "merchant"));
    const hasEnemies = Array.isArray(ctx.enemies) && ctx.enemies.length > 0;
    if (hasMerchant && !hasEnemies) {
      ctx.log && ctx.log(`${template.name || "Encounter"}: A wild Seppo appears! Press G on him to trade.`, "notice");
    } else {
      ctx.log && ctx.log(`${template.name || "Encounter"} begins: eliminate the hostiles.`, "notice");
    }
  } catch (_) {}
  ctx.encounterInfo = { id: template.id, name: template.name || "Encounter" };
  return true;
}

export function tryMoveEncounter(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "encounter") return false;
  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!(ctx.inBounds && ctx.inBounds(nx, ny))) return false;
  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);

  // Prefer to reuse DungeonRuntime movement/attack so encounters behave exactly like dungeon
  const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
  if (DR && typeof DR.tryMoveDungeon === "function") {
    const ok = !!DR.tryMoveDungeon(ctx, dx, dy); // does not call ctx.turn() in encounter mode
    if (ok) {
      // No auto-exit on stairs; exiting requires pressing G on the exit tile.
      return true;
    }
    // If DR didn't handle, fall through to minimal fallback below
  }

  // Fallback attack if enemy occupies target
  let enemy = null;
  try { enemy = Array.isArray(ctx.enemies) ? ctx.enemies.find(e => e && e.x === nx && e.y === ny) : null; } catch (_) { enemy = null; }
  if (enemy) {
    const C = ctx.Combat || (typeof window !== "undefined" ? window.Combat : null);
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
      return true;
    }
    try {
      const loc = { part: "torso", mult: 1.0, blockMod: 1.0, critBonus: 0.0 };
      const blockChance = (typeof ctx.getEnemyBlockChance === "function") ? ctx.getEnemyBlockChance(enemy, loc) : 0;
      const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
      const rfn = (RU && typeof RU.getRng === "function")
        ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((typeof ctx.rng === "function")
            ? ctx.rng
            : ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
                ? window.RNG.rng
                : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
                    ? window.RNGFallback.getRng()
                    : Math.random)));
      const didBlock = (RU && typeof RU.chance === "function")
        ? RU.chance(blockChance, (typeof ctx.rng === "function" ? ctx.rng : undefined))
        : (rfn() < blockChance);
      if (didBlock) {
        ctx.log && ctx.log(`${(enemy.type || "enemy")} blocks your attack.`, "block");
      } else {
        const atk = (typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : 1;
        const dmg = Math.max(0.1, Math.round(atk * 10) / 10);
        enemy.hp -= dmg;
        ctx.log && ctx.log(`You hit the ${(enemy.type || "enemy")} for ${dmg}.`);
        if (enemy.hp <= 0 && typeof ctx.onEnemyDied === "function") ctx.onEnemyDied(enemy);
      }
    } catch (_) {}
    return true;
  }

  // Fallback movement (no auto-exit)
  const walkable = (ctx.isWalkable ? ctx.isWalkable(nx, ny) : true);
  const blocked = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
  if (walkable && !blocked) {
    ctx.player.x = nx; ctx.player.y = ny;
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      } else {
        ctx.updateCamera && ctx.updateCamera();
        ctx.recomputeFOV && ctx.recomputeFOV();
        ctx.updateUI && ctx.updateUI();
        ctx.requestDraw && ctx.requestDraw();
      }
    } catch (_) {}
    return true;
  }
  return false;
}

// Start an encounter within the existing Region Map mode (ctx.mode === "region").
// Spawns enemies on the current region sample without changing mode or map.
export function enterRegion(ctx, info) {
  if (!ctx || ctx.mode !== "region" || !ctx.map || !Array.isArray(ctx.map) || !ctx.map.length) return false;
  // Reset clear-announcement guard for region-embedded encounters too
  _clearAnnounced = false;
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
    : ((typeof ctx.rng === "function")
        ? ctx.rng
        : ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
            ? window.RNG.rng
            : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
                ? window.RNGFallback.getRng()
                : Math.random)));

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
      for (let r = 2; r <= maxR; r++) {
        // Sample 16 directions around the ring
        const dirs = [
          [ r,  0], [ 0,  r], [-r,  0], [ 0, -r],
          [ r,  1], [ 1,  r], [-1,  r], [-r,  1],
          [-r, -1], [-1, -r], [ 1, -r], [ r, -1],
          [ r,  2], [ 2,  r], [-2,  r], [-r,  2],
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
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
  } catch (_) {}
  return true;
}

export function complete(ctx, outcome = "victory") {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Reset guard for next encounter session
  _clearAnnounced = false;

  // Return to the overworld
  ctx.mode = "world";
  if (ctx.world && ctx.world.map) {
    ctx.map = ctx.world.map;
    const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    ctx.seen = Array.from({ length: rows }, () => Array(cols).fill(true));
    ctx.visible = Array.from({ length: rows }, () => Array(cols).fill(true));
  }
  // Restore player to the entry tile
  try {
    const pos = ctx.worldReturnPos || null;
    if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
      ctx.player.x = pos.x; ctx.player.y = pos.y;
    }
  } catch (_) {}
  try {
    if (outcome === "victory") ctx.log && ctx.log("You prevail and return to the overworld.", "good");
    else ctx.log && ctx.log("You withdraw and return to the overworld.", "info");
  } catch (_) {}
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      ctx.updateCamera && ctx.updateCamera();
      ctx.recomputeFOV && ctx.recomputeFOV();
      ctx.updateUI && ctx.updateUI();
      ctx.requestDraw && ctx.requestDraw();
    }
  } catch (_) {}
  ctx.encounterInfo = null;
  return true;
}

export function tick(ctx) {
  if (!ctx || ctx.mode !== "encounter") return false;
  // Reuse DungeonRuntime.tick so AI/status/decals behave exactly like dungeon mode
  try {
    const DR = ctx.DungeonRuntime || (typeof window !== "undefined" ? window.DungeonRuntime : null);
    if (DR && typeof DR.tick === "function") {
      DR.tick(ctx);
    } else {
      // Fallback to local minimal tick (should rarely happen)
      const AIH = ctx.AI || (typeof window !== "undefined" ? window.AI : null);
      if (AIH && typeof AIH.enemiesAct === "function") AIH.enemiesAct(ctx);
    }
  } catch (_) {}

  // Objectives processing (non-blocking; does not auto-exit)
  try {
    const obj = ctx.encounterObjective || null;
    if (obj && obj.status !== "success") {
      const here = (ctx.inBounds && ctx.inBounds(ctx.player.x, ctx.player.y)) ? ctx.map[ctx.player.y][ctx.player.x] : null;
      if (obj.type === "surviveTurns" && typeof obj.turnsRemaining === "number") {
        obj.turnsRemaining = Math.max(0, (obj.turnsRemaining | 0) - 1);
        if (obj.turnsRemaining === 0) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: You survived. Step onto an exit (>) to leave.", "good");
        } else {
          // periodic reminder
          if ((obj.turnsRemaining % 3) === 0) {
            ctx.log && ctx.log(`Survive ${obj.turnsRemaining} more turn(s)...`, "info");
          }
        }
      } else if (obj.type === "reachExit") {
        if (here === ctx.TILES.STAIRS) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: Reached exit. Press G to leave.", "good");
        }
      } else if (obj.type === "rescueTarget") {
        const rescued = !!obj.rescued;
        if (!rescued && obj.target && obj.target.x === ctx.player.x && obj.target.y === ctx.player.y) {
          obj.rescued = true;
          ctx.log && ctx.log("You free the captive! Now reach an exit (>) to leave.", "good");
        } else if (rescued && here === ctx.TILES.STAIRS) {
          obj.status = "success";
          ctx.log && ctx.log("Objective complete: Escorted the captive to safety.", "good");
        }
      }
    }
  } catch (_) {}

  // Do NOT auto-return to overworld on victory. Keep the encounter map active so player can loot or explore.
  // Announce clear state only once per encounter session (guarded by a module-level flag).
  try {
    if (Array.isArray(ctx.enemies) && ctx.enemies.length === 0) {
      if (!_clearAnnounced) {
        _clearAnnounced = true;
        try { ctx.log && ctx.log("Area clear. Step onto an exit (>) to leave when ready.", "notice"); } catch (_) {}
      }
    } else {
      // If new enemies appear (edge-case), allow re-announcement once they are cleared again
      _clearAnnounced = false;
    }
  } catch (_) {}
  return true;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.EncounterRuntime = { enter, tryMoveEncounter, tick, complete };
}