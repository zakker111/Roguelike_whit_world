/**
 * Dungeon module aggregator:
 * - Expose extracted helpers from core/dungeon/* modules
 * - Keep killEnemy from core/dungeon_runtime.js for now
 */

import * as DungeonRuntime from '../dungeon_runtime.js';

// State helpers (extracted)
export { keyFromWorldPos, save, load } from './state.js';

// Extracted modules (Phase 3)
export { generate } from './generate.js';
export { generateLoot, lootHere } from './loot.js';
export { tryMoveDungeon } from './movement.js';
export { tick } from './tick.js';
export { returnToWorldIfAtExit } from './transitions.js';
export { enter } from './enter.js';

// Still export killEnemy from runtime until we extract it
export { killEnemy } from '../dungeon_runtime.js';

// Optional default export for convenience (unchanged)
export default DungeonRuntime;