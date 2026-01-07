/**
 * FollowerModal: read-only follower inspect panel.
 *
 * Exports (ESM + window.FollowerModal):
 * - show(ctx, view)
 * - hide()
 * - isOpen()
 *
 * `view` is a plain object built by core/bridge/ui_orchestration.js with fields:
 *   { id, name, level, hp, maxHp, atk, def, faction, roles, race, subrace, background,
 *     tags, personalityTags, temperament, hint, glyph, color, equipment, inventory }
 */

let _panel = null;
let _content = null;
let _ctxForCommands = null;
let _viewForCommands = null;

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
  const atk = typeof v.atk === "number" ? v.atk : null;
  const defVal = typeof v.def === "number" ? v.def : null;
  const roles = Array.isArray(v.roles) && v.roles.length ? v.roles : null;
  const tags = Array.isArray(v.tags) && v.tags.length ? v.tags : null;
  const personality = Array.isArray(v.personalityTags) && v.personalityTags.length ? v.personalityTags : null;
  const temperament = v.temperament && typeof v.temperament === "object" ? v.temperament : null;
  const hint = esc(v.hint || "");
  const equipment = v.equipment && typeof v.equipment === "object" ? v.equipment : null;
  const inventory = Array.isArray(v.inventory) ? v.inventory : null;
  const playerInv = ctx && ctx.player && Array.isArray(ctx.player.inventory) ? ctx.player.inventory : null;

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
  if (atk != null) statParts.push(`Attack ${atk}`);
  if (defVal != null) statParts.push(`Defense ${defVal}`);
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

  // Equipment (read-only view)
  const formatItem = (it) => {
    if (!it) return "(none)";
    const base = esc(it.name || it.id || it.type || "item");
    const parts = [];
    if (typeof it.atk === "number") parts.push(`+${Number(it.atk).toFixed(1)} atk`);
    if (typeof it.def === "number") parts.push(`+${Number(it.def).toFixed(1)} def`);
    if (it.kind === "potion") {
      const heal = typeof it.heal === "number" ? it.heal : 3;
      parts.push(`+${heal} HP`);
    }
    const extra = parts.length ? ` (${parts.join(", ")})` : "";
    const count = typeof it.count === "number" && it.count > 1 ? ` x${it.count}` : "";
    return `${base}${extra}${count}`;
  };

  lines.push("<div style='margin-top:8px;'>Equipment:</div>");
  if (equipment) {
    const slotDefs = [
      { key: "left", label: "Left hand" },
      { key: "right", label: "Right hand" },
      { key: "head", label: "Head" },
      { key: "torso", label: "Torso" },
      { key: "legs", label: "Legs" },
      { key: "hands", label: "Hands" },
    ];
    lines.push("<ul style='margin:4px 0 0 16px;'>" +
      slotDefs.map(({ key, label }) => {
        const it = equipment[key] || null;
        const base = `${label}: ${esc(formatItem(it))}`;
        if (!it) return `<li>${base}</li>`;
        return `<li>${base} <span data-fcmd="unequip" data-slot="${key}" style="color:#60a5fa; cursor:pointer;">[Unequip]</span></li>`;
      }).join("") +
      "</ul>");
  } else {
    lines.push("<ul style='margin:4px 0 0 16px;'>" +
      ["Left hand", "Right hand", "Head", "Torso", "Legs", "Hands"]
        .map(lbl => `<li>${lbl}: (none)</li>`).join("") +
      "</ul>");
  }

  // Inventory (follower's own inventory, with Equip/Take actions)
  lines.push("<div style='margin-top:8px;'>Inventory:</div>");
  if (inventory && inventory.length) {
    lines.push("<ul style='margin:4px 0 0 16px;'>" +
      inventory.map((it, idx) =>
        `<li>${idx + 1}. ${esc(formatItem(it))} ` +
        `<span data-fcmd="equip" data-index="${idx}" style="color:#4ade80; cursor:pointer;">[Equip]</span> ` +
        `<span data-fcmd="take" data-index="${idx}" style="color:#60a5fa; cursor:pointer;">[Take]</span>` +
        "</li>"
      ).join("") +
      "</ul>");
  } else {
    lines.push("<div style=\"margin-left:12px; margin-top:2px; color:#9ca3af;\">(empty)</div>");
  }

  // Player inventory (give to follower)
  lines.push("<div style='margin-top:8px;'>Player inventory (give to follower):</div>");
  if (playerInv && playerInv.length) {
    const maxShown = 30;
    lines.push("<ul style='margin:4px 0 0 16px;'>" +
      playerInv.slice(0, maxShown).map((it, idx) =>
        `<li>${idx + 1}. ${esc(formatItem(it))} ` +
        `<span data-fcmd="give" data-pindex="${idx}" style="color:#60a5fa; cursor:pointer;">[Give]</span>` +
        "</li>"
      ).join("") +
      "</ul>");
    if (playerInv.length > maxShown) {
      lines.push(`<div style="margin-left:12px; margin-top:2px; color:#9ca3af;">(+${playerInv.length - maxShown} more not shown)</div>`);
    }
  } else {
    lines.push("<div style=\"margin-left:12px; margin-top:2px; color:#9ca3af;\">(no items)</div>");
  }

  if (hint) {
    lines.push(`<div style="margin-top:8px; font-size:12px; color:#9ca3af;">${hint}</div>`);
  }

  return lines.join("");
}

function bindCommands() {
  if (!_content) return;
  const root = _content;
  const els = root.querySelectorAll("[data-fcmd]");
  if (!els || !els.length) return;
  els.forEach((el) => {
    el.addEventListener("click", (e) => {
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      const cmd = el.getAttribute("data-fcmd");
      if (!cmd || !_ctxForCommands || !_viewForCommands || !_viewForCommands.id) return;
      const fid = _viewForCommands.id;
      let did = false;
      try {
        const FI = (typeof window !== "undefined" && window.FollowersItems) ? window.FollowersItems : null;
        if (!FI) return;

        if (cmd === "take") {
          const idx = parseInt(el.getAttribute("data-index") || "-1", 10);
          if (idx >= 0 && typeof FI.takeInventoryItemFromFollower === "function") {
            did = !!FI.takeInventoryItemFromFollower(_ctxForCommands, fid, idx);
          }

        } else if (cmd === "unequip") {
          const slot = el.getAttribute("data-slot") || "";
          if (slot && typeof FI.unequipFollowerSlot === "function") {
            did = !!FI.unequipFollowerSlot(_ctxForCommands, fid, slot);
          }

        } else if (cmd === "give") {
          const pidx = parseInt(el.getAttribute("data-pindex") || "-1", 10);
          if (pidx >= 0 && typeof FI.giveItemToFollower === "function") {
            did = !!FI.giveItemToFollower(_ctxForCommands, fid, pidx);
          }

        } else if (cmd === "equip") {
          const idx = parseInt(el.getAttribute("data-index") || "-1", 10);
          if (idx >= 0 && typeof FI.equipFollowerItemFromInventory === "function") {
            // Decide slot based on item slot and current equipment
            let slot = "right";
            try {
              const p = _ctxForCommands && _ctxForCommands.player;
              const followers = p && Array.isArray(p.followers) ? p.followers : null;
              let rec = null;
              if (followers) {
                rec = followers.find(f => f && f.id === fid) || null;
              }
              const finv = rec && Array.isArray(rec.inventory) ? rec.inventory : null;
              const item = finv && finv[idx] ? finv[idx] : null;
              const eq = rec && rec.equipment && typeof rec.equipment === "object" ? rec.equipment : null;
              const itemSlot = item && item.slot ? String(item.slot) : "hand";
              if (itemSlot === "head" || itemSlot === "torso" || itemSlot === "legs" || itemSlot === "hands") {
                slot = itemSlot;
              } else if (itemSlot === "hand") {
                // Prefer right hand, then left
                const rightEmpty = !eq || !eq.right;
                const leftEmpty = !eq || !eq.left;
                if (rightEmpty) slot = "right";
                else if (leftEmpty) slot = "left";
                else slot = "right";
              } else {
                slot = "right";
              }
            } catch (_) {}
            did = !!FI.equipFollowerItemFromInventory(_ctxForCommands, fid, idx, slot);
          }
        }
      } catch (_) {}

      // If we changed something, ask UIOrchestration to rebuild the follower view and panel.
      if (did) {
        try {
          const UIO = (typeof window !== "undefined" && window.UIOrchestration) ? window.UIOrchestration : null;
          if (UIO && typeof UIO.showFollower === "function") {
            const stub = {
              _isFollower: true,
              _followerId: fid,
              id: fid,
              type: fid,
              name: _viewForCommands.name || "Follower",
              hp: typeof _viewForCommands.hp === "number" ? _viewForCommands.hp : undefined,
              maxHp: typeof _viewForCommands.maxHp === "number" ? _viewForCommands.maxHp : undefined,
              level: typeof _viewForCommands.level === "number" ? _viewForCommands.level : undefined,
            };
            UIO.showFollower(_ctxForCommands, stub);
          }
        } catch (_) {}
      }
    });
  });
}

export function show(ctx = null, view = null) {
  const panel = ensurePanel();
  _ctxForCommands = ctx || null;
  _viewForCommands = view || null;
  try {
    const html = buildContent(ctx, view);
    if (_content) {
      _content.innerHTML = html;
      bindCommands();
    }
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