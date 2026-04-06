import { getMod } from "../../utils/access.js";
import { isFreeTownFloor } from "./runtime.js";

/**
 * Handle Wild Seppo (travelling merchant) arrival and departure in town.
 * Extracted from the first part of TownRuntime.tick; behaviour unchanged.
 */
export function tickSeppo(ctx) {
  if (!ctx || ctx.mode !== "town") return;

  try {
    const t = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    const phase = (ctx.time && ctx.time.phase) || "day";
    ctx._seppo = ctx._seppo || { active: false, despawnTurn: 0, cooldownUntil: 0 };

    // If active but entities missing (e.g., after re-enter), reset state
    if (ctx._seppo.active) {
      const hasNPC = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && (n.isSeppo || n.seppo));
      const hasShop = Array.isArray(ctx.shops) && ctx.shops.some(s => s && (s.type === "seppo"));
      if (!hasNPC || !hasShop) {
        ctx._seppo.active = false;
        ctx._seppo.despawnTurn = 0;
      }
    }

    // If entities indicate Seppo is present but flag is false (e.g., restored from persistence), mark active
    if (!ctx._seppo.active) {
      const hasNPC = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && (n.isSeppo || n.seppo));
      const hasShop = Array.isArray(ctx.shops) && ctx.shops.some(s => s && (s.type === "seppo"));
      if (hasNPC || hasShop) {
        ctx._seppo.active = true;
      }
    }

    // Spawn conditions
    const alreadyPresent = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && (n.isSeppo || n.seppo));
    const canSpawn =
      !ctx._seppo.active &&
      !alreadyPresent &&
      t >= (ctx._seppo.cooldownUntil | 0) &&
      (phase === "day" || phase === "dusk");

    if (canSpawn) {
      // Chance per town tick (increased slightly to be observable)
      const rfn = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function")
        ? window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));
      if (rfn() < 0.01) { // ~1% per tick while conditions hold
        // Find a free spot near the plaza (or gate as fallback)
        const within = 5;
        let best = null;
        for (let i = 0; i < 200; i++) {
          const rfn2 = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function")
            ? window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
            : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));
          const ox = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.int === "function")
            ? window.RNGUtils.int(-within, within, rfn2)
            : ((Math.floor(rfn2() * (within * 2 + 1))) - within) | 0;
          const oy = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.int === "function")
            ? window.RNGUtils.int(-within, within, rfn2)
            : ((Math.floor(rfn2() * (within * 2 + 1))) - within) | 0;
          const px = Math.max(1, Math.min((ctx.map[0]?.length || 2) - 2, (ctx.townPlaza?.x | 0) + ox));
          const py = Math.max(1, Math.min((ctx.map.length || 2) - 2, (ctx.townPlaza?.y | 0) + oy));

          const free = (typeof isFreeTownFloor === "function")
            ? isFreeTownFloor(ctx, px, py)
            : (typeof ctx.isFreeTownFloor === "function")
              ? ctx.isFreeTownFloor(ctx, px, py)
              : (function () {
                  const tTile = ctx.map[py][px];
                  if (tTile !== ctx.TILES.FLOOR && tTile !== ctx.TILES.DOOR) return false;
                  if (ctx.player.x === px && ctx.player.y === py) return false;
                  if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === px && n.y === py)) return false;
                  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === px && p.y === py)) return false;
                  return true;
                })();

          if (free) { best = { x: px, y: py }; break; }
        }

        if (!best && ctx.townExitAt) {
          const cand = [
            { x: ctx.townExitAt.x + 1, y: ctx.townExitAt.y },
            { x: ctx.townExitAt.x - 1, y: ctx.townExitAt.y },
            { x: ctx.townExitAt.x, y: ctx.townExitAt.y + 1 },
            { x: ctx.townExitAt.x, y: ctx.townExitAt.y - 1 }
          ];
          for (const c of cand) {
            if (c.x > 0 && c.y > 0 && c.y < ctx.map.length - 1 && c.x < (ctx.map[0]?.length || 2) - 1) {
              if ((ctx.map[c.y][c.x] === ctx.TILES.FLOOR || ctx.map[c.y][c.x] === ctx.TILES.DOOR) &&
                  !(ctx.player.x === c.x && ctx.player.y === c.y) &&
                  !(Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === c.x && n.y === c.y)) &&
                  !(Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === c.x && p.y === c.y))) {
                best = { x: c.x, y: c.y }; break;
              }
            }
          }
        }

        if (best) {
          const npc = {
            x: best.x, y: best.y,
            name: "Wild Seppo",
            lines: ["Rare goods, fair prices.", "Only for a short while!"],
            isShopkeeper: true,
            isSeppo: true,
            seppo: true
          };

          const shop = {
            x: best.x, y: best.y,
            type: "seppo",
            name: "Wild Seppo",
            alwaysOpen: true,
            openMin: 0, closeMin: 0,
            building: null,
            inside: { x: best.x, y: best.y }
          };

          npc._shopRef = shop;

          (ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : []).push(npc);
          (ctx.shops = Array.isArray(ctx.shops) ? ctx.shops : []).push(shop);

          const minutesPerTurn = (ctx.time && typeof ctx.time.minutesPerTurn === "number") ? ctx.time.minutesPerTurn : (24 * 60) / 360;
          const turns2h = Math.max(1, Math.round(120 / minutesPerTurn));
          const turns8h = Math.max(1, Math.round(480 / minutesPerTurn));
          ctx._seppo.active = true;
          ctx._seppo.despawnTurn = t + turns2h;
          ctx._seppo.cooldownUntil = t + turns8h;

          try { ctx.log && ctx.log("A rare wanderer, Wild Seppo, arrives at the plaza!", "notice"); } catch (_) {}
          try {
            const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
            if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
          } catch (_) {}
        }
      }
    }

    // Despawn conditions
    if (ctx._seppo.active) {
      const timeUp = t >= (ctx._seppo.despawnTurn | 0);
      const nightNow = phase === "night";
      if (timeUp || nightNow) {
        try {
          if (Array.isArray(ctx.npcs)) {
            const idx = ctx.npcs.findIndex(n => n && (n.isSeppo || n.seppo));
            if (idx !== -1) ctx.npcs.splice(idx, 1);
          }
        } catch (_) {}
        try {
          if (Array.isArray(ctx.shops)) {
            for (let i = ctx.shops.length - 1; i >= 0; i--) {
              const s = ctx.shops[i];
              if (s && s.type === "seppo") ctx.shops.splice(i, 1);
            }
          }
        } catch (_) {}
        ctx._seppo.active = false;
        ctx._seppo.despawnTurn = 0;
        try { ctx.log && ctx.log("Wild Seppo packs up and leaves.", "info"); } catch (_) {}
        try {
          const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
          if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
        } catch (_) {}
      }
    }
  } catch (_) {}
}