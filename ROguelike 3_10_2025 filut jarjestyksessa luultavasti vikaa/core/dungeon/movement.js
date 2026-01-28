/**
 * Dungeon movement and combat (Phase 3 extraction): tryMoveDungeon.
 */
import { getMod } from "../../utils/access.js";
import { maybeEnterMountainPass } from "./transitions.js";

export function tryMoveDungeon(ctx, dx, dy) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter" && ctx.mode !== "sandbox")) return false;
  const advanceTurn = (ctx.mode === "dungeon" || ctx.mode === "sandbox"); // in encounter, the orchestrator advances the turn after syncing

  // Dazed: skip action if dazedTurns > 0
  try {
    if (ctx.player && ctx.player.dazedTurns && ctx.player.dazedTurns > 0) {
      ctx.player.dazedTurns -= 1;
      ctx.log && ctx.log("You are dazed and lose your action this turn.", "warn");
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  // Special: stepping on a mountain-pass portal (if present) transfers to a dungeon across the mountain
  try {
    if (maybeEnterMountainPass(ctx, nx, ny)) return true;
  } catch (_) {}

  // Is there an enemy at target tile?
  let enemy = null;
  try {
    const enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
    enemy = enemies.find(e => e && e.x === nx && e.y === ny) || null;
  } catch (_) { enemy = null; }

  if (enemy) {
    // Recruitable follower candidates: bump opens a hire prompt instead of attacking.
    try {
      if (enemy._recruitCandidate && enemy._recruitFollowerId) {
        const FR =
          ctx.FollowersRuntime ||
          getMod(ctx, "FollowersRuntime") ||
          (typeof window !== "undefined" ? window.FollowersRuntime : null);
        const UIO =
          ctx.UIOrchestration ||
          getMod(ctx, "UIOrchestration") ||
          (typeof window !== "undefined" ? window.UIOrchestration : null);

        if (FR && typeof FR.canHireFollower === "function" && typeof FR.hireFollowerFromArchetype === "function") {
          const archetypeId = String(enemy._recruitFollowerId || "");
          if (archetypeId) {
            const check = FR.canHireFollower(ctx, archetypeId);
            if (!check.ok) {
              try {
                if (ctx.log && check.reason) ctx.log(check.reason, "info");
              } catch (_) {}
              return true;
            }

            // Try to resolve a friendly label from follower definitions.
            let label = "Follower";
            try {
              if (typeof FR.getFollowerArchetypes === "function") {
                const defs = FR.getFollowerArchetypes(ctx) || [];
                for (let i = 0; i < defs.length; i++) {
                  const d = defs[i];
                  if (!d || !d.id) continue;
                  if (String(d.id) === archetypeId) {
                    label = d.name || label;
                    break;
                  }
                }
              }
            } catch (_) {}

            const prompt = `${label} offers to travel with you as a follower. Accept?`;
            const onOk = () => {
              try {
                const ok = FR.hireFollowerFromArchetype(ctx, archetypeId);
                if (ok) {
                  // Prevent recruiting the same captive/guard multiple times by
                  // disabling the recruit flag on this specific ally actor.
                  try {
                    enemy._recruitCandidate = false;
                    enemy._recruitFollowerId = null;
                  } catch (_) {}
                  if (ctx.log) {
                    ctx.log("They will accompany you after this fight.", "info");
                  }
                } else if (ctx.log) {
                  ctx.log("They cannot join you right now.", "info");
                }
              } catch (_) {}
            };
            const onCancel = () => {
              try {
                if (ctx.log) ctx.log("You decide to travel alone for now.", "info");
              } catch (_) {}
            };

            if (UIO && typeof UIO.showConfirm === "function") {
              UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
            } else {
              onOk();
            }
            // Hiring (or declining) does not consume a combat turn beyond this bump.
            return true;
          }
        }
      }
    } catch (_) {}

    // Followers: bump-to-inspect instead of attacking.
    try {
      if (enemy._isFollower) {
        const UIO = ctx.UIOrchestration || getMod(ctx, "UIOrchestration") || (typeof window !== "undefined" ? window.UIOrchestration : null);
        if (UIO && typeof UIO.showFollower === "function") {
          UIO.showFollower(ctx, enemy);
        }
        // Inspecting a follower does not consume a combat turn.
        return true;
      }
    } catch (_) {}

    // Use shared Combat.playerAttackEnemy so dungeon/encounter attacks go through the
    // unified combat pipeline (crit, bleed/limp, torch fire, GOD status effects, etc.).
    const C = (ctx && ctx.Combat) || (typeof window !== "undefined" ? window.Combat : null);
    if (C && typeof C.playerAttackEnemy === "function") {
      try { C.playerAttackEnemy(ctx, enemy); } catch (_) {}
    } else {
      // Hard error: combat fallback no longer supported.
      const msg = "ERROR: Combat.playerAttackEnemy missing; combat fallback path would be used.";
      try { ctx.log && ctx.log(msg, "bad"); } catch (_) {}
      try { console.error(msg); } catch (_) {}
    }
    if (advanceTurn && ctx.turn) ctx.turn();
    return true;
  }

  // Movement into empty tile
  try {
    const blockedByEnemy = Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === nx && e.y === ny);
    const walkable = ctx.inBounds(nx, ny) && (ctx.map[ny][nx] === ctx.TILES.FLOOR || ctx.map[ny][nx] === ctx.TILES.DOOR || ctx.map[ny][nx] === ctx.TILES.STAIRS);
    if (walkable && !blockedByEnemy) {
      ctx.player.x = nx; ctx.player.y = ny;
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
      if (advanceTurn && ctx.turn) ctx.turn();
      return true;
    }
  } catch (_) {}

  return false;
}