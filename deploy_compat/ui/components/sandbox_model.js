/**
 * Sandbox model helpers: enemy list + form sync for SandboxPanel (F10).
 *
 * Exports:
 * - LOOT_WEAPON_KEYS, LOOT_ARMOR_KEYS
 * - loadEnemyTypes()
 * - populateEntitySelect()
 * - getEnemyTypes()
 * - setEnemyId(id)
 * - updateEntityStatusLabel()
 * - syncBasicFormFromData()
 * - syncLootFormFromData()
 * - getCtxSafe()
 *
 * Notes:
 * - UI-layer only: works with DOM, GameData, GameAPI, and Enemies registry.
 * - Current enemy id and classification come from sandbox_spawn helpers.
 */

import { classifyEntityId, currentEnemyId } from "/ui/components/sandbox_spawn.js";

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

// Cached entity ids from enemy and animal registries
let _enemyTypes = [];

// Curated loot keys exposed in the sandbox loot editor.
export const LOOT_WEAPON_KEYS = [
  "sword_simple",
  "axe",
  "dagger",
  "mace",
  "club",
  "torch_weapon",
  "greatsword",
];

export const LOOT_ARMOR_KEYS = [
  "shield",
  "helmet",
  "torso_armor",
  "leg_armor",
  "gloves",
];

export function getEnemyTypes() {
  return _enemyTypes;
}

export function updateEntityStatusLabel() {
  try {
    const line = byId("sandbox-entity-status-line");
    const txt = byId("sandbox-entity-status-text");
    if (!line || !txt) return;
    const id = currentEnemyId();
    const kind = classifyEntityId(id);
    let label = "(no id)";
    let color = "#9ca3af";

    if (!id) {
      label = "(no id)";
    } else if (kind === "enemy") {
      label = "enemy (enemies.json)";
      color = "#a5b4fc";
    } else if (kind === "animal") {
      label = "animal (animals.json)";
      color = "#6ee7b7";
    } else if (kind === "custom") {
      label = "custom sandbox-only (not in enemies.json)";
      color = "#fbbf24";
    } else {
      label = "unknown";
      color = "#fca5a5";
    }

    txt.textContent = label;
    line.style.color = color;
  } catch (_) {}
}

export function loadEnemyTypes() {
  try {
    const combined = [];
    const seen = Object.create(null);

    // Enemy ids from registry
    try {
      const EM = (typeof window !== "undefined" ? window.Enemies : null);
      if (EM && typeof EM.listTypes === "function") {
        const list = EM.listTypes() || [];
        if (Array.isArray(list)) {
          for (let i = 0; i < list.length; i++) {
            const id = list[i];
            if (!id) continue;
            const k = String(id);
            if (!seen[k]) {
              seen[k] = true;
              combined.push(k);
            }
          }
        }
      }
    } catch (_) {}

    // Animal ids from GameData.animals
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const animals = GD && Array.isArray(GD.animals) ? GD.animals : null;
      if (animals) {
        for (let i = 0; i < animals.length; i++) {
          const row = animals[i];
          if (!row || !row.id) continue;
          const k = String(row.id);
          if (!seen[k]) {
            seen[k] = true;
            combined.push(k);
          }
        }
      }
    } catch (_) {}

    _enemyTypes = combined;
    _enemyTypes.sort();
  } catch (_) {
    _enemyTypes = [];
  }
  return _enemyTypes;
}

export function populateEntitySelect() {
  try {
    const sel = byId("sandbox-entity-select");
    if (!sel) return;

    while (sel.firstChild) sel.removeChild(sel.firstChild);

    const optEmpty = document.createElement("option");
    optEmpty.value = "";
    optEmpty.textContent = "(custom id)";
    sel.appendChild(optEmpty);

    if (!_enemyTypes || !_enemyTypes.length) return;

    let animalIds = null;
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const animals = GD && Array.isArray(GD.animals) ? GD.animals : null;
      if (animals) {
        animalIds = new Set();
        for (let i = 0; i < animals.length; i++) {
          const row = animals[i];
          if (!row || !row.id) continue;
          animalIds.add(String(row.id).toLowerCase());
        }
      }
    } catch (_) {}

    for (let i = 0; i < _enemyTypes.length; i++) {
      const id = _enemyTypes[i];
      if (!id) continue;
      const opt = document.createElement("option");
      opt.value = id;
      const lower = String(id).toLowerCase();
      if (animalIds && animalIds.has(lower)) opt.textContent = id + " (animal)";
      else opt.textContent = id;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

export function setEnemyId(id) {
  const v = id || "";
  const input = byId("sandbox-enemy-id");
  if (input) {
    input.value = v;
  }
  const sel = byId("sandbox-entity-select");
  if (sel) {
    let found = false;
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === v) {
        sel.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found) sel.selectedIndex = 0;
  }
}

export function getCtxSafe() {
  try {
    if (!window.GameAPI || typeof window.GameAPI.getCtx !== "function") return null;
    return window.GameAPI.getCtx() || null;
  } catch (_) {
    return null;
  }
}

export function syncBasicFormFromData() {
  try {
    const enemyId = currentEnemyId();
    if (!enemyId) {
      updateEntityStatusLabel();
      return;
    }

    const ctx = getCtxSafe();
    if (!ctx) {
      updateEntityStatusLabel();
      return;
    }

    const EM = (typeof window !== "undefined" ? window.Enemies : null);
    const def = EM && typeof EM.getDefById === "function" ? EM.getDefById(enemyId) : null;

    const overridesRoot = ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object"
      ? ctx.sandboxEnemyOverrides
      : null;
    const override = overridesRoot ? (overridesRoot[enemyId] || overridesRoot[String(enemyId).toLowerCase()] || null) : null;

    const depthInput = byId("sandbox-test-depth");
    let depth = 3;
    if (depthInput && depthInput.value) {
      const v = (Number(depthInput.value) || 0) | 0;
      if (v > 0) depth = v;
    } else if (override && typeof override.testDepth === "number") {
      depth = (override.testDepth | 0) || 3;
    } else if (typeof ctx.floor === "number") {
      depth = (ctx.floor | 0) || 3;
    }
    if (depthInput) depthInput.value = String(depth);

    const hpBase = def && typeof def.hp === "function" ? def.hp(depth) : 0;
    const atkBase = def && typeof def.atk === "function" ? def.atk(depth) : 0;
    const xpBase = def && typeof def.xp === "function" ? def.xp(depth) : 0;

    const glyphInput = byId("sandbox-glyph");
    const colorInput = byId("sandbox-color");
    const factionInput = byId("sandbox-faction");
    const hpInput = byId("sandbox-hp");
    const atkInput = byId("sandbox-atk");
    const xpInput = byId("sandbox-xp");
    const dmgInput = byId("sandbox-damage-scale");
    const eqInput = byId("sandbox-equip-chance");
    const tierInput = byId("sandbox-equip-tier");

    function assignText(input, fromOverride, fromDef) {
      if (!input) return;
      if (fromOverride !== null && fromOverride !== undefined) {
        input.value = String(fromOverride);
        return;
      }
      if (fromDef !== null && fromDef !== undefined && fromDef !== "") {
        input.value = String(fromDef);
      }
      // Otherwise leave the existing value untouched.
    }

    assignText(
      glyphInput,
      (override && typeof override.glyph === "string" && override.glyph) ? override.glyph : null,
      def && def.glyph ? def.glyph : null
    );
    assignText(
      colorInput,
      (override && typeof override.color === "string" && override.color) ? override.color : null,
      def && def.color ? def.color : null
    );
    assignText(
      factionInput,
      (override && typeof override.faction === "string" && override.faction) ? override.faction : null,
      def && def.faction ? def.faction : null
    );

    assignText(
      hpInput,
      (override && typeof override.hpAtDepth === "number") ? override.hpAtDepth : null,
      hpBase > 0 ? hpBase : null
    );
    assignText(
      atkInput,
      (override && typeof override.atkAtDepth === "number") ? override.atkAtDepth : null,
      atkBase > 0 ? atkBase : null
    );
    assignText(
      xpInput,
      (override && typeof override.xpAtDepth === "number") ? override.xpAtDepth : null,
      xpBase > 0 ? xpBase : null
    );

    const baseDamageScale = (def && typeof def.damageScale === "number" ? def.damageScale : 1.0);
    const baseEquipChance = (def && typeof def.equipChance === "number" ? def.equipChance : 0.35);
    const baseEquipTier = (def && typeof def.tier === "number" ? def.tier : 1);

    assignText(
      dmgInput,
      (override && typeof override.damageScale === "number") ? override.damageScale : null,
      baseDamageScale
    );
    assignText(
      eqInput,
      (override && typeof override.equipChance === "number") ? override.equipChance : null,
      baseEquipChance
    );
    assignText(
      tierInput,
      (override && typeof override.equipTierOverride === "number") ? override.equipTierOverride : null,
      baseEquipTier
    );

    updateEntityStatusLabel();

    // Also refresh the loot editor from current base + sandbox overrides.
    syncLootFormFromData();
  } catch (_) {}
}

export function syncLootFormFromData() {
  try {
    const enemyId = currentEnemyId();
    if (!enemyId) return;
    const ctx = getCtxSafe();
    if (!ctx) return;

    const EM = (typeof window !== "undefined" ? window.Enemies : null);
    const def = EM && typeof EM.getDefById === "function" ? EM.getDefById(enemyId) : null;

    const overridesRoot = ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object"
      ? ctx.sandboxEnemyOverrides
      : null;
    const override = overridesRoot
      ? (overridesRoot[enemyId] || overridesRoot[String(enemyId).toLowerCase()] || null)
      : null;

    let lootRoot = null;
    if (override && override.lootPools && typeof override.lootPools === "object") {
      lootRoot = override.lootPools;
    } else if (def && def.lootPools && typeof def.lootPools === "object") {
      lootRoot = def.lootPools;
    }

    // Potions
    const potL = byId("sandbox-loot-pot-lesser");
    const potA = byId("sandbox-loot-pot-average");
    const potS = byId("sandbox-loot-pot-strong");
    const pot = lootRoot && lootRoot.potions && typeof lootRoot.potions === "object" ? lootRoot.potions : null;

    const potVals = {
      lesser: pot && pot.lesser != null ? pot.lesser : 0,
      average: pot && pot.average != null ? pot.average : 0,
      strong: pot && pot.strong != null ? pot.strong : 0,
    };

    if (potL) potL.value = potVals.lesser > 0 ? String(potVals.lesser) : "";
    if (potA) potA.value = potVals.average > 0 ? String(potVals.average) : "";
    if (potS) potS.value = potVals.strong > 0 ? String(potVals.strong) : "";

    // Weapons
    const weaponsRoot = lootRoot && lootRoot.weapons && typeof lootRoot.weapons === "object" ? lootRoot.weapons : null;
    for (let i = 0; i < LOOT_WEAPON_KEYS.length; i++) {
      const key = LOOT_WEAPON_KEYS[i];
      const input = byId("sandbox-loot-weapon-" + key);
      if (!input) continue;
      let w = 0;
      if (weaponsRoot && typeof weaponsRoot[key] === "number") {
        w = weaponsRoot[key];
      }
      input.value = w > 0 ? String(w) : "";
    }

    // Armor
    const armorRoot = lootRoot && lootRoot.armor && typeof lootRoot.armor === "object" ? lootRoot.armor : null;
    for (let i = 0; i < LOOT_ARMOR_KEYS.length; i++) {
      const key = LOOT_ARMOR_KEYS[i];
      const input = byId("sandbox-loot-armor-" + key);
      if (!input) continue;
      let w = 0;
      if (armorRoot && typeof armorRoot[key] === "number") {
        w = armorRoot[key];
      }
      input.value = w > 0 ? String(w) : "";
    }
  } catch (_) {}
}
