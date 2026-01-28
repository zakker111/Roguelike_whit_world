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

      <!-- Basic spawn -->
      <div style="margin-top:6px; padding-top:4px; border-top:1px solid #374151;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9ca3af; margin-bottom:4px;">
          Basic Spawn
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="font-size:11px; color:#9ca3af;">Enemy</span>
            <input id="sandbox-enemy-id" type="text"
              placeholder="goblin, troll, bandit..."
              style="flex:1; padding:3px 6px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            <button id="sandbox-enemy-prev-btn" type="button"
              style="padding:2px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:10px; cursor:pointer;">◀</button>
            <button id="sandbox-enemy-next-btn" type="button"
              style="padding:2px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:10px; cursor:pointer;">▶</button>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:11px; color:#9ca3af;">Count</span>
            <input id="sandbox-enemy-count" type="number" min="1" max="50" value="1"
              style="width:52px; padding:3px 4px; border-radius:4px; border:1px solid #4b5563; background:#020617; color:#e5e7eb; font-size:12px;" />
            <button id="sandbox-spawn-btn" type="button"
              style="flex:1; padding:4px 8px; border-radius:6px; border:1px solid #22c55e;
                     background:#16a34a; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:center;">
              Spawn
            </button>
          </div>
        </div>
      </div>

      <!-- Advanced overrides (loot pools) removed: feature currently disabled -->

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
    });
  }

  // Enemy id manual input: no extra behavior needed now that advanced loot pools are removed
  const enemyInput = byId("sandbox-enemy-id");
  if (enemyInput) {
    enemyInput.addEventListener("change", () => {
      // keep for future extension; no-op for now
    });
  }

  // Spawn button
  const spawnBtn = byId("sandbox-spawn-btn");
  if (spawnBtn) {
    spawnBtn.addEventListener("click", () => {
      try {
        if (!window.GameAPI) return;
        const enemyId = currentEnemyId();
        if (!enemyId) {
          if (typeof window.GameAPI.log === "function") {
            window.GameAPI.log("Sandbox: Enemy id is empty; cannot spawn.", "warn");
          }
          return;
        }
        const cntInput = byId("sandbox-enemy-count");
        let n = 1;
        if (cntInput) {
          n = (Number(cntInput.value) || 1) | 0;
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
    });
  }

  // Initialize button labels
  refreshAiToggle();
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