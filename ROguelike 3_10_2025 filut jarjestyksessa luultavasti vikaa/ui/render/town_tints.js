/**
 * Town day/night tint overlay.
 */
export function drawTownDayNightTint(ctx, view) {
  const { ctx2d, cam } = Object.assign({}, view, ctx);
  try {
    const time = ctx.time;
    if (time && time.phase) {
      let nightTint = "rgba(0,0,0,0.35)";
      let duskTint  = "rgba(255,120,40,0.12)";
      let dawnTint  = "rgba(120,180,255,0.10)";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          nightTint = pal.night || nightTint;
          duskTint  = pal.dusk  || duskTint;
          dawnTint  = pal.dawn  || dawnTint;
        }
      } catch (_) {}
      ctx2d.save();
      let a = 1.0;
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          if (time.phase === "night" && Number.isFinite(Number(pal.nightA))) a = Math.max(0, Math.min(1, Number(pal.nightA)));
          else if (time.phase === "dusk" && Number.isFinite(Number(pal.duskA))) a = Math.max(0, Math.min(1, Number(pal.duskA)));
          else if (time.phase === "dawn" && Number.isFinite(Number(pal.dawnA))) a = Math.max(0, Math.min(1, Number(pal.dawnA)));
        }
      } catch (_) {}
      ctx2d.globalAlpha = a;
      if (time.phase === "night") {
        ctx2d.fillStyle = nightTint;
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      } else if (time.phase === "dusk") {
        ctx2d.fillStyle = duskTint;
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      } else if (time.phase === "dawn") {
        ctx2d.fillStyle = dawnTint;
        ctx2d.fillRect(0, 0, cam.width, cam.height);
      }
      ctx2d.restore();
    }
  } catch (_) {}
}