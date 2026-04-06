/**
 * GMRuntime RNG helpers.
 *
 * Provides a deterministic, persisted RNG stream for GMRuntime.
 *
 * This module is "pure-ish": it only mutates the provided `gm` state bag and
 * never touches GMRuntime module-local state. Callers that persist GM state
 * should provide an `onDirty(gm)` callback when drawing from the RNG.
 */

import { GM_RNG_ALGO, GM_SEED_SALT } from "./constants.js";
import { ensureRng } from "./state_ensure.js";

/**
 * Fast 32-bit avalanche hash.
 *
 * @param {number} x
 * @returns {number} Unsigned 32-bit hash.
 */
export function hash32(x) {
  let v = (x >>> 0);
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

/**
 * Derive the current run seed from the global RNG service (preferred) or
 * localStorage fallback.
 *
 * @returns {number} Unsigned 32-bit run seed.
 */
export function deriveRunSeed() {
  try {
    if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
      const s = window.RNG.getSeed();
      if (s != null) return (Number(s) >>> 0);
    }
  } catch (_) {}

  try {
    const raw = (typeof localStorage !== "undefined") ? localStorage.getItem("SEED") : null;
    if (raw != null) return (Number(raw) >>> 0);
  } catch (_) {}

  return 0;
}

/**
 * Ensure `gm.rng` exists and is seeded deterministically for the current run.
 *
 * Seeding is only applied when the RNG stream is in its initial state
 * (`calls === 0` and `state === 0`).
 *
 * @param {object} gm GM state bag.
 * @returns {object|null} The normalized RNG state object.
 */
export function ensureSeededGmRng(gm) {
  const rng = ensureRng(gm);
  if (!rng) return null;

  const calls = rng.calls | 0;
  const state = rng.state >>> 0;
  if (calls === 0 && state === 0 && rng.algo === GM_RNG_ALGO) {
    const runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : (deriveRunSeed() >>> 0);
    rng.state = hash32((runSeed ^ GM_SEED_SALT ^ 0x9e3779b9) >>> 0);
  }

  return rng;
}

/**
 * Draw the next uint32 from the GM RNG stream.
 *
 * @param {object} gm GM state bag.
 * @param {(gm: object) => void} [onDirty] Optional callback invoked after the RNG state mutates.
 * @returns {number} Unsigned 32-bit integer.
 */
export function gmRngNextUint32(gm, onDirty) {
  const rng = ensureSeededGmRng(gm);
  if (!rng) return 0;

  // mulberry32 step; mirrored from core/rng_service.js.
  let a = (rng.state >>> 0);
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const out = (t ^ (t >>> 14)) >>> 0;

  rng.state = a;
  rng.calls = (rng.calls | 0) + 1;
  if (typeof onDirty === "function") onDirty(gm);

  return out;
}

/**
 * Draw a float in [0, 1) from the GM RNG stream.
 *
 * @param {object} gm GM state bag.
 * @param {(gm: object) => void} [onDirty] Optional callback invoked after the RNG state mutates.
 * @returns {number}
 */
export function gmRngFloat(gm, onDirty) {
  return gmRngNextUint32(gm, onDirty) / 4294967296;
}
