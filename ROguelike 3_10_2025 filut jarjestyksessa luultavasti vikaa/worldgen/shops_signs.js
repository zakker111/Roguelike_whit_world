/**
 * Shops and Signs helpers for Town generation.
 * Exports:
 *  - addProp(ctx, x, y, type, name)
 *  - addSignNear(ctx, x, y, text)
 *  - addShopSignInside(ctx, building, door, text)
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
        const insideThisShop = s.building ? isInsideBuilding(s.building, p.x, p.y) : false;
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

      // Ensure kept sign (if any) is inside; otherwise re-place inside near door.
      // Also canonicalize its text to the shop's name.
      let keptIdx = -1;
      for (let i = 0; i < props.length; i++) {
        if (removeIdx.has(i)) continue;
        const p = props[i];
        if (!p || String(p.type || "").toLowerCase() !== "sign") continue;
        const name = String(p.name || "");
        const insideThisShop = s.building ? isInsideBuilding(s.building, p.x, p.y) : false;
        if (namesToMatch.includes(name) || insideThisShop) { keptIdx = i; break; }
      }
      if (keptIdx !== -1) {
        const p = props[keptIdx];
        if (s.building && isInsideBuilding(s.building, p.x, p.y)) {
          // Already inside: canonicalize name
          try { if (String(p.name || "") !== text) p.name = text; } catch (_) {}
        } else {
          // Move outside sign to inside near door
          removeIdx.add(keptIdx);
          try { if (s.building) addShopSignInside(ctx, s.building, door, text); } catch (_) {}
        }
      } else {
        // No sign exists; place one inside near the door
        try { if (s.building) addShopSignInside(ctx, s.building, door, text); } catch (_) {}
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

attachGlobal("ShopsSigns", { addProp, addSignNear, addShopSignInside, dedupeShopSigns, dedupeWelcomeSign });