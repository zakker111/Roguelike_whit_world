/**
 * SandboxPanel: overlay for sandbox mode enemy testing (F10).
 *
 * Exports (ESM + window.SandboxPanel):
 * - init(UI)
 * - show()
 * - hide()
 * - isOpen()
 *
 * Behavior:
 * - Only intended for sandbox mode (ctx.mode === "sandbox").
 * - F10 toggles this panel via Input handlers wired in GameUIBridge.
 * - Focuses purely on enemy testing:
 *   - Enemy AI toggle (on/off)
 *   - Basic spawn: choose enemy id + count, spawn near player
 *   - Advanced: per-enemy loot pool toggles (weapons/armor/potions) for sandbox-only tests
 *
 * Generic GOD actions (heal, items, restart) remain in the GOD panel.
 */

import { classifyEntityId, currentEnemyId, spawnWithCount } from "/ui/components/sandbox_spawn.js";
import { copyEnemyJsonStubToClipboard } from "/ui/components/sandbox_export.js";

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

let _ui = null;
// Cached entity ids from enemy and animal registries
let _enemyTypes = [];

// Curated loot keys exposed in the sandbox loot editor.
const LOOT_WEAPON_KEYS = [
  "sword_simple",
  "axe",
  "dagger",
  "mace",
  "club",
  "torch_weapon",
  "greatsword",
];

const LOOT_ARMOR_KEYS = [
  "shield",
  "helmet",
  "torso_armor",
  "leg_armor",
  "gloves",
];



function updateEntityStatusLabel() {
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

function loadEnemyTypes() {
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
}

function populateEntitySelect() {
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

function setEnemyId(id) {
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

/**
 * Update the Enemy AI toggle button label from current ctx.sandboxFlags.
 */
function refreshAiToggle() {
  try {
    const btn = byId("sandbox-ai-toggle-btn");
    if (!btn || !window.GameAPI || typeof window.GameAPI.getCtx !== "function") return;
    const ctx = window.GameAPI.getCtx();
    if (!ctx) return;
    const flags = ctx.sandboxFlags || {};
    const on = flags.aiEnabled !== false;
    btn.textContent = on ? "Enemy AI: On" : "Enemy AI: Off";
  } catch (_) {}
}

/**
 * Helper: get current ctx safely.
 */
function getCtxSafe() {
  try {
    if (!window.GameAPI || typeof window.GameAPI.getCtx !== "function") return null;
    return window.GameAPI.getCtx() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Sync basic fields (test depth, glyph/color/faction, HP/ATK/XP, damageScale, equipChance)
 * from the base enemy definition and any sandbox override on ctx.
 *
 * For custom ids (not in enemies.json) or animals, we only apply sandbox overrides
 * and leave manual field edits as-is.
 */
function syncBasicFormFromData() {
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

function syncLootFormFromData() {
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



function ensurePanel() {
  let el = byId("sandbox-panel");
  if (el) return el;

  el = document.createElement("div");
  el.id = "sandbox-panel";
  el.style.position = "fixed";
  el.style.top = "16px";
  // Push further to the right and constrain width so all sections fit without overflowing too far
  el.style.right = "24px";
  el.style.zIndex = "31000";
  el.style.padding = "10px 12px";
  el.style.borderRadius = "8px";
  el.style.border = "1px solid #1f2937";
  el.style.background = "rgba(15,23,42,0.95)";
  el.style.boxShadow = "0 20px 40px rgba(0,0,0,0.7)";
  el.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  el.style.fontSize = "13px";
  el.style.color = "#e5e7eb";
  // Slightly wider to comfortably fit all rows and labels
  el.style.minWidth = "320px";
  el.style.maxWidth = "420px";
  el.style.maxHeight = "80vh";
  el.style.overflowY = "auto";

  el.innerHTML = `
    <div style="font-weight:600; letter-spacing:0.03em; text-transform:uppercase; font-size:11px; color:#a5b4fc; margin-bottom:6px;">
      Sandbox Controls
    </div>
    <div id="sandbox-panel-body" style="display:flex; flex-direction:column; gap:8px;">
      <div id="sandbox-panel-mode-label" style="font-size:12px; color:#e5e7eb;">
        Mode: <span style="color:#fbbf24;">Sandbox Room</span>
      </div>
      <div style="font-size:11px; color:#9ca3af;">
        Press <span style="color:#e5e7eb;">F10</span> to toggle this panel.
      </div>

      <!-- Behavior toggles -->
      <div style="margin-top:4px; padding-top:4px; border-top:1px solid #374151;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9ca3af; margin-bottom:4px;">
          Behavior
        </div>
        <button id="sandbox-ai-toggle-btn" type="button"
          style="padding:4px 8px; border-radius:6px; border:1px solid #4b5563;
                 background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer; width:100%; text-align:left;">
          Enemy AI: On
        </button>
      </div>

      <!-- Basic entity tuning & spawn -->
      <div style="margin-top:6px; padding-top:4px; border-top:1px solid #374151;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9ca3af; margin-bottom:4px;"
          title="Most-used knobs for sandbox entity testing: selection, depth, stats, spawn count, and overrides.">
          Basic / Default
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <!-- Selection: entity id + registry dropdown -->
          <div style="display:flex; flex-direction:column; gap:2px;">
            <div style="display:flex; align-items:center; gap:4px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Base entity id (enemy or animal) from JSON (e.g. goblin, troll, deer, fox, boar).">
                Entity
              </span>
              <input id="sandbox-enemy-id" type="text"
                placeholder="goblin, troll, bandit, deer, fox, boar..."
                title="Type or edit the entity id to test. Must exist in enemies.json or animals.json to auto-populate."
                style="flex:1; padding:3px 6px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px;">
              <span style="font-size:11px; color:#9ca3af; width:48px;"
                title="Quick-pick list of all known enemies and animals.">
                List
              </span>
              <select id="sandbox-entity-select"
                title="Choose an entity (enemy or animal) from the registry."
                style="flex:1; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;">
                <option value="">(custom id)</option>
              </select>
            </div>
            <div id="sandbox-entity-status-line" style="font-size:10px; color:#9ca3af; margin-top:2px;">
              Status: <span id="sandbox-entity-status-text">(no id)</span>
            </div>
          </div>

          <!-- Test depth -->
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:11px; color:#9ca3af;"
              title="Sandbox-only: dungeon depth (floor number) to sample this enemy’s HP/ATK/XP curves from JSON. Real runs use the actual floor; changing this does not move you.">
              Test depth
            </span>
            <input id="sandbox-test-depth" type="number" min="1" max="20" value="3"
              title="Dungeon depth (floor) to test this enemy at in sandbox. Affects only HP/ATK/XP used for these spawns; does not change the real dungeon floor."
              style="width:60px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
          </div>

          <!-- Visual / identity -->
          <div style="display:flex; flex-wrap:wrap; gap:4px;">
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 40px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Single-character glyph drawn for this enemy in dungeon/sandbox view.">
                Glyph
              </span>
              <input id="sandbox-glyph" type="text" maxlength="1"
                title="Glyph character shown on the map for this enemy in dungeon/sandbox."
                style="width:34px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px; text-align:center;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 80px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="CSS color used for this enemy’s glyph (overrides enemies.json in sandbox only).">
                Color
              </span>
              <input id="sandbox-color" type="text"
                placeholder="#8bd5a0"
                title="Hex or CSS color string used to draw the enemy glyph in dungeon/sandbox."
                style="flex:1; min-width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="font-size:11px; color:#9ca3af;"
              title="Faction id used by AI/encounters (e.g. monster, bandit, animal, guard). Sandbox override only.">
              Faction
            </span>
            <select id="sandbox-faction"
              title="Faction for this enemy in sandbox (controls which side it fights for)."
              style="flex:1; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;">
              <option value="">(none)</option>
              <option value="monster">monster</option>
              <option value="bandit">bandit</option>
              <option value="animal">animal</option>
              <option value="guard">guard</option>
              <option value="orc">orc</option>
              <option value="undead">undead</option>
            </select>
          </div>
          <!-- Core combat knobs -->
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:2px;">
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 80px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Hit points this enemy will have at the Test depth (sandbox-only override).">
                HP @ depth
              </span>
              <input id="sandbox-hp" type="number" min="1"
                title="HP for this enemy at the chosen Test depth. Overrides the curve in sandbox."
                style="width:64px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 80px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Attack stat this enemy will have at the Test depth (sandbox-only override).">
                ATK @ depth
              </span>
              <input id="sandbox-atk" type="number" min="0"
                title="Attack value for this enemy at the chosen Test depth in sandbox."
                style="width:64px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="font-size:11px; color:#9ca3af;"
              title="Experience the player gains for killing this enemy at the Test depth (sandbox override).">
              XP @ depth
            </span>
            <input id="sandbox-xp" type="number" min="0"
              title="XP reward used for this enemy at the chosen Test depth in sandbox."
              style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:2px;">
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 90px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Global multiplier on this enemys outgoing damage in sandbox.">
                Damage scale
              </span>
              <input id="sandbox-damage-scale" type="number" step="0.1"
                title="Scale factor applied to this enemys damage output in sandbox (1.0 = base)."
                style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 90px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Chance [01] this enemy carries or drops equipment (when loot tables support it).">
                Equip chance
              </span>
              <input id="sandbox-equip-chance" type="number" step="0.05" min="0" max="1"
                title="Probability that this enemy has equipment in sandbox (0 = never, 1 = always)."
                style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 90px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Sandbox-only: tier used for this enemys equipment drops (1=low, 2=mid, 3=high). Items still respect their own minTier.">
                Loot tier
              </span>
              <input id="sandbox-equip-tier" type="number" min="1" max="3" step="1"
                placeholder="(auto)"
                title="Loot tier override for this enemy in sandbox. Leave blank to use enemies.json/default; set 1, 2, or 3 to force lower/medium/high tier gear."
                style="width:64px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
          </div>

          <!-- Loot tuning -->
          <div style="margin-top:4px; padding-top:4px; border-top:1px solid #374151;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9ca3af; margin-bottom:2px;">
              Loot (sandbox)
            </div>
            <!-- Potions -->
            <div style="display:flex; align-items:center; gap:4px; margin-bottom:2px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Relative weights for potion tiers in this enemys lootPools. All zero = no potions.">
                Potions
              </span>
              <input id="sandbox-loot-pot-lesser" type="number" step="0.05" min="0"
                placeholder="lesser"
                title="Weight for lesser potions in this enemys loot pool."
                style="width:56px; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
              <input id="sandbox-loot-pot-average" type="number" step="0.05" min="0"
                placeholder="average"
                title="Weight for average potions in this enemys loot pool."
                style="width:56px; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
              <input id="sandbox-loot-pot-strong" type="number" step="0.05" min="0"
                placeholder="strong"
                title="Weight for strong potions in this enemys loot pool."
                style="width:56px; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
            </div>

            <!-- Equipment weights -->
            <div style="display:flex; flex-direction:column; gap:6px;">
              <div style="flex:1 1 auto;">
                <div style="font-size:11px; color:#9ca3af; margin-bottom:1px;">Weapons (weights)</div>
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">sword_simple</span>
                    <input id="sandbox-loot-weapon-sword_simple" type="number" step="0.05" min="0"
                      title="Weight for sword_simple in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">axe</span>
                    <input id="sandbox-loot-weapon-axe" type="number" step="0.05" min="0"
                      title="Weight for axe in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">dagger</span>
                    <input id="sandbox-loot-weapon-dagger" type="number" step="0.05" min="0"
                      title="Weight for dagger in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">mace</span>
                    <input id="sandbox-loot-weapon-mace" type="number" step="0.05" min="0"
                      title="Weight for mace in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">club</span>
                    <input id="sandbox-loot-weapon-club" type="number" step="0.05" min="0"
                      title="Weight for club in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">torch_weapon</span>
                    <input id="sandbox-loot-weapon-torch_weapon" type="number" step="0.05" min="0"
                      title="Weight for torch_weapon in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">greatsword</span>
                    <input id="sandbox-loot-weapon-greatsword" type="number" step="0.05" min="0"
                      title="Weight for greatsword in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                </div>
              </div>

              <div style="flex:1 1 auto;">
                <div style="font-size:11px; color:#9ca3af; margin-bottom:1px;">Armor (weights)</div>
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">shield</span>
                    <input id="sandbox-loot-armor-shield" type="number" step="0.05" min="0"
                      title="Weight for shield in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">helmet</span>
                    <input id="sandbox-loot-armor-helmet" type="number" step="0.05" min="0"
                      title="Weight for helmet in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">torso_armor</span>
                    <input id="sandbox-loot-armor-torso_armor" type="number" step="0.05" min="0"
                      title="Weight for torso_armor in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">leg_armor</span>
                    <input id="sandbox-loot-armor-leg_armor" type="number" step="0.05" min="0"
                      title="Weight for leg_armor in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span style="width:72px; font-size:11px; color:#9ca3af;">gloves</span>
                    <input id="sandbox-loot-armor-gloves" type="number" step="0.05" min="0"
                      title="Weight for gloves in this enemys loot pool."
                      style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Spawn + override controls -->
          <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
            <span style="font-size:11px; color:#9ca3af;"
              title="How many copies of this enemy to spawn with each Spawn N click.">
              Count
            </span>
            <input id="sandbox-enemy-count" type="number" min="1" max="50" value="1"
              title="Number of enemies to spawn when using Spawn N (sandbox only)."
              style="width:52px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            <button id="sandbox-spawn1-btn" type="button"
              title="Spawn exactly one enemy using the current sandbox override and Test depth."
              style="flex:1; padding:4px 6px; border-radius:6px; border:1px solid #22c55e;
                     background:#16a34a; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:center;">
              Spawn 1
            </button>
            <button id="sandbox-spawnn-btn" type="button"
              title="Spawn Count enemies using the current sandbox override and Test depth."
              style="flex:1; padding:4px 6px; border-radius:6px; border:1px solid #22c55e;
                     background:#15803d; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:center;">
              Spawn N
            </button>
          </div>

          <div style="display:flex; gap:6px; margin-top:4px;">
            <button id="sandbox-apply-override-btn" type="button"
              title="Save the Basic fields as a sandbox-only override for this enemy (affects future spawns in this session)."
              style="flex:1; padding:3px 6px; border-radius:6px; border:1px solid #4b5563;
                     background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:center;">
              Apply
            </button>
            <button id="sandbox-reset-override-btn" type="button"
              title="Remove the sandbox override for this enemy and fall back to its base JSON definition."
              style="flex:1; padding:3px 6px; border-radius:6px; border:1px solid #4b5563;
                     background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:center;">
              Reset
            </button>
          </div>
          <div style="display:flex; margin-top:4px;">
            <button id="sandbox-copy-json-btn" type="button"
              title="Copy a JSON stub for this enemy using the current sandbox values."
              style="flex:1; padding:3px 6px; border-radius:6px; border:1px solid #4b5563;
                     background:#020617; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:center;">
              Copy JSON
            </button>
          </div>
        </div>
      </div>

      </div>
  `;

  document.body.appendChild(el);
  el.hidden = true;
  return el;
}

export function init(UI) {
  _ui = UI || null;
  loadEnemyTypes();
  const panel = ensurePanel();
  void panel;

  // Populate combined enemies + animals dropdown
  try {
    populateEntitySelect();
  } catch (_) {}

  // If we have entity types and no current selection, preselect the first type.
  try {
    const enemyInput = byId("sandbox-enemy-id");
    if (enemyInput && !_enemyTypes.length) {
      loadEnemyTypes();
    }
    if (enemyInput && _enemyTypes.length && !enemyInput.value) {
      setEnemyId(_enemyTypes[0]);
    }
  } catch (_) {}

  // AI toggle
  const aiBtn = byId("sandbox-ai-toggle-btn");
  if (aiBtn) {
    aiBtn.addEventListener("click", () => {
      try {
        if (!window.GameAPI || typeof window.GameAPI.getCtx !== "function") return;
        const ctx = window.GameAPI.getCtx();
        if (!ctx) return;
        ctx.sandboxFlags = ctx.sandboxFlags || {};
        const on = ctx.sandboxFlags.aiEnabled !== false;
        ctx.sandboxFlags.aiEnabled = !on;
        if (typeof window.GameAPI.log === "function") {
          window.GameAPI.log(
            ctx.sandboxFlags.aiEnabled ? "Sandbox: Enemy AI enabled." : "Sandbox: Enemy AI disabled; enemies will not act.",
            "notice"
          );
        }
        refreshAiToggle();
      } catch (_) {}
    });
  }

  // Enemy id manual input => refresh tuning fields when changed
  const enemyInput = byId("sandbox-enemy-id");
  if (enemyInput) enemyInput.addEventListener("change", () => {
    const id = currentEnemyId();
    if (!id) {
      setEnemyId("");
      updateEntityStatusLabel();
      return;
    }
    setEnemyId(id);
    syncBasicFormFromData();
  });

  const entitySelect = byId("sandbox-entity-select");
  if (entitySelect) {
    entitySelect.addEventListener("change", () => {
      const val = entitySelect.value || "";
      setEnemyId(val);
      syncBasicFormFromData();
    });
  }

  // Initialize status label once ids/types are wired.
  updateEntityStatusLabel();

  // Primary button visuals (Apply / Reset / Copy JSON)
  const applyBtn = byId("sandbox-apply-override-btn");
  const resetBtn = byId("sandbox-reset-override-btn");
  const copyJsonBtn = byId("sandbox-copy-json-btn");

  function wirePrimarySandboxButton(btn) {
    if (!btn) return;
    // Base visual style
    try {
      btn.style.transition = "background 120ms ease, transform 80ms ease, box-shadow 120ms ease, border-color 120ms ease";
      btn.style.boxShadow = "0 1px 4px rgba(15,23,42,0.75)";
    } catch (_) {}
    // Hover
    btn.addEventListener("mouseenter", () => {
      try {
        btn.style.background = "#1e293b";
        btn.style.borderColor = "#6b7280";
      } catch (_) {}
    });
    btn.addEventListener("mouseleave", () => {
      try {
        btn.style.background = "#111827";
        btn.style.borderColor = "#4b5563";
        btn.style.transform = "translateY(0px)";
        btn.style.boxShadow = "0 1px 4px rgba(15,23,42,0.75)";
      } catch (_) {}
    });
    // Active (click)
    btn.addEventListener("mousedown", () => {
      try {
        btn.style.transform = "translateY(1px)";
        btn.style.boxShadow = "0 0 0 rgba(0,0,0,0.5)";
      } catch (_) {}
    });
    btn.addEventListener("mouseup", () => {
      try {
        btn.style.transform = "translateY(0px)";
        btn.style.boxShadow = "0 1px 4px rgba(15,23,42,0.75)";
      } catch (_) {}
    });
  }

  wirePrimarySandboxButton(applyBtn);
  wirePrimarySandboxButton(resetBtn);
  wirePrimarySandboxButton(copyJsonBtn);

  // Apply override
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      try {
        const enemyId = currentEnemyId();
        if (!enemyId) return;
        const ctx = getCtxSafe();
        if (!ctx) return;

        const glyphInput = byId("sandbox-glyph");
        const colorInput = byId("sandbox-color");
        const factionInput = byId("sandbox-faction");
        const hpInput = byId("sandbox-hp");
        const atkInput = byId("sandbox-atk");
        const xpInput = byId("sandbox-xp");
        const dmgInput = byId("sandbox-damage-scale");
        const eqInput = byId("sandbox-equip-chance");
        const depthInput2 = byId("sandbox-test-depth");

        const depth = depthInput2 ? ((Number(depthInput2.value) || 0) | 0) || 3 : 3;

        const overridesRoot = ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object"
          ? ctx.sandboxEnemyOverrides
          : (ctx.sandboxEnemyOverrides = Object.create(null));

        const idKey = String(enemyId);
        const idLower = idKey.toLowerCase();
        const prev = overridesRoot[idKey] || overridesRoot[idLower] || {};
        const next = Object.assign({}, prev, {
          testDepth: depth,
        });

        if (glyphInput) next.glyph = String(glyphInput.value || "");
        if (colorInput) next.color = String(colorInput.value || "");
        if (factionInput) next.faction = String(factionInput.value || "");
        if (hpInput && hpInput.value !== "") next.hpAtDepth = Number(hpInput.value) || 1;
        if (atkInput && atkInput.value !== "") next.atkAtDepth = Number(atkInput.value) || 0;
        if (xpInput && xpInput.value !== "") next.xpAtDepth = Number(xpInput.value) || 0;
        if (dmgInput && dmgInput.value !== "") next.damageScale = Number(dmgInput.value) || 1;
        if (eqInput && eqInput.value !== "") next.equipChance = Number(eqInput.value) || 0;
        const tierInput = byId("sandbox-equip-tier");
        if (tierInput && tierInput.value !== "") {
          const tRaw = (Number(tierInput.value) || 0) | 0;
          if (tRaw >= 1 && tRaw <= 3) next.equipTierOverride = tRaw;
        }

        // Loot overrides from the sandbox loot editor.
        const potL = byId("sandbox-loot-pot-lesser");
        const potA = byId("sandbox-loot-pot-average");
        const potS = byId("sandbox-loot-pot-strong");

        const potLVal = potL && potL.value !== "" ? (Number(potL.value) || 0) : 0;
        const potAVal = potA && potA.value !== "" ? (Number(potA.value) || 0) : 0;
        const potSVal = potS && potS.value !== "" ? (Number(potS.value) || 0) : 0;

        const lootOverride = {};
        let hasLootOverride = false;

        if (potLVal > 0 || potAVal > 0 || potSVal > 0) {
          const potions = {};
          if (potLVal > 0) potions.lesser = potLVal;
          if (potAVal > 0) potions.average = potAVal;
          if (potSVal > 0) potions.strong = potSVal;
          if (Object.keys(potions).length > 0) {
            lootOverride.potions = potions;
            hasLootOverride = true;
          }
        }

        const weapons = {};
        let hasWeapons = false;
        for (let i = 0; i < LOOT_WEAPON_KEYS.length; i++) {
          const key = LOOT_WEAPON_KEYS[i];
          const input = byId("sandbox-loot-weapon-" + key);
          if (!input || input.value === "") continue;
          const w = Number(input.value) || 0;
          if (w > 0) {
            weapons[key] = w;
            hasWeapons = true;
          }
        }
        if (hasWeapons) {
          lootOverride.weapons = weapons;
          hasLootOverride = true;
        }

        const armor = {};
        let hasArmor = false;
        for (let i = 0; i < LOOT_ARMOR_KEYS.length; i++) {
          const key = LOOT_ARMOR_KEYS[i];
          const input = byId("sandbox-loot-armor-" + key);
          if (!input || input.value === "") continue;
          const w = Number(input.value) || 0;
          if (w > 0) {
            armor[key] = w;
            hasArmor = true;
          }
        }
        if (hasArmor) {
          lootOverride.armor = armor;
          hasLootOverride = true;
        }

        if (hasLootOverride) {
          next.lootPools = lootOverride;
        } else if (Object.prototype.hasOwnProperty.call(next, "lootPools")) {
          delete next.lootPools;
        }

        // Store override under both exact id and lower-case alias so loot
        // helpers (which often lower-case type ids) can still resolve
        // sandbox-only overrides reliably.
        overridesRoot[idKey] = next;
        if (idLower !== idKey) overridesRoot[idLower] = next;

        if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
          window.GameAPI.log(`Sandbox: Applied enemy override for '${enemyId}' (depth ${depth}).`, "notice");
        }
      } catch (_) {}
    });
  }

  // Reset override
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      try {
        const enemyId = currentEnemyId();
        if (!enemyId) return;
        const ctx = getCtxSafe();
        if (!ctx || !ctx.sandboxEnemyOverrides) {
          syncBasicFormFromData();
          return;
        }
        const idKey = String(enemyId);
        const idLower = idKey.toLowerCase();
        delete ctx.sandboxEnemyOverrides[idKey];
        if (idLower !== idKey) delete ctx.sandboxEnemyOverrides[idLower];
        if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
          window.GameAPI.log(`Sandbox: Reset overrides for '${enemyId}' to base definition.`, "notice");
        }
        syncBasicFormFromData();
      } catch (_) {}
    });
  }

  // Copy JSON stub to clipboard
  if (copyJsonBtn) {
    copyJsonBtn.addEventListener("click", () => {
      copyEnemyJsonStubToClipboard();
    });
  }

  // Spawn buttons
  const spawn1Btn = byId("sandbox-spawn1-btn");
  if (spawn1Btn) {
    spawn1Btn.addEventListener("click", () => {
      spawnWithCount(1);
    });
  }
  const spawnNBtn = byId("sandbox-spawnn-btn");
  if (spawnNBtn) {
    spawnNBtn.addEventListener("click", () => {
      spawnWithCount(null);
    });
  }

  // Initialize button labels and basic form
  refreshAiToggle();
  syncBasicFormFromData();
}

export function show() {
  const el = ensurePanel();
  el.hidden = false;
  // Ensure entity types and default selection are available when the panel opens
  try {
    loadEnemyTypes();
    populateEntitySelect();
    const enemyInput = byId("sandbox-enemy-id");
    if (enemyInput && _enemyTypes.length && !enemyInput.value) {
      setEnemyId(_enemyTypes[0]);
    }
  } catch (_) {}
  // Refresh state when panel becomes visible
  refreshAiToggle();
  syncBasicFormFromData();
}

export function hide() {
  const el = byId("sandbox-panel");
  if (el) el.hidden = true;
}

export function isOpen() {
  const el = byId("sandbox-panel");
  return !!(el && !el.hidden);
}

// Allow ESC to close the sandbox panel when it is open.
(function installEscapeHandler() {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    document.addEventListener("keydown", (ev) => {
      try {
        if (ev.key === "Escape" || ev.key === "Esc") {
          const el = byId("sandbox-panel");
          if (el && !el.hidden) {
            el.hidden = true;
            ev.stopPropagation();
          }
        }
      } catch (_) {}
    });
  } catch (_) {}
})();

import { getMod } from "/utils/access.js";
import { attachGlobal } from "/utils/global.js";
attachGlobal("SandboxPanel", { init, show, hide, isOpen });