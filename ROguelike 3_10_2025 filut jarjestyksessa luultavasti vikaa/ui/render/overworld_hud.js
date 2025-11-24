/**
 * Overworld HUD: biome label + clock.
 */
export function drawBiomeClockLabel(ctx, view) {
  if (typeof window !== "undefined" && window.SHOW_OVERWORLD_HUD === false) return;
  const { ctx2d, TILE, map, player, cam } = Object.assign({}, view, ctx);
  try {
    let labelWidth = 260;
    let biomeName = "";
    try {
      const World = (typeof window !== "undefined" ? window.World : null);
      if (World && typeof World.biomeName === "function") {
        const tile = map[player.y] && map[player.y][player.x];
        biomeName = World.biomeName(tile);
      }
    } catch (_) {}
    const time = ctx.time || null;
    const clock = time ? time.hhmm : null;
    const weather = ctx.weather || null;
    const weatherLabel = weather && weather.label ? String(weather.label) : null;

    const parts = [];
    parts.push(`Biome: ${biomeName}`);
    if (clock) parts.push(`Time: ${clock}`);
    if (weatherLabel) parts.push(`Weather: ${weatherLabel}`);

    const text = parts.join("   |   ");
    labelWidth = Math.max(260, 16 * (text.length / 2));
    const bx = 8, by = 8, bh = 26, bw = labelWidth;
    ctx2d.save();
    let panelBg = "rgba(13,16,24,0.80)";
    let panelBorder = "rgba(122,162,247,0.35)";
    try {
      const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
      if (pal) {
        panelBg = pal.panelBg || panelBg;
        panelBorder = pal.panelBorder || panelBorder;
      }
    } catch (_) {}
    ctx2d.fillStyle = panelBg;
    try {
      const r = 6;
      ctx2d.beginPath();
      ctx2d.moveTo(bx + r, by);
      ctx2d.lineTo(bx + bw - r, by);
      ctx2d.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
      ctx2d.lineTo(bx + bw, by + bh - r);
      ctx2d.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
      ctx2d.lineTo(bx + r, by + bh);
      ctx2d.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
      ctx2d.lineTo(bx, by + r);
      ctx2d.quadraticCurveTo(bx, by, bx + r, by);
      ctx2d.closePath();
      ctx2d.fill();
      ctx2d.strokeStyle = panelBorder;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    } catch (_) {
      ctx2d.fillRect(bx, by, bw, bh);
      ctx2d.strokeStyle = panelBorder;
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
    ctx2d.fillStyle = "#e5e7eb";
    ctx2d.textAlign = "left";
    ctx2d.fillText(text, bx + 10, by + 13);
    ctx2d.restore();
  } catch (_) {}
}