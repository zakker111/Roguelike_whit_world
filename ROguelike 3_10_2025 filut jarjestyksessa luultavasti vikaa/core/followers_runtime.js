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
import { getTileDef } from "../data/tile_lookup.js";
import * as World from "../world/world.js";

// Hard caps for followers. Defaults can be overridden via data/config/config.json
// under cfg.followers.maxActive so tuning does not require code edits.
// Per-type limits used to exist (maxPerType) but have been removed on purpose;
// the player can now travel with any mix of archetypes up to the total cap.
const DEFAULT_MAX_FOLLOWERS_ACTIVE = 3;

// Resolve caps from GameData.config.followers when available; otherwise use defaults.
function getFollowersCaps(ctx) {
  let maxActive = DEFAULT_MAX_FOLLOWERS_ACTIVE;
  try {
    const GD = getGameData(ctx);
    const cfg = GD && GD.config;
    const fc = cfg && cfg.followers;
    if (fc && typeof fc.maxActive === "number" && fc.maxActive > 0) {
      maxActive = fc.maxActive | 0;
    }
  } catch (_) {}
  return { maxActive };
}

// Ensure follower records have unique ids per follower and a separate
// archetypeId used for per-type caps and definition lookup. This runs once
// per loaded player and is safe for old saves that only carried `id` as the
// archetype id (e.g. \"guard_follower\").
function normalizeFollowerRecords(ctx) {
  try {
    const p = ctx && ctx.player;
    if (!p || !Array.isArray(p.followers)) return;
    if (p._followersNormalized) return;

    const followers = p.followers;
    const usedIds = new Set();
    let seq = (typeof p._followerSeq === "number" && p._followerSeq >= 0) ? (p._followerSeq | 0) : 0;

    for (let i = 0; i < followers.length; i++) {
      const f = followers[i];
      if (!f) continue;

      // Derive archetype id: prefer explicit archetypeId, then base portion of id.
      let arch = "";
      if (typeof f.archetypeId === "string" && f.archetypeId.trim()) {
        arch = f.archetypeId.trim();
      } else {
        const rawId = String(f.id || "").trim();
        const hashIdx = rawId.indexOf("#");
        arch = hashIdx >= 0 ? rawId.slice(0, hashIdx) : rawId;
        if (!arch) arch = "follower";
      }
      f.archetypeId = arch;

      // Start from existing id when present, otherwise use archetype id.
      let id = String(f.id || "").trim();
      if (!id) id = arch;

      // Track numeric suffix for future hires when id already uses the pattern archetype#N.
      const hashIdx = id.indexOf("#");
      if (hashIdx >= 0) {
        const suffix = id.slice(hashIdx + 1);
        const n = Number(suffix);
        if (!Number.isNaN(n) && n > seq) seq = n;
      }

      // Ensure uniqueness across all follower ids.
      if (usedIds.has(id)) {
        const base = arch || "follower";
        let n = seq;
        // Find the next free suffix
        // Example: guard_follower#1, guard_follower#2, ...
        for (;;) {
          n += 1;
          const cand = `${base}#${n}`;
          if (!usedIds.has(cand)) {
            id = cand;
            seq = n;
            break;
          }
        }
      }

      f.id = id;
      usedIds.add(id);
    }

    p._followerSeq = seq;
    p._followersNormalized = true;
  } catch (_) {}
}

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

  const caps = getFollowersCaps(ctx);
  const maxActive = caps.maxActive;

  // Party size cap (all active followers). We intentionally allow any mix
  // of archetypes; there is no longer a per-type limit.
  if (p.followers.length >= maxActive) {
    result.reason = "You already travel with as many followers as you can handle.";
    return result;
  }

  result.ok = true;
  result.reason = "";
  return result;
}

// Hire a follower from a given archetype id, creating a new record on
// player.followers if possible. Returns true on success.
export function hireFollowerFromArchetype(ctx, archetypeId) {
  if (!ctx || !ctx.player) {
    try {
      const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
      if (GM && typeof GM.onEvent === "function") {
        const scope = ctx && ctx.mode ? ctx.mode : "town";
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "tried", detail: "hire" });
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "failure", detail: "hire" });
      }
    } catch (_) {}
    return false;
  }
  const p = ctx.player;
  if (!Array.isArray(p.followers)) p.followers = [];
  // Ensure existing followers have unique ids/archetypeIds before adding a new one
  normalizeFollowerRecords(ctx);

  const check = canHireFollower(ctx, archetypeId);
  if (!check.ok) {
    try {
      if (ctx.log && check.reason) {
        ctx.log(check.reason, "info");
      }
    } catch (_) {}
    try {
      const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
      if (GM && typeof GM.onEvent === "function") {
        const scope = ctx && ctx.mode ? ctx.mode : "town";
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "tried", detail: "hire" });
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "failure", detail: "hire" });
      }
    } catch (_) {}
    return false;
  }

  const defs = getFollowerArchetypes(ctx);
  const fid = String(archetypeId || "").trim();
  if (!fid || !defs || !defs.length) {
    try {
      const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
      if (GM && typeof GM.onEvent === "function") {
        const scope = ctx && ctx.mode ? ctx.mode : "town";
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "tried", detail: "hire" });
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "failure", detail: "hire" });
      }
    } catch (_) {}
    return false;
  }

  let def = null;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if (!d || !d.id) continue;
    if (String(d.id) === fid) {
      def = d;
      break;
    }
  }
  if (!def) {
    try {
      const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
      if (GM && typeof GM.onEvent === "function") {
        const scope = ctx && ctx.mode ? ctx.mode : "town";
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "tried", detail: "hire" });
        GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "failure", detail: "hire" });
      }
    } catch (_) {}
    return false;
  }

  // Assign a unique per-follower id while keeping a separate archetypeId that
  // points back to the definition in followers.json. New ids use the pattern
  // \"<archetypeId>#N\" so they remain human-readable and debuggable.
  let seq = (typeof p._followerSeq === "number" && p._followerSeq >= 0) ? (p._followerSeq | 0) : 0;
  seq += 1;
  p._followerSeq = seq;
  const uniqueId = `${def.id}#${seq}`;

  const rec = { id: uniqueId, archetypeId: String(def.id), enabled: true, injuries: [], xp: 0, xpNext: 20 };

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

  // GMRuntime: followers hire mechanic
  try {
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
    if (GM && typeof GM.onEvent === "function") {
      const scope = ctx && ctx.mode ? ctx.mode : "town";
      GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "tried", detail: "hire" });
      GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "success", detail: "hire" });
    }
  } catch (_) {}

  return true;
}

// Return up to `maxCount` active follower records (enabled and alive) from
// player.followers, in array order.
function getActiveFollowerRecords(ctx, maxCount) {
  const out = [];
  const caps = getFollowersCaps(ctx);
  const cap =
    typeof maxCount === "number" && maxCount > 0 ? maxCount : caps.maxActive;
  try {
    // Normalize follower ids/archetypes once per player so multi-follower
    // parties can distinguish individual allies of the same archetype.
    normalizeFollowerRecords(ctx);
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

function findSpawnTileNearPlayer(ctx, maxRadius) {
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
  const isEncounterLike = mode === "encounter";

  function regionWalkableAt(x, y) {
    // Region Map overlay uses world/region tiles instead of dungeon FLOOR.
    // Prefer tiles.json "region" properties, then fall back to overworld
    // World.isWalkable semantics.
    try {
      if (!inB(x, y)) return false;
      const sample = (ctx.region && Array.isArray(ctx.region.map))
        ? ctx.region.map
        : ctx.map;
      const rows = Array.isArray(sample) ? sample.length : 0;
      const cols = rows && Array.isArray(sample[0]) ? sample[0].length : 0;
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      const t = sample[y][x];

      // Prefer region tileset walkability
      try {
        const def = getTileDef("region", t);
        if (def && def.properties && typeof def.properties.walkable === "boolean") {
          return !!def.properties.walkable;
        }
      } catch (_) {}

      // Fallback to overworld semantics
      try {
        if (World && typeof World.isWalkable === "function") {
          return !!World.isWalkable(t);
        }
      } catch (_) {}

      // Last resort: only treat obvious blockers (water/river/mountain) as non-walkable.
      try {
        const WT = World && World.TILES;
        if (WT) {
          return t !== WT.WATER && t !== WT.RIVER && t !== WT.MOUNTAIN;
        }
      } catch (_) {}

      return true;
    } catch (_) {
      return false;
    }
  }

  function tileBlocked(x, y) {
    if (!inB(x, y)) return true;

    // In towns/castles, rely on the same floor rules NPCs use so we don't
    // spawn allies inside walls or on props, and ignore stale occupancy.
    if (isTownLike) {
      return !isFreeTownFloorLocal(ctx, x, y);
    }

    // Region Map: treat SNOW/SNOW_FOREST and other region tiles as walkable
    // using the same rules RegionMapRuntime uses for animals and player movement.
    if (isRegionLike) {
      if (!regionWalkableAt(x, y)) return true;
      if (x === (p.x | 0) && y === (p.y | 0)) return true;
      // Use dynamic actors/props arrays instead of over-relying on occupancy,
      // which can occasionally be stale around entry tiles.
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

    // Default dungeon/encounter walkability via ctx.isWalkable.
    if (!isWalkable(x, y)) return true;
    if (x === (p.x | 0) && y === (p.y | 0)) return true;
    // For dungeon/encounter maps, prefer dynamic actors/props arrays for
    // occupancy checks so a stale occupancy grid does not completely block
    // follower spawns even when nearby tiles look open to the player.
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

  // Followers should stay reasonably close to the player:
  // - towns/castles and Region Map: search a larger local radius only
  // - encounters: prefer a larger local radius, but allow a full-map fallback (nearest tile) if cramped
  // - dungeon floors: smaller radius, but allow a full-map fallback
  const defaultRadius = (isTownLike || isRegionLike || isEncounterLike) ? 8 : 4;
  const rMax = (typeof maxRadius === "number" && maxRadius > 0)
    ? maxRadius
    : defaultRadius;

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
  // player; do not fall back to arbitrary distant tiles.
  if (isTownLike || isRegionLike) return null;

  // For encounter and dungeon maps, allow a broader fallback: perform a bounded
  // BFS flood from the player's position over walkable tiles and pick the first
  // free tile found. This keeps followers reasonably close and avoids spawning
  // them in distant or disconnected pockets of the map.
  try {
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (rows && cols) {
      const startX = p.x | 0;
      const startY = p.y | 0;
      const maxBFSDist = Math.max(rMax + 2, 12); // allow some extra distance beyond local ring
      const q = [];
      const seen = new Set();
      const pushIfValid = (x, y) => {
        if (!inB(x, y)) return;
        const key = `${x},${y}`;
        if (seen.has(key)) return;
        seen.add(key);
        q.push({ x, y });
      };
      pushIfValid(startX, startY);
      const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];
      while (q.length) {
        const cur = q.shift();
        const dist = Math.abs(cur.x - startX) + Math.abs(cur.y - startY);
        if (dist > maxBFSDist) continue;

        // First free tile we encounter (other than the player's own tile)
        // becomes our spawn position.
        if (!(cur.x === startX && cur.y === startY) && !tileBlocked(cur.x, cur.y)) {
          return { x: cur.x, y: cur.y };
        }

        // Only traverse tiles that are structurally walkable; ignore transient
        // blockers like enemies/NPCs so we can search around crowded entrance
        // tiles instead of treating them as walls.
        let tileOK = false;
        try {
          tileOK = !!isWalkable(cur.x, cur.y);
        } catch (_) {}
        if (!tileOK) continue;

        for (const d of dirs) {
          const nx = cur.x + d.dx;
          const ny = cur.y + d.dy;
          pushIfValid(nx, ny);
        }
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

    const caps = getFollowersCaps(ctx);
    const records = getActiveFollowerRecords(ctx, caps.maxActive);
    if (!records.length) return;

    // Build a set of followerIds already present on this map so repeated
    // spawnInDungeon calls (e.g., when re-entering or layering encounters)
    // do not create duplicate runtime allies for the same follower record.
    const existingFollowerIds = new Set();
    try {
      if (Array.isArray(ctx.enemies)) {
        for (let i = 0; i < ctx.enemies.length; i++) {
          const e = ctx.enemies[i];
          if (!e || !e._isFollower) continue;
          if (!e._followerId && !e.id) continue;
          const fid = String(e._followerId || e.id);
          if (fid) existingFollowerIds.add(fid);
        }
      }
    } catch (_) {}

    let spawned = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || !rec.id) continue;

      // Skip if this follower already has a live runtime ally on this map.
      const recId = String(rec.id);
      if (recId && existingFollowerIds.has(recId)) continue;

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
      existingFollowerIds.add(recId);

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
          // Extra debug-friendly hint: where the follower actually spawned so it's
          // easier to verify presence during testing (mirrors the town helper).
          ctx.log(`(Follower position: ${follower.x},${follower.y})`, "info");
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

    const caps = getFollowersCaps(ctx);
    const records = getActiveFollowerRecords(ctx, caps.maxActive);
    if (!records.length) {
      try {
        ctx.log &&
          ctx.log(
            "No active followers available to accompany you in town.",
            "notice"
          );
      } catch (_) {}
      return;
    }

    let spawned = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || !rec.id) continue;

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
    normalizeFollowerRecords(ctx);
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
    normalizeFollowerRecords(ctx);
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

  // GMRuntime: follower dismissed mechanic
  try {
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
    if (GM && typeof GM.onEvent === "function") {
      const scope = ctx && ctx.mode ? ctx.mode : "town";
      GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "followers", action: "success", detail: "dismiss" });
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