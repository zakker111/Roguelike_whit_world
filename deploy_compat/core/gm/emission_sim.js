import * as GMRuntime from "./runtime.js";
import "../modes/modes.js";

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function createCtx() {
  const logs = [];

  const ctx = {
    mode: "world",
    time: { turnCounter: 0 },
    utils: { clamp },
    __logs: logs,
    gm: null,
    GMRuntime,
  };

  ctx.log = (msg, level, meta) => {
    const m = meta && typeof meta === "object" ? meta : {};
    const tc = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : null;
    logs.push({
      turn: tc,
      msg: msg == null ? "" : String(msg),
      level: level == null ? null : String(level),
      category: typeof m.category === "string" ? m.category : "",
    });
  };

  return ctx;
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

function diffNewIntentEntries(before, after) {
  const a = Array.isArray(after) ? after : [];
  const b = Array.isArray(before) ? before : [];
  if (!b.length) return a.slice();

  const marker = b[0];
  const idx = a.indexOf(marker);
  if (idx === -1) return a.slice();
  return a.slice(0, idx);
}

function resetAndPrime(ctx, { turn = 0, mode = "world" } = {}) {
  ctx.mode = mode;
  ctx.time.turnCounter = turn;

  GMRuntime.reset(ctx);
  GMRuntime.tick(ctx);

  return GMRuntime.getState(ctx);
}

function runModeEnter(ctx, gmEvent, scope, turn, interesting) {
  ctx.mode = scope;
  ctx.time.turnCounter = turn | 0;

  const gm = GMRuntime.getState(ctx);
  const beforeHistory = (gm && gm.debug && Array.isArray(gm.debug.intentHistory))
    ? gm.debug.intentHistory.slice()
    : [];

  const beforeLogs = ctx.__logs.length;

  gmEvent(ctx, {
    type: "mode.enter",
    scope,
    turn,
    interesting
  });

  const afterLogs = ctx.__logs.slice(beforeLogs);
  const afterHistory = (gm && gm.debug && Array.isArray(gm.debug.intentHistory))
    ? gm.debug.intentHistory.slice()
    : [];

  const newIntents = diffNewIntentEntries(beforeHistory, afterHistory);

  return { logs: afterLogs, intents: newIntents };
}

function classifyEntry({ logs, intents }) {
  const npc = logs.some((e) => e && e.category === "gm-npc");
  if (npc) return "gmNpcRumor";

  const entrance = intents.find((it) => it && it.channel === "entrance" && it.kind === "flavor");
  if (entrance) return "gmEntranceFlavor";

  const mech = intents.find((it) => it && it.channel === "mechanicHint" && it.kind === "nudge");
  if (mech) return "gmMechanicHint";

  return "none";
}

function pct(n, d) {
  if (!d) return 0;
  return n / d;
}

function addHist(hist, key) {
  const k = key == null ? "" : String(key);
  hist[k] = (hist[k] | 0) + 1;
}

function summarizeScenario(outcomes, intentEvents) {
  const totals = {
    entries: outcomes.length,
    gmEntranceFlavor: 0,
    gmNpcRumor: 0,
    gmMechanicHint: 0,
    none: 0,
  };

  for (let i = 0; i < outcomes.length; i++) {
    totals[outcomes[i]] = (totals[outcomes[i]] | 0) + 1;
  }

  const entranceNoneReasons = Object.create(null);
  const mechanicNoneReasons = Object.create(null);
  let entranceEmitted = 0;
  let entranceNone = 0;
  let mechanicEmitted = 0;
  let mechanicNone = 0;

  for (let i = 0; i < intentEvents.length; i++) {
    const it = intentEvents[i];
    if (!it || typeof it !== "object") continue;

    if (it.channel === "entrance") {
      if (it.kind === "none") {
        entranceNone++;
        addHist(entranceNoneReasons, it.reason || "");
      } else {
        entranceEmitted++;
      }
    }

    if (it.channel === "mechanicHint") {
      if (it.kind === "none") {
        mechanicNone++;
        addHist(mechanicNoneReasons, it.reason || "");
      } else {
        mechanicEmitted++;
      }
    }
  }

  return {
    totals,
    percentages: {
      gmEntranceFlavorPct: pct(totals.gmEntranceFlavor, totals.entries),
      gmNpcRumorPct: pct(totals.gmNpcRumor, totals.entries),
      gmMechanicHintPct: pct(totals.gmMechanicHint, totals.entries),
      nonePct: pct(totals.none, totals.entries),
    },
    intentReasonHistograms: {
      entrance: {
        emitted: entranceEmitted,
        none: entranceNone,
        reasons: entranceNoneReasons,
      },
      mechanicHint: {
        emitted: mechanicEmitted,
        none: mechanicNone,
        reasons: mechanicNoneReasons,
      },
    },
  };
}

function ensureAllMechanicsUsed(gm) {
  const mech = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : (gm.mechanics = {});
  const keys = ["fishing", "lockpicking", "questBoard", "followers"];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!mech[k] || typeof mech[k] !== "object") mech[k] = {};
    mech[k].tried = 1;
    mech[k].seen = 1;
    mech[k].dismiss = 0;
    mech[k].lastUsedTurn = 0;
    mech[k].firstSeenTurn = 0;
  }
}

function ensureAllMechanicsUnused(gm) {
  const mech = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : (gm.mechanics = {});
  const keys = ["fishing", "lockpicking", "questBoard", "followers"];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!mech[k] || typeof mech[k] !== "object") mech[k] = {};
    mech[k].tried = 0;
    mech[k].seen = 0;
    mech[k].dismiss = 0;
    mech[k].lastUsedTurn = null;
    mech[k].firstSeenTurn = null;
  }
}

function suppressEntranceFlavor(gm) {
  gm.storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
  gm.storyFlags.firstEntranceFlavorShown = true;

  gm.stats = gm.stats && typeof gm.stats === "object" ? gm.stats : {};
  gm.stats.totalTurns = Math.max(gm.stats.totalTurns | 0, 100);

  gm.boredom = gm.boredom && typeof gm.boredom === "object" ? gm.boredom : {};
  gm.boredom.level = 0.0;

  gm.mood = gm.mood && typeof gm.mood === "object" ? gm.mood : {};
  gm.mood.valence = 0.0;
  gm.mood.arousal = 0.0;
}

function forceDungeonEntranceEligible(gm) {
  gm.storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
  gm.storyFlags.firstEntranceFlavorShown = true;

  gm.stats = gm.stats && typeof gm.stats === "object" ? gm.stats : {};
  gm.stats.totalTurns = Math.max(gm.stats.totalTurns | 0, 200);

  gm.boredom = gm.boredom && typeof gm.boredom === "object" ? gm.boredom : {};
  gm.boredom.level = 0.95;

  gm.mood = gm.mood && typeof gm.mood === "object" ? gm.mood : {};
  gm.mood.valence = 0.0;
  gm.mood.arousal = 0.4;
}

function primeNpcRumorTopic(gm, turn) {
  gm.traits = gm.traits && typeof gm.traits === "object" ? gm.traits : {};
  gm.traits.trollSlayer = gm.traits.trollSlayer && typeof gm.traits.trollSlayer === "object" ? gm.traits.trollSlayer : {};
  gm.traits.trollSlayer.seen = 3;
  gm.traits.trollSlayer.positive = 3;
  gm.traits.trollSlayer.negative = 0;
  gm.traits.trollSlayer.lastUpdatedTurn = turn | 0;

  gm.storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
  if (!Object.prototype.hasOwnProperty.call(gm.storyFlags, "lastNpcRumorTurn")) {
    gm.storyFlags.lastNpcRumorTurn = -1;
  }
}

function runScenario({ id, label, run }) {
  const startedAt = Date.now();
  try {
    const details = run();
    return { id, label, ok: true, ms: Date.now() - startedAt, details };
  } catch (err) {
    return {
      id,
      label,
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

export function runGmEmissionSim({ gmEvent, preserveCtx } = {}) {
  const gmEventFn = typeof gmEvent === "function"
    ? gmEvent
    : (typeof globalThis !== "undefined" && globalThis.Modes && typeof globalThis.Modes.__gmEvent === "function")
      ? globalThis.Modes.__gmEvent
      : null;

  const preserve = !!(preserveCtx && typeof GMRuntime.__getRawState === "function" && typeof GMRuntime.__setRawState === "function");
  const prevState = preserve ? (GMRuntime.__getRawState() || GMRuntime.getState(preserveCtx)) : null;

  try {
    if (typeof gmEventFn !== "function") {
      return {
        ok: false,
        createdAt: new Date().toISOString(),
        warning: "Modes.__gmEvent missing; emission simulation skipped (import core/modes/modes.js and ensure Modes.__gmEvent is exposed)",
        scenarios: [],
      };
    }

    const scenarios = [];

    scenarios.push(runScenario({
      id: "S1",
      label: "Town entrance flavor periodicity (ENTRY_PERIOD=4) with high boredom",
      run: () => {
        const ctx = createCtx();
        const gm = resetAndPrime(ctx, { turn: 10, mode: "town" });

        gm.storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
        gm.storyFlags.firstEntranceFlavorShown = true;
        gm.boredom.level = 0.95;
        gm.mood.valence = -0.5;
        gm.mood.arousal = 0.8;
        ensureAllMechanicsUsed(gm);

        const outcomes = [];
        const intentEvents = [];

        for (let i = 0; i < 20; i++) {
          const res = runModeEnter(ctx, gmEventFn, "town", 10, false);
          outcomes.push(classifyEntry(res));
          intentEvents.push(...res.intents);
        }

        const summary = summarizeScenario(outcomes, intentEvents);

        assertEq(summary.totals.gmEntranceFlavor, 5, "unexpected entrance flavor count");
        assertEq(summary.intentReasonHistograms.entrance.reasons["rarity.entryPeriod"] | 0, 15, "unexpected rarity.entryPeriod count");

        return { outcomes, summary };
      }
    }));

    scenarios.push(runScenario({
      id: "S2",
      label: "NPC rumor emission (cooldown 300 turns, entry period 3) with entrance+mechanic suppressed",
      run: () => {
        const ctx = createCtx();
        const gm = resetAndPrime(ctx, { turn: 0, mode: "town" });

        suppressEntranceFlavor(gm);
        ensureAllMechanicsUsed(gm);

        const outcomes = [];
        const intentEvents = [];
        const npcTurns = [];

        const step = 50;
        for (let t = 0; t <= 1000; t += step) {
          primeNpcRumorTopic(gm, t);
          const res = runModeEnter(ctx, gmEventFn, "town", t, false);
          const outcome = classifyEntry(res);
          outcomes.push(outcome);
          intentEvents.push(...res.intents);
          if (outcome === "gmNpcRumor") npcTurns.push(t);
        }

        assertEq(npcTurns.length, 4, "unexpected npc rumor count");
        assertEq(JSON.stringify(npcTurns), JSON.stringify([0, 300, 600, 900]), "unexpected npc rumor turns");

        const summary = summarizeScenario(outcomes, intentEvents);
        return { npcTurns, summary };
      }
    }));

    scenarios.push(runScenario({
      id: "S3",
      label: "Mechanic hint emission rate under 80-turn cooldown (town entry every 10 turns)",
      run: () => {
        const ctx = createCtx();
        const gm = resetAndPrime(ctx, { turn: 0, mode: "town" });

        suppressEntranceFlavor(gm);
        ensureAllMechanicsUnused(gm);

        gm.stats.totalTurns = 100;
        gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
        gm.stats.modeEntries.town = 1;

        gm.lastHintIntentTurn = -9999;
        gm.lastHintIntentTownEntry = -9999;

        const outcomes = [];
        const intentEvents = [];
        const mechTurns = [];

        for (let t = 0; t <= 500; t += 10) {
          const res = runModeEnter(ctx, gmEventFn, "town", t, false);
          const outcome = classifyEntry(res);
          outcomes.push(outcome);
          intentEvents.push(...res.intents);
          if (outcome === "gmMechanicHint") mechTurns.push(t);
        }

        for (let i = 1; i < mechTurns.length; i++) {
          const dt = (mechTurns[i] | 0) - (mechTurns[i - 1] | 0);
          assert(dt >= 80, "mechanic hint cooldown.turn violated", { prev: mechTurns[i - 1], next: mechTurns[i] });
        }

        const summary = summarizeScenario(outcomes, intentEvents);
        return { mechTurns, summary };
      }
    }));

    scenarios.push(runScenario({
      id: "S4",
      label: "Mechanic hint entry-based cooldown when re-entering town on the same turn",
      run: () => {
        const ctx = createCtx();
        const gm = resetAndPrime(ctx, { turn: 77, mode: "town" });

        suppressEntranceFlavor(gm);
        ensureAllMechanicsUnused(gm);

        gm.stats.totalTurns = 100;
        gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
        gm.stats.modeEntries.town = 1;

        gm.lastHintIntentTurn = -9999;
        gm.lastHintIntentTownEntry = -9999;

        const outcomes = [];
        const intentEvents = [];

        for (let i = 0; i < 10; i++) {
          const res = runModeEnter(ctx, gmEventFn, "town", 77, false);
          outcomes.push(classifyEntry(res));
          intentEvents.push(...res.intents);
        }

        const summary = summarizeScenario(outcomes, intentEvents);

        assertEq(summary.totals.gmMechanicHint, 3, "unexpected mechanic hint count");
        assert((summary.intentReasonHistograms.mechanicHint.reasons["cooldown.entry"] | 0) > 0, "expected cooldown.entry to occur");

        return { summary };
      }
    }));

    scenarios.push(runScenario({
      id: "S5",
      label: "Mechanic-exhausted run (all mechanics tried) => nothing emitted, mechanicHint reason no.mechanic",
      run: () => {
        const ctx = createCtx();
        const gm = resetAndPrime(ctx, { turn: 0, mode: "town" });

        suppressEntranceFlavor(gm);
        ensureAllMechanicsUsed(gm);

        gm.stats.totalTurns = 100;
        gm.stats.modeEntries = gm.stats.modeEntries && typeof gm.stats.modeEntries === "object" ? gm.stats.modeEntries : {};
        gm.stats.modeEntries.town = 1;

        gm.lastHintIntentTurn = -9999;
        gm.lastHintIntentTownEntry = -9999;

        const outcomes = [];
        const intentEvents = [];

        for (let t = 0; t <= 190; t += 10) {
          const res = runModeEnter(ctx, gmEventFn, "town", t, false);
          outcomes.push(classifyEntry(res));
          intentEvents.push(...res.intents);
        }

        const summary = summarizeScenario(outcomes, intentEvents);

        assertEq(summary.totals.gmNpcRumor, 0);
        assertEq(summary.totals.gmEntranceFlavor, 0);
        assertEq(summary.totals.gmMechanicHint, 0);
        assertEq(summary.totals.none, summary.totals.entries);
        assert((summary.intentReasonHistograms.mechanicHint.reasons["no.mechanic"] | 0) > 0, "expected mechanicHint:no.mechanic");

        return { summary };
      }
    }));

    scenarios.push(runScenario({
      id: "S6",
      label: "Non-town entrance cooldown (dungeon) => cooldown.turn within 60 turns",
      run: () => {
        const ctx = createCtx();
        const gm = resetAndPrime(ctx, { turn: 0, mode: "dungeon" });

        forceDungeonEntranceEligible(gm);

        const turns = [0, 10, 20, 70];
        const outcomes = [];
        const intentEvents = [];

        for (let i = 0; i < turns.length; i++) {
          const t = turns[i];
          const res = runModeEnter(ctx, gmEventFn, "dungeon", t, true);
          outcomes.push(classifyEntry(res));
          intentEvents.push(...res.intents);
        }

        const summary = summarizeScenario(outcomes, intentEvents);

        assertEq(summary.totals.gmEntranceFlavor, 2, "expected 2 dungeon entrance flavors");
        assertEq(summary.intentReasonHistograms.entrance.reasons["cooldown.turn"] | 0, 2, "expected 2 cooldown.turn suppressions");

        return { turns, summary };
      }
    }));

    return {
      ok: scenarios.every((s) => s.ok),
      createdAt: new Date().toISOString(),
      scenarios,
    };
  } finally {
    if (preserve) {
      GMRuntime.__setRawState(prevState, preserveCtx);
    }
  }
}
