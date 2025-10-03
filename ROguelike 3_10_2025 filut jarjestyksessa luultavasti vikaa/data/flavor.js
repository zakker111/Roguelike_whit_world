/**
 * Flavor: lightweight combat flavor messages.
 *
 * Exports (window.Flavor):
 * - logHit(ctx, { attacker, loc, crit })
 * - logPlayerHit(ctx, { target, loc, crit, dmg })
 * - announceFloorEnemyCount(ctx)
 *
 * Behavior:
 * - Occasionally logs an extra flavor line when the player is hit or when the player hits an enemy,
 *   based on hit location and whether it was a critical.
 * - Uses ctx.rng for determinism and ctx.log for output.
 */
(function () {
  // Pick helper: prefer ctx.utils.pick for consistency; fallback to ctx.rng
  function pickFrom(arr, ctx) {
    if (ctx && ctx.utils && typeof ctx.utils.pick === "function") {
      return ctx.utils.pick(arr, ctx.rng);
    }
    const r = (ctx && typeof ctx.rng === "function")
      ? ctx.rng
      : (typeof window !== "undefined" && window.RNG && typeof RNG.rng === "function" ? RNG.rng : Math.random);
    return arr[Math.floor(r() * arr.length)];
  }

  // Simple flavor pools
  const HEAD_CRIT = [
    "A brutal crack to the skull; your ears ring.",
    "You take a hard hit to the head; your ears ring.",
  ];

  const TORSO_STING_PLAYER = [
    "A sharp jab to your ribs knocks the wind out.",
    "You clutch your ribs; the hit steals your breath.",
  ];

  const BLOOD_SPILL = [
    "Blood spills across the floor.",
    "Dark blood splashes on the stone.",
    "A stain spreads underfoot.",
  ];

  /**
   * Log an optional flavor line for an enemy hit against the player.
   * ctx: { rng():fn, log(msg, type?):fn, utils?:{pick} }
   * opts: { attacker:{type?}, loc:{part}, crit:boolean }
   */
  function logHit(ctx, opts) {
    if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
    const attacker = (opts && opts.attacker) || {};
    const loc = (opts && opts.loc) || {};
    const crit = !!(opts && opts.crit);

    // Prioritize memorable moments
    if (crit && loc.part === "head") {
      if (ctx.rng() < 0.6) {
        ctx.log(pickFrom(HEAD_CRIT, ctx), "flavor");
      }
      return;
    }

    if (loc.part === "torso") {
      if (ctx.rng() < 0.5) {
        ctx.log(pickFrom(TORSO_STING_PLAYER, ctx), "info");
      }
      return;
    }
  }

  // --- Player hitting enemies ---
  const ENEMY_TORSO_STING = [
    "You jab its ribs; it wheezes.",
    "A punch to its ribs knocks the wind out.",
  ];

  /**
   * Log an optional flavor line for when the player hits an enemy.
   * ctx: { rng():fn, log(msg, type?):fn, utils?:{pick} }
   * opts: { target:{type?}, loc:{part}, crit:boolean, dmg:number }
   */
  function logPlayerHit(ctx, opts) {
    if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
    const target = (opts && opts.target) || {};
    const loc = (opts && opts.loc) || {};
    const crit = !!(opts && opts.crit);
    const dmg = (opts && typeof opts.dmg === "number") ? opts.dmg : null;

    // Blood spill flavor (pairs with decals). Keep brief and not on every hit.
    if (dmg != null && dmg > 0) {
      const p = crit ? 0.5 : 0.25; // higher chance on crits
      if (ctx.rng() < p) {
        ctx.log(pickFrom(BLOOD_SPILL, ctx), "flavor");
      }
    }

    // Strong crit to head -> yellow notice, include enemy and location
    if (crit && loc.part === "head") {
      if (ctx.rng() < 0.6) {
        const name = (target && target.type) ? target.type : "enemy";
        const variants = [
          `A clean crack to the ${name}'s head; it reels.`,
          `Your strike slams the ${name}'s head; it staggers.`,
        ];
        ctx.log(pickFrom(variants, ctx), "notice");
      }
      return;
    }

    // Good damage (more frequent): absolute >= 2.0 -> green "good"
    if (!crit && dmg != null && dmg >= 2.0) {
      if (ctx.rng() < 0.8) {
        const name = (target && target.type) ? target.type : "enemy";
        const part = (loc && loc.part) ? loc.part : "body";
        const variants = [
          `A heavy blow to the ${name}'s ${part}!`,
          `A solid hit to the ${name}'s ${part}!`,
          `A telling strike to the ${name}'s ${part}!`,
        ];
        ctx.log(pickFrom(variants, ctx), "good");
      }
      // continue; allow location-specific line below
    }

    if (loc.part === "torso") {
      if (ctx.rng() < 0.5) {
        ctx.log(pickFrom(ENEMY_TORSO_STING, ctx), "info");
      }
      return;
    }
  }

  /**
   * Announce total enemies present on the floor (once per floor start).
   * Always logs a concise summary using ctx.enemies.length.
   * ctx: { enemies:Array, log:fn }
   */
  function announceFloorEnemyCount(ctx) {
    if (!ctx || typeof ctx.log !== "function" || !Array.isArray(ctx.enemies)) return;
    const n = ctx.enemies.length | 0;
    if (n <= 0) {
      ctx.log("You sense no enemies on this floor.", "notice");
    } else if (n === 1) {
      ctx.log("You sense 1 enemy on this floor.", "notice");
    } else {
      ctx.log(`You sense ${n} enemies on this floor.`, "notice");
    }
  }

  window.Flavor = { logHit, logPlayerHit, announceFloorEnemyCount };
})();