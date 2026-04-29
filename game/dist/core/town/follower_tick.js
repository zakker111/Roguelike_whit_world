import { isFreeTownFloor } from "./runtime.js";

/**
 * Simple follower NPC behavior in town:
 * - stay near the player unless set to wait
 * - uses same logic that previously lived in TownRuntime.tick
 */
export function tickTownFollowers(ctx) {
  try {
    const p = ctx.player;
    if (!p || !Array.isArray(ctx.npcs)) return;

    const followers = p && Array.isArray(p.followers) ? p.followers : null;
    for (const n of ctx.npcs) {
      if (!n || !n._isFollower) continue;

      // Resolve follower mode from the record (or NPC override) so town followers
      // can obey simple follow / wait commands.
      let mode = "follow";
      try {
        if (n._followerMode === "wait" || n._followerMode === "follow") {
          mode = n._followerMode;
        } else if (followers && n._followerId != null) {
          const rec = followers.find(f => f && f.id === n._followerId) || null;
          if (rec && (rec.mode === "wait" || rec.mode === "follow")) {
            mode = rec.mode;
          }
        }
      } catch (_) {}
      if (mode === "wait") continue;

      const dx = p.x - n.x;
      const dy = p.y - n.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      const followRange = 2;
      if (dist <= followRange) continue;

      const sx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
      const sy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
      const primary = Math.abs(dx) > Math.abs(dy)
        ? [{ x: sx, y: 0 }, { x: 0, y: sy }]
        : [{ x: 0, y: sy }, { x: sx, y: 0 }];

      let moved = false;
      for (const d of primary) {
        const nx = n.x + d.x;
        const ny = n.y + d.y;
        if (isFreeTownFloor(ctx, nx, ny)) {
          if (ctx.occupancy && typeof ctx.occupancy.clearNPC === "function") {
            ctx.occupancy.clearNPC(n.x, n.y);
          }
          n.x = nx;
          n.y = ny;
          if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
            ctx.occupancy.setNPC(n.x, n.y);
          }
          moved = true;
          break;
        }
      }
      if (!moved) {
        const ALT_DIRS = [
          { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
        ];
        for (const d of ALT_DIRS) {
          const nx = n.x + d.x;
          const ny = n.y + d.y;
          if (isFreeTownFloor(ctx, nx, ny)) {
            if (ctx.occupancy && typeof ctx.occupancy.clearNPC === "function") {
              ctx.occupancy.clearNPC(n.x, n.y);
            }
            n.x = nx;
            n.y = ny;
            if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
              ctx.occupancy.setNPC(n.x, n.y);
            }
            break;
          }
        }
      }
    }
  } catch (_) {}
}