/**
 * RenderRegion: draws the Region Map using the standard tile viewport (camera-centred on player).
 *
 * Exports (ESM + window.RenderRegion):
 * - draw(ctx, view)
 */
import * as RenderCore from "./render_core.js";
import { attachGlobal } from "../utils/global.js";

// Modularized helpers
import { drawRegionBase } from "./render/region_base_layer.js";
import { drawRegionGlyphOverlay } from "./render/region_glyph_overlay.js";
import { drawRegionFog } from "./render/region_fog.js";
import { drawRegionExitOverlay } from "./render/region_exit_overlay.js";
import { drawRegionBloodDecals } from "./render/region_blood_decals.js";
import { drawRegionEntities } from "./render/region_entities_overlay.js";
import { drawRegionCorpses } from "./render/region_corpses.js";
import { drawRegionPlayer } from "./render/region_player.js";
import { drawRegionHUD } from "./render/region_hud.js";
import { drawRegionTints } from "./render/region_tints.js";
// Reuse overworld weather overlays (fog/rain/cloudy) for region map as well.
import { drawWeather } from "./render/overworld_weather.js";

export function draw(ctx, view) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return;

  // Base layer
  try { drawRegionBase(ctx, view); } catch (_) {}

  // Glyph overlay
  try { drawRegionGlyphOverlay(ctx, view); } catch (_) {}

  // Fog
  try { drawRegionFog(ctx, view); } catch (_) {}

  // Exit/edge overlay
  try { drawRegionExitOverlay(ctx, view); } catch (_) {}

  // Blood decals
  try { drawRegionBloodDecals(ctx, view); } catch (_) {}

  // Entities overlay
  try { drawRegionEntities(ctx, view); } catch (_) {}

  // Corpses
  try { drawRegionCorpses(ctx, view); } catch (_) {}

  // Player marker
  try { drawRegionPlayer(ctx, view); } catch (_) {}

  // HUD
  try { drawRegionHUD(ctx, view); } catch (_) {}

  // Weather overlays (fog/rain/cloudy) on top of region + player, before global tints
  try { drawWeather(ctx, view); } catch (_) {}

  // Day/night tint
  try { drawRegionTints(ctx, view); } catch (_) {}

  // Grid overlay
  RenderCore.drawGridOverlay(view);
}

attachGlobal("RenderRegion", { draw });

attachGlobal("RenderRegion", { draw });