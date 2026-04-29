/**
 * Encounter module aggregator:
 * - Expose extracted helpers from core/encounter/* modules
 */

import * as EncounterRuntime from '../encounter_runtime.js';

export { enter } from './enter.js';
export { tryMoveEncounter } from './movement.js';
export { tick } from './tick.js';
export { complete } from './transitions.js';
export { enterRegion } from './enter_region.js';

export default EncounterRuntime;