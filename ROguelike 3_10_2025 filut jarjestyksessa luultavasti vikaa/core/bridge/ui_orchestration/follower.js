import { getFollowerDef } from "../../../entities/followers.js";
import { aggregateFollowerAtkDef } from "../../../entities/equip_common.js";
import { U } from "./shared.js";
import { requestDraw } from "./draw.js";

// Build a lightweight follower inspect view model for UI, combining runtime actor,
// follower record, and follower definition.
function buildFollowerView(ctx, runtime) {
  if (!ctx || !runtime) return null;
  const id = runtime._followerId || runtime.id || runtime.type;
  if (!id) return null;

  let rec = null;
  try {
    const p = ctx.player;
    if (p && Array.isArray(p.followers)) {
      rec = p.followers.find((f) => f && f.id === id) || null;
    }
  } catch (_) {}

  let def = null;
  try {
    def = getFollowerDef(ctx, id) || null;
  } catch (_) {}

  const name = runtime.name || (rec && rec.name) || (def && def.name) || "Follower";

  const level = (() => {
    if (typeof runtime.level === "number" && runtime.level > 0) return runtime.level | 0;
    if (rec && typeof rec.level === "number" && rec.level > 0) return rec.level | 0;
    if (def && typeof def.level === "number" && def.level > 0) return def.level | 0;
    return 1;
  })();

  let hp = typeof runtime.hp === "number" ? runtime.hp : null;
  let maxHp = typeof runtime.maxHp === "number" ? runtime.maxHp : null;
  if (rec) {
    if (hp == null && typeof rec.hp === "number") hp = rec.hp;
    if (maxHp == null && typeof rec.maxHp === "number") maxHp = rec.maxHp;
  }
  if (hp == null && def && typeof def.baseHp === "number") {
    hp = def.baseHp;
    maxHp = def.baseHp;
  }

  // Attack/Defense for inspect panel:
  // - Prefer runtime values (enemy actor stats).
  // - If missing, aggregate from follower definition + record (includes gear).
  // - Finally fall back to definition base stats.
  let atk = null;
  let defense = null;

  if (typeof runtime.atk === "number") atk = runtime.atk;
  if (typeof runtime.def === "number") defense = runtime.def;

  if ((atk == null || defense == null) && def) {
    try {
      const agg = aggregateFollowerAtkDef(def, rec || {});
      if (atk == null && typeof agg.atk === "number") atk = agg.atk;
      if (defense == null && typeof agg.def === "number") defense = agg.def;
    } catch (_) {}
  }

  if (atk == null && def && typeof def.baseAtk === "number") atk = def.baseAtk;
  if (defense == null && def && typeof def.baseDef === "number") defense = def.baseDef;

  const faction = runtime.faction || (def && def.faction) || "";
  const roles = Array.isArray(def && def.roles) ? def.roles.slice() : [];

  const race = (rec && rec.race) || (def && def.race) || null;
  const subrace = (rec && rec.subrace) || (def && def.subrace) || null;
  const background = (rec && rec.background) || (def && def.background) || null;

  const tags =
    rec && Array.isArray(rec.tags) && rec.tags.length
      ? rec.tags.slice()
      : def && Array.isArray(def.tags)
        ? def.tags.slice()
        : [];

  const personalityTags =
    rec && Array.isArray(rec.personalityTags) && rec.personalityTags.length
      ? rec.personalityTags.slice()
      : def && Array.isArray(def.personalityTags)
        ? def.personalityTags.slice()
        : [];

  const temperament = (rec && rec.temperament) || (def && def.temperament) || null;
  const hint = (def && def.hint) || null;

  const glyph = (def && def.glyph) || runtime.glyph || "?";
  const color = (def && def.color) || runtime.color || "#ffffff";

  // Simple follower XP view: mirror normalized follower record when present.
  const xp = rec && typeof rec.xp === "number" ? rec.xp : 0;
  const xpNext = rec && typeof rec.xpNext === "number" && rec.xpNext > 0 ? rec.xpNext : 0;

  // Follower equipment and inventory are stored on the follower record and are
  // exposed to the UI as-is for read-only display.
  let equipment = null;
  try {
    if (rec && rec.equipment && typeof rec.equipment === "object") {
      equipment = {
        left: rec.equipment.left || null,
        right: rec.equipment.right || null,
        head: rec.equipment.head || null,
        torso: rec.equipment.torso || null,
        legs: rec.equipment.legs || null,
        hands: rec.equipment.hands || null,
      };
    } else if (runtime && runtime.equipment && typeof runtime.equipment === "object") {
      equipment = {
        left: runtime.equipment.left || null,
        right: runtime.equipment.right || null,
        head: runtime.equipment.head || null,
        torso: runtime.equipment.torso || null,
        legs: runtime.equipment.legs || null,
        hands: runtime.equipment.hands || null,
      };
    }
  } catch (_) {}

  let inventory = [];
  try {
    if (rec && Array.isArray(rec.inventory)) {
      inventory = rec.inventory.slice();
    }
  } catch (_) {}

  // Simple per-follower mode for commands (e.g., follow / wait); default to follow.
  const mode = rec && (rec.mode === "wait" || rec.mode === "follow") ? rec.mode : "follow";

  // Mirror player injury system: expose follower injuries to the inspect view.
  let injuries = [];
  try {
    if (rec && Array.isArray(rec.injuries)) {
      injuries = rec.injuries.slice();
    }
  } catch (_) {}

  return {
    id,
    name,
    level,
    hp,
    maxHp,
    atk,
    def: defense,
    faction,
    roles,
    race,
    subrace,
    background,
    tags,
    personalityTags,
    temperament,
    hint,
    glyph,
    color,
    equipment,
    inventory,
    mode,
    injuries,
    xp,
    xpNext,
  };
}

export function showFollower(ctx, runtime) {
  const u = U(ctx);
  if (!u || typeof u.showFollower !== "function") return;
  const view = buildFollowerView(ctx, runtime);
  if (!view) return;
  let wasOpen = false;
  try {
    if (u && typeof u.isFollowerOpen === "function") wasOpen = !!u.isFollowerOpen();
  } catch (_) {}
  u.showFollower(ctx, view);
  if (!wasOpen) requestDraw(ctx);
}

export function hideFollower(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isFollowerOpen === "function") wasOpen = !!u.isFollowerOpen();
  } catch (_) {}
  if (u && typeof u.hideFollower === "function") {
    u.hideFollower(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isFollowerOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isFollowerOpen === "function") return !!u.isFollowerOpen();
  } catch (_) {}
  return false;
}
