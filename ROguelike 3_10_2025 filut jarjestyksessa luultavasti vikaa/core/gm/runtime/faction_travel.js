/**
 * Faction travel events (scheduler-backed).
 *
 * Extracted from `core/gm/runtime.js` to keep the main runtime module focused on
 * state management + persistence wiring.
 */

import {
  ensureTraitsAndMechanics,
  ensureFactionEvents,
  ensureScheduler,
} from "./state_ensure.js";

import { normalizeTurn, getCurrentTurn } from "./turn_utils.js";

import {
  schedulerUpsertAction,
  schedulerPickNext,
  schedulerConsume,
} from "./scheduler/ops.js";

const FE_ACTION_ID_GUARD = "fe:guardFine";
const FE_ACTION_ID_BANDIT = "fe:banditBounty";
const FE_ACTION_ID_TROLL = "fe:trollHunt";

/**
 * Migrates legacy faction travel event slots under `gm.storyFlags.factionEvents`
 * into the deterministic scheduler.
 *
 * This is a best-effort migration and is safe to call multiple times.
 *
 * @param {object} gm
 * @param {(gm: object) => void} [onDirty]
 */
export function migrateFactionEventSlotsToScheduler(gm, onDirty) {
  if (!gm || typeof gm !== "object") return;

  ensureFactionEvents(gm);
  ensureScheduler(gm);

  const flags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : null;
  const fe = flags && flags.factionEvents && typeof flags.factionEvents === "object" ? flags.factionEvents : null;
  if (!fe) return;

  const mapping = [
    {
      slot: "guardFine",
      id: FE_ACTION_ID_GUARD,
      kind: "travel.guardFine",
      priority: 300,
      delivery: "confirm",
      payload: { kind: "guard_fine" },
    },
    {
      slot: "banditBounty",
      id: FE_ACTION_ID_BANDIT,
      kind: "travel.banditBounty",
      priority: 200,
      delivery: "auto",
      payload: { encounterId: "gm_bandit_bounty" },
    },
    {
      slot: "trollHunt",
      id: FE_ACTION_ID_TROLL,
      kind: "travel.trollHunt",
      priority: 100,
      delivery: "auto",
      payload: { encounterId: "gm_troll_hunt" },
    },
  ];

  const sched = ensureScheduler(gm);
  const actions = sched && sched.actions && typeof sched.actions === "object" ? sched.actions : null;
  if (!actions) return;

  for (let i = 0; i < mapping.length; i++) {
    const m = mapping[i];
    const slot = fe[m.slot];
    if (!slot || typeof slot !== "object") continue;

    const existing = actions[m.id];
    if (existing && typeof existing === "object") continue;

    const st = typeof slot.status === "string" ? slot.status : "none";
    const status = (st === "scheduled" || st === "consumed") ? st : "none";

    const earliest = normalizeTurn(slot.earliestTurn);
    const latestRaw = slot.latestTurn;
    const latest = normalizeTurn(latestRaw != null ? latestRaw : earliest);

    schedulerUpsertAction(gm, m.id, {
      kind: m.kind,
      status,
      priority: m.priority,
      delivery: m.delivery,
      allowMultiplePerTurn: false,
      createdTurn: earliest,
      earliestTurn: earliest,
      latestTurn: latest,
      payload: Object.assign({}, m.payload),
    }, onDirty);
  }
}

/**
 * Opportunistically schedules faction travel events based on accumulated
 * faction/family metrics.
 *
 * @param {object} ctx
 * @param {object} gm
 * @param {number} turn
 * @param {(gm: object) => void} [onDirty]
 */
export function maybeScheduleFactionEvents(ctx, gm, turn, onDirty) {
  if (!gm || typeof gm !== "object") return;

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);
  ensureScheduler(gm);
  migrateFactionEventSlotsToScheduler(gm, onDirty);

  const storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : null;
  const factionEvents = storyFlags && storyFlags.factionEvents && typeof storyFlags.factionEvents === "object"
    ? storyFlags.factionEvents
    : null;
  if (!factionEvents) return;

  const safeTurn = normalizeTurn(turn);

  function slotIsFree(slot) {
    if (!slot || typeof slot !== "object") return false;
    const status = typeof slot.status === "string" ? slot.status : "none";
    return status !== "scheduled" && status !== "consumed";
  }

  function extractSeenAndScore(entry) {
    if (!entry || typeof entry !== "object") return { seen: 0, score: 0 };
    let seen = entry.seen | 0;
    if (seen < 0) seen = 0;
    let positive = entry.positive | 0;
    if (positive < 0) positive = 0;
    let negative = entry.negative | 0;
    if (negative < 0) negative = 0;
    const samples = positive + negative;
    const score = samples > 0 ? (positive - negative) / samples : 0;
    return { seen, score };
  }

  const factions = gm.factions && typeof gm.factions === "object" ? gm.factions : {};
  const families = gm.families && typeof gm.families === "object" ? gm.families : {};

  const banditSlot = factionEvents.banditBounty;
  if (slotIsFree(banditSlot)) {
    const metrics = extractSeenAndScore(factions.bandit);
    if (metrics.seen >= 8 && metrics.score >= 0.8) {
      banditSlot.status = "scheduled";
      banditSlot.earliestTurn = normalizeTurn(safeTurn + 50);
      banditSlot.latestTurn = normalizeTurn(safeTurn + 300);

      schedulerUpsertAction(gm, FE_ACTION_ID_BANDIT, {
        kind: "travel.banditBounty",
        status: "scheduled",
        priority: 200,
        delivery: "auto",
        allowMultiplePerTurn: false,
        createdTurn: safeTurn,
        earliestTurn: banditSlot.earliestTurn | 0,
        latestTurn: banditSlot.latestTurn | 0,
        payload: { encounterId: "gm_bandit_bounty" },
      }, onDirty);
    }
  }

  const guardSlot = factionEvents.guardFine;
  if (slotIsFree(guardSlot)) {
    let bestSeen = 0;
    let bestScore = -1;

    const g1 = extractSeenAndScore(factions.guard);
    if (g1.seen > bestSeen || (g1.seen === bestSeen && g1.score > bestScore)) {
      bestSeen = g1.seen;
      bestScore = g1.score;
    }

    const g2 = extractSeenAndScore(factions.town);
    if (g2.seen > bestSeen || (g2.seen === bestSeen && g2.score > bestScore)) {
      bestSeen = g2.seen;
      bestScore = g2.score;
    }

    if (bestSeen >= 3 && bestScore >= 0.6) {
      guardSlot.status = "scheduled";
      guardSlot.earliestTurn = normalizeTurn(safeTurn + 30);
      guardSlot.latestTurn = normalizeTurn(safeTurn + 240);

      schedulerUpsertAction(gm, FE_ACTION_ID_GUARD, {
        kind: "travel.guardFine",
        status: "scheduled",
        priority: 300,
        delivery: "confirm",
        allowMultiplePerTurn: false,
        createdTurn: safeTurn,
        earliestTurn: guardSlot.earliestTurn | 0,
        latestTurn: guardSlot.latestTurn | 0,
        payload: { kind: "guard_fine" },
      }, onDirty);
    }
  }

  const trollSlot = factionEvents.trollHunt;
  if (slotIsFree(trollSlot)) {
    let source = null;
    if (families.troll && typeof families.troll === "object") source = families.troll;
    else if (factions.trolls && typeof factions.trolls === "object") source = factions.trolls;

    if (source) {
      const metrics = extractSeenAndScore(source);
      if (metrics.seen >= 4 && metrics.score >= 0.7) {
        trollSlot.status = "scheduled";
        trollSlot.earliestTurn = normalizeTurn(safeTurn + 40);
        trollSlot.latestTurn = normalizeTurn(safeTurn + 260);

        schedulerUpsertAction(gm, FE_ACTION_ID_TROLL, {
          kind: "travel.trollHunt",
          status: "scheduled",
          priority: 100,
          delivery: "auto",
          allowMultiplePerTurn: false,
          createdTurn: safeTurn,
          earliestTurn: trollSlot.earliestTurn | 0,
          latestTurn: trollSlot.latestTurn | 0,
          payload: { encounterId: "gm_troll_hunt" },
        }, onDirty);
      }
    }
  }
}

/**
 * Implementation of `GMRuntime.getFactionTravelEvent`.
 *
 * Note: this function must not access localStorage nor persist state directly.
 * It returns `{ intent, shouldWrite, writeOptions }` so the caller can decide
 * whether to persist.
 *
 * @param {object} ctx
 * @param {object} gm
 * @param {object} helpers
 * @param {(gm: object) => void} helpers.markDirty
 * @param {(gm: object, intent: object, turn: number) => boolean} helpers.pushIntentDebug
 * @returns {{ intent: object, shouldWrite: boolean, writeOptions: object }}
 */
export function getFactionTravelEventImpl(ctx, gm, helpers) {
  const markDirty = helpers.markDirty;
  const pushIntentDebug = helpers.pushIntentDebug;

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);
  ensureScheduler(gm);

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  // If slots exist (old view) but scheduler does not, schedule will be rebuilt by onEvent.
  // We'll still try to pick from scheduler if possible.
  // Deterministic arbitration: priority > earliestTurn > createdTurn > id.
  const action = schedulerPickNext(gm, turn);
  if (!action) return { intent: { kind: "none" }, shouldWrite: false, writeOptions: { force: true } };

  let intent = { kind: "none" };
  if (action.id === FE_ACTION_ID_GUARD) {
    intent = { kind: "guard_fine" };
  } else if (action.id === FE_ACTION_ID_BANDIT) {
    intent = { kind: "encounter", encounterId: "gm_bandit_bounty" };
  } else if (action.id === FE_ACTION_ID_TROLL) {
    intent = { kind: "encounter", encounterId: "gm_troll_hunt" };
  } else {
    return { intent: { kind: "none" }, shouldWrite: false, writeOptions: { force: true } };
  }

  // Consume scheduler + legacy slot.
  schedulerConsume(gm, action, turn, markDirty);

  try {
    const flags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : null;
    const fe = flags && flags.factionEvents && typeof flags.factionEvents === "object" ? flags.factionEvents : null;
    if (fe) {
      const slotName = (action.id === FE_ACTION_ID_GUARD) ? "guardFine" : (action.id === FE_ACTION_ID_BANDIT) ? "banditBounty" : "trollHunt";
      const slot = fe[slotName];
      if (slot && typeof slot === "object") slot.status = "consumed";
    }
  } catch (_) {}

  if (pushIntentDebug(gm, Object.assign({ channel: "factionTravel" }, intent), turn)) markDirty(gm);

  return { intent, shouldWrite: true, writeOptions: { force: true } };
}

/**
 * Implementation of `GMRuntime.forceFactionTravelEvent`.
 *
 * Note: this function must not access localStorage nor persist state directly.
 * It returns `{ intent, shouldWrite, writeOptions }` so the caller can decide
 * whether to persist.
 *
 * @param {object} ctx
 * @param {object} gm
 * @param {string} id
 * @param {object} helpers
 * @param {(gm: object) => void} helpers.markDirty
 * @param {(gm: object, intent: object, turn: number) => boolean} helpers.pushIntentDebug
 * @returns {{ intent: object, shouldWrite: boolean, writeOptions: object }}
 */
export function forceFactionTravelEventImpl(ctx, gm, id, helpers) {
  const markDirty = helpers.markDirty;
  const pushIntentDebug = helpers.pushIntentDebug;

  if (!ctx) return { intent: { kind: "none" }, shouldWrite: false, writeOptions: { force: true } };

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);
  ensureScheduler(gm);

  const key = String(id || "").toLowerCase();
  if (!key) return { intent: { kind: "none" }, shouldWrite: false, writeOptions: { force: true } };

  const flags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : (gm.storyFlags = {});
  const fe = flags.factionEvents && typeof flags.factionEvents === "object" ? flags.factionEvents : (flags.factionEvents = {});

  const turn = normalizeTurn(getCurrentTurn(ctx, gm));

  function ensureSlot(name) {
    let slot = fe[name];
    if (!slot || typeof slot !== "object") {
      slot = {};
      fe[name] = slot;
    }
    slot.status = "scheduled";
    slot.earliestTurn = turn;
    slot.latestTurn = turn;
    return slot;
  }

  let intent = { kind: "none" };

  if (key === "guard_fine" || key === "guard" || key === "guard_fine_event") {
    ensureSlot("guardFine");
    schedulerUpsertAction(gm, FE_ACTION_ID_GUARD, {
      kind: "travel.guardFine",
      status: "scheduled",
      priority: 300,
      delivery: "confirm",
      allowMultiplePerTurn: false,
      createdTurn: turn,
      earliestTurn: turn,
      latestTurn: turn,
      payload: { kind: "guard_fine" },
    }, markDirty);
    intent = { kind: "guard_fine" };
  } else if (key === "bandit_bounty" || key === "bandit" || key === "bounty") {
    ensureSlot("banditBounty");
    schedulerUpsertAction(gm, FE_ACTION_ID_BANDIT, {
      kind: "travel.banditBounty",
      status: "scheduled",
      priority: 200,
      delivery: "auto",
      allowMultiplePerTurn: false,
      createdTurn: turn,
      earliestTurn: turn,
      latestTurn: turn,
      payload: { encounterId: "gm_bandit_bounty" },
    }, markDirty);
    intent = { kind: "encounter", encounterId: "gm_bandit_bounty" };
  } else if (key === "troll_hunt" || key === "troll" || key === "trolls") {
    ensureSlot("trollHunt");
    schedulerUpsertAction(gm, FE_ACTION_ID_TROLL, {
      kind: "travel.trollHunt",
      status: "scheduled",
      priority: 100,
      delivery: "auto",
      allowMultiplePerTurn: false,
      createdTurn: turn,
      earliestTurn: turn,
      latestTurn: turn,
      payload: { encounterId: "gm_troll_hunt" },
    }, markDirty);
    intent = { kind: "encounter", encounterId: "gm_troll_hunt" };
  } else {
    return { intent: { kind: "none" }, shouldWrite: false, writeOptions: { force: true } };
  }

  gm.lastActionTurn = turn;
  if (pushIntentDebug(gm, Object.assign({ channel: "factionTravel" }, intent), turn)) markDirty(gm);

  return { intent, shouldWrite: true, writeOptions: { force: true } };
}
