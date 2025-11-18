/**
 * Overworld base layer: offscreen world cache and fallback viewport base draw.
 */
import * as RenderCore from "../render_core.js";
import { fillOverworldFor, tilesRef, fallbackFillOverworld } from "./overworld_tile_cache.js";
import { getTileDef } from "../../data/tile_lookup.js";
import * as World from "../../world/world.js";

// World base layer offscreen cache (full map at TILE resolution)
const WORLD = { mapRef: null, canvas: null, wpx: 0, hpx: 0, TILE: 0, _tilesRef: null };

export function drawWorldBase(ctx, view) {
  const {
    ctx2d, TILE, map, TS, tilesetReady,
    cam, tileOffsetX, tileOffsetY, startX, startY, endX, endY
  } = Object.assign({}, view, ctx);

  const WT = World.TILES;
  const mapRows = map.length;
  const mapCols = map[0] ? map[0].length : 0;

  try {
    const mw = mapCols, mh = mapRows;
    if (mw && mh) {
      const wpx = mw * TILE;
      const hpx = mh * TILE;
      const needsWorldRebuild = (!WORLD.canvas) || WORLD.mapRef !== map || WORLD.wpx !== wpx || WORLD.hpx !== hpx || WORLD.TILE !== TILE || WORLD._tilesRef !== tilesRef();
      if (needsWorldRebuild) {
        WORLD.mapRef = map;
        WORLD.wpx = wpx;
        WORLD.hpx = hpx;
        WORLD.TILE = TILE;
        WORLD._tilesRef = tilesRef();
        const off = RenderCore.createOffscreen(wpx, hpx);
        const oc = off.getContext("2d");
        try {
          oc.font = "bold 20px JetBrains Mono, monospace";
          oc.textAlign = "center";
          oc.textBaseline = "middle";
        } catch (_) {}
        let missingDefsCount = 0;
        const missingSet = new Set();
        for (let yy = 0; yy < mh; yy++) {
          const rowM = map[yy];
          for (let xx = 0; xx < mw; xx++) {
            const t = rowM[xx];
            const td = getTileDef("overworld", t);
            if (!td && tilesRef()) { missingDefsCount++; missingSet.add(t); }
            const c = fillOverworldFor(WT, t);
            oc.fillStyle = c;
            oc.fillRect(xx * TILE, yy * TILE, TILE, TILE);
          }
        }
        try {
          if (missingDefsCount > 0 && tilesRef() && typeof window !== "undefined" && (window.DEV || (typeof localStorage !== "undefined" && localStorage.getItem("DEV") === "1"))) {
            const LG = (typeof window !== "undefined" ? window.Logger : null);
            const msg = `[RenderOverworld] Missing ${missingDefsCount} tile def lookups; ids without defs: ${Array.from(missingSet).join(", ")}. Using fallback colors.`;
            if (LG && typeof LG.log === "function") LG.log(msg, "warn");
            else console.warn(msg);
          }
        } catch (_) {}
        WORLD.canvas = off;
      }
    }
  } catch (_) {}

  let blitted = false;
  if (WORLD.canvas) {
    try {
      blitted = !!RenderCore.blitViewport(ctx2d, WORLD.canvas, cam, WORLD.wpx, WORLD.hpx);
    } catch (_) { blitted = false; }
  }
  if (!blitted) {
    for (let y = startY; y <= endY; y++) {
      const yIn = y >= 0 && y < mapRows;
      const row = yIn ? map[y] : null;
      for (let x = startX; x <= endX; x++) {
        const screenX = (x - startX) * TILE - tileOffsetX;
        const screenY = (y - startY) * TILE - tileOffsetY;
        if (!yIn || x < 0 || x >= mapCols) {
          // canvas background color tile
          try {
            const waterDef = getTileDef("overworld", WT.WATER);
            const bg = (waterDef && waterDef.colors && waterDef.colors.fill) ? waterDef.colors.fill : fallbackFillOverworld(WT, WT.WATER);
            const bgShade = bg || "#0b0c10";
            // Use a dark neutral for off-map to match original
            (function(){})();
          } catch (_) {}
          ctx2d.fillStyle = "#0b0c10";
          ctx2d.fillRect(screenX, screenY, TILE, TILE);
          continue;
        }
        const t = row[x];
        const fill = fillOverworldFor(WT, t);
        ctx2d.fillStyle = fill;
        ctx2d.fillRect(screenX, screenY, TILE, TILE);
      }
    }
  }

  try {
    if (typeof window !== "undefined" && window.TilesValidation && typeof window.TilesValidation.recordMap === "function") {
      window.TilesValidation.recordMap({ mode: "overworld", map });
    }
  } catch (_) {}
}