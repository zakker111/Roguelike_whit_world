/**
 * QuestBoardUI: simple quest board panel with Accept actions.
 * Lists available and active quests for the current town (via QuestService).
 * DOM-only; canvas redraw is managed by callers (PropsService/UIBridge).
 */

let _panel = null;
let _escBound = false;

function bindEsc() {
  if (_escBound) return;
  try {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) {
        try { hide(); e.preventDefault(); } catch (_) {}
      }
    });
    _escBound = true;
  } catch (_) {}
}

function ensurePanel() {
  try {
    let el = document.getElementById("questboard-panel");
    if (el) { bindEsc(); return el; }
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
    el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong id="questboard-title">Quest Board</strong><button id="questboard-close-btn" style="padding:4px 8px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Close</button></div><div id="questboard-body" style="color:#94a3b8;"></div>';
    document.body.appendChild(el);
    try {
      const btn = el.querySelector("#questboard-close-btn");
      if (btn) btn.onclick = function () {
        try { hide(); } catch (_) {}
      };
    } catch (_) {}
    _panel = el;
    bindEsc();
    return el;
  } catch (_) {
    return null;
  }
}

function fmtTimeLeft(ctx, expiresAtTurn) {
  try {
    const now = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    const left = Math.max(0, (expiresAtTurn | 0) - now);
    const minsPerTurn = (ctx.time && typeof ctx.time.minutesPerTurn === "number") ? ctx.time.minutesPerTurn : ((24 * 60) / 360);
    const mins = Math.round(left * minsPerTurn);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  } catch (_) { return ""; }
}

function render(ctx) {
  const el = ensurePanel();
  if (!el) return;
  const qs = (typeof window !== "undefined" && window.QuestService && typeof window.QuestService.listForCurrentTown === "function")
    ? window.QuestService.listForCurrentTown(ctx)
    : { available: [], active: [], completed: [] };

    const body = el.querySelector("#questboard-body");
    if (!body) return;

    function makeRow(html) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937;">' + html + '</div>';
    }

    let html = "";

    // Available
    const av = Array.isArray(qs.available) ? qs.available : [];
    html += '<div style="margin:4px 0 6px 0;color:#e2e8f0;font-weight:600;">Available</div>';
    if (!av.length) {
      html += '<div style="color:#94a3b8;margin-bottom:8px;">No quests posted at the moment.</div>';
    } else {
      html += av.map((q) => {
        const due = fmtTimeLeft(ctx, q.expiresAtTurn);
        const btn = `<button data-accept="${q.templateId}" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Accept</button>`;
        const text = `<div><div style="color:#e5e7eb;">${q.title || q.templateId}</div><div style="color:#94a3b8;font-size:12px;">${q.desc || ""}</div><div style="color:#93c5fd;font-size:12px;margin-top:2px;">Expires in ${due}</div></div>`;
        return makeRow(text + btn);
      }).join("");
    }

    // Active
    const ac = Array.isArray(qs.active) ? qs.active : [];
    html += '<div style="margin:10px 0 6px 0;color:#e2e8f0;font-weight:600;">Active</div>';
    if (!ac.length) {
      html += '<div style="color:#94a3b8;margin-bottom:8px;">No active quests.</div>';
    } else {
      html += ac.map((q) => {
        let status = "";
        let btnActive = "";
        if (q.kind === "gather") {
          status = "Gather the requested items.";
        } else if (q.kind === "encounter") {
          // Consider completed if status says so OR getTurnIns reports this quest eligible
          let completed = (q.status === "completedPendingTurnIn");
          try {
            const QS = (typeof window !== "undefined" ? window.QuestService : null);
            const list = (QS && typeof QS.getTurnIns === "function") ? QS.getTurnIns(ctx) : [];
            if (!completed && Array.isArray(list)) {
              completed = list.some(ent =>
                (ent && ent.instanceId && q.instanceId && ent.instanceId === q.instanceId) ||
                (ent && ent.templateId && q.templateId && ent.templateId === q.templateId)
              );
            }
          } catch (_) {}
          // Prefer completed status over marker hint to avoid misleading messaging after victory
          status = completed ? "Completed — claim your reward." : (q.marker ? "An E marker was placed on the overworld." : "Seek the objective.");
          // Show Complete button when eligible; else still allow trying to complete (will show a warning if not ready)
          const canComplete = completed && q.instanceId;
          btnActive = canComplete
            ? `<button data-claim-active="${q.instanceId}" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Complete</button>`
            : (q.instanceId ? `<button data-claim-active="${q.instanceId}" style="padding:4px 8px;background:#1f2937;color:#9ca3af;border:1px solid #334155;border-radius:4px;cursor:not-allowed;">Complete</button>` : "");
        }
        const due = fmtTimeLeft(ctx, q.expiresAtTurn);
        const text = `<div><div style="color:#e5e7eb;">${q.title || q.templateId}</div><div style="color:#94a3b8;font-size:12px;">${status}</div><div style="color:#93c5fd;font-size:12px;margin-top:2px;">Expires in ${due}</div></div>`;
        return makeRow(text + btnActive);
      }).join("");
    }

    // Turn-ins (claim rewards here)
    let ti = [];
    try {
      const QS = (typeof window !== "undefined" ? window.QuestService : null);
      ti = (QS && typeof QS.getTurnIns === "function") ? QS.getTurnIns(ctx) : [];
    } catch (_) {}
    html += '<div style="margin:10px 0 6px 0;color:#e2e8f0;font-weight:600;">Eligible turn-ins</div>';
    if (!ti.length) {
      html += '<div style="color:#94a3b8;margin-bottom:8px;">No quests ready to turn in.</div>';
    } else {
      // Complete all button
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button id="questboard-claim-all" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Complete all</button></div>';
      html += ti.map((ent) => {
        const g = ent.gold | 0;
        const text = `<div><div style="color:#e5e7eb;">${ent.title || "Quest"}</div><div style="color:#fbbf24;font-size:12px;">${g}g</div></div>`;
        const btn = ent.requiresAccept
          ? `<button data-claim-tid="${ent.templateId}" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Complete</button>`
          : `<button data-claim="${ent.instanceId}" style="padding:4px 8px;background:#243244;color:#e5e7eb;border:1px solid #334155;border-radius:4px;cursor:pointer;">Complete</button>`;
        return makeRow(text + btn);
      }).join("");
    }

    body.innerHTML = html;

    // Wire Accept buttons
    const buttons = body.querySelectorAll("button[data-accept]");
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      btn.onclick = function () {
        try {
          const tid = String(btn.getAttribute("data-accept") || "");
          if (!tid) return;
          if (typeof window !== "undefined" && window.QuestService && typeof window.QuestService.accept === "function") {
            window.QuestService.accept(ctx, tid);
            render(ctx);
          }
        } catch (_) {}
      };
    }

    // Wire Claim buttons (by instance)
    const cButtons = body.querySelectorAll("button[data-claim]");
    for (let i = 0; i < cButtons.length; i++) {
      const btn = cButtons[i];
      btn.onclick = function () {
        try {
          const id = String(btn.getAttribute("data-claim") || "");
          if (!id) return;
          if (typeof window !== "undefined" && window.QuestService && typeof window.QuestService.claim === "function") {
            window.QuestService.claim(ctx, id);
            render(ctx);
          }
        } catch (_) {}
      };
    }
    // Wire Claim buttons (by template; auto-accept)
    const tButtons = body.querySelectorAll("button[data-claim-tid]");
    for (let i = 0; i < tButtons.length; i++) {
      const btn = tButtons[i];
      btn.onclick = function () {
        try {
          const tid = String(btn.getAttribute("data-claim-tid") || "");
          if (!tid) return;
          if (typeof window !== "undefined" && window.QuestService && typeof window.QuestService.claimTemplate === "function") {
            window.QuestService.claimTemplate(ctx, tid);
            render(ctx);
          }
        } catch (_) {}
      };
    }
    // Wire Claim buttons shown in Active section (completed encounters)
    const aButtons = body.querySelectorAll("button[data-claim-active]");
    for (let i = 0; i < aButtons.length; i++) {
      const btn = aButtons[i];
      btn.onclick = function () {
        try {
          const id = String(btn.getAttribute("data-claim-active") || "");
          if (!id) return;
          if (typeof window !== "undefined" && window.QuestService && typeof window.QuestService.claim === "function") {
            window.QuestService.claim(ctx, id);
            render(ctx);
          }
        } catch (_) {}
      };
    }
    // Wire Claim all
    const claimAll = body.querySelector("#questboard-claim-all");
    if (claimAll) {
      claimAll.onclick = function () {
        try {
          const QS = (typeof window !== "undefined" ? window.QuestService : null);
          if (QS && typeof QS.claimAllEligible === "function") {
            QS.claimAllEligible(ctx);
          }
          render(ctx);
        } catch (_) {}
      };
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
  render(ctx);
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("QuestBoardUI", { ensurePanel, hide, isOpen, open });