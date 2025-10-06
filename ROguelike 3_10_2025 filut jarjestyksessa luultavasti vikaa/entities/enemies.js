/**
 * Enemies: registry and helpers.
 *
 * Exports (window.Enemies):
 * - TYPES, pickType(depth, rng), createEnemyAt(x, y, depth, rng)
 * - colorFor(type), glyphFor(type)
 * - equipTierFor(type), equipChanceFor(type), potionWeightsFor(type)
 * - levelFor(type, depth, rng), damageMultiplier(level), enemyBlockChance(enemy, loc)
 *
 * Notes:
 * - Weighted spawn selection with depth-dependent weights.
 * - All randomness accepts an rng() for determinism.
 */
(function () {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Enemy type registry: define base stats, behavior weights, visuals
  // TYPES registry now can be extended from JSON at runtime
  const TYPES = {
    // keep minimal defaults, will be augmented by JSON
    goblin: {
      key: "goblin",
      glyph: "g",
      color: "#8bd5a0",
      tier: 1,
      blockBase: 0.06,
      weight(depth) { return depth <= 2 ? 0.70 : 0.50; },
      hp(depth) { return 3 + Math.floor(depth / 2); },
      atk(depth) { return 1 + Math.floor(depth / 4); },
      xp(depth) { return 5 + Math.floor(depth / 2); },
      potionWeights: { lesser: 0.60, average: 0.30, strong: 0.10 },
      equipChance: 0.35,
    },
    troll: {
      key: "troll",
      glyph: "T",
      color: "#e0af68",
      tier: 2,
      blockBase: 0.08,
      weight(depth) { return depth <= 2 ? 0.25 : 0.35; },
      hp(depth) { return 6 + Math.floor(depth * 0.8); },
      atk(depth) { return 2 + Math.floor(depth / 3); },
      xp(depth) { return 12 + depth; },
      potionWeights: { lesser: 0.50, average: 0.35, strong: 0.15 },
      equipChance: 0.55,
    },
    ogre: {
      key: "ogre",
      glyph: "O",
      color: "#f7768e",
      tier: 3,
      blockBase: 0.10,
      weight(depth) { return depth <= 2 ? 0.05 : 0.15; },
      hp(depth) { return 10 + Math.floor(depth * 1.2); },
      atk(depth) { return 3 + Math.floor(depth / 2); },
      xp(depth) { return 20 + 2 * depth; },
      potionWeights: { lesser: 0.40, average: 0.35, strong: 0.25 },
      equipChance: 0.75,
    },
  };

  function applyJsonEnemies(json) {
    if (!Array.isArray(json)) return;
    for (const row of json) {
      const key = row.id || row.key;
      if (!key) continue;
      const base = TYPES[key] || {};
      function weight(depth) {
        const table = row.weightByDepth || [];
        if (!table.length) return typeof base.weight === "function" ? base.weight(depth) : 0.0;
        // pick the last entry whose minDepth <= depth
        let w = 0;
        for (const entry of table) {
          const minD = entry[0] | 0;
          const weight = Number(entry[1] || 0);
          if (depth >= minD) w = weight;
        }
        return w;
      }
      function linearAt(arr, depth) {
        // arr: [ [minDepth, base, slope] ... ] choose last <= depth and evaluate base + slope * (depth - minDepth)
        if (!Array.isArray(arr) || arr.length === 0) return 1;
        let chosen = arr[0];
        for (const e of arr) {
          if ((e[0] | 0) <= depth) chosen = e;
        }
        const minD = chosen[0] | 0, baseV = Number(chosen[1] || 1), slope = Number(chosen[2] || 0);
        const delta = Math.max(0, depth - minD);
        return Math.max(1, Math.floor(baseV + slope * delta));
      }
      TYPES[key] = {
        key,
        glyph: row.glyph || base.glyph || "?",
        color: row.color || base.color || "#cbd5e1",
        tier: Number(row.tier || base.tier || 1),
        blockBase: typeof row.blockBase === "number" ? row.blockBase : (base.blockBase || 0.06),
        weight,
        hp(depth) { return linearAt(row.hp, depth); },
        atk(depth) { return linearAt(row.atk, depth); },
        xp(depth)  { return linearAt(row.xp, depth); },
        potionWeights: row.potionWeights || base.potionWeights || { lesser: 0.6, average: 0.3, strong: 0.1 },
        equipChance: typeof row.equipChance === "number" ? row.equipChance : (base.equipChance || 0.35),
      };
    }
  }

  function listTypes() {
    return Object.keys(TYPES);
  }

  function getTypeDef(type) {
    return TYPES[type] || TYPES.goblin;
  }

  function colorFor(type) {
    return getTypeDef(type).color;
  }

  function glyphFor(type) {
    return getTypeDef(type).glyph;
  }

  function equipTierFor(type) {
    return getTypeDef(type).tier;
  }

  function equipChanceFor(type) {
    return getTypeDef(type).equipChance;
  }

  function potionWeightsFor(type) {
    return getTypeDef(type).potionWeights;
  }

  function pickType(depth, rng) {
    const entries = listTypes().map((k) => ({ key: k, w: getTypeDef(k).weight(depth) }));
    const total = entries.reduce((s, e) => s + e.w, 0);
    let r = ((typeof rng === "function") ? rng() : ((typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function") ? RNG.rng() : Math.random())) * total;
    for (const e of entries) {
      if (r < e.w) return e.key;
      r -= e.w;
    }
    return entries[0].key;
  }

  function levelFor(type, depth, rng) {
    const tierAdj = type === "ogre" ? 2 : type === "troll" ? 1 : 0;
    const jitter = rng && rng() < 0.35 ? 1 : 0;
    return Math.max(1, depth + tierAdj + jitter);
  }

  function damageMultiplier(level) {
    return 1 + 0.15 * Math.max(0, (level || 1) - 1);
  }

  function enemyBlockChance(enemy, loc) {
    const base = getTypeDef(enemy.type).blockBase;
    return clamp(base * (loc?.blockMod || 1.0), 0, 0.35);
  }

  function createEnemyAt(x, y, depth, rng) {
    const type = pickType(depth, rng);
    const t = getTypeDef(type);
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

  // If GameData is present, extend TYPES after data is ready
  try {
    if (window.GameData && GameData.ready && typeof GameData.ready.then === "function") {
      GameData.ready.then(() => {
        try { applyJsonEnemies(GameData.enemies); } catch (_) {}
      });
    } else if (window.GameData && Array.isArray(GameData.enemies)) {
      applyJsonEnemies(GameData.enemies);
    }
  } catch (_) {}

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
})();