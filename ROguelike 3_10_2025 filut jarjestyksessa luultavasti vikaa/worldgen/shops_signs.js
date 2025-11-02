/**
 * Shops and Signs helpers for Town generation.
 * Exports:
 *  - addProp(ctx, x, y, type, name)
 *  - addSignNear(ctx, x, y, text)
 *  - addShopSignInside(ctx, building, door, text)
 *  - addOutsideSignNearDoor(ctx, building, door, text)
 *  - dedupeShopSigns(ctx)
 *  - dedupeWelcomeSign(ctx, gate, text?)
 */
import { attachGlobal } from "../utils/global.js";

function inBounds(ctx, x, y) {
  const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function isInsideBuilding(b, x, y) {
  return x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1;
}

export function addProp(ctx, x, y, type, name) {
  const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
  const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
  if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1) return false;
  const t = ctx.map[y][x];
  if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.ROAD) return false;
  const list = Array.isArray(ctx.townProps) ? ctx.townProps : (ctx.townProps = []);
  if (list.some(p => p.x === x && p.y === y)) return false;
  list.push({ x, y, type, name });
  return true;
}

export function addSignNear(ctx, x, y, text) {
  const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  for (const d of dirs) {
    const sx = x + d.dx, sy = y + d.dy;
    if (addProp(ctx, sx, sy, "sign", text)) return true;
  }
  return false;
}

// Place one shop sign inside the building, near the door if possible.
export function addShopSignInside(ctx, b, door, text) {
  // Candidate inside tiles: directly inward from the door, then a small interior search
  const candidates = [];
  const inward = [{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:0},{dx:-1,dy:0}];
  for (let i = 0; i < inward.length; i++) {
    const ix = door.x + inward[i].dx, iy = door.y + inward[i].dy;
    if (isInsideBuilding(b, ix, iy)) candidates.push({ x: ix, y: iy });
  }
  // Interior search within radius 3 from the door but only inside the building
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = door.x + dx, iy = door.y + dy;
        if (!isInsideBuilding(b, ix, iy)) continue;
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
  const rows = ctx.map.length;
  const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.x <= 0 || c.y <= 0 || c.x >= cols - 1 || c.y >= rows - 1) continue;
    if (!isInsideBuilding(b, c.x, c.y)) continue;
    const t = ctx.map[c.y][c.x];
    if (t !== ctx.TILES.FLOOR) continue;
    if (ctx.player && ctx.player.x === c.x && ctx.player.y === c.y) continue;
    if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === c.x && n.y === c.y)) continue;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === c.x && p.y === c.y)) continue;
    const d = Math.abs(c.x - door.x) + Math.abs(c.y - door.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best) {
    return addProp(ctx, best.x, best.y, "sign", text);
  }
  return false;
}

// Place an outside sign just outside the door, favoring the outward-facing tile
export function addOutsideSignNearDoor(ctx, b, door, text) {
  function outwardDelta(b, door) {
    if (door.x === b.x) return { dx: -1, dy: 0 };
    if (door.x === b.x + b.w - 1) return { dx: +1, dy: 0 };
    if (door.y === b.y) return { dx: 0, dy: -1 };
    return { dx: 0, dy: +1 }; // bottom edge
  }
  const out = outwardDelta(b, door);
  const primary = { x: door.x + out.dx, y: door.y + out.dy };
  // Try the primary outward tile first
  if (!isInsideBuilding(b, primary.x, primary.y) && addProp(ctx, primary.x, primary.y, "sign", text)) return true;
  // Fallback: any adjacent cardinal tile outside the building
  const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  for (let i = 0; i < dirs.length; i++) {
    const sx = door.x + dirs[i].dx, sy = door.y + dirs[i].dy;
    if (isInsideBuilding(b, sx, sy)) continue;
    if (addProp(ctx, sx, sy, "sign", text)) return true;
  }
  return false;
}

export function dedupeShopSigns(ctx) {
  try {
    if (!Array.isArray(ctx.shops) || !Array.isArray(ctx.townProps) || !ctx.townProps.length) return;
    const props = ctx.townProps;
    const removeIdx = new Set();

    for (let si = 0; si < ctx.shops.length; si++) {
      const s = ctx.shops[si];
      if (!s) continue;
      const text = String(s.name || s.type || "Shop");
      const door = (s.building && s.building.door) ? s.building.door : { x: s.x, y: s.y };
      const isInn = String(s.type || "").toLowerCase() === "inn";
      const namesToMatch = [text];
      if (isInn) {
        if (!namesToMatch.includes("Inn")) namesToMatch.push("Inn");
        if (!namesToMatch.includes("Inn & Tavern")) namesToMatch.push("Inn & Tavern");
        if (!namesToMatch.includes("Tavern")) namesToMatch.push("Tavern");
      }

      // Partition matching signs into inside vs outside relative to this shop building
      const insideIdx = [];
      const outsideIdx = [];
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        if (!p || String(p.type || "").toLowerCase() !== "sign") continue;
        const name = String(p.name || "");
        const insideThisShop = s.building ? isInsideBuilding(s.building, p.x, p.y) : false;
        if (namesToMatch.includes(name) || insideThisShop) {
          if (insideThisShop) insideIdx.push(i);
          else outsideIdx.push(i);
        }
      }

      const wants = (s && Object.prototype.hasOwnProperty.call(s, "signWanted")) ? !!s.signWanted : true;
      if (!wants) {
        // Remove all signs for this shop (inside and outside)
        for (const idx of insideIdx) removeIdx.add(idx);
        for (const idx of outsideIdx) removeIdx.add(idx);
        continue;
      }

      // Keep exactly one inside sign (nearest to door); remove the rest
      if (insideIdx.length > 1) {
        let keepI = insideIdx[0], bestD = Infinity;
        for (const idx of insideIdx) {
          const p = props[idx];
          const d = Math.abs(p.x - door.x) + Math.abs(p.y - door.y);
          if (d < bestD) { bestD = d; keepI = idx; }
        }
        for (const idx of insideIdx) {
          if (idx !== keepI) removeIdx.add(idx);
        }
      }
      // If there is no inside sign, place one near the door
      if (insideIdx.length === 0) {
        try { if (s.building) addShopSignInside(ctx, s.building, door, text); } catch (_) {}
      } else {
        // Canonicalize name of the kept inside sign
        try {
          let keepI = -1, bestD = Infinity;
          for (const idx of insideIdx) {
            if (removeIdx.has(idx)) continue;
            const p = props[idx];
            const d = Math.abs(p.x - door.x) + Math.abs(p.y - door.y);
            if (d < bestD) { bestD = d; keepI = idx; }
          }
          if (keepI !== -1 && String(props[keepI].name || "") !== text) props[keepI].name = text;
        } catch (_) {}
      }

      // Outside signs: for Inn, keep one nearest; for other shops, remove all outside signs
      if (outsideIdx.length) {
        if (isInn) {
          let keepO = outsideIdx[0], bestDo = Infinity;
          for (const idx of outsideIdx) {
            const p = props[idx];
            const d = Math.abs(p.x - door.x) + Math.abs(p.y - door.y);
            if (d < bestDo) { bestDo = d; keepO = idx; }
          }
          // Remove other outside duplicates
          for (const idx of outsideIdx) {
            if (idx !== keepO) removeIdx.add(idx);
          }
          // Canonicalize outside kept sign's name
          try { if (String(props[keepO].name || "") !== text) props[keepO].name = text; } catch (_) {}
        } else {
          for (const idx of outsideIdx) removeIdx.add(idx);
        }
      }
    }

    if (removeIdx.size) {
      ctx.townProps = props.filter((_, i) => !removeIdx.has(i));
    }
  } catch (_) {}
}

export function dedupeWelcomeSign(ctx, gate, text) {
  try {
    if (!Array.isArray(ctx.townProps) || !gate) return;
    const msg = (typeof text === "string" && text) ? text : `Welcome to ${ctx.townName}`;
    const props = ctx.townProps;
    let keepIdx = -1, bestD = Infinity;
    const removeIdx = new Set();
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p && String(p.type || "").toLowerCase() === "sign" && String(p.name || "") === msg) {
        const d = Math.abs(p.x - gate.x) + Math.abs(p.y - gate.y);
        if (d < bestD) { bestD = d; keepIdx = i; }
        removeIdx.add(i);
      }
    }
    if (keepIdx !== -1) removeIdx.delete(keepIdx);
    if (removeIdx.size) {
      ctx.townProps = props.filter((_, i) => !removeIdx.has(i));
    }
    const hasWelcome = Array.isArray(ctx.townProps) && ctx.townProps.some(p => p && String(p.type || "").toLowerCase() === "sign" && String(p.name || "") === msg);
    if (!hasWelcome) {
      addSignNear(ctx, gate.x, gate.y, msg);
    }
  } catch (_) {}
}

attachGlobal("ShopsSigns", { addProp, addSignNear, addShopSignInside, addOutsideSignNearDoor, dedupeShopSigns, dedupeWelcomeSign });