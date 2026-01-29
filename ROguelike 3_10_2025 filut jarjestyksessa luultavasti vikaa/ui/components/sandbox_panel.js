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

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

let _ui = null;
// Cached enemy ids for cycling via prev/next buttons
let _enemyTypes = [];
let _enemyIndex = 0;

function loadEnemyTypes() {
  try {
    const EM = (typeof window !== "undefined" ? window.Enemies : null);
    if (EM && typeof EM.listTypes === "function") {
      const list = EM.listTypes() || [];
      _enemyTypes = Array.isArray(list) ? list.slice(0) : [];
      _enemyTypes.sort();
    }
  } catch (_) {
    _enemyTypes = [];
  }
}

function currentEnemyId() {
  const input = byId("sandbox-enemy-id");
  if (!input) return "";
  return String(input.value || "").trim();
}

function setEnemyId(id) {
  const input = byId("sandbox-enemy-id");
  if (!input) return;
  input.value = id || "";
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
 */
function syncBasicFormFromData() {
  try {
    const enemyId = currentEnemyId();
    if (!enemyId) return;
    const ctx = getCtxSafe();
    if (!ctx) return;

    const EM = (typeof window !== "undefined" ? window.Enemies : null);
    const def = EM && typeof EM.getDefById === "function" ? EM.getDefById(enemyId) : null;
    if (!def) return;

    const overridesRoot = ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object"
      ? ctx.sandboxEnemyOverrides
      : null;
    const override = overridesRoot ? overridesRoot[enemyId] || null : null;

    const depthInput = byId("sandbox-test-depth");
    let depth = 3;
    if (depthInput && depthInput.value) {
      const v = (Number(depthInput.value) || 0) | 0;
      if (v > 0) depth = v;
    } else if (override && typeof override.testDepth === "number") {
      depth = (override.testDepth | 0) || 3;
    }
    if (depthInput) depthInput.value = String(depth);

    const hpBase = typeof def.hp === "function" ? def.hp(depth) : 0;
    const atkBase = typeof def.atk === "function" ? def.atk(depth) : 0;
    const xpBase = typeof def.xp === "function" ? def.xp(depth) : 0;

    const glyphInput = byId("sandbox-glyph");
    const colorInput = byId("sandbox-color");
    const factionInput = byId("sandbox-faction");
    const hpInput = byId("sandbox-hp");
    const atkInput = byId("sandbox-atk");
    const xpInput = byId("sandbox-xp");
    const dmgInput = byId("sandbox-damage-scale");
    const eqInput = byId("sandbox-equip-chance");

    if (glyphInput) {
      glyphInput.value = (override && typeof override.glyph === "string")
        ? override.glyph
        : (def.glyph || "");
    }
    if (colorInput) {
      colorInput.value = (override && typeof override.color === "string")
        ? override.color
        : (def.color || "");
    }
    if (factionInput) {
      factionInput.value = (override && typeof override.faction === "string")
        ? override.faction
        : (def.faction || "");
    }
    if (hpInput) {
      hpInput.value = (override && typeof override.hpAtDepth === "number")
        ? String(override.hpAtDepth)
        : (hpBase ? String(hpBase) : "");
    }
    if (atkInput) {
      atkInput.value = (override && typeof override.atkAtDepth === "number")
        ? String(override.atkAtDepth)
        : (atkBase ? String(atkBase) : "");
    }
    if (xpInput) {
      xpInput.value = (override && typeof override.xpAtDepth === "number")
        ? String(override.xpAtDepth)
        : (xpBase ? String(xpBase) : "");
    }

    const baseDamageScale = (typeof def.damageScale === "number" ? def.damageScale : 1.0);
    const baseEquipChance = (typeof def.equipChance === "number" ? def.equipChance : 0.35);

    if (dmgInput) {
      const val = (override && typeof override.damageScale === "number") ? override.damageScale : baseDamageScale;
      dmgInput.value = String(val);
    }
    if (eqInput) {
      const val = (override && typeof override.equipChance === "number") ? override.equipChance : baseEquipChance;
      eqInput.value = String(val);
    }
  } catch (_) {}
}

/**
 * Populate Advanced JSON view (base + override) for the current enemy.
 */
function refreshAdvancedJson() {
  try {
    const enemyId = currentEnemyId();
    if (!enemyId) return;
    const baseArea = byId("sandbox-advanced-base-json");
    const overrideArea = byId("sandbox-advanced-override-json");
    if (!baseArea || !overrideArea) return;

    // Base JSON from GameData.enemies
    let baseRow = null;
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const list = GD && Array.isArray(GD.enemies) ? GD.enemies : null;
      if (list) {
        baseRow = list.find(e => e && String(e.id || "").toLowerCase() === String(enemyId).toLowerCase()) || null;
      }
    } catch (_) {
      baseRow = null;
    }
    baseArea.value = baseRow ? JSON.stringify(baseRow, null, 2) : "";

    // Override JSON from ctx.sandboxEnemyOverrides
    const ctx = getCtxSafe();
    let override = null;
    if (ctx && ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object") {
      override = ctx.sandboxEnemyOverrides[enemyId] || null;
    }
    overrideArea.value = override ? JSON.stringify(override, null, 2) : "";
  } catch (_) {}
}

/**
 * Spawn helper shared by Spawn 1 / Spawn N.
 */
function spawnWithCount(requestedCount) {
  try {
    if (!window.GameAPI) return;
    const enemyId = currentEnemyId();
    if (!enemyId) {
      if (typeof window.GameAPI.log === "function") {
        window.GameAPI.log("Sandbox: Enemy id is empty; cannot spawn.", "warn");
      }
      return;
    }

    let n = requestedCount;
    if (n == null) {
      const cntInput = byId("sandbox-enemy-count");
      if (cntInput) {
        n = (Number(cntInput.value) || 1) | 0;
      } else {
        n = 1;
      }
    }
    if (n < 1) n = 1;
    if (n > 50) n = 50;

    let spawned = false;

    // Preferred path: call God.spawnEnemyById directly with live ctx when available.
    try {
      if (typeof window.GameAPI.getCtx === "function" &&
          typeof window.God === "object" &&
          typeof window.God.spawnEnemyById === "function") {
        const ctx = window.GameAPI.getCtx();
        if (ctx && (ctx.mode === "sandbox" || ctx.mode === "dungeon")) {
          spawned = !!window.God.spawnEnemyById(ctx, enemyId, n);
        }
      }
    } catch (_) {
      spawned = false;
    }

    // Fallback to GameAPI helper if direct GOD call was unavailable or failed.
    if (!spawned && typeof window.GameAPI.spawnEnemyById === "function") {
      spawned = !!window.GameAPI.spawnEnemyById(enemyId, n);
    }

    // Final fallback: random nearby spawn if by-id helpers are missing.
    if (!spawned && typeof window.GameAPI.spawnEnemyNearby === "function") {
      spawned = !!window.GameAPI.spawnEnemyNearby(n);
      if (typeof window.GameAPI.log === "function") {
        window.GameAPI.log("Sandbox: spawnEnemyById not available; used random spawnEnemyNearby instead.", "warn");
      }
    }

    if (!spawned && typeof window.GameAPI.log === "function") {
      window.GameAPI.log(`Sandbox: Failed to spawn enemy '${enemyId}'.`, "warn");
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
  el.style.right = "16px";
  el.style.zIndex = "31000";
  el.style.padding = "10px 12px";
  el.style.borderRadius = "8px";
  el.style.border = "1px solid #1f2937";
  el.style.background = "rgba(15,23,42,0.95)";
  el.style.boxShadow = "0 20px 40px rgba(0,0,0,0.7)";
  el.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  el.style.fontSize = "13px";
  el.style.color = "#e5e7eb";
  el.style.minWidth = "260px";
  el.style.maxWidth = "320px";

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

      <!-- Basic enemy tuning & spawn -->
      <div style="margin-top:6px; padding-top:4px; border-top:1px solid #374151;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9ca3af; margin-bottom:4px;"
          title="Most-used knobs for sandbox enemy testing: selection, depth, stats, spawn count, and overrides.">
          Basic / Default
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <!-- Selection -->
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="font-size:11px; color:#9ca3af;"
              title="Base enemy id from data/entities/enemies.json (e.g. goblin, troll, bandit).">
              Enemy
            </span>
            <input id="sandbox-enemy-id" type="text"
              placeholder="goblin, troll, bandit..."
              title="Type or edit the enemy id to test. Must exist in data/entities/enemies.json."
              style="flex:1; padding:3px 6px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            <button id="sandbox-enemy-prev-btn" type="button"
              title="Select previous enemy id from the registry."
              style="padding:2px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:10px; cursor:pointer;">◀</button>
            <button id="sandbox-enemy-next-btn" type="button"
              title="Select next enemy id from the registry."
              style="padding:2px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:10px; cursor:pointer;">▶</button>
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
              title="Faction id used by AI/encounters (e.g. monster, bandit, guard). Sandbox override only.">
              Faction
            </span>
            <input id="sandbox-faction" type="text"
              placeholder="monster, bandit..."
              title="Faction string for this enemy in sandbox (controls which side it fights for)."
              style="flex:1; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
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
                title="Global multiplier on this enemy’s outgoing damage in sandbox.">
                Damage scale
              </span>
              <input id="sandbox-damage-scale" type="number" step="0.1"
                title="Scale factor applied to this enemy’s damage output in sandbox (1.0 = base)."
                style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            </div>
            <div style="display:flex; align-items:center; gap:4px; flex:1 1 90px;">
              <span style="font-size:11px; color:#9ca3af;"
                title="Chance [0–1] this enemy carries or drops equipment (when loot tables support it).">
                Equip chance
              </span>
              <input id="sandbox-equip-chance" type="number" step="0.05" min="0" max="1"
                title="Probability that this enemy has equipment in sandbox (0 = never, 1 = always)."
                style="width:72px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
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
              Apply as Override
            </button>
            <button id="sandbox-reset-override-btn" type="button"
              title="Remove the sandbox override for this enemy and fall back to its base JSON definition."
              style="flex:1; padding:3px 6px; border-radius:6px; border:1px solid #4b5563;
                     background:#020617; color:#9ca3af; font-size:12px; cursor:pointer; text-align:center;">
              Reset to Base
            </button>
          </div>
        </div>
      </div>

      <!-- Advanced JSON overrides -->
      <div style="margin-top:6px; padding-top:4px; border-top:1px solid #374151;">
        <button id="sandbox-advanced-toggle-btn" type="button"
          title="Show expert JSON view/edit for this enemy’s sandbox override (advanced use only)."
          style="width:100%; padding:4px 8px; border-radius:6px; border:1px solid #4b5563;
                 background:#020617; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:left;">
          Advanced ▸
        </button>
        <div id="sandbox-advanced-body" style="display:none; margin-top:4px; display:flex; flex-direction:column; gap:4px;">
          <div style="font-size:11px; color:#9ca3af;"
            title="Read-only copy of this enemy’s definition from data/entities/enemies.json.">
            Base JSON (read-only)
          </div>
          <textarea id="sandbox-advanced-base-json" readonly
            title="Enemy row as loaded from data/entities/enemies.json (cannot be edited here)."
            style="width:100%; min-height:80px; max-height:120px; padding:4px 6px; border-radius:4px;
                   border:1px solid #4b5563; background:#020617; color:#9ca3af; font-size:11px; font-family:'JetBrains Mono',monospace;"></textarea>
          <div style="font-size:11px; color:#9ca3af;"
            title="Sandbox-only override object that is merged on top of the base definition.">
            Override JSON (sandbox-only)
          </div>
          <textarea id="sandbox-advanced-override-json"
            title="Edit sandbox override as raw JSON for this enemy, then click Apply JSON to use it."
            style="width:100%; min-height:80px; max-height:140px; padding:4px 6px; border-radius:4px;
                   border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:11px; font-family:'JetBrains Mono',monospace;"></textarea>
          <div style="display:flex; gap:6px; margin-top:2px;">
            <button id="sandbox-advanced-apply-json-btn" type="button"
              title="Parse Override JSON and store it as the sandbox override for this enemy."
              style="flex:1; padding:3px 6px; border-radius:6px; border:1px solid #4b5563;
                     background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:center;">
              Apply JSON
            </button>
            <button id="sandbox-advanced-reset-json-btn" type="button"
              title="Clear JSON override for this enemy (equivalent to Reset to Base in Basic section)."
              style="flex:1; padding:3px 6px; border-radius:6px; border:1px solid #4b5563;
                     background:#020617; color:#9ca3af; font-size:12px; cursor:pointer; text-align:center;">
              Reset Override
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
  void panel; // silence lints

  // If we have enemy types and no current selection, preselect the first type.
  try {
    const enemyInput = byId("sandbox-enemy-id");
    if (enemyInput && !_enemyTypes.length) {
      loadEnemyTypes();
    }
    if (enemyInput && _enemyTypes.length && !enemyInput.value) {
      _enemyIndex = 0;
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

  // Enemy cycling
  const prevBtn = byId("sandbox-enemy-prev-btn");
  const nextBtn = byId("sandbox-enemy-next-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (!_enemyTypes.length) {
        loadEnemyTypes();
      }
      if (!_enemyTypes.length) return;
      _enemyIndex = (_enemyTypes.length + _enemyIndex - 1) % _enemyTypes.length;
      setEnemyId(_enemyTypes[_enemyIndex]);
      syncBasicFormFromData();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (!_enemyTypes.length) {
        loadEnemyTypes();
      }
      if (!_enemyTypes.length) return;
      _enemyIndex = (_enemyTypes.length + _enemyIndex + 1) % _enemyTypes.length;
      setEnemyId(_enemyTypes[_enemyIndex]);
      syncBasicFormFromData();
    });
  }

  // Enemy id manual input => refresh tuning fields when changed
  const enemyInput = byId("sandbox-enemy-id");
  if (enemyInput) {
    enemyInput.addEventListener("change", () => {
      syncBasicFormFromData();
    });
  }

  // Test depth change -> recompute suggested HP/ATK/XP
  const depthInput = byId("sandbox-test-depth");
  if (depthInput) {
    depthInput.addEventListener("change", () => {
      syncBasicFormFromData();
    });
  }

  // Apply as Override
  const applyBtn = byId("sandbox-apply-override-btn");
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

        const prev = overridesRoot[enemyId] || {};
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

        overridesRoot[enemyId] = next;

        if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
          window.GameAPI.log(`Sandbox: Applied enemy override for '${enemyId}' (depth ${depth}).`, "notice");
        }
        // Refresh Advanced JSON view so the override is immediately visible when expanded.
        try { refreshAdvancedJson(); } catch (_) {}
      } catch (_) {}
    });
  }

  // Reset override
  const resetBtn = byId("sandbox-reset-override-btn");
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
        delete ctx.sandboxEnemyOverrides[enemyId];
        if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
          window.GameAPI.log(`Sandbox: Reset overrides for '${enemyId}' to base definition.`, "notice");
        }
        syncBasicFormFromData();
        refreshAdvancedJson();
      } catch (_) {}
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

  // Advanced toggle / JSON apply+reset
  const advToggle = byId("sandbox-advanced-toggle-btn");
  const advBody = byId("sandbox-advanced-body");
  if (advToggle && advBody) {
    advToggle.addEventListener("click", () => {
      try {
        const visible = advBody.style.display !== "none";
        advBody.style.display = visible ? "none" : "flex";
        advToggle.textContent = visible ? "Advanced ▸" : "Advanced ▾";
        if (!visible) {
          refreshAdvancedJson();
        }
      } catch (_) {}
    });
    // Start hidden
    advBody.style.display = "none";
  }

  const advApplyBtn = byId("sandbox-advanced-apply-json-btn");
  if (advApplyBtn) {
    advApplyBtn.addEventListener("click", () => {
      try {
        const enemyId = currentEnemyId();
        if (!enemyId) return;
        const ctx = getCtxSafe();
        if (!ctx) return;
        const area = byId("sandbox-advanced-override-json");
        if (!area) return;
        const text = String(area.value || "").trim();
        const overridesRoot = ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object"
          ? ctx.sandboxEnemyOverrides
          : (ctx.sandboxEnemyOverrides = Object.create(null));

        if (!text) {
          delete overridesRoot[enemyId];
          if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
            window.GameAPI.log(`Sandbox: Cleared JSON override for '${enemyId}'.`, "notice");
          }
          syncBasicFormFromData();
          refreshAdvancedJson();
          return;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
            window.GameAPI.log(`Sandbox: Failed to parse override JSON for '${enemyId}': ${e && e.message ? e.message : e}`, "warn");
          }
          return;
        }
        if (!parsed || typeof parsed !== "object") {
          if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
            window.GameAPI.log(`Sandbox: Override JSON for '${enemyId}' must be an object.`, "warn");
          }
          return;
        }

        overridesRoot[enemyId] = parsed;
        if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
          window.GameAPI.log(`Sandbox: Applied JSON override for '${enemyId}'.`, "notice");
        }
        syncBasicFormFromData();
        refreshAdvancedJson();
      } catch (_) {}
    });
  }

  const advResetBtn = byId("sandbox-advanced-reset-json-btn");
  if (advResetBtn) {
    advResetBtn.addEventListener("click", () => {
      try {
        const enemyId = currentEnemyId();
        if (!enemyId) return;
        const ctx = getCtxSafe();
        if (!ctx || !ctx.sandboxEnemyOverrides) {
          refreshAdvancedJson();
          syncBasicFormFromData();
          return;
        }
        delete ctx.sandboxEnemyOverrides[enemyId];
        const area = byId("sandbox-advanced-override-json");
        if (area) area.value = "";
        if (typeof window.GameAPI === "object" && typeof window.GameAPI.log === "function") {
          window.GameAPI.log(`Sandbox: Reset JSON override for '${enemyId}'.`, "notice");
        }
        syncBasicFormFromData();
        refreshAdvancedJson();
      } catch (_) {}
    });
  }

  // Initialize button labels and basic form
  refreshAiToggle();
  syncBasicFormFromData();
}

export function show() {
  const el = ensurePanel();
  el.hidden = false;
  // Ensure enemy types and default selection are available when the panel opens
  try {
    loadEnemyTypes();
    const enemyInput = byId("sandbox-enemy-id");
    if (enemyInput && _enemyTypes.length && !enemyInput.value) {
      _enemyIndex = 0;
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

import { attachGlobal } from "/utils/global.js";
attachGlobal("SandboxPanel", { init, show, hide, isOpen });