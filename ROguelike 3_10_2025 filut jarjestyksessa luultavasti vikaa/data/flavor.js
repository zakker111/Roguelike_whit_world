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

    const name = (target && target.type) ? target.type : "enemy";
    const part = (loc && loc.part) ? String(loc.part) : "body";

    // Blood spill flavor (independent of location)
    if (dmg != null && dmg > 0) {
      const line = pickFrom(P.bloodSpill, ctx);
      const p = crit ? 0.5 : 0.25;
      if (line && ctx.rng() < p) ctx.log(line, "flavor");
    }

    // Critical hit flavor by body part
    if (crit) {
      let tmplStr = null;
      if (part === "head") {
        tmplStr = pickFrom(P.playerCritHeadVariants, ctx);
      } else if (part === "torso" && Array.isArray(P.playerCritTorsoVariants)) {
        tmplStr = pickFrom(P.playerCritTorsoVariants, ctx);
      } else if (part === "hands" && Array.isArray(P.playerCritHandsVariants)) {
        tmplStr = pickFrom(P.playerCritHandsVariants, ctx);
      } else if (part === "legs" && Array.isArray(P.playerCritLegsVariants)) {
        tmplStr = pickFrom(P.playerCritLegsVariants, ctx);
      } else {
        // Fallback: generic good-hit variants with explicit part mention
        tmplStr = pickFrom(P.playerGoodHitVariants, ctx);
      }
      if (tmplStr && ctx.rng() < 0.7) {
        ctx.log(tmpl(tmplStr, { name, part }), "notice");
      }
      return;
    }

    // Non-crit, good damage variants (by part)
    if (dmg != null && dmg >= 2.0) {
      const tmplStr = pickFrom(P.playerGoodHitVariants, ctx);
      if (tmplStr && ctx.rng() < 0.8) ctx.log(tmpl(tmplStr, { name, part }), "good");
    }

    // Additional torso sting for non-crit torso hits (enemy reaction)
    if (part === "torso") {
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