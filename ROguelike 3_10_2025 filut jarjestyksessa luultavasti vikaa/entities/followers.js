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

function getFollowerDef(ctx, id) {
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
  const def = getFollowerDef(ctx, record.id) || {};
  const name = record.name || def.name || "Follower";
  const level = typeof record.level === "number" && record.level > 0 ? (record.level | 0) : 1;

  const baseHp = typeof def.baseHp === "number" && def.baseHp > 0 ? def.baseHp : 10;
  let maxHp = typeof record.maxHp === "number" && record.maxHp > 0 ? record.maxHp : baseHp;
  let hp = typeof record.hp === "number" ? record.hp : maxHp;
  if (hp > maxHp) maxHp = hp;
  if (hp <= 0) hp = 1;

  const baseAtk = typeof def.baseAtk === "number" ? def.baseAtk : 2;
  const baseDef = typeof def.baseDef === "number" ? def.baseDef : 0;

  const faction = def.faction || "ally";

  return {
    x: 0,
    y: 0,
    type: def.id || record.id || "follower",
    name,
    faction,
    glyph: def.glyph || "g",
    color: def.color || "#aabbee",
    hp,
    maxHp,
    atk: baseAtk,
    def: baseDef,
    level,
    announced: false,
    _isFollower: true,
    _followerId: record.id || def.id || "follower",
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