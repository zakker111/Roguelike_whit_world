/**
 * Town NPC bootstrap helpers
 * --------------------------
 * Extracted from worldgen/town_gen.js, behaviour kept identical.
 * Exports:
 *   - spawnGateGreeters(ctx, count)
 *   - enforceGateNPCLimit(ctx, limit, radius)
 *
 * These helpers are used by town_gen.generate() after town layout,
 * and also re-exported via window.Town for legacy callers.
 */

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