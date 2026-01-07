/**
 * Followers: helper functions for player followers / party allies.
 *
 * Exports (ESM + window.Followers):
 * - createRuntimeFollower(ctx, record)
 * - syncRecordFromRuntime(record, runtime)
 */

import { getGameData } from "../utils/access.js";
import { aggregateFollowerAtkDef } from "./equip_common.js";

function getFollowersList(ctx) {
  try {
    const GD = getGameData(ctx);
    if (GD && Array.isArray(GD.followers)) return GD.followers;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.GameData && Array.isArray(window.GameData.followers)) {
      return window.GameData.followers;
    }
  } catch (_) {}
  return null;
}

// Exported so renderers and other modules can resolve follower visuals
// (glyph/color/type) from a single data source (data/entities/followers.json).
export function getFollowerDef(ctx, id) {
  const list = getFollowersList(ctx);
  if (!list || !id) return null;
  const key = String(id);
  for (let i = 0; i < list.length; i++) {
    const def = list[i];
    if (!def) continue;
    if (String(def.id) === key) return def;
  }
  return null;
}

export function createRuntimeFollower(ctx, record) {
  if (!record || !record.id) {
    throw new Error("createRuntimeFollower requires a follower record with a valid id");
  }

  const def = getFollowerDef(ctx, record.id);
  if (!def) {
    throw new Error(`Follower definition not found for id=${record.id}`);
  }

  let name = record.name;
  const shouldPersonalize =
    !name ||
    name === def.name ||
    name === "Follower";

  if (shouldPersonalize) {
    // Prefer a data-driven namePool when available so followers get a unique
    // identity without requiring every record to carry a hard-coded name.
    try {
      if (Array.isArray(def.namePool) && def.namePool.length > 0) {
        let rfn = null;
        try {
          if (ctx && typeof ctx.rng === "function") {
            rfn = ctx.rng;
          } else if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
            rfn = window.RNGUtils.getRng();
          }
        } catch (_) {}
        if (typeof rfn !== "function") {
          rfn = Math.random;
        }
        const idx = def.namePool.length === 1
          ? 0
          : (Math.floor(rfn() * def.namePool.length) % def.namePool.length);
        const baseName = String(def.namePool[idx] ?? "").trim();
        const archetypeName = typeof def.name === "string" && def.name.trim() ? def.name.trim() : "";
        if (baseName) {
          const trimmed = archetypeName.replace(/\s+Ally$/i, "");
          name = trimmed ? `${baseName} the ${trimmed}` : baseName;
        }
      }
    } catch (_) {}
    if (!name) {
      name = def.name;
    }
    if (name) {
      try {
        record.name = name;
      } catch (_) {}
    }
  }

  if (!name) {
    throw new Error(`Follower name missing for id=${record.id}`);
  }

  // Level: record overrides definition; default to 1 when unspecified.
  const level =
    typeof record.level === "number" && record.level > 0
      ? (record.level | 0)
      : (typeof def.level === "number" && def.level > 0 ? (def.level | 0) : 1);

  // Base stats must be defined in followers.json
  const baseHp = def.baseHp;
  if (typeof baseHp !== "number" || baseHp <= 0) {
    throw new Error(`Follower baseHp must be a positive number for id=${record.id}`);
  }

  let maxHp =
    typeof record.maxHp === "number" && record.maxHp > 0
      ? record.maxHp
      : baseHp;
  let hp =
    typeof record.hp === "number"
      ? record.hp
      : maxHp;
  if (hp > maxHp) maxHp = hp;
  if (hp <= 0) hp = 1;

  const baseAtk = def.baseAtk;
  if (typeof baseAtk !== "number") {
    throw new Error(`Follower baseAtk must be a number for id=${record.id}`);
  }
  const baseDef = def.baseDef;
  if (typeof baseDef !== "number") {
    throw new Error(`Follower baseDef must be a number for id=${record.id}`);
  }

  const faction = def.faction;
  if (!faction) {
    throw new Error(`Follower faction missing for id=${record.id}`);
  }

  const glyph = def.glyph;
  if (typeof glyph !== "string" || !glyph.trim()) {
    throw new Error(`Follower glyph missing for id=${record.id}`);
  }

  const color = def.color;
  if (typeof color !== "string" || !color.trim()) {
    throw new Error(`Follower color missing for id=${record.id}`);
  }

  // Aggregate final Attack/Defense from base stats plus equipped gear via shared helper.
  const agg = aggregateFollowerAtkDef(def, record);
  const finalAtk = typeof agg.atk === "number" ? agg.atk : baseAtk;
  const finalDef = typeof agg.def === "number" ? agg.def : baseDef;

  return {
    x: 0,
    y: 0,
    type: def.id || record.id,
    name,
    faction,
    glyph,
    color,
    hp,
    maxHp,
    atk: finalAtk,
    def: finalDef,
    level,
    announced: false,
    _isFollower: true,
    _followerId: record.id || def.id,
    _ignorePlayer: true,
    _followerMode: record.mode || "follow",
  };
}

export function syncRecordFromRuntime(record, runtime) {
  if (!record || !runtime) return;
  try {
    if (typeof runtime.hp === "number") {
      let hp = runtime.hp;
      if (typeof record.maxHp === "number" && record.maxHp > 0) {
        if (hp > record.maxHp) hp = record.maxHp;
      }
      if (hp <= 0) hp = 1;
      record.hp = hp;
      if (typeof record.maxHp !== "number" || record.maxHp <= 0) {
        record.maxHp = hp;
      }
    }
    if (typeof runtime.level === "number" && runtime.level > 0) {
      record.level = runtime.level | 0;
    }
  } catch (_) {}
}

if (typeof window !== "undefined") {
  window.Followers = {
    createRuntimeFollower,
    syncRecordFromRuntime,
  };
}