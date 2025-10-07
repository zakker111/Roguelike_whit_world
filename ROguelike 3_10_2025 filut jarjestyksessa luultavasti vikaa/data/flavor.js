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
 * - Deterministic via ctx.rng; if JSON is missing or a pool is absent, it skips logging (no hardcoded duplicates).
 */
(function () {
  function pickFrom(arr, ctx) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
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
    if (typeof str !== "string") return "";
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars) ? String(vars[k]) : "");
  }

  function pools() {
    try {
      if (typeof window !== "undefined" && window.GameData && GameData.flavor && typeof GameData.flavor === "object") {
        return GameData.flavor;
      }
    } catch (_) {}
    return null;
  }

  function logHit(ctx, opts) {
    if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
    const loc = (opts && opts.loc) || {};
    const crit = !!(opts && opts.crit);
    const P = pools(); if (!P) return;

    if (crit && loc.part === "head") {
      const line = pickFrom(P.headCrit, ctx);
      if (line && ctx.rng() < 0.6) ctx.log(line, "flavor");
      return;
    }
    if (loc.part === "torso") {
      const line = pickFrom(P.torsoStingPlayer, ctx);
      if (line && ctx.rng() < 0.5) ctx.log(line, "info");
      return;
    }
  }

  function logPlayerHit(ctx, opts) {
    if (!ctx || typeof ctx.log !== "function" || typeof ctx.rng !== "function") return;
    const target = (opts && opts.target) || {};
    const loc = (opts && opts.loc) || {};
    const crit = !!(opts && opts.crit);
    const dmg = (opts && typeof opts.dmg === "number") ? opts.dmg : null;
    const P = pools(); if (!P) return;

    // Blood spill flavor
    if (dmg != null && dmg > 0) {
      const line = pickFrom(P.bloodSpill, ctx);
      const p = crit ? 0.5 : 0.25;
      if (line && ctx.rng() < p) ctx.log(line, "flavor");
    }

    // Crit head variants
    if (crit && loc.part === "head") {
      const name = (target && target.type) ? target.type : "enemy";
      const tmplStr = pickFrom(P.playerCritHeadVariants, ctx);
      if (tmplStr && ctx.rng() < 0.6) ctx.log(tmpl(tmplStr, { name }), "notice");
      return;
    }

    // Good damage variants
    if (!crit && dmg != null && dmg >= 2.0) {
      const name = (target && target.type) ? target.type : "enemy";
      const part = (loc && loc.part) ? loc.part : "body";
      const tmplStr = pickFrom(P.playerGoodHitVariants, ctx);
      if (tmplStr && ctx.rng() < 0.8) ctx.log(tmpl(tmplStr, { name, part }), "good");
    }

    if (loc.part === "torso") {
      const line = pickFrom(P.enemyTorsoSting, ctx);
      if (line && ctx.rng() < 0.5) ctx.log(line, "info");
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