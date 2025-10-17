/**
 * EncounterService: rolls for random encounters while moving in the overworld,
 * selects a data-driven template, and prompts the player to enter.
 *
 * Exports (ESM + window.EncounterService):
 * - maybeTryEncounter(ctx): call after a successful world step; may open a confirm UI.
 */
const STATE = {
  lastWorldX: null,
  lastWorldY: null,
  cooldownMoves: 0,
  movesSinceLast: 0,
};

function biomeFromTile(tile) {
  try {
    const W = (typeof window !== "undefined" ? window.World : null);
    if (W && typeof W.biomeName === "function") {
      // Return canonical uppercase id when possible
      const name = W.biomeName(tile) || "";
      const m = {
        "Forest": "FOREST", "Plains": "GRASS", "Ocean/Lake": "WATER",
        "River": "RIVER", "Beach": "BEACH", "Swamp": "SWAMP",
        "Mountain": "MOUNTAIN", "Desert": "DESERT", "Snow": "SNOW",
        "Town": "TOWN", "Dungeon": "DUNGEON"
      };
      return m[name] || name.toUpperCase();
    }
  } catch (_) {}
  return "UNKNOWN";
}

function pickTemplate(ctx, biome) {
  const GD = (typeof window !== "undefined" ? window.GameData : null);
  const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : null;
  const rng = (ctx && typeof ctx.rng === "function") ? ctx.rng : (Math.random);
  const fallback = [
    { id: "ambush_forest", name: "Forest Ambush", baseWeight: 1.0, allowedBiomes: ["FOREST","GRASS"], map: { generator: "ambush_forest", w: 24, h: 16 }, groups: [ { type: "bandit", count: { min: 2, max: 4 } } ] },
    { id: "bandit_camp", name: "Bandit Camp", baseWeight: 0.8, allowedBiomes: ["GRASS","DESERT","BEACH"], map: { generator: "camp", w: 26, h: 18 }, groups: [ { type: "bandit", count: { min: 3, max: 6 } } ] },
  ];
  const list = reg || fallback;
  const candidates = list.filter(t => {
    if (!Array.isArray(t.allowedBiomes) || t.allowedBiomes.length === 0) return true;
    return t.allowedBiomes.includes(biome);
  });
  if (!candidates.length) return null;
  // Weighted pick (baseWeight only for MVP)
  let sum = 0;
  for (const t of candidates) { sum += (typeof t.baseWeight === "number" ? t.baseWeight : 1); }
  let r = rng() * sum;
  for (const t of candidates) {
    const w = (typeof t.baseWeight === "number" ? t.baseWeight : 1);
    if (r < w) return t;
    r -= w;
  }
  return candidates[0];
}

export function maybeTryEncounter(ctx) {
  try {
    if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;

    const wx = ctx.player.x | 0, wy = ctx.player.y | 0;
    const moved = (STATE.lastWorldX !== wx) || (STATE.lastWorldY !== wy);
    STATE.lastWorldX = wx; STATE.lastWorldY = wy;
    if (!moved) return false; // only roll on movement steps

    // Simple cooldown to avoid back-to-back prompts
    if (STATE.cooldownMoves > 0) {
      STATE.cooldownMoves -= 1;
      STATE.movesSinceLast += 1;
      return false;
    }

    const tile = ctx.world.map[wy][wx];
    const biome = biomeFromTile(tile);

    // Base chance and pity: start low; increase slowly the longer without an encounter
    const baseP = 0.03; // 3%
    const pityBoost = Math.max(0, Math.floor((STATE.movesSinceLast - 18) / 8)) * 0.006; // +0.6% per 8 moves after ~18
    const chance = Math.min(0.18, baseP + pityBoost);

    const roll = (typeof ctx.rng === "function") ? ctx.rng() : Math.random();
    if (roll >= chance) {
      STATE.movesSinceLast += 1;
      return false;
    }

    // Select a suitable template for this biome
    const tmpl = pickTemplate(ctx, biome);
    if (!tmpl) { STATE.movesSinceLast += 1; return false; }

    const text = `${tmpl.name || "Encounter"}: ${biome.toLowerCase()} — Enter?`;
    const enter = () => {
      try {
        // Prefer orchestrator helper to sync mutated ctx back into game state
        if (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.enterEncounter === "function") {
          const ok = !!window.GameAPI.enterEncounter(tmpl, biome);
          if (ok) {
            STATE.movesSinceLast = 0;
            STATE.cooldownMoves = 10;
            return true;
          }
        }
        // Fallback: direct runtime call (may not sync UI state perfectly)
        const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
        if (ER && typeof ER.enter === "function") {
          ER.enter(ctx, { template: tmpl, biome });
          STATE.movesSinceLast = 0;
          STATE.cooldownMoves = 10;
          return true;
        }
      } catch (_) {}
      return false;
    };
    const cancel = () => {
      try { ctx.log && ctx.log("You avoid the danger.", "info"); } catch (_) {}
      STATE.movesSinceLast += 1;
    };

    // Prompt the user
    const UI = ctx.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
    if (UI && typeof UI.showConfirm === "function") {
      UI.showConfirm(ctx, text, null, () => enter(), () => cancel());
    } else {
      // Fallback: inline confirm
      if (typeof window !== "undefined" && window.confirm && window.confirm(text)) enter();
      else cancel();
    }
    return true;
  } catch (_) {
    // Best-effort only
    return false;
  }
}

// Back-compat
if (typeof window !== "undefined") {
  window.EncounterService = { maybeTryEncounter };
}