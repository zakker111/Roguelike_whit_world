/**
 * Render: draws tiles, corpses, enemies, and player with camera support.
 *
 * Exports (window.Render):
 * - draw(ctx): where ctx contains { ctx2d, TILE, ROWS, COLS, COLORS, TILES, map, seen, visible, player, enemies, corpses, camera? }
 *
 * Notes:
 * - Uses Tileset when available; falls back to colored rectangles and glyphs.
 */
(function () {
  function enemyColorFromModule(type, COLORS) {
    if (window.Enemies && typeof Enemies.colorFor === "function") {
      return Enemies.colorFor(type);
    }
    // fallback to generic enemy color
    return COLORS.enemy || "#f7768e";
  }

  function drawGlyphScreen(ctx2d, x, y, ch, color, TILE) {
    const half = TILE / 2;
    ctx2d.fillStyle = color;
    ctx2d.fillText(ch, x + half, y + half + 1);
  }

  function draw(ctx) {
    const {
      ctx2d, TILE, ROWS, COLS, COLORS, TILES,
      map, seen, visible, player, enemies, corpses, decals, camera: camMaybe, mode, world, npcs, shops
    } = ctx;

    const enemyColor = (t) => (ctx.enemyColor ? ctx.enemyColor(t) : enemyColorFromModule(t, COLORS));
    const TS = (ctx.Tileset || (typeof window !== "undefined" ? window.Tileset : null));
    const tilesetReady = !!(TS && typeof TS.isReady === "function" && TS.isReady());
    const drawGrid = (typeof window !== "undefined" && typeof window.DRAW_GRID === "boolean") ? window.DRAW_GRID : true;

    const cam = camMaybe || { x: 0, y: 0, width: COLS * TILE, height: ROWS * TILE };
    const tileOffsetX = cam.x % TILE;
    const tileOffsetY = cam.y % TILE;
    const startX = Math.max(0, Math.floor(cam.x / TILE));
    const startY = Math.max(0, Math.floor(cam.y / TILE));
    const mapRows = map.length;
    const mapCols = map[0] ? map[0].length : 0;
    const endX = Math.min(mapCols - 1, startX + COLS - 1);
    const endY = Math.min(mapRows - 1, startY + ROWS - 1);

    ctx2d.clearRect(0, 0, cam.width, cam.height);

    // Set text properties once per frame
    ctx2d.font = "bold 20px JetBrains Mono, monospace";
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";

    // WORLD MODE RENDER
    if (mode === "world") {
      // lightweight palette for overworld
      const WCOL = {
        water: "#0a1b2a",
        river: "#0e2f4a",
        grass: "#10331a",
        forest: "#0d2615",
        swamp: "#1b2a1e",
        beach: "#b59b6a",
        desert: "#c2a36b",
        snow: "#b9c7d3",
        mountain: "#2f2f34",
        town: "#3a2f1b",
        dungeon: "#2a1b2a",
      };

      if (drawGrid) {
        ctx2d.strokeStyle = "rgba(122,162,247,0.05)";
      }

      const WT = (typeof window !== "undefined" && window.World && World.TILES) ? World.TILES : null;

      for (let y = startY; y <= endY; y++) {
        const row = map[y];
        for (let x = startX; x <= endX; x++) {
          const screenX = (x - startX) * TILE - tileOffsetX;
          const screenY = (y - startY) * TILE - tileOffsetY;
          const t = row[x];
          let fill = WCOL.grass;
          if (WT) {
            if (t === WT.WATER) fill = WCOL.water;
            else if (t === WT.RIVER) fill = WCOL.river;
            else if (t === WT.SWAMP) fill = WCOL.swamp;
            else if (t === WT.BEACH) fill = WCOL.beach;
            else if (t === WT.DESERT) fill = WCOL.desert;
            else if (t === WT.SNOW) fill = WCOL.snow;
            else if (t === WT.GRASS) fill = WCOL.grass;
            else if (t === WT.FOREST) fill = WCOL.forest;
            else if (t === WT.MOUNTAIN) fill = WCOL.mountain;
            else if (t === WT.TOWN) fill = WCOL.town;
            else if (t === WT.DUNGEON) fill = WCOL.dungeon;
          }
          ctx2d.fillStyle = fill;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
          if (drawGrid) ctx2d.strokeRect(screenX, screenY, TILE, TILE);

          // Overlay glyphs for special overworld tiles
          if (WT && t === WT.TOWN) {
            // Use town size to vary glyph: small 't', big 'T', city 'C'
            let glyph = "T";
            try {
              if (world && Array.isArray(world.towns)) {
                const info = world.towns.find(tt => tt.x === x && tt.y === y);
                if (info && info.size) {
                  if (info.size === "small") glyph = "t";
                  else if (info.size === "city") glyph = "C";
                  else glyph = "T";
                }
              }
            } catch (_) {}
            drawGlyphScreen(ctx2d, screenX, screenY, glyph, "#d7ba7d", TILE);
          } else if (WT && t === WT.DUNGEON) {
            drawGlyphScreen(ctx2d, screenX, screenY, "D", "#c586c0", TILE);
          }
        }
      }

      // Biome label + clock
      try {
        let labelWidth = 260;
        let biomeName = "";
        if (WT && typeof World.biomeName === "function") {
          const tile = map[player.y] && map[player.y][player.x];
          biomeName = World.biomeName(tile);
        }
        const time = ctx.time || null;
        const clock = time ? time.hhmm : null;

        // background
        const text = `Biome: ${biomeName}${clock ? "   |   Time: " + clock : ""}`;
        labelWidth = Math.max(260, 16 * (text.length / 2));
        ctx2d.fillStyle = "rgba(13,16,24,0.8)";
        ctx2d.fillRect(8, 8, labelWidth, 26);
        ctx2d.fillStyle = "#e5e7eb";
        ctx2d.textAlign = "left";
        ctx2d.fillText(text, 18, 8 + 13);
        ctx2d.textAlign = "center";
      } catch (_) {}

      // Minimap (top-right)
      try {
        const mw = world && world.width ? world.width : (map[0] ? map[0].length : 0);
        const mh = world && world.height ? world.height : map.length;
        if (mw && mh) {
          const maxW = 200, maxH = 150;
          const scale = Math.max(1, Math.floor(Math.min(maxW / mw, maxH / mh)));
          const wpx = mw * scale, hpx = mh * scale;
          const pad = 8;
          const bx = cam.width - wpx - pad;
          const by = pad;

          // background
          ctx2d.fillStyle = "rgba(13,16,24,0.6)";
          ctx2d.fillRect(bx - 6, by - 6, wpx + 12, hpx + 12);

          // draw tiles
          for (let yy = 0; yy < mh; yy++) {
            const rowM = map[yy];
            for (let xx = 0; xx < mw; xx++) {
              const t = rowM[xx];
              let c = WCOL.grass;
              if (WT) {
                if (t === WT.WATER) c = WCOL.water;
                else if (t === WT.RIVER) c = WCOL.river;
                else if (t === WT.SWAMP) c = WCOL.swamp;
                else if (t === WT.BEACH) c = WCOL.beach;
                else if (t === WT.DESERT) c = WCOL.desert;
                else if (t === WT.SNOW) c = WCOL.snow;
                else if (t === WT.FOREST) c = WCOL.forest;
                else if (t === WT.MOUNTAIN) c = WCOL.mountain;
                else if (t === WT.DUNGEON) c = WCOL.dungeon;
                else if (t === WT.TOWN) c = WCOL.town;
              }
              ctx2d.fillStyle = c;
              ctx2d.fillRect(bx + xx * scale, by + yy * scale, scale, scale);
            }
          }

          // overlay towns and dungeons if available
          if (world && Array.isArray(world.towns)) {
            ctx2d.fillStyle = "#ffcc66";
            for (const t of world.towns) {
              ctx2d.fillRect(bx + t.x * scale, by + t.y * scale, Math.max(1, scale), Math.max(1, scale));
            }
          }
          if (world && Array.isArray(world.dungeons)) {
            ctx2d.fillStyle = "#c586c0";
            for (const d of world.dungeons) {
              ctx2d.fillRect(bx + d.x * scale, by + d.y * scale, Math.max(1, scale), Math.max(1, scale));
            }
          }

          // player marker
          ctx2d.fillStyle = "#ffffff";
          ctx2d.fillRect(bx + player.x * scale, by + player.y * scale, Math.max(1, scale), Math.max(1, scale));
        }
      } catch (_) {}

      // NPCs
      if (Array.isArray(npcs)) {
        for (const n of npcs) {
          if (n.x < startX || n.x > endX || n.y < startY || n.y > endY) continue;
          const screenX = (n.x - startX) * TILE - tileOffsetX;
          const screenY = (n.y - startY) * TILE - tileOffsetY;
          drawGlyphScreen(ctx2d, screenX, screenY, "n", "#b4f9f8", TILE);
        }
      }

      // player - add backdrop marker + outlined glyph to improve visibility on overworld tiles
      if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
        const screenX = (player.x - startX) * TILE - tileOffsetX;
        const screenY = (player.y - startY) * TILE - tileOffsetY;

        // subtle backdrop box + stroke
        ctx2d.save();
        ctx2d.fillStyle = "rgba(255,255,255,0.16)";
        ctx2d.fillRect(screenX + 4, screenY + 4, TILE - 8, TILE - 8);
        ctx2d.strokeStyle = "rgba(255,255,255,0.35)";
        ctx2d.lineWidth = 1;
        ctx2d.strokeRect(screenX + 4.5, screenY + 4.5, TILE - 9, TILE - 9);

        // outlined glyph
        const half = TILE / 2;
        ctx2d.lineWidth = 2;
        ctx2d.strokeStyle = "#0b0f16";
        ctx2d.strokeText("@", screenX + half, screenY + half + 1);
        ctx2d.fillStyle = COLORS.player || "#9ece6a";
        ctx2d.fillText("@", screenX + half, screenY + half + 1);
        ctx2d.restore();
      }

      // Day/night tint overlay
      try {
        const time = ctx.time;
        if (time && time.phase) {
          ctx2d.save();
          if (time.phase === "night") {
            ctx2d.fillStyle = "rgba(0,0,0,0.35)";
            ctx2d.fillRect(0, 0, cam.width, cam.height);
          } else if (time.phase === "dusk") {
            ctx2d.fillStyle = "rgba(255,120,40,0.12)";
            ctx2d.fillRect(0, 0, cam.width, cam.height);
          } else if (time.phase === "dawn") {
            ctx2d.fillStyle = "rgba(120,180,255,0.10)";
            ctx2d.fillRect(0, 0, cam.width, cam.height);
          }
          ctx2d.restore();
        }
      } catch (_) {}

      return;
    }

    // TOWN MODE RENDER
    if (mode === "town") {
      const TCOL = {
        wall: "#2f2b26",       // building
        window: "#295b6e",     // windows
        floor: "#0f1620",      // street/plaza
        door: "#6f5b3e",
        shop: "#d7ba7d",
      };
      if (drawGrid) ctx2d.strokeStyle = "rgba(122,162,247,0.05)";

      for (let y = startY; y <= endY; y++) {
        const rowMap = map[y];
        const rowSeen = seen[y] || [];
        const rowVis = visible[y] || [];
        for (let x = startX; x <= endX; x++) {
          const screenX = (x - startX) * TILE - tileOffsetX;
          const screenY = (y - startY) * TILE - tileOffsetY;
          const type = rowMap[x];
          const vis = !!rowVis[x];
          const everSeen = !!rowSeen[x];

          if (!everSeen) {
            // Unknown tiles: draw dark
            ctx2d.fillStyle = COLORS.wallDark;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
            if (drawGrid) ctx2d.strokeRect(screenX, screenY, TILE, TILE);
            continue;
          }

          // Draw base tile
          let fill = TCOL.floor;
          if (type === TILES.WALL) fill = TCOL.wall;
          else if (type === TILES.WINDOW) fill = TCOL.window;
          else if (type === TILES.DOOR) fill = TCOL.door;
          ctx2d.fillStyle = fill;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
          if (drawGrid) ctx2d.strokeRect(screenX, screenY, TILE, TILE);

          // If shop door, overlay glyph (T for Tavern, I for Inn, otherwise S) when visible
          if (vis && Array.isArray(shops)) {
            const s = shops.find(s => s.x === x && s.y === y);
            if (s) {
              const nm = (s.name || "").toLowerCase();
              const glyph = nm.includes("tavern") ? "T" : nm.includes("inn") ? "I" : "S";
              drawGlyphScreen(ctx2d, screenX, screenY, glyph, TCOL.shop, TILE);
            }
          }

          // If not currently visible, dim it
          if (!vis && everSeen) {
            ctx2d.fillStyle = COLORS.dim;
            ctx2d.fillRect(screenX, screenY, TILE, TILE);
          }
        }
      }

      // draw props (wells, benches, lamps, stalls, fountain, trees, interiors) only if visible
      if (Array.isArray(ctx.townProps)) {
        for (const p of ctx.townProps) {
          if (p.x < startX || p.x > endX || p.y < startY || p.y > endY) continue;
          if (!visible[p.y] || !visible[p.y][p.x]) continue;
          const screenX = (p.x - startX) * TILE - tileOffsetX;
          const screenY = (p.y - startY) * TILE - tileOffsetY;
          let glyph = "?";
          let color = "#e5e7eb";
          if (p.type === "well") { glyph = "O"; color = "#7aa2f7"; }
          else if (p.type === "fountain") { glyph = "◌"; color = "#89ddff"; }
          else if (p.type === "bench") { glyph = "≡"; color = "#d7ba7d"; }
          else if (p.type === "lamp") { glyph = "†"; color = "#ffd166"; }
          else if (p.type === "stall") { glyph = "s"; color = "#b4f9f8"; }
          else if (p.type === "tree") { glyph = "♣"; color = "#84cc16"; }
          else if (p.type === "fireplace") { glyph = "∩"; color = "#ff9966"; }
          else if (p.type === "table") { glyph = "┼"; color = "#d7ba7d"; }
          else if (p.type === "chair") { glyph = "π"; color = "#d7ba7d"; }
          else if (p.type === "bed") { glyph = "b"; color = "#a3be8c"; }
          else if (p.type === "chest") { glyph = "▯"; color = "#d7ba7d"; }
          else if (p.type === "crate") { glyph = "▢"; color = "#b59b6a"; }
          else if (p.type === "barrel") { glyph = "◍"; color = "#a07c4b"; }
          else if (p.type === "shelf") { glyph = "≋"; color = "#b4f9f8"; }
          else if (p.type === "plant") { glyph = "❀"; color = "#84cc16"; }
          else if (p.type === "rug") { glyph = "≈"; color = "#a3be8c"; }
          else if (p.type === "sign") { glyph = "∎"; color = "#ffd166"; }
          drawGlyphScreen(ctx2d, screenX, screenY, glyph, color, TILE);
        }
      }

      // draw NPCs only if visible
      if (Array.isArray(npcs)) {
        for (const n of npcs) {
          if (n.x < startX || n.x > endX || n.y < startY || n.y > endY) continue;
          if (!visible[n.y] || !visible[n.y][n.x]) continue;
          const screenX = (n.x - startX) * TILE - tileOffsetX;
          const screenY = (n.y - startY) * TILE - tileOffsetY;
          // Pets: cat 'c', dog 'd'; others 'n'
          let glyph = "n";
          if (n.isPet) {
            if (n.kind === "cat") glyph = "c";
            else if (n.kind === "dog") glyph = "d";
          }
          drawGlyphScreen(ctx2d, screenX, screenY, glyph, "#b4f9f8", TILE);

          // Sleeping indicator: animated z/Z above sleeping NPCs
          if (n._sleeping) {
            const t = Date.now();
            const phase = Math.floor(t / 600) % 2; // toggle every ~0.6s
            const zChar = phase ? "Z" : "z";
            // gentle bobbing
            const bob = Math.sin(t / 500) * 3;
            const zx = screenX + TILE / 2 + 8;          // slight right offset
            const zy = screenY + TILE / 2 - TILE * 0.6 + bob; // above head
            ctx2d.save();
            ctx2d.globalAlpha = 0.9;
            ctx2d.fillStyle = "#a3be8c";
            ctx2d.fillText(zChar, zx, zy);
            ctx2d.restore();
          }
        }
      }

      // Debug overlay: occupied houses and NPC target indicators
      if (typeof window !== "undefined" && window.DEBUG_TOWN_OVERLAY) {
        // Occupied houses: any building referenced by an npc _home
        try {
          if (Array.isArray(ctx.townBuildings) && Array.isArray(npcs)) {
            // precompute occupancy set of building ids (by reference)
            const occ = new Set();
            for (const n of npcs) {
              if (n._home && n._home.building) occ.add(n._home.building);
            }
            ctx2d.save();
            ctx2d.globalAlpha = 0.22;
            ctx2d.fillStyle = "rgba(255, 215, 0, 0.22)";
            ctx2d.strokeStyle = "rgba(255, 215, 0, 0.9)";
            ctx2d.lineWidth = 2;

            // Helper: label each building by type/name in its center
            function labelForBuilding(b) {
              // Tavern?
              if (ctx.tavern && ctx.tavern.building && b === ctx.tavern.building) {
                return "Tavern";
              }
              // Shop name if any shop maps to this building
              if (Array.isArray(shops)) {
                const shop = shops.find(s => s.building && s.building.x === b.x && s.building.y === b.y && s.building.w === b.w && s.building.h === b.h);
                if (shop && shop.name) return shop.name;
              }
              // Fallback
              return "House";
            }

            for (const b of ctx.townBuildings) {
              if (!occ.has(b)) continue;
              const bx0 = (b.x - startX) * TILE - tileOffsetX;
              const by0 = (b.y - startY) * TILE - tileOffsetY;
              const bw = b.w * TILE;
              const bh = b.h * TILE;
              // Only draw if intersects view
              if (bx0 + bw < 0 || by0 + bh < 0 || bx0 > cam.width || by0 > cam.height) continue;
              ctx2d.fillRect(bx0, by0, bw, bh);
              ctx2d.strokeRect(bx0 + 1, by0 + 1, bw - 2, bh - 2);

              // Label at center
              try {
                const cx = bx0 + bw / 2;
                const cy = by0 + bh / 2;
                const label = labelForBuilding(b);
                ctx2d.save();
                ctx2d.globalAlpha = 0.95;
                ctx2d.fillStyle = "rgba(13,16,24,0.65)";
                const padX = Math.max(6, Math.floor(TILE * 0.25));
                const padY = Math.max(4, Math.floor(TILE * 0.20));
                const textW = Math.max(32, label.length * (TILE * 0.35));
                const boxW = Math.min(bw - 8, textW + padX * 2);
                const boxH = Math.min(bh - 8, TILE * 0.8 + padY * 2);
                ctx2d.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
                ctx2d.strokeStyle = "rgba(255, 215, 0, 0.85)";
                ctx2d.lineWidth = 1;
                ctx2d.strokeRect(cx - boxW / 2 + 0.5, cy - boxH / 2 + 0.5, boxW - 1, boxH - 1);
                ctx2d.fillStyle = "#ffd166";
                // Slightly smaller font for labels to fit inside
                const prevFont = ctx2d.font;
                ctx2d.font = "bold 16px JetBrains Mono, monospace";
                ctx2d.textAlign = "center";
                ctx2d.textBaseline = "middle";
                ctx2d.fillText(label, cx, cy);
                ctx2d.font = prevFont;
                ctx2d.restore();
              } catch (_) {}
            }
            ctx2d.restore();
          }
        } catch (_) {}

        // NPC target indicators: red lines to current target
        try {
          function inWindow(start, end, m, dayMinutes) {
            return (end > start) ? (m >= start && m < end) : (m >= start || m < end);
          }
          function isOpenAt(shop, minutes, dayMinutes) {
            if (!shop) return false;
            if (shop.alwaysOpen) return true;
            if (typeof shop.openMin !== "number" || typeof shop.closeMin !== "number") return false;
            const o = shop.openMin, c = shop.closeMin;
            if (o === c) return false;
            return inWindow(o, c, minutes, dayMinutes);
          }
          const minutes = ctx.time ? (ctx.time.hours * 60 + ctx.time.minutes) : 12 * 60;
          ctx2d.save();
          ctx2d.strokeStyle = "rgba(255,0,0,0.85)";
          ctx2d.lineWidth = 2;
          for (const n of npcs) {
            let target = null;
            if (n.isShopkeeper) {
              const shop = n._shopRef || null;
              const o = shop ? shop.openMin : 8 * 60;
              const c = shop ? shop.closeMin : 18 * 60;
              const arriveStart = (o - 60 + 1440) % 1440;
              const leaveEnd = (c + 30) % 1440;
              const shouldBeAtWorkZone = inWindow(arriveStart, leaveEnd, minutes, 1440);
              const openNow = isOpenAt(shop, minutes, 1440);
              if (shouldBeAtWorkZone) {
                if (openNow && n._workInside && shop && shop.building) {
                  target = n._workInside;
                } else if (n._work) {
                  target = n._work;
                }
              } else if (n._home) {
                target = n._home.bed ? n._home.bed : { x: n._home.x, y: n._home.y };
              }
            } else if (n.isResident) {
              const phase = (ctx.time && ctx.time.phase) || "day";
              if (phase === "evening") {
                target = n._home ? (n._home.bed ? n._home.bed : { x: n._home.x, y: n._home.y }) : null;
              } else if (phase === "day") {
                target = n._work || (ctx.townPlaza ? { x: ctx.townPlaza.x, y: ctx.townPlaza.y } : null);
              } else if (phase === "morning") {
                target = n._home ? { x: n._home.x, y: n._home.y } : null;
              } else {
                target = n._home ? { x: n._home.x, y: n._home.y } : null;
              }
            } else {
              const phase = (ctx.time && ctx.time.phase) || "day";
              if (phase === "morning") target = n._home ? { x: n._home.x, y: n._home.y } : null;
              else if (phase === "day") target = (n._work || ctx.townPlaza);
              else target = (n._home ? { x: n._home.x, y: n._home.y } : null);
            }
            if (!target) continue;
            // draw line if both npc and target are within current map bounds
            const sx = (n.x - startX) * TILE - tileOffsetX + TILE / 2;
            const sy = (n.y - startY) * TILE - tileOffsetY + TILE / 2;
            const tx = (target.x - startX) * TILE - tileOffsetX + TILE / 2;
            const ty = (target.y - startY) * TILE - tileOffsetY + TILE / 2;
            // Clip to viewport roughly
            if ((sx < -TILE || sx > cam.width + TILE || sy < -TILE || sy > cam.height + TILE) &&
                (tx < -TILE || tx > cam.width + TILE || ty < -TILE || ty > cam.height + TILE)) continue;
            ctx2d.beginPath();
            ctx2d.moveTo(sx, sy);
            ctx2d.lineTo(tx, ty);
            ctx2d.stroke();
            // target marker
            ctx2d.fillStyle = "rgba(255,0,0,0.85)";
            ctx2d.beginPath();
            ctx2d.arc(tx, ty, Math.max(2, Math.floor(TILE * 0.15)), 0, Math.PI * 2);
            ctx2d.fill();
          }
          ctx2d.restore();
        } catch (_) {}
      }

      // Optional: draw planned paths for NPCs when debug paths enabled
      if (typeof window !== "undefined" && window.DEBUG_TOWN_PATHS && Array.isArray(npcs)) {
        try {
          ctx2d.save();
          ctx2d.strokeStyle = "rgba(0, 200, 255, 0.85)";
          ctx2d.lineWidth = 2;
          for (const n of npcs) {
            const path = n._debugPath || n._fullPlan;
            if (!path || path.length < 2) continue;
            ctx2d.beginPath();
            for (let i = 0; i < path.length; i++) {
              const p = path[i];
              const px = (p.x - startX) * TILE - tileOffsetX + TILE / 2;
              const py = (p.y - startY) * TILE - tileOffsetY + TILE / 2;
              if (i === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
            }
            ctx2d.stroke();
            // draw small nodes
            ctx2d.fillStyle = "rgba(0, 200, 255, 0.85)";
            for (const p of path) {
              const px = (p.x - startX) * TILE - tileOffsetX + TILE / 2;
              const py = (p.y - startY) * TILE - tileOffsetY + TILE / 2;
              ctx2d.beginPath();
              ctx2d.arc(px, py, Math.max(2, Math.floor(TILE * 0.12)), 0, Math.PI * 2);
              ctx2d.fill();
            }
          }
          ctx2d.restore();
        } catch (_) {}
      }

      // Optional: draw home paths when enabled (deep blue)
      if (typeof window !== "undefined" && window.DEBUG_TOWN_HOME_PATHS && Array.isArray(npcs)) {
        try {
          ctx2d.save();
          ctx2d.lineWidth = 2;
          for (let i = 0; i < npcs.length; i++) {
            const n = npcs[i];
            // Prefer actual movement plan if present; else fallback to visualization path
            const path = (n._homePlan && n._homePlan.length >= 2) ? n._homePlan : n._homeDebugPath;
            ctx2d.strokeStyle = "rgba(60, 120, 255, 0.95)";
            if (path && path.length >= 2) {
              // label NPC name near start of path
              const start = path[0];
              const sx = (start.x - startX) * TILE - tileOffsetX + TILE / 2;
              const sy = (start.y - startY) * TILE - tileOffsetY + TILE / 2;
              ctx2d.fillStyle = "rgba(60, 120, 255, 0.95)";
              if (typeof n.name === "string" && n.name) {
                ctx2d.fillText(n.name, sx + 12, sy + 4);
              }
              // main polyline
              ctx2d.beginPath();
              for (let j = 0; j < path.length; j++) {
                const p = path[j];
                const px = (p.x - startX) * TILE - tileOffsetX + TILE / 2;
                const py = (p.y - startY) * TILE - tileOffsetY + TILE / 2;
                if (j === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
              }
              ctx2d.stroke();
              // nodes
              ctx2d.fillStyle = "rgba(60, 120, 255, 0.95)";
              for (const p of path) {
                const px = (p.x - startX) * TILE - tileOffsetX + TILE / 2;
                const py = (p.y - startY) * TILE - tileOffsetY + TILE / 2;
                ctx2d.beginPath();
                ctx2d.arc(px, py, Math.max(2, Math.floor(TILE * 0.12)), 0, Math.PI * 2);
                ctx2d.fill();
              }
              // arrowhead at end toward home
              const end = path[path.length - 1];
              const prev = path[path.length - 2];
              const ex = (end.x - startX) * TILE - tileOffsetX + TILE / 2;
              const ey = (end.y - startY) * TILE - tileOffsetY + TILE / 2;
              const px2 = (prev.x - startX) * TILE - tileOffsetX + TILE / 2;
              const py2 = (prev.y - startY) * TILE - tileOffsetY + TILE / 2;
              const angle = Math.atan2(ey - py2, ex - px2);
              const ah = Math.max(6, Math.floor(TILE * 0.25));
              ctx2d.beginPath();
              ctx2d.moveTo(ex, ey);
              ctx2d.lineTo(ex - Math.cos(angle - Math.PI / 6) * ah, ey - Math.sin(angle - Math.PI / 6) * ah);
              ctx2d.moveTo(ex, ey);
              ctx2d.lineTo(ex - Math.cos(angle + Math.PI / 6) * ah, ey - Math.sin(angle + Math.PI / 6) * ah);
              ctx2d.stroke();
              // label 'H' at endpoint
              ctx2d.fillStyle = "rgba(60, 120, 255, 0.95)";
              ctx2d.fillText("H", ex + 10, ey - 10);
            } else {
              // No home path available: draw a small red '!' over NPC and name
              const sx2 = (n.x - startX) * TILE - tileOffsetX + TILE / 2;
              const sy2 = (n.y - startY) * TILE - tileOffsetY + TILE / 2;
              ctx2d.fillStyle = "rgba(255, 80, 80, 0.95)";
              ctx2d.fillText("!", sx2 + 10, sy2 - 10);
              if (typeof n.name === "string" && n.name) {
                ctx2d.fillText(n.name, sx2 + 12, sy2 + 4);
              }
            }
          }
          ctx2d.restore();
        } catch (_) {}
      }

      // Optional: draw current-destination route paths when enabled (blue)
      if (typeof window !== "undefined" && window.DEBUG_TOWN_ROUTE_PATHS && Array.isArray(npcs)) {
        try {
          ctx2d.save();
          ctx2d.lineWidth = 2;
          ctx2d.strokeStyle = "rgba(80, 140, 255, 0.9)";
          for (const n of npcs) {
            const path = n._routeDebugPath;
            if (!path || path.length < 2) continue;
            // main polyline
            ctx2d.beginPath();
            for (let j = 0; j < path.length; j++) {
              const p = path[j];
              const px = (p.x - startX) * TILE - tileOffsetX + TILE / 2;
              const py = (p.y - startY) * TILE - tileOffsetY + TILE / 2;
              if (j === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
            }
            ctx2d.stroke();
            // nodes
            ctx2d.fillStyle = "rgba(80, 140, 255, 0.9)";
            for (const p of path) {
              const px = (p.x - startX) * TILE - tileOffsetX + TILE / 2;
              const py = (p.y - startY) * TILE - tileOffsetY + TILE / 2;
              ctx2d.beginPath();
              ctx2d.arc(px, py, Math.max(2, Math.floor(TILE * 0.12)), 0, Math.PI * 2);
              ctx2d.fill();
            }
          }
          ctx2d.restore();
        } catch (_) {}
      }

      // Lamp light glow at night/dusk/dawn
      try {
        const time = ctx.time;
        if (time && (time.phase === "night" || time.phase === "dusk" || time.phase === "dawn")) {
          if (Array.isArray(ctx.townProps)) {
            ctx2d.save();
            ctx2d.globalCompositeOperation = "lighter";
            for (const p of ctx.townProps) {
              if (p.type !== "lamp") continue;
              const px = p.x, py = p.y;
              if (px < startX || px > endX || py < startY || py > endY) continue;
              if (!visible[py] || !visible[py][px]) continue;

              const cx = (px - startX) * TILE - tileOffsetX + TILE / 2;
              const cy = (py - startY) * TILE - tileOffsetY + TILE / 2;
              const r = TILE * 2.2;
              const grad = ctx2d.createRadialGradient(cx, cy, 4, cx, cy, r);
              grad.addColorStop(0, "rgba(255, 220, 120, 0.60)");
              grad.addColorStop(0.4, "rgba(255, 180, 80, 0.25)");
              grad.addColorStop(1, "rgba(255, 160, 40, 0.0)");
              ctx2d.fillStyle = grad;
              ctx2d.beginPath();
              ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
              ctx2d.fill();
            }
            ctx2d.restore();
          }
        }
      } catch (_) {}

      // draw gate 'G' at townExitAt (only if visible)
      if (ctx.townExitAt) {
        const gx = ctx.townExitAt.x, gy = ctx.townExitAt.y;
        if (gx >= startX && gx <= endX && gy >= startY && gy <= endY) {
          if (visible[gy] && visible[gy][gx]) {
            const screenX = (gx - startX) * TILE - tileOffsetX;
            const screenY = (gy - startY) * TILE - tileOffsetY;
            drawGlyphScreen(ctx2d, screenX, screenY, "G", "#9ece6a", TILE);
          }
        }
      }

      // player - add subtle backdrop + outlined glyph so it stands out in town view
      if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
        const screenX = (player.x - startX) * TILE - tileOffsetX;
        const screenY = (player.y - startY) * TILE - tileOffsetY;

        ctx2d.save();
        ctx2d.fillStyle = "rgba(255,255,255,0.16)";
        ctx2d.fillRect(screenX + 4, screenY + 4, TILE - 8, TILE - 8);
        ctx2d.strokeStyle = "rgba(255,255,255,0.35)";
        ctx2d.lineWidth = 1;
        ctx2d.strokeRect(screenX + 4.5, screenY + 4.5, TILE - 9, TILE - 9);

        // outlined glyph
        const half = TILE / 2;
        ctx2d.lineWidth = 2;
        ctx2d.strokeStyle = "#0b0f16";
        ctx2d.strokeText("@", screenX + half, screenY + half + 1);
        ctx2d.fillStyle = COLORS.player || "#9ece6a";
        ctx2d.fillText("@", screenX + half, screenY + half + 1);
        ctx2d.restore();
      }

      // Day/night tint overlay for town
      try {
        const time = ctx.time;
        if (time && time.phase) {
          ctx2d.save();
          if (time.phase === "night") {
            ctx2d.fillStyle = "rgba(0,0,0,0.35)";
            ctx2d.fillRect(0, 0, cam.width, cam.height);
          } else if (time.phase === "dusk") {
            ctx2d.fillStyle = "rgba(255,120,40,0.12)";
            ctx2d.fillRect(0, 0, cam.width, cam.height);
          } else if (time.phase === "dawn") {
            ctx2d.fillStyle = "rgba(120,180,255,0.10)";
            ctx2d.fillRect(0, 0, cam.width, cam.height);
          }
          ctx2d.restore();
        }
      } catch (_) {}

      return;
    }

    // DUNGEON RENDER (default)
    // tiles within viewport range
    if (drawGrid) {
      ctx2d.strokeStyle = "rgba(122,162,247,0.05)";
    }
    for (let y = startY; y <= endY; y++) {
      const rowMap = map[y];
      const rowSeen = seen[y] || [];
      const rowVis = visible[y] || [];
      for (let x = startX; x <= endX; x++) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        const vis = !!rowVis[x];
        const everSeen = !!rowSeen[x];

        // If tile has never been seen, render as unknown to avoid revealing layout
        if (!everSeen) {
          ctx2d.fillStyle = COLORS.wallDark;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
          if (drawGrid) ctx2d.strokeRect(screenX, screenY, TILE, TILE);
          continue;
        }

        // draw base tile via tileset if available, else by color
        const type = rowMap[x];
        let key = "floor";
        if (type === TILES.WALL) key = "wall";
        else if (type === TILES.STAIRS) key = "stairs";
        else if (type === TILES.DOOR) key = "door";
        else key = "floor";

        let drawn = false;
        if (tilesetReady && typeof TS.draw === "function") {
          drawn = TS.draw(ctx2d, key, screenX, screenY, TILE);
        }
        if (!drawn) {
          let fill;
          if (type === TILES.WALL) fill = vis ? COLORS.wall : COLORS.wallDark;
          else if (type === TILES.STAIRS) fill = vis ? "#3a2f1b" : "#241e14";
          else if (type === TILES.DOOR) fill = vis ? "#3a2f1b" : "#241e14";
          else fill = vis ? COLORS.floorLit : COLORS.floor;
          ctx2d.fillStyle = fill;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
        }

        if (drawGrid) {
          ctx2d.strokeRect(screenX, screenY, TILE, TILE);
        }

        if (!vis && everSeen) {
          ctx2d.fillStyle = COLORS.dim;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
        }

        if (vis && type === TILES.STAIRS && !tilesetReady) {
          drawGlyphScreen(ctx2d, screenX, screenY, ">", "#d7ba7d", TILE);
        }
      }
    }

    // decals (e.g., blood stains) - draw before corpses/enemies so they appear under them
    if (decals && decals.length) {
      ctx2d.save();
      for (let i = 0; i < decals.length; i++) {
        const d = decals[i];
        const inView = (x, y) => x >= startX && x <= endX && y >= startY && y <= endY;
        if (!inView(d.x, d.y)) continue;
        const sx = (d.x - startX) * TILE - tileOffsetX;
        const sy = (d.y - startY) * TILE - tileOffsetY;
        const everSeen = seen[d.y] && seen[d.y][d.x];
        if (!everSeen) continue;
        const alpha = Math.max(0, Math.min(1, d.a || 0.2));
        if (alpha <= 0) continue;

        let usedTile = false;
        if (tilesetReady && TS) {
          const variant = ((d.x + d.y) % 3) + 1;
          const key = `decal.blood${variant}`;
          if (typeof TS.drawAlpha === "function") {
            usedTile = TS.drawAlpha(ctx2d, key, sx, sy, TILE, alpha);
          } else if (typeof TS.draw === "function") {
            const prev = ctx2d.globalAlpha;
            ctx2d.globalAlpha = alpha;
            usedTile = TS.draw(ctx2d, key, sx, sy, TILE);
            ctx2d.globalAlpha = prev;
          }
        }
        if (!usedTile) {
          const prev = ctx2d.globalAlpha;
          ctx2d.globalAlpha = alpha;
          ctx2d.fillStyle = "#7a1717";
          const r = Math.max(4, Math.min(TILE - 2, d.r || Math.floor(TILE * 0.4)));
          const cx = sx + TILE / 2;
          const cy = sy + TILE / 2;
          ctx2d.beginPath();
          ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.globalAlpha = prev;
        }
      }
      ctx2d.restore();
    }

    // corpses and chests
    for (const c of corpses) {
      if (c.x < startX || c.x > endX || c.y < startY || c.y > endY) continue;
      const everSeen = !!(seen[c.y] && seen[c.y][c.x]);
      const visNow = !!(visible[c.y] && visible[c.y][c.x]);
      if (!everSeen) continue; // don't reveal unexplored tiles
      const screenX = (c.x - startX) * TILE - tileOffsetX;
      const screenY = (c.y - startY) * TILE - tileOffsetY;

      // Draw with dim alpha when tile is only seen (not currently visible)
      const drawCorpseOrChest = () => {
        if (tilesetReady && TS.draw(ctx2d, c.kind === "chest" ? "chest" : "corpse", screenX, screenY, TILE)) {
          return;
        }
        if (c.kind === "chest") {
          drawGlyphScreen(ctx2d, screenX, screenY, "▯", c.looted ? "#8b7355" : "#d7ba7d", TILE);
        } else if (c.kind === "crate") {
          drawGlyphScreen(ctx2d, screenX, screenY, "▢", "#b59b6a", TILE);
        } else if (c.kind === "barrel") {
          drawGlyphScreen(ctx2d, screenX, screenY, "◍", "#a07c4b", TILE);
        } else {
          drawGlyphScreen(ctx2d, screenX, screenY, "%", c.looted ? COLORS.corpseEmpty : COLORS.corpse, TILE);
        }
      };

      if (visNow) {
        drawCorpseOrChest();
      } else {
        ctx2d.save();
        ctx2d.globalAlpha = 0.55; // dim when out of FOV but previously seen
        drawCorpseOrChest();
        ctx2d.restore();
      }
    }

    // enemies
    for (const e of enemies) {
      if (!visible[e.y] || !visible[e.y][e.x]) continue;
      if (e.x < startX || e.x > endX || e.y < startY || e.y > endY) continue;
      const screenX = (e.x - startX) * TILE - tileOffsetX;
      const screenY = (e.y - startY) * TILE - tileOffsetY;
      const enemyKey = e.type ? `enemy.${e.type}` : null;
      if (enemyKey && tilesetReady && TS.draw(ctx2d, enemyKey, screenX, screenY, TILE)) {
        // drawn via tileset
      } else {
        drawGlyphScreen(ctx2d, screenX, screenY, e.glyph || "e", enemyColor(e.type), TILE);
      }
    }

    // player
    if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
      const screenX = (player.x - startX) * TILE - tileOffsetX;
      const screenY = (player.y - startY) * TILE - tileOffsetY;
      if (!(tilesetReady && TS.draw(ctx2d, "player", screenX, screenY, TILE))) {
        drawGlyphScreen(ctx2d, screenX, screenY, "@", COLORS.player, TILE);
      }
    }
  }

  window.Render = { draw };
})();