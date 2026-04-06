/**
 * Dungeon state helpers (Phase 2): key derivation and persistence.
 * Extracted from core/dungeon_runtime.js with no behavior changes.
 */
import { getMod } from "../../utils/access.js";

export function keyFromWorldPos(x, y) {
  // Use a stable string key; avoid coupling to external state modules
  return `${x},${y}`;
}

export function save(ctx, logOnce = false) {
  if (!ctx || ctx.isSandbox) return;
  if (ctx.DungeonState && typeof ctx.DungeonState.save === "function") {
    ctx.DungeonState.save(ctx);
    return;
  }
  if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.save === "function") {
    window.DungeonState.save(ctx);
    return;
  }
  if (ctx.mode !== "dungeon" || !ctx.dungeonInfo || !ctx.dungeonExitAt) return;
  const key = keyFromWorldPos(ctx.dungeonInfo.x, ctx.dungeonInfo.y);
  const enemies = Array.isArray(ctx.enemies)
    ? ctx.enemies.filter(e => !e || !e._isFollower)
    : ctx.enemies;
  ctx._dungeonStates[key] = {
    map: ctx.map,
    seen: ctx.seen,
    visible: ctx.visible,
    enemies,
    corpses: ctx.corpses,
    decals: ctx.decals,
    dungeonProps: Array.isArray(ctx.dungeonProps) ? ctx.dungeonProps.slice(0) : [],
    dungeonExitAt: { x: ctx.dungeonExitAt.x, y: ctx.dungeonExitAt.y },
    info: ctx.dungeonInfo,
    level: ctx.floor
  };
  if (logOnce && ctx.log) {
    try {
      const totalEnemies = Array.isArray(ctx.enemies) ? ctx.enemies.length : 0;
      const typeCounts = (() => {
        try {
          if (!Array.isArray(ctx.enemies) || ctx.enemies.length === 0) return "";
          const mapCounts = {};
          for (const e of ctx.enemies) {
            const t = (e && e.type) ? String(e.type) : "(unknown)";
            mapCounts[t] = (mapCounts[t] || 0) + 1;
          }
          const parts = Object.keys(mapCounts).sort().map(k => `${k}:${mapCounts[k]}`);
          return parts.join(", ");
        } catch (_) { return ""; }
      })();
      const msg = `Dungeon snapshot: enemies=${totalEnemies}${typeCounts ? ` [${typeCounts}]` : ""}, corpses=${Array.isArray(ctx.corpses)?ctx.corpses.length:0}`;
      ctx.log(msg, "notice");
    } catch (_) {}
  }
}

export function load(ctx, x, y) {
  if (ctx.DungeonState && typeof ctx.DungeonState.load === "function") {
    const ok = ctx.DungeonState.load(ctx, x, y);
    if (ok) {
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
    }
    return ok;
  }
  if (typeof window !== "undefined" && window.DungeonState && typeof window.DungeonState.load === "function") {
    const ok = window.DungeonState.load(ctx, x, y);
    if (ok) {
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
    }
    return ok;
  }
  const key = keyFromWorldPos(x, y);
  const st = ctx._dungeonStates[key];
  if (!st) return false;

  ctx.mode = "dungeon";
  ctx.dungeonInfo = st.info || { x, y, level: st.level || 1, size: "medium" };
  ctx.floor = st.level || 1;

  ctx.map = st.map;
  ctx.seen = st.seen;
  ctx.visible = st.visible;
  ctx.enemies = st.enemies;
  ctx.corpses = st.corpses;
  ctx.decals = st.decals || [];
  ctx.dungeonProps = Array.isArray(st.dungeonProps) ? st.dungeonProps : [];
  ctx.dungeonExitAt = st.dungeonExitAt || { x, y };

  // Place player at the entrance hole
  ctx.player.x = ctx.dungeonExitAt.x;
  ctx.player.y = ctx.dungeonExitAt.y;

  // Ensure the entrance tile is marked as stairs
  if (ctx.inBounds(ctx.dungeonExitAt.x, ctx.dungeonExitAt.y)) {
    ctx.map[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = ctx.TILES.STAIRS;
    try {
      const F = ctx.Fog || (typeof window !== "undefined" ? window.Fog : null);
      if (F && typeof F.fogSet === "function") {
        F.fogSet(ctx.visible, ctx.dungeonExitAt.x, ctx.dungeonExitAt.y, true);
        F.fogSet(ctx.seen, ctx.dungeonExitAt.x, ctx.dungeonExitAt.y, true);
      } else {
        if (ctx.visible[ctx.dungeonExitAt.y]) ctx.visible[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
        if (ctx.seen[ctx.dungeonExitAt.y]) ctx.seen[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
      }
    } catch (_) {
      if (ctx.visible[ctx.dungeonExitAt.y]) ctx.visible[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
      if (ctx.seen[ctx.dungeonExitAt.y]) ctx.seen[ctx.dungeonExitAt.y][ctx.dungeonExitAt.x] = true;
    }
  }

  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  return true;
}