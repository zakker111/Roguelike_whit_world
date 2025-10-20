/**
 * QuestBoardUI: minimal quest board panel.
 * Shows a simple modal with title "Quest Board" and a close button.
 * DOM-only; canvas redraw is managed by callers (PropsService/UIBridge).
 */

let _panel = null;

function ensurePanel() {
  try {
    let el = document.getElementById("questboard-panel");
    if (el) return el;
    el = document.createElement("div");
    el.id = "questboard-panel";
    el.hidden = true;
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.top = "50%";
    el.style.transform = "translate(-50%,-50%)";
    el.style.zIndex = "9998";
    el.style.minWidth = "300px";
    el.style.maxWidth = "640px";
    el.style.maxHeight = "70vh";
    el.style.overflow = "auto";
    el.style.padding = "12px";
    el.style.background = "rgba(14, 18, 28, 0.95)";
    el.style.color = "#e5e7eb";
    el.style.border = "1px solid #334155";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.6)";
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong id="questboard-title">Quest Board</strong><button id="questboard-close-btn" style="padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Close</button></div><div id="questboard-body" style="color:#94a3b8;">No quests yet.</div>';
    document.body.appendChild(el);
    try {
      const btn = el.querySelector("#questboard-close-btn");
      if (btn) btn.onclick = function () {
        try { hide(); } catch (_) {}
      };
    } catch (_) {}
    _panel = el;
    return el;
  } catch (_) {
    return null;
  }
}

export function hide() {
  try {
    let el = document.getElementById("questboard-panel");
    if (!el) el = ensurePanel();
    if (el) el.hidden = true;
  } catch (_) {}
}

export function isOpen() {
  try {
    const el = document.getElementById("questboard-panel");
    return !!(el && el.hidden === false);
  } catch (_) { return false; }
}

export function open(ctx) {
  const el = ensurePanel();
  if (!el) return;
  el.hidden = false;
  try {
    const ttl = el.querySelector("#questboard-title");
    if (ttl) ttl.textContent = "Quest Board";
  } catch (_) {}
  // No quest logic yet — placeholder panel only
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.QuestBoardUI = { ensurePanel, hide, isOpen, open };
}