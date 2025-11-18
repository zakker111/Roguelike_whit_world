/**
 * World module aggregator:
 * - Phase 2: expose POI helpers from core/world/poi.js
 * - Other APIs still come from core/world_runtime.js
 */

import * as WorldRuntime from '../world_runtime.js';

// POI helpers (extracted)
export { ensurePOIState, addTown, addDungeon, addRuins } from './poi.js';

// Re-export public API from the existing runtime
export {
  generate,
  tryMovePlayerWorld,
  tick,
  _ensureInBounds,
  _ensureInBounds as ensureInBounds
} from '../world_runtime.js';

// Optional default export for convenience
export default WorldRuntime;