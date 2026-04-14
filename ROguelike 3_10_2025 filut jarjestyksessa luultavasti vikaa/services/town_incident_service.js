import { getMod } from "../utils/access.js";

function currentTurn(ctx) {
  try {
    return ctx && ctx.time && typeof ctx.time.turnCounter === "number"
      ? (ctx.time.turnCounter | 0)
      : 0;
  } catch (_) {
    return 0;
  }
}

function currentTownRecord(ctx) {
  try {
    if (!ctx || !ctx.worldReturnPos || !Array.isArray(ctx.world?.towns)) return null;
    const wx = ctx.worldReturnPos.x | 0;
    const wy = ctx.worldReturnPos.y | 0;
    return ctx.world.towns.find(t => t && (t.x | 0) === wx && (t.y | 0) === wy) || null;
  } catch (_) {
    return null;
  }
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function isFreeTownFloor(ctx, x, y) {
  try {
    const TR = ctx && (ctx.TownRuntime || getMod(ctx, "TownRuntime") || (typeof window !== "undefined" ? window.TownRuntime : null));
    if (TR && typeof TR.isFreeTownFloor === "function") {
      return !!TR.isFreeTownFloor(ctx, x, y);
    }
  } catch (_) {}
  try {
    if (!ctx || typeof ctx.inBounds !== "function" || !ctx.inBounds(x, y)) return false;
    const tile = ctx.map && ctx.map[y] ? ctx.map[y][x] : null;
    if (tile !== ctx.TILES.FLOOR && tile !== ctx.TILES.DOOR && tile !== ctx.TILES.ROAD) return false;
    if (ctx.player && ctx.player.x === x && ctx.player.y === y) return false;
    if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && !n._dead && n.x === x && n.y === y)) return false;
    if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p && p.x === x && p.y === y)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function rebuildOccupancy(ctx) {
  try {
    const TR = ctx && (ctx.TownRuntime || getMod(ctx, "TownRuntime") || (typeof window !== "undefined" ? window.TownRuntime : null));
    if (TR && typeof TR.rebuildOccupancy === "function") {
      TR.rebuildOccupancy(ctx);
      return true;
    }
  } catch (_) {}
  return false;
}

function inBounds(ctx, x, y) {
  try {
    return !!(ctx && typeof ctx.inBounds === "function" && ctx.inBounds(x, y));
  } catch (_) {
    return false;
  }
}

function findNearbySpots(ctx, anchor, count, opts = {}) {
  const spots = [];
  if (!ctx || !anchor) return spots;
  const maxRadius = Math.max(2, opts.maxRadius | 0 || 6);
  const building = opts.building || null;

  function insideBuilding(x, y) {
    if (!building) return true;
    return x > building.x && x < (building.x + building.w - 1) && y > building.y && y < (building.y + building.h - 1);
  }

  for (let r = 0; r <= maxRadius && spots.length < count; r++) {
    for (let dy = -r; dy <= r && spots.length < count; dy++) {
      for (let dx = -r; dx <= r && spots.length < count; dx++) {
        const x = (anchor.x | 0) + dx;
        const y = (anchor.y | 0) + dy;
        if (!inBounds(ctx, x, y)) continue;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!insideBuilding(x, y)) continue;
        if (!isFreeTownFloor(ctx, x, y)) continue;
        spots.push({ x, y });
      }
    }
  }
  return spots;
}

function findGuardAnchor(ctx, fallback) {
  try {
    if (ctx && ctx.townExitAt) return { x: ctx.townExitAt.x | 0, y: ctx.townExitAt.y | 0 };
    if (ctx && ctx.townPlaza) return { x: ctx.townPlaza.x | 0, y: ctx.townPlaza.y | 0 };
  } catch (_) {}
  return fallback ? { x: fallback.x | 0, y: fallback.y | 0 } : null;
}

function findIncidentAnchor(ctx, type) {
  try {
    if (type === "inn_brawl" && ctx && ctx.tavern && ctx.tavern.building) {
      const b = ctx.tavern.building;
      return {
        x: Math.max(b.x + 1, Math.min(b.x + b.w - 2, (b.x + ((b.w / 2) | 0)))),
        y: Math.max(b.y + 1, Math.min(b.y + b.h - 2, (b.y + ((b.h / 2) | 0)))),
        building: b,
        site: "inn_commons",
      };
    }
    if (type === "thief_chase") {
      if (ctx && ctx.townPlaza) return { x: ctx.townPlaza.x | 0, y: ctx.townPlaza.y | 0, site: "market_square" };
      if (ctx && ctx.tavern && ctx.tavern.door) return { x: ctx.tavern.door.x | 0, y: ctx.tavern.door.y | 0, site: "inn_commons" };
      if (ctx && ctx.townExitAt) return { x: ctx.townExitAt.x | 0, y: ctx.townExitAt.y | 0, site: "gate_ward" };
    }
  } catch (_) {}
  try {
    if (ctx && ctx.townPlaza) return { x: ctx.townPlaza.x | 0, y: ctx.townPlaza.y | 0, site: "market_square" };
  } catch (_) {}
  return null;
}

function normalizeIncident(incident) {
  if (!incident || typeof incident !== "object") return null;
  if (!incident.id) incident.id = `incident:${Date.now()}`;
  if (!incident.type) incident.type = "inn_brawl";
  if (!incident.status) incident.status = "live";
  if (!incident.site) incident.site = incident.type === "inn_brawl" ? "inn_commons" : "market_square";
  if (typeof incident.spawnedActors !== "boolean") incident.spawnedActors = false;
  if (typeof incident.playerIntervened !== "boolean") incident.playerIntervened = false;
  if (!Object.prototype.hasOwnProperty.call(incident, "outcome")) incident.outcome = null;
  return incident;
}

function clearExpiredIncident(rec, turn) {
  if (!rec || !rec.gmIncident) return null;
  const incident = normalizeIncident(rec.gmIncident);
  if (!incident) {
    delete rec.gmIncident;
    return null;
  }
  if (incident.status !== "live" && typeof incident.aftermathUntilTurn === "number" && turn > (incident.aftermathUntilTurn | 0)) {
    delete rec.gmIncident;
    return null;
  }
  return incident;
}

function incidentMessage(type, status) {
  const rumored = {
    inn_brawl: "The inn commons sounds tense, and everyone expects one more shove to start a fight.",
    thief_chase: "People near the market square keep glancing over their shoulders, waiting for a thief to make a run for it.",
  };
  const live = {
    inn_brawl: "The inn commons is one shove away from a fight.",
    thief_chase: "Guards are searching for a thief near the market square.",
  };
  const resolved = {
    inn_brawl: "The guards restored order at the inn, though nobody has stopped talking about it.",
    thief_chase: "The stolen goods were recovered, and the market square is settling down again.",
  };
  const escaped = {
    inn_brawl: "The inn has gone quiet again, but the bruises are still fresh.",
    thief_chase: "The thief got away, and everyone in town has a different story about it.",
  };
  if (status === "rumored") return rumored[type] || rumored.inn_brawl;
  if (status === "live") return live[type] || live.inn_brawl;
  if (status === "escaped") return escaped[type] || escaped.inn_brawl;
  return resolved[type] || resolved.inn_brawl;
}

function spawnIncidentNpc(ctx, data) {
  const npc = Object.assign({
    lines: [],
    level: 1,
    atk: 2,
    hp: 18,
    maxHp: 18,
    hostile: true,
    faction: "town_incident",
    type: "town_incident",
    isTownIncident: true,
  }, data || {});
  ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
  ctx.npcs.push(npc);
  return npc;
}

function ensureResponders(ctx, incident, anchor, count = 1) {
  const guardAnchor = findGuardAnchor(ctx, anchor);
  if (!guardAnchor) return 0;
  const spots = findNearbySpots(ctx, guardAnchor, Math.max(1, count | 0), { maxRadius: 4 });
  let spawned = 0;
  for (let i = 0; i < spots.length && spawned < count; i++) {
    const pos = spots[i];
    spawnIncidentNpc(ctx, {
      x: pos.x,
      y: pos.y,
      name: spawned === 0 ? "Guard responder" : `Guard responder ${spawned + 1}`,
      lines: ["Clear the way!", "Stand down!"],
      isGuard: true,
      guard: true,
      guardType: "guard",
      incidentRole: "guard_responder",
      incidentFaction: "responder",
      incidentType: incident.type,
      _townIncidentId: incident.id,
      hostile: false,
      faction: "guard",
      type: "guard",
      atk: 3,
      hp: 22,
      maxHp: 22,
      _guardPost: { x: pos.x, y: pos.y },
    });
    spawned++;
  }
  return spawned;
}

export function getCurrentTownIncident(ctx) {
  const rec = currentTownRecord(ctx);
  if (!rec) return null;
  return clearExpiredIncident(rec, currentTurn(ctx));
}

export function isTownIncidentCombatant(npc) {
  return !!(npc && npc.isTownIncident && !npc._dead && npc.incidentFaction === "culprit");
}

export function markTownIncidentPlayerIntervened(ctx, incidentId) {
  const incident = getCurrentTownIncident(ctx);
  if (!incident) return false;
  if (incidentId && incident.id !== incidentId) return false;
  incident.playerIntervened = true;
  return true;
}

export function getTownIncidentRumor(ctx) {
  const incident = getCurrentTownIncident(ctx);
  if (!incident) return null;
  return {
    source: "incident",
    status: String(incident.status || ""),
    type: String(incident.type || ""),
    tone: incident.status === "live" ? "warn" : "info",
    text: incidentMessage(incident.type, incident.status),
    cta: "",
  };
}

export function maybeArmTownIncidentFromGM(ctx, intent) {
  const rec = currentTownRecord(ctx);
  if (!rec || !intent || intent.kind !== "flavor") return null;
  const topic = typeof intent.topic === "string" ? intent.topic : "";
  if (!topic.startsWith("town_trouble:")) return null;

  const existing = clearExpiredIncident(rec, currentTurn(ctx));
  if (existing) return existing;

  const type = topic.slice("town_trouble:".length) || "inn_brawl";
  const anchor = findIncidentAnchor(ctx, type);
  if (!anchor) return null;

  const turn = currentTurn(ctx);
  const immediate = !!intent.forceImmediate;
  rec.gmIncident = normalizeIncident({
    id: `incident:${type}:${turn}:${rec.x | 0},${rec.y | 0}`,
    type,
    site: anchor.site,
    status: immediate ? "live" : "rumored",
    createdTurn: turn,
    escalatesAtTurn: immediate ? turn : (turn + 8),
    resolvedTurn: null,
    aftermathUntilTurn: null,
    spawnedActors: false,
    playerIntervened: false,
    outcome: null,
  });

  try {
    const GM = ctx && (ctx.GMRuntime || getMod(ctx, "GMRuntime") || (typeof window !== "undefined" ? window.GMRuntime : null));
    if (GM && typeof GM.getState === "function") {
      const gm = GM.getState(ctx);
      if (gm && gm.storyFlags && typeof gm.storyFlags === "object") {
        gm.storyFlags.lastTownIncidentTurn = turn;
        gm.storyFlags.lastTownIncidentTownKey = `${rec.x | 0},${rec.y | 0}`;
      }
    }
  } catch (_) {}

  return rec.gmIncident;
}

export function materializeTownIncident(ctx) {
  const incident = getCurrentTownIncident(ctx);
  if (!incident || incident.status !== "live" || incident.spawnedActors) return false;

  const anchor = findIncidentAnchor(ctx, incident.type);
  if (!anchor) return false;
  ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];

  if (incident.type === "inn_brawl") {
    const spots = findNearbySpots(ctx, anchor, 2, { maxRadius: 4, building: anchor.building || null });
    if (spots.length < 2) return false;
    spawnIncidentNpc(ctx, {
      x: spots[0].x,
      y: spots[0].y,
      name: "Drunken brawler",
      lines: ["You looking at me?", "This isn't over!"],
      incidentRole: "brawler",
      incidentFaction: "culprit",
      incidentType: incident.type,
      _townIncidentId: incident.id,
      brawlSide: "red",
      atk: 3,
      hp: 16,
      maxHp: 16,
    });
    spawnIncidentNpc(ctx, {
      x: spots[1].x,
      y: spots[1].y,
      name: "Rival brawler",
      lines: ["Say that again.", "Keep your hands off me!"],
      incidentRole: "brawler",
      incidentFaction: "culprit",
      incidentType: incident.type,
      _townIncidentId: incident.id,
      brawlSide: "blue",
      atk: 3,
      hp: 16,
      maxHp: 16,
    });
    ensureResponders(ctx, incident, anchor, 1);
    try {
      ctx.log && ctx.log("Shouts erupt from the inn as a tavern brawl spills into view.", "notice");
    } catch (_) {}
  } else if (incident.type === "thief_chase") {
    const thiefSpots = findNearbySpots(ctx, anchor, 1, { maxRadius: 4 });
    if (!thiefSpots.length) return false;
    spawnIncidentNpc(ctx, {
      x: thiefSpots[0].x,
      y: thiefSpots[0].y,
      name: "Cornered thief",
      lines: ["Out of the way!", "You'll never catch me!"],
      incidentRole: "thief",
      incidentFaction: "culprit",
      incidentType: incident.type,
      _townIncidentId: incident.id,
      atk: 2,
      hp: 14,
      maxHp: 14,
      _thiefEscape: ctx.townExitAt ? { x: ctx.townExitAt.x | 0, y: ctx.townExitAt.y | 0 } : null,
    });
    ensureResponders(ctx, incident, anchor, 2);
    try {
      ctx.log && ctx.log("A thief darts through town with guards close behind.", "notice");
    } catch (_) {}
  } else {
    return false;
  }

  incident.spawnedActors = true;
  rebuildOccupancy(ctx);
  return true;
}

export function resolveTownIncident(ctx, outcome = "resolved") {
  const rec = currentTownRecord(ctx);
  const incident = rec ? getCurrentTownIncident(ctx) : null;
  if (!rec || !incident) return false;

  const turn = currentTurn(ctx);
  incident.status = outcome === "escaped" ? "escaped" : "resolved";
  incident.outcome = incident.status;
  incident.resolvedTurn = turn;
  incident.aftermathUntilTurn = turn + 360;
  incident.spawnedActors = false;
  incident._pendingEscape = false;

  if (Array.isArray(ctx.npcs)) {
    ctx.npcs = ctx.npcs.filter(n => !(n && n.isTownIncident && n._townIncidentId === incident.id));
  }
  rebuildOccupancy(ctx);

  try {
    const msg = incidentMessage(incident.type, incident.status);
    if (msg && ctx && typeof ctx.log === "function") ctx.log(msg, incident.status === "escaped" ? "warn" : "good");
  } catch (_) {}

  return true;
}

export function tickTownIncident(ctx) {
  const incident = getCurrentTownIncident(ctx);
  if (!incident) return false;

  if (incident.status === "rumored") {
    const turn = currentTurn(ctx);
    const escalateAt = typeof incident.escalatesAtTurn === "number" ? (incident.escalatesAtTurn | 0) : turn;
    if (turn < escalateAt) return false;
    incident.status = "live";
    incident.spawnedActors = false;
    try {
      const msg = incidentMessage(incident.type, incident.status);
      if (msg && ctx && typeof ctx.log === "function") ctx.log(msg, "notice");
    } catch (_) {}
  }

  if (incident.status === "live" && incident.spawnedActors !== true) {
    materializeTownIncident(ctx);
  }

  if (incident.status !== "live") return false;

  if (incident._pendingEscape === true) {
    return resolveTownIncident(ctx, "escaped");
  }

  const npcs = Array.isArray(ctx && ctx.npcs) ? ctx.npcs : [];
  const culprits = npcs.filter(n => n && n.isTownIncident && n._townIncidentId === incident.id && n.incidentFaction === "culprit" && !n._dead);

  if (!culprits.length) {
    return resolveTownIncident(ctx, "resolved");
  }

  return false;
}

export function exportTownIncident(ctx) {
  const incident = getCurrentTownIncident(ctx);
  return incident ? cloneJson(incident) : null;
}

if (typeof window !== "undefined") {
  window.TownIncidentService = {
    getCurrentTownIncident,
    getTownIncidentRumor,
    maybeArmTownIncidentFromGM,
    materializeTownIncident,
    tickTownIncident,
    resolveTownIncident,
    isTownIncidentCombatant,
    markTownIncidentPlayerIntervened,
    exportTownIncident,
  };
}
