/**
 * TownRuntime: generation and helpers for town mode.
 *
 * Exports (ESM + window.TownRuntime):
 * - generate(ctx): populates ctx.map/visible/seen/npcs/shops/props/buildings/etc.
 * - ensureSpawnClear(ctx)
 * - spawnGateGreeters(ctx, count=4)
 * - isFreeTownFloor(ctx, x, y)
 * - talk(ctx): bump-talk with nearby NPCs; returns true if handled
 * - returnToWorldIfAtGate(ctx): leaves town if the player stands on the gate tile; returns true if handled
 */

export function generate(ctx) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.generate === "function") {
    const handled = Tn.generate(ctx);
    if (handled) {
      // Greeters at gate: Town.generate should ensure one; allow module to add none if unnecessary
      if (typeof Tn.spawnGateGreeters === "function") {
        try { Tn.spawnGateGreeters(ctx, 0); } catch (_) {}
      }

      // Safety: if no NPCs ended up populated, force a minimal population so the town isn't empty
      try {
        if (!Array.isArray(ctx.npcs) || ctx.npcs.length === 0) {
          const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
          if (TAI && typeof TAI.populateTown === "function") {
            TAI.populateTown(ctx);
          }
          // Ensure at least one greeter near the gate
          if (typeof Tn.spawnGateGreeters === "function") {
            Tn.spawnGateGreeters(ctx, 1);
          }
          // Rebuild occupancy to reflect newly added NPCs
          try {
            if (typeof rebuildOccupancy === "function") rebuildOccupancy(ctx);
            else if (ctx.TownRuntime && typeof ctx.TownRuntime.rebuildOccupancy === "function") ctx.TownRuntime.rebuildOccupancy(ctx);
          } catch (_) {}
        }
      } catch (_) {}

      // Post-gen refresh via StateSync (fallback to manual)
      try {
        const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
        } else {
          try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
          try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
          try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
          try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
        }
      } catch (_) {}
      return true;
    }
  }
  ctx.log && ctx.log("Town module missing; unable to generate town.", "warn");
  return false;
}

export function ensureSpawnClear(ctx) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.ensureSpawnClear === "function") {
    Tn.ensureSpawnClear(ctx);
    return;
  }
  ctx.log && ctx.log("Town.ensureSpawnClear not available.", "warn");
}

export function spawnGateGreeters(ctx, count) {
  const Tn = (ctx && ctx.Town) || (typeof window !== "undefined" ? window.Town : null);
  if (Tn && typeof Tn.spawnGateGreeters === "function") {
    Tn.spawnGateGreeters(ctx, count);
    return;
  }
  ctx.log && ctx.log("Town.spawnGateGreeters not available.", "warn");
}

export function isFreeTownFloor(ctx, x, y) {
  try {
    if (ctx && ctx.Utils && typeof ctx.Utils.isFreeTownFloor === "function") {
      return !!ctx.Utils.isFreeTownFloor(ctx, x, y);
    }
  } catch (_) {}
  const U = (typeof window !== "undefined" ? window.Utils : null);
  if (U && typeof U.isFreeTownFloor === "function") {
    return !!U.isFreeTownFloor(ctx, x, y);
  }
  if (!ctx.inBounds(x, y)) return false;
  const t = ctx.map[y][x];
  if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) return false;
  if (x === ctx.player.x && y === ctx.player.y) return false;
  if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === x && n.y === y)) return false;
  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === x && p.y === y)) return false;
  return true;
}

export function talk(ctx, bumpAtX = null, bumpAtY = null) {
  if (ctx.mode !== "town") return false;
  const npcs = ctx.npcs || [];
  const near = [];
  for (const n of npcs) {
    const d = Math.abs(n.x - ctx.player.x) + Math.abs(n.y - ctx.player.y);
    if (d <= 1) near.push(n);
  }
  if (!near.length) {
    ctx.log && ctx.log("There is no one to talk to here.");
    return false;
  }

  // Prefer the NPC occupying the attempted bump tile if provided,
  // otherwise prefer a shopkeeper among adjacent NPCs, otherwise pick randomly.
  let npc = null;
  if (typeof bumpAtX === "number" && typeof bumpAtY === "number") {
    npc = near.find(n => n.x === bumpAtX && n.y === bumpAtY) || null;
  }
  if (!npc) {
    npc = near.find(n => (n.isShopkeeper || n._shopRef)) || null;
  }
  const pick = (arr, rng) => {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.int === "function") {
        const rfn = (typeof rng === "function")
          ? rng
          : ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
              ? window.RNG.rng
              : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
                  ? window.RNGFallback.getRng()
                  : Math.random));
        const idx = window.RNGUtils.int(0, arr.length - 1, rfn);
        return arr[idx] || arr[0];
      }
    } catch (_) {}
    const rfn = (typeof rng === "function")
      ? rng
      : ((typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function")
          ? window.RNG.rng
          : ((typeof window !== "undefined" && window.RNGFallback && typeof window.RNGFallback.getRng === "function")
              ? window.RNGFallback.getRng()
              : Math.random));
    const idx = Math.floor(rfn() * arr.length) % arr.length;
    return arr[idx] || arr[0];
  };
  npc = npc || pick(near, ctx.rng);

  const lines = Array.isArray(npc.lines) && npc.lines.length ? npc.lines : ["Hey!", "Watch it!", "Careful there."];
  const line = pick(lines, ctx.rng);
  ctx.log && ctx.log(`${npc.name || "Villager"}: ${line}`, "info");

  // Only shopkeepers can open shops; villagers should not trigger trading.
  const isKeeper = !!(npc && (npc.isShopkeeper || npc._shopRef));

  // Determine if keeper is physically at their shop (on the door tile or inside the building)
  function isKeeperAtShop(n, shop) {
    if (!n || !shop) return false;
    const atDoor = (n.x === shop.x && n.y === shop.y);
    let inside = false;
    try {
      const b = shop.building || null;
      if (b) {
        inside = (n.x > b.x && n.x < b.x + b.w - 1 && n.y > b.y && n.y < b.y + b.h - 1);
      }
    } catch (_) {}
    return atDoor || inside;
  }

  // Helper to open a shop reference (if open), showing schedule when closed
  function tryOpenShopRef(shopRef, sourceNpc) {
    try {
      const SS = ctx.ShopService || (typeof window !== "undefined" ? window.ShopService : null);
      const openNow = (SS && typeof SS.isShopOpenNow === "function") ? SS.isShopOpenNow(ctx, shopRef) : false;
      const sched = (SS && typeof SS.shopScheduleStr === "function") ? SS.shopScheduleStr(shopRef) : "";
      if (openNow) {
        let wasOpen = false;
        try { wasOpen = !!(ctx.UIBridge && typeof ctx.UIBridge.isShopOpen === "function" && ctx.UIBridge.isShopOpen()); } catch (_) {}
        if (ctx.UIBridge && typeof ctx.UIBridge.showShop === "function") {
          ctx.UIBridge.showShop(ctx, sourceNpc || npc);
        }
        if (!wasOpen) { ctx.requestDraw && ctx.requestDraw(); }
        return true;
      } else {
        ctx.log && ctx.log(`The ${shopRef.name || "shop"} is closed. ${sched}`, "warn");
      }
    } catch (_) {}
    return false;
  }

  if (isKeeper) {
    try {
      const shopRef = npc._shopRef || null;
      if (shopRef && isKeeperAtShop(npc, shopRef)) {
        tryOpenShopRef(shopRef, npc);
      } else if (shopRef) {
        ctx.log && ctx.log(`${npc.name || "Shopkeeper"} is away from the ${shopRef.name || "shop"}.`, "info");
      }
    } catch (_) {}
    return true;
  }

  // Do not auto-open shops when bumping non-keepers, even if near a door.
  return true;
}

export function tryMoveTown(ctx, dx, dy) {
  if (!ctx || ctx.mode !== "town") return false;
  const nx = ctx.player.x + (dx | 0);
  const ny = ctx.player.y + (dy | 0);
  if (!ctx.inBounds(nx, ny)) return false;

  let npcBlocked = false;
  try {
    if (ctx.occupancy && typeof ctx.occupancy.hasNPC === "function") {
      npcBlocked = !!ctx.occupancy.hasNPC(nx, ny);
    } else {
      npcBlocked = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === nx && n.y === ny);
    }
  } catch (_) {}

  // When upstairs overlay is active, ignore downstairs NPC blocking inside the inn footprint
  try {
    if (ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building) {
      const b = ctx.tavern.building;
      const insideInn = (nx > b.x && nx < b.x + b.w - 1 && ny > b.y && ny < b.y + b.h - 1);
      if (insideInn) npcBlocked = false;
    }
  } catch (_) {}

  if (npcBlocked) {
    if (typeof talk === "function") {
      talk(ctx, nx, ny);
    } else if (ctx.log) {
      ctx.log("Excuse me!", "info");
    }
    return true;
  }

  const walkable = (typeof ctx.isWalkable === "function") ? !!ctx.isWalkable(nx, ny) : true;
  if (walkable) {
    ctx.player.x = nx; ctx.player.y = ny;
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
      } else {
        try { ctx.updateCamera && ctx.updateCamera(); } catch (_) {}
        try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
        try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
        try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
      }
    } catch (_) {}
    try { ctx.turn && ctx.turn(); } catch (_) {}
    return true;
  }
  return false;
}

export function returnToWorldIfAtGate(ctx) {
  if (!ctx || ctx.mode !== "town" || !ctx.world) return false;
  const atGate = !!(ctx.townExitAt && ctx.player.x === ctx.townExitAt.x && ctx.player.y === ctx.townExitAt.y);
  if (!atGate) return false;

  // Apply leave to overworld
  applyLeaveSync(ctx);

  return true;
}

export function applyLeaveSync(ctx) {
  if (!ctx || !ctx.world) return false;

  // Persist current town state (map + visibility + entities) before leaving
  try {
    const TS = ctx.TownState || (typeof window !== "undefined" ? window.TownState : null);
    if (TS && typeof TS.save === "function") TS.save(ctx);
  } catch (_) {}

  // Switch mode and restore overworld map
  ctx.mode = "world";
  ctx.map = ctx.world.map;

  // Restore world fog-of-war arrays so minimap remembers explored areas
  try {
    if (ctx.world && ctx.world.seenRef && Array.isArray(ctx.world.seenRef)) ctx.seen = ctx.world.seenRef;
    if (ctx.world && ctx.world.visibleRef && Array.isArray(ctx.world.visibleRef)) ctx.visible = ctx.world.visibleRef;
  } catch (_) {}

  // Restore world position if available (convert absolute world coords -> local window indices)
  try {
    if (ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number" && typeof ctx.worldReturnPos.y === "number") {
      const WR = ctx.WorldRuntime || (typeof window !== "undefined" ? window.WorldRuntime : null);
      const rx = ctx.worldReturnPos.x | 0;
      const ry = ctx.worldReturnPos.y | 0;
      // Ensure the return position is inside the current window
      if (WR && typeof WR.ensureInBounds === "function") {
        // Suspend player shifting during expansion to avoid camera/position snaps
        ctx._suspendExpandShift = true;
        try {
          // Convert to local indices to test
          let lx = rx - ctx.world.originX;
          let ly = ry - ctx.world.originY;
          WR.ensureInBounds(ctx, lx, ly, 32);
        } finally {
          ctx._suspendExpandShift = false;
        }
        // Recompute after potential expansion shifts
        const lx2 = rx - ctx.world.originX;
        const ly2 = ry - ctx.world.originY;
        ctx.player.x = lx2;
        ctx.player.y = ly2;
      } else {
        // Fallback: clamp
        const lx = rx - ctx.world.originX;
        const ly = ry - ctx.world.originY;
        ctx.player.x = Math.max(0, Math.min((ctx.map[0]?.length || 1) - 1, lx));
        ctx.player.y = Math.max(0, Math.min((ctx.map.length || 1) - 1, ly));
      }
    }
  } catch (_) {}

  

  // Clear exit anchors
  try {
    ctx.townExitAt = null;
    ctx.dungeonExitAt = null;
    ctx.dungeon = ctx.dungeonInfo = null;
  } catch (_) {}

  // Hide UI elements
  hideExitButton(ctx);
  // Ensure Quest Board (and similar town-only modals) are closed on exit
  try {
    const UB = ctx.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
    if (UB && typeof UB.hideQuestBoard === "function") UB.hideQuestBoard(ctx);
  } catch (_) {}

  // Ensure camera is centered on player
  try {
    if (ctx && typeof ctx.updateCamera === "function") ctx.updateCamera();
    else centerCamera(ctx);
  } catch (_) { centerCamera(ctx); }

  // Refresh via StateSync when available; fallback to manual refresh
  try {
    const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    } else {
      try { ctx.recomputeFOV && ctx.recomputeFOV(); } catch (_) {}
      try { ctx.updateUI && ctx.updateUI(); } catch (_) {}
      try { ctx.requestDraw && ctx.requestDraw(); } catch (_) {}
    }
  } catch (_) {}
  try { ctx.log && ctx.log("You return to the overworld.", "notice"); } catch (_) {}

  return true;
}

// Fallback camera centering if FOVCamera/updateCamera is unavailable
function centerCamera(ctx) {
  try {
    const cam = (typeof ctx.getCamera === "function") ? ctx.getCamera() : (ctx.camera || null);
    if (!cam) return;
    const TILE = (typeof ctx.TILE === "number") ? ctx.TILE : 32;
    const rows = ctx.map.length;
    const cols = rows ? (ctx.map[0] ? ctx.map[0].length : 0) : 0;
    const mapWidth = cols * TILE;
    const mapHeight = rows * TILE;
    const targetX = ctx.player.x * TILE + TILE / 2 - cam.width / 2;
    const targetY = ctx.player.y * TILE + TILE / 2 - cam.height / 2;
    const slackX = Math.max(0, cam.width / 2 - TILE / 2);
    const slackY = Math.max(0, cam.height / 2 - TILE / 2);
    const minX = -slackX;
    const minY = -slackY;
    const maxX = (mapWidth - cam.width) + slackX;
    const maxY = (mapHeight - cam.height) + slackY;
    cam.x = Math.max(minX, Math.min(targetX, maxX));
    cam.y = Math.max(minY, Math.min(targetY, maxY));
  } catch (_) {}
}

export function showExitButton(ctx) {
  try {
    if (ctx && ctx.UIBridge && typeof ctx.UIBridge.showTownExitButton === "function") {
      ctx.UIBridge.showTownExitButton(ctx);
    }
  } catch (_) {}
}
export function hideExitButton(ctx) {
  try {
    if (ctx && ctx.UIBridge && typeof ctx.UIBridge.hideTownExitButton === "function") {
      ctx.UIBridge.hideTownExitButton(ctx);
    }
  } catch (_) {}
}

// Back-compat: attach to window for classic scripts
export function tick(ctx) {
  if (!ctx || ctx.mode !== "town") return false;

  // Rare event: Wild Seppo (travelling merchant) arrives in town and sells good items.
  try {
    const t = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    const phase = (ctx.time && ctx.time.phase) || "day";
    ctx._seppo = ctx._seppo || { active: false, despawnTurn: 0, cooldownUntil: 0 };

    // If active but entities missing (e.g., after re-enter), reset state
    if (ctx._seppo.active) {
      const hasNPC = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && (n.isSeppo || n.seppo));
      const hasShop = Array.isArray(ctx.shops) && ctx.shops.some(s => s && (s.type === "seppo"));
      if (!hasNPC || !hasShop) {
        ctx._seppo.active = false;
        ctx._seppo.despawnTurn = 0;
      }
    }

    // If entities indicate Seppo is present but flag is false (e.g., restored from persistence), mark active
    if (!ctx._seppo.active) {
      const hasNPC = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && (n.isSeppo || n.seppo));
      const hasShop = Array.isArray(ctx.shops) && ctx.shops.some(s => s && (s.type === "seppo"));
      if (hasNPC || hasShop) {
        ctx._seppo.active = true;
      }
    }

    // Spawn conditions
    const alreadyPresent = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && (n.isSeppo || n.seppo));
    const canSpawn = !ctx._seppo.active && !alreadyPresent && t >= (ctx._seppo.cooldownUntil | 0) && (phase === "day" || phase === "dusk");
    if (canSpawn) {
      // Chance per town tick (increased slightly to be observable)
      const rfn = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function")
        ? window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
        : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));
      if (rfn() < 0.01) { // ~1% per tick while conditions hold
        // Find a free spot near the plaza (or gate as fallback)
        const within = 5;
        let best = null;
        for (let i = 0; i < 200; i++) {
          const rfn2 = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function")
            ? window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined)
            : ((typeof ctx.rng === "function") ? ctx.rng : (() => 0.5));
          const ox = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.int === "function")
            ? window.RNGUtils.int(-within, within, rfn2)
            : ((Math.floor(rfn2() * (within * 2 + 1))) - within) | 0;
          const oy = (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.int === "function")
            ? window.RNGUtils.int(-within, within, rfn2)
            : ((Math.floor(rfn2() * (within * 2 + 1))) - within) | 0;
          const px = Math.max(1, Math.min((ctx.map[0]?.length || 2) - 2, (ctx.townPlaza?.x | 0) + ox));
          const py = Math.max(1, Math.min((ctx.map.length || 2) - 2, (ctx.townPlaza?.y | 0) + oy));
          const free = (typeof isFreeTownFloor === "function") ? isFreeTownFloor(ctx, px, py)
                      : (typeof ctx.isFreeTownFloor === "function") ? ctx.isFreeTownFloor(ctx, px, py)
                      : (() => {
                          const t = ctx.map[py][px];
                          if (t !== ctx.TILES.FLOOR && t !== ctx.TILES.DOOR) return false;
                          if (ctx.player.x === px && ctx.player.y === py) return false;
                          if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === px && n.y === py)) return false;
                          if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === px && p.y === py)) return false;
                          return true;
                        })();
          if (free) { best = { x: px, y: py }; break; }
        }
        if (!best && ctx.townExitAt) {
          const cand = [
            { x: ctx.townExitAt.x + 1, y: ctx.townExitAt.y },
            { x: ctx.townExitAt.x - 1, y: ctx.townExitAt.y },
            { x: ctx.townExitAt.x, y: ctx.townExitAt.y + 1 },
            { x: ctx.townExitAt.x, y: ctx.townExitAt.y - 1 }
          ];
          for (const c of cand) {
            if (c.x > 0 && c.y > 0 && c.y < ctx.map.length - 1 && c.x < (ctx.map[0]?.length || 2) - 1) {
              if ((ctx.map[c.y][c.x] === ctx.TILES.FLOOR || ctx.map[c.y][c.x] === ctx.TILES.DOOR) &&
                  !(ctx.player.x === c.x && ctx.player.y === c.y) &&
                  !(Array.isArray(ctx.npcs) && ctx.npcs.some(n => n.x === c.x && n.y === c.y)) &&
                  !(Array.isArray(ctx.townProps) && ctx.townProps.some(p => p.x === c.x && p.y === c.y))) {
                best = { x: c.x, y: c.y }; break;
              }
            }
          }
        }
        if (best) {
          const npc = {
            x: best.x, y: best.y,
            name: "Wild Seppo",
            lines: ["Rare goods, fair prices.", "Only for a short while!"],
            isShopkeeper: true,
            isSeppo: true,
            seppo: true
          };

          // Temporary shop at Seppo's tile (always open while he's in town)
          const shop = {
            x: best.x, y: best.y,
            type: "seppo",
            name: "Wild Seppo",
            alwaysOpen: true,
            openMin: 0, closeMin: 0,
            building: null,
            inside: { x: best.x, y: best.y }
          };

          // Attach shop reference to NPC so UI can resolve inventory
          npc._shopRef = shop;

          (ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : []).push(npc);
          (ctx.shops = Array.isArray(ctx.shops) ? ctx.shops : []).push(shop);

          // Lifetime ~2 in-game hours; cooldown ~8 hours before next possible visit
          const minutesPerTurn = (ctx.time && typeof ctx.time.minutesPerTurn === "number") ? ctx.time.minutesPerTurn : (24 * 60) / 360;
          const turns2h = Math.max(1, Math.round(120 / minutesPerTurn));
          const turns8h = Math.max(1, Math.round(480 / minutesPerTurn));
          ctx._seppo.active = true;
          ctx._seppo.despawnTurn = t + turns2h;
          ctx._seppo.cooldownUntil = t + turns8h;

          try { ctx.log && ctx.log("A rare wanderer, Wild Seppo, arrives at the plaza!", "notice"); } catch (_) {}
          // Ensure occupancy reflects the new NPC immediately
          try {
            const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
            if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
          } catch (_) {}
        }
      }
    }

    // Despawn conditions
    if (ctx._seppo.active) {
      const timeUp = t >= (ctx._seppo.despawnTurn | 0);
      const nightNow = phase === "night";
      if (timeUp || nightNow) {
        // Remove Seppo NPC and shop
        try {
          if (Array.isArray(ctx.npcs)) {
            const idx = ctx.npcs.findIndex(n => n && (n.isSeppo || n.seppo));
            if (idx !== -1) ctx.npcs.splice(idx, 1);
          }
        } catch (_) {}
        try {
          if (Array.isArray(ctx.shops)) {
            for (let i = ctx.shops.length - 1; i >= 0; i--) {
              const s = ctx.shops[i];
              if (s && s.type === "seppo") ctx.shops.splice(i, 1);
            }
          }
        } catch (_) {}
        ctx._seppo.active = false;
        ctx._seppo.despawnTurn = 0;
        try { ctx.log && ctx.log("Wild Seppo packs up and leaves.", "info"); } catch (_) {}
        // Refresh occupancy after removal
        try {
          const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
          if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Drive NPC behavior
  try {
    const TAI = ctx.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
    if (TAI && typeof TAI.townNPCsAct === "function") {
      TAI.townNPCsAct(ctx);
    }
  } catch (_) {}

  // Rebuild occupancy every other turn to avoid ghost-blocking after NPC bursts
  try {
    const stride = 2;
    const t = (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
    if ((t % stride) === 0) {
      const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
      if (OF && typeof OF.rebuild === "function") OF.rebuild(ctx);
    }
  } catch (_) {}
  return true;
}

// Explicit occupancy rebuild helper for callers that mutate town entities outside tick cadence.
export function rebuildOccupancy(ctx) {
  try {
    const OF = ctx.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null);
    if (OF && typeof OF.rebuild === "function") {
      OF.rebuild(ctx);
      return true;
    }
  } catch (_) {}
  return false;
}

if (typeof window !== "undefined") {
  window.TownRuntime = { generate, ensureSpawnClear, spawnGateGreeters, isFreeTownFloor, talk, tryMoveTown, tick, returnToWorldIfAtGate, applyLeaveSync, showExitButton, hideExitButton, rebuildOccupancy };
}