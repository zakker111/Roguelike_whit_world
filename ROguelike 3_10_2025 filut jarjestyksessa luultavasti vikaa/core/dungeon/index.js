/**
 * Dungeon module aggregator (Phase 1): re-exports from core/dungeon_runtime.js.
 * Keeps API stable while future phases split into submodules.
 */

import * as DungeonRuntime from '../dungeon_runtime.js';

// Re-export public API from the existing runtime
export {
  keyFromWorldPos,
  save,
  load,
  generate,
  generateLoot,
  returnToWorldIfAtExit,
  lootHere,
  killEnemy,
  enter,
  tryMoveDungeon,
  tick
} from '../dungeon_runtime.js';

// Optional default export for convenience
export default DungeonRuntime;