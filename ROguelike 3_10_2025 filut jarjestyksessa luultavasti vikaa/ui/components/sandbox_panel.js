/**
 * SandboxPanel: minimal overlay for sandbox mode controls (F10).
 *
 * Exports (ESM + window.SandboxPanel):
 * - init(UI)
 * - show()
 * - hide()
 * - isOpen()
 *
 * Behavior:
 * - Only intended for ctx.isSandbox === true.
 * - F10 toggles this panel via UI.handlers.onToggleSandboxPanel.
 * - Provides an explicit "Exit Sandbox and Start New Game" button, which just
 *   invokes UI.handlers.onRestart() (same as existing GOD new game).
 */

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
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
  el.style.minWidth = "220px";
  el.style.maxWidth = "260px";

  el.innerHTML = `
    <div style="font-weight:600; letter-spacing:0.03em; text-transform:uppercase; font-size:11px; color:#a5b4fc; margin-bottom:6px;">
      Sandbox Controls
    </div>
    <div id="sandbox-panel-body" style="display:flex; flex-direction:column; gap:6px;">
      <div id="sandbox-panel-mode-label" style="font-size:12px; color:#e5e7eb;">
        Mode: <span style="color:#fbbf24;">Sandbox Room</span>
      </div>
      <div style="font-size:11px; color:#9ca3af;">
        Press <span style="color:#e5e7eb;">F10</span> to toggle this panel.
      </div>
      <button id="sandbox-exit-btn" type="button"
        style="margin-top:4px; padding:5px 8px; border-radius:6px; border:1px solid #4b5563;
               background:#111827; color:#e5e7eb; font-size:12px; cursor:pointer; text-align:left;">
        Exit Sandbox and Start New Game
      </button>
    </div>
  `;

  document.body.appendChild(el);
  el.hidden = true;
  return el;
}

let _ui = null;

export function init(UI) {
  _ui = UI || null;
  const panel = ensurePanel();
  const exitBtn = byId("sandbox-exit-btn");
  if (exitBtn) {
    exitBtn.addEventListener("click", () => {
      try { hide(); } catch (_) {}
      try {
        if (_ui && _ui.handlers && typeof _ui.handlers.onRestart === "function") {
          _ui.handlers.onRestart();
        }
      } catch (_) {}
    });
  }
}

export function show() {
  const el = ensurePanel();
  el.hidden = false;
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