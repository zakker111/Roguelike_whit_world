/**
 * FOV: symmetrical shadowcasting with explored memory.
 *
 * Exports (ESM + window.FOV):
 * - recomputeFOV(ctx): mutates ctx.visible and ctx.seen and announces newly seen enemies.
 *
 * ctx (expected subset):
 * {
 *   fovRadius:number, player:{x,y}, map:number[][], TILES:{WALL:number},
 *   inBounds(x,y):boolean, seen:boolean[][], visible:boolean[][],
 *   enemies:Array, enemyThreatLabel(e), log(msg,type?),
 *   // optional extras for town lighting
 *   mode?: "world"|"town"|"dungeon",
 *   time?: { phase?: "dawn"|"day"|"dusk"|"night" },
 *   townProps?: Array<{x:number,y:number,type:string}>
 * }
 */
import { fogSet } from "../core/engine/fog.js";

export function recomputeFOV(ctx) {
  let _fovPerfStart = null;
  try {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      _fovPerfStart = performance.now();
    }
  } catch (_) {}

  const { fovRadius, player, map, TILES } = ctx;
  const ROWS = map.length;
  const COLS = map[0] ? map[0].length : 0;

  // Reuse the visible grid if shape matches to avoid allocations each turn.
  // Use typed arrays for better performance and lower GC pressure.
  let visible = ctx.visible;
  const shapeOk = Array.isArray(visible) && visible.length === ROWS && (ROWS === 0 || (visible[0] && visible[0].length === COLS));
  if (!shapeOk) {
    visible = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
  } else {
    for (let y = 0; y < ROWS; y++) {
      // Typed arrays accept numeric fills; booleans will coerce to 0/1.
      visible[y].fill(0);
    }
  }

  const radius = Math.max(1, fovRadius);
  const Cap = (ctx.utils && typeof ctx.utils.capitalize === "function")
    ? ctx.utils.capitalize
    : (s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  function isTransparent(x, y) {
    // Prefer shared LOS transparency if available for consistency across modules
    if (ctx.los && typeof ctx.los.tileTransparent === "function") {
      return ctx.los.tileTransparent(ctx, x, y);
    }
    if (!ctx.inBounds(x, y)) return false;
    return map[y][x] !== TILES.WALL;
  }

  // Symmetrical shadowcasting (RogueBasin-style)
  // Symmetrical shadowcasting (RogueBasin-style) with optional seen-memory marking
  function castLight(cx, cy, row, start, end, radius, xx, xy, yx, yy, markSeen = true) {
    if (start < end) return;
    const radius2 = radius * radius;

    for (let i = row; i <= radius; i++) {
      let dx = -i - 1;
      let dy = -i;
      let blocked = false;
      let newStart = 0.0;

      while (dx <= 0) {
        dx += 1;

        const X = cx + dx * xx + dy * yx;
        const Y = cy + dx * xy + dy * yy;

        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);

        if (start < rSlope) continue;
        if (end > lSlope) break;

        if (!ctx.inBounds(X, Y)) continue;

        const dist2 = dx * dx + dy * dy;
        if (dist2 <= radius2) {
          visible[Y][X] = true;
          if (markSeen) fogSet(ctx.seen, X, Y, true);
        }

        if (blocked) {
          if (!isTransparent(X, Y)) {
            newStart = rSlope;
          } else {
            blocked = false;
            start = newStart;
          }
        } else {
          if (!isTransparent(X, Y) && i < radius) {
            blocked = true;
            castLight(cx, cy, i + 1, start, lSlope, radius, xx, xy, yx, yy, markSeen);
            newStart = rSlope;
          }
        }
      }
      if (blocked) break;
    }
  }

  // Player-centered visibility
  if (ctx.inBounds(player.x, player.y)) {
    visible[player.y][player.x] = true;
    fogSet(ctx.seen, player.x, player.y, true);
  }

  castLight(player.x, player.y, 1, 1.0, 0.0, radius, 1, 0, 0, 1, true);   // E-NE
  castLight(player.x, player.y, 1, 1.0, 0.0, radius, 1, 0, 0, -1, true);  // E-SE
  castLight(player.x, player.y, 1, 1.0, 0.0, radius, -1, 0, 0, 1, true);  // W-NW
  castLight(player.x, player.y, 1, 1.0, 0.0, radius, -1, 0, 0, -1, true); // W-SW
  castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, 1, 1, 0, true);   // S-SE
  castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, 1, -1, 0, true);  // S-SW
  castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, -1, 1, 0, true);  // N-NE
  castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, -1, -1, 0, true); // N-NW

  // Dynamic lighting from props: town lamps/fireplaces at night; dungeon wall torches always
  try {
    // Helper: lookup prop definition by id/key
    function propDefFor(type) {
      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const arr = GD && GD.props && Array.isArray(GD.props.props) ? GD.props.props : null;
        if (!arr) return null;
        const key = String(type || "").toLowerCase();
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          if (String(e.id || "").toLowerCase() === key || String(e.key || "").toLowerCase() === key) return e;
        }
      } catch (_) {}
      return null;
    }

    const isTown = ctx.mode === "town";
    const isDungeon = ctx.mode === "dungeon";
    const phase = ctx.time && ctx.time.phase;
    const townLightActive = isTown && (phase === "night" || phase === "dusk" || phase === "dawn");
    const dungeonLightActive = isDungeon; // torches glow regardless of time

    if (townLightActive) {
      const lights = Array.isArray(ctx.townLightProps) ? ctx.townLightProps : (Array.isArray(ctx.townProps) ? ctx.townProps : []);
      if (lights.length) {
        const px = player.x | 0;
        const py = player.y | 0;
        for (const p of lights) {
          if (!p) continue;
          const lx = p.x | 0, ly = p.y | 0;
          if (!ctx.inBounds(lx, ly)) continue;

          // Distance-based culling: skip lamps far outside player FOV radius.
          const dx = lx - px;
          const dy = ly - py;
          const dist = Math.abs(dx) + Math.abs(dy);
          const margin = 3;
          if (dist > radius + margin) continue;

          const def = propDefFor(p.type);
          const emits = !!(def && def.properties && def.properties.emitsLight);
          if (!emits) continue;

          const baseR = Math.max(2, Math.min(6, Math.floor((radius + 2) / 3))); // default small local glow (typically 3-4)
          const castR = (def && def.light && typeof def.light.castRadius === "number")
            ? Math.max(1, Math.min(12, Math.floor(def.light.castRadius)))
            : baseR;

          visible[ly][lx] = true;
          castLight(lx, ly, 1, 1.0, 0.0, castR, 1, 0, 0, 1, false);
          castLight(lx, ly, 1, 1.0, 0.0, castR, 1, 0, 0, -1, false);
          castLight(lx, ly, 1, 1.0, 0.0, castR, -1, 0, 0, 1, false);
          castLight(lx, ly, 1, 1.0, 0.0, castR, -1, 0, 0, -1, false);
          castLight(lx, ly, 1, 1.0, 0.0, castR, 0, 1, 1, 0, false);
          castLight(lx, ly, 1, 1.0, 0.0, castR, 0, 1, -1, 0, false);
          castLight(lx, ly, 1, 1.0, 0.0, castR, 0, -1, 1, 0, false);
          castLight(lx, ly, 1, 1.0, 0.0, castR, 0, -1, -1, 0, false);
        }
      }
    }

    if (dungeonLightActive && Array.isArray(ctx.dungeonProps)) {
      for (const p of ctx.dungeonProps) {
        if (!p) continue;
        const def = propDefFor(p.type);
        const emits = !!(def && def.properties && def.properties.emitsLight);
        if (!emits) continue;

        const lx = p.x | 0, ly = p.y | 0;
        if (!ctx.inBounds(lx, ly)) continue;

        const baseR = Math.max(2, Math.min(6, Math.floor((radius + 2) / 3))); // default small local glow (typically 3-4)
        const castR = (def && def.light && typeof def.light.castRadius === "number")
          ? Math.max(1, Math.min(12, Math.floor(def.light.castRadius)))
          : baseR;

        visible[ly][lx] = true;
        castLight(lx, ly, 1, 1.0, 0.0, castR, 1, 0, 0, 1, false);
        castLight(lx, ly, 1, 1.0, 0.0, castR, 1, 0, 0, -1, false);
        castLight(lx, ly, 1, 1.0, 0.0, castR, -1, 0, 0, 1, false);
        castLight(lx, ly, 1, 1.0, 0.0, castR, -1, 0, 0, -1, false);
        castLight(lx, ly, 1, 1.0, 0.0, castR, 0, 1, 1, 0, false);
        castLight(lx, ly, 1, 1.0, 0.0, castR, 0, 1, -1, 0, false);
        castLight(lx, ly, 1, 1.0, 0.0, castR, 0, -1, 1, 0, false);
        castLight(lx, ly, 1, 1.0, 0.0, castR, 0, -1, -1, 0, false);
      }
    }
  } catch (_) {}

  ctx.visible = visible;

  // Announce newly visible enemies with a simple danger rating (rate-limited)
  const newly = [];
  for (const e of ctx.enemies) {
    if (ctx.inBounds(e.x, e.y) && ctx.visible[e.y][e.x] && !e.announced) {
      newly.push(e);
    }
  }
  if (newly.length > 0) {
    const maxSolo = 2;
    const toSolo = newly.slice(0, maxSolo);
    for (const e of toSolo) {
      const { label } = ctx.enemyThreatLabel(e);
      ctx.log(`You spot a ${Cap(e.type || "enemy")} Lv ${e.level || 1} (${label}).`, "info");
    }
    const rest = newly.length - toSolo.length;
    if (rest > 0) {
      ctx.log(`You also spot ${rest} more ${rest === 1 ? "enemy" : "enemies"}.`, "info");
    }
    // Mark all newly seen enemies as announced
    for (const e of newly) e.announced = true;
  }

  if (_fovPerfStart != null) {
    try {
      const dt = performance.now() - _fovPerfStart;
      ctx._perfFOVAccum = (ctx._perfFOVAccum || 0) + dt;
      ctx._perfFOVCount = (ctx._perfFOVCount || 0) + 1;
    } catch (_) {}
  }
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.FOV = { recomputeFOV };
}