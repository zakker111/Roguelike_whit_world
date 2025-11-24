/**
 * OverworldWeather: lightweight visual overlays for fog and rain.
 *
 * Reads ctx.weather = { type, label, intensity } from core/game.js.
 * Uses GameData.palette.overlays when available for colors.
 */
import { attachGlobal } from "../../utils/global.js";

export function drawWeather(ctx, view) {
  const { ctx2d, cam } = Object.assign({}, view, ctx);
  if (!ctx2d || !cam) return;
  const weather = ctx.weather || null;
  if (!weather || !weather.type || weather.type === "clear") return;

  let type = String(weather.type || "clear");
  const intensity = Math.max(0, Math.min(1, Number(weather.intensity || 0)));

  // Resolve palette-driven colors
  let fogColor = "rgba(148,163,184,0.28)";
  let rainLight = "rgba(148,163,184,0.35)";
  let rainHeavy = "rgba(75,85,99,0.55)";
  try {
    const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays)
      ? window.GameData.palette.overlays
      : null;
    if (pal) {
      fogColor = pal.weatherFog || fogColor;
      rainLight = pal.weatherRainLight || rainLight;
      rainHeavy = pal.weatherRainHeavy || rainHeavy;
    }
  } catch (_) {}

  if (type === "foggy") {
    // Soft full-screen fog overlay; strength scales with intensity.
    ctx2d.save();
    try {
      ctx2d.fillStyle = fogColor;
      ctx2d.globalAlpha = 0.4 * intensity;
      ctx2d.fillRect(0, 0, cam.width, cam.height);
    } catch (_) {}
    ctx2d.restore();
    return;
  }

  if (type === "light_rain" || type === "heavy_rain") {
    // Simple screen-space rain streaks; pattern derived from time + camera to keep cost low.
    const time = ctx.time || null;
    const tMinutes = time && typeof time.totalMinutes === "number" ? (time.totalMinutes | 0) : 0;
    const seed = (tMinutes * 97) | 0;
    const countBase = type === "heavy_rain" ? 90 : 45;
    const count = Math.max(10, (countBase * (0.4 + 0.6 * intensity)) | 0);
    const color = type === "heavy_rain" ? rainHeavy : rainLight;

    function h(i) {
      // cheap deterministic hash -> [0,1)
      const n = (seed ^ (i * 2654435761)) >>> 0;
      return (n % 1000) / 1000;
    }

    ctx2d.save();
    try {
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = type === "heavy_rain" ? 1.4 : 1.0;
      ctx2d.globalAlpha = type === "heavy_rain" ? 0.7 * intensity : 0.55 * intensity;
      const w = cam.width;
      const hgt = cam.height;
      const len = Math.max(16, Math.floor(hgt * 0.18));

      ctx2d.beginPath();
      for (let i = 0; i < count; i++) {
        const rx = h(i * 3) * (w + 80) - 40;
        const ry = h(i * 3 + 1) * (hgt + 80) - 40;
        const dx = len * 0.45;
        const dy = len;
        ctx2d.moveTo(rx, ry);
        ctx2d.lineTo(rx + dx, ry + dy);
      }
      ctx2d.stroke();
    } catch (_) {}
    ctx2d.restore();
  }
}

// Back-compat: attach to window
attachGlobal("OverworldWeather", { drawWeather });