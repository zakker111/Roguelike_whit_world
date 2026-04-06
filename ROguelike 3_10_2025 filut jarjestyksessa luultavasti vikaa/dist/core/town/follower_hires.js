import { getMod } from "../../utils/access.js";
import { isFreeTownFloor } from "./runtime.js";

// Spawn a recruitable follower NPC inside the inn (tavern) when available.
// Uses FollowersRuntime to pick a follower archetype and marks the NPC as a
// hire candidate so bumping them opens the hire prompt. Offers are gated by
// follower caps, tavern presence, and a separate rarity roll performed by
// callers (TownRuntime.generate and TownState.load).
export function spawnInnFollowerHires(ctx) {
  try {
    if (!ctx || ctx.mode !== "town") return;
    if (!ctx.tavern || !ctx.tavern.building) return;

    const FR =
      ctx.FollowersRuntime ||
      getMod(ctx, "FollowersRuntime") ||
      (typeof window !== "undefined" ? window.FollowersRuntime : null);
    if (!FR || typeof FR.pickRandomFollowerArchetype !== "function" || typeof FR.canHireFollower !== "function") {
      return;
    }

    const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    // Avoid spawning multiple hire NPCs at once.
    const already = npcs.some(n => n && n._recruitCandidate && n._recruitFollowerId);
    if (already) return;

    // Respect global follower cap: if we cannot hire any archetype at all, skip.
    // Use a cheap check against one archetype later; here we just avoid work if
    // player already has as many followers as allowed.
    try {
      const p = ctx.player;
      if (p && Array.isArray(p.followers)) {
        // If length equals or exceeds maxActive, canHireFollower will fail for any archetype.
        const caps = typeof FR.getFollowersCaps === "function" ? FR.getFollowersCaps(ctx) : null;
        const maxActive = caps && typeof caps.maxActive === "number" ? caps.maxActive | 0 : 3;
        if (p.followers.length >= maxActive) return;
      }
    } catch (_) {}

    // Caller has already applied a rarity gate. Here we only enforce caps and
    // tavern presence; no additional randomness.
    try {
      // No-op; kept as a hook for future per-town tuning if needed.
    } catch (_) {}

    // Pick a follower archetype that the player does not already have, if possible.
    const archetype = FR.pickRandomFollowerArchetype(ctx, { skipHired: true });
    if (!archetype || !archetype.id) return;

    // Double-check that this archetype can be hired under caps.
    const canCheck = FR.canHireFollower(ctx, archetype.id);
    if (!canCheck || !canCheck.ok) return;

    const b = ctx.tavern.building;
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (!rows || !cols) return;

    const T = ctx.TILES;
    let spot = null;
    for (let y = b.y + 1; y < b.y + b.h - 1 && !spot; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        const tile = ctx.map[y][x];
        if (tile !== T.FLOOR && tile !== T.DOOR) continue;
        if (!isFreeTownFloor(ctx, x, y)) continue;
        spot = { x, y };
        break;
      }
    }
    if (!spot) return;

    const baseName = typeof archetype.name === "string" ? archetype.name : "Follower";
    const trimmed = baseName.replace(/\s+Ally$/i, "");
    const npcName = trimmed ? `${trimmed} for hire` : "Follower for hire";

    const lines = [
      "Looking for work.",
      "I can handle myself in a fight.",
      "Need another blade at your side?"
    ];

    const npc = {
      x: spot.x,
      y: spot.y,
      name: npcName,
      lines,
      roles: ["follower_hire"],
      _recruitCandidate: true,
      _recruitFollowerId: String(archetype.id)
    };

    ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    ctx.npcs.push(npc);

    try {
      if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
        ctx.occupancy.setNPC(npc.x, npc.y);
      }
    } catch (_) {}

    // Light log so players know there is someone for hire in the inn.
    try {
      if (ctx.log) {
        ctx.log(`${npc.name} is staying at the inn and looking for work.`, "info");
      }
    } catch (_) {}
  } catch (_) {}
}