/**
 * Region HUD: title, hint, clock, animals status.
 */
export function drawRegionHUD(ctx, view) {
  const { ctx2d } = Object.assign({}, view, ctx);
  try {
    const prevAlign = ctx2d.textAlign;
    const prevBaseline = ctx2d.textBaseline;
    ctx2d.textAlign = "left";
    ctx2d.textBaseline = "top";

    const clock = ctx.time && ctx.time.hhmm ? `   |   Time: ${ctx.time.hhmm}` : "";
    const titleText = `Region Map${clock}`;
    const hintText = "Move with arrows. Press G on orange edge to return.";

    let animalsText = null;
    try {
      const pos = (ctx.region && ctx.region.enterWorldPos) ? ctx.region.enterWorldPos : null;
      let cleared = false;
      try {
        if (pos && typeof window !== "undefined" && window.RegionMapRuntime && typeof window.RegionMapRuntime.animalsClearedHere === "function") {
          cleared = !!window.RegionMapRuntime.animalsClearedHere(pos.x | 0, pos.y | 0);
        }
      } catch (_) {}
      if (cleared) animalsText = "Animals cleared here";
      else if (ctx.region && ctx.region._hasKnownAnimals) animalsText = "Animals known in this area";
    } catch (_) {}

    const bx = 8, by = 8;
    const titleLen = titleText.length | 0;
    const hintLen = hintText.length | 0;
    const baseW = Math.max(260, 16 * (Math.max(titleLen, hintLen) / 2));
    const bw = baseW | 0;
    const bh = animalsText ? 66 : 48;

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

    ctx2d.fillStyle = "#cbd5e1";
    ctx2d.fillText(titleText, bx + 10, by + 8);
    ctx2d.fillStyle = "#a1a1aa";
    ctx2d.fillText(hintText, bx + 10, by + 26);
    if (animalsText) {
      let clearedClr = "#86efac";
      let knownClr = "#f0abfc";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          clearedClr = pal.regionAnimalsCleared || clearedClr;
          knownClr = pal.regionAnimalsKnown || knownClr;
        }
      } catch (_) {}
      ctx2d.fillStyle = animalsText.toLowerCase().includes("cleared") ? clearedClr : knownClr;
      ctx2d.fillText(animalsText, bx + 10, by + 44);
    }
    ctx2d.textAlign = prevAlign;
    ctx2d.textBaseline = prevBaseline;
  } catch (_) {}
}