import { getMod } from "../../../utils/access.js";
import { isGmEnabled } from "./shared.js";
import { handleBottleMapMarker } from "./bottle_map.js";
import { handleSurveyCacheMarker } from "./survey_cache.js";

function findGmMarkerAtPlayer(ctx) {
  if (!ctx || !ctx.world || !ctx.player) return null;

  const ox = (ctx.world && typeof ctx.world.originX === "number") ? (ctx.world.originX | 0) : 0;
  const oy = (ctx.world && typeof ctx.world.originY === "number") ? (ctx.world.originY | 0) : 0;
  const absX = (ox + (ctx.player.x | 0)) | 0;
  const absY = (oy + (ctx.player.y | 0)) | 0;

  let markers = [];

  // Prefer MarkerService (dedup + canonical behavior), but tolerate missing/late modules.
  try {
    const MS = getMod(ctx, "MarkerService");
    if (MS && typeof MS.findAt === "function") {
      const at = MS.findAt(ctx, absX, absY);
      markers = Array.isArray(at) ? at : (at ? [at] : []);
    }
  } catch (_) {}

  if (!markers.length) {
    try {
      const arr = Array.isArray(ctx.world.questMarkers) ? ctx.world.questMarkers : [];
      markers = arr.filter(m => m && (m.x | 0) === absX && (m.y | 0) === absY);
    } catch (_) {
      markers = [];
    }
  }

  return markers.find((m) => m && typeof m.kind === "string" && m.kind.startsWith("gm.")) || null;
}

export function handleMarkerAction(ctx) {
  if (!ctx) return false;

  const gmMarker = findGmMarkerAtPlayer(ctx);
  if (!gmMarker) return false;

  // Even when GM is disabled, consume input on gm.* markers so we don't fall
  // through to other world actions like opening the Region Map.
  if (!isGmEnabled(ctx)) {
    try {
      if (typeof ctx.log === "function") {
        ctx.log("[GM] GM is disabled; this marker cannot be used.", "warn");
      }
    } catch (_) {}
    return true;
  }

  try {
    const kind = String(gmMarker.kind || "");

    let ok = true;

    if (kind === "gm.bottleMap") {
      ok = !!handleBottleMapMarker(ctx, gmMarker);
    } else if (kind === "gm.surveyCache") {
      ok = !!handleSurveyCacheMarker(ctx, gmMarker);
    } else {
      // Unknown gm.* markers are consumed for forward compatibility.
      try {
        if (typeof ctx.log === "function") {
          const k = String(gmMarker.kind || "gm.?");
          ctx.log(`[GM] Marker '${k}' action not implemented yet.`, "notice");
        }
      } catch (_) {}
      ok = true;
    }

    if (!ok) {
      try {
        if (typeof ctx.log === "function") {
          ctx.log(`[GM] Failed to start marker action for '${kind}'.`, "warn");
        }
      } catch (_) {}
    }

    return true;
  } catch (_) {
    // Even if the handler crashes, consume the input so we don't open Region Map.
    return true;
  }
}
