/**
 * FlavorService: centralized flavor generation from a single JSON file.
 *
 * Loads window.GameData.flavor and produces corpse meta and descriptions consistently
 * for dungeon and encounter modes, including animals and humanoids.
 *
 * API (ESM + window.FlavorService):
 *  - buildCorpseMeta(ctx, enemy, lastHit) -> { killedBy, wound, via }
 *  - describeCorpse(meta) -> "Wound: ... Killed by ... (via ...)"
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
  const killedBy = killerNames[killerRaw] || killerRaw;
  const via = lastHit?.weapon ? `with ${lastHit.weapon}` : (lastHit?.via || "melee");

  return { killedBy, wound, via };
}

export function describeCorpse(meta) {
  if (!meta) return "";
  const killerStr = meta.killedBy ? `Killed by ${meta.killedBy}.` : "";
  const woundStr = meta.wound ? `Wound: ${meta.wound}.` : "";
  const viaStr = meta.via ? `(${meta.via})` : "";
  const parts = [woundStr, killerStr].filter(Boolean).join(" ");
  return `${parts} ${viaStr}`.trim();
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.FlavorService = { buildCorpseMeta, describeCorpse };
}