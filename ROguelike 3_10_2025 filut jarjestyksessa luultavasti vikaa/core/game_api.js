/**
 * GameAPIBuilder
 * Provides a factory to attach a stable testing/automation API without coupling to core/game.js internals.
 */

export function create(ctx) {
  const api = {
    getMode: () => {
      try { return ctx.getMode(); } catch (_) { return "world"; }
    },
    getWorld: () => {
      try { return ctx.getWorld(); } catch (_) { return null; }
    },
    getPlayer: () => {
      try { const p = ctx.getPlayer(); return { x: p.x, y: p.y }; } catch (_) { return { x: 0, y: 0 }; }
    },
    moveStep: (dx, dy) => { try { ctx.tryMovePlayer(dx, dy); } catch (_) {} },

    // Overworld helpers
    isWalkableOverworld: (x, y) => {
      try {
        const w = ctx.getWorld();
        if (!w || !w.map) return false;
        const t = w.map[y] && w.map[y][x];
        return (typeof window.World === "object" && typeof window.World.isWalkable === "function") ? window.World.isWalkable(t) : true;
      } catch (_) { return false; }
    },
    nearestDungeon: () => {
      try {
        const w = ctx.getWorld();
        if (!w || !Array.isArray(w.dungeons) || w.dungeons.length === 0) return null;
        const p = ctx.getPlayer();
        let best = null, bestD = Infinity;
        for (const d of w.dungeons) {
          const dd = Math.abs(d.x - p.x) + Math.abs(d.y - p.y);
          if (dd < bestD) { bestD = dd; best = { x: d.x, y: d.y }; }
        }
        return best;
      } catch (_) { return null; }
    },
    nearestTown: () => {
      try {
        const w = ctx.getWorld();
        if (!w || !Array.isArray(w.towns) || w.towns.length === 0) return null;
        const p = ctx.getPlayer();
        let best = null, bestD = Infinity;
        for (const t of w.towns) {
          const dd = Math.abs(t.x - p.x) + Math.abs(t.y - p.y);
          if (dd < bestD) { bestD = dd; best = { x: t.x, y: t.y }; }
        }
        return best;
      } catch (_) { return null; }
    },
    routeTo: (tx, ty) => {
      try {
        const w = ctx.getWorld();
        if (!w || !w.map) return [];
        const width = w.width, height = w.height;
        const start = { x: ctx.getPlayer().x, y: ctx.getPlayer().y };
        const q = [start];
        const prev = new Map();
        const seen = new Set([`${start.x},${start.y}`]);
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        while (q.length) {
          const cur = q.shift();
          if (cur.x === tx && cur.y === ty) break;
          for (const d of dirs) {
            const nx = cur.x + d.dx, ny = cur.y + d.dy;
            const key = `${nx},${ny}`;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (seen.has(key)) continue;
            if (!window.GameAPI.isWalkableOverworld(nx, ny)) continue;
            seen.add(key);
            prev.set(key, cur);
            q.push({ x: nx, y: ny });
          }
        }
        const path = [];
        const curKey = `${tx},${ty}`;
        if (!prev.has(curKey) && !(start.x === tx && start.y === ty)) return [];
        let cur = { x: tx, y: ty };
        while (!(cur.x === start.x && cur.y === start.y)) {
          path.push(cur);
          const p = prev.get(`${cur.x},${cur.y}`);
          if (!p) break;
          cur = p;
        }
        path.reverse();
        return path;
      } catch (_) { return []; }
    },
    gotoNearestDungeon: async () => {
      try {
        const target = window.GameAPI.nearestDungeon();
        if (!target) return true;
        const path = window.GameAPI.routeTo(target.x, target.y);
        if (!path || !path.length) return false;
        for (const step of path) {
          const p = ctx.getPlayer();
          const dx = Math.sign(step.x - p.x);
          const dy = Math.sign(step.y - p.y);
          try { ctx.tryMovePlayer(dx, dy); } catch (_) {}
          await new Promise(r => setTimeout(r, 60));
        }
        return true;
      } catch (_) { return false; }
    },
    gotoNearestTown: async () => {
      try {
        const target = window.GameAPI.nearestTown();
        if (!target) return true;
        const path = window.GameAPI.routeTo(target.x, target.y);
        if (!path || !path.length) return false;
        for (const step of path) {
          const p = ctx.getPlayer();
          const dx = Math.sign(step.x - p.x);
          const dy = Math.sign(step.y - p.y);
          try { ctx.tryMovePlayer(dx, dy); } catch (_) {}
          await new Promise(r => setTimeout(r, 60));
        }
        return true;
      } catch (_) { return false; }
    },

    // Context actions
    enterTownIfOnTile: () => { try { return !!ctx.enterTownIfOnTile(); } catch (_) { return false; } },
    enterDungeonIfOnEntrance: () => { try { return !!ctx.enterDungeonIfOnEntrance(); } catch (_) { return false; } },

    // Map entities
    getEnemies: () => {
      try { return ctx.getEnemies().map(e => ({ x: e.x, y: e.y, hp: e.hp, type: e.type, immobileTurns: e.immobileTurns || 0, bleedTurns: e.bleedTurns || 0 })); }
      catch (_) { return []; }
    },
    getNPCs: () => {
      try {
        const npcs = ctx.getNPCs();
        return Array.isArray(npcs) ? npcs.map((n, i) => ({ i, x: n.x, y: n.y, name: n.name })) : [];
      } catch (_) { return []; }
    },
    getTownProps: () => {
      try {
        const props = ctx.getTownProps();
        return Array.isArray(props) ? props.map(p => ({ x: p.x, y: p.y, type: p.type || "" })) : [];
      } catch (_) { return []; }
    },
    getDungeonExit: () => {
      try { const d = ctx.getDungeonExit(); return d ? { x: d.x, y: d.y } : null; } catch (_) { return null; }
    },
    getTownGate: () => {
      try { const g = ctx.getTownGate(); return g ? { x: g.x, y: g.y } : null; } catch (_) { return null; }
    },
    getCorpses: () => {
      try {
        const corpses = ctx.getCorpses();
        return Array.isArray(corpses) ? corpses.map(c => ({ kind: c.kind || "corpse", x: c.x, y: c.y, looted: !!c.looted, lootCount: Array.isArray(c.loot) ? c.loot.length : 0 })) : [];
      } catch (_) { return []; }
    },
    getChestsDetailed: () => {
      try {
        const corpses = ctx.getCorpses();
        if (!Array.isArray(corpses)) return [];
        const list = [];
        for (const c of corpses) {
          if (c && c.kind === "chest") {
            const items = Array.isArray(c.loot) ? c.loot : [];
            const names = items.map(it => {
              if (!it) return "(null)";
              if (it.name) return it.name;
              if (it.kind === "equip") {
                const stats = [];
                if (typeof it.atk === "number") stats.push(`+${it.atk} atk`);
                if (typeof it.def === "number") stats.push(`+${it.def} def`);
                return `${it.slot || "equip"}${stats.length ? ` (${stats.join(", ")})` : ""}`;
              }
              if (it.kind === "potion") return it.name || "potion";
              return it.kind || "item";
            });
            list.push({ x: c.x, y: c.y, items: names });
          }
        }
        return list;
      } catch (_) { return []; }
    },

    // Inventory/equipment
    getInventory: () => {
      try {
        const p = ctx.getPlayer();
        return Array.isArray(p.inventory) ? p.inventory.map((it, i) => ({ i, kind: it.kind, slot: it.slot, name: it.name, atk: it.atk, def: it.def, decay: it.decay, count: it.count })) : [];
      } catch (_) { return []; }
    },
    getEquipment: () => {
      try {
        const p = ctx.getPlayer();
        const eq = p.equipment || {};
        function info(it) { return it ? { name: it.name, slot: it.slot, atk: it.atk, def: it.def, decay: it.decay, twoHanded: !!it.twoHanded } : null; }
        return { left: info(eq.left), right: info(eq.right), head: info(eq.head), torso: info(eq.torso), legs: info(eq.legs), hands: info(eq.hands) };
      } catch (_) { return { left: null, right: null, head: null, torso: null, legs: null, hands: null }; }
    },
    getStats: () => {
      try {
        const p = ctx.getPlayer();
        return { atk: ctx.getPlayerAttack(), def: ctx.getPlayerDefense(), hp: p.hp, maxHp: p.maxHp, level: p.level };
      } catch(_) {
        const p = ctx.getPlayer();
        return { atk: 0, def: 0, hp: p.hp, maxHp: p.maxHp, level: p.level };
      }
    },
    equipItemAtIndex: (idx) => { try { ctx.equipItemByIndex((Number(idx)||0)|0); return true; } catch(_) { return false; } },
    equipItemAtIndexHand: (idx, hand) => { try { ctx.equipItemByIndexHand((Number(idx)||0)|0, String(hand||"left")); return true; } catch(_) { return false; } },
    unequipSlot: (slot) => { try { ctx.unequipSlot(String(slot)); return true; } catch(_) { return false; } },
    getPotions: () => {
      try {
        const p = ctx.getPlayer();
        if (!Array.isArray(p.inventory)) return [];
        const out = [];
        for (let i = 0; i < p.inventory.length; i++) {
          const it = p.inventory[i];
          if (it && it.kind === "potion") out.push({ i, heal: it.heal, count: it.count, name: it.name });
        }
        return out;
      } catch(_) { return []; }
    },
    drinkPotionAtIndex: (idx) => { try { ctx.drinkPotionByIndex((Number(idx)||0)|0); return true; } catch(_) { return false; } },

    // Gold
    getGold: () => {
      try {
        const p = ctx.getPlayer();
        const g = p.inventory.find(i => i && i.kind === "gold");
        return g && typeof g.amount === "number" ? g.amount : 0;
      } catch(_) { return 0; }
    },
    addGold: (amt) => {
      try {
        const amount = Number(amt) || 0;
        if (amount <= 0) return false;
        const p = ctx.getPlayer();
        let g = p.inventory.find(i => i && i.kind === "gold");
        if (!g) { g = { kind: "gold", amount: 0, name: "gold" }; p.inventory.push(g); }
        g.amount += amount;
        ctx.updateUI(); ctx.renderInventoryPanel();
        return true;
      } catch(_) { return false; }
    },
    removeGold: (amt) => {
      try {
        const amount = Number(amt) || 0;
        if (amount <= 0) return true;
        const p = ctx.getPlayer();
        let g = p.inventory.find(i => i && i.kind === "gold");
        if (!g) return false;
        g.amount = Math.max(0, (g.amount|0) - amount);
        ctx.updateUI(); ctx.renderInventoryPanel();
        return true;
      } catch(_) { return false; }
    },

    // Town diagnostics
    getNPCHomeByIndex: (idx) => {
      try {
        const npcs = ctx.getNPCs();
        const townProps = ctx.getTownProps();
        if (!Array.isArray(npcs) || idx < 0 || idx >= npcs.length) return null;
        const n = npcs[idx];
        const b = n && n._home && n._home.building ? n._home.building : null;
        if (!b) return null;
        const propsIn = (Array.isArray(townProps) ? townProps.filter(p => (p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1)) : []).map(p => ({ x: p.x, y: p.y, type: p.type || "" }));
        return { building: { x: b.x, y: b.y, w: b.w, h: b.h, door: b.door ? { x: b.door.x, y: b.door.y } : null }, props: propsIn };
      } catch (_) { return null; }
    },
    equipBestFromInventory: () => {
      const equipped = [];
      try {
        const p = ctx.getPlayer();
        if (!Array.isArray(p.inventory) || p.inventory.length === 0) return equipped;
        const snap = p.inventory.slice(0);
        for (const it of snap) {
          if (it && it.kind === "equip") {
            if (ctx.equipIfBetter(it)) {
              const idx = p.inventory.indexOf(it);
              if (idx !== -1) p.inventory.splice(idx, 1);
              equipped.push(it.name || "equip");
            }
          }
        }
      } catch (_) {}
      return equipped;
    },

    // Shops/time/perf
    getShops: () => {
      try {
        const shops = ctx.getShops();
        return Array.isArray(shops) ? shops.map(s => ({ x: s.x, y: s.y, name: s.name || "", alwaysOpen: !!s.alwaysOpen, openMin: s.openMin, closeMin: s.closeMin })) : [];
      } catch (_) { return []; }
    },
    isShopOpenNowFor: (shop) => { try { return ctx.isShopOpenNow(shop); } catch (_) { return false; } },
    getShopSchedule: (shop) => { try { return ctx.shopScheduleStr(shop); } catch (_) { return ""; } },

    checkHomeRoutes: () => {
      try {
        if (typeof window !== "undefined" && window.TownAI && typeof window.TownAI.checkHomeRoutes === "function") {
          return window.TownAI.checkHomeRoutes(ctx.getCtx()) || null;
        }
      } catch (_) {}
      return null;
    },
    getClock: () => {
      try { return ctx.getClock(); } catch (_) { return { hhmm: "00:00", phase: "day", hours: 0, minutes: 0 }; }
    },
    advanceMinutes: (mins) => { try { ctx.advanceTimeMinutes((Number(mins)||0)|0); ctx.updateUI(); ctx.requestDraw(); return true; } catch (_) { return false; } },
    
    getPerf: () => {
      try {
        const p = ctx.getPerfStats();
        return { lastTurnMs: (p.lastTurnMs || 0), lastDrawMs: (p.lastDrawMs || 0) };
      } catch (_) { return { lastTurnMs: 0, lastDrawMs: 0 }; }
    },
    getDecalsCount: () => {
      try { const d = ctx.getDecals(); return Array.isArray(d) ? d.length : 0; } catch (_) { return 0; }
    },
    returnToWorldIfAtExit: () => { try { return !!ctx.returnToWorldIfAtExit(); } catch(_) { return false; } },

    // Crit/status helpers
    setAlwaysCrit: (v) => { try { ctx.setAlwaysCrit(!!v); return true; } catch(_) { return false; } },
    setCritPart: (part) => { try { ctx.setCritPart(String(part || "")); return true; } catch(_) { return false; } },
    getPlayerStatus: () => { try { const p = ctx.getPlayer(); return { hp: p.hp, maxHp: p.maxHp, dazedTurns: p.dazedTurns | 0 }; } catch(_) { return { hp: 0, maxHp: 0, dazedTurns: 0 }; } },
    setPlayerDazedTurns: (n) => { try { const p = ctx.getPlayer(); p.dazedTurns = Math.max(0, (Number(n) || 0) | 0); return true; } catch(_) { return false; } },

    // Enemy manip
    setEnemyHpAt: (x, y, hp) => {
      try {
        const nx = (Number(x) || 0) | 0;
        const ny = (Number(y) || 0) | 0;
        const val = Math.max(1, Number(hp) || 1);
        const enemies = ctx.getEnemies();
        const e = enemies.find(en => (en.x|0) === nx && (en.y|0) === ny);
        if (!e || typeof e.hp !== "number") return false;
        e.hp = val;
        ctx.updateUI(); ctx.requestDraw();
        return true;
      } catch(_) { return false; }
    },

    // Local map helpers
    isWalkableDungeon: (x, y) => { try { return !!(ctx.inBounds(x, y) && ctx.isWalkable(x, y)); } catch (_) { return false; } },
    getVisibilityAt: (x, y) => { try { if (!ctx.inBounds(x|0, y|0)) return false; const vis = ctx.getVisible(); return !!(vis[y|0] && vis[y|0][x|0]); } catch(_) { return false; } },
    getTiles: () => { try { return { WALL: ctx.TILES.WALL, FLOOR: ctx.TILES.FLOOR, DOOR: ctx.TILES.DOOR, STAIRS: ctx.TILES.STAIRS, WINDOW: ctx.TILES.WINDOW }; } catch(_) { return { WALL:0,FLOOR:1,DOOR:2,STAIRS:3,WINDOW:4 }; } },
    getTile: (x, y) => { try { if (!ctx.inBounds(x|0, y|0)) return null; const m = ctx.getMap(); return m[y|0][x|0]; } catch(_) { return null; } },
    hasEnemy: (x, y) => {
      try {
        const occ = ctx.getOccupancy();
        if (occ && typeof occ.hasEnemy === "function") return !!occ.hasEnemy(x|0, y|0);
        const enemies = ctx.getEnemies();
        return enemies.some(e => (e.x|0) === (x|0) && (e.y|0) === (y|0));
      } catch(_) { return false; }
    },
    hasNPC: (x, y) => {
      try {
        const occ = ctx.getOccupancy();
        if (occ && typeof occ.hasNPC === "function") return !!occ.hasNPC(x|0, y|0);
        const npcs = ctx.getNPCs();
        return npcs.some(n => (n.x|0) === (x|0) && (n.y|0) === (y|0));
      } catch(_) { return false; }
    },
    hasLOS: (x0, y0, x1, y1) => {
      try {
        const c = ctx.getCtx();
        if (c && c.los && typeof c.los.hasLOS === "function") return !!c.los.hasLOS(c, x0|0, y0|0, x1|0, y1|0);
      } catch(_) {}
      return false;
    },

    // GOD helpers
    spawnEnemyNearby: (count = 1) => { try { ctx.godSpawnEnemyNearby((Number(count) || 0) | 0 || 1); return true; } catch(_) { return false; } },
    spawnItems: (count = 3) => { try { ctx.godSpawnItems((Number(count) || 0) | 0 || 3); return true; } catch(_) { return false; } },
    addPotionToInventory: (heal, name) => { try { ctx.addPotionToInventory((Number(heal) || 0) || 3, String(name || "")); return true; } catch(_) { return false; } },

    // Chest helper (dungeon)
    spawnChestNearby: (count = 1) => {
      try {
        const n = Math.max(1, (Number(count) || 0) | 0);
        if (window.GameAPI.getMode() !== "dungeon") return false;
        const map = ctx.getMap();
        const p = ctx.getPlayer();
        const enemies = ctx.getEnemies();
        const corpses = ctx.getCorpses();
        const inBounds = (x, y) => ctx.inBounds(x, y);
        const isWalkable = (x, y) => ctx.isWalkable(x, y);

        const isFreeFloor = (x, y) => {
          if (!inBounds(x, y)) return false;
          if (map[y][x] !== ctx.TILES.FLOOR) return false;
          if (p.x === x && p.y === y) return false;
          if (enemies.some(e => e.x === x && e.y === y)) return false;
          return true;
        };
        const pickNearby = () => {
          for (let i = 0; i < 60; i++) {
            const dx = Math.floor(Math.random() * 9) - 4;
            const dy = Math.floor(Math.random() * 9) - 4;
            const x = p.x + dx, y = p.y + dy;
            if (isFreeFloor(x, y)) return { x, y };
          }
          for (let y = 0; y < map.length; y++) {
            for (let x = 0; x < (map[0] ? map[0].length : 0); x++) {
              if (isFreeFloor(x, y)) return { x, y };
            }
          }
          return null;
        };
        let made = 0;
        for (let i = 0; i < n; i++) {
          const spot = pickNearby();
          if (!spot) break;
          const loot = ctx.generateLoot("chest") || [];
          corpses.push({ x: spot.x, y: spot.y, kind: "chest", looted: loot.length === 0, loot });
          made++;
          try { ctx.log && ctx.log(`GOD: Spawned chest at (${spot.x},${spot.y}).`, "notice"); } catch (_) {}
        }
        if (made > 0) { ctx.requestDraw(); return true; }
        return false;
      } catch (_) { return false; }
    },

    routeToDungeon: (tx, ty) => {
      try {
        const map = ctx.getMap();
        const w = map[0] ? map[0].length : 0;
        const h = map.length;
        if (w === 0 || h === 0) return [];
        const start = { x: ctx.getPlayer().x, y: ctx.getPlayer().y };
        const q = [start];
        const prev = new Map();
        const seen = new Set([`${start.x},${start.y}`]);
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        while (q.length) {
          const cur = q.shift();
          if (cur.x === tx && cur.y === ty) break;
          for (const d of dirs) {
            const nx = cur.x + d.dx, ny = cur.y + d.dy;
            const key = `${nx},${ny}`;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (seen.has(key)) continue;
            if (!window.GameAPI.isWalkableDungeon(nx, ny)) continue;
            seen.add(key);
            prev.set(key, cur);
            q.push({ x: nx, y: ny });
          }
        }
        const path = [];
        const curKey = `${tx},${ty}`;
        if (!prev.has(curKey) && !(start.x === tx && start.y === ty)) return [];
        let cur = { x: tx, y: ty };
        while (!(cur.x === start.x && cur.y === start.y)) {
          path.push(cur);
          const p = prev.get(`${cur.x},${cur.y}`);
          if (!p) break;
          cur = p;
        }
        path.reverse();
        return path;
      } catch (_) { return []; }
    },

    teleportTo: (tx, ty, opts) => {
      try {
        const x = (Number(tx) || 0) | 0;
        const y = (Number(ty) || 0) | 0;
        const ensureWalkable = !opts || (opts.ensureWalkable !== false);
        const fallbackR = (opts && opts.fallbackScanRadius != null) ? (opts.fallbackScanRadius | 0) : 6;
        const mode = window.GameAPI.getMode();
        const world = ctx.getWorld();
        const map = ctx.getMap();
        const p = ctx.getPlayer();
        const npcs = ctx.getNPCs();
        const enemies = ctx.getEnemies();
        const occ = ctx.getOccupancy();

        const canWorld = () => {
          if (!world || !world.map) return false;
          const t = world.map[y] && world.map[y][x];
          return (typeof window.World === "object" && typeof World.isWalkable === "function") ? World.isWalkable(t) : true;
        };
        const canLocal = () => {
          if (!ctx.inBounds(x, y)) return false;
          if (!ensureWalkable) return true;
          if (!ctx.isWalkable(x, y)) return false;
          if (mode === "dungeon" && enemies.some(e => e.x === x && e.y === y)) return false;
          if (mode === "town") {
            const npcBlocked = (occ && typeof occ.hasNPC === "function") ? occ.hasNPC(x, y) : (Array.isArray(npcs) && npcs.some(n => n.x === x && n.y === y));
            if (npcBlocked) return false;
          }
          return true;
        };

        let ok = false;
        if (mode === "world") ok = canWorld(); else ok = canLocal();

        if (!ok && ensureWalkable) {
          const r = Math.max(1, fallbackR | 0);
          let best = null, bestD = Infinity;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = x + dx, ny = y + dy;
              const md = Math.abs(dx) + Math.abs(dy);
              if (md > r) continue;
              if (mode === "world") {
                if (!world || !world.map) continue;
                const t = world.map[ny] && world.map[ny][nx];
                const walk = (typeof window.World === "object" && typeof window.World.isWalkable === "function") ? window.World.isWalkable(t) : t_coderunewe</;
;
                if (walk && md < bestD) { best = { x: nx, y: ny }; bestD = md; }
              } else {
                if (!ctx.inBounds(nx, ny)) continue;
                if (mode === "dungeon" && enemies.some(e => e.x === nx && e.y === ny)) continue;
                if (mode === "town") {
                  const npcBlocked = (occ && typeof occ.hasNPC === "function") ? occ.hasNPC(nx, ny) : (Array.isArray(npcs) && npcs.some(n => n.x === nx && n.y === ny));
                  if (npcBlocked) continue;
                }
                if (ctx.isWalkable(nx, ny) && md < bestD) { best = { x: nx, y: ny }; bestD = md; }
              }
            }
          }
          if (best) { p.x = best.x; p.y = best.y; ok = true; }
        }

        if (!ok) {
          if (!ensureWalkable) { p.x = x; p.y = y; ok = true; }
        } else {
          if (mode !== "world") { p.x = (p.x | 0); p.y = (p.y | 0); }
          if (mode === "world") { p.x = x; p.y = y; }
          if (mode !== "world" && !(p.x === x && p.y === y)) {
            // used fallback
          } else {
            p.x = x; p.y = y;
          }
        }

        if (ok) {
          ctx.updateCamera();
          ctx.recomputeFOV();
          ctx.updateUI();
          ctx.requestDraw();
        }
        return !!ok;
      } catch (_) { return false; }
    },
    // Force-overworld: immediately set mode to world by regenerating it.
    // This is a hard escape hatch for tests: it does not wipe inventory; it just reinitializes the overworld.
    forceWorld: () => {
      try { ctx.initWorld(); ctx.requestDraw(); return true; } catch (_) { return false; }
    },
  };
  return api;
}

// Back-compat: attach to window for classic scripts
if (typeof window !== "undefined") {
  window.GameAPIBuilder = { create };
}