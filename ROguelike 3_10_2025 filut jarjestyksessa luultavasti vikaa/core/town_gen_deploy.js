/**
 * TownGenDeploy: stepwise town generation with visual refresh and logging.
 * Triggered when window.TOWN_GEN_DEPLOY is truthy or ctx.TOWN_GEN_DEPLOY === true.
 *
 * API (ESM + window.TownGenDeploy):
 *   run(ctx) -> Promise<boolean> (phases run sequentially with delays)
 */
import * as Prefabs from "../worldgen/prefabs.js";
import * as Roads from "../worldgen/roads.js";
import { parseHHMM } from "../services/time_service.js";
import { attachGlobal } from "../utils/global.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms | 0));
}
function refresh(ctx) {
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
      return;
    }
  } catch (_) {}
  try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
  try { if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV(); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
  try { if (typeof ctx.requestDraw === "function") ctx.requestDraw(); } catch (_) {}
}

function cfgTownSize(ctx, key) {
  const TOWNCFG = (typeof window !== "undefined" && window.GameData && window.GameData.town) || null;
  const d = (TOWNCFG && TOWNCFG.sizes && TOWNCFG.sizes[key]) || null;
  if (d) return { W: Math.min(ctx.MAP_COLS, d.W | 0), H: Math.min(ctx.MAP_ROWS, d.H | 0) };
  if (key === "small") return { W: Math.min(ctx.MAP_COLS, 60), H: Math.min(ctx.MAP_ROWS, 40) };
  if (key === "city")  return { W: Math.min(ctx.MAP_COLS, 120), H: Math.min(ctx.MAP_ROWS, 80) };
  return { W: Math.min(ctx.MAP_COLS, 90), H: Math.min(ctx.MAP_ROWS, 60) };
}
function cfgPlazaSize(ctx, key) {
  const TOWNCFG = (typeof window !== "undefined" && window.GameData && window.GameData.town) || null;
  const d = (TOWNCFG && TOWNCFG.plaza && TOWNCFG.plaza[key]) || null;
  if (d) return { w: d.w | 0, h: d.h | 0 };
  if (key === "small") return { w: 10, h: 8 };
  if (key === "city") return { w: 18, h: 14 };
  return { w: 14, h: 12 };
}
function candidateDoorsFor(b) {
  return [
    { x: b.x + ((b.w / 2) | 0), y: b.y, ox: 0, oy: -1 },
    { x: b.x + b.w - 1, y: b.y + ((b.h / 2) | 0), ox: +1, oy: 0 },
    { x: b.x + ((b.w / 2) | 0), y: b.y + b.h - 1, ox: 0, oy: +1 },
    { x: b.x, y: b.y + ((b.h / 2) | 0), ox: -1, oy: 0 },
  ];
}
function ensureDoor(ctx, b) {
  const cands = candidateDoorsFor(b);
  const good = cands.filter(d => (d.y + d.oy >= 0 && d.y + d.oy < ctx.map.length) && (d.x + d.ox >= 0 && d.x + d.ox < ctx.map[0].length) && ctx.map[d.y + d.oy][d.x + d.ox] === ctx.TILES.FLOOR);
  const pick = (good.length ? good : cands)[Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * (good.length ? good.length : cands.length)) % (good.length ? good.length : cands.length)];
  if (ctx.map[pick.y] && typeof ctx.map[pick.y][pick.x] !== "undefined") ctx.map[pick.y][pick.x] = ctx.TILES.DOOR;
  return pick;
}
function placeBuildingRect(ctx, buildings, bx, by, bw, bh) {
  for (let yy = by; yy < by + bh; yy++) {
    for (let xx = bx; xx < bx + bw; xx++) {
      if (yy <= 0 || xx <= 0 || yy >= ctx.map.length - 1 || xx >= ctx.map[0].length - 1) continue;
      const isBorder = (yy === by || yy === by + bh - 1 || xx === bx || xx === bx + bw - 1);
      ctx.map[yy][xx] = isBorder ? ctx.TILES.WALL : ctx.TILES.FLOOR;
    }
  }
  buildings.push({ x: bx, y: by, w: bw, h: bh });
}

function scheduleFromPrefab(ps) {
  const s = ps && ps.scheduleOverride ? ps.scheduleOverride : null;
  if (s && s.alwaysOpen) return { openMin: 0, closeMin: 0, alwaysOpen: true };
  if (s && typeof s.open === "string" && typeof s.close === "string") {
    const o = parseHHMM(s.open);
    const c = parseHHMM(s.close);
    if (o != null && c != null) return { openMin: o, closeMin: c, alwaysOpen: false };
  }
  return { openMin: (8 * 60), closeMin: (18 * 60), alwaysOpen: false };
}

function addShopSignInside(ctx, b, door, text) {
  const inward = [{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:0},{dx:-1,dy:0}];
  const candidates = [];
  for (let i = 0; i < inward.length; i++) {
    const ix = door.x + inward[i].dx, iy = door.y + inward[i].dy;
    if (ix > b.x && ix < b.x + b.w - 1 && iy > b.y && iy < b.y + b.h - 1) candidates.push({ x: ix, y: iy });
  }
  const cx = Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0))));
  const cy = Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0))));
  candidates.push({ x: cx, y: cy });
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (ctx.map[c.y][c.x] !== ctx.TILES.FLOOR) continue;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === c.x && p.y === c.y)) continue;
    ctx.townProps.push({ x: c.x, y: c.y, type: "sign", name: text });
    return true;
  }
  return false;
}

export async function run(ctx) {
  const delay = (typeof window !== "undefined" && typeof window.TOWN_GEN_DELAY === "number") ? (window.TOWN_GEN_DELAY | 0) : 3000;
  // Containers
  ctx.townProps = [];
  ctx.shops = [];
  ctx.townBuildings = [];
  ctx.townPrefabUsage = { houses: [], shops: [], inns: [], plazas: [] };
  // Clear any previous outdoor/road masks from a prior town to avoid overlay fallbacks painting brown early
  try {
    const hadRoads = !!ctx.townRoads;
    const hadMask = !!ctx.townOutdoorMask;
    ctx.townRoads = null;
    ctx.townOutdoorMask = null;
    if (ctx.log && (hadRoads || hadMask)) {
      ctx.log(`Deploy: cleared previous townRoads (${hadRoads ? "yes" : "no"}) and outdoor mask (${hadMask ? "yes" : "no"}) before generation.`, "notice");
    }
  } catch (_) {}

  // Town size from world registry
  let townSize = "big";
  try {
    if (ctx.world && Array.isArray(ctx.world.towns)) {
      const wx = (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") ? ctx.worldReturnPos.x : ctx.player.x;
      const wy = (ctx.worldReturnPos && typeof ctx.worldReturnPos.y === "number") ? ctx.worldReturnPos.y : ctx.player.y;
      const info = ctx.world.towns.find(t => t.x === wx && t.y === wy) || null;
      if (info && info.size) townSize = info.size;
    }
  } catch (_) {}

  const dims = cfgTownSize(ctx, townSize);
  const W = dims.W, H = dims.H;

  // Phase A: Map sizing, tiles, and gate/plaza anchors
  ctx.map = Array.from({ length: H }, () => Array(W).fill(ctx.TILES.FLOOR));
  for (let x = 0; x < W; x++) { ctx.map[0][x] = ctx.TILES.WALL; ctx.map[H - 1][x] = ctx.TILES.WALL; }
  for (let y = 0; y < H; y++) { ctx.map[y][0] = ctx.TILES.WALL; ctx.map[y][W - 1] = ctx.TILES.WALL; }

  const clampXY = (x, y) => ({ x: Math.max(1, Math.min(W - 2, x)), y: Math.max(1, Math.min(H - 2, y)) });
  const pxy = clampXY(ctx.player.x, ctx.player.y);
  let gate = null;
  const dir = (typeof ctx.enterFromDir === "string") ? ctx.enterFromDir : "";
  if (dir === "E") gate = { x: 1, y: pxy.y };
  else if (dir === "W") gate = { x: W - 2, y: pxy.y };
  else if (dir === "N") gate = { x: pxy.x, y: H - 2 };
  else if (dir === "S") gate = { x: pxy.x, y: 1 };
  if (!gate) {
    const targets = [{ x: 1, y: pxy.y }, { x: W - 2, y: pxy.y }, { x: pxy.x, y: 1 }, { x: pxy.x, y: H - 2 }];
    let best = targets[0], bd = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.x - pxy.x) + Math.abs(t.y - pxy.y);
      if (d < bd) { bd = d; best = t; }
    }
    gate = best;
  }
  if (gate.x === 1) ctx.map[gate.y][0] = ctx.TILES.DOOR;
  else if (gate.x === W - 2) ctx.map[gate.y][W - 1] = ctx.TILES.DOOR;
  else if (gate.y === 1) ctx.map[0][gate.x] = ctx.TILES.DOOR;
  else if (gate.y === H - 2) ctx.map[H - 1][gate.x] = ctx.TILES.DOOR;
  ctx.map[gate.y][gate.x] = ctx.TILES.FLOOR;
  ctx.player.x = gate.x; ctx.player.y = gate.y;
  ctx.townExitAt = { x: gate.x, y: gate.y };

  const plaza = { x: (W / 2) | 0, y: (H / 2) | 0 };
  const pd = cfgPlazaSize(ctx, townSize);
  const plazaW = pd.w, plazaH = pd.h;
  for (let yy = (plaza.y - (plazaH / 2)) | 0; yy <= (plaza.y + (plazaH / 2)) | 0; yy++) {
    for (let xx = (plaza.x - (plazaW / 2)) | 0; xx <= (plaza.x + (plazaW / 2)) | 0; xx++) {
      if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) continue;
      ctx.map[yy][xx] = ctx.TILES.FLOOR;
    }
  }
  ctx.townPlaza = { x: plaza.x, y: plaza.y };
  ctx.townPlazaRect = {
    x0: ((plaza.x - (plazaW / 2)) | 0),
    y0: ((plaza.y - (plazaH / 2)) | 0),
    x1: ((plaza.x + (plazaW / 2)) | 0),
    y1: ((plaza.y + (plazaH / 2)) | 0),
  };
  ctx.log && ctx.log("Phase A: map sized, gate and plaza anchors set.", "notice");
  refresh(ctx);

  // Phase B: Prefabs and the Inn (tavern)
  await sleep(delay);
  (function placeInnNearPlaza() {
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    let usedPrefabInn = false;
    if (PFB && Array.isArray(PFB.inns) && PFB.inns.length) {
      const innsSorted = PFB.inns.slice().sort((a, b) => (b.size.w * b.size.h) - (a.size.w * a.size.h));
      for (let k = 0; k < innsSorted.length && !usedPrefabInn; k++) {
        const pref = innsSorted[k];
        const candidates = [
          { x: Math.max(2, ((plaza.x + (plazaW / 2)) | 0) + 2), y: Math.max(2, (plaza.y - ((pref.size.h / 2) | 0)) | 0) },
          { x: Math.max(2, ((plaza.x - (plazaW / 2)) | 0) - 2 - pref.size.w), y: Math.max(2, (plaza.y - ((pref.size.h / 2) | 0)) | 0) },
          { x: Math.max(2, (plaza.x - ((pref.size.w / 2) | 0)) | 0), y: Math.max(2, ((plaza.y + (plazaH / 2)) | 0) + 2) },
          { x: Math.max(2, (plaza.x - ((pref.size.w / 2) | 0)) | 0), y: Math.max(2, ((plaza.y - (plazaH / 2)) | 0) - 2 - pref.size.h) },
        ];
        for (const c of candidates) {
          const ok = Prefabs.stampPrefab(ctx, pref, c.x, c.y, ctx.townBuildings);
          if (ok && ok.ok && ok.rect) {
            usedPrefabInn = true;
            let door = null;
            try { if (ok.shop && ok.shop.door) { door = ok.shop.door; } } catch (_) {}
            if (!door) {
              const cds = candidateDoorsFor(ok.rect);
              let best = null, bd = Infinity;
              for (const d of cds) {
                if (ctx.map[d.y][d.x] === ctx.TILES.DOOR) {
                  const dist = Math.abs(d.x - plaza.x) + Math.abs(d.y - plaza.y);
                  if (dist < bd) { bd = dist; best = { x: d.x, y: d.y }; }
                }
              }
              door = best || ensureDoor(ctx, ok.rect);
            }
            ctx.tavern = { building: { x: ok.rect.x, y: ok.rect.y, w: ok.rect.w, h: ok.rect.h }, door };
            ctx.inn = ctx.tavern;
            break;
          }
        }
      }
    }
    if (!usedPrefabInn) {
      const bw = Math.max(14, Math.floor(plazaW * 1.1));
      const bh = Math.max(10, Math.floor(plazaH * 1.0));
      const bx = Math.max(2, (plaza.x - ((bw / 2) | 0)) | 0);
      const by = Math.max(2, ((plaza.y + (plazaH / 2)) | 0) + 2);
      placeBuildingRect(ctx, ctx.townBuildings, bx, by, bw, bh);
      const rect = { x: bx, y: by, w: bw, h: bh };
      const door = ensureDoor(ctx, rect);
      ctx.tavern = { building: rect, door };
      ctx.inn = ctx.tavern;
    }
  })();
  ctx.log && ctx.log("Phase B: Inn placed and recorded (with upstairs overlay when available).", "notice");
  refresh(ctx);

  // Phase C: Initial housing blocks
  await sleep(delay);
  (function placeInitialHouses() {
    const TOWNCFG = (typeof window !== "undefined" && window.GameData && window.GameData.town) || null;
    const blockW = Math.max(8, (TOWNCFG && TOWNCFG.buildings && TOWNCFG.buildings.blockW) ? (TOWNCFG.buildings.blockW | 0) : 8);
    const blockH = Math.max(6, (TOWNCFG && TOWNCFG.buildings && TOWNCFG.buildings.blockH) ? (TOWNCFG.buildings.blockH | 0) : 6);
    const maxBuildings = Math.max(1, (TOWNCFG && TOWNCFG.buildings && TOWNCFG.buildings.max) ? (TOWNCFG.buildings.max | 0) : 18);
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    const strictPrefabs = !!(PFB && Array.isArray(PFB.houses) && PFB.houses.length);

    if (!strictPrefabs) { try { ctx.log && ctx.log("Prefabs not loaded yet; using rectangle fallback this visit.", "warn"); } catch (_) {} }

    function overlapsPlaza(bx, by, bw, bh, margin = 1) {
      const pr = ctx.townPlazaRect;
      const px0 = Math.max(1, pr.x0 - margin), py0 = Math.max(1, pr.y0 - margin);
      const px1 = Math.min(W - 2, pr.x1 + margin), py1 = Math.min(H - 2, pr.y1 + margin);
      const ax0 = bx, ay0 = by, ax1 = bx + bw - 1, ay1 = by + bh - 1;
      const sepX = (ax1 < px0) || (px1 < ax0);
      const sepY = (ay1 < py0) || (py1 < ay0);
      return !(sepX || sepY);
    }
    function areaClear(bx, by, bw, bh, margin = 1) {
      const x0 = Math.max(1, bx - margin);
      const y0 = Math.max(1, by - margin);
      const x1 = Math.min(W - 2, bx + bw - 1 + margin);
      const y1 = Math.min(H - 2, by + bh - 1 + margin);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) return false;
        }
      }
      return true;
    }
    for (let by = 2; by < H - (blockH + 4) && ctx.townBuildings.length < maxBuildings; by += Math.max(6, blockH + 2)) {
      for (let bx = 2; bx < W - (blockW + 4) && ctx.townBuildings.length < maxBuildings; bx += Math.max(8, blockW + 2)) {
        const w = Math.max(6, Math.min(blockW, 6 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * (blockW - 5))));
        const h = Math.max(4, Math.min(blockH, 4 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * (blockH - 3))));
        const fx = bx + 1 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * Math.max(1, blockW - w));
        const fy = by + 1 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * Math.max(1, blockH - h));
        if (overlapsPlaza(fx, fy, w, h, 1)) continue;
        if (!areaClear(fx, fy, w, h, 1)) continue;
        if (strictPrefabs) {
          const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= w && p.size.h <= h);
          if (candidates.length) {
            const pref = Prefabs.pickPrefab(candidates, ctx.rng || Math.random);
            const ox = Math.floor((w - pref.size.w) / 2);
            const oy = Math.floor((h - pref.size.h) / 2);
            if (!Prefabs.stampPrefab(ctx, pref, fx + ox, fy + oy, ctx.townBuildings)) {
              Prefabs.trySlipStamp(ctx, pref, fx + ox, fy + oy, 2, ctx.townBuildings);
            }
          }
        } else {
          placeBuildingRect(ctx, ctx.townBuildings, fx, fy, w, h);
        }
      }
    }
  })();
  ctx.log && ctx.log("Phase C: initial housing blocks placed.", "notice");
  refresh(ctx);

  // Residential fill
  await sleep(delay);
  (function residentialFill() {
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    if (!PFB || !Array.isArray(PFB.houses) || !PFB.houses.length) return;
    const targetBySize = (townSize === "small") ? 12 : (townSize === "city" ? 34 : 22);
    let successes = 0;
    let attempts = 0;
    while (ctx.townBuildings.length < targetBySize && attempts++ < 300) {
      const bw = Math.max(6, Math.min(12, 6 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * 7)));
      const bh = Math.max(4, Math.min(10, 4 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * 7)));
      const bx = Math.max(2, Math.min(W - bw - 3, 2 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * (W - bw - 4))));
      const by = Math.max(2, Math.min(H - bh - 3, 2 + Math.floor(((typeof ctx.rng === "function") ? ctx.rng() : Math.random()) * (H - bh - 4))));
      const pr = ctx.townPlazaRect;
      const overlapsPlaza = !(bx + bw - 1 < pr.x0 - 1 || pr.x1 + 1 < bx || by + bh - 1 < pr.y0 - 1 || pr.y1 + 1 < by);
      if (overlapsPlaza) continue;
      let clear = true;
      for (let yy = by - 1; yy <= by + bh; yy++) {
        for (let xx = bx - 1; xx <= bx + bw; xx++) {
          if (yy <= 0 || xx <= 0 || yy >= H - 1 || xx >= W - 1) { clear = false; break; }
          if (ctx.map[yy][xx] !== ctx.TILES.FLOOR) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (!clear) continue;
      const candidates = PFB.houses.filter(p => p && p.size && p.size.w <= bw && p.size.h <= bh);
      if (!candidates.length) continue;
      const pref = Prefabs.pickPrefab(candidates, ctx.rng || Math.random);
      const ox = Math.floor((bw - pref.size.w) / 2);
      const oy = Math.floor((bh - pref.size.h) / 2);
      const ok = Prefabs.stampPrefab(ctx, pref, bx + ox, by + oy, ctx.townBuildings) || Prefabs.trySlipStamp(ctx, pref, bx + ox, by + oy, 2, ctx.townBuildings);
      if (ok) successes++;
    }
    try { ctx.log && ctx.log(`Residential fill: added ${successes} houses (target ${targetBySize}).`, "notice"); } catch (_) {}
  })();
  refresh(ctx);

  // Phase E: Shops near plaza
  await sleep(delay);
  (function placeShops() {
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    if (!PFB || !Array.isArray(PFB.shops) || !PFB.shops.length) return;
    const pr = ctx.townPlazaRect;
    const px0 = pr.x0, px1 = pr.x1, py0 = pr.y0, py1 = pr.y1;
    const sideCenterX = ((px0 + px1) / 2) | 0;
    const sideCenterY = ((py0 + py1) / 2) | 0;
    const sides = ["west", "east", "north", "south"];
    let sideIdx = 0;

    function stampAndIntegrate(pref, bx, by) {
      const res = Prefabs.stampPrefab(ctx, pref, bx, by, ctx.townBuildings);
      if (!res || !res.ok || !res.rect) return false;
      const sched = scheduleFromPrefab(res.shop);
      const name = (res.shop && res.shop.name) || (pref.name || "Shop");
      const door = (res.shop && res.shop.door) ? res.shop.door : ensureDoor(ctx, res.rect);
      const inward = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      let inside = null;
      for (const dxy of inward) {
        const ix = door.x + dxy.dx, iy = door.y + dxy.dy;
        const insideB = (ix > res.rect.x && ix < res.rect.x + res.rect.w - 1 && iy > res.rect.y && iy < res.rect.y + res.rect.h - 1);
        if (insideB && ctx.map[iy][ix] === ctx.TILES.FLOOR) { inside = { x: ix, y: iy }; break; }
      }
      if (!inside) {
        const cx = Math.max(res.rect.x + 1, Math.min(res.rect.x + res.rect.w - 2, Math.floor(res.rect.x + res.rect.w / 2)));
        const cy = Math.max(res.rect.y + 1, Math.min(res.rect.y + res.rect.h - 2, Math.floor(res.rect.y + res.rect.h / 2)));
        inside = { x: cx, y: cy };
      }
      const isInn = String((res.shop && res.shop.type) || "").toLowerCase() === "inn";
      const openMinFinal = isInn ? 0 : sched.openMin;
      const closeMinFinal = isInn ? 0 : sched.closeMin;
      const alwaysOpenFinal = isInn ? true : !!sched.alwaysOpen;

      ctx.shops.push({
        x: door.x, y: door.y,
        type: (res.shop && res.shop.type) || "shop",
        name,
        openMin: openMinFinal,
        closeMin: closeMinFinal,
        alwaysOpen: alwaysOpenFinal,
        signWanted: (res.shop && Object.prototype.hasOwnProperty.call(res.shop, "signWanted")) ? !!res.shop.signWanted : true,
        building: { x: res.rect.x, y: res.rect.y, w: res.rect.w, h: res.rect.h, door: { x: door.x, y: door.y } },
        inside
      });
      try { addShopSignInside(ctx, res.rect, door, name); } catch (_) {}
      return true;
    }

    const usedTypes = new Set();
    let attempts = 0, placed = 0;
    while (attempts++ < 20) {
      const candidates = PFB.shops.filter(p => {
        const t = (p.shop && p.shop.type) ? String(p.shop.type) : null;
        const key = t ? t.toLowerCase() : null;
        return !key || !usedTypes.has(key);
      });
      if (!candidates.length) break;
      const pref = Prefabs.pickPrefab(candidates, ctx.rng || Math.random);
      if (!pref || !pref.size) break;
      const tKey = (pref.shop && pref.shop.type) ? String(pref.shop.type).toLowerCase() : `shop_${attempts}`;
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
      if (stampAndIntegrate(pref, bx, by)) {
        usedTypes.add(tKey);
        placed++;
      }
      if (placed >= (townSize === "city" ? 6 : (townSize === "small" ? 3 : 4))) break;
    }
  })();
  ctx.log && ctx.log("Phase E: shops placed near plaza with schedules and signage.", "notice");
  refresh(ctx);

  // Phase F: Outdoor mask and roads
  await sleep(delay);
  (function buildOutdoorMaskAndRoads() {
      const rows = H, cols = W;
      const mask = Array.from({ length: rows }, () => Array(cols).fill(false));
      function insideAnyBuilding(x, y) {
        for (let i = 0; i < ctx.townBuildings.length; i++) {
          const B = ctx.townBuildings[i];
          if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
        }
        return false;
      }
      for (let yy = 0; yy < rows; yy++) {
        for (let xx = 0; xx < cols; xx++) {
          const t = ctx.map[yy][xx];
          if (t === ctx.TILES.FLOOR && !insideAnyBuilding(xx, yy)) mask[yy][xx] = true;
        }
      }
      ctx.townOutdoorMask = mask;
      try { Roads.build(ctx); } catch (_) {}
      // Diagnostics: count typed ROAD tiles and roads mask coverage
      try {
        let typed = 0, masked = 0;
        for (let yy = 0; yy < rows; yy++) {
          for (let xx = 0; xx < cols; xx++) {
            if (ctx.map[yy][xx] === ctx.TILES.ROAD) typed++;
            if (ctx.townRoads && ctx.townRoads[yy] && ctx.townRoads[yy][xx]) masked++;
          }
        }
        ctx._roadsDiag = { typed, masked, rows, cols };
      } catch (_) {}
    })();
    try {
      const d = ctx._roadsDiag || {};
      ctx.log && ctx.log(`Phase F: outdoor mask computed and roads carved. typedRoads=${d.typed|0}, maskTrue=${d.masked|0}, size=${(d.cols||W)}x${(d.rows||H)}.`, "notice");
    } catch (_) {
      ctx.log && ctx.log("Phase F: outdoor mask computed and roads carved.", "notice");
    }
  refresh(ctx);

  // Phase G: Interior props and windows
  await sleep(delay);
  (function placeWindowsFallback() {
    function inB(x, y) { return y >= 0 && y < H && x >= 0 && x < W; }
    function nearDoor(x, y) {
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      for (let i = 0; i < dirs.length; i++) {
        const nx = x + dirs[i].dx, ny = y + dirs[i].dy;
        if (!inB(nx, ny)) continue;
        if (ctx.map[ny][nx] === ctx.TILES.DOOR) return true;
      }
      return false;
    }
    for (let i = 0; i < ctx.townBuildings.length; i++) {
      const b = ctx.townBuildings[i];
      if (b && b.prefabId) continue;
      const edges = [
        Array.from({ length: Math.max(0, b.w - 2) }, (_, j) => ({ x: b.x + 1 + j, y: b.y })),
        Array.from({ length: Math.max(0, b.w - 2) }, (_, j) => ({ x: b.x + 1 + j, y: b.y + b.h - 1 })),
        Array.from({ length: Math.max(0, b.h - 2) }, (_, j) => ({ x: b.x, y: b.y + 1 + j })),
        Array.from({ length: Math.max(0, b.h - 2) }, (_, j) => ({ x: b.x + b.w - 1, y: b.y + 1 + j })),
      ];
      let placed = 0;
      for (let s = 0; s < edges.length; s++) {
        for (let k = 0; k < edges[s].length; k++) {
          const p = edges[s][k];
          if (!inB(p.x, p.y)) continue;
          const t = ctx.map[p.y][p.x];
          if (t !== ctx.TILES.WALL) continue;
          if (nearDoor(p.x, p.y)) continue;
          ctx.map[p.y][p.x] = ctx.TILES.WINDOW;
          placed++;
          if (placed >= 3) break;
        }
        if (placed >= 3) break;
      }
    }
  })();
  ctx.log && ctx.log("Phase G: interior props respected from prefabs; windows placed for fallback rectangles.", "notice");
  refresh(ctx);

  // Phase H: Plaza details (prefab)
  await sleep(delay);
  (function stampPlazaDetails() {
    const PFB = (typeof window !== "undefined" && window.GameData && window.GameData.prefabs) ? window.GameData.prefabs : null;
    const plazas = (PFB && Array.isArray(PFB.plazas)) ? PFB.plazas : [];
    if (!plazas.length) return;
    const fit = plazas.filter(p => p && p.size && (p.size.w | 0) <= plazaW && (p.size.h | 0) <= plazaH);
    const list = (fit.length ? fit : plazas);
    const pref = Prefabs.pickPrefab(list, ctx.rng || Math.random);
    if (!pref || !pref.size) return;
    const bx = ((plaza.x - ((pref.size.w / 2) | 0)) | 0);
    const by = ((plaza.y - ((pref.size.h / 2) | 0)) | 0);
    if (!Prefabs.stampPlazaPrefab(ctx, pref, bx, by)) {
      Prefabs.trySlipStamp(ctx, pref, bx, by, 2, ctx.townBuildings);
    }
  })();
  ctx.log && ctx.log("Phase H: plaza fixtures placed.", "notice");
  refresh(ctx);

  // Phase I: Cleanup and perimeter repairs
  await sleep(delay);
  (function repairPerimeters() {
    for (const b of ctx.townBuildings) {
      const x0 = b.x, y0 = b.y, x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
      for (let xx = x0; xx <= x1; xx++) {
        if (ctx.map[y0][xx] !== ctx.TILES.DOOR && ctx.map[y0][xx] !== ctx.TILES.WINDOW) ctx.map[y0][xx] = ctx.TILES.WALL;
        if (ctx.map[y1][xx] !== ctx.TILES.DOOR && ctx.map[y1][xx] !== ctx.TILES.WINDOW) ctx.map[y1][xx] = ctx.TILES.WALL;
      }
      for (let yy = y0; yy <= y1; yy++) {
        if (ctx.map[yy][x0] !== ctx.TILES.DOOR && ctx.map[yy][x0] !== ctx.TILES.WINDOW) ctx.map[yy][x0] = ctx.TILES.WALL;
        if (ctx.map[yy][x1] !== ctx.TILES.DOOR && ctx.map[yy][x1] !== ctx.TILES.WINDOW) ctx.map[yy][x1] = ctx.TILES.WALL;
      }
    }
  })();
  ctx.log && ctx.log("Phase I: perimeters repaired.", "notice");
  refresh(ctx);

  // Phase J: NPC population
  await sleep(delay);
  (function populateNPCs() {
    ctx.npcs = [];
    try {
      const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
      if (TAI && typeof TAI.populateTown === "function") {
        TAI.populateTown(ctx);
      }
    } catch (_) {}
    try {
      if (ctx.Town && typeof ctx.Town.spawnGateGreeters === "function") {
        ctx.Town.spawnGateGreeters(ctx, 1);
      }
    } catch (_) {}
  })();
  ctx.log && ctx.log("Phase J: NPCs populated (residents, shopkeepers, pets, greeter).", "notice");
  refresh(ctx);

  // Phase K: Visibility and post-gen wiring
  await sleep(delay);
  ctx.seen = Array.from({ length: H }, () => Array(W).fill(false));
  ctx.visible = Array.from({ length: H }, () => Array(W).fill(false));
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
  } catch (_) {}
  try {
    const Cap = ctx.Capabilities || (typeof window !== "undefined" ? window.Capabilities : null);
    if (Cap && typeof Cap.safeCall === "function") Cap.safeCall(ctx, "UIOrchestration", "showTownExitButton", ctx);
  } catch (_) {}
  ctx.log && ctx.log("Phase K: visibility reset, occupancy rebuilt, exit button shown.", "notice");
  refresh(ctx);

  try { ctx.log && ctx.log(`You enter the town. Shops are marked with 'S'.`, "notice"); } catch (_) {}
  return true;
}

attachGlobal("TownGenDeploy", { run });