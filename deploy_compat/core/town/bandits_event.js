import { getMod } from "../../utils/access.js";
import { isFreeTownFloor } from "./runtime.js";

/**
 * Spawn a bandit group just inside the town gate and mark a lightweight town combat event.
 * Guards will be steered towards bandits by TownAI; bandits may attack guards and other NPCs.
 * Extracted from TownRuntime.startBanditsAtGateEvent; behaviour unchanged.
 */
export function startBanditsAtGateEvent(ctx) {
  if (!ctx || ctx.mode !== "town") {
    if (ctx && ctx.log) ctx.log("Bandits at the gate event requires town mode.", "warn");
    return false;
  }
  try {
    // Ensure we have a gate anchor; older saved towns may not have townExitAt persisted.
    let gate = ctx.townExitAt;
    const map = ctx.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;

    if (!gate || typeof gate.x !== "number" || typeof gate.y !== "number") {
      const T = ctx.TILES || {};
      let gx = null;
      let gy = null;

      // Try to infer gate from a perimeter DOOR and pick the adjacent interior floor tile.
      if (rows && cols && T.DOOR != null) {
        // Top row
        for (let x = 0; x < cols && gx == null; x++) {
          if (map[0][x] === T.DOOR && rows > 1) { gx = x; gy = 1; }
        }
        // Bottom row
        if (gx == null) {
          for (let x = 0; x < cols && gx == null; x++) {
            if (map[rows - 1][x] === T.DOOR && rows > 1) { gx = x; gy = rows - 2; }
          }
        }
        // Left column
        if (gx == null) {
          for (let y = 0; y < rows && gx == null; y++) {
            if (map[y][0] === T.DOOR && cols > 1) { gx = 1; gy = y; }
          }
        }
        // Right column
        if (gx == null) {
          for (let y = 0; y < rows && gx == null; y++) {
            if (map[y][cols - 1] === T.DOOR && cols > 1) { gx = cols - 2; gy = y; }
          }
        }
      }

      if (gx != null && gy != null) {
        gate = { x: gx, y: gy };
        ctx.townExitAt = gate;
        try {
          ctx.log && ctx.log(
            `[TownRuntime] BanditsAtGate: reconstructed missing townExitAt at (${gate.x},${gate.y}).`,
            "info"
          );
        } catch (_) {}
      } else {
        // Final fallback: treat the player's current tile as the "gate" anchor so the event still works.
        gate = { x: ctx.player.x | 0, y: ctx.player.y | 0 };
        ctx.townExitAt = gate;
        try {
          ctx.log && ctx.log(
            "[TownRuntime] BanditsAtGate: could not find a gate; using player position as gate anchor.",
            "warn"
          );
        } catch (_) {}
      }
    }

    const maxBandits = 10;
    const minBandits = 5;
    const rng = typeof ctx.rng === "function" ? ctx.rng : (() => 0.5);
    const count = Math.max(
      minBandits,
      Math.min(maxBandits, Math.floor(minBandits + rng() * (maxBandits - minBandits + 1)))
    );
    try {
      ctx.log &&
        ctx.log(
          `[TownRuntime] BanditsAtGate: gate at (${gate.x},${gate.y}), planning to spawn ${count} bandits.`,
          "info"
        );
    } catch (_) {}

    const spots = [];
    const radiusX = 4;
    const radiusY = 3;
    for (let dy = -radiusY; dy <= radiusY; dy++) {
      for (let dx = -radiusX; dx <= radiusX; dx++) {
        const x = gate.x + dx;
        const y = gate.y + dy;
        if (x < 1 || y < 1 || y >= rows - 1 || x >= cols - 1) continue;
        if (!isFreeTownFloor(ctx, x, y)) continue;
        // Prefer tiles just inside the gate (same row or slightly inward)
        const inwardBias = dy >= 0 ? 0 : Math.abs(dy);
        spots.push({ x, y, score: Math.abs(dx) + inwardBias });
      }
    }
    if (!spots.length) {
      ctx.log &&
        ctx.log(
          "[TownRuntime] BanditsAtGate: no free space near the gate to spawn bandits.",
          "warn"
        );
      return false;
    }
    spots.sort((a, b) => a.score - b.score);
    try {
      ctx.log &&
        ctx.log(
          `[TownRuntime] BanditsAtGate: found ${spots.length} candidate tiles for spawns.`,
          "info"
        );
    } catch (_) {}

    const bandits = [];
    const used = new Set();
    const playerLevel =
      ctx.player && typeof ctx.player.level === "number" ? ctx.player.level : 1;

    function takeSpot() {
      for (let i = 0; i < spots.length; i++) {
        const k = spots[i].x + "," + spots[i].y;
        if (!used.has(k)) {
          used.add(k);
          return { x: spots[i].x, y: spots[i].y };
        }
      }
      return null;
    }

    ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    // Spawn bandits
    for (let i = 0; i < count; i++) {
      const pos = takeSpot();
      if (!pos) break;
      const hp = 18 + Math.floor(rng() * 8); // 18-25 hp
      const name = i === 0 ? "Bandit captain" : "Bandit";
      const lines =
        i === 0
          ? ["Take what you can!", "No one passes this gate!"]
          : ["Grab the loot!", "For the gang!"];
      const level = Math.max(1, playerLevel + (i === 0 ? 1 : 0));
      const atk = i === 0 ? 3 : 2;
      const b = {
        x: pos.x,
        y: pos.y,
        name,
        lines,
        isBandit: true,
        hostile: true,
        faction: "bandit",
        type: "bandit",
        level,
        atk,
        hp,
        maxHp: hp,
        _banditEvent: true,
      };
      ctx.npcs.push(b);
      bandits.push(b);
    }

    if (!bandits.length) {
      ctx.log &&
        ctx.log(
          "[TownRuntime] BanditsAtGate: failed to place any bandits near the gate.",
          "warn"
        );
      return false;
    }

    // Spawn a few town guards near the gate to respond to the attack.
    const guards = [];
    const guardCount = Math.max(2, Math.min(4, Math.floor(bandits.length / 2)));
    for (let i = 0; i < guardCount; i++) {
      const pos = takeSpot();
      if (!pos) break;
      const eliteChance = 0.3;
      const isEliteGuard = rng() < eliteChance;
      const guardType = isEliteGuard ? "guard_elite" : "guard";
      const name = isEliteGuard ? `Guard captain ${i + 1}` : `Guard ${i + 1}`;
      const baseHp = isEliteGuard ? 24 : 18;
      const hp = baseHp + Math.floor(rng() * 6); // small jitter
      const level = Math.max(1, playerLevel + (isEliteGuard ? 2 : 1));
      const atk = isEliteGuard ? 3 : 2;
      const g = {
        x: pos.x,
        y: pos.y,
        name,
        lines: [
          "To arms!",
          "Protect the townsfolk!",
          "Hold the gate!"
        ],
        isGuard: true,
        guard: true,
        guardType,
        type: guardType,
        level,
        faction: "guard",
        atk,
        hp,
        maxHp: hp,
        _guardPost: { x: pos.x, y: pos.y }
      };
      ctx.npcs.push(g);
      guards.push(g);
    }

    try {
      const TR = ctx.TownRuntime || (typeof window !== "undefined" ? window.TownRuntime : null);
      if (TR && typeof TR.rebuildOccupancy === "function") {
        TR.rebuildOccupancy(ctx);
      } else if (typeof getMod === "function") {
        try {
          const M = getMod(ctx, "TownRuntime");
          if (M && typeof M.rebuildOccupancy === "function") M.rebuildOccupancy(ctx);
        } catch (_) {}
      } else if (ctx.occupancy && typeof ctx.occupancy.rebuild === "function") {
        ctx.occupancy.rebuild(ctx);
      }
    } catch (_) {}

    const turn =
      ctx.time && typeof ctx.time.turnCounter === "number"
        ? ctx.time.turnCounter | 0
        : 0;
    ctx._townBanditEvent = {
      active: true,
      startedTurn: turn,
      totalBandits: bandits.length,
      guardsSpawned: guards.length,
    };
    try {
      ctx.log &&
        ctx.log(
          `[TownRuntime] BanditsAtGate: spawned ${bandits.length} bandits and ${guards.length} guard(s) near gate at (${gate.x},${gate.y}).`,
          "info"
        );
    } catch (_) {}
    ctx.log &&
      ctx.log(
        "Bandits rush the town gate! Guards shout and civilians scramble for safety.",
        "notice"
      );
    return true;
  } catch (e) {
    try {
      console.error(e);
    } catch (_) {}
    if (ctx && ctx.log) ctx.log("Failed to start Bandits at the Gate event.", "warn");
    return false;
  }
}