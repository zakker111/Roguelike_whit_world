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
import { buildBaseTown, buildPlaza, carveBuildingRect, placeCastleKeep, buildInnAndMarkTavern, isAreaClearForBuilding, findBuildingsOverlappingRect, layoutCandidateDoors, layoutEnsureDoor, layoutGetExistingDoor, placePlazaPrefabStrict } from "./town/layout_core.js";
import { buildOutdoorMask, repairBuildingPerimeters, placeWindowsOnAll } from "./town/windows.js";
import { addProp, addSignNear, addShopSignInside, dedupeShopSigns, dedupeWelcomeSign, cleanupDanglingProps } from "./town/signs.js";
import { spawnGateGreeters, enforceGateNPCLimit, populateTownNpcs } from "./town/npcs_bootstrap.js";
import { minutesOfDay, scheduleFromData, loadShopDefs, shopLimitBySize, chanceFor, shuffleInPlace, assignShopsToBuildings } from "./town/shops_core.js";
import { placeCaravanStallIfCaravanPresent } from "./town/caravan_stall.js";
import { placeShopPrefabsStrict } from "./town/prefab_shops.js";

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





/**
 * Build roads after buildings: one main road from gate to plaza, then spurs from every building door.
 * Thin wrapper around Roads.build for clarity.
 */
function buildRoadsAndPublish(ctx) {
  try {
    Roads.build(ctx);
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
  buildInnAndMarkTavern(
    ctx,
    buildings,
    W,
    H,
    gate,
    plaza,
    plazaW,
    plazaH,
    townSize,
    TOWNCFG,
    rng,
    (ctx2, pref, bx, by) => stampPrefab(ctx2, pref, bx, by),
    (x0, y0, w, h, margin) => findBuildingsOverlappingRect(buildings, x0, y0, w, h, margin),
    (b) => removeBuildingAndProps(b),
    (bx, by, bw, bh, margin) => overlapsPlazaRect(bx, by, bw, bh, margin),
    (bx, by, bw, bh) => placeBuilding(bx, by, bw, bh),
    (b) => candidateDoors(b),
    (ctx2, x, y) => inBounds(ctx2, x, y)
  );

  function pickPrefab(list, rng) {
    // Delegate to module implementation
    return Prefabs.pickPrefab(list, rng);
  }

  // --- Hollow rectangle fallback helpers ---
  const placeBuilding = (bx, by, bw, bh) => {
    // Delegate to layout_core primitive so building shell carving is centralized.
    carveBuildingRect(ctx, buildings, bx, by, bw, bh, W, H);
  };

  // For castle settlements, reserve a "keep" tower building with a luxurious interior.
  // The keep must never overwrite the central plaza: keep and plaza remain visually distinct.
  placeCastleKeep(ctx, buildings, W, H, gate, plaza, plazaW, plazaH, townKind, TOWNCFG, rng);

  const cfgB = (TOWNCFG && TOWNCFG.buildings) || {};
  const bConf = getTownBuildingConfig(TOWNCFG, townSize, townKind);
  const maxBuildings = bConf.maxBuildings;
  const blockW = bConf.blockW;
  const blockH = bConf.blockH;

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

  const harborMask = Array.isArray(ctx.townHarborMask) ? ctx.townHarborMask : null;

  for (let by = 2; by < H - (blockH + 4) && buildings.length < maxBuildings; by += Math.max(6, blockH + 2)) {
    for (let bx = 2; bx < W - (blockW + 4) && buildings.length < maxBuildings; bx += Math.max(8, blockW + 2)) {
      let clear = true;
      for (let yy = by; yy < by + (blockH + 1) && clear; yy++) {
        for (let xx = bx; xx < bx + (blockW + 1); xx++) {
          if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) { clear = false; break; }
        }
      }
      if (!clear) continue;
      // Skip harbor band for port towns so regular houses do not occupy dock/warehouse space.
      if (harborMask && ctx.townKind === "port") {
        let intersectsHarbor = false;
        for (let yy = by; yy < by + (blockH + 1) && !intersectsHarbor; yy++) {
          for (let xx = bx; xx < bx + (blockW + 1); xx++) {
            if (yy >= 0 && yy < H && xx >= 0 && xx < W && harborMask[yy][xx]) {
              intersectsHarbor = true;
              break;
            }
          }
        }
        if (intersectsHarbor) continue;
      }
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
      if (!isAreaClearForBuilding(ctx, W, H, fx, fy, w, h, 1)) continue;

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
      const harborMaskLocal = Array.isArray(ctx.townHarborMask) ? ctx.townHarborMask : null;
      let attempts = 0, successes = 0;
      while (buildings.length < targetBySize && attempts++ < 600) {
        // Random provisional rectangle within bounds
        const bw = Math.max(6, Math.min(12, 6 + Math.floor((ctx.rng || rng)() * 7)));
        const bh = Math.max(4, Math.min(10, 4 + Math.floor((ctx.rng || rng)() * 7)));
        const bx = Math.max(2, Math.min(W - bw - 3, 2 + Math.floor((ctx.rng || rng)() * (W - bw - 4))));
        const by = Math.max(2, Math.min(H - bh - 3, 2 + Math.floor((ctx.rng || rng)() * (H - bh - 4))));
        // Skip near plaza and enforce margin clear
        if (overlapsPlazaRect(bx, by, bw, bh, 1)) continue;
        if (!isAreaClearForBuilding(ctx, W, H, bx, by, bw, bh, 1)) continue;
        // Skip harbor band for port towns so residential fill does not occupy dock space.
        if (harborMaskLocal && ctx.townKind === "port") {
          let intersectsHarbor = false;
          for (let yy = by; yy < by + bh && !intersectsHarbor; yy++) {
            for (let xx = bx; xx < bx + bw; xx++) {
              if (yy >= 0 && yy < H && xx >= 0 && xx < W && harborMaskLocal[yy][xx]) {
                intersectsHarbor = true;
                break;
              }
            }
          }
          if (intersectsHarbor) continue;
        }
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

  // Doors and shops near plaza (compact): just mark doors and create shop entries.
  // Door placement helpers are now provided by layout_core to keep building geometry centralized.
  // Use function declarations (not const) so they are available earlier in generate(), including
  // when buildInnAndMarkTavern is invoked.
  function candidateDoors(b) {
    return layoutCandidateDoors(b);
  }
  function ensureDoor(b) {
    return layoutEnsureDoor(ctx, b);
  }
  function getExistingDoor(b) {
    return layoutGetExistingDoor(ctx, b);
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
        if (!isAreaClearForBuilding(ctx, W, H, bx, by, bw, bh, 1)) return false;
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
      addProp(ctx, W, H, cx, cy, "well");

      // Benches on cardinal directions if floor
      addProp(ctx, W, H, cx - 2, cy, "bench");
      addProp(ctx, W, H, cx + 2, cy, "bench");
      addProp(ctx, W, H, cx, cy - 2, "bench");
      addProp(ctx, W, H, cx, cy + 2, "bench");

      // Lamps at diagonals
      addProp(ctx, W, H, cx - 3, cy - 3, "lamp");
      addProp(ctx, W, H, cx + 3, cy - 3, "lamp");
      addProp(ctx, W, H, cx - 3, cy + 3, "lamp");
      addProp(ctx, W, H, cx + 3, cy + 3, "lamp");
    } catch (_) {}
  })();

  // Place shop prefabs near plaza with conflict resolution
  placeShopPrefabsStrict(ctx, buildings, ctx.townPlazaRect, W, H, rng, (b) => removeBuildingAndProps(b));

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
          if (!isAreaClearForBuilding(ctx, W, H, bx, by, bw, bh, 1)) continue;

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

        try { addShopSignInside(ctx, W, H, ps.building, { x: ps.door.x, y: ps.door.y }, name); } catch (_) {}
      }
    } catch (_) {}
  })();

  // Data-first shop selection: use GameData.shops when available (helpers in town/shops_core.js)
  let shopDefs = loadShopDefs(ctx, strictNow);

  // High-level shop assignment (moved to town/shops_core.js)
  assignShopsToBuildings(ctx, {
    shopDefs,
    buildings,
    plaza,
    townSize,
    rng,
    W,
    H,
    candidateDoors: (b) => candidateDoors(b),
    ensureDoor: (b) => ensureDoor(b),
    addShopSignInside: (ctx2, W2, H2, b2, door2, name2) => addShopSignInside(ctx2, W2, H2, b2, door2, name2),
  });

  // Dedupe shop signs: respect per-shop signWanted flag; keep only one sign (nearest to door) outside the building.
  dedupeShopSigns(ctx, W, H);

  // Dedupe welcome sign globally: keep only the one closest to the gate and ensure one exists.
  dedupeWelcomeSign(ctx, W, H);

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
  placeCaravanStallIfCaravanPresent(ctx, W, H, info);

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
  addSignNear(ctx, W, H, gate.x, gate.y, `Welcome to ${ctx.townName}`);

  // Windows along building walls (spaced, not near doors)
  placeWindowsOnAll(ctx, buildings);

  // Plaza fixtures via prefab only (no fallbacks). Castle settlements keep the central area
  // clear for the keep; plaza prefabs are skipped there.
  placePlazaPrefabStrict(
    ctx,
    buildings,
    townKind,
    plaza,
    plazaW,
    plazaH,
    rng,
    (b) => removeBuildingAndProps(b),
    (ctx2, pref, bx, by) => stampPlazaPrefab(ctx2, pref, bx, by),
    (ctx2, pref, bx, by, maxSlip) => trySlipStamp(ctx2, pref, bx, by, maxSlip),
    (list, rng2) => pickPrefab(list, rng2)
  );

  // Repair pass: enforce solid building perimeters (convert any non-door/window on borders to WALL)
  repairBuildingPerimeters(ctx, buildings);

  // NPCs via TownAI + special cats + roaming villagers/guards
  populateTownNpcs(ctx, W, H, gate, plaza, townSize, townKind, TOWNCFG, info, rng);

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

    