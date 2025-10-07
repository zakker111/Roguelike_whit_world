/**
 * Items: data-driven equipment registry with deterministic RNG.
 *
 * Exports (window.Items):
 * - createEquipment(tier, rng), createEquipmentOfSlot(slot, tier, rng)
 * - createByKey(key, tier, rng, overrides?), createNamed(config, rng)
 * - addType(slot, def), describe(item), initialDecay(tier, rng?), MATERIALS, TYPES
 *
 * Notes:
 * - TYPES is a flat registry keyed by item key (similar to Enemies).
 * - Per-type .weight can be a number or a function of tier.
 * - All random rolls use the supplied rng() when provided for determinism.
 */
(function () {
  const round1 = (n) => Math.round(n * 10) / 10;

  // RNG selection: prefer centralized RNG service, otherwise use shared fallback
  function getRng(rng) {
    if (typeof rng === "function") return rng;
    try {
      if (typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function") {
        if (typeof RNG.getSeed !== "function" || RNG.getSeed() == null) {
          if (typeof RNG.autoInit === "function") RNG.autoInit();
        }
        return RNG.rng;
      }
    } catch (_) {}
    // Shared fallback for determinism without duplicating PRNG implementations
    try {
      if (typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function") {
        return RNGFallback.getRng();
      }
    } catch (_) {}
    // Ultimate fallback: non-deterministic
    return Math.random;
  }

  /* MATERIALS: map numeric tier (1..3) to material name used by item name builders */
  const MATERIALS = {
    1: "rusty",
    2: "iron",
    3: "steel",
  };

  // Item types registry (flat, enemy-like), keyed by item key
  // TYPES registry is now optionally extended from JSON at load time.
  // Start with a minimal base; JSON will augment/override on loader ready.
  const TYPES = {
    // Kept empty to prefer JSON. Existing code paths still work if JSON missing.
  };

  function applyJsonItems(json) {
    if (!Array.isArray(json)) return;
    const warn = (msg, row) => {
      try {
        if (window.Logger && typeof Logger.log === "function") Logger.log(`[Items] ${msg}`, "warn");
        else if (window.DEV && typeof console !== "undefined") console.warn("[Items] " + msg, row);
      } catch (_) {}
    };
    const VALID_SLOTS = new Set(["hand","head","torso","legs","hands"]);
    for (const row of json) {
      const key = row.id || row.key || row.name;
      if (!key) { warn("Missing id/key for item entry; skipped.", row); continue; }
      if (!row.slot || !VALID_SLOTS.has(row.slot)) { warn(`Invalid or missing slot for item '${key}'; expected one of hand/head/torso/legs/hands.`, row); continue; }
      if (row.twoHanded && row.slot !== "hand") { warn(`twoHanded is true for '${key}' but slot is '${row.slot}'; twoHanded only applies to 'hand'.`, row); }
      const hasAtk = !!row.atk;
      const hasDef = !!row.def;
      if (!hasAtk && !hasDef) { warn(`Item '${key}' has neither atk nor def ranges; it may be useless.`, row); }
      const weights = row.weights || null;
      if (!weights && typeof row.weight !== "number") { warn(`Item '${key}' has no weights; defaulting to 1.0.`, row); }

      const def = {
        key,
        slot: row.slot,
        twoHanded: !!row.twoHanded,
        minTier: Math.max(1, Number(row.tierMin || 1)),
      };
      // weights per tier or flat weight
      def.weight = function (tier) {
        const map = row.weights || {};
        const k = String(Math.max(1, Math.min(3, tier || 1)));
        if (typeof map[k] === "number") return map[k];
        return typeof row.weight === "number" ? row.weight : 1.0;
      };
      // ranges
      if (row.atk) {
        def.atkRange = {
          1: row.atk["1"] || row.atk[1],
          2: row.atk["2"] || row.atk[2],
          3: row.atk["3"] || row.atk[3],
        };
      }
      if (row.def) {
        def.defRange = {
          1: row.def["1"] || row.def[1],
          2: row.def["2"] || row.def[2],
          3: row.def["3"] || row.def[3],
        };
      }
      if (row.handAtkBonus) def.handAtkBonus = { 2: row.handAtkBonus["2"], 3: row.handAtkBonus["3"] };
      if (typeof row.handAtkChance === "number") def.handAtkChance = row.handAtkChance;
      // naming: use provided name as base; still allow material prefixing
      def.name = (mat, tier) => {
        const base = row.name || key;
        if (row.slot === "head" || row.slot === "torso" || row.slot === "legs" || row.slot === "hands") {
          return `${mat} ${base}`;
        }
        return `${mat} ${base}`;
      };
      TYPES[key] = def;
    }
  }

  // SLOT_WEIGHTS: relative chance to pick each equipment slot when generating a random item.
  // Tuning these changes overall drop mix without touching per-type weights inside a slot.
  const SLOT_WEIGHTS = {
    hand: 0.38,
    head: 0.14,
    torso: 0.18,
    legs: 0.16,
    hands: 0.14,
  };

  function randFloat(rng, min, max, decimals = 1) {
    const v = min + rng() * (max - min);
    const p = Math.pow(10, decimals);
    return Math.round(v * p) / p;
  }
  // Pick a value from a list of weighted entries.
  // Accepts objects of shape { value, w } or any object with a 'weight' property.
  // - If total weight <= 0, returns the first entry as a fallback (or its .value if present).
  function pickWeighted(entries, rng) {
    const total = entries.reduce((s, e) => s + (e.w || e.weight || 0), 0);
    if (total <= 0) {
      // Debug hint: sum of weights is non-positive; likely a data/config issue.
      // Keep behavior stable by returning the first entry.
      if (typeof console !== "undefined" && console && typeof console.warn === "function") {
        try { console.warn("Items.pickWeighted: total weight <= 0; using first entry.", entries); } catch (_) {}
      }
      return entries[0]?.value ?? entries[0] ?? null;
    }
    let r = rng() * total;
    for (const e of entries) {
      const w = e.w || e.weight || 0;
      if (r < w) return e.value ?? e;
      r -= w;
    }
    return entries[0].value ?? entries[0];
  }

  // initialDecay: starting wear in percent for generated items.
  // Lower tiers begin more worn; higher tiers start closer to pristine.
  function initialDecay(tier, rng) {
    const r = getRng(rng);
    if (tier <= 1) return randFloat(r, 10, 35, 0);
    if (tier === 2) return randFloat(r, 5, 20, 0);
    return randFloat(r, 0, 10, 0);
  }

  function pickSlot(rng) {
    const entries = Object.keys(SLOT_WEIGHTS).map(k => ({ value: k, w: SLOT_WEIGHTS[k] }));
    return pickWeighted(entries, rng);
  }

  function rollStatFromRange(rng, ranges, tier, decimals = 1) {
    const r = ranges?.[tier];
    if (!r) return 0;
    return randFloat(rng, r[0], r[1], decimals);
  }

  // Build a concrete item instance from a type definition at the given tier.
  // - Rolls stats from the tiered ranges (atkRange/defRange)
  // - Applies optional atkBonus biases per tier (e.g., axes lean higher)
  // - Applies optional small hand attack bonus for "hands" slot (gloves)
  // - Carries 'twoHanded' flag through for hand items that occupy both hands
  function makeItemFromType(def, tier, rng) {
    const r = getRng(rng);
    const material = MATERIALS[tier] || "iron";
    const name = typeof def.name === "function" ? def.name(material, tier) : (def.name || (material + " item"));
    const item = {
      kind: "equip",
      slot: def.slot,
      name,
      tier,
      decay: initialDecay(tier, r),
    };

    if (def.atkRange) {
      let atk = rollStatFromRange(r, def.atkRange, tier, 1);
      if (def.atkBonus && def.atkBonus[tier]) {
        atk = Math.min(4.0, round1(atk + randFloat(r, def.atkBonus[tier][0], def.atkBonus[tier][1], 1)));
      }
      if (atk > 0) item.atk = atk;
    }
    if (def.defRange) {
      const defVal = rollStatFromRange(r, def.defRange, tier, 1);
      if (defVal > 0) item.def = defVal;
    }
    if (def.slot === "hands" && def.handAtkBonus && def.handAtkBonus[tier]) {
      const chance = typeof def.handAtkChance === "number" ? def.handAtkChance : 0.5;
      if (r() < chance) {
        const [minB, maxB] = def.handAtkBonus[tier];
        item.atk = (item.atk || 0) + randFloat(r, minB, maxB, 1);
        item.atk = round1(Math.min(4.0, item.atk));
      }
    }
    if (def.twoHanded) {
      item.twoHanded = true;
    }
    return item;
  }

  function pickTypeForSlot(slot, tier, rng) {
    const defs = Object.values(TYPES).filter(d => d.slot === slot && (d.minTier || 1) <= tier);
    if (defs.length === 0) return null;
    const entries = defs.map(d => {
      const w = typeof d.weight === "function" ? d.weight(tier) : (d.weight || 1);
      return { value: d, w: Math.max(0, w) };
    });
    return pickWeighted(entries, getRng(rng));
  }

  // Create a random equipment piece for a specific slot at the given tier.
  // Respects per-type weights within that slot and minTier constraints.
  function createEquipmentOfSlot(slot, tier, rng) {
    const r = getRng(rng);
    const def = pickTypeForSlot(slot, tier, r);
    if (!def) return null;
    return makeItemFromType(def, tier, r);
  }

  // Helpers mirroring Enemies API

  function listTypes() {
    return Object.keys(TYPES);
  }

  function getTypeDef(key) {
    return TYPES[key] || null;
  }

  function typesBySlot(slot) {
    return Object.values(TYPES).filter(t => t.slot === slot);
  }

  function pickType(slot, tier, rng) {
    const defs = typesBySlot(slot).filter(d => (d.minTier || 1) <= tier);
    if (defs.length === 0) return null;
    const entries = defs.map(d => {
      const w = typeof d.weight === "function" ? d.weight(tier) : (d.weight || 1);
      return { value: d, w: Math.max(0, w) };
    });
    return pickWeighted(entries, getRng(rng));
  }

  // Create a random equipment piece at the given tier.
  // Steps:
  // 1) Pick a target slot using SLOT_WEIGHTS
  // 2) Pick a type within that slot based on per-type weights
  // 3) Roll stats and return the item
  // Includes robust fallbacks if the slot has no valid types at this tier.
  function createEquipment(tier, rng) {
    const r = getRng(rng);
    const slot = pickSlot(r);
    const def = pickTypeForSlot(slot, tier, r);
    if (!def) {
      // Fallback: pick any available type
      const any = Object.values(TYPES).filter(d => (d.minTier || 1) <= tier);
      if (any.length) {
        const entries = any.map(d => {
          const w = typeof d.weight === "function" ? d.weight(tier) : (d.weight || 1);
          return { value: d, w: Math.max(0, w) };
        });
        const chosen = pickWeighted(entries, r);
        if (chosen) return makeItemFromType(chosen, tier, r);
      }
      // Ultimate fallback: a simple iron sword
      return { kind: "equip", slot: "hand", name: "iron sword", tier: 2, atk: 1.5, decay: initialDecay(2, r) };
    }
    return makeItemFromType(def, tier, r);
  }

  function describe(item) {
    if (!item) return "";
    if (item.kind === "equip") {
      const parts = [];
      if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
      if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
      return `${item.name}${parts.length ? " (" + parts.join(", ") + ")" : ""}`;
    }
    if (item.kind === "potion") {
      const heal = item.heal ?? 3;
      const base = item.name || `potion (+${heal} HP)`;
      const count = item.count && item.count > 1 ? ` x${item.count}` : "";
      return `${base}${count}`;
    }
    return item.name || "item";
  }

  // Extension helpers

  function addType(slot, def) {
    if (!slot) return false;
    const clean = Object.assign({}, def, { slot });
    if (typeof clean.weight !== "number" && typeof clean.weight !== "function") clean.weight = 1.0;
    if (!clean.key) clean.key = (clean.name && String(clean.name)) || `custom_${Date.now().toString(36)}`;
    TYPES[clean.key] = clean;
    return true;
  }

  function findTypeByKey(key) {
    return TYPES[key] || null;
  }

  function createByKey(key, tier, rng, overrides) {
    const def = findTypeByKey(key);
    const r = getRng(rng);
    if (!def) return null;
    const item = makeItemFromType(def, tier, r);
    if (overrides && typeof overrides === "object") {
      for (const k of Object.keys(overrides)) {
        item[k] = overrides[k];
      }
    }
    return item;
  }

  // Create a deterministic, named equipment item from a minimal config.
  // Useful for scripted rewards, shops, or testing without touching the registry.
  // - slot: one of "hand","head","torso","legs","hands"
  // - tier: 1..3 (clamped); influences default material/decay and stat expectations
  // - name: optional custom display name
  // - atk/def: optional numeric stats (rounded to 1 decimal)
  // - twoHanded: if true and slot is "hand", the item will occupy left+right hands
  // - decay: optional starting wear percent; if omitted, derived from tier
  function createNamed(config, rng) {
    if (!config || typeof config !== "object") return null;
    const { slot, tier, name } = config;
    // Validate against allowed equipment slots instead of the TYPES registry keys
    const VALID_SLOTS = new Set(["hand","head","torso","legs","hands"]);
    if (!slot || !VALID_SLOTS.has(slot)) return null;
    const t = Math.max(1, Math.min(3, tier || 1));
    const r = getRng(rng);
    const item = {
      kind: "equip",
      slot,
      name: name || `${MATERIALS[t] || "iron"} item`,
      tier: t,
      decay: typeof config.decay === "number" ? config.decay : initialDecay(t, r),
    };
    if (typeof config.atk === "number") item.atk = round1(config.atk);
    if (typeof config.def === "number") item.def = round1(config.def);
    if (config.twoHanded) item.twoHanded = true;
    return item;
  }

  // If GameData is present, extend TYPES after data is ready
  try {
    if (window.GameData && GameData.ready && typeof GameData.ready.then === "function") {
      GameData.ready.then(() => {
        try { applyJsonItems(GameData.items); } catch (_) {}
      });
    } else if (window.GameData && Array.isArray(GameData.items)) {
      applyJsonItems(GameData.items);
    }
  } catch (_) {}

  window.Items = {
    // creation
    initialDecay,
    createEquipment,
    createEquipmentOfSlot,
    createByKey,
    createNamed,
    // registry mgmt
    addType,
    // symmetry helpers (enemy-like)
    listTypes,
    getTypeDef,
    typesBySlot,
    pickType,
    // misc
    describe,
    MATERIALS,
    TYPES,
  };
})();