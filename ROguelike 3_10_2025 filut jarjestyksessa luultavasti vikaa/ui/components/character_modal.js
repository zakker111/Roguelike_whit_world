/**
 * CharacterModal: Character Sheet panel (moved out of Help)
 *
 * Exports (ESM + window.CharacterModal):
 * - show(ctx)
 * - hide()
 * - isOpen()
 */
let _panel = null;
let _content = null;

function ensurePanel() {
  if (_panel) return _panel;

  const panel = document.createElement("div");
  panel.id = "character-panel";
  panel.style.position = "fixed";
  panel.style.left = "50%";
  panel.style.top = "50%";
  panel.style.transform = "translate(-50%, -50%)";
  panel.style.zIndex = "40000";
  panel.style.background = "rgba(20,24,33,0.98)";
  panel.style.border = "1px solid rgba(80,90,120,0.6)";
  panel.style.borderRadius = "8px";
  panel.style.padding = "12px";
  panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
  panel.style.minWidth = "520px";
  panel.style.maxWidth = "92vw";
  panel.style.maxHeight = "80vh";
  panel.style.overflow = "auto";
  panel.style.display = "none";

  const close = document.createElement("div");
  close.textContent = "Close (Esc)";
  close.style.color = "#94a3b8";
  close.style.fontSize = "12px";
  close.style.margin = "0 0 10px 0";

  const content = document.createElement("div");
  content.id = "character-content";
  content.style.color = "#e5e7eb";
  content.style.fontSize = "13px";
  content.style.lineHeight = "1.45";

  panel.appendChild(close);
  panel.appendChild(content);
  document.body.appendChild(panel);

  // Click outside to close
  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      hide();
      e.stopPropagation();
    }
  });

  _panel = panel;
  _content = content;
  return panel;
}

function buildContent(ctx) {
  const p = (ctx && ctx.player) ? ctx.player : null;
  const atk = (ctx && typeof ctx.getPlayerAttack === "function") ? ctx.getPlayerAttack() : (p ? (p.atk || 1) : 1);
  const def = (ctx && typeof ctx.getPlayerDefense === "function") ? ctx.getPlayerDefense() : (p ? 0 : 0);
  const hpStr = p ? `HP ${p.hp.toFixed(1)}/${p.maxHp.toFixed(1)}` : "";
  const levelStr = p ? `Level ${p.level}  XP ${p.xp}/${p.xpNext}` : "";
  const statuses = [];
  if (p && p.bleedTurns && p.bleedTurns > 0) statuses.push(`Bleeding (${p.bleedTurns})`);
  if (p && p.dazedTurns && p.dazedTurns > 0) statuses.push(`Dazed (${p.dazedTurns})`);
  if (p && p.inFlamesTurns && p.inFlamesTurns > 0) statuses.push(`In Flames (${p.inFlamesTurns})`);

  const injuries = (p && Array.isArray(p.injuries)) ? p.injuries : [];
  const injHTML = injuries.length ? injuries.slice(0, 16).map((inj) => {
    // Support both string and object formats
    let name = "";
    let healable = true;
    let dur = 0;
    if (typeof inj === "string") {
      name = inj;
      healable = !(/scar|missing finger/i.test(name));
      dur = healable ? 0 : 0;
    } else {
      name = inj.name || "injury";
      healable = (typeof inj.healable === "boolean") ? inj.healable : !(/scar|missing finger/i.test(name));
      dur = (inj.durationTurns | 0);
    }
    const color = healable ? "#f59e0b" /* amber for healing */ : "#ef4444" /* red for permanent */;
    const tail = healable ? (dur > 0 ? ` (healing)` : ` (healing)`) : " (permanent)";
    return `<li style="color:${color};">${name}${tail}</li>`;
  }).join("") : "<li>(none)</li>";

  const skillsHTML = (function () {
    try {
      const s = (p && p.skills) ? p.skills : null;
      if (!s) return "";
      const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
      const oneBuff = clamp(Math.floor((s.oneHand || 0) / 20) * 0.01, 0, 0.05);
      const twoBuff = clamp(Math.floor((s.twoHand || 0) / 20) * 0.01, 0, 0.06);
      const bluntBuff = clamp(Math.floor((s.blunt || 0) / 25) * 0.01, 0, 0.04);
      const pct = (v) => `${Math.round(v * 100)}%`;
      const combatLines = [
        `<li>One-handed: +${pct(oneBuff)} damage (uses: ${Math.floor(s.oneHand || 0)})</li>`,
        `<li>Two-handed: +${pct(twoBuff)} damage (uses: ${Math.floor(s.twoHand || 0)})</li>`,
        `<li>Blunt: +${pct(bluntBuff)} damage (uses: ${Math.floor(s.blunt || 0)})</li>`,
      ].join("");
      // Non-combat proficiencies: show uses and a coarse proficiency/effect percent (0–5%)
      const foragingPct = clamp(Math.floor((s.foraging || 0) / 25) * 0.01, 0, 0.05);
      const cookingPct = clamp(Math.floor((s.cooking || 0) / 25) * 0.01, 0, 0.05);
      const survivalPct = clamp(Math.floor((s.survivalism || 0) / 25) * 0.01, 0, 0.05);
      const lockpickPct = clamp(Math.floor((s.lockpicking || 0) / 25) * 0.01, 0, 0.05);
      const nonCombatLines = [
        `<li>Foraging: uses ${Math.floor(s.foraging || 0)} (proficiency ${pct(foragingPct)})</li>`,
        `<li>Cooking: uses ${Math.floor(s.cooking || 0)} (proficiency ${pct(cookingPct)})</li>`,
        `<li>Survivalism: uses ${Math.floor(s.survivalism || 0)} (effect +${pct(survivalPct)})</li>`,
        `<li>Lockpicking: uses ${Math.floor(s.lockpicking || 0)} (effect +${pct(lockpickPct)})</li>`,
      ].join("");
      return "<div style='margin-top:6px;'>Skills (passive damage buffs):</div>" +
             `<ul style='margin:4px 0 0 14px;'>${combatLines}</ul>` +
             "<div style='margin-top:10px;'>Non-combat:</div>" +
             `<ul style='margin:4px 0 0 14px;'>${nonCombatLines}</ul>`;
    } catch (_) { return ""; }
  })();

  // Party / followers summary
  const partyHTML = (function () {
    try {
      if (!p || !Array.isArray(p.followers)) {
        return "<div style='margin-top:10px;'>Party: 0/3 followers</div>" +
               "<ul style='margin:4px 0 0 14px;'><li>(no followers)</li></ul>";
      }
      const followers = p.followers.filter(f => {
        if (!f) return false;
        if (f.enabled === false) return false;
        if (typeof f.hp === "number" && f.hp <= 0) return false;
        return true;
      });
      let maxFollowers = 3;
      let defs = null;
      try {
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const cfg = GD && GD.config;
        const fc = cfg && cfg.followers;
        if (fc && typeof fc.maxActive === "number" && fc.maxActive > 0) {
          maxFollowers = fc.maxActive | 0;
        }
        if (GD && Array.isArray(GD.followers)) {
          defs = GD.followers;
        }
      } catch (_) {}
      const header = `<div style='margin-top:10px;'>Party: ${followers.length}/${maxFollowers} followers</div>`;
      if (!followers.length) {
        return header + "<ul style='margin:4px 0 0 14px;'><li>(no followers)</li></ul>";
      }
      const list = followers.map((f) => {
        const rawName = f.name || "";
        // Resolve archetype definition from GameData.followers to get a nicer label
        let archId = "";
        try {
          if (f.archetypeId) archId = String(f.archetypeId);
          else if (f.id) {
            const raw = String(f.id);
            const idx = raw.indexOf("#");
            archId = idx >= 0 ? raw.slice(0, idx) : raw;
          }
        } catch (_) {}
        let defName = "";
        if (defs && archId) {
          try {
            const def = defs.find(d => d && String(d.id) === archId);
            if (def && typeof def.name === "string") defName = def.name;
          } catch (_) {}
        }
        // Prefer personalized record name once followers have been instantiated in runtime
        let displayName = rawName && rawName !== "Follower" ? rawName : "";
        if (!displayName) {
          if (defName) {
            // Strip generic suffix like " Ally" for a shorter role-style label when used as the name
            const trimmed = defName.replace(/\s+Ally$/i, "");
            displayName = trimmed || defName;
          } else if (archId) {
            displayName = archId;
          } else {
            displayName = "Follower";
          }
        }
        // Role label: derived from definition name or archetype id, shown in parens
        let roleLabel = "";
        if (defName) {
          const trimmed = defName.replace(/\s+Ally$/i, "");
          roleLabel = trimmed || defName;
        } else if (archId) {
          roleLabel = archId;
        }
        const roleStr = roleLabel ? ` (${roleLabel})` : "";
        const level = (typeof f.level === "number" && f.level > 0) ? f.level : 1;
        const hpPart = (typeof f.hp === "number" && typeof f.maxHp === "number")
          ? ` — HP ${f.hp.toFixed(1)}/${f.maxHp.toFixed(1)}`
          : "";
        return `<li>${displayName}${roleStr} — Level ${level}${hpPart}</li>`;
      }).join("");
      return header + `<ul style='margin:4px 0 0 14px;'>${list}</ul>`;
    } catch (_) {
      return "";
    }
  })();

  const html = [
    "<div style='font-size:16px; font-weight:600; margin-bottom:8px;'>Character Sheet</div>",
    `<div>${hpStr}  •  Attack ${atk.toFixed(1)}  Defense ${def.toFixed(1)}</div>`,
    `<div>${levelStr}</div>`,
    `<div>Status: ${statuses.length ? statuses.join(", ") : "None"}</div>`,
    "<div style='margin-top:6px;'>Injuries:</div>",
    `<ul style='margin:4px 0 0 14px;'>${injHTML}</ul>`,
    partyHTML,
    skillsHTML
  ].join("");

  return html;
}

export function show(ctx = null) {
  const panel = ensurePanel();
  try {
    const html = buildContent(ctx);
    if (_content) _content.innerHTML = html;
  } catch (_) {}
  panel.style.display = "block";
}

export function hide() {
  if (_panel) _panel.style.display = "none";
}

export function isOpen() {
  try { return !!(_panel && _panel.style.display !== "none"); } catch (_) { return false; }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("CharacterModal", { show, hide, isOpen });