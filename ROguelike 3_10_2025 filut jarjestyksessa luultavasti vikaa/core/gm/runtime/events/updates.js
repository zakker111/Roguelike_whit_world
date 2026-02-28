/**
 * GMRuntime event update helpers.
 *
 * Design constraints:
 * - Deterministic: derived only from inputs + existing `gm` state.
 * - Side-effect free beyond mutating the provided GM state bag.
 * - Must not touch localStorage (or any other persistence).
 */

import { GUARD_FINE_HEAT_TURNS } from "../constants.js";

import {
  ensureTraitsAndMechanics,
  ensureFactionEvents,
} from "../state_ensure.js";

import { normalizeTurn } from "../turn_utils.js";

/**
 * Extract a single family key from an event's tags.
 *
 * Prefers `kind:*` tags over `race:*` tags.
 *
 * @param {unknown} rawTags
 * @returns {string|null}
 */
export function extractFamilyKeyFromTags(rawTags) {
  if (!Array.isArray(rawTags) || rawTags.length === 0) return null;
  const tags = [];
  for (let i = 0; i < rawTags.length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    tags.push(String(tag).toLowerCase());
  }
  if (!tags.length) return null;

  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.startsWith("kind:")) {
      const fam = t.slice(5).trim();
      if (fam) return fam;
    }
  }
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.startsWith("race:")) {
      const fam = t.slice(5).trim();
      if (fam) return fam;
    }
  }
  return null;
}

/**
 * Extract all faction keys from an event's tags.
 *
 * @param {unknown} rawTags
 * @returns {string[]}
 */
export function extractFactionKeysFromTags(rawTags) {
  if (!rawTags) return [];

  let length = 0;
  if (Array.isArray(rawTags)) length = rawTags.length;
  else if (typeof rawTags.length === "number") {
    length = rawTags.length | 0;
    if (length < 0) length = 0;
  }

  if (length === 0) return [];

  const keys = [];
  const seen = Object.create(null);
  for (let i = 0; i < length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    const t = String(tag).toLowerCase();
    if (!t || !t.startsWith("faction:")) continue;
    const key = t.slice(8).trim();
    if (!key || seen[key]) continue;
    seen[key] = true;
    keys.push(key);
  }

  return keys;
}

/**
 * Update `gm.families` metrics based on a `combat.kill` event.
 *
 * @param {Record<string, any>} families
 * @param {any} event
 * @param {number} turn
 * @returns {void}
 */
export function updateFamiliesFromCombatKill(families, event, turn) {
  if (!families || !event) return;
  const famKey = extractFamilyKeyFromTags(event.tags);
  if (!famKey) return;

  let fam = families[famKey];
  if (!fam || typeof fam !== "object") {
    fam = { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null };
    families[famKey] = fam;
  }

  fam.seen = (fam.seen | 0) + 1;
  if (fam.seen < 0) fam.seen = 0;
  fam.positive = (fam.positive | 0) + 1;
  if (fam.positive < 0) fam.positive = 0;
  fam.lastUpdatedTurn = normalizeTurn(turn);
}

/**
 * Update `gm.factions` metrics based on a `combat.kill` event.
 *
 * @param {Record<string, any>} factions
 * @param {any} event
 * @param {number} turn
 * @returns {void}
 */
export function updateFactionsFromCombatKill(factions, event, turn) {
  if (!factions || !event) return;
  const keys = extractFactionKeysFromTags(event.tags);
  if (!keys.length) return;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let entry = factions[key];
    if (!entry || typeof entry !== "object") {
      entry = { seen: 0, positive: 0, negative: 0, lastUpdatedTurn: null };
      factions[key] = entry;
    }

    entry.seen = (entry.seen | 0) + 1;
    if (entry.seen < 0) entry.seen = 0;
    entry.positive = (entry.positive | 0) + 1;
    if (entry.positive < 0) entry.positive = 0;
    entry.lastUpdatedTurn = normalizeTurn(turn);
  }
}

/**
 * Apply an (optional) delta triple to a trait entry in-place.
 *
 * @param {any} trait
 * @param {number} deltaSeen
 * @param {number} deltaPositive
 * @param {number} deltaNegative
 * @param {number} turn
 * @returns {void}
 */
export function applyTraitDelta(trait, deltaSeen, deltaPositive, deltaNegative, turn) {
  if (!trait) return;
  const hasDelta = (deltaSeen | 0) !== 0 || (deltaPositive | 0) !== 0 || (deltaNegative | 0) !== 0;
  if (!hasDelta) return;

  if (deltaSeen) {
    let v = (trait.seen | 0) + (deltaSeen | 0);
    if (v < 0) v = 0;
    trait.seen = v;
  }
  if (deltaPositive) {
    let v = (trait.positive | 0) + (deltaPositive | 0);
    if (v < 0) v = 0;
    trait.positive = v;
  }
  if (deltaNegative) {
    let v = (trait.negative | 0) + (deltaNegative | 0);
    if (v < 0) v = 0;
    trait.negative = v;
  }

  trait.lastUpdatedTurn = normalizeTurn(turn);
}

/**
 * Update `gm.traits` based on a `combat.kill` event.
 *
 * @param {Record<string, any>} traits
 * @param {any} event
 * @param {number} turn
 * @returns {void}
 */
export function updateTraitsFromCombatKill(traits, event, turn) {
  if (!traits || !event) return;
  const rawTags = Array.isArray(event.tags) ? event.tags : [];
  if (!rawTags.length) return;

  const tags = [];
  for (let i = 0; i < rawTags.length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    tags.push(String(tag).toLowerCase());
  }
  if (!tags.length) return;

  const hasKindTroll = tags.indexOf("kind:troll") !== -1;
  const hasRaceTroll = tags.indexOf("race:troll") !== -1;
  if (hasKindTroll || hasRaceTroll) {
    applyTraitDelta(traits.trollSlayer, 1, 1, 0, turn);
  }

  const hasBandit = tags.indexOf("faction:bandit") !== -1;
  const hasGuard = tags.indexOf("faction:guard") !== -1;
  const hasTownFaction = tags.indexOf("faction:town") !== -1;
  const hasContextTown = tags.indexOf("context:town") !== -1;
  const hasContextCastle = tags.indexOf("context:castle") !== -1;

  if (hasBandit && (hasContextTown || hasContextCastle)) {
    applyTraitDelta(traits.townProtector, 1, 1, 0, turn);
  }

  if ((hasGuard || hasTownFaction) && (hasContextTown || hasContextCastle)) {
    applyTraitDelta(traits.townProtector, 1, 0, 1, turn);
  }

  const hasCaravanTag = tags.indexOf("caravan") !== -1;
  const hasCaravanGuardTag = tags.indexOf("caravanguard") !== -1;
  if (hasCaravanTag || hasCaravanGuardTag) {
    applyTraitDelta(traits.caravanAlly, 1, 0, 1, turn);
  }
}

/**
 * Update `gm.traits` based on a `quest.complete` event.
 *
 * @param {Record<string, any>} traits
 * @param {any} event
 * @param {number} turn
 * @returns {void}
 */
export function updateTraitsFromQuestComplete(traits, event, turn) {
  if (!traits || !event) return;
  const rawTags = Array.isArray(event.tags) ? event.tags : [];
  if (!rawTags.length) return;

  const tags = [];
  for (let i = 0; i < rawTags.length; i++) {
    const tag = rawTags[i];
    if (tag == null) continue;
    tags.push(String(tag).toLowerCase());
  }
  if (!tags.length) return;

  const hasTrollHunt = tags.indexOf("trollhunt") !== -1;
  const hasTrollSlayerTag = tags.indexOf("trollslayer") !== -1;
  const hasTrollHelp = tags.indexOf("trollhelp") !== -1;
  if (hasTrollHunt || hasTrollSlayerTag || hasTrollHelp) {
    let deltaPositive = 0;
    let deltaNegative = 0;
    if (hasTrollHunt || hasTrollSlayerTag) deltaPositive += 1;
    if (hasTrollHelp) deltaNegative += 1;
    applyTraitDelta(traits.trollSlayer, 1, deltaPositive, deltaNegative, turn);
  }

  const hasTownDefense = tags.indexOf("towndefense") !== -1;
  const hasTownHelp = tags.indexOf("townhelp") !== -1;
  const hasAttackTown = tags.indexOf("attacktown") !== -1;
  if (hasTownDefense || hasTownHelp || hasAttackTown) {
    let deltaPositive = 0;
    let deltaNegative = 0;
    if (hasTownDefense || hasTownHelp) deltaPositive += 1;
    if (hasAttackTown) deltaNegative += 1;
    applyTraitDelta(traits.townProtector, 1, deltaPositive, deltaNegative, turn);
  }

  const hasCaravanHelp = tags.indexOf("caravanhelp") !== -1;
  const hasEscortCaravan = tags.indexOf("escortcaravan") !== -1;
  if (hasCaravanHelp || hasEscortCaravan) {
    applyTraitDelta(traits.caravanAlly, 1, 1, 0, turn);
  }
}

/**
 * Update `gm.traits` based on caravan-related events.
 *
 * @param {Record<string, any>} traits
 * @param {any} event
 * @param {number} turn
 * @returns {void}
 */
export function updateTraitsFromCaravanEvent(traits, event, turn) {
  if (!traits || !event) return;
  const trait = traits.caravanAlly;
  if (!trait) return;

  const type = String(event.type || "");
  let deltaSeen = 0;
  let deltaPositive = 0;
  let deltaNegative = 0;

  if (type === "caravan.accepted") {
    const reason = String(event.reason || "");
    if (reason === "escort") {
      deltaSeen += 1;
      deltaPositive += 1;
    }
  } else if (type === "caravan.completed") {
    if (event.success === true) {
      deltaSeen += 1;
      deltaPositive += 2;
    } else if (event.success === false) {
      deltaSeen += 1;
      deltaNegative += 1;
    }
  } else if (type === "caravan.attacked") {
    deltaSeen += 1;
    deltaNegative += 1;
  }

  applyTraitDelta(trait, deltaSeen, deltaPositive, deltaNegative, turn);
}

/**
 * Update `gm.mechanics[mechanicKey]` based on a `mechanic` event.
 *
 * @param {Record<string, any>} mechanics
 * @param {any} event
 * @param {number} turn
 * @returns {void}
 */
export function updateMechanicsUsage(mechanics, event, turn) {
  if (!mechanics || !event) return;

  const mechanic = String(event.mechanic || "");
  const action = String(event.action || "");
  const m = mechanics[mechanic];
  if (!m || typeof m !== "object") return;

  function inc(key) {
    let v = (m[key] | 0) + 1;
    if (v < 0) v = 0;
    m[key] = v;
  }

  let changed = false;

  if (action === "seen") {
    inc("seen");
    changed = true;
  } else if (action === "tried") {
    inc("tried");
    changed = true;
  } else if (action === "success") {
    inc("tried");
    inc("success");
    changed = true;
  } else if (action === "failure") {
    inc("tried");
    inc("failure");
    changed = true;
  } else if (action === "dismiss") {
    inc("dismiss");
    changed = true;
  }

  if (!changed) return;

  const safeTurn = normalizeTurn(turn);
  if (m.firstSeenTurn == null || (m.firstSeenTurn | 0) < 0) {
    m.firstSeenTurn = safeTurn;
  }
  m.lastUsedTurn = safeTurn;
}

/**
 * Apply guard fine event outcomes (pay/refuse) to faction metrics and story flags.
 *
 * @param {any} gm
 * @param {string} type
 * @param {number} turn
 * @returns {void}
 */
export function applyGuardFineOutcome(gm, type, turn) {
  if (!gm || typeof gm !== "object") return;

  ensureTraitsAndMechanics(gm);
  ensureFactionEvents(gm);

  const factions = gm.factions && typeof gm.factions === "object" ? gm.factions : {};
  const guard = factions.guard && typeof factions.guard === "object" ? factions.guard : null;
  const town = factions.town && typeof factions.town === "object" ? factions.town : null;

  const storyFlags = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : (gm.storyFlags = {});
  const safeTurn = normalizeTurn(turn);

  function bump(entry, deltaPositive, deltaNegative) {
    if (!entry || typeof entry !== "object") return;
    entry.seen = Math.max(0, (entry.seen | 0) + 1);
    entry.positive = Math.max(0, (entry.positive | 0) + (deltaPositive | 0));
    entry.negative = Math.max(0, (entry.negative | 0) + (deltaNegative | 0));
    entry.lastUpdatedTurn = safeTurn;
  }

  function maybeDecayGuardFineHeat() {
    const totalRefusals = storyFlags.guardFineRefusals | 0;
    if (totalRefusals <= 0) return;

    const rawLastRefusalTurn = storyFlags.guardFineLastRefusalTurn;
    if (typeof rawLastRefusalTurn !== "number") return;
    let lastRefusalTurn = rawLastRefusalTurn | 0;
    if (lastRefusalTurn < 0) lastRefusalTurn = 0;

    const age = safeTurn - lastRefusalTurn;
    if (age <= GUARD_FINE_HEAT_TURNS) return;

    const decayedRefusalsRaw = storyFlags.guardFineRefusalsDecayed;
    const decayedRefusals = decayedRefusalsRaw == null ? 0 : (decayedRefusalsRaw | 0);
    let pendingRefusals = totalRefusals - decayedRefusals;
    if (pendingRefusals <= 0) return;
    if (pendingRefusals > totalRefusals) pendingRefusals = totalRefusals;

    bump(guard, 0, pendingRefusals);
    bump(town, 0, pendingRefusals);

    storyFlags.guardFineRefusalsDecayed = decayedRefusals + pendingRefusals;
    storyFlags.guardFineHeatLastDecayTurn = safeTurn;
  }

  maybeDecayGuardFineHeat();

  if (type === "gm.guardFine.pay") {
    bump(guard, 0, 1);
    bump(town, 0, 1);
    storyFlags.guardFinePaid = true;
  } else if (type === "gm.guardFine.refuse") {
    bump(guard, 1, 0);
    bump(town, 1, 0);

    storyFlags.guardFineRefusals = (storyFlags.guardFineRefusals | 0) + 1;
    storyFlags.guardFineLastRefusalTurn = safeTurn;
  }
}
