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
  // Night raid gating
  nightRaidCooldownUntilTurn: 0,
};

// Read encounter rate from global/localStorage; 0..100, default 50
function getEncounterRate() {
  try {
    if (typeof window !== "undefined" && typeof window.ENCOUNTER_RATE === "number") {
      const v = Math.max(0, Math.min(100, Math.round(Number(window.ENCOUNTER_RATE) || 0)));
      return v;
    }
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem("ENCOUNTER_RATE");
      if (raw != null) {
        const v = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
        return v;
      }
    }
  } catch (_) {}
  const cfgDefault = (typeof window !== "undefined" && window.GameData && window.GameData.config && window.GameData.config.dev && typeof window.GameData.config.dev.encounterRateDefault === "number")
    ? Math.max(0, Math.min(100, Math.round(Number(window.GameData.config.dev.encounterRateDefault) || 0)))
    : 50;
  return cfgDefault;
}

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

function registry(ctx) {
  const GD = (typeof window !== "undefined" ? window.GameData : null);
  return GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : null;
}

function rngFor(ctx) {
  try {
    if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
      return window.RNGUtils.getRng((ctx && typeof ctx.rng === "function") ? ctx.rng : undefined);
    }
  } catch (_) {}
  return (ctx && typeof ctx.rng === "function")
    ? ctx.rng
    : ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") ? window.RNG.rng : Math.random);
}

let _loggedEncounterRngFallback = false;

function pickTemplate(ctx, biome) {
  const reg = registry(ctx);
  const rng = rngFor(ctx);
  const fallback = [
    { id: "ambush_forest", name: "Forest Ambush", baseWeight: 1.0, allowedBiomes: ["FOREST","GRASS"], map: { generator: "ambush_forest", w: 24, h: 16 }, groups: [ { type: "bandit", count: { min: 2, max: 4 } } ] },
    { id: "bandit_camp", name: "Bandit Camp", baseWeight: 0.8, allowedBiomes: ["GRASS","DESERT","BEACH"], map: { generator: "camp", w: 26, h: 18 }, groups: [ { type: "bandit", count: { min: 3, max: 6 } } ] },
    { id: "wild_seppo", name: "Wild Seppo", baseWeight: 0.06, allowedBiomes: ["FOREST","GRASS","DESERT","BEACH","SNOW","SWAMP"], map: { generator: "camp", w: 24, h: 16 }, merchant: { vendor: "seppo" }, groups: [] },
  ];
  if (!reg) { try { if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") window.Fallback.log("encounter", "Using built-in encounter templates (GameData.encounters missing).", { biome }); } catch (_) {} }
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

// Compute a simple difficulty level (1..5) based on player level and biome.
// You can later swap this to use region threats, time-of-day, or config.
function computeDifficulty(ctx, biome) {
  try {
    const pLv = (ctx && ctx.player && typeof ctx.player.level === "number") ? ctx.player.level : 1;
    // Base on player level: every 3 levels increases difficulty by 1, clamp 1..5
    let diff = Math.max(1, Math.min(5, 1 + Math.floor((pLv - 1) / 3)));
    // Biome slight modifiers (optional, conservative)
    const b = String(biome || "").toUpperCase();
    if (b === "DESERT" || b === "MOUNTAIN" || b === "SWAMP" || b === "SNOW") diff = Math.min(5, diff + 1);
    return diff;
  } catch (_) {}
  return 1;
}

function findTemplateById(ctx, id) {
  const reg = registry(ctx);
  if (!reg) return null;
  return reg.find(t => String(t.id).toLowerCase() === String(id || "").toLowerCase()) || null;
}

function tryEnter(ctx, tmpl, biome, difficulty) {
  try {
    if (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.enterEncounter === "function") {
      const ok = !!window.GameAPI.enterEncounter(tmpl, biome, difficulty);
      if (ok) return true;
    }
  } catch (_) {}
  try {
    const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
    if (ER && typeof ER.enter === "function") {
      const ok2 = !!ER.enter(ctx, { template: tmpl, biome, difficulty });
      if (ok2) {
        try { typeof ctx.turn === "function" && ctx.turn(); } catch (_) {}
        return true;
      }
    }
  } catch (_) {}
  return false;
}

export function maybeTryEncounter(ctx) {
  try {
    if (!ctx || ctx.mode !== "world" || !ctx.world || !ctx.world.map) return false;

    const wx = ctx.player.x | 0, wy = ctx.player.y | 0;
    const moved = (STATE.lastWorldX !== wx) || (STATE.lastWorldY !== wy);
    STATE.lastWorldX = wx; STATE.lastWorldY = wy;
    if (!moved) return false; // only roll on movement steps

    // Arm-on-next-move debug trigger from GOD panel
    try {
      const dbgId = (typeof window !== "undefined" ? window.DEBUG_ENCOUNTER_ARM : null);
      if (dbgId) {
        const t = findTemplateById(ctx, dbgId);
        if (t) {
          const tile = ctx.world.map[wy][wx];
          const biome = biomeFromTile(tile);
          const diff = computeDifficulty(ctx, biome);
          if (tryEnter(ctx, t, biome, diff)) {
            STATE.movesSinceLast = 0;
            STATE.cooldownMoves = 10;
            window.DEBUG_ENCOUNTER_ARM = null;
            return true;
          }
        }
        // Clear invalid id to avoid blocking
        window.DEBUG_ENCOUNTER_ARM = null;
      }
    } catch (_) {}

    // Simple cooldown to avoid back-to-back prompts
    if (STATE.cooldownMoves > 0) {
      STATE.cooldownMoves -= 1;
      STATE.movesSinceLast += 1;
      return false;
    }

    const tile = ctx.world.map[wy][wx];
    const biome = biomeFromTile(tile);

    // Base chance and pity scaled by GOD panel Encounter Rate (0..100).
    // rate 50 -> baseline; 0 -> no encounters; 100 -> ~2x baseline with higher cap.
    const rate = getEncounterRate();
    if (rate <= 0) { STATE.movesSinceLast += 1; return false; }
    const scale = rate / 50; // 0..2
    const baseP0 = 0.03; // baseline 3%
    const pityStep0 = 0.006; // +0.6% per 8 moves after ~18
    const baseP = baseP0 * scale;
    const pitySteps = Math.max(0, Math.floor((STATE.movesSinceLast - 18) / 8));
    const pityBoost = pitySteps * (pityStep0 * scale);
    const cap = Math.min(0.35, 0.18 * scale); // raise cap modestly with scale (max 35%)
    const chance = Math.min(cap, baseP + pityBoost);

    // Deterministic roll using RNGUtils when available; fallback to direct rng() comparison
    const willEncounter = (function () {
      try {
        if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.chance === "function") {
          const rngFn = (typeof ctx.rng === "function") ? ctx.rng : undefined;
          return window.RNGUtils.chance(chance, rngFn);
        }
      } catch (_) {}
      try {
        if (!_loggedEncounterRngFallback && typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") {
          window.Fallback.log("encounter", "Using direct RNG comparison (RNGUtils.chance unavailable).");
          _loggedEncounterRngFallback = true;
        }
      } catch (_) {}
      const r = rngFor(ctx)();
      return r < chance;
    })();
    if (!willEncounter) {
      STATE.movesSinceLast += 1;
      return false;
    }

    // Special pick: Night Raid goblins vs bandits (3% of all encounters, night-only, once per in-game week)
    (function maybeNightRaid() {
      try {
        const reg = registry(ctx);
        const has = reg && reg.some(t => String(t.id || "").toLowerCase() === "night_raid_goblins");
        if (!has) return;
        const clock = (ctx.getClock && ctx.getClock()) || ctx.time || {};
        const phase = String(clock.phase || "").toLowerCase();
        if (phase !== "night") return;
        const tc = (typeof clock.turnCounter === "number") ? (clock.turnCounter | 0) : 0;
        if (tc < (STATE.nightRaidCooldownUntilTurn | 0)) return;
        // 3% share among all rolled encounters
        const r = rngFor(ctx)();
        if (r >= 0.03) return;
        const tmpl = findTemplateById(ctx, "night_raid_goblins");
        if (!tmpl) return;
        const diff = computeDifficulty(ctx, biome);
        if (tryEnter(ctx, tmpl, biome, diff)) {
          // Set cooldown for one in-game week
          const minsPerTurn = (clock.minutesPerTurn || 4);
          const oneWeekTurns = Math.ceil((7 * 24 * 60) / minsPerTurn);
          STATE.nightRaidCooldownUntilTurn = tc + oneWeekTurns;
          STATE.movesSinceLast = 0;
          STATE.cooldownMoves = 10;
          throw { _earlyExit: true };
        }
      } catch (e) {
        if (e && e._earlyExit) throw e;
      }
    })();

    // Select a suitable template for this biome
    const tmpl = pickTemplate(ctx, biome);
    if (!tmpl) { STATE.movesSinceLast += 1; return false; }

    const difficulty = computeDifficulty(ctx, biome);
    const text = `${tmpl.name || "Encounter"} (Difficulty ${difficulty}): ${biome.toLowerCase()} — Enter?`;
    const enter = () => {
      if (tryEnter(ctx, tmpl, biome, difficulty)) {
        STATE.movesSinceLast = 0;
        STATE.cooldownMoves = 10;
        return true;
      }
      return false;
    };
    const cancel = () => {
      try { ctx.log && ctx.log("You avoid the danger.", "info"); } catch (_) {}
      STATE.movesSinceLast += 1;
    };

    // Prompt the user (prefer UIOrchestration via Capabilities.safeCall)
    try {
      const Cap = ctx.Capabilities || (typeof window !== "undefined" ? window.Capabilities : null);
      if (Cap && typeof Cap.safeCall === "function") {
        const res = Cap.safeCall(ctx, "UIOrchestration", "showConfirm", ctx, text, null, () => enter(), () => cancel());
        if (res && res.ok) return true;
      }
    } catch (_) {}
    // Fallback: UIBridge
    const UI = ctx.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
    if (UI && typeof UI.showConfirm === "function") {
      UI.showConfirm(ctx, text, null, () => enter(), () => cancel());
    } else {
      // Fallback: inline confirm
      try { if (typeof window !== "undefined" && window.Fallback && typeof window.Fallback.log === "function") window.Fallback.log("encounter", "Using window.confirm UI (UIBridge.showConfirm unavailable)."); } catch (_) {}
      if (typeof window !== "undefined" && window.confirm && window.confirm(text)) enter();
      else cancel();
    }
    return true;
  } catch (e) {
    if (e && e._earlyExit) return true;
    // Best-effort only
    return false;
  }
}

// Back-compat
if (typeof window !== "undefined") {
  window.EncounterService = { maybeTryEncounter };
}