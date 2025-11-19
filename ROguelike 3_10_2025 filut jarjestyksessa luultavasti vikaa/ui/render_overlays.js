/**
 * RenderOverlays aggregator: re-exports split overlay modules.
 */
import { attachGlobal } from "../utils/global.js";

// Import split modules
import { drawTownDebugOverlay } from "./render/town_debug_overlay.js";
import { drawTownPaths } from "./render/town_paths.js";
import { drawTownHomePaths } from "./render/town_home_paths.js";
import { drawTownRoutePaths } from "./render/town_route_paths.js";
import { drawLampGlow } from "./render/lamp_glow.js";
import { drawDungeonGlow } from "./render/dungeon_glow.js";

// Re-exports
export {
  drawTownDebugOverlay,
  drawTownPaths,
  drawTownHomePaths,
  drawTownRoutePaths,
  drawLampGlow,
  drawDungeonGlow
};

// Back-compat: attach to window via helper
attachGlobal("RenderOverlays", {
  drawTownDebugOverlay,
  drawTownPaths,
  drawTownHomePaths,
  drawTownRoutePaths,
  drawLampGlow,
  drawDungeonGlow
});