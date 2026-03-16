import {
  getPlayerAttack as combatGetPlayerAttack,
  getPlayerDefense as combatGetPlayerDefense,
  rollHitLocation as combatRollHitLocation,
  critMultiplier as combatCritMultiplier,
  getEnemyBlockChance as combatGetEnemyBlockChance,
  getPlayerBlockChance as combatGetPlayerBlockChance,
  enemyDamageAfterDefense as combatEnemyDamageAfterDefense,
  enemyDamageMultiplier as combatEnemyDamageMultiplier,
  enemyThreatLabel as combatEnemyThreatLabel
} from "../facades/combat.js";

// Small helper to reduce boilerplate in core/game.js while keeping ctx-first signatures.
export function createCombatOps(getCtx) {
  const ctx = () => (typeof getCtx === "function" ? getCtx() : null);

  function getPlayerAttack() {
    return combatGetPlayerAttack(ctx());
  }

  function getPlayerDefense() {
    return combatGetPlayerDefense(ctx());
  }

  function rollHitLocation() {
    return combatRollHitLocation(ctx());
  }

  function critMultiplier() {
    return combatCritMultiplier(ctx());
  }

  function getEnemyBlockChance(enemy, loc) {
    return combatGetEnemyBlockChance(ctx(), enemy, loc);
  }

  function getPlayerBlockChance(loc) {
    return combatGetPlayerBlockChance(ctx(), loc);
  }

  function enemyDamageAfterDefense(raw) {
    return combatEnemyDamageAfterDefense(ctx(), raw);
  }

  function enemyDamageMultiplier(level) {
    return combatEnemyDamageMultiplier(ctx(), level);
  }

  function enemyThreatLabel(enemy) {
    return combatEnemyThreatLabel(ctx(), enemy);
  }

  return {
    getPlayerAttack,
    getPlayerDefense,
    rollHitLocation,
    critMultiplier,
    getEnemyBlockChance,
    getPlayerBlockChance,
    enemyDamageAfterDefense,
    enemyDamageMultiplier,
    enemyThreatLabel,
  };
}

// Back-compat alias (core/game.js originally imported createGameCombatOps)
export const createGameCombatOps = createCombatOps;
