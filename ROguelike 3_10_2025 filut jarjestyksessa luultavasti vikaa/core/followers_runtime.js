/**
 * FollowersRuntime: spawn and sync helpers for player followers / allies.
 *
 * Exports (ESM + window.FollowersRuntime):
 * - spawnInDungeon(ctx)
 * - spawnInTown(ctx)
 * - syncFollowersFromDungeon(ctx)
 * - syncFollowersFromTown(ctx)
 */

import { createRuntimeFollower, syncRecordFromRuntime } from "../entities/followers.js";

function getActiveFollowerRecord(ctx) {
  try {
    const p = ctx && ctx.player;
    if (!p || !Array.isArray(p.followers)) return null;
    for (let i = 0; i < p.followers.length; i++) {
      const f = p.followers[i];
      if (!f) continue;
      if (f.enabled === false) continue;
      if (typeof f.hp === "number" && f.hp <= 0) continue;
      return f;
    }
  } catch (_) {}
  return null;
}

function findSpawnTileNearPlayer(ctx, maxRadius = 4) {
  if (!ctx || !ctx.player || typeof ctx.inBounds !== "function" || typeof ctx.isWalkable !== "function") {
    return null;
  }
  const p = ctx.player;
  const occ = (ctx.occupancy && typeof ctx.occupancy.isFree === "function") ? ctx.occupancy : null;

  const inB = (x, y) => !!ctx.inBounds(x, y);
  const isWalkable = (x, y) => !!ctx.isWalkable(x, y);

  function tileBlocked(x, y) {
    if (!inB(x, y)) return true;
    if (!isWalkable(x, y)) return true;
    if (x === (p.x | 0) && y === (p.y | 0)) return true;
    if (occ && typeof occ.isFree === "function") {
      return !occ.isFree(x, y, { ignorePlayer: true });
    }
    // Fallback: scan enemies/NPCs when occupancy grid is unavailable.
    try {
      if (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y)) return true;
    } catch (_) {}
    try {
      if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === x && n.y === y)) return true;
    } catch (_) {}
    try {
      if (Array.isArray(ctx.townProps) && ctx.townProps.some(pr => pr && pr.x === x && pr.y === y)) return true;
    } catch (_) {}
    return false;
  }

  const mode = ctx.mode || "";
  const rMax = (typeof maxRadius === "number" && maxRadius > 0)
    ? maxRadius
    : (mode === "town" ? 8 : 4);

  // First, try tiles near the player in an expanding diamond.
  for (let r = 1; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== r) continue;
        const x = (p.x | 0) + dx;
        const y = (p.y | 0) + dy;
        if (!tileBlocked(x, y)) return { x, y };
      }
    }
  }

  // For towns/castles, only spawn within a radius of the player; do not
  // fall back to an arbitrary distant tile.
  if (mode === "town") return null;

  // For dungeon/encounter/region maps, allow a broader fallback: scan the
  // whole map for any reasonable free tile if the immediate area around
  // the player is too cramped (small rooms, crowded corridors).
  try {
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!inB(x, y)) continue;
        if (tileBlocked(x, y)) continue;
        return { x, y };
      }
    }
  } catch (_) {}

  return null;
}

export function spawnInDungeon(ctx) {
  // Generic spawn helper for any \"dungeon-like\" combat map:
  // - ctx.mode === \"dungeon\"  (classic floors and towers)
  // - ctx.mode === \"encounter\" (overworld skirmish maps)
  // - ctx.mode === \"region\"    (ruins encounters inside Region Map)
  if (
    !ctx ||
    (ctx.mode !== "dungeon" &&
      ctx.mode !== "encounter" &&
      ctx.mode !== "region")
  ) {
    return;
  }
  try {
    const p = ctx.player;
    if (!p) return;
    if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
    // Avoid spawning duplicates if follower is already present
    const existing = ctx.enemies.find(e => e && e._isFollower);
    if (existing) return;

    const rec = getActiveFollowerRecord(ctx);
    if (!rec) return;

    const follower = createRuntimeFollower(ctx, rec);
    const pos = findSpawnTileNearPlayer(ctx);
    if (!pos) return;
    follower.x = pos.x | 0;
    follower.y = pos.y | 0;

    ctx.enemies.push(follower);

    try {
      if (ctx.occupancy && typeof ctx.occupancy.setEnemy === "function") {
        ctx.occupancy.setEnemy(follower.x, follower.y);
      }
    } catch (_) {}

    // Light log so it's clear when the ally is present, without spamming.
    try {
      if (ctx.log) {
        const label = follower.name || "Your ally";
        let where = "dungeon";
        if (ctx.mode === "encounter") where = "encounter";
        else if (ctx.mode === "region") where = "region map";
        ctx.log(`${label} joins you in the ${where}.`, "info");
      }
    } catch (_) {}
  } catch (_) {}
}

export function spawnInTown(ctx) {
  if (!ctx || ctx.mode !== "town") return;
  try {
    const p = ctx.player;
    if (!p) return;
    if (!Array.isArray(ctx.npcs)) ctx.npcs = [];
    // Avoid duplicates within a single town visit
    const existing = ctx.npcs.find(n => n && n._isFollower);
    if (existing) return;

    const rec = getActiveFollowerRecord(ctx);
    if (!rec) {
      try { ctx.log && ctx.log("No active follower available to accompany you in town.", "info"); } catch (_) {}
      return;
    }

    const followerActor = createRuntimeFollower(ctx, rec);
    // Try a slightly larger radius around the player so castle gates and
    // narrow town entrances still find a nearby tile.
    const pos = findSpawnTileNearPlayer(ctx, 8);
    if (!pos) {
      try { ctx.log && ctx.log("Your follower cannot find room to stand nearby in this town.", "info"); } catch (_) {}
      return;
    }

    const npc = {
      x: pos.x | 0,
      y: pos.y | 0,
      name: followerActor.name || "Follower",
      lines: [
        "I've got your back.",
        "Lead the way.",
        "I'll guard you."
      ],
      roles: ["follower"],
      _isFollower: true,
      _followerId: followerActor._followerId,
    };

    ctx.npcs.push(npc);

    try {
      if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
        ctx.occupancy.setNPC(npc.x, npc.y);
      }
    } catch (_) {}

    // Light log so it's visible that the ally is present in town.
    try {
      if (ctx.log) {
        const label = npc.name || "Your ally";
        ctx.log(`${label} accompanies you in town.`, "info");
      }
    } catch (_) {}
  } catch (_) {}
}

export function syncFollowersFromDungeon(ctx) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.followers) || !Array.isArray(ctx.enemies)) return;
  try {
    const followers = ctx.player.followers;
    for (let i = 0; i < ctx.enemies.length; i++) {
      const e = ctx.enemies[i];
      if (!e || !e._isFollower || !e._followerId) continue;
      const rec = followers.find(f => f && f.id === e._followerId);
      if (!rec) continue;
      syncRecordFromRuntime(rec, e);
    }
  } catch (_) {}
}

export function syncFollowersFromTown(ctx) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.followers) || !Array.isArray(ctx.npcs)) return;
  try {
    const followers = ctx.player.followers;
    // HP is not tracked on town NPCs for now, but we keep this hook in place for future extensions.
    // For now this is a no-op aside from ensuring the list is well-formed.
    for (let i = 0; i < ctx.npcs.length; i++) {
      const n = ctx.npcs[i];
      if (!n || !n._isFollower || !n._followerId) continue;
      const rec = followers.find(f => f && f.id === n._followerId);
      if (!rec) continue;
      // No HP fields on town NPC; future: read decorative state here.
    }
  } catch (_) {}
}

if (typeof window !== "undefined") {
  window.FollowersRuntime = {
    spawnInDungeon,
    spawnInTown,
    syncFollowersFromDungeon,
    syncFollowersFromTown,
  };
}