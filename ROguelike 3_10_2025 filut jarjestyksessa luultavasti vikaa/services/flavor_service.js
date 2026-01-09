/**
 * FlavorService: centralized flavor generation from a single JSON file.
 *
 * Loads window.GameData.flavor and produces corpse meta and descriptions consistently
 * for dungeon and encounter modes, including animals and humanoids.
 *
 * API (ESM + window.FlavorService):
 *  - buildCorpseMeta(ctx, enemy, lastHit) -> { victim, killedBy, wound, via, likely }
 *  - describeCorpse(meta) -> "<Victim> corpse. Wound: ... Killed by ... (iron mace)" or
 *                            "<Victim> corpse. Wound: ... Likely caused by sword. Killed by orc."
 */

function pick(obj, path) {
  if (!obj || !path) return null;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return null;
    cur = cur[p];
  }
  return cur;
}

function getFlavorRoot() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    return GD && GD.flavor ? GD.flavor : null;
  } catch (_) { return null; }
}

function resolveWeaponKind(lastHit) {
  // Infer weapon kind from item tags or name when possible
  const name = (lastHit && lastHit.weapon) ? String(lastHit.weapon).toLowerCase() : "";
  if (!name) return null;
  if (/(mace|club|hammer|maul|staff)/i.test(name)) return "blunt";
  if (/(sword|axe|dagger|blade|knife|spear)/i.test(name)) return "sharp";
  if (/(bow|arrow|bolt|crossbow)/i.test(name)) return "piercing";
  if (/(fire|flame|burn)/i.test(name)) return "burn";
  if (/(ice|frost)/i.test(name)) return "freeze";
  return null;
}

function resolveEnemyKind(enemy) {
  const t = String(enemy?.type || "").toLowerCase();
  if (/wolf|bear|boar|dog|cat|fox|animal/.test(t)) return "animal";
  if (/undead|skeleton|zombie|ghoul|ghost/.test(t)) return "undead";
  if (/troll|ogre|giant/.test(t)) return "giant";
  return "default";
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function likelyCauseFromKillerName(killerName) {
  const k = String(killerName || "").toLowerCase();
  if (!k || k === "unknown" || k === "status") return null;
  if (/(orc|bandit|knight|soldier|guard|goblin)/.test(k)) return "sword";
  if (/(troll|ogre|giant|golem)/.test(k)) return "blunt weapon";
  if (/(wolf|bear|boar|cat|dog|fox)/.test(k)) return "claws or teeth";
  if (/(archer)/.test(k)) return "arrows";
  return null;
}

export function buildCorpseMeta(ctx, enemy, lastHit) {
  const FL = getFlavorRoot();
  const profiles = pick(FL, "death") || {};
  const killerNames = pick(FL, "killerNames") || { player: "you" };

  const part = (lastHit?.part) || "torso";
  const crit = !!(lastHit?.crit);
  const weaponKind = resolveWeaponKind(lastHit);
  const enemyKind = resolveEnemyKind(enemy);

  // priority chain: weaponKind -> enemyKind -> default
  const sources = [];
  if (weaponKind && profiles[weaponKind]) sources.push(profiles[weaponKind]);
  if (enemyKind && profiles[enemyKind]) sources.push(profiles[enemyKind]);
  if (profiles.default) sources.push(profiles.default);

  // pick wound text from the first source that has the part
  let wound = "";
  for (const src of sources) {
    const partProf = src && src[part];
    if (partProf) {
      wound = crit ? (partProf.crit || partProf.normal || partProf.default || "")
                   : (partProf.normal || partProf.default || "");
      if (wound) break;
    }
  }
  if (!wound) {
    // fallback generic
    if (part === "head") wound = crit ? "skull crushed" : "wound to the head";
    else if (part === "torso") wound = crit ? "deep gash across the torso" : "bleeding cut in torso";
    else if (part === "legs") wound = crit ? "leg shattered beyond use" : "wound to the leg";
    else if (part === "hands") wound = crit ? "hands mangled" : "cut on the hand";
    else wound = "fatal wound";
  }

  const killerRaw = (lastHit?.by) || "unknown";
  let killedBy = killerNames[killerRaw] || killerRaw;

  // If the killer is one of the player's followers, prefer the follower's
  // current personalized name (e.g., "Oskari the Guard") over internal ids.
  try {
    if (ctx && ctx.player && Array.isArray(ctx.player.followers)) {
      const followers = ctx.player.followers;
      const candidates = [];
      if (killerRaw && killerRaw !== "player" && killerRaw !== "follower") {
        candidates.push(String(killerRaw));
      }
      if (lastHit && lastHit.killerName) {
        candidates.push(String(lastHit.killerName));
      }
      let hit = null;
      for (let i = 0; i < followers.length && !hit; i++) {
        const f = followers[i];
        if (!f) continue;
        const fid = String(f.id || "");
        const fname = String(f.name || "");
        if (candidates.includes(fid) || candidates.includes(fname)) {
          hit = f;
        }
      }
      if (hit && hit.name && typeof hit.name === "string") {
        killedBy = hit.name;
      }
    }
  } catch (_) {}
  // If lastHit carries an explicit killerName (e.g., from non-follower runtime),
  // prefer that over any generic mapping, but avoid overriding follower names.
  try {
    const isFollowerKiller = !!(lastHit && lastHit.isFollower);
    if (!isFollowerKiller && lastHit && typeof lastHit.killerName === "string" && lastHit.killerName.trim()) {
      killedBy = lastHit.killerName.trim();
    }
  } catch (_) {}

  // Prefer exact weapon if known, else try to provide a likely cause phrase
  const via = lastHit?.weapon ? `${lastHit.weapon}` : null;
  let likely = null;
  if (!via) {
    const fromWeaponKind = weaponKind === "blunt" ? "blunt weapon"
                        : weaponKind === "sharp" ? "sword or blade"
                        : weaponKind === "piercing" ? "arrows or bolts"
                        : weaponKind === "burn" ? "fire"
                        : weaponKind === "freeze" ? "ice"
                        : null;

    // Avoid guessing weapon type from killer name when the killer is a follower.
    // For followers we either know the exact weapon via lastHit.weapon or we
    // leave the cause unspecified rather than implying \"sword\".
    let fromKiller = null;
    const isFollowerKiller = !!(lastHit && lastHit.isFollower);
    if (!isFollowerKiller) {
      fromKiller = likelyCauseFromKillerName(killedBy);
    }

    likely = fromWeaponKind || fromKiller;
  }

  // Use the enemy's display name when available (e.g., follower names like
  // "Oskari the Guard") so corpses for allies and named foes show their
  // proper identity instead of raw type ids (guard_follower, thief_follower, etc.).
  const victimSource = (enemy && enemy.name) ? enemy.name : (enemy && enemy.type) ? enemy.type : "enemy";
  const victim = capitalize(String(victimSource));

  return { victim, killedBy, wound, via, likely };
}

export function describeCorpse(meta) {
  if (!meta) return "";
  const victimStr = meta.victim ? `${meta.victim} corpse.` : "Corpse.";
  const woundStr = meta.wound ? `Wound: ${meta.wound}.` : "";
  const killerStr = meta.killedBy ? `Killed by ${meta.killedBy}.` : "";
  // If exact weapon known, show like "(iron mace)"; otherwise if we have a likely cause, say "Likely caused by sword."
  const viaExact = meta.via ? `(${meta.via})` : "";
  const viaLikely = (!meta.via && meta.likely) ? `Likely caused by ${meta.likely}.` : "";
  const parts = [victimStr, woundStr, viaLikely, killerStr, viaExact].filter(Boolean).join(" ").trim();
  return parts;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.FlavorService = { buildCorpseMeta, describeCorpse };
}