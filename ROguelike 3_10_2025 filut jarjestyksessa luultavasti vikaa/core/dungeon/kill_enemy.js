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

  // Award XP to the player when the last hit was by the player.
  // Followers do not share this XP; they gain their own XP only for kills they land.
  const xp = (typeof enemy.xp === "number") ? enemy.xp : 5;
  let awardPlayerXp = false;
  try {
    const last = enemy._lastHit || null;
    const byStr = last && last.by ? String(last.by).toLowerCase() : "";
    awardPlayerXp = (byStr === "player");
  } catch (_) { awardPlayerXp = false; }
  if (awardPlayerXp) {
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

  // Award XP directly to a follower when they land the killing blow (no sharing with others).
  try {
    const last = enemy._lastHit || null;
    if (last && last.isFollower && ctx.player && Array.isArray(ctx.player.followers)) {
      const fid = last && last.isFollower && last.killerName
        ? String(last.killerName)
        : null;
      const followers = ctx.player.followers;
      // Match on follower id when possible, else by name as a fallback.
      let rec = null;
      if (fid) {
        for (let i = 0; i < followers.length; i++) {
          const f = followers[i];
          if (!f) continue;
          if (String(f.id || "") === fid || String(f.name || "") === fid) {
            rec = f;
            break;
          }
        }
      }
      if (!rec) {
        // Fallback: match by name from _lastHit.killerName
        const kName = last.killerName ? String(last.killerName) : null;
        if (kName) {
          for (let i = 0; i < followers.length && !rec; i++) {
            const f = followers[i];
            if (!f) continue;
            if (String(f.name || "") === kName) rec = f;
          }
        }
      }
      if (rec) {
        if (typeof rec.xp !== "number") rec.xp = 0;
        if (typeof rec.xpNext !== "number" || rec.xpNext <= 0) rec.xpNext = 20;
        rec.xp += xp;
        let leveled = false;
        while (rec.xp >= rec.xpNext) {
          rec.xp -= rec.xpNext;
          rec.level = Math.max(1, ((rec.level | 0) || 1) + 1);
          rec.maxHp = (typeof rec.maxHp === "number" ? rec.maxHp : 10) + 2;
          rec.hp = rec.maxHp;
          rec.xpNext = Math.floor(rec.xpNext * 1.25 + 5);
          leveled = true;
          try {
            ctx.log && ctx.log(`${rec.name || "Your follower"} reaches level ${rec.level}.`, "good");
          } catch (_) {}
        }
        if (leveled && ctx.Player && typeof ctx.Player.forceUpdate === "function") {
          try { ctx.Player.forceUpdate(ctx.player); } catch (_) {}
        }
      }
    }
  } catch (_) {}

  // Persist dungeon state so corpses remain on revisit
  try { save(ctx, false); } catch (_) {}

  // GMRuntime: observational combat kill event
  try {
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
    if (GM && typeof GM.onEvent === "function") {
      const tags = [];
      try {
        const faction = enemy.faction ? String(enemy.faction).toLowerCase() : "";
        if (faction) tags.push(`faction:${faction}`);
      } catch (_) {}
      try {
        const kind = enemy.kind ? String(enemy.kind).toLowerCase() : "";
        if (kind) tags.push(`kind:${kind}`);
      } catch (_) {}
      try {
        const race = enemy.race ? String(enemy.race).toLowerCase() : "";
        if (race) tags.push(`race:${race}`);
      } catch (_) {}
      // NEW: ensure we always have a kind:* family tag when possible
      try {
        const hasKind = tags.some((t) => t && String(t).toLowerCase().startsWith("kind:"));
        if (!hasKind) {
          const typeStr = enemy.type ? String(enemy.type).toLowerCase() : "";
          if (typeStr) tags.push(`kind:${typeStr}`);
        }
      } catch (_) {}
      try {
        const ctxMode = ctx && ctx.mode ? String(ctx.mode).toLowerCase() : "";
        if (ctxMode === "town") tags.push("context:town");
        else if (ctxMode === "castle") tags.push("context:castle");
        else if (ctxMode === "dungeon") tags.push("context:dungeon");
      } catch (_) {}
      GM.onEvent(ctx, {
        type: "combat.kill",
        scope: ctx && ctx.mode ? ctx.mode : "dungeon",
        enemyId: String(enemy.type || enemy.id || "unknown"),
        tags,
        isBoss: !!enemy.isBoss,
      });
    }
  } catch (_) {}
}