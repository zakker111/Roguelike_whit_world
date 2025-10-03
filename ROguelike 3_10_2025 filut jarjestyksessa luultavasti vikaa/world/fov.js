/**
 * FOV: symmetrical shadowcasting with explored memory.
 *
 * Exports (window.FOV):
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
(function () {
  function recomputeFOV(ctx) {
    const { fovRadius, player, map, TILES } = ctx;
    const ROWS = map.length;
    const COLS = map[0] ? map[0].length : 0;

    // Reuse the visible array if shape matches to avoid allocations each turn
    let visible = ctx.visible;
    const shapeOk = Array.isArray(visible) && visible.length === ROWS && (ROWS === 0 || (visible[0] && visible[0].length === COLS));
    if (!shapeOk) {
      visible = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    } else {
      for (let y = 0; y < ROWS; y++) {
        visible[y].fill(false);
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
    function castLight(cx, cy, row, start, end, radius, xx, xy, yx, yy) {
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
            ctx.seen[Y][X] = true;
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
              castLight(cx, cy, i + 1, start, lSlope, radius, xx, xy, yx, yy);
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
      ctx.seen[player.y][player.x] = true;
    }

    castLight(player.x, player.y, 1, 1.0, 0.0, radius, 1, 0, 0, 1);   // E-NE
    castLight(player.x, player.y, 1, 1.0, 0.0, radius, 1, 0, 0, -1);  // E-SE
    castLight(player.x, player.y, 1, 1.0, 0.0, radius, -1, 0, 0, 1);  // W-NW
    castLight(player.x, player.y, 1, 1.0, 0.0, radius, -1, 0, 0, -1); // W-SW
    castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, 1, 1, 0);   // S-SE
    castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, 1, -1, 0);  // S-SW
    castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, -1, 1, 0);  // N-NE
    castLight(player.x, player.y, 1, 1.0, 0.0, radius, 0, -1, -1, 0); // N-NW

    // Dynamic lamp lighting in towns at night/dawn/dusk: extend visibility from lamps
    try {
      const isTown = ctx.mode === "town";
      const phase = ctx.time && ctx.time.phase;
      const lampActive = isTown && (phase === "night" || phase === "dusk" || phase === "dawn");
      if (lampActive && Array.isArray(ctx.townProps)) {
        const lampRadius = Math.max(2, Math.min(6, Math.floor((radius + 2) / 3))); // small local glow (typically 3-4)
        for (const p of ctx.townProps) {
          if (!p || p.type !== "lamp") continue;
          const lx = p.x | 0, ly = p.y | 0;
          if (!ctx.inBounds(lx, ly)) continue;
          // Mark lamp tile itself visible
          visible[ly][lx] = true;
          ctx.seen[ly][lx] = true;
          // Cast limited light from lamp (respecting walls/windows via isTransparent)
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, 1, 0, 0, 1);
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, 1, 0, 0, -1);
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, -1, 0, 0, 1);
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, -1, 0, 0, -1);
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, 0, 1, 1, 0);
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, 0, 1, -1, 0);
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, 0, -1, 1, 0);
          castLight(lx, ly, 1, 1.0, 0.0, lampRadius, 0, -1, -1, 0);
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
        ctx.log(`You spot a ${Cap(e.type || "enemy")} Lv ${e.level || 1} (${label}).`, "notice");
      }
      const rest = newly.length - toSolo.length;
      if (rest > 0) {
        ctx.log(`You also spot ${rest} more ${rest === 1 ? "enemy" : "enemies"}.`, "notice");
      }
      // Mark all newly seen enemies as announced
      for (const e of newly) e.announced = true;
    }
  }

  window.FOV = { recomputeFOV };
})();