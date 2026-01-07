/**
 * UIOrchestration: ctx-first wrappers around UIBridge and related UI modules.
 *
 * Exports (ESM + window.UIOrchestration):
 * - requestDraw(ctx)
 * - renderInventory(ctx)
 * - showInventory(ctx), hideInventory(ctx), isInventoryOpen(ctx)
 * - showLoot(ctx, list), hideLoot(ctx), isLootOpen(ctx)
 * - showGameOver(ctx), hideGameOver(ctx)
 * - showGod(ctx), hideGod(ctx), isGodOpen(ctx)
 * - showHelp(ctx), hideHelp(ctx), isHelpOpen(ctx)
 * - showRegionMap(ctx), hideRegionMap(ctx), isRegionMapOpen(ctx)
 * - hideShop(ctx), isShopOpen(ctx)
 * - hideSmoke(ctx), isSmokeOpen(ctx)
 * - showSleep(ctx), hideSleep(ctx), isSleepOpen(ctx), animateSleep(ctx, minutes, cb)
 * - showQuestBoard(ctx), hideQuestBoard(ctx), isQuestBoardOpen(ctx)
 * - cancelConfirm(ctx), isConfirmOpen(ctx)
 * - isAnyModalOpen(ctx)
 */

import { log as fallbackLog } from "../../utils/fallback.js";
import { getFollowerDef } from "../../entities/followers.js";
import { aggregateFollowerAtkDef } from "../../entities/equip_common.js";

function U(ctx) {
  try {
    return ctx?.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
  } catch (_) { return null; }
}

function IC(ctx) {
  try {
    return ctx?.InventoryController || (typeof window !== "undefined" ? window.InventoryController : null);
  } catch (_) { return null; }
}

function GL() {
  try {
    return (typeof window !== "undefined" ? window.GameLoop : null);
  } catch (_) { return null; }
}

function R() {
  try {
    return (typeof window !== "undefined" ? window.Render : null);
  } catch (_) { return null; }
}

export function requestDraw(ctx) {
  // Prefer ctx.requestDraw if provided by orchestrator
  try {
    if (ctx && typeof ctx.requestDraw === "function") {
      ctx.requestDraw();
      return;
    }
  } catch (_) {}
  // Next, GameLoop.requestDraw
  try {
    const gl = GL();
    if (gl && typeof gl.requestDraw === "function") {
      gl.requestDraw();
      return;
    }
  } catch (_) {}
  // Fallback: ask Render to draw if we have a render context provider
  try {
    const r = R();
    if (r && typeof r.draw === "function" && typeof ctx?.getRenderCtx === "function") {
      try {
        fallbackLog("uiOrchestration.requestDraw.renderFallback", "GameLoop.requestDraw unavailable; falling back to direct Render.draw.");
      } catch (_) {}
      r.draw(ctx.getRenderCtx());
    }
  } catch (_) {}
}

export function updateStats(ctx) {
  const u = U(ctx);
  if (u && typeof u.updateStats === "function") {
    u.updateStats(ctx);
  }
}

export function renderInventory(ctx) {
  const ic = IC(ctx);
  if (ic && typeof ic.render === "function") {
    ic.render(ctx);
    return;
  }
  const u = U(ctx);
  if (u && typeof u.renderInventory === "function") {
    u.renderInventory(ctx);
  }
}

export function showInventory(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isInventoryOpen === "function") wasOpen = !!u.isInventoryOpen(); } catch (_) {}
  const ic = IC(ctx);
  if (ic && typeof ic.show === "function") {
    ic.show(ctx);
  } else if (typeof renderInventory === "function") {
    renderInventory(ctx);
    if (u && typeof u.showInventory === "function") {
      u.showInventory(ctx);
    }
  }
  if (!wasOpen) requestDraw(ctx);
}

export function hideInventory(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isInventoryOpen === "function") wasOpen = !!u.isInventoryOpen(); } catch (_) {}
  const ic = IC(ctx);
  if (ic && typeof ic.hide === "function") {
    ic.hide(ctx);
  } else if (u && typeof u.hideInventory === "function") {
    u.hideInventory(ctx);
  }
  if (wasOpen) requestDraw(ctx);
}

export function isInventoryOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isInventoryOpen === "function") return !!u.isInventoryOpen(); } catch (_) {}
  return false;
}

export function showLoot(ctx, list) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isLootOpen === "function") wasOpen = !!u.isLootOpen(); } catch (_) {}
  if (u && typeof u.showLoot === "function") {
    u.showLoot(ctx, list);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideLoot(ctx) {
  const u = U(ctx);
  let wasOpen = true;
  try { if (u && typeof u.isLootOpen === "function") wasOpen = !!u.isLootOpen(); } catch (_) {}
  if (u && typeof u.hideLoot === "function") {
    u.hideLoot(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isLootOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isLootOpen === "function") return !!u.isLootOpen(); } catch (_) {}
  return false;
}

export function showGameOver(ctx) {
  const u = U(ctx);
  if (u && typeof u.showGameOver === "function") {
    u.showGameOver(ctx);
    requestDraw(ctx);
  }
}

export function hideGameOver(ctx) {
  const u = U(ctx);
  if (u && typeof u.hideGameOver === "function") {
    u.hideGameOver(ctx);
  }
}

export function showGod(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isGodOpen === "function") wasOpen = !!u.isGodOpen(); } catch (_) {}
  if (u && typeof u.showGod === "function") {
    u.showGod(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideGod(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isGodOpen === "function") wasOpen = !!u.isGodOpen(); } catch (_) {}
  if (u && typeof u.hideGod === "function") {
    u.hideGod(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isGodOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isGodOpen === "function") return !!u.isGodOpen(); } catch (_) {}
  return false;
}

export function showHelp(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isHelpOpen === "function") wasOpen = !!u.isHelpOpen(); } catch (_) {}
  if (u && typeof u.showHelp === "function") {
    u.showHelp(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideHelp(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isHelpOpen === "function") wasOpen = !!u.isHelpOpen(); } catch (_) {}
  if (u && typeof u.hideHelp === "function") {
    u.hideHelp(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isHelpOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isHelpOpen === "function") return !!u.isHelpOpen(); } catch (_) {}
  return false;
}

// --- Character Sheet wrappers ---
export function showCharacter(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isCharacterOpen === "function") wasOpen = !!u.isCharacterOpen(); } catch (_) {}
  if (u && typeof u.showCharacter === "function") {
    u.showCharacter(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideCharacter(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isCharacterOpen === "function") wasOpen = !!u.isCharacterOpen(); } catch (_) {}
  if (u && typeof u.hideCharacter === "function") {
    u.hideCharacter(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isCharacterOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isCharacterOpen === "function") return !!u.isCharacterOpen(); } catch (_) {}
  return false;
}



export function showShop(ctx, npc) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isShopOpen === "function") wasOpen = !!u.isShopOpen(); } catch (_) {}
  if (u && typeof u.showShop === "function") {
    u.showShop(ctx, npc);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideShop(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isShopOpen === "function") wasOpen = !!u.isShopOpen(); } catch (_) {}
  if (u && typeof u.hideShop === "function") {
    u.hideShop(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isShopOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isShopOpen === "function") return !!u.isShopOpen(); } catch (_) {}
  return false;
}

export function buyShopIndex(ctx, idx) {
  const u = U(ctx);
  if (u && typeof u.buyShopIndex === "function") {
    u.buyShopIndex(ctx, (idx | 0));
  }
}

export function showSmoke(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isSmokeOpen === "function") wasOpen = !!u.isSmokeOpen(); } catch (_) {}
  if (u && typeof u.showSmoke === "function") {
    u.showSmoke(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideSmoke(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isSmokeOpen === "function") wasOpen = !!u.isSmokeOpen(); } catch (_) {}
  if (u && typeof u.hideSmoke === "function") {
    u.hideSmoke(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isSmokeOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isSmokeOpen === "function") return !!u.isSmokeOpen(); } catch (_) {}
  return false;
}

export function showSleep(ctx, opts) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isSleepOpen === "function") wasOpen = !!u.isSleepOpen(); } catch (_) {}
  if (u && typeof u.showSleep === "function") {
    u.showSleep(ctx, opts || {});
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideSleep(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isSleepOpen === "function") wasOpen = !!u.isSleepOpen(); } catch (_) {}
  if (u && typeof u.hideSleep === "function") {
    u.hideSleep(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isSleepOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isSleepOpen === "function") return !!u.isSleepOpen(); } catch (_) {}
  return false;
}

export function animateSleep(ctx, minutes, afterTimeCb) {
  const u = U(ctx);
  if (u && typeof u.animateSleep === "function") {
    u.animateSleep(ctx, minutes, afterTimeCb);
  }
}

export function cancelConfirm(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isConfirmOpen === "function") wasOpen = !!u.isConfirmOpen(); } catch (_) {}
  if (u && typeof u.cancelConfirm === "function") {
    u.cancelConfirm(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isConfirmOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isConfirmOpen === "function") return !!u.isConfirmOpen(); } catch (_) {}
  return false;
}

export function showConfirm(ctx, text, pos, onOk, onCancel) {
  const u = U(ctx);
  // Best-effort: delegate to UIBridge/UI; no browser confirm fallback here
  if (u && typeof u.showConfirm === "function") {
    u.showConfirm(ctx, String(text || ""), pos || null, onOk, onCancel);
    requestDraw(ctx);
  }
}

export function isAnyModalOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isAnyModalOpen === "function") return !!u.isAnyModalOpen(); } catch (_) {}
  // Conservative default
  return false;
}

// Build a lightweight follower inspect view model for UI, combining runtime actor,
// follower record, and follower definition.
function buildFollowerView(ctx, runtime) {
  if (!ctx || !runtime) return null;
  const id = runtime._followerId || runtime.id || runtime.type;
  if (!id) return null;

  let rec = null;
  try {
    const p = ctx.player;
    if (p && Array.isArray(p.followers)) {
      rec = p.followers.find(f => f && f.id === id) || null;
    }
  } catch (_) {}

  let def = null;
  try {
    def = getFollowerDef(ctx, id) || null;
  } catch (_) {}

  const name =
    runtime.name ||
    (rec && rec.name) ||
    (def && def.name) ||
    "Follower";

  const level = (() => {
    if (typeof runtime.level === "number" && runtime.level > 0) return runtime.level | 0;
    if (rec && typeof rec.level === "number" && rec.level > 0) return rec.level | 0;
    if (def && typeof def.level === "number" && def.level > 0) return def.level | 0;
    return 1;
  })();

  let hp = typeof runtime.hp === "number" ? runtime.hp : null;
  let maxHp = typeof runtime.maxHp === "number" ? runtime.maxHp : null;
  if (rec) {
    if (hp == null && typeof rec.hp === "number") hp = rec.hp;
    if (maxHp == null && typeof rec.maxHp === "number") maxHp = rec.maxHp;
  }
  if (hp == null && def && typeof def.baseHp === "number") {
    hp = def.baseHp;
    maxHp = def.baseHp;
  }

  // Attack/Defense for inspect panel:
  // - Prefer runtime values (enemy actor stats).
  // - If missing, aggregate from follower definition + record (includes gear).
  // - Finally fall back to definition base stats.
  let atk = null;
  let defense = null;

  if (typeof runtime.atk === "number") atk = runtime.atk;
  if (typeof runtime.def === "number") defense = runtime.def;

  if ((atk == null || defense == null) && def) {
    try {
      const agg = aggregateFollowerAtkDef(def, rec || {});
      if (atk == null && typeof agg.atk === "number") atk = agg.atk;
      if (defense == null && typeof agg.def === "number") defense = agg.def;
    } catch (_) {}
  }

  if (atk == null && def && typeof def.baseAtk === "number") atk = def.baseAtk;
  if (defense == null && def && typeof def.baseDef === "number") defense = def.baseDef;

  const faction = runtime.faction || (def && def.faction) || "";

  const roles = Array.isArray(def && def.roles) ? def.roles.slice() : [];

  const race = (rec && rec.race) || (def && def.race) || null;
  const subrace = (rec && rec.subrace) || (def && def.subrace) || null;
  const background = (rec && rec.background) || (def && def.background) || null;

  const tags =
    (rec && Array.isArray(rec.tags) && rec.tags.length ? rec.tags.slice() :
      (def && Array.isArray(def.tags) ? def.tags.slice() : []));

  const personalityTags =
    (rec && Array.isArray(rec.personalityTags) && rec.personalityTags.length ? rec.personalityTags.slice() :
      (def && Array.isArray(def.personalityTags) ? def.personalityTags.slice() : []));

  const temperament = (rec && rec.temperament) || (def && def.temperament) || null;

  const hint = (def && def.hint) || null;

  const glyph = (def && def.glyph) || runtime.glyph || "?";
  const color = (def && def.color) || runtime.color || "#ffffff";

  // Follower equipment and inventory are stored on the follower record and are
  // exposed to the UI as-is for read-only display in Phase 3.
  let equipment = null;
  try {
    if (rec && rec.equipment && typeof rec.equipment === "object") {
      equipment = {
        left: rec.equipment.left || null,
        right: rec.equipment.right || null,
        head: rec.equipment.head || null,
        torso: rec.equipment.torso || null,
        legs: rec.equipment.legs || null,
        hands: rec.equipment.hands || null,
      };
    } else if (runtime && runtime.equipment && typeof runtime.equipment === "object") {
      equipment = {
        left: runtime.equipment.left || null,
        right: runtime.equipment.right || null,
        head: runtime.equipment.head || null,
        torso: runtime.equipment.torso || null,
        legs: runtime.equipment.legs || null,
        hands: runtime.equipment.hands || null,
      };
    }
  } catch (_) {}

  let inventory = [];
  try {
    if (rec && Array.isArray(rec.inventory)) {
      inventory = rec.inventory.slice();
    }
  } catch (_) {}

  return {
    id,
    name,
    level,
    hp,
    maxHp,
    atk,
    def: defense,
    faction,
    roles,
    race,
    subrace,
    background,
    tags,
    personalityTags,
    temperament,
    hint,
    glyph,
    color,
    equipment,
    inventory,
  };
}

export function showFollower(ctx, runtime) {
  const u = U(ctx);
  if (!u || typeof u.showFollower !== "function") return;
  const view = buildFollowerView(ctx, runtime);
  if (!view) return;
  let wasOpen = false;
  try { if (u && typeof u.isFollowerOpen === "function") wasOpen = !!u.isFollowerOpen(); } catch (_) {}
  u.showFollower(ctx, view);
  if (!wasOpen) requestDraw(ctx);
}

export function hideFollower(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try { if (u && typeof u.isFollowerOpen === "function") wasOpen = !!u.isFollowerOpen(); } catch (_) {}
  if (u && typeof u.hideFollower === "function") {
    u.hideFollower(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isFollowerOpen(ctx) {
  const u = U(ctx);
  try { if (u && typeof u.isFollowerOpen === "function") return !!u.isFollowerOpen(); } catch (_) {}
  return false;
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("UIOrchestration", {
  requestDraw,
  updateStats,
  renderInventory,
  showInventory,
  hideInventory,
  isInventoryOpen,
  showLoot,
  hideLoot,
  isLootOpen,
  showGameOver,
  hideGameOver,
  showGod,
  hideGod,
  isGodOpen,
  showHelp,
  hideHelp,
  isHelpOpen,
  showCharacter,
  hideCharacter,
  isCharacterOpen,
  showShop,
  hideShop,
  isShopOpen,
  buyShopIndex,
  showSmoke,
  hideSmoke,
  isSmokeOpen,
  showSleep,
  hideSleep,
  isSleepOpen,
  animateSleep,
  showConfirm,
  cancelConfirm,
  isConfirmOpen,
  isAnyModalOpen,
  // Follower inspect panel
  showFollower,
  hideFollower,
  isFollowerOpen,
  // Quest Board panel
  showQuestBoard: (ctx) => {
    const u = U(ctx);
    let wasOpen = false;
    try { if (u && typeof u.isQuestBoardOpen === "function") wasOpen = !!u.isQuestBoardOpen(); } catch (_) {}
    if (u && typeof u.showQuestBoard === "function") {
      u.showQuestBoard(ctx);
      if (!wasOpen) requestDraw(ctx);
    }
  },
  hideQuestBoard: (ctx) => {
    const u = U(ctx);
    let wasOpen = false;
    try { if (u && typeof u.isQuestBoardOpen === "function") wasOpen = !!u.isQuestBoardOpen(); } catch (_) {}
    if (u && typeof u.hideQuestBoard === "function") {
      u.hideQuestBoard(ctx);
      if (wasOpen) requestDraw(ctx);
    }
  },
  isQuestBoardOpen: (ctx) => {
    const u = U(ctx);
    try { if (u && typeof u.isQuestBoardOpen === "function") return !!u.isQuestBoardOpen(); } catch (_) {}
    return false;
  },
  // Lockpicking modal
  showLockpick: (ctx, opts) => {
    const u = U(ctx);
    let wasOpen = false;
    try { if (u && typeof u.isLockpickOpen === "function") wasOpen = !!u.isLockpickOpen(); } catch (_) {}
    if (u && typeof u.showLockpick === "function") {
      u.showLockpick(ctx, opts || {});
      if (!wasOpen) requestDraw(ctx);
    }
  },
  hideLockpick: (ctx) => {
    const u = U(ctx);
    let wasOpen = false;
    try { if (u && typeof u.isLockpickOpen === "function") wasOpen = !!u.isLockpickOpen(); } catch (_) {}
    if (u && typeof u.hideLockpick === "function") {
      u.hideLockpick(ctx);
      if (wasOpen) requestDraw(ctx);
    }
  },
  isLockpickOpen: (ctx) => {
    const u = U(ctx);
    try { if (u && typeof u.isLockpickOpen === "function") return !!u.isLockpickOpen(); } catch (_) {}
    return false;
  }
});