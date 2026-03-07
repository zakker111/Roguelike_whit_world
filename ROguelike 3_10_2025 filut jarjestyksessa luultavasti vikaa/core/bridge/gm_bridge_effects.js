/**
 * GMBridge effects helpers.
 *
 * Goal (Phase 3 refactor, step 1): keep GMBridge logic in `gm_bridge.js`,
 * but move cross-system *effects* (UI, MarkerService, encounter start, reward grants)
 * into a separate module so the bridge surface can be reviewed and narrowed.
 *
 * This file is intentionally low-level and must not change gameplay semantics.
 */

import { getGameData, getMod } from "../../utils/access.js";

// Minimal fallback encounter templates used when JSON registries haven't loaded.
// These should match data/encounters/encounters.json so gameplay stays consistent.
const FALLBACK_GM_ENCOUNTER_TEMPLATES = {
  gm_bottle_map_scene: {
    id: "gm_bottle_map_scene",
    name: "GM: Bottle Map Cache",
    baseWeight: 0.0,
    allowedBiomes: ["FOREST", "GRASS", "DESERT", "SNOW", "BEACH", "MOUNTAIN", "SWAMP"],
    map: { generator: "ruins", w: 26, h: 18 },
    objective: { type: "clearAll" },
    groups: [{ type: "bandit", count: { min: 3, max: 5 }, faction: "bandit" }],
  },
  gm_survey_cache_scene: {
    id: "gm_survey_cache_scene",
    name: "GM: Surveyor's Cache",
    baseWeight: 0.0,
    allowedBiomes: ["FOREST", "GRASS", "DESERT", "SNOW", "BEACH", "MOUNTAIN", "SWAMP"],
    map: { generator: "ruins", w: 26, h: 18 },
    objective: { type: "clearAll" },
    groups: [{ type: "bandit", count: { min: 3, max: 6 }, faction: "bandit" }],
  },
  gm_bandit_bounty: {
    id: "gm_bandit_bounty",
    name: "GM: Bandit Bounty",
    baseWeight: 0.0,
    allowedBiomes: ["FOREST", "GRASS", "DESERT", "SNOW", "BEACH", "MOUNTAIN", "SWAMP"],
    map: { generator: "ruins", w: 26, h: 18 },
    objective: { type: "clearAll" },
    groups: [{ type: "bandit", count: { min: 4, max: 7 }, faction: "bandit" }],
  },
  gm_troll_hunt: {
    id: "gm_troll_hunt",
    name: "GM: Troll Hunt",
    baseWeight: 0.0,
    allowedBiomes: ["FOREST", "GRASS", "DESERT", "SNOW", "BEACH", "MOUNTAIN", "SWAMP"],
    map: { generator: "ruins", w: 26, h: 18 },
    objective: { type: "clearAll" },
    groups: [{ type: "troll", count: { min: 1, max: 2 }, faction: "monster" }],
  },
};

/**
 * Apply a reward grant list into the player's inventory.
 *
 * Note: this function is used for both Bottle Map and Survey Cache rewards.
 * It intentionally uses the same inventory conventions as the old GMBridge code.
 */
export function grantBottleMapRewards(ctx, reward) {
  if (!ctx || !ctx.player || !reward) return;
  const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);

  for (const g of reward.grants || []) {
    if (!g) continue;
    if (g.kind === "gold") {
      const amount = typeof g.amount === "number" ? (g.amount | 0) : 0;
      if (amount <= 0) continue;
      let goldObj = inv.find((it) => it && String(it.kind || it.type || "").toLowerCase() === "gold");
      if (!goldObj) {
        goldObj = { kind: "gold", amount: 0, name: "gold" };
        inv.push(goldObj);
      }
      goldObj.amount = (typeof goldObj.amount === "number" ? goldObj.amount : 0) + amount;
      continue;
    }
    if (g.kind === "item" && g.item) {
      inv.push(g.item);
      continue;
    }
    if (g.kind === "tool" && g.tool) {
      inv.push(g.tool);
      continue;
    }
  }

  try {
    if (typeof ctx.updateUI === "function") ctx.updateUI();
  } catch (_) {}
}

/**
 * Start a GM encounter by template id.
 *
 * IMPORTANT: must be ctx-first (no GameAPI ctx reacquire).
 * This function is kept here to isolate cross-system effects from GMBridge logic.
 */
export function startGmFactionEncounter(ctx, encounterId, opts) {
  if (!ctx) return false;

  const idRaw = encounterId != null ? String(encounterId) : "";
  const id = idRaw.trim();
  if (!id) return false;

  const key = id.toLowerCase();

  const GD = getGameData(ctx);
  const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : null;

  let tmpl = null;
  try {
    if (reg && reg.length) {
      tmpl = reg.find((t) => t && String(t.id || "").toLowerCase() === key) || null;
    }
  } catch (_) {
    tmpl = null;
  }

  // If encounter registries haven't loaded yet (or failed to load), use a minimal fallback
  // for known GM encounters so marker interactions remain functional.
  if (!tmpl && (!reg || !reg.length)) {
    tmpl = FALLBACK_GM_ENCOUNTER_TEMPLATES[key] || null;
    if (tmpl) {
      try {
        if (ctx && typeof ctx.log === "function") {
          ctx.log(`[GM] Encounter templates not available yet; using fallback for '${id}'.`, "notice");
        }
      } catch (_) {}
    }
  }

  if (!tmpl) {
    try {
      if (ctx && typeof ctx.log === "function") {
        const loaded = !!(reg && reg.length);
        const count = loaded ? reg.length : 0;
        ctx.log(`[GM] Faction encounter template '${id}' not found (templatesLoaded=${loaded}, count=${count}).`, "warn");
      }
    } catch (_) {}
    return false;
  }

  let biome = "GRASS";
  try {
    const W = getMod(ctx, "World");
    const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
    const y = ctx.player && typeof ctx.player.y === "number" ? (ctx.player.y | 0) : 0;
    const x = ctx.player && typeof ctx.player.x === "number" ? (ctx.player.x | 0) : 0;
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

  // Preferred: ctx-first entry via Modes facade.
  let ok = false;
  try {
    const M = ctx && ctx.Modes ? ctx.Modes : getMod(ctx, "Modes");
    if (M && typeof M.enterEncounter === "function") {
      ok = !!M.enterEncounter(ctx, tmpl, biome, difficulty);
    }
  } catch (_) {}

  // Fallback: direct EncounterRuntime entry (still ctx-first).
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
      if (ctx && typeof ctx.log === "function") ctx.log("[GM] Failed to start faction encounter.", "warn");
    } catch (_) {}
    return false;
  }

  // Ask GameAPI to sync orchestrator state when available.
  try {
    const GA = getMod(ctx, "GameAPI");
    if (GA && typeof GA.applyCtxSyncAndRefresh === "function") {
      GA.applyCtxSyncAndRefresh(ctx);
    }
  } catch (_) {}

  try {
    if (ctx && typeof ctx.log === "function") {
      const name = tmpl && tmpl.name ? tmpl.name : id;
      ctx.log(`[GM] A special encounter begins: ${name}.`, "notice");
    }
  } catch (_) {}

  return true;
}
