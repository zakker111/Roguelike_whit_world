/**
 * Encounter map generators (Phase 4 extraction).
 */
export function genEmpty(ctx, W, H, T) {
  const m = Array.from({ length: H }, () => Array(W).fill(T.FLOOR));
  return m;
}

// Open battlefield: mostly flat floor, intended for large skirmishes like Guards vs Bandits.
export function genBattlefield(ctx, rng, W, H, T) {
  // For now, this is a plain open field; use genEmpty so lines can clash without obstacles.
  return genEmpty(ctx, W, H, T);
}

/**
 * Simple caravan ambush road: a horizontal road with a broken caravan in the middle
 * and a few crates/barrels scattered around.
 */
export function genCaravanRoad(ctx, rng, W, H, T, encProps) {
  const m = genEmpty(ctx, W, H, T);
  const rows = H;
  const cols = W;
  const cy = (rows / 2) | 0;

  const roadTile = (T.ROAD != null ? T.ROAD : T.FLOOR);

  // Draw a 3-tile-wide horizontal road across the map
  for (let y = cy - 1; y <= cy + 1; y++) {
    if (y <= 0 || y >= rows - 1) continue;
    for (let x = 1; x < cols - 1; x++) {
      m[y][x] = roadTile;
    }
  }

  // Scatter a few decorative rocks/trees near edges to frame the road a bit
  for (let i = 0; i < 10; i++) {
    const x = 2 + (rng() * (cols - 4)) | 0;
    const y = 2 + (rng() * (rows - 4)) | 0;
    if (Math.abs(y - cy) <= 1) continue; // keep road clear
    if (m[y][x] !== T.FLOOR) continue;
    if (rng() < 0.5) {
      m[y][x] = T.WALL;
    }
  }

  // Helper to check a free tile for props
  const used = new Set(encProps.map(p => `${p.x},${p.y}`));
  function canPlace(x, y) {
    if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1) return false;
    if (m[y][x] !== T.FLOOR && m[y][x] !== roadTile) return false;
    if (x === (cols / 2 | 0) && y === cy) return false;
    const k = `${x},${y}`;
    if (used.has(k)) return false;
    return true;
  }

  const cx = (cols / 2) | 0;

  // Props near road center: caravan chest spot and a couple of barrels/crates
  const chestSpot = { x: cx, y: cy };
  if (canPlace(chestSpot.x, chestSpot.y)) {
    encProps.push({ x: chestSpot.x, y: chestSpot.y, type: "caravan_chest" });
    used.add(`${chestSpot.x},${chestSpot.y}`);
  }

  const sideSpots = [
    { x: cx - 2, y: cy - 1 },
    { x: cx - 1, y: cy + 1 },
    { x: cx + 1, y: cy - 1 },
    { x: cx + 2, y: cy + 1 },
  ];
  for (const s of sideSpots) {
    if (!canPlace(s.x, s.y)) continue;
    const kind = rng() < 0.5 ? "barrel" : "crate";
    encProps.push({ x: s.x, y: s.y, type: kind });
    used.add(`${s.x},${s.y}`);
  }

  return m;
}

export function genAmbushForest(ctx, rng, W, H, T) {
  const m = genEmpty(ctx, W, H, T);
  const clusters = Math.max(3, Math.floor((W * H) / 80));
  for (let i = 0; i < clusters; i++) {
    const cx = 2 + Math.floor((rng() * (W - 4)));
    const cy = 2 + Math.floor((rng() * (H - 4)));
    const r = 1 + Math.floor(rng() * 2); // radius 1..2
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
        if ((dx*dx + dy*dy) <= (r*r) && rng() < 0.85) m[y][x] = T.WALL; // tree clump
      }
    }
  }
  // Clear a circle around center so player has breathing room
  const px = (W / 2) | 0, py = (H / 2) | 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = px + dx, y = py + dy;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.FLOOR;
    }
  }
  return m;
}

export function genCamp(ctx, rng, W, H, T, hutCenters, hutDoors, encProps) {
  const m = genEmpty(ctx, W, H, T);
  // Place 2–4 small huts (3x3 walls with one door)
  const huts = 2 + Math.floor(rng() * 3);
  const taken = [];
  for (let i = 0; i < huts; i++) {
    let tries = 0;
    while (tries++ < 80) {
      const x0 = 2 + Math.floor(rng() * (W - 5));
      const y0 = 2 + Math.floor(rng() * (H - 5));
      // avoid overlapping centers
      if (taken.some(t => Math.abs(t.x - x0) < 4 && Math.abs(t.y - y0) < 4)) continue;
      taken.push({ x: x0, y: y0 });
      // hut perimeter
      for (let x = x0; x < x0 + 3; x++) { m[y0][x] = T.WALL; m[y0 + 2][x] = T.WALL; }
      for (let y = y0; y < y0 + 3; y++) { m[y][x0] = T.WALL; m[y][x0 + 2] = T.WALL; }
      // carve a random door and record its outward direction
      const side = Math.floor(rng() * 4);
      if (side === 0) { m[y0][x0 + 1] = T.DOOR; hutDoors.push({ x: x0 + 1, y: y0, dx: 0, dy: -1 }); }
      else if (side === 1) { m[y0 + 2][x0 + 1] = T.DOOR; hutDoors.push({ x: x0 + 1, y: y0 + 2, dx: 0, dy: 1 }); }
      else if (side === 2) { m[y0 + 1][x0] = T.DOOR; hutDoors.push({ x: x0, y: y0 + 1, dx: -1, dy: 0 }); }
      else { m[y0 + 1][x0 + 2] = T.DOOR; hutDoors.push({ x: x0 + 2, y: y0 + 1, dx: 1, dy: 0 }); }
      // record hut center for chest placement
      hutCenters.push({ x: x0 + 1, y: y0 + 1 });
      break;
    }
  }
  // Add a central clearing
  const px = (W / 2) | 0, py = (H / 2) | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m[py + dy][px + dx] = T.FLOOR;

  // Helper: check free floor and not colliding with existing props
  const propUsed = () => new Set(encProps.map(p => `${p.x},${p.y}`));
  function canPlace(x, y) {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    if (m[y][x] !== T.FLOOR) return false;
    const k = `${x},${y}`;
    if (propUsed().has(k)) return false;
    return true;
  }

  // Add 2 decorative campfires near center and benches around them
  const fireCandidates = [
    { x: px + 2, y: py }, { x: px - 2, y: py },
    { x: px, y: py + 2 }, { x: px, y: py - 2 }
  ];
  let fires = 0;
  for (const f of fireCandidates) {
    if (fires >= 2) break;
    if (canPlace(f.x, f.y)) {
      encProps.push({ x: f.x, y: f.y, type: "campfire" });
      fires++;
      const benchCandidates = [
        { x: f.x + 1, y: f.y }, { x: f.x - 1, y: f.y },
        { x: f.x, y: f.y + 1 }, { x: f.x, y: f.y - 1 }
      ];
      let benches = 0;
      for (const b of benchCandidates) {
        if (benches >= 2) break;
        if (canPlace(b.x, b.y)) {
          encProps.push({ x: b.x, y: b.y, type: "bench" });
          benches++;
        }
      }
    }
  }

  // Add crates/barrels just outside hut doors
  for (const d of hutDoors) {
    const ox = d.x + d.dx, oy = d.y + d.dy;
    const side1 = { x: d.x + d.dy, y: d.y - d.dx };
    const side2 = { x: d.x - d.dy, y: d.y + d.dx };
    const choices = [ { x: ox, y: oy }, side1, side2 ];
    for (const c of choices) {
      if (canPlace(c.x, c.y)) {
        const kind = (rng() < 0.5) ? "crate" : "barrel";
        encProps.push({ x: c.x, y: c.y, type: kind });
        break;
      }
    }
  }

  return m;
}

export function genRuins(ctx, rng, W, H, T) {
  const m = genEmpty(ctx, W, H, T);
  // Scatter short wall segments
  const segs = Math.max(4, Math.floor((W + H) / 6));
  for (let i = 0; i < segs; i++) {
    const len = 2 + Math.floor(rng() * 5);
    const x0 = 2 + Math.floor(rng() * (W - 4));
    const y0 = 2 + Math.floor(rng() * (H - 4));
    const horiz = rng() < 0.5;
    for (let k = 0; k < len; k++) {
      const x = x0 + (horiz ? k : 0);
      const y = y0 + (horiz ? 0 : k);
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.WALL;
    }
  }
  // Clear spawn pocket
  const px = (W / 2) | 0, py = (H / 2) | 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = px + dx, y = py + dy;
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) m[y][x] = T.FLOOR;
  }
  return m;
}

export function genArena(ctx, rng, W, H, T) {
  const m = genEmpty(ctx, W, H, T);
  // Plus-shaped barriers
  const cx = (W / 2) | 0, cy = (H / 2) | 0;
  for (let x = 2; x < W - 2; x++) { if (Math.abs(x - cx) > 1) m[cy][x] = T.WALL; }
  for (let y = 2; y < H - 2; y++) { if (Math.abs(y - cy) > 1) m[y][cx] = T.WALL; }
  // Open few gaps
  m[cy][2 + Math.floor(rng() * Math.max(1, cx - 3))] = T.DOOR;
  m[cy][(W - 3) - Math.floor(rng() * Math.max(1, cx - 3))] = T.DOOR;
  m[2 + Math.floor(rng() * Math.max(1, cy - 3))][cx] = T.DOOR;
  m[(H - 3) - Math.floor(rng() * Math.max(1, cy - 3))][cx] = T.DOOR;
  return m;
}