/**
 * Town
 * Compact town generation and helpers used by the game and TownAI.
 *
 * API (ESM + window.Town):
 *   generate(ctx) -> handled:boolean (true if it generated town and mutated ctx)
 *   ensureSpawnClear(ctx) -> handled:boolean
 *   spawnGateGreeters(ctx, count) -> handled:boolean
 *   interactProps(ctx) -> handled:boolean
 *
 * Layout overview
 * - Walls and a gate near the player (fast travel into town).
 * - Plaza at center with lamps/benches/market decor.
 * - Roads in a grid connecting gate and plaza.
 * - Buildings: hollow rectangles with doors placed on accessible sides.
 * - Shops near plaza: door + interior reference, plus a sign and schedule.
 * - Props placed inside buildings (beds, tables, chairs, fireplace, storage, shelves, plants, rugs).
 *
 * Notes
 * - Window tiles on building perimeters allow light but block movement.
 * - Visibility and enemies are reset for town mode; TownAI populates NPCs after layout.
 * - Interactions (signs, well, benches) give quick flavor and small resting options.
 */

import { getGameData, getMod, getRNGUtils } from "../utils/access.js";
import { getTownBuildingConfig, getInnSizeConfig, getCastleKeepSizeConfig, getTownPopulationTargets } from "./town/config.js";
import { buildBaseTown, buildPlaza } from "./town/layout_core.js";

function inBounds(ctx, x, y) {
  try {
    if (typeof window !== "undefined" && window.Bounds && typeof window.Bounds.inBounds === "function") {
      return window.Bounds.inBounds(ctx, x, y);
    }
    if (ctx && ctx.Utils && typeof ctx.Utils.inBounds === "function") return ctx.Utils.inBounds(ctx, x, y);
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.inBounds === "function") return window.Utils.inBounds(ctx, x, y);
  } catch (_) {}
  const rows = ctx.map.length, cols = ctx.map[0] ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}



function _manhattan(ctx, ax, ay, bx, by) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.manhattan === "function") return ctx.Utils.manhattan(ax, ay, bx, by);
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.manhattan === "function") return window.Utils.manhattan(ax, ay, bx, by);
  } catch (_) {}
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function _isFreeTownFloor(ctx, x, y) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.isFreeTownFloor === "function") return ctx.Utils.isFreeTownFloor(ctx, x, y);
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.Utils && typeof window.Utils.isFreeTownFloor === "function") return window.Utils.isFreeTownFloor(ctx, x, y);
  } catch (_) {}
  if (!inBounds(ctx, x, y)) return false;
  const t = ctx.map[y][x];
  if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR && t !== ctx.TILES.ROAD) return false;
  if (ctx.player.x === x && ctx.player.y === y) return false;
  if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === x && n.y === y)) return false;
  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
  return true;
}

// ---- Interactions ----
function interactProps(ctx) {
  if (ctx.mode !== "town") return false;
  if (!Array.isArray(ctx.townProps) || !ctx.townProps.length) return false;

  // 1) Prefer the prop directly under the player (any type, including signs).
  let target = ctx.townProps.find(p => p.x === ctx.player.x && p.y === ctx.player.y) || null;

  // 2) If nothing underfoot, allow adjacent props but never auto-trigger signs.
  if (!target) {
    const adj = [
      { x: ctx.player.x + 1, y: ctx.player.y },
      { x: ctx.player.x - 1, y: ctx.player.y },
      { x: ctx.player.x, y: ctx.player.y + 1 },
      { x: ctx.player.x, y: ctx.player.y - 1 },
    ];
    for (const c of adj) {
      const p = ctx.townProps.find(q => q.x === c.x && q.y === c.y);
      if (!p) continue;
      const t = String(p.type || "").toLowerCase();
      if (t === "sign") continue; // signs require standing exactly on the sign tile
      target = p;
      break;
    }
  }

  if (!target) return false;

  // Data-driven interactions strictly via PropsService + props.json
  const PS = ctx.PropsService || getMod(ctx, "PropsService");
  if (PS && typeof PS.interact === "function") {
    return PS.interact(ctx, target);
  }
  return false;
}

// ---- Spawn helpers ----
function ensureSpawnClear(ctx) {
  // Make sure the player isn't inside a building (WALL).
  // If current tile is not walkable, move to the nearest FLOOR/DOOR tile.
  const H = ctx.map.length;
  const W = ctx.map[0] ? ctx.map[0].length : 0;
  const isWalk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (
    ctx.map[y][x] === ctx.TILES.FLOOR || ctx.map[y][x] === ctx.TILES.DOOR || ctx.map[y][x] === ctx.TILES.ROAD
  );
  if (isWalk(ctx.player.x, ctx.player.y)) return true;

  // BFS from current position to nearest walkable
  const q = [];
  const seenB = new Set();
  q.push({ x: ctx.player.x, y: ctx.player.y, d: 0 });
  seenB.add(`${ctx.player.x},${ctx.player.y}`);
  const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  while (q.length) {
    const cur = q.shift();
    for (const d of dirs) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      const key = `${nx},${ny}`;
      if (seenB.has(key)) continue;
      seenB.add(key);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (isWalk(nx, ny)) {
        ctx.player.x = nx; ctx.player.y = ny;
        return true;
      }
      // expand through walls minimally to escape building
      q.push({ x: nx, y: ny, d: cur.d + 1 });
    }
  }
  // Fallback to center
  ctx.player.x = (W / 2) | 0;
  ctx.player.y = (H / 2) | 0;
  return true;
}

function spawnGateGreeters(ctx, count = 4) {
  if (!ctx.townExitAt) return false;
  // Clamp to ensure at most one NPC near the gate within a small radius
  const RADIUS = 2;
  const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
  const existingNear = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => _manhattan(ctx, n.x, n.y, gx, gy) <= RADIUS).length : 0;
  const target = Math.max(0, Math.min((count | 0), 1 - existingNear));
  const RAND = (typeof ctx.rng === "function") ? ctx.rng : Math.random;
  if (target <= 0) {
    // Keep player space clear but ensure at least one greeter remains in radius
    clearAdjacentNPCsAroundPlayer(ctx);
    try {
      const nearNow = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => _manhattan(ctx, n.x, n.y, gx, gy) <= RADIUS).length : 0;
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
          if (_isFreeTownFloor(ctx, c.x, c.y) && _manhattan(ctx, ctx.player.x, ctx.player.y, c.x, c.y) > 1) {
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
      if (_isFreeTownFloor(ctx, x, y) && _manhattan(ctx, ctx.player.x, ctx.player.y, x, y) > 1) {
        const name = names[Math.floor(RAND() * names.length) % names.length];
        ctx.npcs.push({ x, y, name, lines, greeter: true });
        placed++;
        if (placed >= target) break;
      }
    }
  }
  clearAdjacentNPCsAroundPlayer(ctx);
  // After clearing adjacency, ensure at least one greeter remains near the gate
  try {
    const nearNow = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => _manhattan(ctx, n.x, n.y, gx, gy) <= RADIUS).length : 0;
    if (nearNow === 0) {
      const name = "Greeter";
      const lines2 = [
        `Welcome to ${ctx.townName || "our town"}.`,
        "Shops are marked with a flag at their doors.",
        "Stay as long as you like.",
        "The plaza is at the center.",
      ];
      const diag = [
        { x: gx + 1, y: gy + 1 }, { x: gx + 1, y: gy - 1 }, { x: gx - 1, y: gy + 1 }, { x: gx - 1, y: gy - 1 }
      ];
      for (const c of diag) {
        if (_isFreeTownFloor(ctx, c.x, c.y)) { ctx.npcs.push({ x: c.x, y: c.y, name, lines: lines2, greeter: true }); break; }
      }
    }
  } catch (_) {}
  return true;
}

function enforceGateNPCLimit(ctx, limit = 1, radius = 2) {
  if (!ctx || !ctx.npcs || !ctx.townExitAt) return;
  const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
  const nearIdx = [];
  for (let i = 0; i < ctx.npcs.length; i++) {
    const n = ctx.npcs[i];
    if (_manhattan(ctx, n.x, n.y, gx, gy) <= radius) nearIdx.push({ i, d: _manhattan(ctx, n.x, n.y, gx, gy) });
  }
  if (nearIdx.length <= limit) return;
  // Keep the closest 'limit'; remove others
  nearIdx.sort((a, b) => a.d - b.d || a.i - b.i);
  const keepSet = new Set(nearIdx.slice(0, limit).map(o => o.i));
  const toRemove = nearIdx.slice(limit).map(o => o.i).sort((a, b) => b - a);
  for (const idx of toRemove) {
    ctx.npcs.splice(idx, 1);
  }
}

function clearAdjacentNPCsAroundPlayer(ctx) {
  // Ensure the four cardinal neighbors around the player are not all occupied by NPCs
  const neighbors = [
    { x: ctx.player.x + 1, y: ctx.player.y },
    { x: ctx.player.x - 1, y: ctx.player.y },
    { x: ctx.player.x, y: ctx.player.y + 1 },
    { x: ctx.player.x, y: ctx.player.y - 1 },
  ];
  // If any neighbor has an NPC, remove up to two to keep space
  for (const pos of neighbors) {
    const idx = ctx.npcs.findIndex(n => n.x === pos.x && n.y === pos.y);
    if (idx !== -1) {
      ctx.npcs.splice(idx, 1);
    }
  }
}

/**
 * Compute outdoor ground mask (true for outdoor FLOOR tiles; false for building interiors).
 * Separated from generate() for clarity.
 */
function buildOutdoorMask(ctx, buildings, width, height) {
  try {
    const rows = height, cols = width;
    const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
    function insideAnyBuilding(x, y) {
      for (let i = 0; i < buildings.length; i++) {
        const B = buildings[i];
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
      return false;
    }
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        const t = ctx.map[yy][xx];
        if (t === ctx.TILES.FLOOR && !insideAnyBuilding(xx, yy)) {
          mask[yy][xx] = true;
        }
      }
    }
    ctx.townOutdoorMask = mask;
  } catch (_) {}
}

/**
 * Dedupe shop signs: respect per-shop signWanted flag; keep only one sign (nearest to door)
 * and prefer placing it inside near the door.
 */
function dedupeShopSigns(ctx) {
  try {
    if (!Array.isArray(ctx.shops) || !Array.isArray(ctx.townProps) || !ctx.townProps.length) return;
    const props = ctx.townProps;
    const removeIdx = new Set();
    function isInside(bld, x, y) {
      return bld && x > bld.x && x < bld.x + bld.w - 1 && y > bld.y && y < bld.y + bld.h - 1;
    }
    for (let si = 0; si < ctx.shops.length; si++) {
      const s = ctx.shops[si];
      if (!s) continue;
      const text = String(s.name || s.type || "Shop");
      const door = (s.building && s.building.door) ? s.building.door : { x: s.x, y: s.y };
      const namesToMatch = [text];
      // Inn synonyms: dedupe across common variants
      if (String(s.type || "").toLowerCase() === "inn") {
        if (!namesToMatch.includes("Inn")) namesToMatch.push("Inn");
        if (!namesToMatch.includes("Inn & Tavern")) namesToMatch.push("Inn & Tavern");
        if (!namesToMatch.includes("Tavern")) namesToMatch.push("Tavern");
      }
      // Collect indices of sign props that either match canonical name/synonyms
      // or are inside the shop building (unnamed embedded signs count as duplicates).
      const indices = [];
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        if (!p || String(p.type || "").toLowerCase() !== "sign") continue;
        const name = String(p.name || "");
        const insideThisShop = s.building ? isInside(s.building, p.x, p.y) : false;
        if (namesToMatch.includes(name) || insideThisShop) {
          indices.push(i);
        }
      }
      const wants = (s && Object.prototype.hasOwnProperty.call(s, "signWanted")) ? !!s.signWanted : true;

      if (!wants) {
        // Remove all signs for this shop (including synonyms)
        for (const idx of indices) removeIdx.add(idx);
        continue;
      }

      // If multiple signs exist, keep the one closest to the door
      if (indices.length > 1) {
        let keepI = indices[0], bestD = Infinity;
        for (const idx of indices) {
          const p = props[idx];
          const d = Math.abs(p.x - door.x) + Math.abs(p.y - door.y);
          if (d < bestD) { bestD = d; keepI = idx; }
        }
        for (const idx of indices) {
          if (idx !== keepI) removeIdx.add(idx);
        }
      }

      // Ensure kept sign (if any) is outside; otherwise re-place inside near the door.
      // Also canonicalize its text to the shop's name.
      let keptIdx = -1;
      for (let i = 0; i < props.length; i++) {
        if (removeIdx.has(i)) continue;
        const p = props[i];
        if (!p || String(p.type || "").toLowerCase() !== "sign") continue;
        const name = String(p.name || "");
        const insideThisShop = s.building ? isInside(s.building, p.x, p.y) : false;
        if (namesToMatch.includes(name) || insideThisShop) { keptIdx = i; break; }
      }
      if (keptIdx !== -1) {
        const p = props[keptIdx];
        if (s.building && isInside(s.building, p.x, p.y)) {
          // Already inside: canonicalize name
          try { if (String(p.name || "") !== text) p.name = text; } catch (_) {}
        } else {
          // Move outside sign to inside near door
          removeIdx.add(keptIdx);
          try { addShopSignInside(s.building, door, text); } catch (_) {}
        }
      } else {
        // No sign exists; place one inside near the door
        try { if (s.building) addShopSignInside(s.building, door, text); } catch (_) {}
      }
    }

    if (removeIdx.size) {
      ctx.townProps = props.filter((_, i) => !removeIdx.has(i));
    }
  } catch (_) {}
}

/**
 * Dedupe welcome sign globally: keep only the one closest to the gate and ensure one exists.
 */
function dedupeWelcomeSign(ctx) {
  try {
    if (!Array.isArray(ctx.townProps)) return;
    const text = `Welcome to ${ctx.townName}`;
    const props = ctx.townProps;
    let keepIdx = -1, bestD = Infinity;
    const removeIdx = new Set();
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p && String(p.type || "").toLowerCase() === "sign" && String(p.name || "") === text) {
        const d = Math.abs(p.x - ctx.townExitAt.x) + Math.abs(p.y - ctx.townExitAt.y);
        if (d < bestD) { bestD = d; keepIdx = i; }
        removeIdx.add(i);
      }
    }
    if (keepIdx !== -1) removeIdx.delete(keepIdx);
    if (removeIdx.size) {
      ctx.townProps = props.filter((_, i) => !removeIdx.has(i));
    }
    const hasWelcome = Array.isArray(ctx.townProps) && ctx.townProps.some(p => p && String(p.type || "").toLowerCase() === "sign" && String(p.name || "") === text);
    if (!hasWelcome && ctx.townExitAt) {
      try { addSignNear(ctx.townExitAt.x, ctx.townExitAt.y, text); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Cleanup dangling props from removed buildings: ensure interior-only props are only inside valid buildings.
 */
function cleanupDanglingProps(ctx, buildings) {
  try {
    if (!Array.isArray(ctx.townProps) || !ctx.townProps.length) return;
    function insideAnyBuilding(x, y) {
      for (let i = 0; i < buildings.length; i++) {
        const B = buildings[i];
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
      return false;
    }
    // Props that should never exist outside a building interior
    const interiorOnly = new Set(["bed","table","chair","shelf","rug","fireplace","quest_board","chest","counter"]);
    ctx.townProps = ctx.townProps.filter(p => {
      if (!inBounds(ctx, p.x, p.y)) return false;
      const t = ctx.map[p.y][p.x];
      // Drop props that sit on non-walkable tiles
      if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.STAIRS && t !== ctx.TILES.ROAD) return false;
      const inside = insideAnyBuilding(p.x, p.y);
      // Interior-only items: keep only if inside some building
      if (interiorOnly.has(String(p.type || "").toLowerCase())) return inside;
      // Signs: allow inside or outside; will be deduped per-shop elsewhere
      if (String(p.type || "").toLowerCase() === "sign") return true;
      // Other props (crates/barrels/plants/stall) are allowed anywhere if tile is walkable
      return true;
    });
  } catch (_) {}
}

/**
 * Build roads after buildings: one main road from gate to plaza, then spurs from every building door.
 * Thin wrapper around Roads.build for clarity.
 */
function buildRoadsAndPublish(ctx) {
  try {
    Roads.build(ctx);
  } catch (_) {}
}

/**
 * Plaza fixtures via prefab only (no fallbacks). For castle settlements, keep the central area
 * clear for the castle keep and skip plaza prefabs.
 */
function placePlazaPrefabStrict(ctx, townKind, plaza, plazaW, plazaH, rng) {
  try {
    // Guard: if a plaza prefab was already stamped in this generation cycle, skip
    try {
      if (ctx.townPrefabUsage && Array.isArray(ctx.townPrefabUsage.plazas) && ctx.townPrefabUsage.plazas.length > 0) return;
    } catch (_) {}
    const GD7 = getGameData(ctx);
    const PFB = (GD7 && GD7.prefabs) ? GD7.prefabs : null;
    const plazas = (PFB && Array.isArray(PFB.plazas)) ? PFB.plazas : [];
    if (!plazas.length) {
      try { if (ctx && typeof ctx.log === "function") ctx.log("Plaza: no plaza prefabs defined; using fallback layout only.", "notice"); } catch (_) {}
      return;
    }

    // Clear the plaza rectangle before stamping so that any previous roads/buildings
    // inside the plaza do not prevent prefab placement.
    try {
      const px0 = ((plaza.x - (plazaW / 2)) | 0);
      const px1 = ((plaza.x + (plazaW / 2)) | 0);
      const py0 = ((plaza.y - (plazaH / 2)) | 0);
      const py1 = ((plaza.y + (plazaH / 2)) | 0);
      const rx0 = Math.max(1, px0);
      const ry0 = Math.max(1, py0);
      const rx1 = Math.min(ctx.map[0].length - 2, px1);
      const ry1 = Math.min(ctx.map.length - 2, py1);

      // Remove any buildings overlapping the plaza rectangle
      const overl = findBuildingsOverlappingRect(rx0, ry0, rx1 - rx0 + 1, ry1 - ry0 + 1, 0);
      if (overl && overl.length) {
        for (let i = 0; i < overl.length; i++) {
          removeBuildingAndProps(overl[i]);
        }
      }
      // Force tiles in the plaza rectangle back to FLOOR before stamping
      for (let yy = ry0; yy <= ry1; yy++) {
        for (let xx = rx0; xx <= rx1; xx++) {
          ctx.map[yy][xx] = ctx.TILES.FLOOR;
        }
      }
    } catch (_) {}

    // Filter prefabs that fit inside current plaza rectangle
    const fit = plazas.filter(p => p && p.size && (p.size.w | 0) <= plazaW && (p.size.h | 0) <= plazaH);
    const list = (fit.length ? fit : plazas);
    const pref = pickPrefab(list, ctx.rng || rng);
    if (!pref || !pref.size) {
      try { if (ctx && typeof ctx.log === "function") ctx.log("Plaza: failed to pick a valid plaza prefab; using fallback layout.", "notice"); } catch (_) {}
      return;
    }
    // Center the plaza prefab within the carved plaza rectangle
    const bx = ((plaza.x - ((pref.size.w / 2) | 0)) | 0);
    const by = ((plaza.y - ((pref.size.h / 2) | 0)) | 0);
    if (!stampPlazaPrefab(ctx, pref, bx, by)) {
      // Attempt slight slip only; no fallback
      const slipped = trySlipStamp(ctx, pref, bx, by, 2);
      if (!slipped) {
        try { if (ctx && typeof ctx.log === "function") ctx.log("Plaza: plaza prefab did not fit even after clearing area; using fallback layout.", "notice"); } catch (_) {}
      } else {
        try { if (ctx && typeof ctx.log === "function") ctx.log(`Plaza: plaza prefab '${pref.id || "unknown"}' placed with slip.`, "notice"); } catch (_) {}
      }
    } else {
      try { if (ctx && typeof ctx.log === "function") ctx.log(`Plaza: plaza prefab '${pref.id || "unknown"}' stamped successfully.`, "notice"); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Repair pass: enforce solid building perimeters (convert any non-door/window on borders to WALL).
 */
function repairBuildingPerimeters(ctx, buildings) {
  try {
    for (const b of buildings) {
      const x0 = b.x, y0 = b.y, x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
      // Top and bottom edges
      for (let xx = x0; xx <= x1; xx++) {
        if (inBounds(ctx, xx, y0)) {
          const t = ctx.map[y0][xx];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[y0][xx] = ctx.TILES.WALL;
        }
        if (inBounds(ctx, xx, y1)) {
          const t = ctx.map[y1][xx];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[y1][xx] = ctx.TILES.WALL;
        }
      }
      // Left and right edges
      for (let yy = y0; yy <= y1; yy++) {
        if (inBounds(ctx, x0, yy)) {
          const t = ctx.map[yy][x0];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[yy][x0] = ctx.TILES.WALL;
        }
        if (inBounds(ctx, x1, yy)) {
          const t = ctx.map[yy][x1];
          if (t !== ctx.TILES.DOOR && t !== ctx.TILES.WINDOW) ctx.map[yy][x1] = ctx.TILES.WALL;
        }
      }
    }
  } catch (_) {}
}



// ---- Generation (compact version; retains core behavior and mutations) ----
function generate(ctx) {
  const { rng, W, H, gate, townSize, townKind, townName, TOWNCFG, info } = buildBaseTown(ctx);

  // Plaza (carved via helper; returns center and dimensions)
  const { plaza, plazaW, plazaH } = buildPlaza(ctx, W, H, townSize, TOWNCFG);

  // Roads (deferred): build after buildings and outdoor mask are known
  

  // Buildings container (either prefab-placed or hollow rectangles as fallback)
  const buildings = [];
  // Prefab-stamped shops (collected during placement; integrated later with schedules and signs)
  const prefabShops = [];
  const STRICT_PREFABS = true;
  // Enforce strict prefab mode when prefab registry has loaded
  function prefabsAvailable() {
    try {
      return Prefabs.prefabsAvailable(ctx);
    } catch (_) { return false; }
  }
  const strictNow = !!STRICT_PREFABS && !!prefabsAvailable();
  try { if (!strictNow && typeof ctx.log === "function") ctx.log("Prefabs not loaded yet; using rectangle fallback this visit.", "warn"); } catch (_) {}

  // Rect helpers and conflict resolution
  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh, margin = 0) {
    const ax0 = ax - margin, ay0 = ay - margin, ax1 = ax + aw - 1 + margin, ay1 = ay + ah - 1 + margin;
    const bx0 = bx - margin, by0 = by - margin, bx1 = bx + bw - 1 + margin, by1 = by + bh - 1 + margin;
    const sepX = (ax1 < bx0) || (bx1 < ax0);
    const sepY = (ay1 < by0) || (by1 < ay0);
    return !(sepX || sepY);
  }
  function findBuildingsOverlappingRect(x0, y0, w, h, margin = 0) {
    const out = [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (rectOverlap(b.x, b.y, b.w, b.h, x0, y0, w, h, margin)) out.push(b);
    }
    return out;
  }
  function removeBuildingAndProps(b) {
    try {
      // Clear tiles to FLOOR inside building rect (remove walls/doors/windows)
      for (let yy = b.y; yy <= b.y + b.h - 1; yy++) {
        for (let xx = b.x; xx <= b.x + b.w - 1; xx++) {
          if (inBounds(ctx, xx, yy)) ctx.map[yy][xx] = ctx.TILES.FLOOR;
        }
      }
    } catch (_) {}
    try {
      // Remove props inside rect with 1-tile margin (includes signs just outside)
      ctx.townProps = Array.isArray(ctx.townProps)
        ? ctx.townProps.filter(p => !(rectOverlap(b.x, b.y, b.w, b.h, p.x, p.y, 1, 1, 2)))
        : [];
    } catch (_) {}
    try {
      // Remove shops tied to this building
      ctx.shops = Array.isArray(ctx.shops)
        ? ctx.shops.filter(s => !(s && s.building && rectOverlap(s.building.x, s.building.y, s.building.w, s.building.h, b.x, b.y, b.w, b.h, 0)))
        : [];
      // Also remove any pending prefab shop records mapped to this rect
      for (let i = prefabShops.length - 1; i >= 0; i--) {
        const ps = prefabShops[i];
        if (ps && ps.building && rectOverlap(ps.building.x, ps.building.y, ps.building.w, ps.building.h, b.x, b.y, b.w, b.h, 0)) {
          prefabShops.splice(i, 1);
        }
      }
    } catch (_) {}
    try {
      // Remove from buildings list
      for (let i = buildings.length - 1; i >= 0; i--) {
        const q = buildings[i];
        if (q && q.x === b.x && q.y === b.y && q.w === b.w && q.h === b.h) buildings.splice(i, 1);
      }
    } catch (_) {}
    try {
      // Invalidate tavern reference if it overlaps
      const tb = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
      if (tb && rectOverlap(tb.x, tb.y, tb.w, tb.h, b.x, b.y, b.w, b.h, 0)) {
        ctx.tavern = undefined; ctx.inn = undefined;
      }
    } catch (_) {}
  }
  function trySlipStamp(ctx, prefab, bx, by, maxSlip = 2) {
    // Delegate to module implementation (passes buildings reference for rect recording)
    const res = Prefabs.trySlipStamp(ctx, prefab, bx, by, maxSlip, buildings);
    if (res && res.ok && res.shop && res.rect) {
      try {
        prefabShops.push({
          type: res.shop.type,
          building: { x: res.rect.x, y: res.rect.y, w: res.rect.w, h: res.rect.h },
          door: { x: res.shop.door.x, y: res.shop.door.y },
          name: res.shop.name,
          scheduleOverride: res.shop.scheduleOverride,
          signWanted: res.shop.signWanted
        });
      } catch (_) {}
    }
    return !!res;
  }

  // --- Prefab helpers ---
  function stampPrefab(ctx, prefab, bx, by) {
    // Delegate to module implementation (passes buildings reference for rect recording and upstairs overlay handling)
    const res = Prefabs.stampPrefab(ctx, prefab, bx, by, buildings);
    if (res && res.ok && res.shop && res.rect) {
      try {
        prefabShops.push({
          type: res.shop.type,
          building: { x: res.rect.x, y: res.rect.y, w: res.rect.w, h: res.rect.h },
          door: { x: res.shop.door.x, y: res.shop.door.y },
          name: res.shop.name,
          scheduleOverride: res.shop.scheduleOverride,
          signWanted: res.shop.signWanted
        });
      } catch (_) {}
    }
    return !!res;
  }

    

  // Stamp a plaza prefab (props only; no building record)
  // All-or-nothing: stage changes and commit only if the prefab grid fully validates.
  function stampPlazaPrefab(ctx, prefab, bx, by) {
    // Delegate to module implementation
    return Prefabs.stampPlazaPrefab(ctx, prefab, bx, by);
  }

  // Enlarge and position the Inn next to the plaza, with size almost as big as the plaza and double doors facing it
  (function enlargeInnBuilding() {
    // Always carve the Inn even if no other buildings exist, to guarantee at least one building

    // Target size: scale from plaza dims and ensure larger minimums by town size
    let rectUsedInn = null;
    const sizeKey = townSize;
    // Make inn a bit smaller than before to keep plaza spacious (data-driven via town.json when available)
    const innSize = getInnSizeConfig(TOWNCFG, sizeKey);
    const minW = innSize.minW;
    const minH = innSize.minH;
    const scaleW = innSize.scaleW;
    const scaleH = innSize.scaleH;
    const targetW = Math.max(minW, Math.floor(plazaW * scaleW));
    const targetH = Math.max(minH, Math.floor(plazaH * scaleH));

    // Require a clear one-tile floor margin around the Inn so it never connects to other buildings
    function hasMarginClear(x, y, w, h, margin = 1) {
      const x0 = Math.max(1, x - margin);
      const y0 = Math.max(1, y - margin);
      const x1 = Math.min(W - 2, x + w - 1 + margin);
      const y1 = Math.min(H - 2, y + h - 1 + margin);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          // Outside the rect or inside, we require current tiles to be FLOOR (roads/plaza),
          // not walls/doors/windows of other buildings.
          if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) return false;
        }
      }
      return true;
    }

    // Try to place the Inn on one of the four sides adjacent to the plaza, ensuring margin clear
    function placeInnRect() {
      // Start with desired target size and shrink if we cannot find a margin-clear slot
      let tw = targetW, th = targetH;

      // Attempt multiple shrink steps to satisfy margin without touching other buildings
      for (let shrink = 0; shrink < 4; shrink++) {
        const candidates = [];

        // East of plaza
        candidates.push({
          side: "westFacing",
          x: Math.min(W - 2 - tw, ((plaza.x + (plazaW / 2)) | 0) + 2),
          y: Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0))
        });
        // West of plaza
        candidates.push({
          side: "eastFacing",
          x: Math.max(1, ((plaza.x - (plazaW / 2)) | 0) - 2 - tw),
          y: Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0))
        });
        // South of plaza
        candidates.push({
          side: "northFacing",
          x: Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0)),
          y: Math.min(H - 2 - th, ((plaza.y + (plazaH / 2)) | 0) + 2)
        });
        // North of plaza
        candidates.push({
          side: "southFacing",
          x: Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0)),
          y: Math.max(1, ((plaza.y - (plazaH / 2)) | 0) - 2 - th)
        });

        // Pick the first candidate that fits fully in bounds and has a clear margin
        for (const c of candidates) {
          const nx = Math.max(1, Math.min(W - 2 - tw, c.x));
          const ny = Math.max(1, Math.min(H - 2 - th, c.y));
          const fits = (nx >= 1 && ny >= 1 && nx + tw < W - 1 && ny + th < H - 1);
          // Also ensure the Inn never overlaps the plaza footprint
          if (fits && hasMarginClear(nx, ny, tw, th, 1) && !overlapsPlazaRect(nx, ny, tw, th, 1)) {
            return { x: nx, y: ny, w: tw, h: th, facing: c.side };
          }
        }

        // If none fit with current size, shrink slightly and try again
        tw = Math.max(minW, tw - 2);
        th = Math.max(minH, th - 2);
      }

      // As a last resort, shrink until margin-clear and non-overlap near plaza center
      for (let extraShrink = 0; extraShrink < 6; extraShrink++) {
        const nx = Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0));
        const ny = Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0));
        const fits = (nx >= 1 && ny >= 1 && nx + tw < W - 1 && ny + th < H - 1);
        if (fits && hasMarginClear(nx, ny, tw, th, 1) && !overlapsPlazaRect(nx, ny, tw, th, 1)) {
          return { x: nx, y: ny, w: tw, h: th, facing: "southFacing" };
        }
        tw = Math.max(minW, tw - 2);
        th = Math.max(minH, th - 2);
      }
      // Final minimal placement
      const nx = Math.max(1, Math.min(W - 2 - tw, (plaza.x - (tw / 2)) | 0));
      const ny = Math.max(1, Math.min(H - 2 - th, (plaza.y - (th / 2)) | 0));
      return { x: nx, y: ny, w: tw, h: th, facing: "southFacing" };
    }

    const innRect = placeInnRect();

    // Prefer prefab-based Inn stamping when available
    const GD2 = getGameData(ctx);
    const PFB = (GD2 && GD2.prefabs) ? GD2.prefabs : null;
    let usedPrefabInn = false;
    if (PFB && Array.isArray(PFB.inns) && PFB.inns.length) {
      // Prefer the largest inn prefab that fits, to ensure a roomy tavern
      const innsSorted = PFB.inns
        .slice()
        .filter(p => p && p.size && typeof p.size.w === "number" && typeof p.size.h === "number")
        .sort((a, b) => (b.size.w * b.size.h) - (a.size.w * a.size.h));

      // Try stamping centered in innRect; if it doesn't fit, shrink rect and retry a few times
      let bx = innRect.x, by = innRect.y, bw = innRect.w, bh = innRect.h;
      for (let attempts = 0; attempts < 4 && !usedPrefabInn; attempts++) {
        const pref = innsSorted.find(p => p.size.w <= bw && p.size.h <= bh) || null;
        if (pref) {
          const ox = Math.floor((bw - pref.size.w) / 2);
          const oy = Math.floor((bh - pref.size.h) / 2);
          if (stampPrefab(ctx, pref, bx + ox, by + oy)) {
            usedPrefabInn = true;
            rectUsedInn = { x: bx + ox, y: by + oy, w: pref.size.w, h: pref.size.h };
            break;
          }
        }
        bw = Math.max(10, bw - 2);
        bh = Math.max(8, bh - 2);
      }
    }

    // Decide whether to proceed with inn assignment
    
    if (!usedPrefabInn) {
      // Second pass: try stamping an inn prefab anywhere on the map (largest-first), allowing removal of overlapping buildings
      const GD3 = getGameData(ctx);
      const PFB2 = (GD3 && GD3.prefabs) ? GD3.prefabs : null;
      if (PFB2 && Array.isArray(PFB2.inns) && PFB2.inns.length) {
        const innsSorted2 = PFB2.inns
          .slice()
          .filter(function(p){ return p && p.size && typeof p.size.w === "number" && typeof p.size.h === "number"; })
          .sort(function(a, b){ return (b.size.w * b.size.h) - (a.size.w * a.size.h); });
        let stamped = false;
        for (let ip = 0; ip < innsSorted2.length && !stamped; ip++) {
          const pref = innsSorted2[ip];
          const wInn = pref.size.w | 0, hInn = pref.size.h | 0;
          for (let y = 2; y <= H - hInn - 2 && !stamped; y++) {
            for (let x = 2; x <= W - wInn - 2 && !stamped; x++) {
              // Try stamping directly
              if (stampPrefab(ctx, pref, x, y)) {
                rectUsedInn = { x: x, y: y, w: wInn, h: hInn };
                usedPrefabInn = true;
                stamped = true;
                break;
              }
              // If blocked by existing buildings, remove ALL overlaps and try again
              const overl = findBuildingsOverlappingRect(x, y, wInn, hInn, 0);
              if (overl && overl.length) {
                for (let oi = 0; oi < overl.length; oi++) {
                  removeBuildingAndProps(overl[oi]);
                }
                if (stampPrefab(ctx, pref, x, y)) {
                  rectUsedInn = { x: x, y: y, w: wInn, h: hInn };
                  usedPrefabInn = true;
                  stamped = true;
                  break;
                }
              }
            }
          }
        }
        // Force a plaza-centered placement by clearing overlaps if none were stamped in the scan
        if (!stamped) {
          const pref0 = innsSorted2[0];
          if (pref0 && pref0.size) {
            const wInn0 = pref0.size.w | 0, hInn0 = pref0.size.h | 0;
            const fx = Math.max(2, Math.min(W - wInn0 - 2, ((plaza.x - ((wInn0 / 2) | 0)) | 0)));
            const fy = Math.max(2, Math.min(H - hInn0 - 2, ((plaza.y - ((hInn0 / 2) | 0)) | 0)));
            const overl0 = findBuildingsOverlappingRect(fx, fy, wInn0, hInn0, 0);
            if (overl0 && overl0.length) {
              for (let oi = 0; oi < overl0.length; oi++) {
                removeBuildingAndProps(overl0[oi]);
              }
            }
            if (stampPrefab(ctx, pref0, fx, fy)) {
              rectUsedInn = { x: fx, y: fy, w: wInn0, h: hInn0 };
              usedPrefabInn = true;
            }
          }
        }
      }
      // As an absolute fallback, carve a hollow-rectangle Inn near the plaza to guarantee an Inn exists
      if (!usedPrefabInn) {
        placeBuilding(innRect.x, innRect.y, innRect.w, innRect.h);
        rectUsedInn = { x: innRect.x, y: innRect.y, w: innRect.w, h: innRect.h };
      }
    }

    

    // Choose an existing building to replace/represent the inn, prefer the one closest to baseRect center,
    // and ensure the building record matches the actual stamped inn rectangle so furnishing runs correctly.
    const baseRect = rectUsedInn || innRect;
    let targetIdx = -1, bestD = Infinity;
    const cx = (baseRect.x + (baseRect.w / 2)) | 0;
    const cy = (baseRect.y + (baseRect.h / 2)) | 0;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const d = Math.abs((b.x + (b.w / 2)) - cx) + Math.abs((b.y + (b.h / 2)) - cy);
      if (d < bestD) { bestD = d; targetIdx = i; }
    }
    if (targetIdx === -1) {
      // If none available (shouldn't happen), push a new building record
      buildings.push({ x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h });
    } else {
      const prevB = buildings[targetIdx];
      buildings[targetIdx] = {
        x: baseRect.x,
        y: baseRect.y,
        w: baseRect.w,
        h: baseRect.h,
        prefabId: prevB ? prevB.prefabId : null,
        prefabCategory: prevB ? prevB.prefabCategory : null
      };
    }

    // Record the tavern (Inn) building and its preferred door (closest to plaza)
    try {
      const cds = candidateDoors(baseRect);
      let bestDoor = null, bestD2 = Infinity;
      for (const d of cds) {
        if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
          const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
          if (dd < bestD2) { bestD2 = dd; bestDoor = { x: d.x, y: d.y }; }
        }
      }
      // Do not auto-carve doors for the inn; rely solely on prefab DOOR tiles.
      try {
        const bRec = buildings.find(b => b.x === baseRect.x && b.y === baseRect.y && b.w === baseRect.w && b.h === baseRect.h) || null;
        const pid = (bRec && typeof bRec.prefabId !== "undefined") ? bRec.prefabId : null;
        const pcat = (bRec && typeof bRec.prefabCategory !== "undefined") ? bRec.prefabCategory : null;
        if (bestDoor) {
          ctx.tavern = {
            building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h, prefabId: pid, prefabCategory: pcat },
            door: { x: bestDoor.x, y: bestDoor.y }
          };
        } else {
          ctx.tavern = {
            building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h, prefabId: pid, prefabCategory: pcat }
          };
        }
      } catch (_) {
        if (bestDoor) {
          ctx.tavern = { building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h }, door: { x: bestDoor.x, y: bestDoor.y } };
        } else {
          ctx.tavern = { building: { x: baseRect.x, y: baseRect.y, w: baseRect.w, h: baseRect.h } };
        }
      }
    } catch (_) {}
  })();

  function pickPrefab(list, rng) {
    // Delegate to module implementation
    return Prefabs.pickPrefab(list, rng);
  }

  // --- Hollow rectangle fallback helpers ---
  const placeBuilding = (bx, by, bw, bh) => {
    for (let yy = by; yy < by + bh; yy++) {
      for (let xx = bx; xx < bx + bw; xx++) {
        if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
        const isBorder = (yy === by || yy === by + bh - 1 || xx === bx || xx === bx + bw - 1);
        ctx.map[yy][xx] = isBorder ? ctx.TILES.WALL : ctx.TILES.FLOOR;
      }
    }
    buildings.push({ x: bx, y: by, w: bw, h: bh });
  };

  // For castle settlements, reserve a "keep" tower building with a luxurious interior.
  // The keep must never overwrite the central plaza: keep and plaza remain visually distinct.
  if (townKind === "castle") {
    (function placeCastleKeep() {
      try {
        // Scale keep size from plaza size, with bounds tied to town size (data-driven via town.json when available).
        const keepSize = getCastleKeepSizeConfig(TOWNCFG, townSize, plazaW, plazaH, W, H);
        let keepW = keepSize.keepW;
        let keepH = keepSize.keepH;
        if (keepW < 10 || keepH < 8) return;

        // Start centered on the plaza.
        let kx = Math.max(2, Math.min(W - keepW - 2, (plaza.x - (keepW / 2)) | 0));
        let ky = Math.max(2, Math.min(H - keepH - 2, (plaza.y - (keepH / 2)) | 0));

        // If this would overlap the plaza rectangle, try shifting the keep to one of the four sides
        // so the plaza stays open.
        if (overlapsPlazaRect(kx, ky, keepW, keepH, 0)) {
          const candidates = [
            // Below plaza
            {
              x: Math.max(2, Math.min(W - keepW - 2, (plaza.x - (keepW / 2)) | 0)),
              y: Math.min(H - keepH - 2, ((plaza.y + (plazaH / 2)) | 0) + 2)
            },
            // Above plaza
            {
              x: Math.max(2, Math.min(W - keepW - 2, (plaza.x - (keepW / 2)) | 0)),
              y: Math.max(2, ((plaza.y - (plazaH / 2)) | 0) - 2 - keepH)
            },
            // Right of plaza
            {
              x: Math.min(W - keepW - 2, ((plaza.x + (plazaW / 2)) | 0) + 2),
              y: Math.max(2, Math.min(H - keepH - 2, (plaza.y - (keepH / 2)) | 0))
            },
            // Left of plaza
            {
              x: Math.max(2, ((plaza.x - (plazaW / 2)) | 0) - 2 - keepW),
              y: Math.max(2, Math.min(H - keepH - 2, (plaza.y - (keepH / 2)) | 0))
            }
          ];
          let placedPos = null;
          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const cx = Math.max(2, Math.min(W - keepW - 2, c.x));
            const cy = Math.max(2, Math.min(H - keepH - 2, c.y));
            if (overlapsPlazaRect(cx, cy, keepW, keepH, 0)) continue;
            placedPos = { x: cx, y: cy };
            break;
          }
          if (!placedPos) {
            // No valid non-overlapping placement; skip keep to preserve plaza.
            return;
          }
          kx = placedPos.x;
          ky = placedPos.y;
        }

        // Do not overwrite the gate tile.
        if (kx <= gate.x && gate.x <= kx + keepW - 1 && ky <= gate.y && gate.y <= ky + keepH - 1) {
          return;
        }

        // Ensure the area is mostly floor before carving (avoid overlapping existing prefab buildings).
        let blocked = false;
        for (let y = ky; y < ky + keepH && !blocked; y++) {
          for (let x = kx; x < kx + keepW; x++) {
            if (y <= 0 || x <= 0 || y >= H - 1 || x >= W - 1) { blocked = true; break; }
            const t = ctx.map[y][x];
            if (t !== ctx.TILES.FLOOR) { blocked = true; break; }
          }
        }
        if (blocked) return;

        // Carve the keep shell.
        placeBuilding(kx, ky, keepW, keepH);

        // Annotate the most recently added building as the castle keep for diagnostics.
        const keep = buildings[buildings.length - 1];
        if (keep) {
          keep.prefabId = "castle_keep";
          keep.prefabCategory = "castle";
        }

        // Luxurious interior furnishing: central hall rug, throne area, side chambers with beds/chests.
        const innerX0 = kx + 1;
        const innerY0 = ky + 1;
        const innerX1 = kx + keepW - 2;
        const innerY1 = ky + keepH - 2;
        const midX = (innerX0 + innerX1) >> 1;
        const midY = (innerY0 + innerY1) >> 1;

        function safeAddProp(x, y, type, name) {
          try {
            if (x <= innerX0 || y <= innerY0 || x >= innerX1 || y >= innerY1) return;
            if (ctx.map[y][x] !== ctx.TILES.FLOOR) return;
            if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return;
            ctx.townProps.push({ x, y, type, name });
          } catch (_) {}
        }

        // Long rug down the central hall.
        for (let y = innerY0 + 1; y <= innerY1 - 1; y++) {
          safeAddProp(midX, y, "rug");
        }

        // Throne area at the far end from the gate: decide orientation by comparing to gate position.
        let throneY = innerY0 + 1;
        let tableY = throneY + 1;
        if (gate.y < ky) {
          // Gate is above keep -> throne at south end.
          throneY = innerY1 - 1;
          tableY = throneY - 1;
        }
        safeAddProp(midX, throneY, "chair", "Throne");
        safeAddProp(midX - 1, throneY, "plant");
        safeAddProp(midX + 1, throneY, "plant");
        // High table in front of throne.
        safeAddProp(midX, tableY, "table");

        // Grand fireplaces on the side walls.
        safeAddProp(innerX0 + 1, midY, "fireplace");
        safeAddProp(innerX1 - 1, midY, "fireplace");

        // Side chambers with beds and chests.
        safeAddProp(innerX0 + 2, innerY0 + 2, "bed");
        safeAddProp(innerX0 + 3, innerY0 + 2, "chest");
        safeAddProp(innerX1 - 3, innerY0 + 2, "bed");
        safeAddProp(innerX1 - 2, innerY0 + 2, "chest");

        safeAddProp(innerX0 + 2, innerY1 - 2, "bed");
        safeAddProp(innerX0 + 3, innerY1 - 2, "table");
        safeAddProp(innerX1 - 3, innerY1 - 2, "bed");
        safeAddProp(innerX1 - 2, innerY1 - 2, "table");

        // Decorative plants and barrels along the walls.
        for (let x = innerX0 + 2; x <= innerX1 - 2; x += 3) {
          safeAddProp(x, innerY0 + 1, "plant");
          safeAddProp(x, innerY1 - 1, "plant");
        }
        safeAddProp(innerX0 + 1, innerY0 + 1, "barrel");
        safeAddProp(innerX1 - 1, innerY0 + 1, "barrel");
      } catch (_) {}
    })();
  }
  const cfgB = (TOWNCFG && TOWNCFG.buildings) || {};
  const bConf = getTownBuildingConfig(TOWNCFG, townSize, townKind);
  const maxBuildings = bConf.maxBuildings;
  const blockW = bConf.blockW;
  const blockH = bConf.blockH;

  // Ensure a margin of clear floor around buildings so walls never touch between buildings
  function isAreaClearForBuilding(bx, by, bw, bh, margin = 1) {
    const x0 = Math.max(1, bx - margin);
    const y0 = Math.max(1, by - margin);
    const x1 = Math.min(W - 2, bx + bw - 1 + margin);
    const y1 = Math.min(H - 2, by + bh - 1 + margin);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const t = ctx.map[yy][xx];
        if (t !== ctx.TILES.FLOOR) return false;
      }
    }
    return true;
  }

  // Prevent any building rectangle from overlapping the town plaza footprint (optionally with a small buffer)
  function overlapsPlazaRect(bx, by, bw, bh, margin = 0) {
    // Compute plaza rectangle bounds exactly as carved earlier
    const px0 = ((plaza.x - (plazaW / 2)) | 0);
    const px1 = ((plaza.x + (plazaW / 2)) | 0);
    const py0 = ((plaza.y - (plazaH / 2)) | 0);
    const py1 = ((plaza.y + (plazaH / 2)) | 0);
    const ax0 = bx, ay0 = by;
    const ax1 = bx + bw - 1, ay1 = by + bh - 1;
    const bx0 = Math.max(1, px0 - margin), by0 = Math.max(1, py0 - margin);
    const bx1 = Math.min(W - 2, px1 + margin), by1 = Math.min(H - 2, py1 + margin);
    // Axis-aligned rectangle overlap check
    const sepX = (ax1 < bx0) || (bx1 < ax0);
    const sepY = (ay1 < by0) || (by1 < ay0);
    return !(sepX || sepY);
  }

  for (let by = 2; by < H - (blockH + 4) && buildings.length < maxBuildings; by += Math.max(6, blockH + 2)) {
    for (let bx = 2; bx < W - (blockW + 4) && buildings.length < maxBuildings; bx += Math.max(8, blockW + 2)) {
      let clear = true;
      for (let yy = by; yy < by + (blockH + 1) && clear; yy++) {
        for (let xx = bx; xx < bx + (blockW + 1); xx++) {
          if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) { clear = false; break; }
        }
      }
      if (!clear) continue;
      // Strongly varied house sizes:
      // Mixture of small cottages, medium houses (wide spread), and large/longhouses,
      // while respecting per-block bounds and minimums.
      const wMin = 6, hMin = 4;
      const wMax = Math.max(wMin, blockW);
      const hMax = Math.max(hMin, blockH);
      const randint = (min, max) => min + Math.floor(rng() * (Math.max(0, (max - min + 1))));
      let w, h;
      const r = rng();
      if (r < 0.35) {
        // Small cottage cluster (near minimums)
        w = randint(wMin, Math.min(wMin + 2, wMax));
        h = randint(hMin, Math.min(hMin + 2, hMax));
      } else if (r < 0.75) {
        // Medium: uniform across full range with aspect ratio nudges
        w = randint(wMin, wMax);
        h = randint(hMin, hMax);
        if (ctx.rng() < 0.5) {
          const bias = randint(-2, 3);
          h = Math.max(hMin, Math.min(hMax, h + bias));
        } else {
          const bias = randint(-2, 3);
          w = Math.max(wMin, Math.min(wMax, w + bias));
        }
      } else {
        // Large: near max with occasional longhouses
        w = Math.max(wMin, Math.min(wMax, wMax - randint(0, Math.min(3, wMax - wMin))));
        h = Math.max(hMin, Math.min(hMax, hMax - randint(0, Math.min(3, hMax - hMin))));
        // Longhouse variant: one dimension near max, the other skewed small/medium
        if (ctx.rng() < 0.4) {
          if (ctx.rng() < 0.5) {
            w = Math.max(w, Math.min(wMax, wMax - randint(0, 1)));
            h = Math.max(hMin, Math.min(hMax, hMin + randint(0, Math.min(4, hMax - hMin))));
          } else {
            h = Math.max(h, Math.min(hMax, hMax - randint(0, 1)));
            w = Math.max(wMin, Math.min(wMax, wMin + randint(0, Math.min(4, wMax - wMin))));
          }
        }
      }
      // Rare outliers: either tiny footprint or very large (still within block bounds)
      if (ctx.rng() < 0.08) {
        if (ctx.rng() < 0.5) {
          w = wMin;
          h = Math.max(hMin, Math.min(hMax, hMin + randint(0, Math.min(2, hMax - hMin))));
        } else {
          w = Math.max(wMin, Math.min(wMax, wMax - randint(0, 1)));
          h = Math.max(hMin, Math.min(hMax, hMax - randint(0, 1)));
        }
      }

      const ox = Math.floor(ctx.rng() * Math.max(1, blockW - w));
      const oy = Math.floor(ctx.rng() * Math.max(1, blockH - h));
      const fx = bx + 1 + ox;
      const fy = by + 1 + oy;
      // Avoid overlapping the town plaza footprint (with a 1-tile walkway buffer)
      if (overlapsPlazaRect(fx, fy, w, h, 1)) continue;
      // Enforce at least one tile of floor margin between buildings
      if (!isAreaClearForBuilding(fx, fy, w, h, 1)) continue;

      const GD4 = getGameData(ctx);
      const PFB = (GD4 && GD4.prefabs) ? GD4.prefabs : null;
      let usedPrefab = false;
      if (PFB && Array.isArray(PFB.houses) && PFB.houses.length) {
        // Pick a house prefab that fits in (w,h)
        const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= w && p.size.h <= h);
        if (candidates.length) {
          const pref = pickPrefab(candidates, ctx.rng || rng);
          if (pref && pref.size) {
            const oxCenter = Math.floor((w - pref.size.w) / 2);
            const oyCenter = Math.floor((h - pref.size.h) / 2);
            usedPrefab = stampPrefab(ctx, pref, fx + oxCenter, fy + oyCenter) || trySlipStamp(ctx, pref, fx + oxCenter, fy + oyCenter, 2);
          }
        }
      }
      if (!usedPrefab) {
        if (strictNow) {
          try { if (ctx && typeof ctx.log === "function") ctx.log(`Strict prefabs: no house prefab fit ${w}x${h} at ${fx},${fy}. Skipping fallback.`, "error"); } catch (_) {}
          // Skip placing a building here
        } else {
          placeBuilding(fx, fy, w, h);
        }
      }
    }
  }

  // Additional residential fill pass: attempt to reach a target count by random-fit stamping with slip
  (function prefabResidentialFillPass() {
    try {
      const GD5 = getGameData(ctx);
      const PFB = (GD5 && GD5.prefabs) ? GD5.prefabs : null;
      if (!PFB || !Array.isArray(PFB.houses) || !PFB.houses.length) return;
      const targetBySize = bConf.residentialFillTarget;
      if (buildings.length >= targetBySize) return;
      let attempts = 0, successes = 0;
      while (buildings.length < targetBySize && attempts++ < 600) {
        // Random provisional rectangle within bounds
        const bw = Math.max(6, Math.min(12, 6 + Math.floor((ctx.rng || rng)() * 7)));
        const bh = Math.max(4, Math.min(10, 4 + Math.floor((ctx.rng || rng)() * 7)));
        const bx = Math.max(2, Math.min(W - bw - 3, 2 + Math.floor((ctx.rng || rng)() * (W - bw - 4))));
        const by = Math.max(2, Math.min(H - bh - 3, 2 + Math.floor((ctx.rng || rng)() * (H - bh - 4))));
        // Skip near plaza and enforce margin clear
        if (overlapsPlazaRect(bx, by, bw, bh, 1)) continue;
        if (!isAreaClearForBuilding(bx, by, bw, bh, 1)) continue;
        // Pick a prefab that fits
        const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= bw && p.size.h <= bh);
        if (!candidates.length) continue;
        const pref = pickPrefab(candidates, ctx.rng || rng);
        if (!pref || !pref.size) continue;
        const ox = Math.floor((bw - pref.size.w) / 2);
        const oy = Math.floor((bh - pref.size.h) / 2);
        const px = bx + ox, py = by + oy;
        if (stampPrefab(ctx, pref, px, py) || trySlipStamp(ctx, pref, px, py, 2)) {
          successes++;
        }
      }
      try { if (ctx && typeof ctx.log === "function") ctx.log(`Residential fill: added ${successes} houses (target ${targetBySize}).`, "notice"); } catch (_) {}
    } catch (_) {}
  })();

  // Doors and shops near plaza (compact): just mark doors and create shop entries
  function candidateDoors(b) {
    return [
      { x: b.x + ((b.w / 2) | 0), y: b.y, ox: 0, oy: -1 },                      // top
      { x: b.x + b.w - 1, y: b.y + ((b.h / 2) | 0), ox: +1, oy: 0 },            // right
      { x: b.x + ((b.w / 2) | 0), y: b.y + b.h - 1, ox: 0, oy: +1 },            // bottom
      { x: b.x, y: b.y + ((b.h / 2) | 0), ox: -1, oy: 0 },                      // left
    ];
  }
  function ensureDoor(b) {
    const cands = candidateDoors(b);
    const good = cands.filter(d => inBounds({ map: ctx.map }, d.x + d.ox, d.y + d.oy) && ctx.map[d.y + d.oy][d.x + d.ox] === ctx.TILES.FLOOR);
    const pick = (good.length ? good : cands)[(Math.floor(ctx.rng() * (good.length ? good.length : cands.length))) % (good.length ? good.length : cands.length)];
    if (inBounds(ctx, pick.x, pick.y)) ctx.map[pick.y][pick.x] = ctx.TILES.DOOR;
    return pick;
  }
  function getExistingDoor(b) {
    const cds = candidateDoors(b);
    for (const d of cds) {
      if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) return { x: d.x, y: d.y };
    }
    const dd = ensureDoor(b);
    return { x: dd.x, y: dd.y };
  }

  // Remove any buildings overlapping the Inn building
  (function cleanupInnOverlap() {
    try {
      const tb = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
      if (!tb) return;
      const toDel = [];
      for (const b of buildings) {
        if (b.x === tb.x && b.y === tb.y && b.w === tb.w && b.h === tb.h) continue;
        if (rectOverlap(b.x, b.y, b.w, b.h, tb.x, tb.y, tb.w, tb.h, 0)) toDel.push(b);
      }
      for (const b of toDel) removeBuildingAndProps(b);
    } catch (_) {}
  })();

  // Ensure minimum building count around plaza
  (function ensureMinimumBuildingsAroundPlaza() {
    try {
      const minBySize = bConf.minBuildingsNearPlaza;
      if (buildings.length >= minBySize) return;
      const px0 = ((plaza.x - (plazaW / 2)) | 0), px1 = ((plaza.x + (plazaW / 2)) | 0);
      const py0 = ((plaza.y - (plazaH / 2)) | 0), py1 = ((plaza.y + (plazaH / 2)) | 0);
      const quads = [
        { x0: 1, y0: 1, x1: Math.max(2, px0 - 2), y1: Math.max(2, py0 - 2) },
        { x0: Math.min(W - 3, px1 + 2), y0: 1, x1: W - 2, y1: Math.max(2, py0 - 2) },
        { x0: 1, y0: Math.min(H - 3, py1 + 2), x1: Math.max(2, px0 - 2), y1: H - 2 },
        { x0: Math.min(W - 3, px1 + 2), y0: Math.min(H - 3, py1 + 2), x1: W - 2, y1: H - 2 },
      ];
      let added = 0;
      function tryPlaceRect(q) {
        const bw = Math.max(6, Math.min(10, 6 + Math.floor(ctx.rng() * 5)));
        const bh = Math.max(4, Math.min(8, 4 + Math.floor(ctx.rng() * 5)));
        const spanX = Math.max(1, (q.x1 - q.x0 - bw));
        const spanY = Math.max(1, (q.y1 - q.y0 - bh));
        const bx = Math.max(q.x0 + 1, Math.min(q.x1 - bw, q.x0 + 1 + Math.floor(ctx.rng() * spanX)));
        const by = Math.max(q.y0 + 1, Math.min(q.y1 - bh, q.y0 + 1 + Math.floor(ctx.rng() * spanY)));
        if (bx >= q.x1 - 1 || by >= q.y1 - 1) return false;
        if (overlapsPlazaRect(bx, by, bw, bh, 1)) return false;
        if (!isAreaClearForBuilding(bx, by, bw, bh, 1)) return false;
        // Strict prefabs: attempt to stamp a house prefab; else carve fallback rectangle
        const GDq = getGameData(ctx);
        const PFB = (GDq && GDq.prefabs) ? GDq.prefabs : null;
        if (PFB && Array.isArray(PFB.houses) && PFB.houses.length) {
          const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= bw && p.size.h <= bh);
          if (candidates.length) {
            const pref = pickPrefab(candidates, ctx.rng || rng);
            if (pref && pref.size) {
              const ox = Math.floor((bw - pref.size.w) / 2);
              const oy = Math.floor((bh - pref.size.h) / 2);
              if (stampPrefab(ctx, pref, bx + ox, by + oy)) {
                added++;
                return true;
              }
            }
          }
        }
        if (!strictNow) {
          placeBuilding(bx, by, bw, bh);
          added++;
          return true;
        }
        try { if (ctx && typeof ctx.log === "function") ctx.log(`Strict prefabs: failed to place extra house prefab in quad (${q.x0},${q.y0})-(${q.x1},${q.y1}); skipping fallback.`, "error"); } catch (_) {}
        return false;
      }
      for (const q of quads) {
        if (buildings.length + added >= minBySize) break;
        for (let tries = 0; tries < 4 && buildings.length + added < minBySize; tries++) {
          if (!tryPlaceRect(q)) continue;
        }
      }
    } catch (_) {}
  })();

  // Enforce a visible open plaza by clearing any overlapping buildings and
  // forcing the entire carved plaza rectangle to FLOOR. This applies to towns
  // and castles alike so the player always sees a central square.
  (function enforcePlazaOpenCore() {
    try {
      const px0 = ((plaza.x - (plazaW / 2)) | 0);
      const px1 = ((plaza.x + (plazaW / 2)) | 0);
      const py0 = ((plaza.y - (plazaH / 2)) | 0);
      const py1 = ((plaza.y + (plazaH / 2)) | 0);
      const rx0 = Math.max(1, px0);
      const ry0 = Math.max(1, py0);
      const rx1 = Math.min(W - 2, px1);
      const ry1 = Math.min(H - 2, py1);

      // Remove any buildings overlapping the full plaza rectangle
      const overl = findBuildingsOverlappingRect(rx0, ry0, rx1 - rx0 + 1, ry1 - ry0 + 1, 0);
      if (overl && overl.length) {
        for (let i = 0; i < overl.length; i++) {
          removeBuildingAndProps(overl[i]);
        }
      }

      // Force tiles in the plaza rectangle back to FLOOR to guarantee an open square
      for (let yy = ry0; yy <= ry1; yy++) {
        for (let xx = rx0; xx <= rx1; xx++) {
          if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
          ctx.map[yy][xx] = ctx.TILES.FLOOR;
        }
      }
    } catch (_) {}
  })();

  // Ensure there are always some plaza props (benches/lamps/etc.) even if
  // no plaza prefab was stamped or it failed to fit.
  (function ensurePlazaProps() {
    try {
      const pr = ctx.townPlazaRect;
      if (!pr || !Array.isArray(ctx.townProps)) return;
      const px0 = pr.x0, px1 = pr.x1, py0 = pr.y0, py1 = pr.y1;

      let count = 0;
      for (let i = 0; i < ctx.townProps.length; i++) {
        const p = ctx.townProps[i];
        if (!p) continue;
        if (p.x >= px0 && p.x <= px1 && p.y >= py0 && p.y <= py1) count++;
      }
      // If there are already a few props, assume a prefab handled it.
      if (count >= 3) return;

      // Simple fallback layout: a well in the center, benches and lamps around.
      const cx = ctx.townPlaza.x;
      const cy = ctx.townPlaza.y;

      // Center well
      addProp(cx, cy, "well");

      // Benches on cardinal directions if floor
      addProp(cx - 2, cy, "bench");
      addProp(cx + 2, cy, "bench");
      addProp(cx, cy - 2, "bench");
      addProp(cx, cy + 2, "bench");

      // Lamps at diagonals
      addProp(cx - 3, cy - 3, "lamp");
      addProp(cx + 3, cy - 3, "lamp");
      addProp(cx - 3, cy + 3, "lamp");
      addProp(cx + 3, cy + 3, "lamp");
    } catch (_) {}
  })();

  // Place shop prefabs near plaza with conflict resolution
  (function placeShopPrefabsStrict() {
    try {
      const GD6 = getGameData(ctx);
      const PFB = (GD6 && GD6.prefabs) ? GD6.prefabs : null;
      if (!PFB || !Array.isArray(PFB.shops) || !PFB.shops.length) return;
      const pr = ctx.townPlazaRect;
      if (!pr) return;
      const px0 = pr.x0, px1 = pr.x1, py0 = pr.y0, py1 = pr.y1;
      const sideCenterX = ((px0 + px1) / 2) | 0;
      const sideCenterY = ((py0 + py1) / 2) | 0;
      function stampWithResolution(pref, bx, by) {
        if (stampPrefab(ctx, pref, bx, by)) return true;
        // Try slip first
        if (trySlipStamp(ctx, pref, bx, by, 2)) return true;
        // If still blocked, remove an overlapping building and try once more,
        // but never remove the tavern/inn building.
        const overlaps = findBuildingsOverlappingRect(bx, by, pref.size.w, pref.size.h, 0);
        let toRemove = overlaps;
        try {
          if (ctx.tavern && ctx.tavern.building) {
            const tb = ctx.tavern.building;
            toRemove = overlaps.filter(b => !(b.x === tb.x && b.y === tb.y && b.w === tb.w && b.h === tb.h));
          }
        } catch (_) {}
        if (toRemove.length) {
          removeBuildingAndProps(toRemove[0]);
          if (stampPrefab(ctx, pref, bx, by)) return true;
          if (trySlipStamp(ctx, pref, bx, by, 2)) return true;
        }
        return false;
      }
      // Choose a few unique shop types based on town size
      const sizeKey = ctx.townSize || "big";
      let limit = sizeKey === "city" ? 6 : (sizeKey === "small" ? 3 : 4);
      const usedTypes = new Set();
      let sideIdx = 0;
      const sides = ["west", "east", "north", "south"];
      let attempts = 0;
      while (limit > 0 && attempts++ < 20) {
        // pick a prefab with a new type
        const candidates = PFB.shops.filter(p => {
          const t = (p.shop && p.shop.type) ? String(p.shop.type) : null;
          return !t || !usedTypes.has(t.toLowerCase());
        });
        if (!candidates.length) break;
        const pref = pickPrefab(candidates, ctx.rng || Math.random);
        if (!pref || !pref.size) break;
        const tKey = (pref.shop && pref.shop.type) ? String(pref.shop.type).toLowerCase() : `shop_${attempts}`;
        // compute anchor by side
        const side = sides[sideIdx % sides.length]; sideIdx++;
        let bx = 1, by = 1;
        if (side === "west") {
          bx = Math.max(1, px0 - 3 - pref.size.w);
          by = Math.max(1, Math.min((H - pref.size.h - 2), sideCenterY - ((pref.size.h / 2) | 0)));
        } else if (side === "east") {
          bx = Math.min(W - pref.size.w - 2, px1 + 3);
          by = Math.max(1, Math.min((H - pref.size.h - 2), sideCenterY - ((pref.size.h / 2) | 0)));
        } else if (side === "north") {
          bx = Math.max(1, Math.min(W - pref.size.w - 2, sideCenterX - ((pref.size.w / 2) | 0)));
          by = Math.max(1, py0 - 3 - pref.size.h);
        } else {
          bx = Math.max(1, Math.min(W - pref.size.w - 2, sideCenterX - ((pref.size.w / 2) | 0)));
          by = Math.min(H - pref.size.h - 2, py1 + 3);
        }
        if (stampWithResolution(pref, bx, by)) {
          usedTypes.add(tKey);
          limit--;
        } else {
          try { if (ctx && typeof ctx.log === "function") ctx.log(`Strict prefabs: failed to stamp shop '${(pref.name ? pref.name : ((pref.shop && pref.shop.type) ? pref.shop.type : "shop"))}' at ${bx},${by}.`, "error"); } catch (_) {}

        }
      }
    } catch (_) {}
  })();

  // After shops and houses, remove any buildings touching the central plaza footprint
  (function cleanupBuildingsTouchingPlaza() {
    try {
      const pr = ctx.townPlazaRect;
      if (!pr) return;
      const pw = pr.x1 - pr.x0 + 1;
      const ph = pr.y1 - pr.y0 + 1;
      const toDel = [];
      for (const b of buildings) {
        // Never delete the tavern/inn building even if it touches the plaza
        const isTavern = (ctx.tavern && ctx.tavern.building)
          ? (b.x === ctx.tavern.building.x && b.y === ctx.tavern.building.y && b.w === ctx.tavern.building.w && b.h === ctx.tavern.building.h)
          : false;
        if (isTavern) continue;
        if (rectOverlap(b.x, b.y, b.w, b.h, pr.x0, pr.y0, pw, ph, 0)) toDel.push(b);
      }
      for (const b of toDel) removeBuildingAndProps(b);
    } catch (_) {}
  })();

  // Ensure each town has a dedicated guard barracks building (small, near gate/plaza if possible).
  (function ensureGuardBarracks() {
    try {
      const GDg = getGameData(ctx);
      const PFB = (GDg && GDg.prefabs) ? GDg.prefabs : null;
      if (!PFB || !Array.isArray(PFB.houses) || !PFB.houses.length) return;

      // If a guard barracks already exists (by prefabId/tag), do nothing.
      const existing = buildings.find(b => {
        const id = (b && b.prefabId) ? String(b.prefabId).toLowerCase() : "";
        return id.includes("guard_barracks");
      });
      if (existing) return;

      // Candidate prefabs: houses tagged/identified as guard barracks.
      const candidates = PFB.houses.filter(p => {
        if (!p) return false;
        const id = String(p.id || "").toLowerCase();
        const tags = Array.isArray(p.tags) ? p.tags.map(t => String(t).toLowerCase()) : [];
        return id.includes("guard_barracks") || tags.includes("guard_barracks") || tags.includes("barracks");
      });
      if (!candidates.length) return;

      const pref = pickPrefab(candidates, ctx.rng || rng);
      if (!pref || !pref.size) return;
      const bw = pref.size.w | 0;
      const bh = pref.size.h | 0;

      let best = null;
      let bestScore = Infinity;
      for (let by = 2; by <= H - bh - 2; by++) {
        for (let bx = 2; bx <= W - bw - 2; bx++) {
          // Avoid plaza footprint with a one-tile buffer.
          if (overlapsPlazaRect(bx, by, bw, bh, 1)) continue;
          // Require a clear floor margin so barracks doesn't merge into other buildings.
          if (!isAreaClearForBuilding(bx, by, bw, bh, 1)) continue;

          const cxB = bx + ((bw / 2) | 0);
          const cyB = by + ((bh / 2) | 0);
          const dGate = Math.abs(cxB - gate.x) + Math.abs(cyB - gate.y);
          const dPlaza = Math.abs(cxB - plaza.x) + Math.abs(cyB - plaza.y);
          // Prefer closer to gate, then plaza.
          const score = dGate * 1.2 + dPlaza * 0.8;
          if (score < bestScore) {
            bestScore = score;
            best = { x: bx, y: by };
          }
        }
      }
      if (!best) return;

      // Stamp the barracks; Prefabs.stampPrefab will add a building rect with prefabId recorded.
      const res = Prefabs.stampPrefab(ctx, pref, best.x, best.y, buildings);
      if (!res || !res.ok) return;
    } catch (_) {}
  })();

  // Ensure props container exists before any early prop placement (e.g., shop signs)
  ctx.townProps = Array.isArray(ctx.townProps) ? ctx.townProps : [];
  ctx.shops = [];
  // Integrate prefab-declared shops: resolve schedules, add signs, and mark buildings as used.
  (function integratePrefabShops() {
    try {
      
      function scheduleFromPrefab(ps) {
        const s = ps && ps.scheduleOverride ? ps.scheduleOverride : null;
        if (s && s.alwaysOpen) return { openMin: 0, closeMin: 0, alwaysOpen: true };
        if (s && typeof s.open === "string" && typeof s.close === "string") {
          const o = parseHHMM(s.open);
          const c = parseHHMM(s.close);
          if (o != null && c != null) return { openMin: o, closeMin: c, alwaysOpen: false };
        }
        // Default hours when prefab provided no schedule
        return { openMin: ((8|0)*60), closeMin: ((18|0)*60), alwaysOpen: false };
      }

      for (const ps of prefabShops) {
        if (!ps || !ps.building) continue;
        // Add shop entry using schedule only from prefab metadata
        const sched = scheduleFromPrefab(ps);
        const name = ps.name || ps.type || "Shop";
        // Compute an inside tile near the door
        const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        let inside = null;
        for (const dxy of inward) {
          const ix = ps.door.x + dxy.dx, iy = ps.door.y + dxy.dy;
          const insideB = (ix > ps.building.x && ix < ps.building.x + ps.building.w - 1 && iy > ps.building.y && iy < ps.building.y + ps.building.h - 1);
          if (insideB && ctx.map[iy][ix] === ctx.TILES.FLOOR) { inside = { x: ix, y: iy }; break; }
        }
        if (!inside) {
          const cx = Math.max(ps.building.x + 1, Math.min(ps.building.x + ps.building.w - 2, Math.floor(ps.building.x + ps.building.w / 2)));
          const cy = Math.max(ps.building.y + 1, Math.min(ps.building.y + ps.building.h - 2, Math.floor(ps.building.y + ps.building.h / 2)));
          inside = { x: cx, y: cy };
        }

        // Force Inn to be always open regardless of prefab schedule
        const isInn = String(ps.type || "").toLowerCase() === "inn";
        const openMinFinal = isInn ? 0 : sched.openMin;
        const closeMinFinal = isInn ? 0 : sched.closeMin;
        const alwaysOpenFinal = isInn ? true : !!sched.alwaysOpen;

        ctx.shops.push({
          x: ps.door.x,
          y: ps.door.y,
          type: ps.type || "shop",
          name,
          openMin: openMinFinal,
          closeMin: closeMinFinal,
          alwaysOpen: alwaysOpenFinal,
          signWanted: (ps && Object.prototype.hasOwnProperty.call(ps, "signWanted")) ? !!ps.signWanted : true,
          building: { x: ps.building.x, y: ps.building.y, w: ps.building.w, h: ps.building.h, door: { x: ps.door.x, y: ps.door.y } },
          inside
        });

        try { addShopSignInside(ps.building, { x: ps.door.x, y: ps.door.y }, name); } catch (_) {}
      }
    } catch (_) {}
  })();

  // Data-first shop selection: use GameData.shops when available
  
  function minutesOfDay(ctx, h, m = 0) {
    try {
      if (ctx && ctx.ShopService && typeof ctx.ShopService.minutesOfDay === "function") {
        return ctx.ShopService.minutesOfDay(h, m, 24 * 60);
      }
    } catch (_) {}
    return ((h | 0) * 60 + (m | 0)) % (24 * 60);
  }
  function scheduleFromData(row) {
    if (!row) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
    if (row.alwaysOpen) return { openMin: 0, closeMin: 0, alwaysOpen: true };
    const o = parseHHMM(row.open);
    const c = parseHHMM(row.close);
    if (o == null || c == null) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
    return { openMin: o, closeMin: c, alwaysOpen: false };
  }

  // Shop definitions: disable data-assigned shops only when strict prefabs are available
  const GD9 = getGameData(ctx);
  let shopDefs = strictNow
    ? []
    : ((GD9 && Array.isArray(GD9.shops)) ? GD9.shops.slice(0) : [
        { type: "inn", name: "Inn", alwaysOpen: true },
        { type: "blacksmith", name: "Blacksmith", open: "08:00", close: "17:00" },
        { type: "apothecary", name: "Apothecary", open: "09:00", close: "18:00" },
        { type: "armorer", name: "Armorer", open: "08:00", close: "17:00" },
        { type: "trader", name: "Trader", open: "08:00", close: "18:00" },
      ]);
  try {
    const idxInn = shopDefs.findIndex(d => String(d.type || "").toLowerCase() === "inn" || /inn/i.test(String(d.name || "")));
    if (idxInn > 0) {
      const innDef = shopDefs.splice(idxInn, 1)[0];
      shopDefs.unshift(innDef);
    }
  } catch (_) {}

  // Score buildings by distance to plaza and assign shops to closest buildings
  const scored = buildings.map(b => ({ b, d: Math.abs((b.x + ((b.w / 2))) - plaza.x) + Math.abs((b.y + ((b.h / 2))) - plaza.y) }));
  scored.sort((a, b) => a.d - b.d);
  // Track largest building by area for assigning the inn
  

  // Vary number of shops by town size
  function shopLimitBySize(sizeKey) {
    if (sizeKey === "small") return 3;
    if (sizeKey === "city") return 8;
    return 5; // big
  }
  const limit = Math.min(scored.length, shopLimitBySize(townSize));

  // Deterministic sampling helpers for shop presence
  function chanceFor(def, sizeKey) {
    try {
      const c = def && def.chanceBySize ? def.chanceBySize : null;
      if (c && typeof c[sizeKey] === "number") {
        const v = c[sizeKey];
        return (v < 0 ? 0 : (v > 1 ? 1 : v));
      }
    } catch (_) {}
    // Defaults if not specified in data
    if (sizeKey === "city") return 0.75;
    if (sizeKey === "big") return 0.60;
    return 0.50; // small
  }
  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }

  // Build shop selection: Inn always included, others sampled by chanceBySize (dedup by type)
  let innDef = null;
  const candidateDefs = [];
  for (let i = 0; i < shopDefs.length; i++) {
    const d = shopDefs[i];
    const isInn = String(d.type || "").toLowerCase() === "inn" || /inn/i.test(String(d.name || ""));
    if (d.required === true || isInn) { innDef = d; continue; }
    candidateDefs.push(d);
  }
  // Sample presence for non-inn shops
  let sampled = [];
  for (const d of candidateDefs) {
    const ch = chanceFor(d, townSize);
    if (rng() < ch) sampled.push(d);
  }
  // Shuffle and cap, but avoid duplicate types within a single town
  shuffleInPlace(sampled);
  const restCap = Math.max(0, limit - (innDef ? 1 : 0));
  const finalDefs = [];
  const usedTypes = new Set();
  if (innDef) {
    finalDefs.push(innDef);
    usedTypes.add(String(innDef.type || innDef.name || "").toLowerCase());
  }
  // Fill with sampled unique types
  for (let i = 0; i < sampled.length && finalDefs.length < ((innDef ? 1 : 0) + restCap); i++) {
    const d = sampled[i];
    const tKey = String(d.type || d.name || "").toLowerCase();
    if (usedTypes.has(tKey)) continue;
    finalDefs.push(d);
    usedTypes.add(tKey);
  }
  // If we still have capacity, pull additional unique types from the full candidate list
  if (finalDefs.length < ((innDef ? 1 : 0) + restCap)) {
    for (const d of candidateDefs) {
      const tKey = String(d.type || d.name || "").toLowerCase();
      if (usedTypes.has(tKey)) continue;
      finalDefs.push(d);
      usedTypes.add(tKey);
      if (finalDefs.length >= ((innDef ? 1 : 0) + restCap)) break;
    }
  }

  // Avoid assigning multiple shops to the same building
  const usedBuildings = new Set();

  // Assign selected shops to nearest buildings
  const finalCount = Math.min(finalDefs.length, scored.length);
  for (let i = 0; i < finalCount; i++) {
    const def = finalDefs[i];
    let b = scored[i].b;

    // Prefer the enlarged tavern building for the Inn if available; else nearest to plaza
    if (String(def.type || "").toLowerCase() === "inn") {
      if (ctx.tavern && ctx.tavern.building) {
        b = ctx.tavern.building;
      } else {
        // Pick the closest unused building
        let candidate = null;
        for (const s of scored) {
          const key = `${s.b.x},${s.b.y}`;
          if (!usedBuildings.has(key)) { candidate = s.b; break; }
        }
        b = candidate || scored[0].b;
      }
    }

    // If chosen building is already used, pick the next nearest unused
    if (usedBuildings.has(`${b.x},${b.y}`)) {
      const alt = scored.find(s => !usedBuildings.has(`${s.b.x},${s.b.y}`));
      if (alt) b = alt.b;
    }

    // Extra guard: non-inn shops should never occupy the tavern building
    if (String(def.type || "").toLowerCase() !== "inn" && ctx.tavern && ctx.tavern.building) {
      const tb = ctx.tavern.building;
      const isTavernBld = (b.x === tb.x && b.y === tb.y && b.w === tb.w && b.h === tb.h);
      if (isTavernBld) {
        const alt = scored.find(s => {
          const key = `${s.b.x},${s.b.y}`;
          const isTavern = (s.b.x === tb.x && s.b.y === tb.y && s.b.w === tb.w && s.b.h === tb.h);
          return !usedBuildings.has(key) && !isTavern;
        });
        if (alt) b = alt.b;
      }
    }

    usedBuildings.add(`${b.x},${b.y}`);

    // For Inn: prefer using existing double doors on the side facing the plaza if present
    let door = null;
    if (String(def.type || "").toLowerCase() === "inn") {
      // check for any door on the inn building perimeter and pick one closest to plaza
      const cds = candidateDoors(b);
      let best = null, bestD2 = Infinity;
      for (const d of cds) {
        if (inBounds(ctx, d.x, d.y) && ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
          const dd = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
          if (dd < bestD2) { bestD2 = dd; best = { x: d.x, y: d.y }; }
        }
      }
      door = best || ensureDoor(b);
    } else {
      door = ensureDoor(b);
    }
    const sched = scheduleFromData(def);
    const name = def.name || def.type || "Shop";

    // inside near door
    const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
    let inside = null;
    for (const dxy of inward) {
      const ix = door.x + dxy.dx, iy = door.y + dxy.dy;
      const insideB = (ix > b.x && ix < b.x + b.w - 1 && iy > b.y && iy < b.y + b.h - 1);
      if (insideB && ctx.map[iy][ix] === ctx.TILES.FLOOR) { inside = { x: ix, y: iy }; break; }
    }
    if (!inside) {
      const cx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, Math.floor(b.x + b.w / 2)));
      const cy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, Math.floor(b.y + b.h / 2)));
      inside = { x: cx, y: cy };
    }

    ctx.shops.push({
      x: door.x,
      y: door.y,
      type: def.type || "shop",
      name,
      openMin: sched.openMin,
      closeMin: sched.closeMin,
      alwaysOpen: !!sched.alwaysOpen,
      building: { x: b.x, y: b.y, w: b.w, h: b.h, door: { x: door.x, y: door.y } },
      inside
    });
    // Ensure a sign near the shop door with the correct shop name (e.g., Inn), prefer placing it outside the building
    try { addShopSignInside(b, { x: door.x, y: door.y }, name); } catch (_) {}
  }

  // Guarantee an Inn shop exists: if none integrated from prefabs/data, create a fallback from the tavern building
  try {
    const hasInn = Array.isArray(ctx.shops) && ctx.shops.some(s => (String(s.type || "").toLowerCase() === "inn") || (String(s.name || "").toLowerCase().includes("inn")));
    if (!hasInn && ctx.tavern && ctx.tavern.building) {
      const b = ctx.tavern.building;
      // Prefer existing door on perimeter; otherwise ensure one
      let doorX = (ctx.tavern.door && typeof ctx.tavern.door.x === "number") ? ctx.tavern.door.x : null;
      let doorY = (ctx.tavern.door && typeof ctx.tavern.door.y === "number") ? ctx.tavern.door.y : null;
      if (doorX == null || doorY == null) {
        const dd = ensureDoor(b);
        doorX = dd.x; doorY = dd.y;
      }
      // Compute an inside tile near the door
      const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      let inside = null;
      for (let i = 0; i < inward.length; i++) {
        const ix = doorX + inward[i].dx, iy = doorY + inward[i].dy;
        const insideB = (ix > b.x && ix < b.x + b.w - 1 && iy > b.y && iy < b.y + b.h - 1);
        if (insideB && ctx.map[iy][ix] === ctx.TILES.FLOOR) { inside = { x: ix, y: iy }; break; }
      }
      if (!inside) {
        const cx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, Math.floor(b.x + b.w / 2)));
        const cy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, Math.floor(b.y + b.h / 2)));
        inside = { x: cx, y: cy };
      }
      ctx.shops.push({
        x: doorX,
        y: doorY,
        type: "inn",
        name: "Inn",
        openMin: 0,
        closeMin: 0,
        alwaysOpen: true,
        building: { x: b.x, y: b.y, w: b.w, h: b.h, door: { x: doorX, y: doorY } },
        inside
      });
      try { addShopSignInside(b, { x: doorX, y: doorY }, "Inn"); } catch (_) {}
    }
  } catch (_) {}

  // Safety: deduplicate Inn entries if any logic created more than one
  try {
    if (Array.isArray(ctx.shops)) {
      const out = [], seenInn = false;
      for (let i = 0; i < ctx.shops.length; i++) {
        const s = ctx.shops[i];
        const isInn = (String(s.type || "").toLowerCase() === "inn") || (String(s.name || "").toLowerCase().includes("inn"));
        if (isInn) {
          if (!seenInn) {
            out.push(s);
            seenInn = true;
          } else {
            // drop duplicate inn
            continue;
          }
        } else {
          out.push(s);
        }
      }
      ctx.shops = out;
    }
    // Ensure ctx.tavern points to the single Inn building if present
    if (ctx.shops && ctx.shops.length) {
      const innShop = ctx.shops.find(s => (String(s.type || "").toLowerCase() === "inn") || (String(s.name || "").toLowerCase().includes("inn")));
      if (innShop && innShop.building && innShop.building.x != null) {
        (function assignInnTavern() {
          try {
            const doorX = (innShop.building && innShop.building.door && typeof innShop.building.door.x === "number") ? innShop.building.door.x : innShop.x;
            const doorY = (innShop.building && innShop.building.door && typeof innShop.building.door.y === "number") ? innShop.building.door.y : innShop.y;
            ctx.tavern = {
              building: { x: innShop.building.x, y: innShop.building.y, w: innShop.building.w, h: innShop.building.h },
              door: { x: doorX, y: doorY }
            };
          } catch (_) {
            ctx.tavern = { building: { x: innShop.building.x, y: innShop.building.y, w: innShop.building.w, h: innShop.building.h }, door: { x: innShop.x, y: innShop.y } };
          }
        })();
        ctx.inn = ctx.tavern;
      }
    }
  } catch (_) {}

  // Dedupe shop signs: respect per-shop signWanted flag; keep only one sign (nearest to door) outside the building.
  dedupeShopSigns(ctx);

  // Dedupe welcome sign globally: keep only the one closest to the gate and ensure one exists.
  dedupeWelcomeSign(ctx);

  // Cleanup dangling props from removed buildings: ensure interior-only props are only inside valid buildings
  cleanupDanglingProps(ctx, buildings);

  // Town buildings metadata
  ctx.townBuildings = buildings.map(b => ({
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    door: getExistingDoor(b),
    prefabId: b.prefabId,
    prefabCategory: b.prefabCategory
  }));

  // Compute outdoor ground mask (true for outdoor FLOOR tiles; false for building interiors)
  buildOutdoorMask(ctx, buildings, W, H);

  // Build roads after buildings: one main road from gate to plaza, then spurs from every building door to the main road.
  buildRoadsAndPublish(ctx);

  // Open-air caravan stall near the plaza when a caravan is parked at this town.
  (function placeCaravanStallIfCaravanPresent() {
    try {
      const world = ctx.world;
      if (!world || !Array.isArray(world.caravans) || !world.caravans.length) return;

      // Determine this town's world coordinates.
      let townWX = null, townWY = null;
      try {
        if (info && typeof info.x === "number" && typeof info.y === "number") {
          townWX = info.x | 0;
          townWY = info.y | 0;
        } else if (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number") {
          townWX = ctx.worldReturnPos.x | 0;
          townWY = ctx.worldReturnPos.y | 0;
        }
      } catch (_) {}
      if (townWX == null || townWY == null) return;

      const caravans = world.caravans;
      const parked = caravans.find(function (cv) {
        return cv && cv.atTown && (cv.x | 0) === townWX && (cv.y | 0) === townWY;
      });
      if (!parked) return;

      const GDp = getGameData(ctx);
      const PFB = (GDp && GDp.prefabs) ? GDp.prefabs : null;
      const caravanPrefabs = (PFB && Array.isArray(PFB.caravans)) ? PFB.caravans : null;
      if (!caravanPrefabs || !caravanPrefabs.length) return;

      // Use the first caravan prefab for now.
      const pref = caravanPrefabs[0];
      if (!pref || !pref.size || !Array.isArray(pref.tiles)) return;
      const pw = pref.size.w | 0;
      const ph = pref.size.h | 0;
      if (pw <= 0 || ph <= 0) return;

      // Need plaza rect to anchor around.
      const pr = ctx.townPlazaRect;
      if (!pr || typeof pr.x0 !== "number" || typeof pr.y0 !== "number" || typeof pr.x1 !== "number" || typeof pr.y1 !== "number") return;
      const px0 = pr.x0, px1 = pr.x1, py0 = pr.y0, py1 = pr.y1;
      const plazaCX = ctx.townPlaza ? ctx.townPlaza.x : (((px0 + px1) / 2) | 0);
      const plazaCY = ctx.townPlaza ? ctx.townPlaza.y : (((py0 + py1) / 2) | 0);

      // Helper: check if prefab could fit at (x0,y0) based on tiles and gate position.
      function canPlaceAt(x0, y0) {
        if (x0 <= 0 || y0 <= 0 || x0 + pw - 1 >= W - 1 || y0 + ph - 1 >= H - 1) return false;
        const gate = ctx.townExitAt || null;
        const gx = gate && typeof gate.x === "number" ? gate.x : null;
        const gy = gate && typeof gate.y === "number" ? gate.y : null;
        for (let yy = 0; yy < ph; yy++) {
          const wy = y0 + yy;
          for (let xx = 0; xx < pw; xx++) {
            const wx = x0 + xx;
            const t = ctx.map[wy][wx];
            if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.ROAD) return false;
            if (gx != null && gy != null && wx === gx && wy === gy) return false;
          }
        }
        return true;
      }

      // Candidate top-left anchors just outside each side of plaza.
      const anchors = [];
      // Below plaza
      anchors.push({
        x: Math.max(1, Math.min(W - pw - 2, (plazaCX - ((pw / 2) | 0)))),
        y: Math.min(H - ph - 2, py1 + 2)
      });
      // Above plaza
      anchors.push({
        x: Math.max(1, Math.min(W - pw - 2, (plazaCX - ((pw / 2) | 0)))),
        y: Math.max(1, py0 - ph - 2)
      });
      // Left of plaza
      anchors.push({
        x: Math.max(1, px0 - pw - 2),
        y: Math.max(1, Math.min(H - ph - 2, (plazaCY - ((ph / 2) | 0))))
      });
      // Right of plaza
      anchors.push({
        x: Math.min(W - pw - 2, px1 + 2),
        y: Math.max(1, Math.min(H - ph - 2, (plazaCY - ((ph / 2) | 0))))
      });

      let rect = null;
      // First pass: try preferred anchors around the plaza.
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (!canPlaceAt(a.x, a.y)) continue;
        const res = Prefabs.stampPrefab(ctx, pref, a.x, a.y, null);
        if (res && res.ok && res.rect) {
          rect = res.rect;
          break;
        }
      }

      // Fallback: search the town for any suitable floor/road rectangle if anchors are blocked.
      if (!rect) {
        const candidates = [];
        const gate = ctx.townExitAt || null;
        const gx = gate && typeof gate.x === "number" ? gate.x : null;
        const gy = gate && typeof gate.y === "number" ? gate.y : null;

        for (let y0 = 1; y0 <= H - ph - 2; y0++) {
          for (let x0 = 1; x0 <= W - pw - 2; x0++) {
            if (!canPlaceAt(x0, y0)) continue;
            // Avoid placing stall directly on top of the gate even if canPlaceAt allowed it
            if (gx != null && gy != null &&
                gx >= x0 && gx <= x0 + pw - 1 &&
                gy >= y0 && gy <= y0 + ph - 1) {
              continue;
            }
            const cx = x0 + ((pw / 2) | 0);
            const cy = y0 + ((ph / 2) | 0);
            const score = Math.abs(cx - plazaCX) + Math.abs(cy - plazaCY);
            candidates.push({ x: x0, y: y0, score });
          }
        }

        if (candidates.length) {
          candidates.sort(function (a, b) {
            if (a.score !== b.score) return a.score - b.score;
            if (a.y !== b.y) return a.y - b.y;
            return a.x - b.x;
          });
          const best = candidates[0];
          const res = Prefabs.stampPrefab(ctx, pref, best.x, best.y, null);
          if (res && res.ok && res.rect) rect = res.rect;
        }
      }

      if (!rect) return;

      // Upgrade any sign inside the caravan prefab area to say "Caravan" and ensure only one remains.
      try {
        if (Array.isArray(ctx.townProps) && ctx.townProps.length) {
          const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w - 1, y1 = rect.y + rect.h - 1;
          const signIdx = [];
          for (let i = 0; i < ctx.townProps.length; i++) {
            const p = ctx.townProps[i];
            if (!p) continue;
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && String(p.type || "").toLowerCase() === "sign") {
              signIdx.push(i);
            }
          }
          if (signIdx.length) {
            const keepIdx = signIdx[0];
            const keep = ctx.townProps[keepIdx];
            if (keep) keep.name = "Caravan";
            if (signIdx.length > 1) {
              const removeSet = new Set(signIdx.slice(1));
              ctx.townProps = ctx.townProps.filter(function (p, idx) {
                return !removeSet.has(idx);
              });
            }
          }
        }
      } catch (_) {}
      // Create a caravan shop at a reasonable tile inside the prefab.
      // Prefer a stall prop tile inside the rect; otherwise center of rect.
      let stallX = null, stallY = null;
      try {
        if (Array.isArray(ctx.townProps) && ctx.townProps.length) {
          const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w - 1, y1 = rect.y + rect.h - 1;
          for (let i = 0; i < ctx.townProps.length; i++) {
            const p = ctx.townProps[i];
            if (!p) continue;
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && String(p.type || "").toLowerCase() === "stall") {
              stallX = p.x;
              stallY = p.y;
              break;
            }
          }
        }
      } catch (_) {}
      const sx = (stallX != null ? stallX : (rect.x + ((rect.w / 2) | 0)));
      const sy = (stallY != null ? stallY : (rect.y + ((rect.h / 2) | 0)));

      // Shop entry: open-air caravan shop, always open while you are in town.
      const shop = {
        x: sx,
        y: sy,
        type: "caravan",
        name: "Travelling Caravan",
        openMin: 0,
        closeMin: 0,
        alwaysOpen: true,
        signWanted: false,
        building: null,
        inside: { x: sx, y: sy }
      };
      ctx.shops.push(shop);
    } catch (_) {}
  })();

  function addProp(x, y, type, name) {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    if (ctx.map[y][x] !== ctx.TILES.FLOOR && ctx.map[y][x] !== ctx.TILES.ROAD) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
    ctx.townProps.push({ x, y, type, name });
    return true;
  }
  function addSignNear(x, y, text) {
    const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (const d of dirs) {
      const sx = x + d.dx, sy = y + d.dy;
      if (sx <= 0 || sy <= 0 || sx >= W - 1 || sy >= H - 1) continue;
      if (ctx.map[sy][sx] !== ctx.TILES.FLOOR && ctx.map[sy][sx] !== ctx.TILES.ROAD) continue;
      if (ctx.townProps.some(p => p.x === sx && p.y === sy)) continue;
      addProp(sx, sy, "sign", text);
      return true;
    }
    return false;
  }
  // Prefer placing shop signs inside the building near the door.
// Legacy addShopSign helper removed; use addShopSignInside directly.

  // Place one shop sign inside the building, near the door if possible.
  function addShopSignInside(b, door, text) {
    function isInside(bld, x, y) {
      return x > bld.x && x < bld.x + bld.w - 1 && y > bld.y && y < bld.y + bld.h - 1;
    }
    // Candidate inside tiles: directly inward from the door, then a small interior search
    const candidates = [];
    const inward = [{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:0},{dx:-1,dy:0}];
    for (let i = 0; i < inward.length; i++) {
      const ix = door.x + inward[i].dx, iy = door.y + inward[i].dy;
      if (isInside(b, ix, iy)) candidates.push({ x: ix, y: iy });
    }
    // Interior search within radius 3 from the door but only inside the building
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ix = door.x + dx, iy = door.y + dy;
          if (!isInside(b, ix, iy)) continue;
          candidates.push({ x: ix, y: iy });
        }
      }
    }
    // Fallback: building center if nothing else works
    candidates.push({
      x: Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0)))),
      y: Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0))))
    });

    let best = null, bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c.x <= 0 || c.y <= 0 || c.x >= W - 1 || c.y >= H - 1) continue;
      if (!isInside(b, c.x, c.y)) continue;
      const t = ctx.map[c.y][c.x];
      if (t !== ctx.TILES.FLOOR) continue;
      if (ctx.player && ctx.player.x === c.x && ctx.player.y === c.y) continue;
      if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === c.x && n.y === c.y)) continue;
      if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === c.x && p.y === c.y)) continue;
      const d = Math.abs(c.x - door.x) + Math.abs(c.y - door.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      addProp(best.x, best.y, "sign", text);
      return true;
    }
    return false;
  }
  // Welcome sign: ensure only one near the gate (dedupe within a small radius), then add single canonical sign
  try {
    if (Array.isArray(ctx.townProps)) {
      const R = 3;
      for (let i = ctx.townProps.length - 1; i >= 0; i--) {
        const p = ctx.townProps[i];
        if (p && p.type === "sign") {
          const d = Math.abs(p.x - gate.x) + Math.abs(p.y - gate.y);
          if (d <= R) ctx.townProps.splice(i, 1);
        }
      }
    }
  } catch (_) {}
  addSignNear(gate.x, gate.y, `Welcome to ${ctx.townName}`);

  // Windows along building walls (spaced, not near doors)
  (function placeWindowsOnAll() {
    function sidePoints(b) {
      // Exclude corners for aesthetics; only true perimeter segments
      return [
        Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y })),              // top
        Array.from({ length: Math.max(0, b.w - 2) }, (_, i) => ({ x: b.x + 1 + i, y: b.y + b.h - 1 })),    // bottom
        Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x, y: b.y + 1 + i })),              // left
        Array.from({ length: Math.max(0, b.h - 2) }, (_, i) => ({ x: b.x + b.w - 1, y: b.y + 1 + i })),    // right
      ];
    }
    function isAdjacent(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1; }
    function nearDoor(x, y) {
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      for (let i = 0; i < dirs.length; i++) {
        const nx = x + dirs[i].dx, ny = y + dirs[i].dy;
        if (!inBounds(ctx, nx, ny)) continue;
        if (ctx.map[ny][nx] === ctx.TILES.DOOR) return true;
      }
      return false;
    }
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      // Skip window auto-placement for prefab-stamped buildings; rely on prefab WINDOW tiles
      if (b && b.prefabId) continue;
      const tavB = (ctx.tavern && ctx.tavern.building) ? ctx.tavern.building : null;
      const isTavernBld = !!(tavB && b.x === tavB.x && b.y === tavB.y && b.w === tavB.w && b.h === tavB.h);
      let candidates = [];
      const sides = sidePoints(b);
      for (let si = 0; si < sides.length; si++) {
        const pts = sides[si];
        for (let pi = 0; pi < pts.length; pi++) {
          const p = pts[pi];
          if (!inBounds(ctx, p.x, p.y)) continue;
          const t = ctx.map[p.y][p.x];
          // Only convert solid wall tiles, avoid doors and already-placed windows
          if (t !== ctx.TILES.WALL) continue;
          if (nearDoor(p.x, p.y)) continue;
          candidates.push(p);
        }
      }
      if (!candidates.length) continue;
      // Limit by perimeter size so larger buildings get a few more windows but not too many
      let limit = Math.min(3, Math.max(1, Math.floor((b.w + b.h) / 12)));
      if (isTavernBld) {
        limit = Math.max(1, Math.floor(limit * 0.7));
      }
      limit = Math.max(1, Math.min(limit, 4));
      const placed = [];
      let attempts = 0;
      while (placed.length < limit && candidates.length > 0 && attempts++ < candidates.length * 2) {
        const idx = Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * candidates.length);
        const p = candidates[idx];
        // Keep spacing: avoid placing next to already placed windows
        let adjacent = false;
        for (let j = 0; j < placed.length; j++) {
          if (isAdjacent(p, placed[j])) { adjacent = true; break; }
        }
        if (adjacent) {
          candidates.splice(idx, 1);
          continue;
        }
        ctx.map[p.y][p.x] = ctx.TILES.WINDOW;
        placed.push(p);
        // Remove adjacent candidates to maintain spacing
        candidates = candidates.filter(c => !isAdjacent(c, p));
      }
    }
  })();

  // Plaza fixtures via prefab only (no fallbacks). For castle settlements, keep the central area
  // clear for the castle keep and skip plaza prefabs.
  placePlazaPrefabStrict(ctx, townKind, plaza, plazaW, plazaH, rng);

  // Repair pass: enforce solid building perimeters (convert any non-door/window on borders to WALL)
  repairBuildingPerimeters(ctx, buildings);

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
      const info = (ctx.world && Array.isArray(ctx.world.towns)) ? ctx.world.towns.find(t => t.x === wx && t.y === wy) : null;
      if (!info) return;

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
        for (const s of spots) { if (_isFreeTownFloor(ctx, s.x, s.y)) { pos = s; break; } }
        if (!pos) {
          // Fallback: any free floor near plaza
          for (let oy = -3; oy <= 3 && !pos; oy++) {
            for (let ox = -3; ox <= 3 && !pos; ox++) {
              const x = ctx.townPlaza.x + ox, y = ctx.townPlaza.y + oy;
              if (_isFreeTownFloor(ctx, x, y)) pos = { x, y };
            }
          }
        }
        if (!pos) pos = { x: ctx.townPlaza.x, y: ctx.townPlaza.y };
        ctx.npcs.push({ x: pos.x, y: pos.y, name: displayName, kind: "cat", lines: ["Meow.", "Purr."], pet: true });
      }

      if (info.jekkuHome) {
        spawnCatOnce("jekku", "Jekku");
      }
      if (info.pullaHome) {
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

  let placed = 0, placedGuards = 0, tries = 0;
  while (placed < roamTarget && tries++ < 800) {
    const onRoad = ctx.rng() < 0.4;
    let x, y;
    if (onRoad) {
      if (ctx.rng() < 0.5) { y = gate.y; x = Math.max(2, Math.min(W - 3, Math.floor(ctx.rng() * (W - 4)) + 2)); }
      else { x = plaza.x; y = Math.max(2, Math.min(H - 3, Math.floor(ctx.rng() * (H - 4)) + 2)); }
    } else {
      const ox = Math.floor(ctx.rng() * 21) - 10;
      const oy = Math.floor(ctx.rng() * 17) - 8;
      x = Math.max(1, Math.min(W - 2, plaza.x + ox));
      y = Math.max(1, Math.min(H - 2, plaza.y + oy));
    }
    if (ctx.map[y][x] !== ctx.TILES.FLOOR && ctx.map[y][x] !== ctx.TILES.DOOR && ctx.map[y][x] !== ctx.TILES.ROAD) continue;
    if (x === ctx.player.x && y === ctx.player.y) continue;
    if (_manhattan(ctx, ctx.player.x, ctx.player.y, x, y) <= 1) continue;
    if (ctx.npcs.some(n => n.x === x && n.y === y)) continue;
    if (ctx.townProps.some(p => p.x === x && p.y === y)) continue;

    // Prefer to turn road/near-gate roamers into guards, up to guardTarget
    const nearGate = _manhattan(ctx, x, y, gate.x, gate.y) <= 6;
    const canBeGuard = placedGuards < guardTarget && (onRoad || nearGate || ctx.rng() < 0.25);

    // Assign a home immediately to avoid "no-home" diagnostics for roamers/guards
    let homeRef = null;
    try {
      const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
      if (tbs.length) {
        let b = null;
        if (canBeGuard && guardBarracks) {
          b = guardBarracks;
        } else {
          b = tbs[Math.floor(rng() * tbs.length)];
        }
        if (b) {
          const hx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0))));
          const hy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0))));
          const door = (b && b.door && typeof b.door.x === "number" && typeof b.door.y === "number") ? { x: b.door.x, y: b.door.y } : null;
          homeRef = { building: b, x: hx, y: hy, door };
        }
      }
    } catch (_) {}

    const likesInn = rng() < 0.45;
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

  // Visibility reset for town
  // Start unseen; player FOV will reveal tiles and mark memory.
  // This prevents props from showing unless the player has actually seen them.
  ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.enemies = [];
  ctx.corpses = [];
  ctx.decals = [];

  // Spawn a greeter near the gate and greet the player (single NPC greeting)
  try {
    if (typeof spawnGateGreeters === "function") {
      spawnGateGreeters(ctx, 1);
      // Find nearest greeter we just placed and greet
      const greeters = Array.isArray(ctx.npcs) ? ctx.npcs.filter(n => Array.isArray(n.lines) && n.lines.length && /welcome/i.test(n.lines[0])) : [];
      if (greeters.length) {
        // Pick the closest to the player
        let g = greeters[0], gd = _manhattan(ctx, ctx.player.x, ctx.player.y, g.x, g.y);
        for (const n of greeters) {
          const d = _manhattan(ctx, ctx.player.x, ctx.player.y, n.x, n.y);
          if (d < gd) { g = n; gd = d; }
        }
        const line = g.lines[0] || `Welcome to ${ctx.townName || "our town"}.`;
        ctx.log(`${g.name || "Greeter"}: ${line}`, "notice");
      }
    }
  } catch (_) {}

  // Enforce a single NPC near the gate to avoid congestion
  try { enforceGateNPCLimit(ctx, 1, 2); } catch (_) {}

  // Finish
  try { ctx.inn = ctx.tavern; } catch (_) {}
  if (ctx.updateUI) ctx.updateUI();
  // Draw is handled by orchestrator after generation; avoid redundant frame
  return true;
}

// Shop helpers moved to ShopService; local duplicates removed.

import { parseHHMM } from "../services/time_service.js";
import * as Prefabs from "./prefabs.js";
import * as Roads from "./roads.js";
import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper and export for ESM
export { generate, ensureSpawnClear, spawnGateGreeters, interactProps };
attachGlobal("Town", { generate, ensureSpawnClear, spawnGateGreeters, interactProps });

    