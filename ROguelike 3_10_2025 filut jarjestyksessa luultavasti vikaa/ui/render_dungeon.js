/**
 * RenderDungeon: draws dungeon tiles, decals, corpses/chests, enemies, player.
 *
 * Exports (window.RenderDungeon):
 * - draw(ctx, view)
 */
(function () {
  function draw(ctx, view) {
    const {
      ctx2d, TILE, COLORS, TILES, TS, tilesetReady,
      map, seen, visible, player, enemies, corpses,
      cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
    } = Object.assign({}, view, ctx);

    // tiles within viewport range
    for (let y = startY; y <= endY; y++) {
      const rowMap = map[y];
      const rowSeen = seen[y] || [];
      const rowVis = visible[y] || [];
      for (let x = startX; x <= endX; x++) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        const vis = !!rowVis[x];
        const everSeen = !!rowSeen[x];

        if (!everSeen) {
          ctx2d.fillStyle = COLORS.wallDark;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
          continue;
        }

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

        if (!vis && everSeen) {
          ctx2d.fillStyle = COLORS.dim;
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
        }

        if (vis && type === TILES.STAIRS && !tilesetReady) {
          RenderCore.drawGlyph(ctx2d, screenX, screenY, ">", "#d7ba7d", TILE);
        }
      }
    }

    // decals (e.g., blood stains)
    if (ctx.decals && ctx.decals.length) {
      ctx2d.save();
      for (let i = 0; i < ctx.decals.length; i++) {
        const d = ctx.decals[i];
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
      if (!everSeen) continue;
      const screenX = (c.x - startX) * TILE - tileOffsetX;
      const screenY = (c.y - startY) * TILE - tileOffsetY;

      const drawCorpseOrChest = () => {
        if (tilesetReady && TS.draw(ctx2d, c.kind === "chest" ? "chest" : "corpse", screenX, screenY, TILE)) {
          return;
        }
        if (c.kind === "chest") {
          RenderCore.drawGlyph(ctx2d, screenX, screenY, "▯", c.looted ? "#8b7355" : "#d7ba7d", TILE);
        } else if (c.kind === "crate") {
          RenderCore.drawGlyph(ctx2d, screenX, screenY, "▢", "#b59b6a", TILE);
        } else if (c.kind === "barrel") {
          RenderCore.drawGlyph(ctx2d, screenX, screenY, "◍", "#a07c4b", TILE);
        } else {
          RenderCore.drawGlyph(ctx2d, screenX, screenY, "%", c.looted ? COLORS.corpseEmpty : COLORS.corpse, TILE);
        }
      };

      if (visNow) {
        drawCorpseOrChest();
      } else {
        ctx2d.save();
        ctx2d.globalAlpha = 0.55;
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
        RenderCore.drawGlyph(ctx2d, screenX, screenY, e.glyph || "e", RenderCore.enemyColor(ctx, e.type, COLORS), TILE);
      }
    }

    // player
    if (player.x >= startX && player.x <= endX && player.y >= startY && player.y <= endY) {
      const screenX = (player.x - startX) * TILE - tileOffsetX;
      const screenY = (player.y - startY) * TILE - tileOffsetY;
      if (!(tilesetReady && TS.draw(ctx2d, "player", screenX, screenY, TILE))) {
        RenderCore.drawGlyph(ctx2d, screenX, screenY, "@", COLORS.player, TILE);
      }
    }
  }

  window.RenderDungeon = { draw };
})();