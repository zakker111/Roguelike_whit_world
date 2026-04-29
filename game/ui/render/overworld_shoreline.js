/**
 * Overworld shoreline banding and foam at the top edge.
 */
import { shade as _shade, rgba as _rgba } from "../color_utils.js";
import { getTileDef } from "../../data/tile_lookup.js";
import * as World from "../../world/world.js";

export function drawShoreline(ctx, view) {
  const { ctx2d, TILE, map, startX, startY, endX, endY, tileOffsetX, tileOffsetY, cam } = Object.assign({}, view, ctx);
  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    if (startY < 0) {
      function h1(n) {
        let x = (n | 0) * 374761393;
        x = (x ^ (x >>> 13)) | 0;
        x = Math.imul(x, 1274126177) | 0;
        x = (x ^ (x >>> 16)) >>> 0;
        return (x % 1000003) / 1000003;
      }
      const waterDef = getTileDef("overworld", WT.WATER);
      const beachDef = getTileDef("overworld", WT.BEACH);
      const waterFill = (waterDef && waterDef.colors && waterDef.colors.fill) ? waterDef.colors.fill : "#0e2f4a";
      const beachFill = (beachDef && beachDef.colors && beachDef.colors.fill) ? beachDef.colors.fill : "#b59b6a";

      const minBand = 2, maxBand = 6;
      for (let x = startX; x <= endX; x++) {
        const r = h1(x * 9176 + 13);
        const bandH = minBand + ((r * (maxBand - minBand + 1)) | 0);
        for (let y = -bandH; y < 0; y++) {
          if (y < startY) continue;
          const sx = (x - startX) * TILE - tileOffsetX;
          const sy = (y - startY) * TILE - tileOffsetY;
          ctx2d.fillStyle = waterFill;
          ctx2d.fillRect(sx, sy, TILE, TILE);

          const wave = ((x + y) & 1) === 0;
          if (wave) {
            ctx2d.save();
            ctx2d.globalAlpha = 0.10;
            const waveColor = _shade(waterFill, 0.82);
            ctx2d.fillStyle = waveColor || "#103a57";
            ctx2d.fillRect(sx, sy + (Math.max(2, TILE * 0.4) | 0), TILE, 2);
            ctx2d.restore();
          }
        }

        if (-1 >= startY) {
          const sx = (x - startX) * TILE - tileOffsetX;
          const sy = (-1 - startY) * TILE - tileOffsetY;
          const fr = h1((x * 31) ^ 0x9e3779);
          const fo = 2 + ((fr * (TILE - 6)) | 0);
          ctx2d.save();
          ctx2d.globalAlpha = 0.22;
          const foamColor = _shade(waterFill, 1.6);
          ctx2d.fillStyle = foamColor || "rgba(255,255,255,0.85)";
          ctx2d.fillRect(sx + 2, sy + (TILE - 3), TILE - 4, 2);
          ctx2d.globalAlpha = 0.15;
          ctx2d.fillRect(sx + fo, sy + (TILE - 5), Math.max(2, (TILE * 0.25) | 0), 2);
          ctx2d.restore();
        }

        if (0 >= startY && 0 < mapRows) {
          const sx0 = (x - startX) * TILE - tileOffsetX;
          const sy0 = (0 - startY) * TILE - tileOffsetY;
          ctx2d.save();
          ctx2d.globalAlpha = 0.10;
          ctx2d.fillStyle = beachFill;
          ctx2d.fillRect(sx0, sy0, TILE, Math.max(2, (TILE * 0.35) | 0));
          ctx2d.restore();
        }
      }

      ctx2d.save();
      const fadeRows = 2;
      for (let yy = Math.max(startY, -maxBand - fadeRows); yy < -maxBand + 1; yy++) {
        const alpha = Math.max(0, Math.min(0.25, 0.15 + (yy + maxBand) * 0.06));
        if (alpha <= 0) continue;
        for (let xx = startX; xx <= endX; xx++) {
          const sx = (xx - startX) * TILE - tileOffsetX;
          const sy = (yy - startY) * TILE - tileOffsetY;
          const waterShade = _shade(waterFill, 0.85);
          ctx2d.fillStyle = _rgba(waterShade, alpha);
          ctx2d.fillRect(sx, sy, TILE, TILE);
        }
      }
      ctx2d.restore();
    }
  } catch (_) {}
}