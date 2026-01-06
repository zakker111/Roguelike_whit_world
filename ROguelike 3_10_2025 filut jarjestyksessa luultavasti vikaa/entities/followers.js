/**
 * Followers: helper functions for player followers / party allies.
 *
 * Exports (ESM + window.Followers):
 * - createRuntimeFollower(ctx, record)
 * - syncRecordFromRuntime(record, runtime)
 */

import { getGameData } from "../utils/access.js";

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
  if (!record) return null;
  const def = getFollowerDef(ctx, record.id);
  if (!def) return null;

  const name = record.name || def.name || "Follower";
  const level = typeof record.level === "number" && record.level > 0 ? (record.level | 0) : 1;

  const baseHp = def.baseHp;
  let maxHp = typeof record.maxHp === "number" && record.maxHp > 0 ? record.maxHp : baseHp;
  let hp = typeof record.hp === "number" ? record.hp : maxHp;
  if (hp > maxHp) maxHp = hp;
  if (hp <= 0) hp = 1;

  const baseAtk = def.baseAtk;
  const baseDef = def.baseDef;
  const faction = def.faction;

  return {
    x: 0,
    y: 0,
    type: def.id,
    name,
    faction,
    glyph: def.glyph,
    color: def.color,
    hp,
    maxHp,
    atk: baseAtk,
    def: baseDef,
    level,
    announced: false,
    _isFollower: true,
    _followerId: def.id,
    _ignorePlayer: true,
  };
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
    atk: baseAtk,
    def: baseDef,
    level,
    announced: false,
    _isFollower: true,
    _followerId: record.id || def.id,
    _ignorePlayer: true,
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