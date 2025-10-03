/**
 * TimeHooks: time and resting flows extracted from game.js.
 *
 * API (globals on window.TimeHooks):
 *  - minutesUntil(ctx, hourTarget, minuteTarget=0) -> number
 *  - advanceTimeMinutes(ctx, mins) -> void
 *  - restUntilMorning(ctx, healFraction=0.25) -> void
 *  - restAtInn(ctx) -> void
 */
(function () {
  function minutesUntil(ctx, hourTarget, minuteTarget = 0) {
    // Prefer game-provided function
    if (typeof ctx.minutesUntil === "function") {
      return ctx.minutesUntil(hourTarget, minuteTarget);
    }
    // Fallback using ctx.time snapshot
    const DAY_MINUTES = 24 * 60;
    const t = (typeof ctx.getClock === "function") ? ctx.getClock() : (ctx.time || { hours: 0, minutes: 0 });
    const cur = t.hours * 60 + t.minutes;
    const goal = (((hourTarget | 0) * 60 + (minuteTarget | 0)) + DAY_MINUTES) % DAY_MINUTES;
    let delta = goal - cur;
    if (delta <= 0) delta += DAY_MINUTES;
    return delta;
  }

  function advanceTimeMinutes(ctx, mins) {
    if (typeof ctx.advanceTime === "function") {
      ctx.advanceTime(mins);
      return;
    }
    // Fallback no-op if game does not expose advanceTime
  }

  function restUntilMorning(ctx, healFraction = 0.25) {
    const mins = minutesUntil(ctx, 6, 0);
    advanceTimeMinutes(ctx, mins);
    const heal = Math.max(1, Math.floor(ctx.player.maxHp * healFraction));
    const prev = ctx.player.hp;
    ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + heal);
    if (ctx.log) ctx.log(`You rest until morning (${(typeof ctx.getClock === "function" ? ctx.getClock().hhmm : (ctx.time?.hhmm || ""))}). HP ${prev.toFixed(1)} -> ${ctx.player.hp.toFixed(1)}.`, "good");
    if (ctx.updateUI) ctx.updateUI();
    if (ctx.requestDraw) ctx.requestDraw();
  }

  function restAtInn(ctx) {
    const mins = minutesUntil(ctx, 6, 0);
    advanceTimeMinutes(ctx, mins);
    const prev = ctx.player.hp;
    ctx.player.hp = ctx.player.maxHp;
    if (ctx.log) ctx.log(`You spend the night at the inn. You wake up fully rested at ${(typeof ctx.getClock === "function" ? ctx.getClock().hhmm : (ctx.time?.hhmm || ""))}.`, "good");
    if (ctx.updateUI) ctx.updateUI();
    if (ctx.requestDraw) ctx.requestDraw();
  }

  window.TimeHooks = {
    minutesUntil,
    advanceTimeMinutes,
    restUntilMorning,
    restAtInn,
  };
})();