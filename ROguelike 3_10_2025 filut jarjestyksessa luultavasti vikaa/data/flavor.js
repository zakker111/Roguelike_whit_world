/**
 * Flavor: lightweight combat flavor messages loaded from JSON (GameData.flavor).
 *
 * Exports (window.Flavor):
 * - logHit(ctx, { attacker, loc, crit })
 * - logPlayerHit(ctx, { target, loc, crit, dmg })
 * - announceFloorEnemyCount(ctx)
 *
 * Behavior:
 * - Logs flavor lines based on hit location and crits using pools from GameData.flavor.
 * - Deterministic via ctx.rng; falls back to built-in defaults if JSON is missing.
 */
(function () {
  function pickFrom(arr, ctx) {
    if (ctx && ctx.utils && typeof ctx.utils.pick === "function") {
      return ctx.utils.pick(arr, ctx.rng);
    }
    const r = (ctx && typeof ctx.rng === "function")
      ? ctx.rng
      : (typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function"
        ? RNG.rng
        : (typeof window !== "undefined" && window.RNGFallback && typeof RNGFallback.getRng === "function"
            ? RNGFallback.getRng()
            : Math.random));
    return arr[Math.floor(r() * arr.length)];
  }

  function tmpl(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars) ? String(vars[k]) : "");
  }

  // Defaults (used when GameData.flavor missing or incomplete)
  const DEFAULT = {
    headCrit: [
      "A brutal crack to the skull; your ears ring.",
      "You take a hard hit to the head; your ears ring."
    ],
    torsoStingPlayer: [
      "A sharp jab to your ribs knocks the wind out.",
      "You clutch your ribs; the hit steals your breath."
    ],
    bloodSpill: [
      "Blood spills across the floor.",
      "Dark blood splashes on the stone.",
      "A stain spreads underfoot."
    ],
    enemyTorsoSting: [
      "You jab its ribs; it wheezes.",
      "A punch to its ribs knocks the wind out."
    ],
    playerCritHeadVariants: [
      "A clean crack to the {name}'s head; it reels.",
      "Your strike slams the {name}'s head; it staggers."
    ],
    playerGoodHitVariants: [
      "A heavy blow to the {name}'s {part}!",
      "A solid hit to the {name}'s {part}!",
      "A telling strike to the {name}'s {part}!"
    ]
  };

  function F() {
    try {
      if (typeof window !== "undefined" && window.GameData && GameData.flavor && typeof GameData.flavor === "object") {
        return GameData.flavor;
      }
    } catch (_) {}
    return DEFAULT;
  }

  function logHit(ctx, opts) {
    if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
    const loc = (opts && opts.loc) || {};
    const crit = !!(opts && opts.crit);
    const pools = F();

    if (crit && loc.part === "head") {
      const arr = Array.isArray(pools.headCrit) ? pools.headCrit : DEFAULT.headCrit;
      if (ctx.rng() < 0.6) ctx.log(pickFrom(arr, ctx), "flavor");
      return;
    }
    if (loc.part === "torso") {
      const arr = Array.isArray(pools.torsoStingPlayer) ? pools.torsoStingPlayer : DEFAULT.torsoStingPlayer;
      if (ctx.rng() < 0.5) ctx.log(pickFrom(arr, ctx), "info");
      return;
    }
  }

  function logPlayerHit(ctx, opts) {
    if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
    const target = (opts && opts.target) || {};
    const loc = (opts && opts.loc) || {};
    const crit = !!(opts && opts.crit);
    const dmg = (opts && typeof opts.dmg === "number") ? opts.dmg : null;
    const pools = F();

    // Blood spill flavor
    if (dmg != null && dmg > 0) {
      const p = crit ? 0.5 : 0.25;
      const arr = Array.isArray(pools.bloodSpill) ? pools.bloodSpill : DEFAULT.bloodSpill;
      if (ctx.rng() < p) ctx.log(pickFrom(arr, ctx), "flavor");
    }

    // Crit head variants
    if (crit && loc.part === "head") {
      const name = (target && target.type) ? target.type : "enemy";
      const arr = Array.isArray(pools.playerCritHeadVariants) ? pools.playerCritHeadVariants : DEFAULT.playerCritHeadVariants;
      if (ctx.rng() < 0.6) ctx.log(tmpl(pickFrom(arr, ctx), { name }), "notice");
      return;
    }

    // Good damage variants
    if (!crit && dmg != null && dmg >= 2.0) {
      const name = (target && target.type) ? target.type : "enemy";
      const part = (loc && loc.part) ? loc.part : "body";
      const arr = Array.isArray(pools.playerGoodHitVariants) ? pools.playerGoodHitVariants : DEFAULT.playerGoodHitVariants;
      if (ctx.rng() < 0.8) ctx.log(tmpl(pickFrom(arr, ctx), { name, part }), "good");
    }

    if (loc.part === "torso") {
      const arr = Array.isArray(pools.enemyTorsoSting) ? pools.enemyTorsoSting : DEFAULT.enemyTorsoSting;
      if (ctx.rng() < 0.5) ctx.log(pickFrom(arr, ctx), "info");
      return;
    }
  }

  function announceFloorEnemyCount(ctx) {
    if (!ctx || typeof ctx.log !== "function" || !Array.isArray(ctx.enemies)) return;
    const n = ctx.enemies.length | 0;
    if (n <= 0) ctx.log("You sense no enemies on this floor.", "notice");
    else if (n === 1) ctx.log("You sense 1 enemy on this floor.", "notice");
    else ctx.log(`You sense ${n} enemies on this floor.`, "notice");
  }

  window.Flavor = { logHit, logPlayerHit, announceFloorEnemyCount };
})();