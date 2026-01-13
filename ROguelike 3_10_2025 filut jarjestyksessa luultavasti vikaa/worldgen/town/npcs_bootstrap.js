/**
 * Town NPC bootstrap helpers
 * --------------------------
 * Extracted from worldgen/town_gen.js, behaviour kept identical.
 * Exports:
 *   - spawnGateGreeters(ctx, count)
 *   - enforceGateNPCLimit(ctx, limit, radius)
 *   - populateTownNpcs(ctx, W, H, gate, plaza, townSize, townKind, TOWNCFG, info, rng)
 *
 * These helpers are used by town_gen.generate() after town layout,
 * and also re-exported via window.Town for legacy callers.
 */
import { getGameData, getMod } from "../../utils/access.js";
import { getTownPopulationTargets } from "./config.js";

function _manhattanLocal(ctx, ax, ay, bx, by) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.manhattan === "function") return ctx.Utils.manhattan(ax, ay, bx, by);
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.manhattan === "function") {
      return window.Utils.manhattan(ax, ay, bx, by);
    }
  } catch (_) {}
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function _isFreeTownFloorLocal(ctx, x, y) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.isFreeTownFloor === "function") return ctx.Utils.isFreeTownFloor(ctx, x, y);
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.isFreeTownFloor === "function") {
      return window.Utils.isFreeTownFloor(ctx, x, y);
    }
  } catch (_) {}
  if (!ctx || !ctx.map || !ctx.map.length || !ctx.map[0]) return false;
  const H = ctx.map.length;
  const W = ctx.map[0].length;
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const t = ctx.map[y][x];
  if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR && t !== ctx.TILES.ROAD) return false;
  if (ctx.player && ctx.player.x === x && ctx.player.y === y) return false;
  if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === x && n.y === y)) return false;
  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
  return true;
}

function clearAdjacentNPCsAroundPlayerLocal(ctx) {
  // Ensure the four cardinal neighbors around the player are not all occupied by NPCs
  if (!ctx || !ctx.player || !Array.isArray(ctx.npcs)) return;
  const neighbors = [
    { x: ctx.player.x + 1, y: ctx.player.y },
    { x: ctx.player.x - 1, y: ctx.player.y },
    { x: ctx.player.x, y: ctx.player.y + 1 },
    { x: ctx.player.x, y: ctx.player.y - 1 },
  ];
  for (const pos of neighbors) {
    const idx = ctx.npcs.findIndex(n => n.x === pos.x && n.y === pos.y);
    if (idx !== -1) {
      ctx.npcs.splice(idx, 1);
    }
  }
}

/**
 * Spawn 0–N greeter NPCs near the gate, with guards against crowding and
 * keeping the player’s immediate neighbors clear.
 */
export function spawnGateGreeters(ctx, count = 4) {
  if (!ctx || !ctx.townExitAt) return false;
  // Clamp to ensure at most one NPC near the gate within a small radius
  const RADIUS = 2;
  const gx = ctx.townExitAt.x;
  const gy = ctx.townExitAt.y;
  const existingNear = Array.isArray(ctx.npcs)
    ? ctx.npcs.filter(n => _manhattanLocal(ctx, n.x, n.y, gx, gy) <= RADIUS).length
    : 0;
  const target = Math.max(0, Math.min((count | 0), 1 - existingNear));
  const RAND = (ctx && typeof ctx.rng === "function") ? ctx.rng : Math.random;
  if (target <= 0) {
    // Keep player space clear but ensure at least one greeter remains in radius
    clearAdjacentNPCsAroundPlayerLocal(ctx);
    try {
      const nearNow = Array.isArray(ctx.npcs)
        ? ctx.npcs.filter(n => _manhattanLocal(ctx, n.x, n.y, gx, gy) <= RADIUS).length
        : 0;
      if (nearNow === 0) {
        const names = ["Ava", "Borin", "Cora", "Darin", "Eda", "Finn", "Goro", "Hana"];
        const lines = [
          `Welcome to ${ctx.townName || "our town"}.`,
          "Shops are marked with a flag at their doors.",
          "Stay as long as you like.",
          "The plaza is at the center.",
        ];
        // Prefer diagonals first to avoid blocking cardinal steps
        const candidates = [
          { x: gx + 1, y: gy + 1 }, { x: gx + 1, y: gy - 1 }, { x: gx - 1, y: gy + 1 }, { x: gx - 1, y: gy - 1 },
          { x: gx + 2, y: gy }, { x: gx - 2, y: gy }, { x: gx, y: gy + 2 }, { x: gx, y: gy - 2 },
          { x: gx + 2, y: gy + 1 }, { x: gx + 2, y: gy - 1 }, { x: gx - 2, y: gy + 1 }, { x: gx - 2, y: gy - 1 },
          { x: gx + 1, y: gy + 2 }, { x: gx + 1, y: gy - 2 }, { x: gx - 1, y: gy + 2 }, { x: gx - 1, y: gy - 2 },
        ];
        for (const c of candidates) {
          if (_isFreeTownFloorLocal(ctx, c.x, c.y) &&
              _manhattanLocal(ctx, ctx.player.x, ctx.player.y, c.x, c.y) > 1) {
            const name = names[Math.floor(RAND() * names.length) % names.length];
            ctx.npcs.push({ x: c.x, y: c.y, name, lines, greeter: true });
            break;
          }
        }
      }
    } catch (_) {}
    return true;
  }

  const dirs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
  ];
  const names = ["Ava", "Borin", "Cora", "Darin", "Eda", "Finn", "Goro", "Hana"];
  const lines = [
    `Welcome to ${ctx.townName || "our town"}.`,
    "Shops are marked with a flag at their doors.",
    "Stay as long as you like.",
    "The plaza is at the center.",
  ];
  let placed = 0;
  // two rings around the gate
  for (let ring = 1; ring <= 2 && placed < target; ring++) {
    for (const d of dirs) {
      const x = gx + d.dx * ring;
      const y = gy + d.dy * ring;
      if (_isFreeTownFloorLocal(ctx, x, y) &&
          _manhattanLocal(ctx, ctx.player.x, ctx.player.y, x, y) > 1) {
        const name = names[Math.floor(RAND() * names.length) % names.length];
        ctx.npcs.push({ x, y, name, lines, greeter: true });
        placed++;
        if (placed >= target) break;
      }
    }
  }
  clearAdjacentNPCsAroundPlayerLocal(ctx);
  // After clearing adjacency, ensure at least one greeter remains near the gate
  try {
    const nearNow = Array.isArray(ctx.npcs)
      ? ctx.npcs.filter(n => _manhattanLocal(ctx, n.x, n.y, gx, gy) <= RADIUS).length
      : 0;
    if (nearNow === 0) {
      const name = "Greeter";
      const lines2 = [
        `Welcome to ${ctx.townName || "our town"}.`,
        "Shops are marked with a flag at their doors.",
        "Stay as long as you like.",
        "The plaza is at the center.",
      ];
      const diag = [
        { x: gx + 1, y: gy + 1 }, { x: gx + 1, y: gy - 1 },
        { x: gx - 1, y: gy + 1 }, { x: gx - 1, y: gy - 1 }
      ];
      for (const c of diag) {
        if (_isFreeTownFloorLocal(ctx, c.x, c.y)) {
          ctx.npcs.push({ x: c.x, y: c.y, name, lines: lines2, greeter: true });
          break;
        }
      }
    }
  } catch (_) {}
  return true;
}

/**
 * Enforce a hard cap on how many NPCs can stand near the gate.
 */
export function enforceGateNPCLimit(ctx, limit = 1, radius = 2) {
  if (!ctx || !Array.isArray(ctx.npcs) || !ctx.townExitAt) return;
  const gx = ctx.townExitAt.x;
  const gy = ctx.townExitAt.y;
  const nearIdx = [];
  for (let i = 0; i < ctx.npcs.length; i++) {
    const n = ctx.npcs[i];
    if (_manhattanLocal(ctx, n.x, n.y, gx, gy) <= radius) {
      nearIdx.push({ i, d: _manhattanLocal(ctx, n.x, n.y, gx, gy) });
    }
  }
  if (nearIdx.length <= limit) return;
  // Keep the closest 'limit'; remove others
  nearIdx.sort((a, b) => a.d - b.d || a.i - b.i);
  const keepSet = new Set(nearIdx.slice(0, limit).map(o => o.i));
  const toRemove = nearIdx.slice(limit).map(o => o.i).sort((a, b) => b - a);
  for (const idx of toRemove) {
    if (!keepSet.has(idx)) ctx.npcs.splice(idx, 1);
  }
}

/**
 * Populate town NPCs after layout:
 * - Delegates to TownAI.populateTown when available.
 * - Adds special cats (Jekku, Pulla) for their home towns.
 * - Spawns roaming villagers and guards around the plaza.
 */
export function populateTownNpcs(ctx, W, H, gate, plaza, townSize, townKind, TOWNCFG, info, rng) {
  if (!ctx) return;

  const RAND = (rng && typeof rng === "function")
    ? rng
    : (ctx && typeof ctx.rng === "function" ? ctx.rng : Math.random);

  // NPCs via TownAI if present
  ctx.npcs = [];
  try {
    if (ctx && ctx.TownAI && typeof ctx.TownAI.populateTown === "function") {
      ctx.TownAI.populateTown(ctx);
    } else {
      const TAI = ctx.TownAI || getMod(ctx, "TownAI");
      if (TAI && typeof TAI.populateTown === "function") {
        TAI.populateTown(ctx);
      }
    }
  } catch (_) {}

  // One special cat: Jekku (spawn in the designated town only)
  // Another special cat: Pulla (same behavior, different name, spawns in its designated town)
  (function placeSpecialCats() {
    try {
      const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : ctx.player.x;
      const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : ctx.player.y;
      const townInfo = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t.x === wx && t.y === wy) : null;
      if (!townInfo) return;

      function spawnCatOnce(nameCheck, displayName) {
        // Avoid duplicate by name if already present
        if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => String(n.name || "").toLowerCase() === nameCheck)) return;
        // Prefer a free floor near the plaza
        const spots = [
          { x: ctx.townPlaza.x + 1, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x - 1, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y + 1 },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y - 1 },
          { x: ctx.townPlaza.x + 2, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x - 2, y: ctx.townPlaza.y },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y + 2 },
          { x: ctx.townPlaza.x, y: ctx.townPlaza.y - 2 },
        ];
        let pos = null;
        for (const s of spots) {
          if (_isFreeTownFloorLocal(ctx, s.x, s.y)) { pos = s; break; }
        }
        if (!pos) {
          // Fallback: any free floor near plaza
          for (let oy = -3; oy <= 3 && !pos; oy++) {
            for (let ox = -3; ox <= 3 && !pos; ox++) {
              const x = ctx.townPlaza.x + ox;
              const y = ctx.townPlaza.y + oy;
              if (_isFreeTownFloorLocal(ctx, x, y)) pos = { x, y };
            }
          }
        }
        if (!pos) pos = { x: ctx.townPlaza.x, y: ctx.townPlaza.y };
        ctx.npcs.push({ x: pos.x, y: pos.y, name: displayName, kind: "cat", lines: ["Meow.", "Purr."], pet: true });
      }

      if (townInfo.jekkuHome) {
        spawnCatOnce("jekku", "Jekku");
      }
      if (townInfo.pullaHome) {
        spawnCatOnce("pulla", "Pulla");
      }
    } catch (_) {}
  })();

  // Roaming villagers near plaza (some promoted to town guards)
  const GD8 = getGameData(ctx);
  const ND = (GD8 && GD8.npcs) ? GD8.npcs : null;
  const baseLines = (ND && Array.isArray(ND.residentLines) && ND.residentLines.length)
    ? ND.residentLines
    : [
        "Rest your feet a while.",
        "The dungeon is dangerous.",
        "Buy supplies before you go.",
        "Lovely day on the plaza.",
        "Care for a drink at the well?"
      ];
  const lines = [
    `Welcome to ${ctx.townName || "our town"}.`,
    ...baseLines
  ];
  const guardLines = (ND && Array.isArray(ND.guardLines) && ND.guardLines.length)
    ? ND.guardLines
    : [
        "Stay out of trouble.",
        "We keep the town safe.",
        "Eyes open, blade sharp.",
        "The gate is watched day and night."
      ];
  const tbCount = Array.isArray(ctx.townBuildings) ? ctx.townBuildings.length : 12;
  // Dedicated guard barracks building (if present) for guard homes.
  const guardBarracks = Array.isArray(ctx.townBuildings)
    ? ctx.townBuildings.find(b => b && b.prefabId && String(b.prefabId).toLowerCase().includes("guard_barracks"))
    : null;

  // Population targets (roamers/guards) driven by town.json when present.
  const popTargets = getTownPopulationTargets(TOWNCFG, townSize, townKind, tbCount);
  const roamTarget = popTargets.roamTarget;
  let guardTarget = popTargets.guardTarget;

  let placed = 0;
  let placedGuards = 0;
  let tries = 0;
  while (placed < roamTarget && tries++ < 800) {
    const onRoad = ctx.rng && typeof ctx.rng === "function" ? (ctx.rng() < 0.4) : (RAND() < 0.4);
    let x, y;
    if (onRoad) {
      if (ctx.rng && typeof ctx.rng === "function" ? (ctx.rng() < 0.5) : (RAND() < 0.5)) {
        y = gate.y;
        x = Math.max(2, Math.min(W - 3, Math.floor((ctx.rng && typeof ctx.rng === "function" ? ctx.rng() : RAND()) * (W - 4)) + 2));
      } else {
        x = plaza.x;
        y = Math.max(2, Math.min(H - 3, Math.floor((ctx.rng && typeof ctx.rng === "function" ? ctx.rng() : RAND()) * (H - 4)) + 2));
      }
    } else {
      const ox = Math.floor((ctx.rng && typeof ctx.rng === "function" ? ctx.rng() : RAND()) * 21) - 10;
      const oy = Math.floor((ctx.rng && typeof ctx.rng === "function" ? ctx.rng() : RAND()) * 17) - 8;
      x = Math.max(1, Math.min(W - 2, plaza.x + ox));
      y = Math.max(1, Math.min(H - 2, plaza.y + oy));
    }
    if (ctx.map[y][x] !== ctx.TILES.FLOOR && ctx.map[y][x] !== ctx.TILES.DOOR && ctx.map[y][x] !== ctx.TILES.ROAD) continue;
    if (x === ctx.player.x && y === ctx.player.y) continue;
    if (_manhattanLocal(ctx, ctx.player.x, ctx.player.y, x, y) <= 1) continue;
    if (ctx.npcs.some(n => n.x === x && n.y === y)) continue;
    if (ctx.townProps.some(p => p.x === x && p.y === y)) continue;

    // Prefer to turn road/near-gate roamers into guards, up to guardTarget
    const nearGate = _manhattanLocal(ctx, x, y, gate.x, gate.y) <= 6;
    const canBeGuard = placedGuards < guardTarget &&
      (onRoad || nearGate || (ctx.rng && typeof ctx.rng === "function" ? ctx.rng() < 0.25 : RAND() < 0.25));

    // Assign a home immediately to avoid \"no-home\" diagnostics for roamers/guards
    let homeRef = null;
    try {
      const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
      if (tbs.length) {
        let b = null;
        if (canBeGuard && guardBarracks) {
          b = guardBarracks;
        } else {
          b = tbs[Math.floor(RAND() * tbs.length)];
        }
        if (b) {
          const hx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0))));
          const hy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0))));
          const door = (b && b.door && typeof b.door.x === "number" && typeof b.door.y === "number") ? { x: b.door.x, y: b.door.y } : null;
          homeRef = { building: b, x: hx, y: hy, door };
        }
      }
    } catch (_) {}

    const likesInn = RAND() < 0.45;
    if (canBeGuard) {
      const guardIndex = placedGuards + 1;
      const eliteChance = 0.3;
      const isEliteGuard = (ctx && typeof ctx.rng === "function") ? (ctx.rng() < eliteChance) : (Math.random() < eliteChance);
      const guardType = isEliteGuard ? "guard_elite" : "guard";
      const guardName = isEliteGuard ? `Guard captain ${guardIndex}` : `Guard ${guardIndex}`;
      const baseHp = isEliteGuard ? 28 : 22;
      const hpJitter = (ctx && typeof ctx.rng === "function") ? Math.floor(ctx.rng() * 6) : 0;
      const hp = baseHp + hpJitter;
      ctx.npcs.push({
        x,
        y,
        name: guardName,
        lines: guardLines,
        isGuard: true,
        guard: true,
        guardType,
        hp,
        maxHp: hp,
        _guardPost: { x, y },
        _likesInn: likesInn,
        _home: homeRef
      });
      placedGuards++;
    } else {
      ctx.npcs.push({
        x,
        y,
        name: `Villager ${placed + 1}`,
        lines,
        _likesInn: likesInn,
        _home: homeRef
      });
    }
    placed++;
  }
}