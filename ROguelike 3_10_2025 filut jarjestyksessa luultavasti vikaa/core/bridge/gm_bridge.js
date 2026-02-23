/**
 * GMBridge: central wrapper for GMRuntime-driven side effects.
 *
 * Exports (ESM + window.GMBridge):
 * - maybeHandleWorldStep(ctx): boolean
 * - handleMarkerAction(ctx): boolean
 */

import { getMod } from "../../utils/access.js";
import { attachGlobal } from "../../utils/global.js";

export function maybeHandleWorldStep(ctx) {
  if (!ctx) return false;

  try {
    const GM = getMod(ctx, "GMRuntime");
    if (!GM || typeof GM.getFactionTravelEvent !== "function") return false;

    const intent = GM.getFactionTravelEvent(ctx) || { kind: "none" };
    if (!intent || intent.kind === "none") return false;

    if (intent.kind === "guard_fine") {
      return handleGuardFineTravelEvent(ctx, GM);
    }

    if (intent.kind === "encounter") {
      const encId = intent.encounterId || intent.id || null;
      if (!encId) return false;
      return startGmFactionEncounter(ctx, encId);
    }

    // Unknown intent kinds are ignored for forward compatibility.
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

export function handleMarkerAction(ctx) {
  if (!ctx) return false;

  try {
    const MS = getMod(ctx, "MarkerService");
    if (!MS || typeof MS.findAtPlayer !== "function") return false;

    const at = MS.findAtPlayer(ctx);
    const markers = Array.isArray(at) ? at : (at ? [at] : []);

    // We only handle gm.* markers here. Quest markers are handled by QuestService.
    const gmMarker = markers.find((m) => m && typeof m.kind === "string" && m.kind.startsWith("gm.")) || null;
    if (!gmMarker) return false;

    // Stub for now: consume the input so Region Map doesn't open when standing on a GM marker.
    try {
      if (typeof ctx.log === "function") {
        const k = String(gmMarker.kind || "gm.?");
        ctx.log(`[GM] Marker '${k}' action not implemented yet.`, "notice");
      }
    } catch (_) {}

    return true;
  } catch (_) {
    return false;
  }
}

function handleGuardFineTravelEvent(ctx, GM) {
  if (!ctx || !ctx.player) return false;

  try {
    const MZ = getMod(ctx, "Messages");
    const UIO = getMod(ctx, "UIOrchestration");

    if (!GM || typeof GM.onEvent !== "function") return false;

    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    let goldObj = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
    if (!goldObj) {
      goldObj = { kind: "gold", amount: 0, name: "gold" };
      inv.push(goldObj);
    }

    const currentGold = (typeof goldObj.amount === "number" ? goldObj.amount : 0) | 0;

    const level = (typeof ctx.player.level === "number" ? (ctx.player.level | 0) : 1);
    let fine = level * 10;
    if (fine < 30) fine = 30;
    if (fine > 300) fine = 300;

    if (currentGold < fine) {
      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.noMoney", null, "warn");
        } else if (typeof ctx.log === "function") {
          ctx.log("A patrol of guards demands a fine you cannot afford. They let you go with a warning this time.", "warn");
        }
      } catch (_) {}

      try {
        GM.onEvent(ctx, { type: "gm.guardFine.refuse" });
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
      prompt = `A patrol of guards demands a fine of ${fine} gold for your crimes.\nPay?`;
    }

    const onPay = () => {
      try {
        let next = currentGold - fine;
        if (next < 0) next = 0;
        goldObj.amount = next;
      } catch (_) {}

      try {
        GM.onEvent(ctx, { type: "gm.guardFine.pay" });
      } catch (_) {}

      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.paid", { amount: fine }, "good");
        } else if (typeof ctx.log === "function") {
          ctx.log(`You pay ${fine} gold to settle your fines with the guards.`, "info");
        }
      } catch (_) {}

      try {
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}
    };

    const onRefuse = () => {
      try {
        GM.onEvent(ctx, { type: "gm.guardFine.refuse" });
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
      onPay();
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

  const idRaw = encounterId != null ? String(encounterId) : "";
  const id = idRaw.trim();
  if (!id) return false;

  let tmpl = null;
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : [];
    const key = id.toLowerCase();
    tmpl = reg.find(t => t && String(t.id || "").toLowerCase() === key) || null;
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
    const W = getMod(ctx, "World");
    const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
    const y = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
    const x = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
    const tile = wmap && wmap[y] ? wmap[y][x] : null;
    if (W && typeof W.biomeName === "function") {
      const name = W.biomeName(tile) || "";
      if (name) biome = String(name).toUpperCase();
    }
  } catch (_) {}

  let difficulty = 1;
  try {
    const ES = getMod(ctx, "EncounterService");
    if (ES && typeof ES.computeDifficulty === "function") {
      difficulty = ES.computeDifficulty(ctx, biome);
    }
  } catch (_) {}
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) difficulty = 1;
  if (difficulty < 1) difficulty = 1;
  if (difficulty > 5) difficulty = 5;

  let ok = false;

  try {
    const GA = getMod(ctx, "GameAPI");
    if (GA && typeof GA.enterEncounter === "function") {
      ok = !!GA.enterEncounter(tmpl, biome, difficulty);
    }
  } catch (_) {}

  if (!ok) {
    try {
      const ER = getMod(ctx, "EncounterRuntime");
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

attachGlobal("GMBridge", { maybeHandleWorldStep, handleMarkerAction });
