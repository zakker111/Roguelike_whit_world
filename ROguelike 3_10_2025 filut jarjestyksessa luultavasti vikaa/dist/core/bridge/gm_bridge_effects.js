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



const NO_SYNC = () => {};

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
  } catch { /\* ignore \*/ }
}

/**
 * Start a GM encounter by template id.
 *
 * IMPORTANT:
 * - must be ctx-first (no GameAPI ctx reacquire)
 * - must NOT apply a sync boundary (Phase 2 rule: caller syncs exactly once)
 *
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
  } catch {
    tmpl = null;
  }

  

  if (!tmpl) {
    try {
      if (ctx && typeof ctx.log === "function") {
        const loaded = !!(reg && reg.length);
        const count = loaded ? reg.length : 0;
        ctx.log(`[GM] Faction encounter template '${id}' not found (templatesLoaded=${loaded}, count=${count}).`, "warn");
      }
    } catch { /\* ignore \*/ }
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
  } catch { /\* ignore \*/ }

  let difficulty = 1;
  try {
    const ES = getMod(ctx, "EncounterService");
    if (ES && typeof ES.computeDifficulty === "function") {
      difficulty = ES.computeDifficulty(ctx, biome);
    }
  } catch { /\* ignore \*/ }
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) difficulty = 1;
  if (difficulty < 1) difficulty = 1;
  if (difficulty > 5) difficulty = 5;

  // Preferred: ctx-first entry via Modes facade.
  // IMPORTANT: pass a no-op sync callback so Modes does not apply its own sync boundary.
  let ok = false;
  try {
    const M = ctx && ctx.Modes ? ctx.Modes : getMod(ctx, "Modes");
    if (M && typeof M.enterEncounter === "function") {
      ok = !!M.enterEncounter(ctx, tmpl, biome, difficulty, NO_SYNC);
    }
  } catch { /\* ignore \*/ }

  // Fallback: direct EncounterRuntime entry (still ctx-first).
  if (!ok) {
    try {
      const ER = getMod(ctx, "EncounterRuntime");
      if (ER && typeof ER.enter === "function") {
        ok = !!ER.enter(ctx, { template: tmpl, biome, difficulty });
      }
    } catch { /\* ignore \*/ }
  }

  if (!ok) {
    try {
      if (ctx && typeof ctx.log === "function") ctx.log("[GM] Failed to start faction encounter.", "warn");
    } catch { /\* ignore \*/ }
    return false;
  }

  try {
    if (ctx && typeof ctx.log === "function") {
      const name = tmpl && tmpl.name ? tmpl.name : id;
      ctx.log(`[GM] A special encounter begins: ${name}.`, "notice");
    }
  } catch { /\* ignore \*/ }

  return true;
}
