/**
 * Bottle Map thread helpers (gm.threads.bottleMap).
 *
 * Responsibilities:
 * 1) Fishing award + pity bookkeeping (C1)
 * 2) Bottle Map activation + marker integrity + encounter lifecycle (C2)
 *
 * IMPORTANT:
 * - No inventory mutation here. The bridge applies item grants / refunds.
 * - No MarkerService / UI calls here. We only return *plans* and *specs*.
 * - Uses GM RNG stream (gmRngFloat), never ctx.rng.
 */

import { gmRngFloat } from "../rng.js";

function clamp01(x) {
  const v = typeof x === "number" && Number.isFinite(x) ? x : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function nowTurn(ctx) {
  try {
    if (ctx && ctx.time && typeof ctx.time.turnCounter === "number" && Number.isFinite(ctx.time.turnCounter)) {
      return (ctx.time.turnCounter | 0);
    }
  } catch (_) {}
  return 0;
}

function normalizeBottleStatus(raw, active) {
  const s = (typeof raw === "string" ? raw : "").trim();
  const low = s.toLowerCase();
  if (low === "inencounter" || low === "in_encounter" || low === "in-encounter") return "inEncounter";
  if (low === "active") return "active";
  if (low === "claimed") return "claimed";
  if (low === "expired") return "expired";
  return active ? "active" : "claimed";
}

function isThreadActive(thread) {
  if (!thread || typeof thread !== "object") return false;
  const status = normalizeBottleStatus(thread.status, !!thread.active);
  return thread.active === true && status !== "claimed" && status !== "expired";
}

function getWorldAndMap(ctx) {
  const world = ctx && ctx.world ? ctx.world : null;
  const map = world && Array.isArray(world.map) ? world.map : null;
  if (!world || !map || !map.length || !map[0]) return { world: null, map: null };
  return { world, map };
}

function getWorldMod(ctx) {
  try {
    return (typeof window !== "undefined" ? window.World : null) || (ctx && ctx.World ? ctx.World : null) || null;
  } catch (_) {
    return null;
  }
}

function getTilesConst(ctx) {
  try {
    const W = getWorldMod(ctx);
    return W && W.TILES ? W.TILES : null;
  } catch (_) {
    return null;
  }
}

function isWalkableOverworldTile(ctx, world, tile) {
  try {
    const gen = world && world.gen;
    if (gen && typeof gen.isWalkable === "function") return !!gen.isWalkable(tile);
  } catch (_) {}
  try {
    const W = getWorldMod(ctx);
    if (W && typeof W.isWalkable === "function") return !!W.isWalkable(tile);
  } catch (_) {}
  // Conservative fallback: unknown tiles are not walkable.
  return false;
}

function isDisallowedOverworldTile(tile, T) {
  if (!T) return false;
  return tile === T.WATER
    || tile === T.RIVER
    || tile === T.MOUNTAIN
    || tile === T.RUINS
    || tile === T.TOWN
    || tile === T.DUNGEON
    || (T.CASTLE != null && tile === T.CASTLE)
    || (T.TOWER != null && tile === T.TOWER);
}

function hasBottleMapMarkerInstance(ctx, instanceId, absX, absY) {
  try {
    const iid = instanceId != null ? String(instanceId) : "";
    if (!iid) return false;
    const list = (ctx && ctx.world && Array.isArray(ctx.world.questMarkers)) ? ctx.world.questMarkers : [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (String(m.kind || "") !== "gm.bottleMap") continue;
      if (String(m.instanceId || "") !== iid) continue;
      if ((m.x | 0) !== (absX | 0) || (m.y | 0) !== (absY | 0)) continue;
      return true;
    }
  } catch (_) {}
  return false;
}

// ------------------------
// Fishing award + pity (C1)
// ------------------------

export function bottleMapGetFishingConfig(ctx) {
  const DEFAULTS = { S0: 60, Smax: 180, boredomMin: 0.2, boredomMultMax: 3.0, cooldownTurns: 400 };
  try {
    const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config)
      ? window.GameData.config
      : null;

    const f = cfg && cfg.gm && cfg.gm.bottleMap && cfg.gm.bottleMap.fishing && typeof cfg.gm.bottleMap.fishing === "object"
      ? cfg.gm.bottleMap.fishing
      : null;

    let S0 = f && typeof f.S0 === "number" && Number.isFinite(f.S0) ? (f.S0 | 0) : DEFAULTS.S0;
    let Smax = f && typeof f.Smax === "number" && Number.isFinite(f.Smax) ? (f.Smax | 0) : DEFAULTS.Smax;
    let boredomMin = f && typeof f.boredomMin === "number" && Number.isFinite(f.boredomMin) ? f.boredomMin : DEFAULTS.boredomMin;
    let boredomMultMax = f && typeof f.boredomMultMax === "number" && Number.isFinite(f.boredomMultMax) ? f.boredomMultMax : DEFAULTS.boredomMultMax;
    let cooldownTurns = f && typeof f.cooldownTurns === "number" && Number.isFinite(f.cooldownTurns) ? (f.cooldownTurns | 0) : DEFAULTS.cooldownTurns;

    if (S0 < 0) S0 = 0;
    if (Smax < S0) Smax = S0;
    boredomMin = clamp01(boredomMin);
    if (boredomMultMax < 1) boredomMultMax = 1;
    if (cooldownTurns < 0) cooldownTurns = 0;

    return { S0, Smax, boredomMin, boredomMultMax, cooldownTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

export function bottleMapHasBottleMapInInventory(ctx) {
  try {
    const inv = (ctx && ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : [];
    return inv.some((it) => {
      if (!it) return false;
      // Match legacy behavior: only treat actual tools as Bottle Maps.
      const k = String(it.kind || "").toLowerCase();
      if (k !== "tool") return false;
      const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
      return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
    });
  } catch (_) {
    return false;
  }
}

export function bottleMapMakeItemSpec() {
  return { kind: "tool", type: "bottle_map", id: "bottle_map", name: "bottle map", decay: 0, usable: true };
}

/**
 * Compute and apply Bottle Map fishing award bookkeeping.
 *
 * @param {object} ctx
 * @param {object} gm
 * @param {object} thread gm.threads.bottleMap
 * @param {object} [opts]
 * @param {(gm:object)=>void} [opts.onDirty] passed into gmRngFloat to mark GM dirty when RNG advances
 */
export function bottleMapOnFishingSuccess(ctx, gm, thread, opts = {}) {
  const onDirty = opts && typeof opts.onDirty === "function" ? opts.onDirty : null;

  if (!ctx || !gm || !thread || typeof thread !== "object") return { awarded: false, changed: false };

  // Only one active Bottle Map thread at a time.
  if (thread.active === true) return { awarded: false, changed: false };

  // Do not award if the player already has one.
  if (bottleMapHasBottleMapInInventory(ctx)) return { awarded: false, changed: false };

  const cfg = bottleMapGetFishingConfig(ctx);

  const turn = nowTurn(ctx);

  // Ensure fishing state exists.
  const fishing = (thread.fishing && typeof thread.fishing === "object")
    ? thread.fishing
    : (thread.fishing = { eligibleSuccesses: 0, totalSuccesses: 0, lastAwardTurn: -9999, awardCount: 0 });

  // Cooldown after a map award.
  const lastAwardTurn = (typeof fishing.lastAwardTurn === "number" && Number.isFinite(fishing.lastAwardTurn))
    ? (fishing.lastAwardTurn | 0)
    : -9999;

  if ((turn - lastAwardTurn) < (cfg.cooldownTurns | 0)) {
    fishing.totalSuccesses = (fishing.totalSuccesses | 0) + 1;
    return { awarded: false, changed: true, successEventPayload: { awarded: false, reason: "cooldown" } };
  }

  // Update counters
  fishing.totalSuccesses = (fishing.totalSuccesses | 0) + 1;

  const boredom = clamp01(gm && gm.boredom && typeof gm.boredom.level === "number" ? gm.boredom.level : 0);
  const eligible = boredom >= cfg.boredomMin;
  if (eligible) fishing.eligibleSuccesses = (fishing.eligibleSuccesses | 0) + 1;

  const s = (fishing.eligibleSuccesses | 0);
  if (!eligible || s < (cfg.S0 | 0)) {
    return { awarded: false, changed: true, successEventPayload: { awarded: false, eligible, s } };
  }

  // Probability ramp: start very low at S0 and reach near-guaranteed by Smax.
  // Multiply by boredom factor (up to boredomMultMax at boredom=1).
  const denom = Math.max(1, (cfg.Smax | 0) - (cfg.S0 | 0));
  const t = Math.max(0, Math.min(1, (s - (cfg.S0 | 0)) / denom));

  const baseChance = 0.002; // 0.2% at ramp start
  const maxChance = 0.10;   // up to 10%
  let chance = baseChance + t * (maxChance - baseChance);

  const boredomMult = 1 + boredom * (cfg.boredomMultMax - 1);
  chance *= boredomMult;

  // Defensive clamp (config may set high boredomMultMax).
  if (chance < 0) chance = 0;
  if (chance > 1) chance = 1;

  // Hard guarantee at Smax.
  const force = s >= (cfg.Smax | 0);
  const roll = gmRngFloat(gm, onDirty);
  const win = force || roll < chance;

  if (!win) {
    return { awarded: false, changed: true, successEventPayload: { awarded: false, eligible, s, chance, roll } };
  }

  // Award bookkeeping.
  fishing.lastAwardTurn = turn;
  fishing.awardCount = (fishing.awardCount | 0) + 1;
  fishing.eligibleSuccesses = 0;

  return {
    awarded: true,
    changed: true,
    turn,
    awardCount: fishing.awardCount | 0,
    item: bottleMapMakeItemSpec(),
  };
}

// ------------------------
// Bottle Map lifecycle (C2)
// ------------------------

function ensureUniqueGranted(gm) {
  if (!gm || typeof gm !== "object") return null;

  const runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;

  if (!gm.uniqueGranted || typeof gm.uniqueGranted !== "object" || gm.uniqueGrantedRunSeed !== runSeed) {
    gm.uniqueGranted = {};
    gm.uniqueGrantedRunSeed = runSeed;
  }

  return gm.uniqueGranted;
}

function pickBottleMapTarget(ctx, gm, opts) {
  const onDirty = opts && typeof opts.onDirty === "function" ? opts.onDirty : null;

  const { world: w, map } = getWorldAndMap(ctx);
  if (!w || !map) return null;

  const H = map.length | 0;
  const W = map[0].length | 0;

  const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
  const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;

  const px = (ctx && ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
  const py = (ctx && ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
  const pAbsX = ox + px;
  const pAbsY = oy + py;

  const T = getTilesConst(ctx);

  const tries = 80;
  for (let n = 0; n < tries; n++) {
    // Distance 12..32, biased a bit farther.
    const r = 12 + Math.floor(Math.pow(gmRngFloat(gm, onDirty), 0.65) * 20);
    const ang = gmRngFloat(gm, onDirty) * Math.PI * 2;
    const dx = Math.round(Math.cos(ang) * r);
    const dy = Math.round(Math.sin(ang) * r);

    const absX = (pAbsX + dx) | 0;
    const absY = (pAbsY + dy) | 0;

    const lx = absX - ox;
    const ly = absY - oy;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;

    const tile = map[ly] ? map[ly][lx] : null;
    if (tile == null) continue;

    if (T && isDisallowedOverworldTile(tile, T)) continue;
    if (!isWalkableOverworldTile(ctx, w, tile)) continue;

    return { absX, absY, placementTries: n + 1 };
  }

  return null;
}

function rollBottleMapReward(ctx, gm, opts) {
  const onDirty = opts && typeof opts.onDirty === "function" ? opts.onDirty : null;

  // Gold: uniform 60..80 inclusive.
  const gold = 60 + Math.floor(gmRngFloat(gm, onDirty) * 21);
  const grants = [{ kind: "gold", amount: gold }];

  // Always grant exactly 1 tier-2 equipment item.
  try {
    const Items = (typeof window !== "undefined" ? window.Items : null) || (ctx && ctx.Items ? ctx.Items : null);
    if (Items && typeof Items.createEquipment === "function") {
      const it = Items.createEquipment(2, () => gmRngFloat(gm, onDirty));
      if (it) grants.push({ kind: "item", item: it });
    } else {
      grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
    }
  } catch (_) {
    grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
  }

  // Unique drop: 2–3% per Bottle Map resolution. Enforced unique per-run via gm.uniqueGranted.
  try {
    const uniqueChance = 0.02 + (gmRngFloat(gm, onDirty) * 0.01);
    const roll = gmRngFloat(gm, onDirty);
    if (roll < uniqueChance) {
      const granted = ensureUniqueGranted(gm) || {};
      const pool = ["skeleton_key"]; // Expandable.
      const available = pool.filter((id) => !granted[String(id)]);

      if (available.length) {
        const pick = available[Math.floor(gmRngFloat(gm, onDirty) * available.length)] || available[0];
        granted[String(pick)] = true;

        if (pick === "skeleton_key") {
          grants.push({
            kind: "tool",
            tool: {
              kind: "tool",
              type: "skeleton_key",
              id: "skeleton_key",
              name: "skeleton key",
              uses: 1,
              unique: true,
              decay: 0,
              usable: false,
            },
          });
        }
      }
    }
  } catch (_) {}

  return { grants };
}

function normalizeArgs(meta, opts) {
  // Support being called as (ctx,gm,thread,opts) when meta is undefined.
  if (opts == null && meta && typeof meta === "object" && Object.prototype.hasOwnProperty.call(meta, "onDirty")) {
    return { meta: undefined, opts: meta };
  }
  return { meta, opts: opts || {} };
}

/**
 * Bottle Map activation (called after the bridge consumes the inventory item).
 *
 * Returns:
 * - success: { ok:true, instanceId, markerSpec, changed:true }
 * - failure: { ok:false, reason, refundItemSpec, changed:true }
 */
export function bottleMapOnUseItem(ctx, gm, thread, meta, opts) {
  const norm = normalizeArgs(meta, opts);
  opts = norm.opts;
  const onDirty = opts && typeof opts.onDirty === "function" ? opts.onDirty : null;

  if (!ctx || !gm || !thread || typeof thread !== "object") return null;

  const status = normalizeBottleStatus(thread.status, !!thread.active);
  if (thread.active === true && (status === "active" || status === "inEncounter")) {
    return { ok: false, reason: "alreadyActive", refundItemSpec: bottleMapMakeItemSpec(), changed: false };
  }

  // Pick deterministic target + reward using GM RNG.
  const target = pickBottleMapTarget(ctx, gm, { onDirty });
  const turn = nowTurn(ctx);

  if (!target) {
    thread.active = false;
    thread.status = "expired";
    thread.failureReason = "targetPlacementFailed";
    thread.instanceId = null;
    thread.target = null;
    thread.reward = null;
    thread.createdTurn = turn;
    thread.claimedTurn = null;
    thread.attempts = 0;
    thread.placementTries = 80;

    return { ok: false, reason: "targetPlacementFailed", refundItemSpec: bottleMapMakeItemSpec(), changed: true };
  }

  const reward = rollBottleMapReward(ctx, gm, { onDirty });

  const calls = (gm && gm.rng && typeof gm.rng.calls === "number" && Number.isFinite(gm.rng.calls)) ? (gm.rng.calls | 0) : 0;
  const instanceId = `bottleMap:${turn}:${calls}`;

  thread.active = true;
  thread.status = "active";
  thread.instanceId = instanceId;
  thread.createdTurn = turn;
  thread.claimedTurn = null;
  thread.attempts = 0;
  thread.placementTries = target.placementTries | 0;
  thread.failureReason = null;
  thread.target = { absX: target.absX | 0, absY: target.absY | 0 };
  thread.reward = reward;

  const markerSpec = {
    x: target.absX | 0,
    y: target.absY | 0,
    kind: "gm.bottleMap",
    glyph: "X",
    paletteKey: "gmMarker",
    instanceId,
  };

  return { ok: true, instanceId, markerSpec, changed: true };
}

/**
 * Marker integrity plan.
 *
 * Returns a *plan object* for GMBridge to apply via MarkerService.
 *
 * Fields GMBridge will use:
 * - removeAll: boolean
 * - remove: array of predicates/criteria/instanceIds
 * - add: array of marker specs
 * - activeInstanceId: string
 */
export function bottleMapReconcileMarkers(ctx, gm, thread, meta, opts) {
  const norm = normalizeArgs(meta, opts);
  opts = norm.opts;

  if (!ctx || !gm || !thread || typeof thread !== "object") return null;

  const iid = thread.instanceId != null ? String(thread.instanceId) : "";

  // If no active thread, remove all orphan markers.
  if (!isThreadActive(thread) || !iid) {
    return { removeAll: true, active: false, activeInstanceId: iid || "", changed: false };
  }

  // If active but missing target, expire it and remove all.
  const t = thread.target && typeof thread.target === "object" ? thread.target : null;
  const tx = t && typeof t.absX === "number" && Number.isFinite(t.absX) ? (t.absX | 0) : null;
  const ty = t && typeof t.absY === "number" && Number.isFinite(t.absY) ? (t.absY | 0) : null;

  if (tx == null || ty == null) {
    thread.active = false;
    thread.status = "expired";
    thread.failureReason = thread.failureReason || "missingTarget";
    thread.target = null;
    return { removeAll: true, active: false, activeInstanceId: iid, changed: true, expiredReason: "missingTarget" };
  }

  // Remove mismatched markers (wrong instanceId or wrong coords) and ensure the correct one exists.
  const removePredicate = (m) => {
    try {
      if (!m) return false;
      if (String(m.kind || "") !== "gm.bottleMap") return false;
      const mid = String(m.instanceId || "");
      if (mid !== iid) return true;
      return ((m.x | 0) !== tx) || ((m.y | 0) !== ty);
    } catch (_) {
      return false;
    }
  };

  const markerExists = hasBottleMapMarkerInstance(ctx, iid, tx, ty);
  const add = markerExists ? [] : [{ x: tx, y: ty, kind: "gm.bottleMap", glyph: "X", paletteKey: "gmMarker", instanceId: iid }];

  return {
    active: true,
    activeInstanceId: iid,
    remove: [removePredicate],
    add,
    changed: false,
  };
}

/**
 * Encounter attempt bookkeeping (called after confirm OK).
 * meta: { instanceId, started }
 */
export function bottleMapOnEncounterStart(ctx, gm, thread, meta, opts) {
  const norm = normalizeArgs(meta, opts);
  meta = norm.meta || {};

  if (!ctx || !gm || !thread || typeof thread !== "object") return null;

  const iid = thread.instanceId != null ? String(thread.instanceId) : "";
  const inst = meta && meta.instanceId != null ? String(meta.instanceId) : "";
  if (!iid || !inst || iid !== inst) return { changed: false };

  const started = !!(meta && meta.started === true);

  let changed = false;
  if (started) {
    if (normalizeBottleStatus(thread.status, !!thread.active) !== "inEncounter") {
      thread.status = "inEncounter";
      changed = true;
    }
    const prev = thread.attempts | 0;
    thread.attempts = prev + 1;
    changed = true;
  } else {
    // If start failed, ensure we remain retryable.
    if (normalizeBottleStatus(thread.status, !!thread.active) === "inEncounter") {
      thread.status = "active";
      changed = true;
    }
  }

  if (thread.active !== true && (thread.status === "active" || thread.status === "inEncounter")) {
    thread.active = true;
    changed = true;
  }

  return { changed };
}

/**
 * Encounter completion bookkeeping.
 * meta: { outcome, worldReturnPos }
 */
export function bottleMapOnEncounterComplete(ctx, gm, thread, meta, opts) {
  const norm = normalizeArgs(meta, opts);
  meta = norm.meta || {};

  if (!ctx || !gm || !thread || typeof thread !== "object") return null;

  const outcome = meta && meta.outcome != null ? String(meta.outcome).trim().toLowerCase() : "";
  const iid = thread.instanceId != null ? String(thread.instanceId) : "";

  if (outcome !== "victory") {
    // Keep thread retryable after withdraw/cancel; marker remains.
    let changed = false;
    if (thread.active !== true) {
      thread.active = true;
      changed = true;
    }
    if (normalizeBottleStatus(thread.status, !!thread.active) !== "active") {
      thread.status = "active";
      changed = true;
    }
    return { changed, payoutReward: false, instanceId: iid };
  }

  // Victory: pay out and close.
  const turn = nowTurn(ctx);
  thread.status = "claimed";
  thread.active = false;
  thread.claimedTurn = turn;

  return {
    changed: true,
    payoutReward: true,
    reward: thread.reward || { grants: [] },
    removeMarkerInstanceId: iid,
    instanceId: iid,
  };
}
