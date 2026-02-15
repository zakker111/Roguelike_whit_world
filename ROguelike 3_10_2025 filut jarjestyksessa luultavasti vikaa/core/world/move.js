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
  if (ny < 0) {
    return false;
  }

  // Expand if outside (only for infinite worlds)
  try {
    if (ctx.world && ctx.world.type === "infinite" && ctx.world.gen && typeof ctx.world.gen.tileAt === "function") {
      const expanded = ensureInBoundsExt(ctx, nx, ny, 32);
      if (expanded) {
        // Player may have been shifted by left/top prepends; recompute target
        nx = ctx.player.x + (dx | 0);
        ny = ctx.player.y + (dy | 0);
      }
    }
  } catch (_) {}

  const rows = ctx.map.length, cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;

  // Convert target to absolute world coordinates
  const ox = (ctx.world.originX | 0) || 0;
  const oy = (ctx.world.originY | 0) || 0;
  const wx = ox + (nx | 0);
  const wy = oy + (ny | 0);

  // If the target tile has a travelling caravan (not one parked in a town), block movement
  // and offer an ambush/encounter option. Caravans that are currently atTown are considered
  // "inside" the settlement and should not block or prompt on the overworld tile.
  try {
    const caravans = Array.isArray(ctx.world.caravans) ? ctx.world.caravans : [];
    if (caravans.length) {
      const cv = caravans.find(c => c && !c.atTown && (c.x | 0) === wx && (c.y | 0) === wy);
      if (cv) {
        const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
        const prompt = "Do you want to encounter this caravan?";
        const onOk = () => { try { startCaravanAmbushEncounterWorld(ctx, cv); } catch (_) {} };
        const onCancel = () => {
          try { ctx.log && ctx.log("You decide to leave the caravan alone.", "info"); } catch (_) {}
        };
        if (UIO && typeof UIO.showConfirm === "function") {
          UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
        } else {
          onOk();
        }
        // Do not move onto the travelling caravan tile
        return true;
      }
    }
  } catch (_) {}

  let walkable = true;
  try {
    // Prefer World.isWalkable for compatibility with tiles.json overrides
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    if (W && typeof W.isWalkable === "function") {
      walkable = !!W.isWalkable(ctx.map[ny][nx]);
    } else if (ctx.world && ctx.world.gen && typeof ctx.world.gen.isWalkable === "function") {
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

  let gmHandled = false;
  try {
    gmHandled = maybeHandleGMFactionTravelEvent(ctx);
  } catch (_) {}

  // Encounter roll before advancing time (modules may switch mode)
  if (!gmHandled) {
    try {
      const ES = ctx.EncounterService || (typeof window !== "undefined" ? window.EncounterService : null);
      if (ES && typeof ES.maybeTryEncounter === "function") {
        ES.maybeTryEncounter(ctx);
      }
    } catch (_) {}
  }
  try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
  return true;
}

function maybeHandleGMFactionTravelEvent(ctx) {
  if (!ctx) return false;

  try {
    const GM = ctx.GMRuntime || (typeof window !== "undefined" ? window.GMRuntime : null);
    if (!GM || typeof GM.getFactionTravelEvent !== "function") return false;

    const intent = GM.getFactionTravelEvent(ctx) || { kind: "none" };
    if (!intent || intent.kind === "none") return false;

    if (intent.kind === "guard_fine") {
      return !!handleGuardFineTravelEvent(ctx);
    }

    if (intent.kind === "encounter" && typeof intent.encounterId === "string" && intent.encounterId) {
      return !!startGmFactionEncounter(ctx, intent.encounterId);
    }

    return false;
  } catch (_) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Failed to process faction travel event intent.", "warn");
      }
    } catch (_) {}
    return false;
  }
}

function handleGuardFineTravelEvent(ctx) {
  if (!ctx || !ctx.player) return false;

  try {
    const GM = ctx.GMRuntime || (typeof window !== "undefined" ? window.GMRuntime : null);
    const MZ = ctx.Messages || (typeof window !== "undefined" ? window.Messages : null);
    const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);

    const inv = Array.isArray(ctx.player?.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    let goldObj = inv.find(it => it && it.kind === "gold");
    if (!goldObj) {
      goldObj = { kind: "gold", amount: 0, name: "gold" };
      inv.push(goldObj);
    }
    const currentGold = (typeof goldObj.amount === "number" ? goldObj.amount : 0) | 0;

    const level = (typeof ctx.player.level === "number" ? (ctx.player.level | 0) : 1);
    let fine = 20 + level * 10;
    if (fine < 30) fine = 30;
    if (fine > 300) fine = 300;

    if (currentGold < fine) {
      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.noMoney", null, "warn");
        } else if (typeof ctx.log === "function") {
          ctx.log("A patrol of guards demands a fine you cannot afford. They will remember this.", "warn");
        }
      } catch (_) {}

      try {
        if (GM && typeof GM.onEvent === "function") {
          GM.onEvent(ctx, { type: "gm.guardFine.refuse", scope: ctx.mode || "world", interesting: true });
        }
      } catch (_) {}

      return true;
    }

    const vars = { amount: fine };
    let prompt = "";
    try {
      if (MZ && typeof MZ.get === "function") {
        prompt = MZ.get("gm.guardFine.prompt", vars) || "";
      }
    } catch (_) {}
    if (!prompt) {
      prompt = `A patrol of guards demands a fine of ${fine} gold for your crimes.\n\nPay the fine?`;
    }

    const onPay = () => {
      try {
        let next = currentGold - fine;
        if (next < 0) next = 0;
        goldObj.amount = next;
      } catch (_) {}

      try {
        if (GM && typeof GM.onEvent === "function") {
          GM.onEvent(ctx, { type: "gm.guardFine.pay", scope: ctx.mode || "world", interesting: true });
        }
      } catch (_) {}

      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.paid", { amount: fine }, "notice");
        } else if (typeof ctx.log === "function") {
          ctx.log(`You pay ${fine} gold to settle your fine with the guards.`, "notice");
        }
      } catch (_) {}

      try {
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}
    };

    const onRefuse = () => {
      try {
        if (GM && typeof GM.onEvent === "function") {
          GM.onEvent(ctx, { type: "gm.guardFine.refuse", scope: ctx.mode || "world", interesting: true });
        }
      } catch (_) {}

      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.refused", null, "warn");
        } else if (typeof ctx.log === "function") {
          ctx.log("You refuse to pay the fine. The guards will remember this.", "warn");
        }
      } catch (_) {}
    };

    if (UIO && typeof UIO.showConfirm === "function") {
      UIO.showConfirm(ctx, prompt, null, onPay, onRefuse);
    } else {
      onRefuse();
    }

    return true;
  } catch (_) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Error handling guard fine travel event.", "warn");
      }
    } catch (_) {}
    return false;
  }
}

function startGmFactionEncounter(ctx, encounterId) {
  if (!ctx) return false;

  const id = String(encounterId || "");
  if (!id) return false;

  let tmpl = null;
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : [];
    tmpl = reg.find(t => t && String(t.id) === id) || null;
  } catch (_) {}

  if (!tmpl) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log(`[GM] Faction encounter template '${id}' not found.`, "warn");
      }
    } catch (_) {}
    return false;
  }

  let biome = "GRASS";
  try {
    const W = (ctx && ctx.World) || (typeof window !== "undefined" ? window.World : null);
    const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
    const y = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
    const x = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
    const row = wmap && wmap[y] ? wmap[y] : null;
    const tile = row ? row[x] : null;
    if (W && typeof W.biomeName === "function") {
      const name = W.biomeName(tile) || "";
      if (name) biome = String(name).toUpperCase();
    }
  } catch (_) {}

  let difficulty = 1;
  try {
    const ES = ctx.EncounterService || (typeof window !== "undefined" ? window.EncounterService : null);
    if (ES && typeof ES.computeDifficulty === "function") {
      difficulty = ES.computeDifficulty(ctx, biome);
    }
  } catch (_) {}
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) difficulty = 1;
  difficulty = difficulty | 0;
  if (difficulty < 1) difficulty = 1;
  if (difficulty > 5) difficulty = 5;

  let ok = false;

  try {
    const GA = ctx.GameAPI || getMod(ctx, "GameAPI");
    if (GA && typeof GA.enterEncounter === "function") {
      ok = !!GA.enterEncounter(tmpl, biome, difficulty);
    }
  } catch (_) {}

  if (!ok) {
    try {
      const ER = ctx.EncounterRuntime || getMod(ctx, "EncounterRuntime");
      if (ER && typeof ER.enter === "function") {
        ok = !!ER.enter(ctx, { template: tmpl, biome, difficulty });
      }
    } catch (_) {}
  }

  if (!ok) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Failed to start faction encounter.", "warn");
      }
    } catch (_) {}
    return false;
  }

  try {
    if (ctx && typeof ctx.log === "function") {
      const name = tmpl && tmpl.name ? tmpl.name : id;
      ctx.log(`[GM] A special encounter begins: ${name}.`, "notice");
    }
  } catch (_) {}

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

    // Link this encounter to an escortable caravan so the player can choose to travel with it afterwards.
    try {
      const world = ctx.world;
      if (world && caravan && typeof caravan.id !== "undefined") {
        world.caravanEscort = world.caravanEscort || { id: null, reward: 0, active: false };
        world.caravanEscort.id = caravan.id;

        // If no reward has been set yet for this escort, derive a simple gold reward
        // from the remaining distance to the caravan's destination town.
        if (!world.caravanEscort.reward || world.caravanEscort.reward <= 0) {
          try {
            const cx = caravan.x | 0;
            const cy = caravan.y | 0;
            const tx = (caravan.dest && typeof caravan.dest.x === "number") ? (caravan.dest.x | 0) : cx;
            const ty = (caravan.dest && typeof caravan.dest.y === "number") ? (caravan.dest.y | 0) : cy;
            const dx = tx - cx;
            const dy = ty - cy;
            const dist = Math.max(4, Math.abs(dx) + Math.abs(dy));
            world.caravanEscort.reward = 10 + dist * 2;
          } catch (_) {}
        }
        // Do not set active yet; the Caravan master dialog inside the encounter decides
        // whether the player actually chooses to travel with this caravan.
      }
    } catch (_) {}

    const template = {
      id: "caravan_ambush",
      name: "Caravan Ambush",
      map: { w: 26, h: 16, generator: "caravan_road" },
      groups: [
        { faction: "guard", count: { min: 3, max: 4 }, type: "guard" },
        { faction: "guard", count: { min: 2, max: 3 }, type: "guard_elite" }
      ],
      objective: { type: "reachExit" },
      difficulty: 4
    };

    const biome = "GRASS";
    let ok = false;

    // Preferred path: GameAPI (same as EncounterService uses)
    try {
      const GA = ctx.GameAPI || getMod(ctx, "GameAPI");
      if (GA && typeof GA.enterEncounter === "function") {
        ok = !!GA.enterEncounter(template, biome, template.difficulty || 4);
      }
    } catch (_) {}

    // Fallback: direct EncounterRuntime entry
    if (!ok) {
      try {
        const ER = ctx.EncounterRuntime || getMod(ctx, "EncounterRuntime");
        if (ER && typeof ER.enter === "function") {
          ok = !!ER.enter(ctx, { template, biome, difficulty: template.difficulty || 4 });
        }
      } catch (_) {}
    }

    if (!ok && ctx.log) {
      ctx.log("Failed to start caravan ambush encounter.", "warn");
    } else if (ok && ctx.log) {
      ctx.log("You ambush the caravan on the road!", "notice");
    }
  } catch (_) {}
}
