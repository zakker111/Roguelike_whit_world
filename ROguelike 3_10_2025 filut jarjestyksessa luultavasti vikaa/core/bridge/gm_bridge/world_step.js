import { getMod } from "../../../utils/access.js";
import { isGmEnabled, applySyncAfterGmTransition, hasEncounterTemplate } from "./shared.js";
import { startGmFactionEncounter } from "../gm_bridge_effects.js";
import { reconcileMarkers } from "./bottle_map.js";

export function maybeHandleWorldStep(ctx) {
  if (!ctx) return false;

  // Travel events are overworld-only. Guard against accidental calls from other modes.
  if (typeof ctx.mode === "string" && ctx.mode !== "world") return false;

  // Respect gm.enabled: if GM is disabled, do not run any GM-driven world-step intents.
  if (!isGmEnabled(ctx)) return false;

  // Phase 7: keep Bottle Map marker/thread state consistent as you move.
  // This is a cheap integrity pass (no RNG consumption).
  try { reconcileMarkers(ctx); } catch (_) {}

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

      // No fallbacks: if the specific encounter template isn't loaded yet, defer cleanly.
      if (!hasEncounterTemplate(ctx, encId)) {
        try { if (typeof ctx.log === "function") ctx.log(`[GM] Travel encounter template '${String(encId)}' not ready yet; try again in a moment.`, "info"); } catch (_) {}
        return false;
      }

      const UIO = getMod(ctx, "UIOrchestration");
      if (!UIO || typeof UIO.showConfirm !== "function") {
        // Phase 5 direction: choices only. If we can't present a confirm UI, do not force-start.
        try { if (typeof ctx.log === "function") ctx.log("[GM] Travel encounter requires confirm UI; skipping.", "warn"); } catch (_) {}
        return false;
      }

      const MZ = ctx.Messages || getMod(ctx, "Messages");
      let prompt = "";
      try {
        if (MZ && typeof MZ.get === "function") {
          const k = encId === "gm_bandit_bounty" ? "gm.travel.banditBounty.prompt" : encId === "gm_troll_hunt" ? "gm.travel.trollHunt.prompt" : "";
          if (k) prompt = MZ.get(k, null) || "";
        }
      } catch (_) {}
      if (!prompt) {
        if (encId === "gm_bandit_bounty") prompt = "You spot signs of bandits nearby. Investigate?";
        else if (encId === "gm_troll_hunt") prompt = "You hear heavy tracks and guttural noises ahead. Hunt the troll?";
        else prompt = `A strange opportunity presents itself (${String(encId)}). Investigate?`;
      }

      // Phase 4 pacing: showing a choice prompt counts as an intervention.
      try {
        if (GM && typeof GM.recordIntervention === "function") {
          GM.recordIntervention(ctx, { kind: "confirm", channel: "factionTravel", id: String(encId) });
        }
      } catch (_) {}

      const onOk = () => {
        try {
          const started = !!startGmFactionEncounter(ctx, encId, { ctxFirst: true });
          if (started) applySyncAfterGmTransition(ctx);
        } catch (_) {}
      };

      const onCancel = () => {
        try { if (typeof ctx.log === "function") ctx.log("You decide not to get involved.", "info"); } catch (_) {}
      };

      UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      return true;
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

function handleGuardFineTravelEvent(ctx, GM) {
  if (!ctx || !ctx.player) return false;

  try {
    const MZ = getMod(ctx, "Messages");
    const UIO = getMod(ctx, "UIOrchestration");

    if (!GM || typeof GM.onEvent !== "function") return false;

    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    let goldObj = inv.find((it) => it && String(it.kind || it.type || "").toLowerCase() === "gold");
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

      try { GM.onEvent(ctx, { type: "gm.guardFine.refuse" }); } catch (_) {}
      return true;
    }

    const vars = { amount: fine };
    let prompt = "";
    try {
      if (MZ && typeof MZ.get === "function") {
        prompt = MZ.get("gm.guardFine.prompt", vars) || "";
      }
    } catch (_) {}
    if (!prompt) prompt = `A patrol of guards demands a fine of ${fine} gold for your crimes.\nPay?`;

    const onPay = () => {
      try { goldObj.amount = Math.max(0, currentGold - fine); } catch (_) {}
      try { GM.onEvent(ctx, { type: "gm.guardFine.pay" }); } catch (_) {}
      try {
        if (MZ && typeof MZ.log === "function") MZ.log(ctx, "gm.guardFine.paid", { amount: fine }, "good");
        else if (typeof ctx.log === "function") ctx.log(`You pay ${fine} gold to settle your fines with the guards.`, "info");
      } catch (_) {}
      try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
    };

    const onRefuse = () => {
      try { GM.onEvent(ctx, { type: "gm.guardFine.refuse" }); } catch (_) {}
      try {
        if (MZ && typeof MZ.log === "function") MZ.log(ctx, "gm.guardFine.refused", null, "warn");
        else if (typeof ctx.log === "function") ctx.log("You refuse to pay the fine. The guards will remember this.", "warn");
      } catch (_) {}
    };

    if (UIO && typeof UIO.showConfirm === "function") {
      // Phase 4 (v0.3 pacing): showing a choice prompt counts as an intervention.
      try {
        if (GM && typeof GM.recordIntervention === "function") {
          GM.recordIntervention(ctx, { kind: "confirm", channel: "factionTravel", id: "guardFine" });
        }
      } catch (_) {}

      UIO.showConfirm(ctx, prompt, null, onPay, onRefuse);
      return true;
    }

    // v0.3 direction: choices only (no forced outcomes).
    // If we cannot present a confirm UI, do not auto-pay or auto-refuse.
    try {
      if (typeof ctx.log === "function") {
        ctx.log("[GM] Guard fine requires confirm UI; skipping (no forced outcome).", "warn");
      }
    } catch (_) {}

    return false;
  } catch (_) {
    try { if (ctx && typeof ctx.log === "function") ctx.log("[GM] Error handling guard fine travel event.", "warn"); } catch (_) {}
    return false;
  }
}
