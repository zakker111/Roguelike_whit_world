/**
 * Dungeon module aggregator:
 * - Expose extracted helpers from core/dungeon/* modules
 */

import * as DungeonRuntime from '../dungeon_runtime.js';

// State helpers (extracted)
export { keyFromWorldPos, save, load } from './state.js';

// Extracted modules
export { generate } from './generate.js';
export { generateLoot, lootHere } from './loot.js';
export { tryMoveDungeon } from './movement.js';
export { tick } from './tick.js';
export { returnToWorldIfAtExit } from './transitions.js';
export { enter } from './enter.js';
export { killEnemy } from './kill_enemy.js';

// Optional default export for convenience (unchanged)
export default DungeonRuntime;