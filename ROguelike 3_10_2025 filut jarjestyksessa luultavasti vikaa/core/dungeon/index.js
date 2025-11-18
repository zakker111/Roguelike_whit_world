/**
 * Dungeon module aggregator:
 * - Phase 2: expose state helpers from core/dungeon/state.js
 * - Other APIs still come from core/dungeon_runtime.js
 */

import * as DungeonRuntime from '../dungeon_runtime.js';

// State helpers (extracted)
export { keyFromWorldPos, save, load } from './state.js';

// Remaining APIs from the existing runtime
export {
  generate,
  generateLoot,
  returnToWorldIfAtExit,
  lootHere,
  killEnemy,
  enter,
  tryMoveDungeon,
  tick
} from '../dungeon_runtime.js';

// Optional default export for convenience (unchanged)
export default DungeonRuntime;