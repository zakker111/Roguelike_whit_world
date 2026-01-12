/**
 * Capabilities helpers: ctx-first module access and safe calls.
 *
 * Exports (ESM + window.Capabilities):
 * - safeGet(ctx, name): returns ctx[name] or window[name] or null
 * - safeCall(ctx, modName, fnName, ...args): calls ctx-first then window, returns { ok, result }
 * - has(ctx, modName, fnName?): boolean presence check
 */
export function safeGet(ctx, name) {
  try {
    if (ctx && typeof ctx === "object" && Object.prototype.hasOwnProperty.call(ctx, name)) {
      const v = ctx[name];
      if (v != null) return v;
    }
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, name)) {
      const v = window[name];
      if (v != null) return v;
    }
  } catch (_) {}
  return null;
}

export function has(ctx, modName, fnName) {
  try {
    const mod = safeGet(ctx, modName);
    if (!mod) return false;
    if (typeof fnName === "string" && fnName) return typeof mod[fnName] === "function";
    return true;
  } catch (_) {
    return false;
  }
}

export function safeCall(ctx, modName, fnName, ...args) {
  // Try ctx-first
  try {
    const mod = safeGet(ctx, modName);
    if (mod && typeof mod[fnName] === "function") {
      const result = mod[fnName](...(args || []));
      return { ok: true, result };
    }
  } catch (_) {}
  // Then window
  try {
    const w = (typeof window !== "undefined") ? window : {};
    const mod = w[modName] || null;
    if (mod && typeof mod[fnName] === "function") {
      const result = mod[fnName](...(args || []));
      return { ok: true, result };
    }
  } catch (_) {}
  return { ok: false, result: undefined };
}

// --- Health registration (modules + data) ---

const MODULE_HEALTH_SPECS = [];
const DATA_HEALTH_SPECS = [];

/**
 * Register or update a module health spec.
 * Modules can call this at load time so HealthCheck can include them in the
 * boot report without hard-coding every module name.
 */
export function registerModuleHealth(spec) {
  if (!spec || typeof spec !== "object") return;
  const idRaw = spec.id || spec.modName || "";
  const id = String(idRaw || "").trim();
  if (!id) return;
  const label = spec.label ? String(spec.label) : id;
  const modName = spec.modName ? String(spec.modName) : id;
  const required = !!spec.required;
  const requiredFns = Array.isArray(spec.requiredFns) ? spec.requiredFns.filter(Boolean) : [];
  const notes = spec.notes != null ? String(spec.notes) : undefined;

  const normalized = { id, label, modName, required, requiredFns, notes };
  const idx = MODULE_HEALTH_SPECS.findIndex((m) => m && m.id === id);
  if (idx !== -1) MODULE_HEALTH_SPECS[idx] = normalized;
  else MODULE_HEALTH_SPECS.push(normalized);
}

/**
 * Return a shallow copy of registered module health specs.
 */
export function getModuleHealthSpecs() {
  return MODULE_HEALTH_SPECS.slice();
}

/**
 * Register or update a data health spec for GameData domains.
 * Used by HealthCheck to report missing/empty registries.
 */
export function registerDataHealth(spec) {
  if (!spec || typeof spec !== "object") return;
  const idRaw = spec.id || spec.path || "";
  const id = String(idRaw || "").trim();
  if (!id) return;
  const label = spec.label ? String(spec.label) : id;
  const path = spec.path ? String(spec.path) : id;
  const required = !!spec.required;
  const normalized = { id, label, path, required };
  const idx = DATA_HEALTH_SPECS.findIndex((d) => d && d.id === id);
  if (idx !== -1) DATA_HEALTH_SPECS[idx] = normalized;
  else DATA_HEALTH_SPECS.push(normalized);
}

/**
 * Return a shallow copy of registered data health specs.
 */
export function getDataHealthSpecs() {
  return DATA_HEALTH_SPECS.slice();
}

// Pre-register core engine modules so they appear in the boot health report.
// New modules should register themselves via Capabilities.registerModuleHealth.
try {
  registerModuleHealth({
    id: "WorldRuntime",
    label: "WorldRuntime",
    modName: "WorldRuntime",
    required: true,
    requiredFns: ["generate"],
    notes: "Generates overworld maps.",
  });
  registerModuleHealth({
    id: "DungeonRuntime",
    label: "DungeonRuntime",
    modName: "DungeonRuntime",
    required: true,
    requiredFns: ["generate"],
    notes: "Generates dungeon and tower maps.",
  });
  registerModuleHealth({
    id: "Player",
    label: "Player module",
    modName: "Player",
    required: true,
    requiredFns: ["createInitial", "getAttack", "getDefense", "gainXP"],
    notes: "Player stats, inventory, equipment, XP/level.",
  });
  registerModuleHealth({
    id: "TurnLoop",
    label: "TurnLoop",
    modName: "TurnLoop",
    required: false,
    requiredFns: ["tick"],
    notes: "Centralized turn processing; falls back to inline turn logic when absent.",
  });
  registerModuleHealth({
    id: "Combat",
    label: "Combat module",
    modName: "Combat",
    required: false,
    requiredFns: ["rollHitLocation", "enemyDamageAfterDefense", "enemyDamageMultiplier"],
    notes: "If missing, CombatFacade uses core/fallbacks.js.",
  });
  registerModuleHealth({
    id: "Fallbacks",
    label: "Fallbacks module",
    modName: "Fallbacks",
    required: false,
    requiredFns: ["rollHitLocation", "enemyDamageAfterDefense", "enemyDamageMultiplier"],
    notes: "Minimal combat/stat formulas used when Combat/Stats are unavailable.",
  });
  registerModuleHealth({
    id: "EquipmentDecay",
    label: "EquipmentDecay",
    modName: "EquipmentDecay",
    required: false,
    requiredFns: ["decayAttackHands", "decayBlockingHands"],
    notes: "If missing, InventoryDecayFacade applies simple hands decay with warnings.",
  });
  registerModuleHealth({
    id: "RNG",
    label: "RNG Service",
    modName: "RNG",
    // Mark as required and list all exported functions so the health check\n    // will fail if the RNG service is not attached to window.\n    required: true,
    requiredFns: ["init", "applySeed", "autoInit", "rng", "int", "float", "chance", "getSeed"],
    notes: "Core RNG service; required for deterministic gameplay.",
  });
  registerModuleHealth({
    id: "UIOrchestration",
    label: "UIOrchestration",
    modName: "UIOrchestration",
    required: false,
    requiredFns: ["updateStats"],
    notes: "HUD orchestration; game can still run headless without it.",
  });
  registerModuleHealth({
    id: "ShopService",
    label: "ShopService",
    modName: "ShopService",
    required: false,
    requiredFns: ["getInventoryForShop", "buyItem", "sellItem"],
    notes: "Shop inventories and prices; missing data may lead to empty shops.",
  });
  // Intentional failing module for testing HealthCheck behavior.
  // There is no TestMissingModule in ctx or window, so the health report
  // will always log this as FAILED without affecting gameplay.
  registerModuleHealth({
    id: "HealthTestMissingModule",
    label: "Test module (intentional fail)",
    modName: "TestMissingModule",
    required: true,
    requiredFns: ["init"],
    notes: "Deliberately missing module to verify HealthCheck boot report.",
  });
} catch (_) {}

// Pre-register core GameData domains. New data domains can be added here or via
// Capabilities.registerDataHealth from other modules.
try {
  registerDataHealth({ id: "items", label: "Items registry", path: "items", required: true });
  registerDataHealth({ id: "enemies", label: "Enemies registry", path: "enemies", required: true });
  registerDataHealth({ id: "npcs", label: "NPCs registry", path: "npcs", required: true });
  registerDataHealth({ id: "consumables", label: "Consumables registry", path: "consumables", required: true });
  registerDataHealth({ id: "town", label: "Town config", path: "town", required: true });
  registerDataHealth({ id: "tiles", label: "Tiles (world assets)", path: "tiles", required: true });
  registerDataHealth({ id: "props", label: "Props (world assets)", path: "props", required: false });
  registerDataHealth({ id: "encounters", label: "Encounter templates", path: "encounters", required: true });
  registerDataHealth({ id: "shopPools", label: "Shop pools", path: "shopPools", required: false });
  registerDataHealth({ id: "shopRules", label: "Shop rules", path: "shopRules", required: false });
  registerDataHealth({ id: "palette", label: "Palette", path: "palette", required: false });
} catch (_) {}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Capabilities", {
  safeGet,
  safeCall,
  has,
  registerModuleHealth,
  getModuleHealthSpecs,
  registerDataHealth,
  getDataHealthSpecs,
});