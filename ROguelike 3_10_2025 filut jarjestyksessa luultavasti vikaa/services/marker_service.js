/**
 * MarkerService
 * - Purpose: unified world marker operations for ctx.world.questMarkers.
 * - Supports legacy markers: {x,y,instanceId}
 * - New marker shape: {x,y,kind,glyph,paletteKey,instanceId,createdTurn}
 */

function nowTurn(ctx) {
  try { return (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0; } catch (_) { return 0; }
}

function markerKey(x, y, kind, instanceId) {
  const k = kind ? String(kind) : "";
  const id = instanceId != null ? String(instanceId) : "";
  return `${x | 0},${y | 0}:${k}:${id}`;
}

export function ensure(ctx) {
  if (!ctx || !ctx.world) return null;
  const w = ctx.world;
  w.questMarkers = Array.isArray(w.questMarkers) ? w.questMarkers : [];

  const setOk = (w._questMarkerSet instanceof Set) && w._questMarkerSet._markerServiceVersion === 1;
  if (!setOk) {
    const s = new Set();
    s._markerServiceVersion = 1;
    const out = [];
    for (const m of w.questMarkers) {
      if (!m || typeof m.x !== "number" || typeof m.y !== "number") continue;
      const key = markerKey(m.x, m.y, m.kind, m.instanceId);
      if (s.has(key)) continue;
      s.add(key);
      out.push(m);
    }
    w.questMarkers = out;
    w._questMarkerSet = s;
  }

  return w;
}

export function add(ctx, marker) {
  if (!ctx || !ctx.world || !marker) return null;
  ensure(ctx);

  const m = Object.assign({}, marker);
  m.x = (m.x | 0);
  m.y = (m.y | 0);
  if (m.createdTurn == null) m.createdTurn = nowTurn(ctx);

  const key = markerKey(m.x, m.y, m.kind, m.instanceId);
  if (ctx.world._questMarkerSet.has(key)) return null;

  ctx.world.questMarkers.push(m);
  ctx.world._questMarkerSet.add(key);
  return m;
}

export function remove(ctx, criteriaOrPredicate) {
  if (!ctx || !ctx.world) return 0;
  ensure(ctx);

  const arr = ctx.world.questMarkers;
  const pred = (typeof criteriaOrPredicate === "function")
    ? criteriaOrPredicate
    : (function buildCriteriaPredicate() {
        const c = criteriaOrPredicate || {};
        const hasX = (typeof c.x === "number");
        const hasY = (typeof c.y === "number");
        const hasKind = (typeof c.kind === "string");
        const hasGlyph = (typeof c.glyph === "string");
        const hasPaletteKey = (typeof c.paletteKey === "string");
        const hasInstanceId = (c.instanceId != null);
        const x = hasX ? (c.x | 0) : 0;
        const y = hasY ? (c.y | 0) : 0;
        const kind = hasKind ? String(c.kind) : "";
        const glyph = hasGlyph ? String(c.glyph) : "";
        const paletteKey = hasPaletteKey ? String(c.paletteKey) : "";
        const instanceId = hasInstanceId ? String(c.instanceId) : "";
        return function match(m) {
          if (!m) return false;
          if (hasX && (m.x | 0) !== x) return false;
          if (hasY && (m.y | 0) !== y) return false;
          if (hasKind && String(m.kind || "") !== kind) return false;
          if (hasGlyph && String(m.glyph || "") !== glyph) return false;
          if (hasPaletteKey && String(m.paletteKey || "") !== paletteKey) return false;
          if (hasInstanceId && String(m.instanceId || "") !== instanceId) return false;
          return true;
        };
      })();

  let removed = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i];
    if (!pred(m)) continue;
    arr.splice(i, 1);
    removed += 1;
    try { ctx.world._questMarkerSet.delete(markerKey(m.x, m.y, m.kind, m.instanceId)); } catch (_) {}
  }
  return removed;
}

export function findAt(ctx, absX, absY) {
  if (!ctx || !ctx.world) return [];
  ensure(ctx);
  const x = absX | 0;
  const y = absY | 0;
  const arr = ctx.world.questMarkers;
  const out = [];
  for (const m of arr) {
    if (!m) continue;
    if ((m.x | 0) === x && (m.y | 0) === y) out.push(m);
  }
  return out;
}

export function findAtPlayer(ctx) {
  if (!ctx || !ctx.world || !ctx.player) return [];
  const ox = (ctx.world && typeof ctx.world.originX === "number") ? (ctx.world.originX | 0) : 0;
  const oy = (ctx.world && typeof ctx.world.originY === "number") ? (ctx.world.originY | 0) : 0;
  const x = ox + (ctx.player.x | 0);
  const y = oy + (ctx.player.y | 0);
  return findAt(ctx, x, y);
}

export const MarkerService = { ensure, add, remove, findAt, findAtPlayer };

if (typeof window !== "undefined") window.MarkerService = MarkerService;
