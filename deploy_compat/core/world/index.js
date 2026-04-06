/**
 * World module aggregator:
 * - Expose extracted helpers from core/world/* modules
 */

import * as WorldRuntime from '../world_runtime.js';

// POI helpers (extracted)
export { ensurePOIState, addTown, addCastle, addDungeon, addRuins } from './poi.js';

// Extracted modules (Phase 3)
export { ensureInBounds, expandMap } from './expand.js';
export { tryMovePlayerWorld } from './move.js';
export { tick } from './tick.js';

// Keep generate from runtime for now
export { generate } from '../world_runtime.js';

// Optional default export for convenience
export default WorldRuntime;