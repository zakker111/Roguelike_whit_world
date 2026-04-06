// worldgen/roads.js
// Build town roads after buildings and outdoor mask are known.
// Exports:
//  - build(ctx): mutates ctx.map to mark ROAD tiles and publishes ctx.townRoads mask.

export function build(ctx) {
  try {
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (!rows || !cols) return false;

    const inB = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;

    function insideAnyBuilding(x, y) {
      const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
      for (let i = 0; i < tbs.length; i++) {
        const B = tbs[i];
        if (x > B.x && x < B.x + B.w - 1 && y > B.y && y < B.y + B.h - 1) return true;
      }
      return false;
    }

    const outdoor = ctx.townOutdoorMask;
    const pass = (x, y) => inB(x, y) && outdoor && outdoor[y] && outdoor[y][x];

    const dirs4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];

    function bfs(sx, sy, goalFn) {
      if (!pass(sx, sy)) return null;
      const q = [];
      const seen = new Set();
      const prev = new Map();
      const k0 = `${sx},${sy}`;
      seen.add(k0);
      q.push({ x: sx, y: sy });
      let end = null;
      while (q.length) {
        const cur = q.shift();
        if (goalFn(cur.x, cur.y)) { end = cur; break; }
        for (let i = 0; i < dirs4.length; i++) {
          const d = dirs4[i];
          const nx = cur.x + d.dx, ny = cur.y + d.dy;
          if (!pass(nx, ny)) continue;
          const key = `${nx},${ny}`;
          if (seen.has(key)) continue;
          seen.add(key);
          prev.set(key, cur);
          q.push({ x: nx, y: ny });
        }
      }
      if (!end) return null;
      const path = [];
      let cur = { x: end.x, y: end.y };
      while (cur) {
        path.push({ x: cur.x, y: cur.y });
        const p = prev.get(`${cur.x},${cur.y}`);
        cur = p ? { x: p.x, y: p.y } : null;
      }
      path.reverse();
      return path;
    }

    const pr = ctx.townPlazaRect || {
      x0: ((ctx.townPlaza.x - ((ctx.townPlazaW || 14) / 2)) | 0),
      y0: ((ctx.townPlaza.y - ((ctx.townPlazaH || 12) / 2)) | 0),
      x1: ((ctx.townPlaza.x + ((ctx.townPlazaW || 14) / 2)) | 0),
      y1: ((ctx.townPlaza.y + ((ctx.townPlazaH || 12) / 2)) | 0),
    };

    function insidePlaza(x, y) {
      return x >= pr.x0 && x <= pr.x1 && y >= pr.y0 && y <= pr.y1;
    }

    function markRoadPath(path, roadsMask) {
      if (!Array.isArray(path) || path.length === 0) return;
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        if (!inB(p.x, p.y)) continue;
        // Keep the plaza interior pure FLOOR; do not convert or mark roads inside it
        if (insidePlaza(p.x, p.y)) continue;
        const t = ctx.map[p.y][p.x];
        if (t === ctx.TILES.FLOOR) {
          ctx.map[p.y][p.x] = ctx.TILES.ROAD;
          roadsMask[p.y][p.x] = true;
        } else if (t === ctx.TILES.ROAD) {
          roadsMask[p.y][p.x] = true;
        }
      }
    }

    function nearestOutdoorToDoor(door) {
      const neigh = dirs4;
      for (let i = 0; i < neigh.length; i++) {
        const d = neigh[i];
        const nx = door.x + d.dx, ny = door.y + d.dy;
        if (!pass(nx, ny)) continue;
        if (insideAnyBuilding(nx, ny)) continue;
        return { x: nx, y: ny };
      }
      // small radius search
      for (let r = 1; r <= 2; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = door.x + dx, ny = door.y + dy;
            if (!pass(nx, ny)) continue;
            if (insideAnyBuilding(nx, ny)) continue;
            return { x: nx, y: ny };
          }
        }
      }
      return null;
    }

    const roadsMask = Array.from({ length: rows }, () => Array(cols).fill(false));

    // Main road: gate -> plaza center (or nearest outdoor tile inside plaza)
    const gate = ctx.townExitAt || { x: ctx.player.x, y: ctx.player.y };
    const cx = ctx.townPlaza ? (ctx.townPlaza.x | 0) : ((cols / 2) | 0);
    const cy = ctx.townPlaza ? (ctx.townPlaza.y | 0) : ((rows / 2) | 0);
    let pGoal = null;
    if (pass(cx, cy)) {
      pGoal = { x: cx, y: cy };
    } else {
      let best = null, bd = Infinity;
      for (let y = pr.y0; y <= pr.y1; y++) {
        for (let x = pr.x0; x <= pr.x1; x++) {
          if (!pass(x, y)) continue;
          const d = Math.abs(x - cx) + Math.abs(y - cy);
          if (d < bd) { bd = d; best = { x, y }; }
        }
      }
      pGoal = best || { x: cx, y: cy };
    }
    const startMain = { x: gate.x, y: gate.y };
    if (pass(startMain.x, startMain.y) && pGoal) {
      const pathMain = bfs(startMain.x, startMain.y, (x, y) => x === pGoal.x && y === pGoal.y);
      markRoadPath(pathMain, roadsMask);
    }

    // Road set for connecting spurs
    const roadSet = new Set();
    for (let yy = 0; yy < rows; yy++) {
      for (let xx = 0; xx < cols; xx++) {
        if (ctx.map[yy][xx] === ctx.TILES.ROAD) {
          roadsMask[yy][xx] = true;
          roadSet.add(`${xx},${yy}`);
        }
      }
    }

    function pathToNearestRoad(sx, sy) {
      return bfs(sx, sy, (x, y) => roadSet.has(`${x},${y}`));
    }

    const tbs = Array.isArray(ctx.townBuildings) ? ctx.townBuildings : [];
    for (let i = 0; i < tbs.length; i++) {
      const b = tbs[i];
      const door = b && b.door ? b.door : null;
      if (!door || typeof door.x !== "number" || typeof door.y !== "number") continue;
      const startOut = nearestOutdoorToDoor(door);
      if (!startOut) continue;
      if (ctx.map[startOut.y][startOut.x] === ctx.TILES.ROAD) {
        roadsMask[startOut.y][startOut.x] = true;
        continue;
      }
      let path = pathToNearestRoad(startOut.x, startOut.y);
      if (!path || !path.length) {
        // Fallback: path to plaza goal
        path = bfs(startOut.x, startOut.y, (x, y) => x === pGoal.x && y === pGoal.y);
      }
      markRoadPath(path, roadsMask);
      if (Array.isArray(path)) {
        for (let k = 0; k < path.length; k++) {
          const p = path[k];
          roadSet.add(`${p.x},${p.y}`);
        }
      }
    }

    // Publish mask
    ctx.townRoads = roadsMask;
    return true;
  } catch (_) { return false; }
}