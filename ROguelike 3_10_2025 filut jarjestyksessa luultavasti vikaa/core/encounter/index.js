/**
 * Encounter module aggregator (Phase 1): re-exports from core/encounter_runtime.js.
 * Keeps API stable while future phases split into submodules.
 */

import * as EncounterRuntime from '../encounter_runtime.js';

// Re-export public API from the existing runtime
export {
  enter,
  tryMoveEncounter,
  tick,
  complete,
  enterRegion
} from '../encounter_runtime.js';

// Optional default export for convenience
export default EncounterRuntime;