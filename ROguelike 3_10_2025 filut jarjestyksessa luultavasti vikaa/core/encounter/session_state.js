/**
 * Encounter session-level flags shared across modules.
 */
let _clearAnnounced = false;
let _victoryNotified = false;
let _currentQuestInstanceId = null;

export function resetSessionFlags() {
  _clearAnnounced = false;
  _victoryNotified = false;
}

export function setClearAnnounced(v) { _clearAnnounced = !!v; }
export function getClearAnnounced() { return !!_clearAnnounced; }

export function setVictoryNotified(v) { _victoryNotified = !!v; }
export function getVictoryNotified() { return !!_victoryNotified; }

export function setCurrentQuestInstanceId(id) { _currentQuestInstanceId = id ?? null; }
export function getCurrentQuestInstanceId() { return _currentQuestInstanceId; }