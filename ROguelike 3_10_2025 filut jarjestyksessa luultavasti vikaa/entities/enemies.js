/**
 * Enemies: thin adapter around data/enemies.json
 *
 * Exports (ESM + window.Enemies):
 * - TYPES, pickType(depth, rng), createEnemyAt(x, y, depth, rng)
 * - colorFor(type), glyphFor(type)
 * - equipTierFor(type), equipChanceFor(type), potionWeightsFor(type)
 * - levelFor(type, depth, rng), damageMultiplier(level), enemyBlockChance(enemy, loc)
 *
 * Notes:
 * - No hardcoded enemy definitions here. All types come from JSON via GameData.enemies.
 * - Functions operate on loaded JSON fields and provide runtime helpers.
 */

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Enemy type registry populated exclusively from JSON
export const TYPES = {};

function linearAt(arr, depth, fallback = 1) {
  // arr: [ [minDepth, base, slope] ... ] choose last <= depth and evaluate base + slope * (depth - minDepth)
  if (!Array.isArray(arr) || arr.length === 0) return fallback;
  let chosen = arr[0];
  for (const e of arr) {
    if ((e[0] | 0) <= depth) chosen = e;
  }
  const minD = chosen[0] | 0, baseV = Number(chosen[1] || fallback), slope = Number(chosen[2] || 0);
  const delta = Math.max(0, depth - minD);
  return Math.max(1, Math.floor(baseV + slope * delta));
}

function weightFor(row, depth) {
  const table = row && Array.isArray(row.weightByDepth) ? row.weightByDepth : [];
  if (!table.length) return 0.0;
  let w = 0;
  for (const entry of table) {
    const minD = entry[0] | 0;
    const ww = Number(entry[1] || 0);
    if (depth >= minD) w = ww;
  }
  return Math.max(0, w);
}

function applyJsonEnemies(json) {
  if (!Array.isArray(json)) return;
  const warn = (msg, row) => {
    try {
      // Collect into shared validation log for smoketest visibility
      window.ValidationLog = window.ValidationLog || { warnings: [], notices: [] };
      window.ValidationLog.warnings.push(`[Enemies] ${msg}`);
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") window.Logger.log(`[Enemies] ${msg}`, "warn");
      else if (typeof window !== "undefined" && window.DEV && typeof console !== "undefined") console.warn("[Enemies] " + msg, row);
    } catch (_) {}
  };
  for (const row of json) {
    const key = row.id || row.key;
    if (!key) { warn("Missing id/key for enemy entry; skipped.", row); continue; }
    if (!row.glyph || typeof row.glyph !== "string" || row.glyph.length === 0) { warn(`Enemy '${key}' missing glyph; defaulting to '?'`, row); }
    if (!Array.isArray(row.weightByDepth) || row.weightByDepth.length === 0) { warn(`Enemy '${key}' missing weightByDepth; it may never spawn.`, row); }
    const hpOk = Array.isArray(row.hp) && row.hp.length > 0;
    const atkOk = Array.isArray(row.atk) && row.atk.length > 0;
    const xpOk = Array.isArray(row.xp) && row.xp.length > 0;
    if (!hpOk || !atkOk || !xpOk) { warn(`Enemy '${key}' missing hp/atk/xp arrays; using fallbacks where needed.`, row); }

    TYPES[key] = {
      key,
      glyph: row.glyph || "?",
      color: row.color || "#cbd5e1",
      tier: Number(row.tier || 1),
      blockBase: typeof row.blockBase === "number" ? row.blockBase : 0.06,
      // raw data kept for stat resolution
      _hp: row.hp || [],
      _atk: row.atk || [],
      _xp: row.xp || [],
      _potionWeights: (row.potionWeights && typeof row.potionWeights === "object") ? row.potionWeights : { lesser: 0.6, average: 0.3, strong: 0.1 },
      _equipChance: typeof row.equipChance === "number" ? row.equipChance : 0.35,
      _weightByDepth: row.weightByDepth || [],
      hp(depth) { return linearAt(this._hp, depth, 3); },
      atk(depth) { return linearAt(this._atk, depth, 1); },
      xp(depth)  { return linearAt(this._xp, depth, 5); },
      weight(depth) { return weightFor(this, depth); },
      potionWeights: row.potionWeights,
      equipChance: typeof row.equipChance === "number" ? row.equipChance : 0.35,
    };
  }
}

export function listTypes() {
  return Object.keys(TYPES);
}

export function getTypeDef(type) {
  return TYPES[type] || null;
}

export function colorFor(type) {
  const t = getTypeDef(type);
  return t ? t.color : "#cbd5e1";
}

export function glyphFor(type) {
  const t = getTypeDef(type);
  return t ? t.glyph : "?";
}

export function equipTierFor(type) {
  const t = getTypeDef(type);
  return t ? (t.tier || 1) : 1;
}

export function equipChanceFor(type) {
  const t = getTypeDef(type);
  return t ? (typeof t.equipChance === "number" ? t.equipChance : 0.35) : 0.35;
}

export function potionWeightsFor(type) {
  const t = getTypeDef(type);
  return t ? (t._potionWeights || { lesser: 0.6, average: 0.3, strong: 0.1 }) : { lesser: 0.6, average: 0.3, strong: 0.1 };
}

export function pickType(depth, rng) {
  const keys = listTypes();
  if (!keys.length) return null;
  const entries = keys.map((k) => ({ key: k, w: TYPES[k].weight(depth) }));
  const total = entries.reduce((s, e) => s + e.w, 0);
  const rfn = (function () {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        return window.RNGUtils.getRng(rng);
      }
    } catch (_) {}
    return (typeof rng === "function")
      ? rng
      : ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
          ? window.RNG.rng
          : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
              ? window.RNGFallback.getRng()
              : Math.random));
  })();
  if (total <= 0) {
    // choose first when all weights are zero; indicates data issue
    return entries[0]?.key || null;
  }
  let r = rfn() * total;
  for (const e of entries) {
    if (r < e.w) return e.key;
    r -= e.w;
  }
  return entries[0]?.key || null;
}

export function levelFor(type, depth, rng) {
  // Simple level: depth + tier adjustment from data; jitter optional
  const t = getTypeDef(type);
  const tierAdj = t ? Math.max(0, (t.tier || 1) - 1) : 0;
  const jitter = rng && rng() < 0.35 ? 1 : 0;
  return Math.max(1, (depth | 0) + tierAdj + jitter);
}

export function damageMultiplier(level) {
  return 1 + 0.15 * Math.max(0, (level || 1) - 1);
}

export function enemyBlockChance(enemy, loc) {
  const t = getTypeDef(enemy.type);
  const base = t ? (t.blockBase || 0.06) : 0.06;
  return clamp(base * (loc?.blockMod || 1.0), 0, 0.35);
}

export function createEnemyAt(x, y, depth, rng) {
  const type = pickType(depth, rng);
  const t = type ? getTypeDef(type) : null;
  if (!t) {
    // No JSON types loaded; return null to signal caller to use fallback
    return null;
  }
  const level = levelFor(type, depth, rng);
  return {
    x, y,
    type,
    glyph: t.glyph,
    hp: t.hp(depth),
    atk: t.atk(depth),
    xp: t.xp(depth),
    level,
    announced: false,
  };
}

// Apply JSON enemies when ready; no defaults baked in
try {
  if (typeof window !== "undefined" && window.GameData && window.GameData.ready && typeof window.GameData.ready.then === "function") {
    window.GameData.ready.then(() => {
      try { applyJsonEnemies(window.GameData.enemies); } catch (_) {}
    });
  } else if (typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.enemies)) {
    applyJsonEnemies(window.GameData.enemies);
  }
} catch (_) {}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.Enemies = {
    TYPES,
    listTypes,
    getTypeDef,
    colorFor,
    glyphFor,
    equipTierFor,
    equipChanceFor,
    potionWeightsFor,
    pickType,
    levelFor,
    damageMultiplier,
    enemyBlockChance,
    createEnemyAt,
  };
}