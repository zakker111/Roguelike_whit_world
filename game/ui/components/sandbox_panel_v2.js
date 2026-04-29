/**
 * SandboxPanel v2: overlay for sandbox mode enemy testing (F10).
 *
 * This is a cleaned, modular version of the original sandbox_panel.js.
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
 */

import { currentEnemyId, spawnWithCount } from "/ui/components/sandbox_spawn.js";
import { copyEnemyJsonStubToClipboard } from "/ui/components/sandbox_export.js";
import {
  LOOT_WEAPON_KEYS,
  LOOT_ARMOR_KEYS,
  loadEnemyTypes,
  populateEntitySelect,
  getEnemyTypes,
  setEnemyId,
  updateEntityStatusLabel,
  syncBasicFormFromData,
  getCtxSafe,
} from "/ui/components/sandbox_model.js";

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

let _ui = null;

/**
 * Update the Enemy AI toggle button label from current ctx.sandboxFlags.
 */
function refreshAiToggle() {
  try {
    const btn = byId("sandbox-ai-toggle-btn");
    const ctx = getCtxSafe();
    if (!btn || !ctx) return;
    const flags = ctx.sandboxFlags || {};
    const on = flags.aiEnabled !== false;
    btn.textContent = on ? "Enemy AI: On" : "Enemy AI: Off";
  } catch (_) {}
}

function ensurePanel() {
  let el = byId("sandbox-panel");
  if (el) return el;

  el = document.createElement("div");
  el.id = "sandbox-panel";
  el.style.position = "fixed";
  el.style.top = "16px";
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
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9ca3af; margin-bottom:4px;">
          Basic / Default
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <!-- Selection: entity id + registry dropdown -->
          <div style="display:flex; flex-direction:column; gap:2px;">
            <div style="display:flex; align-items:center; gap:4px;">
              <span style="font-size:11px; color:#9ca3af;">
                Entity
              </span>
              <input id="sandbox-enemy-id" type="text"
                placeholder="goblin, troll, bandit, deer, fox, boar..."
                title="Base entity id to test (enemy or animal)."
                style="flex:1; padding:3px 6px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px;">
              <span style="font-size:11px; color:#9ca3af; width:48px;">
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
            <span style="font-size:11px; color:#9ca3af;">
              Test depth
            </span>
            <input id="sandbox-test-depth" type="number" min="1" max="20" value="3"
              title="Dungeon depth (floor) to sample HP/ATK/XP curves at."
              style="width:60px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
          </div>

          <!-- Visual / identity -->
          <div style="display:flex; flex-wrap:wrap; gap:4px;">
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 40px;">
              <span style="font-size:11px; color:#9ca3af;">Glyph</span>
              <input id="sandbox-glyph" type="text" maxlength="1"
                style="width:34px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px; text-align:center;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 80px;">
              <span style="font-size:11px; color:#9ca3af;">Color</span>
              <input id="sandbox-color" type="text" placeholder="#8bd5a0"
                style="flex:1; min-width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:4px;">
            <span style="font-size:11px; color:#9ca3af;">Faction</span>
            <select id="sandbox-faction"
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
              <span style="font-size:11px; color:#9ca3af;">HP @ depth</span>
              <input id="sandbox-hp" type="number" min="1"
                style="width:64px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 80px;">
              <span style="font-size:11px; color:#9ca3af;">ATK @ depth</span>
              <input id="sandbox-atk" type="number" min="0"
                style="width:64px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:4px;">
            <span style="font-size:11px; color:#9ca3af;">XP @ depth</span>
            <input id="sandbox-xp" type="number" min="0"
              style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:2px;">
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 90px;">
              <span style="font-size:11px; color:#9ca3af;">Damage scale</span>
              <input id="sandbox-damage-scale" type="number" step="0.1"
                style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 90px;">
              <span style="font-size:11px; color:#9ca3af;">Equip chance</span>
              <input id="sandbox-equip-chance" type="number" step="0.05" min="0" max="1"
                style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 90px;">
              <span style="font-size:11px; color:#9ca3af;">Loot tier</span>
              <input id="sandbox-equip-tier" type="number" min="1" max="3" step="1"
                placeholder="(auto)"
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
              <span style="font-size:11px; color:#9ca3af;">Potions</span>
              <input id="sandbox-loot-pot-lesser" type="number" step="0.05" min="0" placeholder="lesser"
                style="width:56px; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
              <input id="sandbox-loot-pot-average" type="number" step="0.05" min="0" placeholder="average"
                style="width:56px; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
              <input id="sandbox-loot-pot-strong" type="number" step="0.05" min="0" placeholder="strong"
                style="width:56px; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
            </div>

            <!-- Weapons -->
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
              <div style="font-size:11px; color:#9ca3af;">Weapons (weights)</div>
              ${LOOT_WEAPON_KEYS.map(key => `
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="width:90px; font-size:11px; color:#9ca3af;">${key}</span>
                <input id="sandbox-loot-weapon-${key}" type="number" step="0.05" min="0"
                  style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
              </div>
              `).join("")}
            </div>

            <!-- Armor -->
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:4px;">
              <div style="font-size:11px; color:#9ca3af;">Armor (weights)</div>
              ${LOOT_ARMOR_KEYS.map(key => `
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="width:90px; font-size:11px; color:#9ca3af;">${key}</span>
                <input id="sandbox-loot-armor-${key}" type="number" step="0.05" min="0"
                  style="flex:1; padding:2px 3px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px;" />
              </div>
              `).join("")}
            </div>
          </div>

          <!-- Primary actions -->
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;">
            <button id="sandbox-apply-override-btn" type="button"
              style="flex:1 1 80px; padding:4px 8px; border-radius:6px; border:1px solid #4b5563; background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer;">
              Apply overrides
            </button>
            <button id="sandbox-reset-override-btn" type="button"
              style="flex:0 0 auto; padding:4px 8px; border-radius:6px; border:1px solid #4b5563; background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer;">
              Reset
            </button>
            <button id="sandbox-copy-json-btn" type="button"
              style="flex:0 0 auto; padding:4px 8px; border-radius:6px; border:1px solid #4b5563; background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer;">
              Copy JSON
            </button>
          </div>

          <!-- Spawn controls -->
          <div style="display:flex; align-items:center; gap:4px; margin-top:4px;">
            <span style="font-size:11px; color:#9ca3af;">Spawn count</span>
            <input id="sandbox-enemy-count" type="number" min="1" max="50" value="1"
              style="width:64px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            <button id="sandbox-spawn1-btn" type="button"
              style="flex:0 0 auto; padding:3px 8px; border-radius:6px; border:1px solid #4b5563; background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer;">
              Spawn 1
            </button>
            <button id="sandbox-spawnn-btn" type="button"
              style="flex:0 0 auto; padding:3px 8px; border-radius:6px; border:1px solid #4b5563; background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer;">
              Spawn N
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(el);
  return el;
}

/**
 * Wire up DOM events and initial state.
 */
export function init(UI) {
  _ui = UI || null;

  const el = ensurePanel();
  el.hidden = true;

  // AI toggle
  const aiBtn = byId("sandbox-ai-toggle-btn");
  if (aiBtn) {
    aiBtn.addEventListener("click", () => {
      try {
        const ctx = getCtxSafe();
        if (!ctx) return;
        if (!ctx.sandboxFlags || typeof ctx.sandboxFlags !== "object") {
          ctx.sandboxFlags = {};
        }
        const flags = ctx.sandboxFlags;
        const cur = flags.aiEnabled !== false;
        flags.aiEnabled = !cur;
        refreshAiToggle();
      } catch (_) {}
    });
  }

  // Load entity types + dropdown
  try {
    loadEnemyTypes();
    populateEntitySelect();
  } catch (_) {}

  const enemyInput = byId("sandbox-enemy-id");
  if (enemyInput) {
    enemyInput.addEventListener("change", () => {
      const id = String(enemyInput.value || "").trim();
      if (!id) {
        updateEntityStatusLabel();
        return;
      }
      setEnemyId(id);
      syncBasicFormFromData();
    });
  }

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

  const applyBtn = byId("sandbox-apply-override-btn");
  const resetBtn = byId("sandbox-reset-override-btn");
  const copyJsonBtn = byId("sandbox-copy-json-btn");

  function wirePrimarySandboxButton(btn) {
    if (!btn) return;
    try {
      btn.style.transition = "background 120ms ease, transform 80ms ease, box-shadow 120ms ease, border-color 120ms ease";
      btn.style.boxShadow = "0 1px 4px rgba(15,23,42,0.75)";
    } catch (_) {}
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

        // Store override under both exact id and lower-case alias.
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
  try {
    loadEnemyTypes();
    populateEntitySelect();
    const enemyInput = byId("sandbox-enemy-id");
    const types = getEnemyTypes();
    if (enemyInput && types && types.length && !enemyInput.value) {
      setEnemyId(types[0]);
    }
  } catch (_) {}
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

import { attachGlobal } from "/utils/global.js";
attachGlobal("SandboxPanel", { init, show, hide, isOpen });
