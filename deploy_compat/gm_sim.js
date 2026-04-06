import * as GMRuntime from "./core/gm/runtime.js";

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function createCtx() {
  return {
    mode: "world",
    time: { turnCounter: 0 },
    utils: { clamp },
    log: () => {},
    gm: null
  };
}

function assert(cond, message, data) {
  if (cond) return;
  const err = new Error(message || "assertion failed");
  err.data = data;
  throw err;
}

function assertEq(actual, expected, message) {
  assert(
    Object.is(actual, expected),
    message || `expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`,
    { expected, actual }
  );
}

function assertClose(actual, expected, tol, message) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  assert(ok, message || `expected ~${expected}±${tol} but got ${actual}`, { expected, actual, tol });
}

function resetAndPrime(ctx, { turn = 0, mode = "world" } = {}) {
  ctx.mode = mode;
  ctx.time.turnCounter = turn;
  GMRuntime.reset(ctx);
  // Prime tick so gm.debug.lastTickTurn matches ctx.time.turnCounter.
  GMRuntime.tick(ctx);
  return GMRuntime.getState(ctx);
}

function settleBoredomAtSameTurn(ctx, targetLevel, steps = 40) {
  const gm = GMRuntime.getState(ctx);
  const t = clamp(targetLevel, 0, 1);

  // Avoid label flips from any prior impulses.
  if (gm.mood) {
    gm.mood.transientValence = 0;
    gm.mood.transientArousal = 0;
  }

  // Use the turnsSince field to define the target boredom, then let smoothing converge.
  gm.boredom.turnsSinceLastInterestingEvent = Math.round(t * 200);

  // Hold the turnCounter constant so tick() performs only smoothing + relabeling.
  for (let i = 0; i < steps; i++) {
    GMRuntime.tick(ctx);
  }

  return {
    level: gm.boredom.level,
    mood: gm.mood && typeof gm.mood.primary === "string" ? gm.mood.primary : null,
    valence: gm.mood ? gm.mood.valence : null,
    arousal: gm.mood ? gm.mood.arousal : null
  };
}

function bypassMechanicHintEarlyGameGuard(gm) {
  gm.stats.totalTurns = Math.max(gm.stats.totalTurns | 0, 30);
  if (!gm.stats.modeEntries || typeof gm.stats.modeEntries !== "object") gm.stats.modeEntries = {};
  gm.stats.modeEntries.town = Math.max(gm.stats.modeEntries.town | 0, 2);
}

function getLastIntentReason(ctx) {
  const gm = GMRuntime.getState(ctx);
  const li = gm && gm.debug ? gm.debug.lastIntent : null;
  return li && typeof li.reason === "string" ? li.reason : null;
}

function check(name, fn) {
  const startedAt = Date.now();
  try {
    const details = fn();
    return { name, ok: true, ms: Date.now() - startedAt, details: details ?? null };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Date.now() - startedAt,
      error: {
        message: err && err.message ? String(err.message) : String(err),
        data: err && err.data !== undefined ? err.data : null,
        stack: err && err.stack ? String(err.stack) : null
      }
    };
  }
}

const checks = [];

checks.push(
  check("1) boredom evolution (~0 / ~0.5 / ~1) and mood labels", () => {
    const ctx = createCtx();
    resetAndPrime(ctx, { turn: 100, mode: "world" });

    // Force a stable "same turn" environment.
    ctx.time.turnCounter = 100;

    // Start from high boredom then drive down, then up.
    const gm = GMRuntime.getState(ctx);
    gm.boredom.level = 1;

    const b0 = settleBoredomAtSameTurn(ctx, 0.0, 50);
    assertClose(b0.level, 0.0, 0.03, "boredom should converge near 0.0");
    assertEq(b0.mood, "neutral", "mood at boredom~0 should label as neutral");

    const b05 = settleBoredomAtSameTurn(ctx, 0.5, 60);
    assertClose(b05.level, 0.5, 0.03, "boredom should converge near 0.5");
    assertEq(b05.mood, "neutral", "mood at boredom~0.5 should label as neutral");

    const b1 = settleBoredomAtSameTurn(ctx, 1.0, 60);
    assertClose(b1.level, 1.0, 0.03, "boredom should converge near 1.0");
    assertEq(b1.mood, "stern", "mood at boredom~1 should label as stern");

    return { boredom0: b0, boredom05: b05, boredom1: b1 };
  })
);

checks.push(
  check("2) entrance intent town entry period gating (1 flavor, 2 none rarity, 5 flavor)", () => {
    const ctx = createCtx();
    const gm = resetAndPrime(ctx, { turn: 10, mode: "town" });

    // Prevent the one-time "firstEntranceFlavorShown" from affecting the test.
    gm.storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
    gm.storyFlags.firstEntranceFlavorShown = true;
    gm.stats.totalTurns = 80;

    // Ensure mood label is eligible in getEntranceIntent() (it only labels; it does not recompute baseline here).
    gm.mood.valence = 0.0;
    gm.mood.arousal = 0.4;

    // Ensure boredom above strict >0.3 threshold.
    ctx.time.turnCounter = 10;
    settleBoredomAtSameTurn(ctx, 0.95, 30);

    // Entry 1
    GMRuntime.onEvent(ctx, { type: "mode.enter", scope: "town", turn: 10, interesting: false });
    const i1 = GMRuntime.getEntranceIntent(ctx, "town");
    assertEq(i1.kind, "flavor", "entry 1 should allow flavor");

    // Entry 2 (rarity gate)
    GMRuntime.onEvent(ctx, { type: "mode.enter", scope: "town", turn: 10, interesting: false });
    const i2 = GMRuntime.getEntranceIntent(ctx, "town");
    assertEq(i2.kind, "none", "entry 2 should return none");
    assertEq(getLastIntentReason(ctx), "rarity.entryPeriod", "entry 2 none should be due to rarity.entryPeriod");

    // Entries 3,4,5 then test 5th
    GMRuntime.onEvent(ctx, { type: "mode.enter", scope: "town", turn: 10, interesting: false }); // 3
    GMRuntime.onEvent(ctx, { type: "mode.enter", scope: "town", turn: 10, interesting: false }); // 4
    GMRuntime.onEvent(ctx, { type: "mode.enter", scope: "town", turn: 10, interesting: false }); // 5
    const i5 = GMRuntime.getEntranceIntent(ctx, "town");
    assertEq(i5.kind, "flavor", "entry 5 should allow flavor");

    return { i1, i2, i5 };
  })
);

checks.push(
  check("3) mechanicHint selection (questBoard first in town when all unused)", () => {
    const ctx = createCtx();
    const gm = resetAndPrime(ctx, { turn: 50, mode: "town" });

    bypassMechanicHintEarlyGameGuard(gm);
    gm.lastHintIntentTurn = -9999;

    // Normalize mechanic counters.
    for (const k of ["fishing", "lockpicking", "questBoard", "followers"]) {
      gm.mechanics[k].seen = 0;
      gm.mechanics[k].tried = 0;
      gm.mechanics[k].dismiss = 0;
      gm.mechanics[k].lastUsedTurn = null;
      gm.mechanics[k].firstSeenTurn = null;
    }

    const hint = GMRuntime.getMechanicHint(ctx);
    assertEq(hint.kind, "nudge", "mechanic hint should be emitted");
    assertEq(hint.target, "mechanic:questBoard", "in town, questBoard should win initial tie-breaks");

    return { hint };
  })
);

checks.push(
  check("4) mechanicHint cooldown.entry behavior", () => {
    const ctx = createCtx();
    const gm = resetAndPrime(ctx, { turn: 77, mode: "town" });

    bypassMechanicHintEarlyGameGuard(gm);
    gm.stats.modeEntries.town = 2;

    // Ensure no turn-based cooldown interference.
    gm.lastHintIntentTurn = -9999;

    const h1 = GMRuntime.getMechanicHint(ctx);
    assertEq(h1.kind, "nudge", "first hint should be emitted");

    // Re-enter town without advancing turnCounter: entry-based cooldown should block for <4 entries.
    gm.stats.modeEntries.town = 3;
    const h2 = GMRuntime.getMechanicHint(ctx);
    assertEq(h2.kind, "none", "second hint on same turn with +1 town entry should be blocked");
    assertEq(getLastIntentReason(ctx), "cooldown.entry", "block reason should be cooldown.entry");

    // Once we reach +4 entries (difference >= 4), it should allow again even on the same turn.
    gm.stats.modeEntries.town = 6;
    const h3 = GMRuntime.getMechanicHint(ctx);
    assertEq(h3.kind, "nudge", "hint should be allowed again when entry delta >= 4");

    return { h1, h2, h3 };
  })
);

checks.push(
  check("5) mechanic usage exclusion (tried>0 excludes)", () => {
    const ctx = createCtx();
    const gm = resetAndPrime(ctx, { turn: 90, mode: "town" });

    bypassMechanicHintEarlyGameGuard(gm);
    gm.lastHintIntentTurn = -9999;

    // Exclude questBoard by marking it tried.
    gm.mechanics.questBoard.tried = 1;
    gm.mechanics.questBoard.seen = 1;

    const hint = GMRuntime.getMechanicHint(ctx);
    assertEq(hint.kind, "nudge", "mechanic hint should be emitted");
    assertEq(hint.target, "mechanic:followers", "questBoard tried>0 should be excluded; followers should be next-best in town");

    return { hint };
  })
);

checks.push(
  check("6) disinterested mechanic exclusion (dismiss>=3 & tried==0)", () => {
    const ctx = createCtx();
    const gm = resetAndPrime(ctx, { turn: 91, mode: "town" });

    bypassMechanicHintEarlyGameGuard(gm);
    gm.lastHintIntentTurn = -9999;

    // Make questBoard disinterested without ever trying it.
    gm.mechanics.questBoard.seen = 1;
    gm.mechanics.questBoard.tried = 0;
    gm.mechanics.questBoard.dismiss = 3;

    const hint = GMRuntime.getMechanicHint(ctx);
    assertEq(hint.kind, "nudge", "mechanic hint should be emitted");
    assertEq(
      hint.target,
      "mechanic:followers",
      "questBoard dismiss>=3 & tried==0 should be excluded as disinterested; followers should be chosen"
    );

    return { hint };
  })
);

checks.push(
  check("7) gm.enabled=false gates tick/onEvent and intent logging", () => {
    const ctx = createCtx();
    const gm = resetAndPrime(ctx, { turn: 5, mode: "town" });

    const beforeTicks = gm.debug && gm.debug.counters ? (gm.debug.counters.ticks | 0) : 0;
    const beforeEvents = gm.debug && gm.debug.counters ? (gm.debug.counters.events | 0) : 0;
    const beforeLastTickTurn = gm.debug ? (gm.debug.lastTickTurn | 0) : null;
    const beforeBoredom = gm.boredom ? gm.boredom.level : null;
    const beforeHistoryLen = gm.debug && Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory.length : 0;

    gm.enabled = false;

    ctx.time.turnCounter = 6;
    GMRuntime.tick(ctx);

    assert(Object.is(ctx.gm, gm), "ctx.gm should still mirror the GM state when disabled");
    assertEq(gm.debug.counters.ticks | 0, beforeTicks, "tick counter should not advance when gm.enabled=false");
    assertEq(gm.debug.counters.events | 0, beforeEvents, "event counter should not advance when gm.enabled=false");
    assertEq(gm.debug.lastTickTurn | 0, beforeLastTickTurn, "lastTickTurn should not update when gm.enabled=false");
    assertEq(gm.boredom.level, beforeBoredom, "boredom level should not change when gm.enabled=false");

    GMRuntime.onEvent(ctx, { type: "mode.enter", scope: "town", turn: 6, interesting: true });
    assertEq(gm.debug.counters.events | 0, beforeEvents, "onEvent should be a no-op when gm.enabled=false");

    const entrance = GMRuntime.getEntranceIntent(ctx, "town");
    assertEq(entrance.kind, "none", "getEntranceIntent should return none when gm.enabled=false");

    const hint = GMRuntime.getMechanicHint(ctx);
    assertEq(hint.kind, "none", "getMechanicHint should return none when gm.enabled=false");

    const afterHistoryLen = gm.debug && Array.isArray(gm.debug.intentHistory) ? gm.debug.intentHistory.length : 0;
    assertEq(afterHistoryLen, beforeHistoryLen, "intentHistory should not change when gm.enabled=false");

    return { beforeTicks, beforeEvents, beforeHistoryLen };
  })
);

const report = {
  ok: checks.every((c) => c.ok),
  createdAt: new Date().toISOString(),
  checks
};

window.__GM_SIM_RESULT__ = report;

const statusEl = document.getElementById("gm-sim-status");
const checklistEl = document.getElementById("gm-sim-checklist");
const reportEl = document.getElementById("gm-sim-report");

statusEl.textContent = report.ok ? "PASS" : "FAIL";
statusEl.classList.toggle("pass", report.ok);
statusEl.classList.toggle("fail", !report.ok);

checklistEl.innerHTML = "";
for (const c of checks) {
  const li = document.createElement("li");
  li.textContent = `${c.ok ? "PASS" : "FAIL"}: ${c.name}${typeof c.ms === "number" ? ` (${c.ms}ms)` : ""}`;
  if (!c.ok) li.style.color = "#ef4444";
  checklistEl.appendChild(li);
}

reportEl.textContent = JSON.stringify(report, null, 2);
