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
// Minimal built-in defaults to prevent full fallback spawns if JSON fails to load
const DEFAULT_ENEMIES = [
  { id: "goblin", glyph: "g", color: "#8bd5a0", tier: 1, blockBase: 0.06,
    weightByDepth: [[0,0.70],[3,0.50],[6,0.35]],
    hp: [[0,3,0.5]], atk: [[0,1,0.25]], xp: [[0,5,0.5]], equipChance: 0.35
  },
  { id: "skeleton", glyph: "S", color: "#bfbfbf", tier: 2, blockBase: 0.07,
    weightByDepth: [[0,0.10],[3,0.25],[6,0.35]],
    hp: [[0,5,0.8],[5,8,1.0]], atk: [[0,2,0.5],[5,3,0.6]], xp: [[0,8,1.0],[5,12,1.2]], equipChance: 0.50
  },
  { id: "troll", glyph: "T", color: "#e0af68", tier: 2, blockBase: 0.08,
    weightByDepth: [[0,0.25],[3,0.35],[6,0.25]],
    hp: [[0,6,0.8]], atk: [[0,2,0.33]], xp: [[0,12,1.0]], equipChance: 0.55
  },
  { id: "orc", glyph: "o", color: "#a3e635", tier: 2, blockBase: 0.08,
    weightByDepth: [[0,0.05],[3,0.20],[6,0.25]],
    hp: [[0,7,0.9],[5,10,1.1]], atk: [[0,2,0.5],[5,3,0.6]], xp: [[0,12,1.2],[5,18,1.4]], equipChance: 0.60
  },
  { id: "ogre", glyph: "O", color: "#f7768e", tier: 3, blockBase: 0.10,
    weightByDepth: [[0,0.05],[3,0.15],[6,0.20]],
    hp: [[0,10,1.2]], atk: [[0,3,0.5]], xp: [[0,20,2.0]], equipChance: 0.75
  },
  { id: "bandit", glyph: "b", color: "#c59d5f", tier: 2, blockBase: 0.09,
    weightByDepth: [[0,0.08],[3,0.20],[6,0.30]],
    hp: [[0,6,0.7],[5,9,0.9]], atk: [[0,2,0.45],[5,3,0.55]], xp: [[0,10,1.1],[5,15,1.3]], equipChance: 0.65
  },
  { id: "mime_ghost", glyph: "m", color: "#e6eec7", tier: 1, blockBase: 0.06,
    weightByDepth: [[0,0.15],[3,0.20],[6,0.20]],
    hp: [[0,3,0.5]], atk: [[0,1,0.25]], xp: [[0,5,0.5]], equipChance: 0.65
  },
  { id: "hell_houndin", glyph: "h", color: "#d65d5d", tier: 3, blockBase: 0.07,
    weightByDepth: [[0,0.02],[3,0.08],[6,0.12]],
    hp: [[0,5,0.9]], atk: [[0,2,0.33]], xp: [[0,14,1.0]], equipChance: 0.60
  },
];

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

    const def = {
      key,
      glyph: row.glyph || "?",
      color: row.color || "#cbd5e1",
      tier: Number(row.tier || 1),
      blockBase: typeof row.blockBase === "number" ? row.blockBase : 0.06,
      // raw data kept for stat resolution
      _hp: row.hp || [],
      _atk: row.atk || [],
      _xp: row.xp || [],
      _equipChance: typeof row.equipChance === "number" ? row.equipChance : 0.35,
      _weightByDepth: row.weightByDepth || [],
      hp(depth) { return linearAt(this._hp, depth, 3); },
      atk(depth) { return linearAt(this._atk, depth, 1); },
      xp(depth)  { return linearAt(this._xp, depth, 5); },
      weight(depth) { return weightFor(this, depth); },
      equipChance: typeof row.equipChance === "number" ? row.equipChance : 0.35,
      // Optional embedded loot pools (weapons/armor/potions)
      lootPools: (row.lootPools && typeof row.lootPools === "object") ? row.lootPools : null,
      // Optional faction (AI hostility); default handled elsewhere
      faction: row.faction || undefined,
    };
    TYPES[key] = def;
    TYPES[String(key).toLowerCase()] = def; // alias lower-case for lookups
  }
}

export function listTypes() {
  // Return only primary keys (not lower-case aliases)
  const out = [];
  for (const k of Object.keys(TYPES)) {
    if (TYPES[k] && TYPES[k].key === k) out.push(k);
  }
  return out;
}

export function getTypeDef(type) {
  return TYPES[type] || TYPES[String(type || "").toLowerCase()] || null;
}

export function getDefById(id) {
  return getTypeDef(id);
}

export function ensureLoaded() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const hasTypes = !!(TYPES && Object.keys(TYPES).length > 0);
    if (!hasTypes) {
      if (GD && Array.isArray(GD.enemies) && GD.enemies.length > 0) {
        applyJsonEnemies(GD.enemies);
      } else {
        // Fallback to built-in defaults to avoid mass fallback enemies
        applyJsonEnemies(DEFAULT_ENEMIES);
      }
    }
  } catch (_) {}
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
    return (typeof rng === "function") ? rng : null;
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
    getDefById,
    ensureLoaded,
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