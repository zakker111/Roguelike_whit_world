/**
 * Movement: ctx-first movement and action helpers extracted from core/game.js
 *
 * Exports (ESM + window.Movement):
 * - tryMove(ctx, dx, dy)
 * - descendIfPossible(ctx)
 * - brace(ctx)
 * - fastForwardMinutes(ctx, minutes)
 *
 * Notes:
 * - brace(ctx) applies only in dungeon mode and is effective when the player has a defensive hand item; it increases block chance for this turn.
 */

import { getMod } from "../utils/access.js";

function mod(name) {
  try {
    const w = (typeof window !== "undefined") ? window : {};
    return w[name] || null;
  } catch (_) { return null; }
}

function applyRefresh(ctx) {
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync") || mod("StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
}

// DEV-gated movement trace (enable with window.DEV or localStorage LOG_TRACE_MOVEMENT=1)
function _mvTraceEnabled() {
  try {
    if (typeof window !== "undefined" && window.DEV) return true;
    const v = (typeof localStorage !== "undefined") ? localStorage.getItem("LOG_TRACE_MOVEMENT") : null;
    return String(v).toLowerCase() === "1";
  } catch (_) { return false; }
}
function _mvLog(ctx, msg, details) {
  try {
    if (!_mvTraceEnabled()) return;
    if (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function") {
      window.Logger.log(`[Movement] ${msg}`, "info", Object.assign({ category: "Movement", mode: ctx && ctx.mode }, details || {}));
    }
  } catch (_) {}
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
        if (ok) { applyRefresh(ctx); return true; }
      }
    } catch (_) {}
    const nx = ctx.player.x + dx;
    const ny = ctx.player.y + dy;
    const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
    if (!wmap) { _mvLog(ctx, "blocked: no world map", {}); return false; }
    const rows = wmap.length, cols = rows ? (wmap[0] ? wmap[0].length : 0) : 0;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { _mvLog(ctx, "blocked: out of bounds", { nx, ny, cols, rows }); return false; }
    const W = mod("World");
    const walkable = (W && typeof W.isWalkable === "function") ? !!W.isWalkable(wmap[ny][nx]) : true;
    if (!walkable) { try { const tHere = (ctx.world && ctx.world.map && ctx.world.map[ny] && ctx.world.map[ny][nx]); _mvLog(ctx, "blocked: not walkable", { nx, ny, tile: tHere }); } catch (_) {} return false; }
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
    const nx = ctx.player.x + dx;
    const ny = ctx.player.y + dy;

    // If bumping into the caravan master (caravan merchant prop), open the escort dialog instead of attacking.
    try {
      const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : [];
      if (props.length) {
        const p = props.find(pr =>
          pr &&
          pr.x === nx &&
          pr.y === ny &&
          String(pr.type || "").toLowerCase() === "merchant" &&
          String(pr.vendor || "").toLowerCase() === "caravan"
        );
        if (p) {
          // Step onto the Caravan master tile
          ctx.player.x = nx;
          ctx.player.y = ny;
          applyRefresh(ctx);

          // Show escort continue/stop dialog directly via UIOrchestration
          try {
            const UIO = mod("UIOrchestration");
            const world = ctx.world || null;
            const esc = world && world.caravanEscort;
            const stillActive = !!(esc && esc.active);
            const prompt = stillActive
              ? "Caravan master: \"Do you want to continue guarding the caravan?\""
              : "Caravan master: \"Thank you for your help. Do you want to resume your journey with us?\"";

            const onOk = () => {
              try {
                if (world) {
                  world.caravanEscort = world.caravanEscort || { id: null, reward: 0, active: false };
                  world.caravanEscort.active = true;
                }
                if (ctx.log) ctx.log("You agree to continue guarding the caravan.", "notice");
                // If this is a caravan ambush encounter, immediately return to the overworld
                try {
                  const tplId = String(ctx.encounterInfo && ctx.encounterInfo.id || "").toLowerCase();
                  if (tplId === "caravan_ambush") {
                    const ER = ctx.EncounterRuntime || mod("EncounterRuntime");
                    if (ER && typeof ER.complete === "function") {
                      ER.complete(ctx, "victory");
                    }
                  }
                } catch (_) {}
              } catch (_) {}
            };
            const onCancel = () => {
              try {
                if (world && world.caravanEscort) {
                  world.caravanEscort.active = false;
                }
                if (ctx.log) ctx.log("You decide to stop guarding the caravan.", "info");
              } catch (_) {}
            };

            if (UIO && typeof UIO.showConfirm === "function") {
              UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
            } else {
              // Fallback: just toggle escort state and complete immediately without a dialog
              onOk();
            }
          } catch (_) {}

          // Do not consume a turn here; the confirm result decides next steps (including leaving the encounter).
          return true;
        }
      }
    } catch (_) {}

    // If bumping a neutral guard (e.g., guards in a skirmish), ask for confirmation before attacking.
    try {
      let enemy = null;
      const enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
      enemy = enemies.find(e => e && e.x === nx && e.y === ny) || null;
      if (enemy) {
        const fac = String(enemy.faction || "").toLowerCase();
        const isGuard = fac === "guard" || String(enemy.type || "").toLowerCase() === "guard";
        const neutralGuard = isGuard && enemy._ignorePlayer;
        if (neutralGuard) {
          const UIO = mod("UIOrchestration");
          const C = mod("Combat");
          if (UIO && typeof UIO.showConfirm === "function" && C && typeof C.playerAttackEnemy === "function") {
            const text = "Do you want to attack the guard? This will make all guards hostile to you.";
            const enemyRef = enemy;
            // Pass null for position so the confirm dialog is centered on the game.
            UIO.showConfirm(ctx, text, null,
              () => {
                try {
                  C.playerAttackEnemy(ctx, enemyRef);
                  applyRefresh(ctx);
                  if (typeof ctx.turn === "function") ctx.turn();
                } catch (_) {}
              },
              () => {}
            );
            return true;
          }
        }
      }
    } catch (_) {}

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
              try {
                const UIO = mod("UIOrchestration");
                if (UIO && typeof UIO.showShop === "function") {
                  const already = (typeof UIO.isShopOpen === "function") ? !!UIO.isShopOpen(ctx) : false;
                  if (!already) UIO.showShop(ctx, { name: onMerchant.name || "Merchant", vendor: onMerchant.vendor || "merchant" });
                }
              } catch (_) {}
            }
          } catch (_) {}
          try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
          return true;
        }
      }
    } catch (_) {}
    if (!ctx.inBounds(nx, ny)) return false;
    const blockedByEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function")
      ? ctx.occupancy.hasEnemy(nx, ny)
      : (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny));
    if (ctx.isWalkable(nx, ny) && !blockedByEnemy) {
      ctx.player.x = nx; ctx.player.y = ny;
      applyRefresh(ctx);
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
        if (ok) { applyRefresh(ctx); return true; }
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
      applyRefresh(ctx);
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
    applyRefresh(ctx);
    try { if (typeof ctx.turn === "function") ctx.turn(); } catch (_) {}
    return true;
  }
  return false;
}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Movement", { tryMove, descendIfPossible, brace, fastForwardMinutes });