/**
 * World movement (Phase 3 extraction): tryMovePlayerWorld.
 */
import { getMod } from "../../utils/access.js";
import { ensureInBounds as ensureInBoundsExt } from "./expand.js";

export function tryMovePlayerWorld(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.map) return false;

  // Compute intended target
  let nx = ctx.player.x + (dx | 0);
  let ny = ctx.player.y + (dy | 0);

  // Ensure expand-shift is enabled during normal movement (may have been suspended during transitions)
  if (ctx._suspendExpandShift) ctx._suspendExpandShift = false;

  // Top-edge water band: treat any attempt to move above row 0 as blocked (like water), do not expand upward
  if (ny &lt; 0) {
    return false;
  }

  // Expand if outside (only for infinite worlds)
  try {
    if (ctx.world &amp;&amp; ctx.world.type === "infinite" &amp;&amp; ctx.world.gen &amp;&amp; typeof ctx.world.gen.tileAt === "function") {
      const expanded = ensureInBoundsExt(ctx, nx, ny, 32);
      if (expanded) {
        // Player may have been shifted by left/top prepends; recompute target
        nx = ctx.player.x + (dx | 0);
        ny = ctx.player.y + (dy | 0);
      }
    }
  } catch (_) {}

  const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  if (nx &lt; 0 || ny &lt; 0 || nx &gt;= cols || ny &gt;= rows) return false;

  // Convert target to absolute world coordinates
  const ox = (ctx.world.originX | 0) || 0;
  const oy = (ctx.world.originY | 0) || 0;
  const wx = ox + (nx | 0);
  const wy = oy + (ny | 0);

  // If the target tile has a travelling caravan, block movement and offer an ambush option.
  try {
    const caravans = Array.isArray(ctx.world.caravans) ? ctx.world.caravans : [];
    if (caravans.length) {
      const cv = caravans.find(c =&gt; c &amp;&amp; (c.x | 0) === wx &amp;&amp; (c.y | 0) === wy);
      if (cv) {
        // Show confirmation to attack; caravans are not walkable.
        const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
        const prompt = "Do you want to attack this caravan?";
        const onOk = () =&gt; { try { startCaravanAmbushEncounterWorld(ctx, cv); } catch (_) {}; };
        const onCancel = () =&gt; {
          try { ctx.log &amp;&amp; ctx.log("You decide to leave the caravan alone.", "info"); } catch (_) {}
        };
        if (UIO &amp;&amp; typeof UIO.showConfirm === "function") {
          UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
        } else {
          onOk();
        }
        // Do not move onto the caravan tile
        return true;
      }
    }
  } catch (_) {}

  let walkable = true;
  try {
    // Prefer World.isWalkable for compatibility with tiles.json overrides
    const W = (ctx &amp;&amp; ctx.World) || (typeof window !== "undefined" ? window.World : null);
    if (W &amp;&amp; typeof W.isWalkable === "function") {
      walkable = !!W.isWalkable(ctx.map[ny][nx]);
    } else if (ctx.world &amp;&amp; ctx.world.gen &amp;&amp; typeof ctx.world.gen.isWalkable === "function") {
      walkable = !!ctx.world.gen.isWalkable(ctx.map[ny][nx]);
    }
  } catch (_) {}

  if (!walkable) return false;

  ctx.player.x = nx; ctx.player.y = ny;

  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}

  // Non-combat skill hooks on overworld step
  try {
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    const WT = W ? W.TILES : null;
    const tileHere = ctx.world && ctx.world.map ? ctx.world.map[ny][nx] : null;
    const isWild = WT ? (tileHere === WT.FOREST || tileHere === WT.GRASS || tileHere === WT.BEACH || tileHere === WT.SWAMP) : true;

    // Survivalism: gradual progress when traversing wild tiles
    if (isWild) {
      try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.survivalism = (ctx.player.skills.survivalism || 0) + 0.2; } catch (_) {}
    }

    // Foraging via region map berry bushes only (overworld walking no longer grants berries)
  } catch (_) {}

  // Quest markers: if standing on an active marker, show a hint; starting the quest now requires pressing G
  try {
    const markers = Array.isArray(ctx.world?.questMarkers) ? ctx.world.questMarkers : [];
    if (markers.length) {
      const rx = ((ctx.world?.originX | 0) + (ctx.player.x | 0)) | 0;
      const ry = ((ctx.world?.originY | 0) + (ctx.player.y | 0)) | 0;
      const here = markers.find(m => m && (m.x | 0) === rx && (m.y | 0) === ry);
      if (here) {
        try { ctx.log && ctx.log("Quest location: Press G to start the encounter.", "notice"); } catch (_) {}
      }
    }
  } catch (_) {}

  // Encounter roll before advancing time (modules may switch mode)
  try {
    const ES = ctx.EncounterService || (typeof window !== "undefined" ? window.EncounterService : null);
    if (ES && typeof ES.maybeTryEncounter === "function") {
      ES.maybeTryEncounter(ctx);
    }
  } catch (_) {}
  try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
  return true;
}

/**
 * Start a special caravan ambush encounter when the player bumps into a caravan on the overworld.
 */
function startCaravanAmbushEncounterWorld(ctx, caravan) {
  try {
    // Close any confirm dialog before switching modes
    try {
      const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.cancelConfirm === "function") UIO.cancelConfirm(ctx);
    } catch (_) {}

    // Mark the caravan as ambushed so it no longer moves or spawns merchants.
    try {
      if (caravan) {
        caravan.atTown = false;
        caravan.dwellUntil = 0;
        caravan.ambushed = true;
      }
    } catch (_) {}

    const template = {
      id: "caravan_ambush",
      name: "Caravan Ambush",
      map: { w: 26, h: 16, generator: "caravan_road" },
      groups: [
        { faction: "guard", count: { min: 2, max: 3 } },
        { faction: "guard", count: { min: 1, max: 2 } }
      ],
      objective: { type: "reachExit" }
    };

    const biome = "GRASS";
    const ok = (typeof ctx.enterEncounter === "function")
      ? !!ctx.enterEncounter(template, biome)
      : false;

    if (!ok && ctx.log) {
      ctx.log("Failed to start caravan ambush encounter.", "warn");
    } else if (ok && ctx.log) {
      ctx.log("You ambush the caravan on the road!", "notice");
    }
  } catch (_) {}
}