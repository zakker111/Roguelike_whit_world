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
  const TYPES = {
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

    mime_ghost: {
      key: "mime_ghost",
      glyph: "m",
      color: "#e6eec7",
      tier: 1,
      blockBase: 0.06,
      // Make mime_ghost significantly rarer than goblins
      weight(depth) { return depth <= 2 ? 0.15 : 0.20; },
      hp(depth) { return 3 + Math.floor(depth / 2); },
      atk(depth) { return 1 + Math.floor(depth / 4); },
      xp(depth) { return 5 + Math.floor(depth / 2); },
      potionWeights: { lesser: 0.60, average: 0.30, strong: 0.10 },
      equipChance: 0.65,
    },

    seppo: {
      key: "seppo",
      glyph: "s",
      color: "#101942",
      tier: 2,
      blockBase: 0.06,
      // make seppo rare
      weight(depth) { return depth <= 2 ? 0.15 : 0.20; },
      hp(depth) { return 3 + Math.floor(depth / 2); },
      atk(depth) { return 1 + Math.floor(depth / 4); },
      xp(depth) { return 5 + Math.floor(depth / 2); },
      potionWeights: { lesser: 0.30, average: 0.30, strong: 0.20 },
      equipChance: 0.50,
    },

    hell_houndin: {
      key: "hell_houndin",
      glyph: "h",
      color: "#d65d5d",
      tier: 3,
      blockBase: 0.07,
      weight(depth) { return depth <= 2 ? 0.02 : 0.08; },
      hp(depth) { return 5 + Math.floor(depth * 0.9); },
      atk(depth) { return 2 + Math.floor(depth / 3); },
      xp(depth) { return 14 + Math.floor(depth); },
      potionWeights: { lesser: 0.45, average: 0.35, strong: 0.20 },
      equipChance: 0.60,
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

    // Example enemy template (reference; weight() returns 0 so it won't spawn)
    example_enemy: {
      key: "example_enemy",
      glyph: "S",
      color: "#cbd5e1",
      tier: 2,
      blockBase: 0.07,
      weight(depth) { return 0; },
      hp(depth) { return 5 + Math.floor(depth * 0.7); },
      atk(depth) { return 2 + Math.floor(depth / 3); },
      xp(depth) { return 10 + depth; },
      potionWeights: { lesser: 0.55, average: 0.35, strong: 0.10 },
      equipChance: 0.50,
    },
  };

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