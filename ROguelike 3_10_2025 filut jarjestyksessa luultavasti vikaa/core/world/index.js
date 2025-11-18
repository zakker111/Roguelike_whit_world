/**
 * World module aggregator (Phase 1): re-exports from core/world_runtime.js.
 * Keeps API stable while future phases split into submodules.
 */

import * as WorldRuntime from '../world_runtime.js';

// Re-export public API from the existing runtime
export {
  generate,
  tryMovePlayerWorld,
  tick,
  _ensureInBounds,
  // Provide a friendlier alias too
  _ensureInBounds as ensureInBounds
} from '../world_runtime.js';

// Optional default export for convenience
export default WorldRuntime;