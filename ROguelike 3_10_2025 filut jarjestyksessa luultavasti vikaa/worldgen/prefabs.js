// worldgen/prefabs.js
// Prefab helpers extracted from town_gen.js, adapted to work with ctx.map directly.
// Data-driven: prefers prefabs from GameData.prefabs (houses/inns/shops/plazas) loaded via data/worldgen registries.
// Exports:
//  - prefabsAvailable()
//  - pickPrefab(list, rng)
//  - trySlipStamp(ctx, prefab, bx, by, maxSlip, buildings)
//  - stampPrefab(ctx, prefab, bx, by, buildings)
//  - stampPlazaPrefab(ctx, prefab, bx, by)
//
// Prefab schema (brief):
// {
//   id: "bakery_small",
//   category: "shop" | "house" | "inn" | "plaza",
//   size: { w: 7, h: 5 },
//   tiles: [ [ "WALL", "DOOR", "WINDOW", "FLOOR", "STAIRS", "BED", ... ], ... ],
//   doors?: [ { x: 3, y: 0, role?: "main" } ],
//   props?: [ { x, y, type, name?, vendor? } ],
//   shop?: { type: "Bakery", sign?: true, signText?: "Bakery", schedule?: { open?: "06:00", close?: "15:00", alwaysOpen?: false } },
//   upstairsOverlay?: { w, h, offset: { x, y } | { ox, oy }, tiles: [...], props?: [...] }
// }

function inBounds(ctx, x, y) {
  const H = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const W = H && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < W && y < H;
}

export function prefabsAvailable() {
  try {
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    if (!PFB || typeof PFB !== "object") return false;
    const hasHouses = Array.isArray(PFB.houses) && PFB.houses.length > 0;
    const hasInns = Array.isArray(PFB.inns) && PFB.inns.length > 0;
    const hasShops = Array.isArray(PFB.shops) && PFB.shops.length > 0;
    const hasPlazas = Array.isArray(PFB.plazas) && PFB.plazas.length > 0;
    return hasHouses || hasInns || hasShops || hasPlazas;
  } catch (_) { return false; }
}

export function pickPrefab(list, rng) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const r = (typeof rng === "function") ? rng() : Math.random();
  const idx = Math.floor(r * list.length) % list.length;
  return list[idx];
}

export function trySlipStamp(ctx, prefab, bx, by, maxSlip = 2, buildings) {
  const offsets = [];
  for (let d = 1; d <= maxSlip; d++) {
    offsets.push({ dx: d, dy: 0 }, { dx: -d, dy: 0 }, { dx: 0, dy: d }, { dx: 0, dy: -d });
    offsets.push({ dx: d, dy: d }, { dx: -d, dy: d }, { dx: d, dy: -d }, { dx: -d, dy: -d });
  }
  for (const o of offsets) {
    const x = bx + o.dx, y = by + o.dy;
    const res = stampPrefab(ctx, prefab, x, y, buildings);
    if (res && res.ok) return res;
  }
  return null;
}

export function stampPrefab(ctx, prefab, bx, by, buildings) {
  if (!prefab || !prefab.size || !Array.isArray(prefab.tiles)) return null;
  const H = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const W = H && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;

  const w = prefab.size.w | 0, h = prefab.size.h | 0;
  // Bounds and clear margin check
  const x0 = bx, y0 = by, x1 = bx + w - 1, y1 = by + h - 1;
  if (x0 <= 0 || y0 <= 0 || x1 >= W - 1 || y1 >= H - 1) return null;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) return null;
    }
  }

  // Ensure props container
  try { if (!Array.isArray(ctx.townProps)) ctx.townProps = []; } catch (_) {}

  // Vendor hint for embedded COUNTER props
  function vendorForCounter(prefab) {
    try {
      const cat = String(prefab.category || "").toLowerCase();
      if (cat === "inn") return "inn";
      if (cat === "shop") {
        const t = (prefab.shop && prefab.shop.type) ? String(prefab.shop.type) : null;
        return t || "shop";
      }
    } catch (_) {}
    return undefined;
  }

  // Recognized prop codes in tiles
  const PROPMAP = {
    BED: "bed",
    TABLE: "table",
    CHAIR: "chair",
    SHELF: "shelf",
    RUG: "rug",
    FIREPLACE: "fireplace",
    CHEST: "chest",
    CRATE: "crate",
    BARREL: "barrel",
    PLANT: "plant",
    COUNTER: "counter",
    STALL: "stall",
    LAMP: "lamp",
    WELL: "well",
    SIGN: "sign",
    QUEST_BOARD: "quest_board"
  };

  // Stamp tiles and embedded props
  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    if (!row || row.length !== w) return null;
    for (let xx = 0; xx < w; xx++) {
      const code = row[xx];
      const wx = x0 + xx, wy = y0 + yy;

      // Embedded prop code
      if (code && PROPMAP[code]) {
        // props sit on floor
        ctx.map[wy][wx] = ctx.TILES.FLOOR;
        if (!ctx.townProps.some(q => q && q.x === wx && q.y === wy)) {
          const type = PROPMAP[code];
          const vendor = (type === "counter") ? vendorForCounter(prefab) : undefined;
          ctx.townProps.push({ x: wx, y: wy, type, vendor });
        }
        continue;
      }

      // Normal tile mapping
      let t = ctx.TILES.FLOOR;
      if (code === "WALL") t = ctx.TILES.WALL;
      else if (code === "FLOOR") t = ctx.TILES.FLOOR;
      else if (code === "DOOR") t = ctx.TILES.DOOR;
      else if (code === "WINDOW") t = ctx.TILES.WINDOW;
      else if (code === "STAIRS") t = ctx.TILES.STAIRS;
      ctx.map[wy][wx] = t;
    }
  }

  // Ensure a solid perimeter: convert any non-door/window on the boundary to WALL.
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const isBorder = (yy === y0 || yy === y1 || xx === x0 || xx === x1);
      if (!isBorder) continue;
      const cur = ctx.map[yy][xx];
      if (cur !== ctx.TILES.DOOR && cur !== ctx.TILES.WINDOW) {
        ctx.map[yy][xx] = ctx.TILES.WALL;
      }
    }
  }

  // Explicitly stamp doors from prefab metadata (in case tiles[] omitted them)
  try {
    if (Array.isArray(prefab.doors)) {
      for (const d of prefab.doors) {
        if (d && typeof d.x === "number" && typeof d.y === "number") {
          const dx = x0 + (d.x | 0), dy = y0 + (d.y | 0);
          if (inBounds(ctx, dx, dy)) ctx.map[dy][dx] = ctx.TILES.DOOR;
        }
      }
    }
  } catch (_) {}

  // For inns, rely solely on prefab DOOR tiles; do not auto-carve doors.
  if (String(prefab.category || "").toLowerCase() !== "inn") {
    (function ensurePerimeterDoor() {
      let hasDoor = false;
      for (let xx = x0; xx <= x1 && !hasDoor; xx++) {
        if (inBounds(ctx, xx, y0) && ctx.map[y0][xx] === ctx.TILES.DOOR) { hasDoor = true; break; }
        if (inBounds(ctx, xx, y1) && ctx.map[y1][xx] === ctx.TILES.DOOR) { hasDoor = true; break; }
      }
      for (let yy = y0; yy <= y1 && !hasDoor; yy++) {
        if (inBounds(ctx, x0, yy) && ctx.map[yy][x0] === ctx.TILES.DOOR) { hasDoor = true; break; }
        if (inBounds(ctx, x1, yy) && ctx.map[yy][x1] === ctx.TILES.DOOR) { hasDoor = true; break; }
      }
      if (!hasDoor) {
        const cx = x0 + ((w / 2) | 0);
        const cy = y0 + h - 1;
        if (inBounds(ctx, cx, cy)) ctx.map[cy][cx] = ctx.TILES.DOOR;
      }
    })();
  }

  // Back-compat: consume explicit props array if present
  try {
    if (Array.isArray(prefab.props)) {
      for (const p of prefab.props) {
        const px = x0 + (p.x | 0), py = y0 + (p.y | 0);
        if (px > 0 && py > 0 && px < W - 1 && py < H - 1 && ctx.map[py][px] === ctx.TILES.FLOOR) {
          if (!ctx.townProps.some(q => q && q.x === px && q.y === py)) {
            ctx.townProps.push({ x: px, y: py, type: p.type || "prop", name: p.name || undefined, vendor: p.vendor || undefined });
          }
        }
      }
    }
  } catch (_) {}

  // Record building rect
  const rect = { x: x0, y: y0, w, h, prefabId: (prefab && prefab.id) ? String(prefab.id) : null, prefabCategory: String(prefab.category || "").toLowerCase() || null };
  if (Array.isArray(buildings)) buildings.push(rect);

  // Track prefab usage for diagnostics (per category)
  try {
    const cat = String(prefab.category || "").toLowerCase();
    const id = String(prefab.id || "");
    if (id) {
      ctx.townPrefabUsage = ctx.townPrefabUsage || { houses: [], shops: [], inns: [], plazas: [] };
      if (cat === "house") ctx.townPrefabUsage.houses.push(id);
      else if (cat === "shop") ctx.townPrefabUsage.shops.push(id);
      else if (cat === "inn") ctx.townPrefabUsage.inns.push(id);
      else if (cat === "plaza") ctx.townPrefabUsage.plazas.push(id);
    }
  } catch (_) {}

  // Inn: consume upstairsOverlay and record ground stairs if present in prefab tiles
  try {
    if (String(prefab.category || "").toLowerCase() === "inn") {
      // Record ground stairs inside inn building from prefab tiles
      const stairs = [];
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (inBounds(ctx, xx, yy) && ctx.map[yy][xx] === ctx.TILES.STAIRS) stairs.push({ x: xx, y: yy });
        }
      }
      if (stairs.length) {
        let pair = null;
        for (let i = 0; i < stairs.length && !pair; i++) {
          for (let j = i + 1; j < stairs.length && !pair; j++) {
            const a = stairs[i], b = stairs[j];
            if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) pair = [a, b];
          }
        }
        ctx.innStairsGround = pair || stairs.slice(0, 2);
      }
      // Upstairs overlay from prefab (if present)
      const ov = prefab.upstairsOverlay;
      if (ov && Array.isArray(ov.tiles)) {
        const offX = (ov.offset && (ov.offset.x != null ? ov.offset.x : ov.offset.ox)) | 0;
        const offY = (ov.offset && (ov.offset.y != null ? ov.offset.y : ov.offset.oy)) | 0;
        const wUp = (ov.w | 0) || (ov.tiles[0] ? ov.tiles[0].length : 0);
        const hUp = (ov.h | 0) || ov.tiles.length;
        const tilesUp = Array.from({ length: hUp }, () => Array(wUp).fill(ctx.TILES.FLOOR));
        const propsUp = [];
        for (let yy = 0; yy < hUp; yy++) {
          const row = ov.tiles[yy];
          if (!row) continue;
          for (let xx = 0; xx < Math.min(wUp, row.length); xx++) {
            const code = row[xx];
            // Embedded upstairs props
            if (code && (code in { BED:1, TABLE:1, CHAIR:1, SHELF:1, RUG:1, FIREPLACE:1, CHEST:1, CRATE:1, BARREL:1, PLANT:1, COUNTER:1, STALL:1, LAMP:1, WELL:1, SIGN:1 })) {
              const px = (x0 + offX) + xx;
              const py = (y0 + offY) + yy;
              const pm = {
                BED: "bed",
                TABLE: "table",
                CHAIR: "chair",
                SHELF: "shelf",
                RUG: "rug",
                FIREPLACE: "fireplace",
                CHEST: "chest",
                CRATE: "crate",
                BARREL: "barrel",
                PLANT: "plant",
                COUNTER: "counter",
                STALL: "stall",
                LAMP: "lamp",
                WELL: "well",
                SIGN: "sign",
                QUEST_BOARD: "quest_board",
              };
              propsUp.push({ x: px, y: py, type: pm[code] });
              tilesUp[yy][xx] = ctx.TILES.FLOOR;
              continue;
            }
            let t = ctx.TILES.FLOOR;
            if (code === "WALL") t = ctx.TILES.WALL;
            else if (code === "FLOOR") t = ctx.TILES.FLOOR;
            else if (code === "DOOR") t = ctx.TILES.DOOR;
            else if (code === "WINDOW") t = ctx.TILES.WINDOW;
            else if (code === "STAIRS") t = ctx.TILES.STAIRS;
            tilesUp[yy][xx] = t;
          }
        }
        // Back-compat: explicit upstairs props list
        try {
          if (Array.isArray(ov.props)) {
            for (const p of ov.props) {
              const px = (p.x | 0), py = (p.y | 0);
              propsUp.push({ x: (x0 + offX) + px, y: (y0 + offY) + py, type: p.type || "prop", name: p.name || undefined });
            }
          }
        } catch (_) {}
        ctx.innUpstairs = { offset: { x: x0 + offX, y: y0 + offY }, w: wUp, h: hUp, tiles: tilesUp, props: propsUp };
        ctx.innUpstairsActive = false;
      }
    }
  } catch (_) {}

  // Build optional shop meta for shop prefabs
  let shop = null;
  try {
    const cat = String(prefab.category || "").toLowerCase();
    const hasShopType = !!(prefab.shop && prefab.shop.type);
    if (cat === "shop" || hasShopType) {
      const shopType = hasShopType ? String(prefab.shop.type) : ((prefab.tags && prefab.tags.find(t => t !== "shop")) || "shop");
      const shopName = String(prefab.name || (prefab.shop && prefab.shop.signText) || (shopType.charAt(0).toUpperCase() + shopType.slice(1)));
      // Choose front door: prefer role=main else first
      let doorWorld = null;
      if (Array.isArray(prefab.doors) && prefab.doors.length) {
        let d0 = prefab.doors.find(d => String(d.role || "").toLowerCase() === "main") || prefab.doors[0];
        if (d0 && typeof d0.x === "number" && typeof d0.y === "number") {
          doorWorld = { x: x0 + (d0.x | 0), y: y0 + (d0.y | 0) };
        }
      }
      if (!doorWorld) {
        doorWorld = { x: x0 + ((w / 2) | 0), y: y0 + h - 1 };
      }
      let scheduleOverride = null;
      try {
        const s = prefab.shop && prefab.shop.schedule;
        if (s && (s.open || s.close || s.alwaysOpen != null)) {
          scheduleOverride = { open: s.open || null, close: s.close || null, alwaysOpen: !!s.alwaysOpen };
        }
      } catch (_) {}
      let signWanted = true;
      try {
        if (prefab.shop && Object.prototype.hasOwnProperty.call(prefab.shop, "sign")) {
          signWanted = !!prefab.shop.sign;
        }
      } catch (_) {}
      shop = { type: shopType, name: shopName, door: doorWorld, scheduleOverride, signWanted };
    }
  } catch (_) {}

  return { ok: true, rect, shop };
}

export function stampPlazaPrefab(ctx, prefab, bx, by) {
  if (!prefab || !prefab.size || !Array.isArray(prefab.tiles)) return false;
  const H = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const W = H && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;

  const w = prefab.size.w | 0, h = prefab.size.h | 0;
  const x0 = bx, y0 = by, x1 = bx + w - 1, y1 = by + h - 1;
  if (x0 <= 0 || y0 <= 0 || x1 >= W - 1 || y1 >= H - 1) return false;

  // Validate row shape first: ensure every row exists and matches width
  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    if (!row || row.length !== w) return false;
  }

  // Ensure target area is currently walkable (plaza/road floor)
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) return false;
    }
  }

  // Stage: collect tile changes and props to add
  const PROPMAP = {
    BED: "bed", TABLE: "table", CHAIR: "chair", SHELF: "shelf", RUG: "rug",
    FIREPLACE: "fireplace", CHEST: "chest", CRATE: "crate", BARREL: "barrel",
    PLANT: "plant", COUNTER: "counter", STALL: "stall", LAMP: "lamp", WELL: "well", BENCH: "bench", SIGN: "sign", QUEST_BOARD: "quest_board"
  };
  const tileChanges = [];
  const propsToAdd = [];

  for (let yy = 0; yy < h; yy++) {
    const row = prefab.tiles[yy];
    for (let xx = 0; xx < w; xx++) {
      const code = row[xx];
      const wx = x0 + xx, wy = y0 + yy;

      // For plaza prefabs, any tile code resolves to FLOOR (no walls/doors/windows in plazas)
      tileChanges.push({ x: wx, y: wy });

      // Embedded prop code: stage prop on floor. Vendor hint not applicable to plaza.
      if (code && PROPMAP[code]) {
        propsToAdd.push({ x: wx, y: wy, type: PROPMAP[code] });
      }
    }
  }

  // Commit staged changes only after full validation
  try { if (!Array.isArray(ctx.townProps)) ctx.townProps = []; } catch (_) {}

  for (let i = 0; i < tileChanges.length; i++) {
    const c = tileChanges[i];
    if (c.y > 0 && c.x > 0 && c.y < H - 1 && c.x < W - 1) {
      ctx.map[c.y][c.x] = ctx.TILES.FLOOR;
    }
  }
  for (let i = 0; i < propsToAdd.length; i++) {
    const p = propsToAdd[i];
    if (!ctx.townProps.some(q => q && q.x === p.x && q.y === p.y)) {
      ctx.townProps.push({ x: p.x, y: p.y, type: p.type });
    }
  }

  // Track plaza prefab usage for diagnostics
  try {
    const id = String(prefab.id || "");
    if (id) {
      ctx.townPrefabUsage = ctx.townPrefabUsage || { houses: [], shops: [], inns: [], plazas: [] };
      ctx.townPrefabUsage.plazas.push(id);
    }
  } catch (_) {}
  return true;
}