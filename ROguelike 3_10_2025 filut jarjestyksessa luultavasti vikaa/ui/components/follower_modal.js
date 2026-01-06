/**
 * FollowerModal: read-only follower inspect panel.
 *
 * Exports (ESM + window.FollowerModal):
 * - show(ctx, view)
 * - hide()
 * - isOpen()
 *
 * `view` is a plain object built by core/bridge/ui_orchestration.js with fields:
 *   { id, name, level, hp, maxHp, faction, roles, race, subrace, background,
 *     tags, personalityTags, temperament, hint, glyph, color }
 */

let _panel = null;
let _content = null;

function ensurePanel() {
  if (_panel) return _panel;

  const panel = document.createElement("div");
  panel.id = "follower-panel";
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
  panel.style.minWidth = "420px";
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
  content.id = "follower-content";
  content.style.color = "#e5e7eb";
  content.style.fontSize = "13px";
  content.style.lineHeight = "1.4";

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

function esc(str) {
  if (str == null) return "";
  return String(str);
}

function buildContent(ctx, view) {
  const v = view || {};
  const name = esc(v.name || "Follower");
  const archetype = esc((v.roles && v.roles.join(", ")) || "");
  const race = esc(v.race || "");
  const subrace = esc(v.subrace || "");
  const background = esc(v.background || "");
  const faction = esc(v.faction || "");
  const level = v.level != null ? (v.level | 0) : 1;
  const hp = typeof v.hp === "number" ? v.hp : null;
  const maxHp = typeof v.maxHp === "number" ? v.maxHp : null;
  const hpStr = (hp != null && maxHp != null) ? `HP ${hp}/${maxHp}` : "";
  const roles = Array.isArray(v.roles) && v.roles.length ? v.roles : null;
  const tags = Array.isArray(v.tags) && v.tags.length ? v.tags : null;
  const personality = Array.isArray(v.personalityTags) && v.personalityTags.length ? v.personalityTags : null;
  const temperament = v.temperament && typeof v.temperament === "object" ? v.temperament : null;
  const hint = esc(v.hint || "");

  const lines = [];

  lines.push("<div style='font-size:16px; font-weight:600; margin-bottom:6px;'>Follower</div>");

  // Name + race/background line
  const metaParts = [];
  if (race || subrace) {
    metaParts.push([race, subrace].filter(Boolean).join(" / "));
  }
  if (background) metaParts.push(background);
  if (faction) metaParts.push(`Faction: ${faction}`);
  const meta = metaParts.join("  •  ");

  lines.push(`<div style="font-size:14px; font-weight:500;">${name}</div>`);
  if (meta) {
    lines.push(`<div style="font-size:12px; color:#9ca3af; margin-bottom:4px;">${meta}</div>`);
  } else {
    lines.push("<div style=\"margin-bottom:4px;\"></div>");
  }

  // Stats line
  const statParts = [];
  statParts.push(`Level ${level}`);
  if (hpStr) statParts.push(hpStr);
  if (roles && roles.length) statParts.push(roles.join(", "));
  const stats = statParts.join("   •   ");
  lines.push(`<div style="margin-bottom:6px;">${stats}</div>`);

  // Personality / tags
  if (personality || tags) {
    lines.push("<div style='margin-top:4px;'>Traits:</div>");
    const traitParts = [];
    if (personality) {
      traitParts.push(`<span style="color:#f97316;">${esc(personality.join(", "))}</span>`);
    }
    if (tags) {
      traitParts.push(`<span style="color:#9ca3af;">${esc(tags.join(", "))}</span>`);
    }
    lines.push(`<div style="margin-left:12px; margin-top:2px;">${traitParts.join("  •  ")}</div>`);
  }

  // Temperament summary
  if (temperament) {
    const t = temperament;
    const pieces = [];
    if (typeof t.aggression === "number") pieces.push(`Aggression ${Math.round(t.aggression * 100)}%`);
    if (typeof t.courage === "number") pieces.push(`Courage ${Math.round(t.courage * 100)}%`);
    if (typeof t.loyalty === "number") pieces.push(`Loyalty ${Math.round(t.loyalty * 100)}%`);
    if (typeof t.fleeHpFrac === "number") pieces.push(`Flee at ≤ ${Math.round(t.fleeHpFrac * 100)}% HP`);
    if (pieces.length) {
      lines.push("<div style='margin-top:6px;'>Temperament:</div>");
      lines.push(`<div style="margin-left:12px; margin-top:2px; color:#cbd5e1;">${pieces.join("  •  ")}</div>`);
    }
  }

  // Equipment placeholders (Phase 2: read-only, no items yet)
  lines.push("<div style='margin-top:8px;'>Equipment (coming later):</div>");
  const eqLines = [
    "Left hand: (none)",
    "Right hand: (none)",
    "Head: (none)",
    "Torso: (none)",
    "Legs: (none)",
    "Hands: (none)"
  ];
  lines.push("<ul style='margin:4px 0 0 16px;'>" +
    eqLines.map(t => `<li>${t}</li>`).join("") +
    "</ul>");

  if (hint) {
    lines.push(`<div style="margin-top:8px; font-size:12px; color:#9ca3af;">${hint}</div>`);
  }

  return lines.join("");
}

export function show(ctx = null, view = null) {
  const panel = ensurePanel();
  try {
    const html = buildContent(ctx, view);
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
attachGlobal("FollowerModal", { show, hide, isOpen });