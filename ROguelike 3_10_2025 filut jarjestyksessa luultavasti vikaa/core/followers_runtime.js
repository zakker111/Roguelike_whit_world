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
import { getGameData, getRNGUtils } from "../utils/access.js";

// Hard cap for how many followers can be active at once in the party.
// This applies to dungeon/encounter/region and town spawns.
const MAX_FOLLOWERS_ACTIVE = 3;

// Resolve the list of follower archetypes defined in data/entities/followers.json
// via GameData.followers. Returns an array; never throws.
export function getFollowerArchetypes(ctx) {
  try {
    const GD = getGameData(ctx);
    if (GD && Array.isArray(GD.followers)) return GD.followers;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.followers)) {
      return window.GameData.followers;
    }
  } catch (_) {}
  return [];
}

// Pick a random follower archetype definition, optionally skipping ones the
// player already has hired (by id).
export function pickRandomFollowerArchetype(ctx, opts = {}) {
  const defs = getFollowerArchetypes(ctx);
  if (!defs || !defs.length) return null;

  const p = ctx && ctx.player;
  let haveIds = null;
  if (opts && opts.skipHired && p && Array.isArray(p.followers)) {
    haveIds = new Set();
    for (let i = 0; i < p.followers.length; i++) {
      const f = p.followers[i];
      if (!f || !f.id) continue;
      haveIds.add(String(f.id));
    }
  }

  const candidates = [];
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (!def || !def.id) continue;
    const idStr = String(def.id);
    if (haveIds && haveIds.has(idStr)) continue;
    candidates.push(def);
  }

  if (!candidates.length) return null;

  let rfn = null;
  try {
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.getRng === "function") {
      rfn = RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
    }
  } catch (_) {}
  if (typeof rfn !== "function") {
    if (ctx && typeof ctx.rng === "function") rfn = ctx.rng;
    else rfn = Math.random;
  }

  const n = candidates.length;
  const idx = n === 1 ? 0 : (Math.floor(rfn() * n) % n);
  return candidates[idx] || candidates[0] || null;
}

// Check whether the player can hire a follower of the given archetype id
// according to party size and optional per-archetype limits.
export function canHireFollower(ctx, archetypeId) {
  const result = { ok: false, reason: "Unknown error." };
  if (!ctx || !ctx.player) {
    result.reason = "No player context.";
    return result;
  }
  const p = ctx.player;
  if (!Array.isArray(p.followers)) {
    result.ok = true;
    result.reason = "";
    return result;
  }

  const fid = String(archetypeId || "").trim();
  if (!fid) {
    result.reason = "Invalid follower type.";
    return result;
  }

  // Party size cap
  if (p.followers.length >= MAX_FOLLOWERS_ACTIVE) {
    result.reason = "You already travel with as many followers as you can handle.";
    return result;
  }

  // Simple rule for now: only one follower per archetype id.
  for (let i = 0; i < p.followers.length; i++) {
    const f = p.followers[i];
    if (!f || !f.id) continue;
    if (String(f.id).trim() !== fid) continue;
    if (f.enabled === false) continue;
    if (typeof f.hp === "number" && f.hp <= 0) continue;
    result.reason = "You already travel with someone of that kind.";
    return result;
  }

  result.ok = true;
  result.reason = "";
  return result;
}

// Hire a follower from a given archetype id, creating a new record on
// player.followers if possible. Returns true on success.
export function hireFollowerFromArchetype(ctx, archetypeId) {
  if (!ctx || !ctx.player) return false;
  const p = ctx.player;
  if (!Array.isArray(p.followers)) p.followers = [];

  const check = canHireFollower(ctx, archetypeId);
  if (!check.ok) {
    try {
      if (ctx.log && check.reason) {
        ctx.log(check.reason, "info");
      }
    } catch (_) {}
    return false;
  }

  const defs = getFollowerArchetypes(ctx);
  const fid = String(archetypeId || "").trim();
  if (!fid || !defs || !defs.length) return false;

  let def = null;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if (!d || !d.id) continue;
    if (String(d.id) === fid) {
      def = d;
      break;
    }
  }
  if (!def) return false;

  const rec = { id: String(def.id), enabled: true };

  // Basic stats: start at baseHp and level 1 (or def.level if provided).
  const level =
    typeof def.level === "number" && def.level > 0 ? (def.level | 0) : 1;
  rec.level = level;

  if (typeof def.baseHp === "number" && def.baseHp > 0) {
    rec.maxHp = def.baseHp;
    rec.hp = def.baseHp;
  }

  // Simple default mode and empty inventory/equipment; Player.normalize will
  // merge schema as needed.
  rec.mode = "follow";
  rec.inventory = [];
  rec.equipment = {
    left: null,
    right: null,
    head: null,
    torso: null,
    legs: null,
    hands: null,
  };

  // Optional flavor fields copied from definition so the follower panel can
  // show richer info even before a full normalize cycle.
  try {
    if (def.race) rec.race = def.race;
    if (def.subrace) rec.subrace = def.subrace;
    if (def.background) rec.background = def.background;
    if (Array.isArray(def.tags)) rec.tags = def.tags.slice();
    if (Array.isArray(def.personalityTags)) rec.personalityTags = def.personalityTags.slice();
    if (def.temperament && typeof def.temperament === "object") {
      rec.temperament = { ...def.temperament };
    }
  } catch (_) {}

  p.followers.push(rec);

  // Log a short confirmation; name will be personalized when a runtime
  // follower is created via createRuntimeFollower.
  try {
    if (ctx.log) {
      const label = def.name || "Follower";
      ctx.log(`${label} agrees to travel with you.`, "good");
    }
  } catch (_) {}

  return true;
}

// Return up to `maxCount` active follower records (enabled and alive) from
// player.followers, in array order.
function getActiveFollowerRecords(ctx, maxCount) {
  const out = [];
  const cap =
    typeof maxCount === "number" && maxCount > 0 ? maxCount : MAX_FOLLOWERS_ACTIVE;
  try {
    const p = ctx && ctx.player;
    if (!p || !Array.isArray(p.followers)) return out;
    for (let i = 0; i < p.followers.length; i++) {
      const f = p.followers[i];
      if (!f) continue;
      if (f.enabled === false) continue;
      if (typeof f.hp === "number" && f.hp <= 0) continue;
      out.push(f);
      if (out.length >= cap) break;
    }
  } catch (_) {}
  return out;
}

// Back-compat: return the first active follower record, preserving existing
// behavior for any callers that still expect a single record.
function getActiveFollowerRecord(ctx) {
  const list = getActiveFollowerRecords(ctx, 1);
  return list.length ? list[0] : null;
}

// Local helper to mirror TownRuntime.isFreeTownFloor without creating a
// module import cycle. Used only when ctx.mode === "town".
function isFreeTownFloorLocal(ctx, x, y) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.isFreeTownFloor === "function") {
      return !!ctx.Utils.isFreeTownFloor(ctx, x, y);
    }
  } catch (_) {}
  try {
    const U = (typeof window !== "undefined" ? window.Utils : null);
    if (U && typeof U.isFreeTownFloor === "function") {
      return !!U.isFreeTownFloor(ctx, x, y);
    }
  } catch (_) {}
  if (!ctx || typeof ctx.inBounds !== "function") return false;
  if (!ctx.inBounds(x, y)) return false;
  try {
    const t = ctx.map[y][x];
    if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) return false;
    if (x === (ctx.player.x | 0) && y === (ctx.player.y | 0)) return false;
    if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === x && n.y === y)) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p && p.x === x && p.y === y)) return false;
  } catch (_) {
    return false;
  }
  return true;
}

function findSpawnTileNearPlayer(ctx, maxRadius = 4) {
  if (!ctx || !ctx.player || typeof ctx.inBounds !== "function" || typeof ctx.isWalkable !== "function") {
    return null;
  }
  const p = ctx.player;
  const occ = (ctx.occupancy && typeof ctx.occupancy.isFree === "function") ? ctx.occupancy : null;

  const inB = (x, y) => !!ctx.inBounds(x, y);
  const isWalkable = (x, y) => !!ctx.isWalkable(x, y);

  const mode = ctx.mode || "";
  const isTownLike = mode === "town";
  const isRegionLike = mode === "region";

  function tileBlocked(x, y) {
    if (!inB(x, y)) return true;

    // In towns/castles, rely on the same floor rules NPCs use so we don't
    // spawn allies inside walls or on props, and ignore stale occupancy.
    if (isTownLike) {
      return !isFreeTownFloorLocal(ctx, x, y);
    }

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

  const rMax = (typeof maxRadius === "number" && maxRadius > 0)
    ? maxRadius
    : ((isTownLike || isRegionLike) ? 8 : 4);

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

  // For towns/castles and Region Map, only spawn within a radius of the
  // player; do notn arbitrary distant tile.
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

    const records = getActiveFollowerRecords(ctx, MAX_FOLLOWERS_ACTIVE);
    if (!records.length) return;

    let spawned = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || !rec.id) continue;

      // Avoid spawning duplicates for this specific follower id
      try {
        const already = ctx.enemies.some(
          (e) => e && e._isFollower && e._followerId === rec.id
        );
        if (already) continue;
      } catch (_) {}

      let follower = null;
      try {
        follower = createRuntimeFollower(ctx, rec);
      } catch (_) {
        follower = null;
      }
      if (!follower) continue;

      const pos = findSpawnTileNearPlayer(ctx);
      if (!pos) continue;

      follower.x = pos.x | 0;
      follower.y = pos.y | 0;

      ctx.enemies.push(follower);

      try {
        if (ctx.occupancy && typeof ctx.occupancy.setEnemy === "function") {
          ctx.occupancy.setEnemy(follower.x, follower.y);
        }
      } catch (_) {}

      spawned++;

      // Light log so it's clear when each ally is present, without spamming.
      try {
        if (ctx.log) {
          const label = follower.name || "Your ally";
          let where = "dungeon";
          if (ctx.mode === "encounter") where = "encounter";
          else if (ctx.mode === "region") where = "region map";
          ctx.log(`${label} joins you in the ${where}.`, "info");
        }
      } catch (_) {}
    }

    // If no follower could find a spawn tile, emit a single helpful log.
    if (!spawned) {
      try {
        if (ctx.log) {
          ctx.log(
            "Your followers cannot find room to stand nearby in this area.",
            "info"
          );
        }
      } catch (_) {}
    }
  } catch (_) {}
}

export function spawnInTown(ctx) {
  if (!ctx || ctx.mode !== "town") return;
  try {
    const p = ctx.player;
    if (!p) return;
    if (!Array.isArray(ctx.npcs)) ctx.npcs = [];

    const records = getActiveFollowerRecords(ctx, MAX_FOLLOWERS_ACTIVE);
    if (!records.length) {
      try {
        ctx.log &&
          ctx.log(
            "No active followers available to accompany you in town.",
            "info"
          );
      } catch (_) {}
      return;
    }

    let spawned = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || !rec.id) continue;

      // Avoid duplicates for this specific follower id within a single town visit
      try {
        const exists = ctx.npcs.some(
          (n) => n && n._isFollower && n._followerId === rec.id
        );
        if (exists) continue;
      } catch (_) {}

      let followerActor = null;
      try {
        followerActor = createRuntimeFollower(ctx, rec);
      } catch (_) {
        followerActor = null;
      }
      if (!followerActor) continue;

      // Try a slightly larger radius around the player so castle gates and
      // narrow town entrances still find a nearby tile.
      const pos = findSpawnTileNearPlayer(ctx, 8);
      if (!pos) {
        try {
          ctx.log &&
            ctx.log(
              `${followerActor.name || "Your follower"} cannot find room to stand nearby in this town.`,
              "info"
            );
        } catch (_) {}
        continue;
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
        _followerMode: rec.mode || "follow",
      };

      ctx.npcs.push(npc);

      try {
        if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
          ctx.occupancy.setNPC(npc.x, npc.y);
        }
      } catch (_) {}

      spawned++;

      // Light log so it's visible that each ally is present in town.
      try {
        if (ctx.log) {
          const label = npc.name || "Your ally";
          ctx.log(`${label} accompanies you in town.`, "info");
          // Debug-friendly hint: where the follower spawned, so it's easier to
          // verify during testing (especially in large castles).
          ctx.log(`(Follower position: ${npc.x},${npc.y})`, "info");
        }
      } catch (_) {}
    }

    // If we had active followers but none could spawn, emit a single fallback log.
    if (!spawned) {
      try {
        if (ctx.log) {
          ctx.log(
            "Your followers cannot find room to stand nearby in this town.",
            "info"
          );
        }
      } catch (_) {}
    }
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

// Simple per-follower mode setter (e.g., follow / wait) used by UI and GOD tools.
export function setFollowerMode(ctx, followerId, mode) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.followers)) return false;
  if (mode !== "follow" && mode !== "wait") return false;

  const followers = ctx.player.followers;
  let rec = null;
  const fidStr = String(followerId || "");
  if (!fidStr) return false;

  for (let i = 0; i < followers.length; i++) {
    const f = followers[i];
    if (!f) continue;
    if (String(f.id || "") === fidStr) {
      rec = f;
      break;
    }
  }
  if (!rec) return false;

  rec.mode = mode;

  // Update any live dungeon/encounter/region follower actors.
  try {
    if (Array.isArray(ctx.enemies)) {
      for (const e of ctx.enemies) {
        if (!e || !e._isFollower) continue;
        const eid = String(e._followerId || e.id || e.type || "");
        if (eid === fidStr) {
          e._followerMode = mode;
        }
      }
    }
  } catch (_) {}

  // Update any follower NPCs in town.
  try {
    if (Array.isArray(ctx.npcs)) {
      for (const n of ctx.npcs) {
        if (!n || !n._isFollower) continue;
        const nid = String(n._followerId || "");
        if (nid === fidStr) {
          n._followerMode = mode;
        }
      }
    }
  } catch (_) {}

  try {
    if (ctx.log) {
      const name = rec.name || "Follower";
      ctx.log(
        mode === "wait"
          ? `${name} will wait here.`
          : `${name} will follow you.`,
        "info"
      );
    }
  } catch (_) {}

  return true;
}

// Permanently dismiss a follower (unhire / part ways).
// Removes the follower record from player.followers and any live actors/NPCs
// for that follower from the current map.
export function dismissFollower(ctx, followerId) {
  if (!ctx || !ctx.player || !Array.isArray(ctx.player.followers)) return false;
  const fidStr = String(followerId || "");
  if (!fidStr) return false;

  const followers = ctx.player.followers;
  let removed = false;
  let name = "Follower";

  // Remove the follower record
  try {
    for (let i = followers.length - 1; i >= 0; i--) {
      const f = followers[i];
      if (!f) continue;
      if (String(f.id || "") !== fidStr) continue;
      name = f.name || name;
      followers.splice(i, 1);
      removed = true;
      break;
    }
  } catch (_) {}

  if (!removed) return false;

  // Remove any live dungeon/encounter/region follower actors.
  try {
    if (Array.isArray(ctx.enemies)) {
      for (let i = ctx.enemies.length - 1; i >= 0; i--) {
        const e = ctx.enemies[i];
        if (!e || !e._isFollower) continue;
        const eid = String(e._followerId || e.id || e.type || "");
        if (eid !== fidStr) continue;
        try {
          if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") {
            ctx.occupancy.clearEnemy(e.x | 0, e.y | 0);
          }
        } catch (_) {}
        ctx.enemies.splice(i, 1);
      }
    }
  } catch (_) {}

  // Remove any follower NPCs in town.
  try {
    if (Array.isArray(ctx.npcs)) {
      for (let i = ctx.npcs.length - 1; i >= 0; i--) {
        const n = ctx.npcs[i];
        if (!n || !n._isFollower) continue;
        const nid = String(n._followerId || "");
        if (nid !== fidStr) continue;
        try {
          if (ctx.occupancy && typeof ctx.occupancy.clearNPC === "function") {
            ctx.occupancy.clearNPC(n.x | 0, n.y | 0);
          }
        } catch (_) {}
        ctx.npcs.splice(i, 1);
      }
    }
  } catch (_) {}

  // Log a short flavor line so the player knows the follower is gone.
  try {
    if (ctx.log) {
      ctx.log(`${name} returns to their own path.`, "info");
    }
  } catch (_) {}

  return true;
}

if (typeof window !== "undefined") {
  window.FollowersRuntime = {
    spawnInDungeon,
    spawnInTown,
    syncFollowersFromDungeon,
    syncFollowersFromTown,
    setFollowerMode,
    dismissFollower,
    getFollowerArchetypes,
    pickRandomFollowerArchetype,
    canHireFollower,
    hireFollowerFromArchetype,
  };
}