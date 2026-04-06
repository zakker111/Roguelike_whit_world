/**
 * GMRuntime v0.3 pacing helpers.
 *
 * Goal: interventions are rare and deterministic.
 * - Gate interventions on boredom ("rare only when bored").
 * - Gate interventions on a deterministic cooldown (`nextEligibleTurn`).
 * - Cooldown draws must consume ONLY the GM RNG stream.
 */

import { gmRngNextUint32 } from "./rng.js";
import { ensurePacing } from "./state_ensure.js";
import { localClamp } from "./turn_utils.js";

const DEFAULTS = {
  boredomMin: 0.35,
  cooldownMinTurns: 400,
  cooldownMaxTurns: 600,
};

export function getPacingConfig(ctx) {
  // Config-driven knobs.
  // Source: data/config/config.json -> GameData.config.gm.pacing
  try {
    const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config)
      ? window.GameData.config
      : null;

    const p = cfg && cfg.gm && cfg.gm.pacing && typeof cfg.gm.pacing === "object" ? cfg.gm.pacing : null;

    let boredomMin = p && typeof p.boredomMin === "number" && Number.isFinite(p.boredomMin)
      ? p.boredomMin
      : DEFAULTS.boredomMin;

    let cooldownMinTurns = p && typeof p.cooldownMinTurns === "number" && Number.isFinite(p.cooldownMinTurns)
      ? (p.cooldownMinTurns | 0)
      : DEFAULTS.cooldownMinTurns;

    let cooldownMaxTurns = p && typeof p.cooldownMaxTurns === "number" && Number.isFinite(p.cooldownMaxTurns)
      ? (p.cooldownMaxTurns | 0)
      : DEFAULTS.cooldownMaxTurns;

    boredomMin = localClamp(boredomMin, 0, 1);
    if (cooldownMinTurns < 0) cooldownMinTurns = 0;
    if (cooldownMaxTurns < cooldownMinTurns) cooldownMaxTurns = cooldownMinTurns;

    return { boredomMin, cooldownMinTurns, cooldownMaxTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

export function getBoredomLevel(gm) {
  try {
    const raw = gm && gm.boredom && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
      ? gm.boredom.level
      : 0;
    return localClamp(raw, 0, 1);
  } catch (_) {
    return 0;
  }
}

export function checkPacingGate(ctx, gm, turn, cfg) {
  const p = ensurePacing(gm);
  const c = cfg || getPacingConfig(ctx);

  const safeTurn = (turn | 0);

  if (p && safeTurn < (p.nextEligibleTurn | 0)) {
    return { ok: false, reason: "cooldown", nextEligibleTurn: (p.nextEligibleTurn | 0) };
  }

  const boredom = getBoredomLevel(gm);
  if (boredom < c.boredomMin) {
    return { ok: false, reason: "boredom", boredom, boredomMin: c.boredomMin };
  }

  return { ok: true, boredom };
}

function randIntInclusiveFromGmRng(gm, min, max, onDirty) {
  const lo = (min | 0);
  const hi = (max | 0);
  if (hi <= lo) return lo;
  const span = (hi - lo + 1) | 0;
  const u = gmRngNextUint32(gm, onDirty) >>> 0;
  return lo + (u % span);
}

export function consumeInterventionCooldown(ctx, gm, turn, meta, onDirty) {
  const p = ensurePacing(gm);
  if (!p) return null;

  const cfg = getPacingConfig(ctx);
  const safeTurn = (turn | 0);

  const cooldownTurns = randIntInclusiveFromGmRng(gm, cfg.cooldownMinTurns, cfg.cooldownMaxTurns, onDirty);

  p.lastInterventionTurn = safeTurn;
  p.lastCooldownTurns = cooldownTurns;
  p.nextEligibleTurn = safeTurn + cooldownTurns;

  // Debug-only: keep the last intervention meta around if helpful.
  try {
    if (meta && typeof meta === "object") {
      p.lastIntervention = {
        kind: meta.kind != null ? String(meta.kind) : "intervention",
        channel: meta.channel != null ? String(meta.channel) : "",
        turn: safeTurn,
      };
    }
  } catch (_) {}

  if (typeof onDirty === "function") onDirty(gm);

  return { cooldownTurns, nextEligibleTurn: p.nextEligibleTurn };
}
