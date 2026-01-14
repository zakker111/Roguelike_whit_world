import { getGameData } from "../../utils/access.js";
import { parseHHMM } from "../../services/time_service.js";

/**
 * Compute minutes-of-day for shop schedules, delegating to ShopService when available.
 */
export function minutesOfDay(ctx, h, m = 0) {
  try {
    if (ctx && ctx.ShopService && typeof ctx.ShopService.minutesOfDay === "function") {
      return ctx.ShopService.minutesOfDay(h, m, 24 * 60);
    }
  } catch (_) {}
  return ((h | 0) * 60 + (m | 0)) % (24 * 60);
}

/**
 * Build a schedule object from a shop definition row (GameData.shops).
 * Mirrors the original scheduleFromData logic in town_gen.js.
 */
export function scheduleFromData(ctx, row) {
  if (!row) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
  if (row.alwaysOpen) return { openMin: 0, closeMin: 0, alwaysOpen: true };
  const o = parseHHMM(row.open);
  const c = parseHHMM(row.close);
  if (o == null || c == null) return { openMin: minutesOfDay(ctx, 8), closeMin: minutesOfDay(ctx, 18), alwaysOpen: false };
  return { openMin: o, closeMin: c, alwaysOpen: false };
}

/**
 * Load shop definitions from GameData (or use the legacy fallback list).
 * This is the data source for town shop selection when strict prefabs are not enforced.
 */
export function loadShopDefs(ctx, strictNow) {
  const GD9 = getGameData(ctx);
  // Always use data-first shops when available; fall back to legacy defaults when GameData.shops
  // is absent. The strictNow flag is reserved for layout/prefab behavior and should not suppress
  // generic shop definitions, or towns can end up with only an Inn.
  let shopDefs = (GD9 && Array.isArray(GD9.shops)) ? GD9.shops.slice(0) : [
    { type: "inn",        name: "Inn",        alwaysOpen: true },
    { type: "blacksmith", name: "Blacksmith", open: "08:00", close: "17:00" },
    { type: "apothecary", name: "Apothecary", open: "09:00", close: "18:00" },
    { type: "armorer",    name: "Armorer",    open: "08:00", close: "17:00" },
    { type: "trader",     name: "Trader",     open: "08:00", close: "18:00" },
  ];

  try {
    const idxInn = shopDefs.findIndex(d =>
      String(d.type || "").toLowerCase() === "inn" ||
      /inn/i.test(String(d.name || ""))
    );
    if (idxInn > 0) {
      const innDef = shopDefs.splice(idxInn, 1)[0];
      shopDefs.unshift(innDef);
    }
  } catch (_) {}

  return shopDefs;
}

/**
 * Vary number of shops by town size (small/big/city).
 * Directly moved from town_gen.js.
 */
export function shopLimitBySize(sizeKey) {
  if (sizeKey === "small") return 3;
  if (sizeKey === "city")  return 8;
  return 5; // big
}

/**
 * Compute presence chance for a shop definition given town size, using
 * def.chanceBySize when available, otherwise the legacy defaults.
 */
export function chanceFor(def, sizeKey) {
  try {
    const c = def && def.chanceBySize ? def.chanceBySize : null;
    if (c && typeof c[sizeKey] === "number") {
      const v = c[sizeKey];
      return (v < 0 ? 0 : (v > 1 ? 1 : v));
    }
  } catch (_) {}
  // Defaults if not specified in data
  if (sizeKey === "city") return 0.75;
  if (sizeKey === "big")  return 0.60;
  return 0.50; // small
}

/**
 * Fisher–Yates shuffle used for shop sampling. Uses rng() passed in from caller.
 */
export function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

/**
 * High-level shop assignment: from shopDefs + buildings to ctx.shops.
 * This captures the orchestration that lived in town_gen.js:
 * - scoring buildings by distance to plaza
 * - selecting which shop defs to use (including Inn)
 * - assigning shops to buildings with tavern protection
 * - ensuring an Inn exists and syncing ctx.tavern / ctx.inn
 */
export function assignShopsToBuildings(ctx, {
  shopDefs,
  buildings,
  plaza,
  townSize,
  rng,
  W,
  H,
  candidateDoors,
  ensureDoor,
  addShopSignInside,
}) {
  if (!Array.isArray(buildings) || !buildings.length) return;

  // Score buildings by distance to plaza and assign shops to closest buildings
  const scored = buildings.map(b => ({
    b,
    d: Math.abs((b.x + (b.w / 2)) - plaza.x) + Math.abs((b.y + (b.h / 2)) - plaza.y)
  }));
  scored.sort((a, b) => a.d - b.d);

  // Vary number of shops by town size
  const limit = Math.min(scored.length, shopLimitBySize(townSize));

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
  shuffleInPlace(sampled, rng);
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
      const cds = candidateDoors(b);
      let best = null, bestD2 = Infinity;
      for (const d of cds) {
        const x = d.x, y = d.y;
        if (y < 0 || y >= ctx.map.length) continue;
        if (x < 0 || x >= ctx.map[0].length) continue;
        if (ctx.map[y][x] === ctx.TILES.DOOR) {
          const dd = Math.abs(x - plaza.x) + Math.abs(y - plaza.y);
          if (dd < bestD2) { bestD2 = dd; best = { x, y }; }
        }
      }
      door = best || ensureDoor(b);
    } else {
      door = ensureDoor(b);
    }

    const sched = scheduleFromData(ctx, def);
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

    try { addShopSignInside(ctx, W, H, b, { x: door.x, y: door.y }, name); } catch (_) {}
  }

  // Guarantee an Inn shop exists: if none integrated from prefabs/data, create a fallback from the tavern building
  try {
    const hasInn = Array.isArray(ctx.shops) && ctx.shops.some(s =>
      (String(s.type || "").toLowerCase() === "inn") ||
      (String(s.name || "").toLowerCase().includes("inn"))
    );
    if (!hasInn && ctx.tavern && ctx.tavern.building) {
      const b = ctx.tavern.building;
      let doorX = (ctx.tavern.door && typeof ctx.tavern.door.x === "number") ? ctx.tavern.door.x : null;
      let doorY = (ctx.tavern.door && typeof ctx.tavern.door.y === "number") ? ctx.tavern.door.y : null;
      if (doorX == null || doorY == null) {
        const dd = ensureDoor(b);
        doorX = dd.x; doorY = dd.y;
      }

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
      try { addShopSignInside(ctx, W, H, b, { x: doorX, y: doorY }, "Inn"); } catch (_) {}
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
            continue;
          }
        } else {
          out.push(s);
        }
      }
      ctx.shops = out;
    }

    if (ctx.shops && ctx.shops.length) {
      const innShop = ctx.shops.find(s =>
        (String(s.type || "").toLowerCase() === "inn") ||
        (String(s.name || "").toLowerCase().includes("inn"))
      );
      if (innShop && innShop.building && innShop.building.x != null) {
        try {
          const doorX = (innShop.building && innShop.building.door && typeof innShop.building.door.x === "number") ? innShop.building.door.x : innShop.x;
          const doorY = (innShop.building && innShop.building.door && typeof innShop.building.door.y === "number") ? innShop.building.door.y : innShop.y;
          ctx.tavern = {
            building: { x: innShop.building.x, y: innShop.building.y, w: innShop.building.w, h: innShop.building.h },
            door: { x: doorX, y: doorY }
          };
        } catch (_) {
          ctx.tavern = {
            building: { x: innShop.building.x, y: innShop.building.y, w: innShop.building.w, h: innShop.building.h },
            door: { x: innShop.x, y: innShop.y }
          };
        }
        ctx.inn = ctx.tavern;
      }
    }
  } catch (_) {}
}