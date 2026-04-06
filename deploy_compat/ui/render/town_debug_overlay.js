/**
 * Town Debug Overlay: highlights occupied buildings and labels them.
 */
export function drawTownDebugOverlay(ctx, view) {
  const { ctx2d, TILE, cam, shops, townBuildings } = Object.assign({}, view, ctx);
  if (!(typeof window !== "undefined" && window.DEBUG_TOWN_OVERLAY)) return;

  try {
    if (Array.isArray(townBuildings) && Array.isArray(ctx.npcs)) {
      const occ = new Set();
      for (const n of ctx.npcs) {
        if (n._home && n._home.building) occ.add(n._home.building);
      }
      ctx2d.save();
      let overlayFill = "rgba(255, 215, 0, 0.22)";
      let overlayStroke = "rgba(255, 215, 0, 0.9)";
      try {
        const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
        if (pal) {
          overlayFill = pal.debugOverlayFill || overlayFill;
          overlayStroke = pal.debugOverlayStroke || overlayStroke;
        }
      } catch (_) {}
      ctx2d.globalAlpha = 1.0;
      ctx2d.fillStyle = overlayFill;
      ctx2d.strokeStyle = overlayStroke;
      ctx2d.lineWidth = 2;

      function labelForBuilding(b) {
        if (ctx.tavern && ctx.tavern.building && b === ctx.tavern.building) return "Tavern";
        if (Array.isArray(shops)) {
          const shop = shops.find(s => s.building && s.building.x === b.x && s.building.y === b.y && s.building.w === b.w && s.building.h === b.h);
          if (shop && shop.name) return shop.name;
        }
        return "House";
      }

      for (const b of townBuildings) {
        if (!occ.has(b)) continue;
        const bx0 = (b.x - view.startX) * TILE - view.tileOffsetX;
        const by0 = (b.y - view.startY) * TILE - view.tileOffsetY;
        const bw = b.w * TILE;
        const bh = b.h * TILE;
        if (bx0 + bw < 0 || by0 + bh < 0 || bx0 > cam.width || by0 > cam.height) continue;
        ctx2d.fillRect(bx0, by0, bw, bh);
        ctx2d.strokeRect(bx0 + 1, by0 + 1, bw - 2, bh - 2);

        try {
          const cx = bx0 + bw / 2;
          const cy = by0 + bh / 2;
          const label = labelForBuilding(b);
          ctx2d.save();
          ctx2d.globalAlpha = 0.95;
          let labelBg = "rgba(13,16,24,0.65)";
          let labelStroke = "rgba(255, 215, 0, 0.85)";
          let labelText = "#ffd166";
          try {
            const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays) ? window.GameData.palette.overlays : null;
            if (pal) {
              labelBg = pal.debugLabelBg || labelBg;
              labelStroke = pal.debugLabelStroke || labelStroke;
              labelText = pal.debugLabelText || labelText;
            }
          } catch (_) {}
          ctx2d.fillStyle = labelBg;
          const padX = Math.max(6, Math.floor(TILE * 0.25));
          const padY = Math.max(4, Math.floor(TILE * 0.20));
          const textW = Math.max(32, label.length * (TILE * 0.35));
          const boxW = Math.min(bw - 8, textW + padX * 2);
          const boxH = Math.min(bh - 8, TILE * 0.8 + padY * 2);
          ctx2d.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
          ctx2d.strokeStyle = labelStroke;
          ctx2d.lineWidth = 1;
          ctx2d.strokeRect(cx - boxW / 2 + 0.5, cy - boxH / 2 + 0.5, boxW - 1, boxH - 1);
          ctx2d.fillStyle = labelText;
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
}