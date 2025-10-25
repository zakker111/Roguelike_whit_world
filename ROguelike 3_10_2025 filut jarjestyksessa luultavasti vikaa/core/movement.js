/**
 * Movement: ctx-first movement and action helpers extracted from core/game.js
 *
 * Exports (ESM + window.Movement):
 * - tryMove(ctx, dx, dy)
 * - descendIfPossible(ctx)
 * - brace(ctx)
 * - fastForwardMinutes(ctx, minutes)
 */

function mod(name) {
  try {
    const w = (typeof window !== "undefined") ? window : {};
    return w[name] || null;
  } catch (_) { return null; }
}

function applyRefresh(ctx) {
  try {
    const SS = mod("StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
      return;
    }
  } catch (_) {}
  try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
  try { if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV(); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
  try { if (typeof ctx.requestDraw === "function") ctx.requestDraw(); } catch (_) {}
}

export function fastForwardMinutes(ctx, mins) {
  const total = Math.max(0, (Number(mins) || 0) | 0);
  if (total <= 0) return 0;
  const mpTurn = (ctx && ctx.time && typeof ctx.time.minutesPerTurn === "number")
    ? ctx.time.minutesPerTurn
    : 4; // fallback
  const turns = Math.max(1, Math.ceil(total / mpTurn));
  for (let i = 0; i < turns; i++) {
    try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) { break; }
  }
  try { if (typeof ctx.recomputeFOV === "function") ctx.recomputeFOV(); } catch (_) {}
  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
  return turns;
}

export function brace(ctx) {
  if (!ctx || !ctx.player) return;
  if (ctx.mode !== "dungeon") {
    try { ctx.log && ctx.log("You can brace only in the dungeon.", "info"); } catch (_) {}
    try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
    return;
  }
  const eq = ctx.player.equipment || {};
  const hasDefHand = !!((eq.left && typeof eq.left.def === "number" && eq.left.def > 0) || (eq.right && typeof eq.right.def === "number" && eq.right.def > 0));
  if (!hasDefHand) {
    try { ctx.log && ctx.log("You raise your arms, but without a defensive hand item bracing is ineffective.", "warn"); } catch (_) {}
    try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
    return;
  }
  ctx.player.braceTurns = 1;
  try { ctx.log && ctx.log("You brace behind your shield. Your block is increased this turn.", "notice"); } catch (_) {}
  try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
}

export function descendIfPossible(ctx) {
  // Prefer Actions.descend when available
  try {
    const A = mod("Actions");
    if (A && typeof A.descend === "function") {
      const handled = !!A.descend(ctx);
      if (handled) return true;
    }
  } catch (_) {}
  if (ctx.mode === "world" || ctx.mode === "town") {
    try { if (typeof ctx.doAction === "function") ctx.doAction(); } catch (_) {}
    return true;
  }
  if (ctx.mode === "dungeon") {
    try {
      const MZ = mod("Messages");
      if (MZ && typeof MZ.log === "function") {
        MZ.log(ctx, "dungeon.noDeeper");
      } else {
        ctx.log && ctx.log("This dungeon has no deeper levels. Return to the entrance (the hole '>') and press G to leave.", "info");
      }
    } catch (_) {}
    return true;
  }
  const here = ctx.map[ctx.player.y][ctx.player.x];
  if (here === ctx.TILES.STAIRS) {
    try {
      const MZ = mod("Messages");
      if (MZ && typeof MZ.log === "function") {
        MZ.log(ctx, "dungeon.noDescendHere");
      } else {
        ctx.log && ctx.log("There is nowhere to go down from here.", "info");
      }
    } catch (_) {}
  } else {
    try {
      const MZ = mod("Messages");
      if (MZ && typeof MZ.log === "function") {
        MZ.log(ctx, "dungeon.needStairs");
      } else {
        ctx.log && ctx.log("You need to stand on the staircase (brown tile marked with '>').", "info");
      }
    } catch (_) {}
  }
  return true;
}

export function tryMove(ctx, dx, dy) {
  if (!ctx || !ctx.player) return;

  // REGION MAP: move cursor only
  if (ctx.mode === "region") {
    try {
      const RM = mod("RegionMapRuntime");
      if (RM && typeof RM.tryMove === "function") {
        const ok = !!RM.tryMove(ctx, dx, dy);
        if (ok) return true;
      }
    } catch (_) {}
    return false;
  }

  // WORLD MODE
  if (ctx.mode === "world") {
    try {
      const WR = mod("WorldRuntime");
      if (WR && typeof WR.tryMovePlayerWorld === "function") {
        const ok = !!WR.tryMovePlayerWorld(ctx, dx, dy);
        if (ok) return true;
      }
    } catch (_) {}
    const nx = ctx.player.x + dx;
    const ny = ctx.player.y + dy;
    const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
    if (!wmap) return false;
    const rows = wmap.length, cols = rows ? (wmap[0] ? wmap[0].length : 0) : 0;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    const W = mod("World");
    const walkable = (W && typeof W.isWalkable === "function") ? !!W.isWalkable(wmap[ny][nx]) : true;
    if (!walkable) return false;
    ctx.player.x = nx; ctx.player.y = ny;
    applyRefresh(ctx);

    // Maybe trigger encounter
    try {
      const ES = mod("EncounterService");
      if (ES && typeof ES.maybeTryEncounter === "function") {
        ES.maybeTryEncounter(ctx);
      }
    } catch (_) {}
    try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
    return true;
  }

  // ENCOUNTER MODE
  if (ctx.mode === "encounter") {
    try {
      const DR = mod("DungeonRuntime");
      if (DR && typeof DR.tryMoveDungeon === "function") {
        const acted = !!DR.tryMoveDungeon(ctx, dx, dy);
        if (acted) {
          applyRefresh(ctx);
          // If stepped on merchant, open shop
          try {
            const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : [];
            const onMerchant = props.find(pr => pr && pr.type === "merchant" && pr.x === ctx.player.x && pr.y === ctx.player.y);
            if (onMerchant) {
              const UB = mod("UIBridge");
              if (UB && typeof UB.showShop === "function") {
                const already = (typeof UB.isShopOpen === "function") ? !!UB.isShopOpen() : false;
                if (!already) UB.showShop(ctx, { name: onMerchant.name || "Merchant", vendor: onMerchant.vendor || "merchant" });
              }
            }
          } catch (_) {}
          try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
          return true;
        }
      }
    } catch (_) {}
    const nx = ctx.player.x + dx;
    const ny = ctx.player.y + dy;
    if (!ctx.inBounds(nx, ny)) return false;
    const blockedByEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function")
      ? ctx.occupancy.hasEnemy(nx, ny)
      : (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny));
    if (ctx.isWalkable(nx, ny) && !blockedByEnemy) {
      ctx.player.x = nx; ctx.player.y = ny;
      try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
      try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
      return true;
    }
    return false;
  }

  // TOWN MODE
  if (ctx.mode === "town") {
    try {
      const TR = mod("TownRuntime");
      if (TR && typeof TR.tryMoveTown === "function") {
        const ok = !!TR.tryMoveTown(ctx, dx, dy);
        if (ok) return true;
      }
    } catch (_) {}
    const nx = ctx.player.x + dx;
    const ny = ctx.player.y + dy;
    if (!ctx.inBounds(nx, ny)) return false;
    const npcBlocked = (ctx.occupancy && typeof ctx.occupancy.hasNPC === "function")
      ? ctx.occupancy.hasNPC(nx, ny)
      : (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === nx && n.y === ny));
    if (npcBlocked) {
      try {
        const TR2 = mod("TownRuntime");
        if (TR2 && typeof TR2.talk === "function") TR2.talk(ctx, nx, ny);
        else ctx.log && ctx.log("Excuse me!", "info");
      } catch (_) {}
      return true;
    }
    if (ctx.isWalkable(nx, ny)) {
      ctx.player.x = nx; ctx.player.y = ny;
      try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
      try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
      return true;
    }
    return false;
  }

  // DUNGEON MODE
  try {
    const DR = mod("DungeonRuntime");
    if (DR && typeof DR.tryMoveDungeon === "function") {
      const ok = !!DR.tryMoveDungeon(ctx, dx, dy);
      if (ok) return true;
    }
  } catch (_) {}
  const nx = ctx.player.x + dx;
  const ny = ctx.player.y + dy;
  if (!ctx.inBounds(nx, ny)) return false;
  const blockedByEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function")
    ? ctx.occupancy.hasEnemy(nx, ny)
    : (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny));
  if (ctx.isWalkable(nx, ny) && !blockedByEnemy) {
    ctx.player.x = nx; ctx.player.y = ny;
    try { if (typeof ctx.updateCamera === "function") ctx.updateCamera(); } catch (_) {}
    try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
    return true;
  }
  return false;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Movement", { tryMove, descendIfPossible, brace, fastForwardMinutes });