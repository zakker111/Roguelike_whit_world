# core/game.js shrink slice — Combat + Inventory ops extraction

## Summary
This slice reduces boilerplate in `core/game.js` by extracting thin “ctx-first facade wrappers” into two small helper modules under `core/engine/`.

### New helper modules
- `core/engine/game_combat_ops.js`
  - Primary export: `createCombatOps(getCtx)`
  - Back-compat export: `createGameCombatOps` (alias)
- `core/engine/game_inventory_ops.js`
  - Primary export: `createInventoryOps(getCtx)`
  - Back-compat export: `createGameInventoryOps` (alias)

## What changed
### 1) Combat wrappers moved out of core/game.js
The following functions used to be implemented in `core/game.js` as one-liners calling `core/facades/combat.js`.

They now live in `core/engine/game_combat_ops.js`:
- `getPlayerAttack()`
- `getPlayerDefense()`
- `rollHitLocation()`
- `critMultiplier()`
- `getEnemyBlockChance(enemy, loc)`
- `getPlayerBlockChance(loc)`
- `enemyDamageAfterDefense(raw)`
- `enemyDamageMultiplier(level)`
- `enemyThreatLabel(enemy)`

### 2) Inventory + decay wrappers moved out of core/game.js
The following functions used to be implemented in `core/game.js` as thin wrappers around:
- `core/facades/inventory.js`
- `core/facades/inventory_decay.js`

They now live in `core/engine/game_inventory_ops.js`:
- `initialDecay(tier)`
- `rerenderInventoryIfOpen()`
- `decayEquipped(slot, amount)`
- `usingTwoHanded()`
- `decayAttackHands(light=false)`
- `decayBlockingHands()`
- `describeItem(item)`
- `equipIfBetter(item)`
- `addPotionToInventory(heal=3, name=\`potion (+${heal} HP)\`)`
- `drinkPotionByIndex(idx)`
- `eatFoodByIndex(idx)`
- `useItemByIndex(idx)`

(Plus UI helpers that were already one-liners in `core/game.js`):
- `renderInventoryPanel()`, `showInventoryPanel()`, `hideInventoryPanel()`
- `equipItemByIndex(idx)`, `equipItemByIndexHand(idx, hand)`, `unequipSlot(slot)`

### 3) core/game.js now instantiates ops once
`core/game.js` now does:
- `const combatOps = createGameCombatOps(getCtx);`
- `const inventoryOps = createGameInventoryOps(getCtx);`

…and destructures the needed functions.

## Invariants (must remain true)
### ctx API shape
The ctx object produced by `getCtx()` must continue to expose the same call surface consumed by other modules.

Notably:
- Combat consumers (AI/combat) still find:
  - `ctx.getPlayerAttack`, `ctx.getPlayerDefense`, `ctx.getPlayerBlockChance`, `ctx.getEnemyBlockChance`
- Equipment decay consumers still find (Capabilities requires these):
  - `ctx.decayAttackHands`, `ctx.decayBlockingHands`

### No gameplay behavior changes
The extracted functions are purely:
- `(…args) => facadeFn(getCtx(), …args)` wrappers
- plus the existing default argument behavior (e.g. potion naming)

There are no rule changes, RNG changes, or turn-loop changes.

## Static QA checklist
- `core/game.js` no longer references facade-local wrapper symbols such as:
  - `invInitialDecay`, `invDecayAttackHands`, `combatGetPlayerAttack`, etc.
- `core/game.js` still wires into ctx base:
  - `decayAttackHands`, `decayBlockingHands`
  - `getEnemyBlockChance`
- Only `core/game.js` imports `core/engine/game_*_ops.js` (internal helper modules).
