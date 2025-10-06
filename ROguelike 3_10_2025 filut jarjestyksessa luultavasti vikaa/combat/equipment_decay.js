/**
 * EquipmentDecayService: centralized equipment wear/decay functions.
 *
 * Exports (window.EquipmentDecay):
 * - initialDecay(tier, rng?)
 * - decayEquipped(player, slot, amount, hooks?)
 * - decayAttackHands(player, rng, opts?, hooks?)  // opts: { twoHanded?: boolean, light?: boolean }
 * - decayBlockingHands(player, rng, opts?, hooks?)
 */
(function () {
  function round1(n) { return Math.round(n * 10) / 10; }

  function initialDecay(tier, rng) {
    try {
      if (window.Items && typeof Items.initialDecay === "function") {
        return Items.initialDecay(tier, rng);
      }
    } catch (_) {}
    // Fallback (mirrors game.js/items.js behavior)
    const r = (typeof rng === "function")
      ? rng
      : ((typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function")
          ? RNG.rng
          : ((typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function")
              ? RNGFallback.getRng()
              : Math.random));
    const float = (min, max, decimals = 0) => {
      const v = min + r() * (max - min);
      const p = Math.pow(10, decimals);
      return Math.round(v * p) / p;
    };
    if (tier <= 1) return float(10, 35, 0);
    if (tier === 2) return float(5, 20, 0);
    return float(0, 10, 0);
  }

  function decayEquipped(player, slot, amount, hooks) {
    hooks = hooks || {};
    const log = hooks.log || (typeof window !== "undefined" && window.Logger && Logger.log ? Logger.log : (() => {}));
    const updateUI = hooks.updateUI || (() => {});
    const onInventoryChange = hooks.onInventoryChange || (() => {});
    const Flavor = (typeof window !== "undefined") ? window.Flavor : null;

    try {
      if (window.Player && typeof Player.decayEquipped === "function") {
        Player.decayEquipped(player, slot, amount, { log, updateUI, onInventoryChange });
        return;
      }
    } catch (_) {}

    const it = player.equipment?.[slot];
    if (!it) return;

    const before = it.decay || 0;
    it.decay = Math.min(100, round1(before + amount));
    if (it.decay >= 100) {
      log(`${(it.name || "item")[0].toUpperCase()}${(it.name || "item").slice(1)} breaks and is destroyed.`, "bad");
      try {
        if (Flavor && typeof Flavor.onBreak === "function") {
          Flavor.onBreak({ player }, { side: "player", slot, item: it });
        }
      } catch (_) {}
      player.equipment[slot] = null;
      updateUI();
      onInventoryChange();
    } else if (Math.floor(before) !== Math.floor(it.decay)) {
      onInventoryChange();
    }
  }

  function decayAttackHands(player, rng, opts, hooks) {
    opts = opts || {};
    hooks = hooks || {};
    const twoHanded = !!opts.twoHanded;
    const light = !!opts.light;

    const eq = player.equipment || {};
    const float = (min, max) => {
      const rv = (typeof rng === "function")
        ? rng()
        : ((typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function")
            ? RNG.rng()
            : ((typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function")
                ? RNGFallback.getRng()()
                : Math.random()));
      const v = min + rv * (max - min);
      return Math.round(v * 10) / 10;
    };
    const amtMain = light ? float(0.6, 1.6) : float(1.0, 2.2);

    if (twoHanded) {
      if (eq.left) decayEquipped(player, "left", amtMain, hooks);
      if (eq.right) decayEquipped(player, "right", amtMain, hooks);
      return;
    }
    const leftAtk = (eq.left && typeof eq.left.atk === "number") ? eq.left.atk : 0;
    const rightAtk = (eq.right && typeof eq.right.atk === "number") ? eq.right.atk : 0;
    if (leftAtk >= rightAtk && leftAtk > 0) {
      decayEquipped(player, "left", amtMain, hooks);
    } else if (rightAtk > 0) {
      decayEquipped(player, "right", amtMain, hooks);
    } else if (eq.left) {
      decayEquipped(player, "left", amtMain, hooks);
    } else if (eq.right) {
      decayEquipped(player, "right", amtMain, hooks);
    }
  }

  function decayBlockingHands(player, rng, opts, hooks) {
    opts = opts || {};
    hooks = hooks || {};
    const twoHanded = !!opts.twoHanded;

    const eq = player.equipment || {};
    const float = (min, max) => {
      const r = (typeof rng === "function")
        ? rng()
        : ((typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function")
            ? RNG.rng()
            : ((typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function")
                ? RNGFallback.getRng()()
                : (function () {
                    // deterministic last resort
                    const seed = ((Date.now() % 0xffffffff) >>> 0);
                    function mulberry32(a) {
                      return function () {
                        let t = a += 0x6D2B79F5;
                        t = Math.imul(t ^ (t >>> 15), t | 1);
                        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                      };
                    }
                    return mulberry32(seed)();
                  })()));
      const v = min + r * (max - min);
      return Math.round(v * 10) / 10;
    };
    const amt = float(0.6, 1.6);

    if (twoHanded) {
      if (eq.left) decayEquipped(player, "left", amt, hooks);
      if (eq.right) decayEquipped(player, "right", amt, hooks);
      return;
    }
    const leftDef = (eq.left && typeof eq.left.def === "number") ? eq.left.def : 0;
    const rightDef = (eq.right && typeof eq.right.def === "number") ? eq.right.def : 0;
    if (rightDef >= leftDef && eq.right) {
      decayEquipped(player, "right", amt, hooks);
    } else if (eq.left) {
      decayEquipped(player, "left", amt, hooks);
    }
  }

  window.EquipmentDecay = {
    initialDecay,
    decayEquipped,
    decayAttackHands,
    decayBlockingHands,
  };
})();