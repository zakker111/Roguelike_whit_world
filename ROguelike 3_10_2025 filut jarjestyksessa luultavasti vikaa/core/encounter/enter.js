/**
 * Encounter enter (Phase 4 extraction): switches to encounter mode and generates tactical map.
 */
import { getMod } from "../../utils/access.js";
import { genEmpty, genAmbushForest, genCamp, genRuins, genArena, genBattlefield, genCaravanRoad } from "./generators.js";
import { resetSessionFlags, setCurrentQuestInstanceId } from "./session_state.js";

export function enter(ctx, info) {
  if (!ctx || !ctx.world || !ctx.world.map) return false;
  // Reset session flags for this encounter
  resetSessionFlags();
  setCurrentQuestInstanceId((info && info.questInstanceId) ? info.questInstanceId : null);

  const template = info && info.template ? info.template : { id: "ambush_forest", name: "Ambush", map: { w: 24, h: 16 }, groups: [ { count: { min: 2, max: 3 } } ] };
  const biome = info && info.biome ? String(info.biome).toUpperCase() : null;
  const difficulty = Math.max(1, Math.min(5, (info && typeof info.difficulty === "number") ? (info.difficulty | 0) : 1));
  ctx.encounterBiome = biome;
  ctx.encounterDifficulty = difficulty;

  // Remember return position in overworld (absolute world coordinates)
  const ox = (ctx.world && typeof ctx.world.originX === "number") ? (ctx.world.originX | 0) : 0;
  const oy = (ctx.world && typeof ctx.world.originY === "number") ? (ctx.world.originY | 0) : 0;
  const worldX = ox + (ctx.player.x | 0);
  const worldY = oy + (ctx.player.y | 0);
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

  const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
  const r = (RU && typeof RU.getRng === "function")
    ? RU.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
    : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));
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
  if (id === "ambush_forest" || id === "ambush" || id === "forest") map = genAmbushForest(ctx, r, W, H, T);
  else if (id === "camp" || id === "bandit_camp" || id === "camp_small") map = genCamp(ctx, r, W, H, T, hutCenters, [], encProps);
  else if (id === "ruins" || id === "ruin") map = genRuins(ctx, r, W, H, T);
  else if (id === "arena" || id === "cross") map = genArena(ctx, r, W, H, T);
  else if (id === "battlefield" || id === "open_field") map = genBattlefield(ctx, r, W, H, T);
  else if (id === "caravan_road") map = genCaravanRoad(ctx, r, W, H, T, encProps);
  else map = genEmpty(ctx, W, H, T);

  ctx.map = map;
  ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];
  ctx.encounterProps = encProps;
  ctx.encounterObjective = null;

  // Place chests inside huts (center tile). Fill with simple loot.
  try {
    const L = ctx.Loot || (typeof window !== "undefined" ? window.Loot : null);
    const RUenc = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
    const rEnc = (RUenc && typeof RUenc.getRng === "function")
      ? RUenc.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
      : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));
    for (let i = 0; i < hutCenters.length; i++) {
      const c = hutCenters[i];
      if (c.x <= 0 || c.y <= 0 || c.x >= W - 1 || c.y >= H - 1) continue;
      if (map[c.y][c.x] !== T.FLOOR) continue;
      if (c.x === ctx.player.x && c.y === ctx.player.y) continue;
      const loot = (L && typeof L.generate === "function") ? (L.generate(ctx, { type: "bandit", xp: 10 }) || []) : [{ name: "5 gold", kind: "gold", amount: 5 }];
      // Tiny chance for an encounter chest to contain a fine lockpick (Seppo-quality).
      try {
        const rollFine = rEnc();
        if (rollFine < 0.03) { // ~3% per chest
          loot.push({ kind: "tool", type: "lockpick_fine", name: "fine lockpick", decay: 0 });
        }
      } catch (_) {}
      ctx.corpses.push({ kind: "chest", x: c.x, y: c.y, loot, looted: loot.length === 0 });
      chestSpots.add(keyFor(c.x, c.y));
    }

    // Special-case: caravan ambush road may mark a caravan chest prop; convert it to a real chest with strong loot.
    try {
      const tplId = String(template.id || "").toLowerCase();
      if (tplId === "caravan_ambush" && Array.isArray(ctx.encounterProps)) {
        const centerX = (W / 2) | 0;
        const centerY = (H / 2) | 0;
        const caravChest = ctx.encounterProps.find(p =>
          p &&
          String(p.type || "").toLowerCase() === "caravan_chest" &&
          Math.abs(p.x - centerX) <= 2 &&
          Math.abs(p.y - centerY) <= 1
        );
        if (caravChest) {
          const cx2 = caravChest.x | 0;
          const cy2 = caravChest.y | 0;
          if (cx2 > 0 && cy2 > 0 && cx2 < W - 1 && cy2 < H - 1 && map[cy2][cx2] !== T.WALL) {
            // Generate caravan-themed loot; use higher XP budget so items are strong.
            let loot2 = [];
            if (L && typeof L.generate === "function") {
              loot2 = L.generate(ctx, { type: "caravan", xp: 40 }) || [];
            }
            // Fallback to high-value bandit loot if caravan table missing/empty
            if (!Array.isArray(loot2) || !loot2.length) {
              loot2 = (L && typeof L.generate === "function") ? (L.generate(ctx, { type: "bandit", xp: 35 }) || []) : [];
            }
            // Always add a good pile of gold on top
            try {
              loot2 = Array.isArray(loot2) ? loot2.slice() : [];
              loot2.push({ name: "caravan spoils", kind: "gold", amount: 80 });
            } catch (_) {}
            ctx.corpses.push({ kind: "chest", x: cx2, y: cy2, loot: loot2, looted: loot2.length === 0 });
            chestSpots.add(keyFor(cx2, cy2));
          }
        }
      }
    } catch (_) {}
  } catch (_) {}

  // Add simple exit tiles near each edge so the player can always walk out.
  try {
    const cx = (W / 2) | 0, cy = (H / 2) | 0;
    const exits = [
      { x: 1, y: cy },
      { x: W - 2, y: cy },
      { x: cx, y: 1 },
      { x: cx, y: H - 2 },
    ];
    for (const e of exits) {
      if (e.x > 0 && e.y > 0 && e.x < W - 1 && e.y < H - 1) {
        map[e.y][e.x] = T.STAIRS;
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

  // Spawn player
  (function placePlayer() {
    const tplId = String(template.id || "").toLowerCase();

    // Special case: in guards_vs_bandits, place player at the side of the battle,
    // so they first see the fight rather than starting between the lines.
    if (tplId === "guards_vs_bandits") {
      const midY = (H / 2) | 0;
      const candidates = [
        { x: 1, y: midY },
        { x: 1, y: midY - 1 },
        { x: 1, y: midY + 1 },
        { x: 2, y: midY },
        { x: W - 2, y: midY },
        { x: W - 2, y: midY - 1 },
        { x: W - 2, y: midY + 1 },
      ];
      for (const c of candidates) {
        if (c.x > 0 && c.y > 0 && c.x < W - 1 && c.y < H - 1 && map[c.y][c.x] !== T.WALL) {
          ctx.player.x = c.x; ctx.player.y = c.y;
          return;
        }
      }
      // Fallback to default behavior if no candidate worked.
    }

    const hint = (template && (template.playerSpawn || template.spawn || template.player)) ? (template.playerSpawn || template.spawn || template.player) : null;
    if (typeof hint === "string" && hint.toLowerCase() === "edge") {
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
    const px = (W / 2) | 0, py = (H / 2) | 0;
    ctx.player.x = px; ctx.player.y = py;
  })();

  // Objectives setup (surviveTurns, reachExit, rescueTarget)
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
        function canPlace(x, y) {
          if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
          if (map[y][x] !== T.FLOOR) return false;
          if (x === ctx.player.x && y === ctx.player.y) return false;
          if (chestSpots.has(keyFor(x, y))) return false;
          if (map[y][x] === T.STAIRS) return false;
          if (encProps.some(p => p.x === x && p.y === y)) return false;
          return true;
        }
        let tx = -1, ty = -1;
        for (const c of hutCenters) {
          if (canPlace(c.x, c.y)) { tx = c.x; ty = c.y; break; }
        }
        if (tx < 0) {
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
          const turns = Math.max(1, (obj.turns | 0) || 6);
          ctx.encounterObjective = { type: "surviveTurns", turnsRemaining: turns, status: "active" };
          try { ctx.log && ctx.log(`Objective: Survive for ${turns} turns.`, "notice"); } catch (_) {}
        }
      }
    } catch (_) {}
  })();

  // Spawn enemies per template groups (counts only)
  const groups = Array.isArray(template.groups) ? template.groups : [];

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

  let depth = Math.max(1, (ctx.floor | 0) || 1);
  const depth = Math.max(1, (ctx.floor | 0) || 1);
  const deriveFaction = (t) => {
    const s = String(t || "").toLowerCase();
    if (s.includes("bandit")) return "bandit";
    if (s.includes("orc")) return "orc";
    if (s.includes("guard")) return "guard";
    return "monster";
  };

  // Special-case tweaks for specific templates
  const tplId = String(template.id || "").toLowerCase();
  if (tplId === "caravan_ambush") {
    // Treat caravan ambush as a higher-depth encounter so guards are tougher.
    depth = Math.max(depth, 5);
    ctx.encounterDifficulty = Math.max(ctx.encounterDifficulty || 1, 5);
  }

  // Special-case formation: Guards vs Bandits skirmish in lines facing each other.
  let usedCustomSpawn = false;
  if (tplId === "guards_vs_bandits" && groups.length) {
    try {
      const cx = (W / 2) | 0;
      const cy = (H / 2) | 0;

      const guardGroup = groups.find(g =>
        g && (String(g.faction || "").toLowerCase() === "guard"
          || String(g.type || "").toLowerCase().includes("guard")));
      const banditGroup = groups.find(g =>
        g && (String(g.faction || "").toLowerCase() === "bandit"
          || String(g.type || "").toLowerCase() === "bandit"));

      function linePositions(y) {
        const out = [];
        const minX = Math.max(1, cx - 6);
        const maxX = Math.min(W - 2, cx + 6);
        for (let x = minX; x <= maxX; x++) {
          if (x === ctx.player.x && y === ctx.player.y) continue;
          if (chestSpots.has(keyFor(x, y))) continue;
          if (map[y][x] === T.FLOOR) out.push({ x, y });
        }
        return out;
      }

      function shuffle(arr) {
        try {
          for (let i = arr.length - 1; i > 0; i--) {
            const j = (RU && typeof RU.int === "function")
              ? RU.int(0, i, ctx.rng)
              : Math.floor(r() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
        } catch (_) {}
      }

      function countForGroup(g, maxSlots) {
        const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
        const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
        let n = (RU && typeof RU.int === "function")
          ? RU.int(min, max, ctx.rng)
          : Math.max(min, Math.min(max, min + Math.floor((r() * (max - min + 1)))));
        n = Math.max(min, Math.min(maxSlots, n + Math.max(0, ctx.encounterDifficulty - 1)));
        return n;
      }

      function spawnEnemyForGroupAt(g, pos, preferredType) {
        const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
        let e = null;
        const type = (g && typeof g.type === "string" && g.type) ? g.type : preferredType;
        try {
          if (EM && typeof EM.getTypeDef === "function" && type) {
            const td = EM.getTypeDef(type);
            if (td) {
              const lvl = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth;
              e = {
                x: pos.x,
                y: pos.y,
                type,
                glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
                hp: td.hp(depth),
                atk: td.atk(depth),
                xp: td.xp(depth),
                level: lvl,
                announced: false
              };
            }
          }
        } catch (_) {}
        if (!e) {
          e = createDungeonEnemyAt(ctx, pos.x, pos.y, depth);
        }
        if (!e) return;

        try {
          const d = Math.max(1, Math.min(5, ctx.encounterDifficulty || 1));
          e.level = Math.max(1, (e.level | 0) + (d - 1));
          const hpMult = 1 + 0.25 * (d - 1);
          const atkMult = 1 + 0.20 * (d - 1);
          e.hp = Math.max(1, Math.round(e.hp * hpMult));
          e.atk = Math.max(0.1, Math.round(e.atk * atkMult * 10) / 10);
        } catch (_) {}
        try { e.faction = (g && g.faction) ? String(g.faction) : deriveFaction(e.type); } catch (_) {}
        if (e.faction === "guard") {
          // Guards start neutral to the player in this encounter until attacked.
          e._ignorePlayer = true;
        }
        ctx.enemies.push(e);
      }

      // Place lines far apart so you clearly see both sides begin their charge.
      // Guards start near the top, bandits near the bottom.
      const guardRowY = 2;
      const banditRowY = Math.max(guardRowY + 4, Math.min(H - 3, H - 3));

      let guardPlaced = 0;
      let banditPlaced = 0;

      if (guardGroup) {
        const slots = linePositions(guardRowY);
        if (slots.length) {
          shuffle(slots);
          const nG = countForGroup(guardGroup, slots.length);
          for (let i = 0; i < nG && i < slots.length; i++) {
            spawnEnemyForGroupAt(guardGroup, slots[i], "guard");
            guardPlaced++;
          }
        }
      }

      if (banditGroup) {
        const slots = linePositions(banditRowY);
        if (slots.length) {
          shuffle(slots);
          const nB = countForGroup(banditGroup, slots.length);
          for (let i = 0; i < nB && i < slots.length; i++) {
            spawnEnemyForGroupAt(banditGroup, slots[i], "bandit");
            banditPlaced++;
          }
        }
      }

      if (guardPlaced > 0 || banditPlaced > 0) {
        usedCustomSpawn = true;
      }
    } catch (_) {
      usedCustomSpawn = false;
    }
  }

  if (!usedCustomSpawn) {
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

    let pIdx = 0;
    for (const g of groups) {
      const min = (g && g.count && typeof g.count.min === "number") ? g.count.min : 1;
      const max = (g && g.count && typeof g.count.max === "number") ? g.count.max : Math.max(1, min + 2);
      let n = (RU && typeof RU.int === "function")
        ? RU.int(min, max, ctx.rng)
        : Math.max(min, Math.min(max, min + Math.floor((r() * (max - min + 1)))));
      n = Math.max(min, Math.min(placements.length - pIdx, n + Math.max(0, ctx.encounterDifficulty - 1)));
      for (let i = 0; i < n && pIdx < placements.length; i++) {
        const p = placements[pIdx++];
        const type = (g && typeof g.type === "string" && g.type) ? g.type : null;

        // For caravan ambush, enforce guard-only enemies: if type is missing or unknown, skip spawn.
        const isCaravanAmbush = tplId === "caravan_ambush";
        let e = null;

        // Prefer explicit enemy type from template groups (guards, bandits, etc.).
        if (type) {
          try {
            const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
            if (EM && typeof EM.getTypeDef === "function") {
              const td = EM.getTypeDef(type);
              if (td) {
                const lvl = (EM.levelFor && typeof EM.levelFor === "function") ? EM.levelFor(type, depth, ctx.rng) : depth;
                e = {
                  x: p.x,
                  y: p.y,
                  type,
                  glyph: (td.glyph && td.glyph.length) ? td.glyph : ((type && type.length) ? type.charAt(0) : "?"),
                  hp: td.hp(depth),
                  atk: td.atk(depth),
                  xp: td.xp(depth),
                  level: lvl,
                  announced: false
                };
              }
            }
          } catch (_) {}
        }

        if (!e) {
          if (isCaravanAmbush) {
            // In caravan ambush, never fall back to random enemy types; skip this slot.
            continue;
          }
          e = createDungeonEnemyAt(ctx, p.x, p.y, depth);
        }
        if (!e) continue;
        try {
          const d = Math.max(1, Math.min(5, ctx.encounterDifficulty || 1));
          e.level = Math.max(1, (e.level | 0) + (d - 1));
          const hpMult = 1 + 0.25 * (d - 1);
          const atkMult = 1 + 0.20 * (d - 1);
          e.hp = Math.max(1, Math.round(e.hp * hpMult));
          e.atk = Math.max(0.1, Math.round(e.atk * atkMult * 10) / 10);
        } catch (_) {}
        try { e.faction = (g && g.faction) ? String(g.faction) : deriveFaction(e.type); } catch (_) {}
        if (e.faction === "guard") {
          e._ignorePlayer = true;
        }
        ctx.enemies.push(e);
      }
    }
  }

  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  try {
    const hasMerchant = Array.isArray(encProps) && encProps.some(p => p && (p.type === "merchant"));
    const hasEnemies = Array.isArray(ctx.enemies) && ctx.enemies.length > 0;
    const tplIdLog = String(template.id || "").toLowerCase();
    if (hasMerchant && !hasEnemies) {
      ctx.log && ctx.log(`${template.name || "Encounter"}: A wild Seppo appears! Press G on him to trade.`, "notice");
    } else if (tplIdLog === "guards_vs_bandits") {
      ctx.log && ctx.log("you see guards against bandits in field of battle", "notice");
    } else {
      ctx.log && ctx.log(`${template.name || "Encounter"} begins: eliminate the hostiles.`, "notice");
    }
  } catch (_) {}
  ctx.encounterInfo = { id: template.id, name: template.name || "Encounter" };
  setCurrentQuestInstanceId((info && info.questInstanceId) ? info.questInstanceId : null);
  return true;
}