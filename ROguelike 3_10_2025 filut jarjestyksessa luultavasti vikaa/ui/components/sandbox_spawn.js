/**
 * Sandbox spawn + entity helpers for the SandboxPanel (F10).
 *
 * Exports (ESM):
 * - classifyEntityId(id): "none" | "enemy" | "animal" | "custom"
 * - currentEnemyId(): string
 * - spawnWithCount(requestedCount: number | null): void
 *
 * Notes:
 * - This module lives in the UI layer and works only in the browser.
 * - It reads DOM inputs directly and talks to window.GameAPI / window.God.
 * - Core runtime changes (ctx.enemies, StateSync) still go through ctx.
 */

import { getMod } from "/utils/access.js";

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

function getAnimalDefById(id) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const list = GD && Array.isArray(GD.animals) ? GD.animals : null;
    if (!list) return null;
    const want = String(id || "").toLowerCase();
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || !row.id) continue;
      if (String(row.id).toLowerCase() === want) return row;
    }
  } catch (_) {}
  return null;
}

function isAnimalId(id) {
  return !!getAnimalDefById(id);
}

export function classifyEntityId(id) {
  const v = String(id || "").trim();
  if (!v) return "none";
  try {
    const EM = (typeof window !== "undefined" ? window.Enemies : null);
    if (EM && typeof EM.getDefById === "function" && EM.getDefById(v)) {
      return "enemy";
    }
  } catch (_) {}
  if (isAnimalId(v)) return "animal";
  return "custom";
}

export function currentEnemyId() {
  const input = byId("sandbox-enemy-id");
  if (!input) return "";
  return String(input.value || "").trim();
}

/**
 * Spawn helper shared by Spawn 1 / Spawn N for animal entities.
 * Mirrors the original sandbox_panel implementation but is now isolated here.
 */
function trySpawnAnimalById(ctx, id, count) {
  try {
    const def = getAnimalDefById(id);
    if (!def || !ctx || !ctx.map || !ctx.player) return false;

    let n = (Number(count) || 0) | 0;
    if (n < 1) n = 1;
    if (n > 50) n = 50;

    const isFreeFloor = (x, y) => {
      try {
        if (!ctx.inBounds || !ctx.inBounds(x, y)) return false;
        const t = ctx.map[y] && ctx.map[y][x];
        const walkable = (typeof ctx.isWalkable === "function")
          ? ctx.isWalkable(x, y)
          : (t === ctx.TILES.FLOOR || t === ctx.TILES.DOOR || t === ctx.TILES.STAIRS);
        if (!walkable) return false;
        if (ctx.player.x === x && ctx.player.y === y) return false;
        const occEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function")
          ? ctx.occupancy.hasEnemy(x, y)
          : (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y));
        if (occEnemy) return false;
        return true;
      } catch (_) {
        return false;
      }
    };

    const pickNearby = () => {
      const maxR = 5;
      const px = ctx.player.x | 0;
      const py = ctx.player.y | 0;

      for (let r = 1; r <= maxR; r++) {
        const candidates = [];
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== r) continue;
            const x = px + dx;
            const y = py + dy;
            if (isFreeFloor(x, y)) candidates.push({ x, y });
          }
        }
        if (candidates.length) {
          for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor((typeof ctx.rng === "function" ? ctx.rng() : Math.random()) * (i + 1));
            const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
          }
          return candidates[0];
        }
      }

      let best = null;
      let bestD = Infinity;
      const rows = ctx.map.length;
      const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (!isFreeFloor(x, y)) continue;
          const md = Math.abs(x - (ctx.player.x | 0)) + Math.abs(y - (ctx.player.y | 0));
          if (md < bestD) { bestD = md; best = { x, y }; }
        }
      }
      return best;
    };

    const spawned = [];
    if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
    const level = typeof ctx.floor === "number" ? (ctx.floor | 0) : 1;

    for (let i = 0; i < n; i++) {
      const spot = pickNearby();
      if (!spot) break;
      const hp = typeof def.hp === "number" ? def.hp : 3;
      const atk = typeof def.atk === "number" ? def.atk : 0.5;
      const glyph = def.glyph || (id && id.length ? id.charAt(0) : "?");
      const color = def.color || "#9ca3af";
      const faction = def.faction || "animal";
      const neutral = def.neutral !== false;
      const sightRadius = typeof def.sightRadius === "number" ? def.sightRadius : undefined;

      const e = {
        x: spot.x,
        y: spot.y,
        type: String(id),
        glyph,
        color,
        hp,
        atk,
        xp: 0,
        level,
        announced: false,
        faction,
        neutral,
      };
      if (sightRadius != null) e.sightRadius = sightRadius;
      ctx.enemies.push(e);
      spawned.push(e);
      try {
        if (ctx.log) ctx.log(`Sandbox: Spawned animal '${id}' at (${e.x},${e.y}).`, "notice");
      } catch (_) {}
    }

    if (spawned.length) {
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function spawnCustomSandboxEnemy(ctx, id, count) {
  try {
    if (!ctx || !ctx.map || !ctx.player) return false;

    let n = (Number(count) || 0) | 0;
    if (n < 1) n = 1;
    if (n > 50) n = 50;

    const isFreeFloor = (x, y) => {
      try {
        if (!ctx.inBounds || !ctx.inBounds(x, y)) return false;
        const t = ctx.map[y] && ctx.map[y][x];
        const walkable = (typeof ctx.isWalkable === "function")
          ? ctx.isWalkable(x, y)
          : (t === ctx.TILES.FLOOR || t === ctx.TILES.DOOR || t === ctx.TILES.STAIRS);
        if (!walkable) return false;
        if (ctx.player.x === x && ctx.player.y === y) return false;
        const occEnemy = (ctx.occupancy && typeof ctx.occupancy.hasEnemy === "function")
          ? ctx.occupancy.hasEnemy(x, y)
          : (Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y));
        if (occEnemy) return false;
        return true;
      } catch (_) {
        return false;
      }
    };

    const pickNearby = () => {
      const maxR = 5;
      const px = ctx.player.x | 0;
      const py = ctx.player.y | 0;

      for (let r = 1; r <= maxR; r++) {
        const candidates = [];
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== r) continue;
            const x = px + dx;
            const y = py + dy;
            if (isFreeFloor(x, y)) candidates.push({ x, y });
          }
        }
        if (candidates.length) {
          for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor((typeof ctx.rng === "function" ? ctx.rng() : Math.random()) * (i + 1));
            const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
          }
          return candidates[0];
        }
      }

      let best = null;
      let bestD = Infinity;
      const rows = ctx.map.length;
      const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (!isFreeFloor(x, y)) continue;
          const md = Math.abs(x - (ctx.player.x | 0)) + Math.abs(y - (ctx.player.y | 0));
          if (md < bestD) { bestD = md; best = { x, y }; }
        }
      }
      return best;
    };

    const overridesRoot = ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object"
      ? ctx.sandboxEnemyOverrides
      : null;
    const key = String(id || "");
    const override = overridesRoot ? (overridesRoot[key] || overridesRoot[key.toLowerCase()] || null) : null;

    const depthInput = byId("sandbox-test-depth");
    let depth = 1;
    if (override && typeof override.testDepth === "number") {
      depth = (override.testDepth | 0) || 1;
    } else if (depthInput && depthInput.value) {
      const v = (Number(depthInput.value) || 0) | 0;
      if (v > 0) depth = v;
    } else if (typeof ctx.floor === "number") {
      depth = (ctx.floor | 0) || 1;
    }

    const glyphInput = byId("sandbox-glyph");
    const colorInput = byId("sandbox-color");
    const factionInput = byId("sandbox-faction");
    const hpInput = byId("sandbox-hp");
    const atkInput = byId("sandbox-atk");
    const xpInput = byId("sandbox-xp");
    const dmgInput = byId("sandbox-damage-scale");

    const glyph = (override && typeof override.glyph === "string" && override.glyph)
      ? override.glyph
      : (glyphInput && glyphInput.value
          ? String(glyphInput.value)
          : (key && key.length ? key.charAt(0) : "?"));

    const color = (override && typeof override.color === "string" && override.color)
      ? override.color
      : (colorInput && colorInput.value ? String(colorInput.value) : "#cbd5e1");

    const faction = (override && typeof override.faction === "string" && override.faction)
      ? override.faction
      : (factionInput && factionInput.value ? String(factionInput.value) : "monster");

    const hp = (override && typeof override.hpAtDepth === "number")
      ? override.hpAtDepth
      : (hpInput && hpInput.value !== "" ? (Number(hpInput.value) || 3) : 3);

    const atk = (override && typeof override.atkAtDepth === "number")
      ? override.atkAtDepth
      : (atkInput && atkInput.value !== "" ? (Number(atkInput.value) || 1) : 1);

    const xp = (override && typeof override.xpAtDepth === "number")
      ? override.xpAtDepth
      : (xpInput && xpInput.value !== "" ? (Number(xpInput.value) || 1) : 1);

    const damageScale = (override && typeof override.damageScale === "number")
      ? override.damageScale
      : (dmgInput && dmgInput.value !== "" ? (Number(dmgInput.value) || 1) : 1);

    const spawned = [];
    if (!Array.isArray(ctx.enemies)) ctx.enemies = [];

    for (let i = 0; i < n; i++) {
      const spot = pickNearby();
      if (!spot) break;
      const e = {
        x: spot.x,
        y: spot.y,
        type: String(key),
        glyph,
        color,
        hp,
        atk,
        xp,
        level: depth,
        announced: false,
        damageScale,
        faction,
      };
      ctx.enemies.push(e);
      spawned.push(e);
      try {
        if (ctx.log) ctx.log(`Sandbox: Spawned custom enemy '${key}' at (${e.x},${e.y}).`, "notice");
      } catch (_) {}
    }

    if (spawned.length) {
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        }
      } catch (_) {}
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

export function spawnWithCount(requestedCount) {
  try {
    if (!window.GameAPI) return;
    const enemyId = currentEnemyId();
    if (!enemyId) {
      if (typeof window.GameAPI.log === "function") {
        window.GameAPI.log("Sandbox: Entity id is empty; cannot spawn.", "warn");
      }
      return;
    }

    let n = requestedCount;
    if (n == null) {
      const cntInput = byId("sandbox-enemy-count");
      if (cntInput) {
        n = (Number(cntInput.value) || 1) | 0;
      } else {
        n = 1;
      }
    }
    if (n < 1) n = 1;
    if (n > 50) n = 50;

    const ctx = (typeof window.GameAPI.getCtx === "function" ? window.GameAPI.getCtx() : null);
    const kind = classifyEntityId(enemyId);

    // Animal path: spawn neutral wildlife by id when selected entity comes from animals.json.
    if (ctx && kind === "animal") {
      const okA = trySpawnAnimalById(ctx, enemyId, n);
      if (!okA && typeof window.GameAPI.log === "function") {
        window.GameAPI.log(`Sandbox: Failed to spawn animal '${enemyId}'.`, "warn");
      }
      // Do not fall back to enemy spawning for animal ids.
      return;
    }

    // Custom sandbox-only enemy path: spawn directly from UI/overrides without requiring enemies.json.
    if (ctx && kind === "custom") {
      const okC = spawnCustomSandboxEnemy(ctx, enemyId, n);
      if (!okC && typeof window.GameAPI.log === "function") {
        window.GameAPI.log(`Sandbox: Failed to spawn custom enemy '${enemyId}'.`, "warn");
      }
      return;
    }

    let spawned = false;

    // Preferred path: call God.spawnEnemyById directly with live ctx when available.
    try {
      if (ctx && typeof window.God === "object" &&
          typeof window.God.spawnEnemyById === "function") {
        if (ctx.mode === "sandbox" || ctx.mode === "dungeon") {
          spawned = !!window.God.spawnEnemyById(ctx, enemyId, n);
        }
      }
    } catch (_) {
      spawned = false;
    }

    // Fallback to GameAPI helper if direct GOD call was unavailable or failed.
    if (!spawned && typeof window.GameAPI.spawnEnemyById === "function") {
      spawned = !!window.GameAPI.spawnEnemyById(enemyId, n);
    }

    // Final fallback: random nearby spawn if by-id helpers are missing.
    if (!spawned && typeof window.GameAPI.spawnEnemyNearby === "function") {
      spawned = !!window.GameAPI.spawnEnemyNearby(n);
      if (typeof window.GameAPI.log === "function") {
        window.GameAPI.log("Sandbox: spawnEnemyById not available; used random spawnEnemyNearby instead.", "warn");
      }
    }

    if (!spawned && typeof window.GameAPI.log === "function") {
      window.GameAPI.log(`Sandbox: Failed to spawn enemy '${enemyId}'.`, "warn");
    }
  } catch (_) {}
}
