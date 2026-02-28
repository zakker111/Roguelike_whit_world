/**
 * Deterministic GM scheduler ops.
 *
 * "Pure-ish" helpers used by GMRuntime's scheduler-backed features. These helpers:
 * - may mutate the passed `gm` state (and `gm.scheduler`),
 * - do not access GMRuntime module-local state,
 * - keep selection deterministic (no RNG).
 *
 * Dirty marking is injected: pass `onDirty(gm)` to mirror old `markDirty(gm)` behavior.
 */

import {
  GM_SCHED_MIN_AUTO_SPACING_TURNS,
  GM_SCHED_MAX_ACTIONS_PER_WINDOW,
  GM_SCHED_WINDOW_TURNS,
} from "../constants.js";

import { ensureScheduler } from "../state_ensure.js";
import { normalizeTurn } from "../turn_utils.js";

/**
 * Upserts an action into the deterministic scheduler.
 *
 * If the action does not exist, it is created and its id is appended to the
 * scheduler queue (insertion order is part of determinism).
 *
 * @param {object} gm
 * @param {string} id
 * @param {object} fields
 * @param {(gm: object) => void} [onDirty]
 * @returns {object|null}
 */
export function schedulerUpsertAction(gm, id, fields, onDirty) {
  const sched = ensureScheduler(gm);
  if (!sched) return null;

  const key = String(id || "");
  if (!key) return null;

  const actions = sched.actions;
  let a = actions[key];
  const isNew = !a || typeof a !== "object";
  if (isNew) {
    a = { id: key };
    actions[key] = a;
  }

  if (fields && typeof fields === "object") {
    for (const k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) a[k] = fields[k];
    }
  }

  if (isNew) {
    if (!Array.isArray(sched.queue)) sched.queue = [];
    sched.queue.push(key);
  }

  if (typeof onDirty === "function") onDirty(gm);
  return actions[key];
}

/**
 * Counts how many scheduler actions were consumed recently (rolling window).
 *
 * @param {object} sched
 * @param {number} turn
 * @returns {number}
 */
export function schedulerCountRecent(sched, turn) {
  const hist = Array.isArray(sched.history) ? sched.history : [];
  const t = normalizeTurn(turn);
  const lo = t - GM_SCHED_WINDOW_TURNS;
  let count = 0;
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i];
    if (!h || typeof h !== "object") continue;
    const ht = h.turn | 0;
    if (ht >= lo && ht <= t) count++;
  }
  return count;
}

/**
 * Determines whether the given action is deliverable at `turn`.
 *
 * @param {object} gm
 * @param {object} sched
 * @param {object} action
 * @param {number} turn
 * @returns {boolean}
 */
export function schedulerCanDeliver(gm, sched, action, turn) {
  const t = normalizeTurn(turn);

  const lastActionTurn = typeof gm.lastActionTurn === "number" ? (gm.lastActionTurn | 0) : -1;
  if (!action.allowMultiplePerTurn && lastActionTurn === t) return false;

  if (action.delivery === "auto") {
    const lastAuto = typeof sched.lastAutoTurn === "number" ? (sched.lastAutoTurn | 0) : -9999;
    if ((t - lastAuto) < GM_SCHED_MIN_AUTO_SPACING_TURNS) return false;
  }

  const recent = schedulerCountRecent(sched, t);
  if (recent >= GM_SCHED_MAX_ACTIONS_PER_WINDOW) return false;

  return true;
}

/**
 * Picks the next scheduled action to deliver at `turn`.
 *
 * Deterministic arbitration:
 * - higher `priority`
 * - lower `earliestTurn`
 * - lower `createdTurn`
 * - lexicographically smaller `id`
 *
 * @param {object} gm
 * @param {number} turn
 * @returns {object|null}
 */
export function schedulerPickNext(gm, turn) {
  const sched = ensureScheduler(gm);
  if (!sched) return null;

  const t = normalizeTurn(turn);
  const actions = sched.actions || {};
  const ids = Array.isArray(sched.queue) ? sched.queue : [];

  let best = null;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const a = actions[id];
    if (!a || typeof a !== "object") continue;
    if (a.status !== "scheduled" && a.status !== "ready") continue;

    const earliest = a.earliestTurn | 0;
    const latest = a.latestTurn | 0;
    if (t < earliest) continue;
    if (latest !== 0 && t > latest) continue;

    if (!schedulerCanDeliver(gm, sched, a, t)) continue;

    if (!best) {
      best = a;
      continue;
    }

    const ap = a.priority | 0;
    const bp = best.priority | 0;
    if (ap !== bp) {
      if (ap > bp) best = a;
      continue;
    }

    const ae = a.earliestTurn | 0;
    const be = best.earliestTurn | 0;
    if (ae !== be) {
      if (ae < be) best = a;
      continue;
    }

    const ac = a.createdTurn | 0;
    const bc = best.createdTurn | 0;
    if (ac !== bc) {
      if (ac < bc) best = a;
      continue;
    }

    const aid = String(a.id || "");
    const bid = String(best.id || "");
    if (aid && bid && aid < bid) best = a;
  }

  return best;
}

/**
 * Marks an action as consumed and updates scheduler bookkeeping.
 *
 * @param {object} gm
 * @param {object} action
 * @param {number} turn
 * @param {(gm: object) => void} [onDirty]
 */
export function schedulerConsume(gm, action, turn, onDirty) {
  if (!gm || !action) return;
  const sched = ensureScheduler(gm);
  if (!sched) return;

  const t = normalizeTurn(turn);
  action.status = "consumed";
  action.consumedTurn = t;

  gm.lastActionTurn = t;

  if (!Array.isArray(sched.history)) sched.history = [];
  sched.history.unshift({ turn: t, id: String(action.id || "") });
  if (sched.history.length > GM_SCHED_WINDOW_TURNS) sched.history.length = GM_SCHED_WINDOW_TURNS;

  if (action.delivery === "auto") {
    sched.lastAutoTurn = t;
  }

  if (typeof onDirty === "function") onDirty(gm);
}
