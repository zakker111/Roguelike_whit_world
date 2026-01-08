/**
 * Dungeon killEnemy (Phase 4 extraction): enemy death handling, loot, XP, occupancy, persistence.
 */
import { save } from "./state.js";

export function killEnemy(ctx, enemy) {
  if (!ctx || !enemy) return;

  // If this enemy is a player follower/ally, permanently remove it from the
  // player's followers list so it does not respawn on future entries.
  let followerRecord = null;
  try {
    if (enemy._isFollower && enemy._followerId && ctx.player && Array.isArray(ctx.player.followers)) {
      const followers = ctx.player.followers;
      let removedName = null;
      for (let i = 0; i < followers.length; i++) {
        const f = followers[i];
        if (!f) continue;
        if (String(f.id) === String(enemy._followerId)) {
          followerRecord = f;
          removedName = f.name || enemy.name || "Your follower";
          followers.splice(i, 1);
          break;
        }
      }
      if (removedName && ctx.log) {
        ctx.log(`${removedName} falls in battle and will not return.`, "bad");
      }
    }
  } catch (_) {}

  // Announce death
  try {
    const Cap = (ctx.utils && typeof ctx.utils.capitalize === "function") ? ctx.utils.capitalize : (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const name = Cap(enemy.type || "enemy");
    ctx.log && ctx.log(`${name} dies.`, "bad");
  } catch (_) {}

  // Generate loot
  let loot = [];
  try {
    if (ctx.Loot && typeof ctx.Loot.generate === "function") {
      loot = ctx.Loot.generate(ctx, enemy) || [];
    }
  } catch (_) { loot = []; }

  // If this was a follower, merge their equipped gear and inventory into the corpse loot.
  // This preserves current decay/wear state by moving the live item objects.
  if (followerRecord) {
    try {
      const eq = followerRecord.equipment && typeof followerRecord.equipment === "object"
        ? followerRecord.equipment
        : {};
      const inv = Array.isArray(followerRecord.inventory) ? followerRecord.inventory : [];
      const seenItems = new Set();
      const slots = ["left", "right", "head", "torso", "legs", "hands"];

      // Equipped gear
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const it = eq && eq[slot];
        if (!it) continue;
        if (seenItems.has(it)) continue;
        loot.push(it);
        seenItems.add(it);
      }

      // Inventory items
      for (let i = 0; i < inv.length; i++) {
        const it = inv[i];
        if (!it) continue;
        if (seenItems.has(it)) continue;
        loot.push(it);
        seenItems.add(it);
      }
    } catch (_) {}
  }

  // Build flavor metadata from last hit info if available (JSON-driven via FlavorService)
  const last = enemy._lastHit || null;
  let meta = null;
  try {
    const FS = (typeof window !== "undefined" ? window.FlavorService : null);
    if (FS && typeof FS.buildCorpseMeta === "function") {
      meta = FS.buildCorpseMeta(ctx, enemy, last);
    }
  } catch (_) { meta = null; }
  if (!meta) {
    // Fallback inline flavor
    function flavorFromLastHit(lh) {
      if (!lh) return null;
      const part = lh.part || "torso";
      const killer = lh.by || "unknown";
      const via = lh.weapon ? lh.weapon : (lh.via || "attack");
      let wound = "";
      if (part === "head") wound = lh.crit ? "head crushed into pieces" : "wound to the head";
      else if (part === "torso") wound = lh.crit ? "deep gash across the torso" : "bleeding cut in torso";
      else if (part === "legs") wound = lh.crit ? "leg shattered beyond use" : "wound to the leg";
      else if (part === "hands") wound = lh.crit ? "hands mangled" : "cut on the hand";
      else wound = "fatal wound";
      const killedBy = (killer === "player") ? "you" : killer;
      return { killedBy, wound, via };
    }
    meta = flavorFromLastHit(last);
  }

  // Place corpse with flavor meta
  try {
    ctx.corpses = Array.isArray(ctx.corpses) ? ctx.corpses : [];
    ctx.corpses.push({
      x: enemy.x,
      y: enemy.y,
      loot,
      looted: loot.length === 0,
      meta: meta || undefined
    });
  } catch (_) {}

  // Remove enemy from list
  try {
    if (Array.isArray(ctx.enemies)) {
      ctx.enemies = ctx.enemies.filter(e => e !== enemy);
    }
  } catch (_) {}

  // Clear occupancy
  try {
    if (ctx.occupancy && typeof ctx.occupancy.clearEnemy === "function") {
      ctx.occupancy.clearEnemy(enemy.x, enemy.y);
    }
  } catch (_) {}

  // Award XP when the last hit was by the player or by a follower ally.
  const xp = (typeof enemy.xp === "number") ? enemy.xp : 5;
  let awardXp = false;
  try {
    const last = enemy._lastHit || null;
    const byStr = last && last.by ? String(last.by).toLowerCase() : "";
    // Player kills: by === "player"
    // Follower kills: last.isFollower is true (set by AI when killer is a follower)
    awardXp = (byStr === "player") || !!(last && last.isFollower);
  } catch (_) { awardXp = false; }
  if (awardXp) {
    try {
      if (ctx.Player && typeof ctx.Player.gainXP === "function") {
        ctx.Player.gainXP(ctx.player, xp, { log: ctx.log, updateUI: ctx.updateUI });
      } else if (typeof window !== "undefined" && window.Player && typeof window.Player.gainXP === "function") {
        window.Player.gainXP(ctx.player, xp, { log: ctx.log, updateUI: ctx.updateUI });
      } else {
        ctx.player.xp = (ctx.player.xp || 0) + xp;
        ctx.log && ctx.log(`You gain ${xp} XP.`);
        while (ctx.player.xp >= ctx.player.xpNext) {
          ctx.player.xp -= ctx.player.xpNext;
          ctx.player.level = (ctx.player.level || 1) + 1;
          ctx.player.maxHp = (ctx.player.maxHp || 1) + 2;
          ctx.player.hp = ctx.player.maxHp;
          if ((ctx.player.level % 2) === 0) ctx.player.atk = (ctx.player.atk || 1) + 1;
          ctx.player.xpNext = Math.floor((ctx.player.xpNext || 20) * 1.3 + 10);
          ctx.log && ctx.log(`You are now level ${ctx.player.level}. Max HP increased.`, "good");
        }
        ctx.updateUI && ctx.updateUI();
      }
    } catch (_) {}
  }

  // Persist dungeon state so corpses remain on revisit
  try { save(ctx, false); } catch (_) {}
}