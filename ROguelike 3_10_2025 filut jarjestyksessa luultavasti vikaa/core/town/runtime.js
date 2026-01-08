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
 * - startBanditsAtGateEvent(ctx): spawn a bandit group near the gate and mark a town combat event
 */

import { getMod } from "../../utils/access.js";
import { syncFollowersFromTown } from "../followers_runtime.js";

export function generate(ctx) {
  // Ensure townBiome is not carrying over from previous towns; allow derive/persist per town
  try { ctx.townBiome = undefined; } catch (_) {}
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

      // Spawn recruitable follower NPCs in the inn (if present).
      try {
        if (typeof spawnInnFollowerHires === "function") {
          spawnInnFollowerHires(ctx);
        }
      } catch (_) {}

      // Post-gen refresh via StateSync
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") {
          SS.applyAndRefresh(ctx, {});
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

// Spawn a recruitable follower NPC inside the inn (tavern) when available.
// Uses FollowersRuntime to pick a follower archetype and marks the NPC as a
// hire candidate so bumping them opens the hire prompt. Offers are intentionally
// gated by follower caps and tavern presence; rarity gates can be layered on
// top by callers (e.g., TownState.load).
function spawnInnFollowerHires(ctx) {
  try {
    if (!ctx || ctx.mode !== "town") return;
    if (!ctx.tavern || !ctx.tavern.building) {
      try { ctx.log && ctx.log("[DEBUG] No inn/tavern present in this town (no hireable followers).", "info"); } catch (_) {}
      return;
    }

    const FR =
      ctx.FollowersRuntime ||
      getMod(ctx, "FollowersRuntime") ||
      (typeof window !== "undefined" ? window.FollowersRuntime : null);
    if (!FR || typeof FR.pickRandomFollowerArchetype !== "function" || typeof FR.canHireFollower !== "function") {
      return;
    }

    const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    // Avoid spawning multiple hire NPCs at once.
    const already = npcs.some(n => n && n._recruitCandidate && n._recruitFollowerId);
    if (already) return;

    // Respect global follower cap: if we cannot hire any archetype at all, skip.
    // Use a cheap check against one archetype later; here we just avoid work if
    // player already has as many followers as allowed.
    try {
      const p = ctx.player;
      if (p && Array.isArray(p.followers)) {
        // If length equals or exceeds maxActive, canHireFollower will fail for any archetype.
        const caps = typeof FR.getFollowersCaps === "function" ? FR.getFollowersCaps(ctx) : null;
        const maxActive = caps && typeof caps.maxActive === "number" ? caps.maxActive | 0 : 3;
        if (p.followers.length >= maxActive) return;
      }
    } catch (_) {}

    // Spawn helper: for testing, force an inn hire spawn whenever other
    // conditions pass. When tuning for production, reintroduce a random
    // chance gate here.
    try {
      // Intentionally no additional rarity gate during testing.
    } catch (_) {
      // If RNG or other helpers fail, silently skip.
    }

    // Pick a follower archetype that the player does not already have, if possible.
    const archetype = FR.pickRandomFollowerArchetype(ctx, { skipHired: true });
    if (!archetype || !archetype.id) return;

    // Double-check that this archetype can be hired under caps.
    const canCheck = FR.canHireFollower(ctx, archetype.id);
    if (!canCheck || !canCheck.ok) return;

    const b = ctx.tavern.building;
    const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
    const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
    if (!rows || !cols) return;

    const T = ctx.TILES;
    let spot = null;
    for (let y = b.y + 1; y < b.y + b.h - 1 && !spot; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        const tile = ctx.map[y][x];
        if (tile !== T.FLOOR && tile !== T.DOOR) continue;
        if (!isFreeTownFloor(ctx, x, y)) continue;
        spot = { x, y };
        break;
      }
    }
    if (!spot) return;

    const baseName = typeof archetype.name === "string" ? archetype.name : "Follower";
    const trimmed = baseName.replace(/\s+Ally$/i, "");
    const npcName = trimmed ? `${trimmed} for hire` : "Follower for hire";

    const lines = [
      "Looking for work.",
      "I can handle myself in a fight.",
      "Need another blade at your side?"
    ];

    const npc = {
      x: spot.x,
      y: spot.y,
      name: npcName,
      lines,
      roles: ["follower_hire"],
      _recruitCandidate: true,
      _recruitFollowerId: String(archetype.id)
    };

    ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    ctx.npcs.push(npc);

    try {
      if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
        ctx.occupancy.setNPC(npc.x, npc.y);
      }
    } catch (_) {}

    // Light log so players know there is someone for hire in the inn.
    try {
      if (ctx.log) {
        ctx.log(`${npc.name} is staying at the inn and looking for work.`, "info");
      }
    } catch (_) {}
  } catch (_) {}
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
  if (Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === x && n.y === y)) return false;
  if (Array.isArray(ctx.townProps) && ctx.townProps.some(p => p && p.x === x && p.y === y)) return false;
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
      const RU = (typeof window !== "undefined") ? window.RNGUtils : null;
      if (RU && typeof RU.int === "function") {
        const rfn = (typeof rng === "function") ? rng : ((typeof ctx.rng === "function") ? ctx.rng : undefined);
        if (typeof rfn === "function") {
          const idx = RU.int(0, arr.length - 1, rfn);
          return arr[idx] || arr[0];
        }
      }
    } catch (_) {}
    if (typeof rng === "function") {
      const idx = Math.floor(rng() * arr.length) % arr.length;
      return arr[idx] || arr[0];
    }
    // Deterministic fallback: first element when RNG unavailable
    return arr[0];
  };
  npc = npc || pick(near, ctx.rng);

  // Recruitable follower hire NPCs: bump opens a hire prompt instead of generic chatter/shop.
  try {
    if (npc && npc._recruitCandidate && npc._recruitFollowerId) {
      const FR =
        ctx.FollowersRuntime ||
        getMod(ctx, "FollowersRuntime") ||
        (typeof window !== "undefined" ? window.FollowersRuntime : null);
      const UIO =
        ctx.UIOrchestration ||
        getMod(ctx, "UIOrchestration") ||
        (typeof window !== "undefined" ? window.UIOrchestration : null);

      if (FR && typeof FR.canHireFollower === "function" && typeof FR.hireFollowerFromArchetype === "function") {
        const archetypeId = String(npc._recruitFollowerId || "");
        if (archetypeId) {
          const check = FR.canHireFollower(ctx, archetypeId);
          if (!check.ok) {
            try {
              if (ctx.log && check.reason) ctx.log(check.reason, "info");
            } catch (_) {}
            return true;
          }

          // Determine hire cost in gold; simple flat price for now.
          const hirePrice = 80;
          // Inspect player gold stack in inventory.
          let goldObj = null;
          let goldAmt = 0;
          try {
            const inv = (ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : [];
            for (let i = 0; i < inv.length; i++) {
              const it = inv[i];
              if (it && it.kind === "gold") {
                goldObj = it;
                goldAmt = (typeof it.amount === "number") ? (it.amount | 0) : 0;
                break;
              }
            }
          } catch (_) {}
          const canAfford = goldAmt >= hirePrice;

          let label = npc.name || "Follower";
          let archetypeName = "";
          try {
            if (typeof FR.getFollowerArchetypes === "function") {
              const defs = FR.getFollowerArchetypes(ctx) || [];
              for (let i = 0; i < defs.length; i++) {
                const d = defs[i];
                if (!d || !d.id) continue;
                if (String(d.id) === archetypeId) {
                  archetypeName = d.name || "";
                  break;
                }
              }
            }
          } catch (_) {}
          if (!label && archetypeName) label = archetypeName;

          const priceStr = `${hirePrice} gold`;
          const prompt = canAfford
            ? `${label}: "I can travel with you for ${priceStr}, if you'll have me."`
            : `${label}: "I'd ask for ${priceStr}, but you don't seem to have that right now."`;

          const onOk = () => {
            try {
              if (!canAfford) {
                if (ctx.log) ctx.log("You don't have enough gold to hire them.", "warn");
                return;
              }
              // Re-check caps before finalizing, in case something changed since prompt.
              const freshCheck = FR.canHireFollower(ctx, archetypeId);
              if (!freshCheck || !freshCheck.ok) {
                if (ctx.log && freshCheck && freshCheck.reason) ctx.log(freshCheck.reason, "info");
                return;
              }
              // Ensure a gold stack exists.
              if (!goldObj) {
                const inv = (ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : (ctx.player.inventory = []);
                goldObj = { kind: "gold", amount: 0, name: "gold" };
                inv.push(goldObj);
              }
              goldObj.amount = (goldObj.amount | 0) - hirePrice;

              const ok = FR.hireFollowerFromArchetype(ctx, archetypeId);
              if (ok) {
                // Remove this hire NPC from town after they agree to join.
                try {
                  if (Array.isArray(ctx.npcs)) {
                    for (let i = ctx.npcs.length - 1; i >= 0; i--) {
                      if (ctx.npcs[i] === npc) {
                        ctx.npcs.splice(i, 1);
                        break;
                      }
                    }
                  }
                  if (ctx.occupancy && typeof ctx.occupancy.clearNPC === "function") {
                    ctx.occupancy.clearNPC(npc.x | 0, npc.y | 0);
                  }
                } catch (_) {}
                if (ctx.log) {
                  ctx.log(`${label} agrees to join you for ${priceStr}.`, "good");
                }
              } else if (ctx.log) {
                ctx.log("They cannot join you right now.", "info");
              }
              try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
            } catch (_) {}
          };
          const onCancel = () => {
            try {
              if (ctx.log) ctx.log(`${label}: "Maybe another time."`, "info");
            } catch (_) {}
          };

          if (UIO && typeof UIO.showConfirm === "function") {
            UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
          } else {
            onOk();
          }
          return true;
        }
      }
    }
  } catch (_) {}

  // Followers in town: bump opens follower inspect panel instead of generic chatter/shop.
  try {
    if (npc && npc._isFollower && npc._followerId) {
      const UIO = ctx.UIOrchestration || getMod(ctx, "UIOrchestration") || (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.showFollower === "function") {
        // Build a minimal runtime follower stub; UIOrchestration will enrich it using
        // player.followers and followers.json.
        const followers = ctx.player && Array.isArray(ctx.player.followers) ? ctx.player.followers : [];
        const rec = followers.find(f => f && f.id === npc._followerId) || null;
        const runtime = {
          _isFollower: true,
          _followerId: npc._followerId,
          id: npc._followerId,
          type: npc._followerId,
          name: npc.name || (rec && rec.name) || "Follower",
          faction: "guard",
          level: rec && typeof rec.level === "number" ? rec.level : 1,
          hp: rec && typeof rec.hp === "number" ? rec.hp : undefined,
          maxHp: rec && typeof rec.maxHp === "number" ? rec.maxHp : undefined,
        };
        UIO.showFollower(ctx, runtime);
      } else if (ctx.log) {
        ctx.log(`${npc.name || "Follower"}: ${Array.isArray(npc.lines) && npc.lines[0] ? npc.lines[0] : "I'm with you."}`, "info");
      }
      return true;
    }
  } catch (_) {}

  const lines = Array.isArray(npc.lines) && npc.lines.length ? npc.lines : ["Hey!", "Watch it!", "Careful there."];
  let line = pick(lines, ctx.rng);
  // Normalize keeper lines for Inn: always open, avoid misleading schedule phrases
  try {
    const shopRef = npc && (npc._shopRef || null);
    if (shopRef && String(shopRef.type || "").toLowerCase() === "inn" && !!shopRef.alwaysOpen) {
      const s = String(line || "").toLowerCase();
      if (s.includes("open") || s.includes("closed") || s.includes("schedule") || s.includes("dawn") || s.includes("dusk")) {
        line = "We're open day and night.";
      }
    }
  } catch (_) {}
  ctx.log && ctx.log(`${npc.name || "Villager"}: ${line}`, "info");

  // Only shopkeepers can open shops; villagers should not trigger trading.
  const isKeeper = !!(npc && (npc.isShopkeeper || npc._shopRef));

  // Determine if keeper is at their shop:
  // - on the door tile
  // - adjacent to the door (preferred spawn avoids blocking the door itself)
  // - inside the building
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
    // Adjacent to door (outside or just inside) counts as being "at" the shop for interaction.
    // Accept both cardinal and diagonal adjacency to the door (Chebyshev distance <= 1).
    const dx = Math.abs(n.x - shop.x), dy = Math.abs(n.y - shop.y);
    const nearDoor = (dx + dy) === 1 || Math.max(dx, dy) === 1;
    return atDoor || inside || nearDoor;
  }

  // Helper to open a shop reference (if open), showing schedule when closed
  function tryOpenShopRef(shopRef, sourceNpc) {
    try {
      const SS = ctx.ShopService || (typeof window !== "undefined" ? window.ShopService : null);
      const openNow = (SS && typeof SS.isShopOpenNow === "function") ? SS.isShopOpenNow(ctx, shopRef) : false;
      const sched = (SS && typeof SS.shopScheduleStr === "function") ? SS.shopScheduleStr(shopRef) : "";
      if (openNow) {
        try {
          const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
          if (UIO && typeof UIO.showShop === "function") {
            UIO.showShop(ctx, sourceNpc || npc);
          }
        } catch (_) {}
        // UIOrchestration.showShop schedules draw when opening; no manual draw needed
        return true;
      } else {
        ctx.log && ctx.log(`The ${shopRef.name || "shop"} is closed. ${sched}`, "warn");
      }
    } catch (_) {}
    return false;
  }

  if (isKeeper) {
    try {
      let shopRef = npc._shopRef || null;

      // Fallback: if keeper lacks a shopRef (e.g., after re-entering town from persistence),
      // attach the nearest shop by proximity to door or interior.
      if (!shopRef && Array.isArray(ctx.shops)) {
        let best = null;
        let bestScore = Infinity;
        for (const s of ctx.shops) {
          if (!s) continue;
          let inside = false;
          try {
            const b = s.building || null;
            if (b) inside = (npc.x > b.x && npc.x < b.x + b.w - 1 && npc.y > b.y && npc.y < b.y + b.h - 1);
          } catch (_) {}
          const dx = Math.abs(npc.x - s.x), dy = Math.abs(npc.y - s.y);
          const nearDoor = (dx + dy) === 1 || Math.max(dx, dy) <= 1;
          const close = (dx + dy) <= 2;
          if (inside || nearDoor || close) {
            const score = inside ? 0 : (nearDoor ? 1 : (dx + dy));
            if (score < bestScore) { bestScore = score; best = s; }
          }
        }
        if (best) {
          npc._shopRef = best;
          shopRef = best;
        }
      }

      if (shopRef) {
        // Inn: always open and interactable anywhere inside — open immediately on bump
        const isInn = String(shopRef.type || "").toLowerCase() === "inn";
        if (isInn) {
          tryOpenShopRef(shopRef, npc);
          return true;
        }

        if (isKeeperAtShop(npc, shopRef)) {
          // Keeper at or near the shop door (or inside) — open directly if hours allow
          tryOpenShopRef(shopRef, npc);
        } else {
          // Fallback: if the shop is currently open, allow trading when bumping the keeper anywhere
          // This makes trading more forgiving when the keeper is on their way or patrolling nearby.
          const SS = ctx.ShopService || (typeof window !== "undefined" ? window.ShopService : null);
          const openNow = (SS && typeof SS.isShopOpenNow === "function") ? SS.isShopOpenNow(ctx, shopRef) : false;
          if (openNow) {
            tryOpenShopRef(shopRef, npc);
          } else {
            const sched = (SS && typeof SS.shopScheduleStr === "function") ? SS.shopScheduleStr(shopRef) : "";
            ctx.log && ctx.log(`${npc.name || "Shopkeeper"} is away from the ${shopRef.name || "shop"}. ${sched ? "(" + sched + ")" : ""}`, "info");
          }
        }
      } else {
        // No shop resolved; log and return
        ctx.log && ctx.log(`${npc.name || "Shopkeeper"}: shop not found nearby.`, "warn");
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
  let occupant = null;
  try {
    if (ctx.occupancy && typeof ctx.occupancy.hasNPC === "function") {
      npcBlocked = !!ctx.occupancy.hasNPC(nx, ny);
    } else {
      npcBlocked = Array.isArray(ctx.npcs) && ctx.npcs.some(n => n && n.x === nx && n.y === ny);
    }
    if (npcBlocked && Array.isArray(ctx.npcs)) {
      occupant = ctx.npcs.find(n => n && n.x === nx && n.y === ny) || null;
    }
  } catch (_) {}

  // When upstairs overlay is active, ignore downstairs NPC blocking inside the inn footprint
  // BUT: if the occupant at the bump tile is the innkeeper, still treat it as a talk bump to open the shop UI.
  try {
    if (ctx.innUpstairsActive && ctx.tavern && ctx.tavern.building) {
      const b = ctx.tavern.building;
      const insideInn = (nx > b.x && nx < b.x + b.w - 1 && ny > b.y && ny < b.y + b.h - 1);
      if (insideInn) {
        const npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
        if (!occupant) {
          try {
            occupant = npcs.find(n => n && n.x === nx && n.y === ny) || null;
          } catch (_) {}
        }
        const isInnKeeper = !!(occupant && occupant.isShopkeeper && occupant._shopRef && String(occupant._shopRef.type || "").toLowerCase() === "inn");
        if (isInnKeeper) {
          // Open shop UI via talk even when overlay is active
          if (typeof talk === "function") {
            talk(ctx, nx, ny);
          }
          return true;
        }
        // Otherwise, allow walking through downstairs NPCs while upstairs overlay is active
        npcBlocked = false;
      }
    }
  } catch (_) {}

  // If bumping a hostile town NPC (currently bandits) during a town combat event, perform a full melee attack
  // using the shared Combat.playerAttackEnemy logic instead of simple flat damage.
  const isBanditTarget = !!(occupant && occupant.isBandit && !occupant._dead);
  const banditEventActive = !!(
    (ctx._townBanditEvent && ctx._townBanditEvent.active) ||
    (occupant && occupant._banditEvent)
  );
  if (npcBlocked && isBanditTarget && banditEventActive) {
    const C =
      (ctx && ctx.Combat) ||
      getMod(ctx, "Combat") ||
      (typeof window !== "undefined" ? window.Combat : null);

    if (C && typeof C.playerAttackEnemy === "function") {
      const enemyRef = occupant;
      const oldOnEnemyDied = ctx.onEnemyDied;
      try {
        // In town combat, killing a bandit should remove the NPC instead of using DungeonRuntime.killEnemy.
        ctx.onEnemyDied = function (enemy) {
          try {
            if (enemy === enemyRef) {
              enemyRef._dead = true;
            } else if (typeof oldOnEnemyDied === "function") {
              oldOnEnemyDied(enemy);
            }
          } catch (_) {}
        };
      } catch (_) {}

      try {
        C.playerAttackEnemy(ctx, enemyRef);
      } catch (_) {}

      // Restore original handler
      try {
        ctx.onEnemyDied = oldOnEnemyDied;
      } catch (_) {}

      // Rebuild occupancy if the bandit died
      try {
        if (enemyRef._dead) {
          rebuildOccupancy(ctx);
        }
      } catch (_) {}

      try { ctx.turn && ctx.turn(); } catch (_) {}
      return true;
    }

    // Fallback: simple town melee if Combat module is unavailable.
    let atk = 4;
    try {
      if (typeof ctx.getPlayerAttack === "function") {
        const v = ctx.getPlayerAttack();
        if (typeof v === "number" && v > 0) atk = v;
      }
    } catch (_) {}
    let mult = 1.0;
    try {
      if (typeof ctx.rng === "function") {
        mult = 0.8 + ctx.rng() * 0.7; // 0.8–1.5x
      }
    } catch (_) {}
    const dmg = Math.max(1, Math.round(atk * mult));
    const maxHp = typeof occupant.maxHp === "number" ? occupant.maxHp : 20;
    if (typeof occupant.hp !== "number") occupant.hp = maxHp;
    occupant.hp -= dmg;
    const label = occupant.name || (occupant.isBandit ? "Bandit" : "target");
    try {
      if (occupant.hp > 0) {
        ctx.log && ctx.log(`You hit ${label} for ${dmg}. (${Math.max(0, occupant.hp)} HP left)`, "combat");
      } else {
        occupant._dead = true;
        ctx.log && ctx.log(`You kill ${label}.`, "fatal");
      }
      if (typeof ctx.addBloodDecal === "function" && dmg > 0) {
        ctx.addBloodDecal(occupant.x, occupant.y, 1.2);
      }
    } catch (_) {}
    try { ctx.turn && ctx.turn(); } catch (_) {}
    return true;
  }

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
      const SS = ctx.StateSync || getMod(ctx, "StateSync");
      if (SS && typeof SS.applyAndRefresh === "function") {
        SS.applyAndRefresh(ctx, {});
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

  // Sync any follower/ally state before persisting and leaving town.
  try {
    syncFollowersFromTown(ctx);
  } catch (_) {}

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

  // Hide UI elements (Quest Board and similar town-only modals)
  try {
    const UB = ctx.UIBridge || (typeof window !== "undefined" ? window.UIBridge : null);
    if (UB && typeof UB.hideQuestBoard === "function") UB.hideQuestBoard(ctx);
  } catch (_) {}

  // Refresh via StateSync
  try {
    const SS = ctx.StateSync || getMod(ctx, "StateSync");
    if (SS && typeof SS.applyAndRefresh === "function") {
      SS.applyAndRefresh(ctx, {});
    }
  } catch (_) {}
  try { ctx.log && ctx.log("You return to the overworld.", "info"); } catch (_) {}

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

/**
 * Start a special caravan ambush encounter when the player chooses to attack a caravan
 * from inside town. The caravan master and their guards are represented as enemies,
 * and a broken caravan with a lootable chest appears on a small road map.
 */
function startCaravanAmbushEncounter(ctx, npc) {
  try {
    // Close any confirm dialog before switching modes
    try {
      const UIO = ctx.UIOrchestration || (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.cancelConfirm === "function") UIO.cancelConfirm(ctx);
    } catch (_) {}

    // Remove the caravan merchant and their shop from town so they don't persist after the attack.
    try {
      if (Array.isArray(ctx.npcs)) {
        const idx = ctx.npcs.indexOf(npc);
        if (idx !== -1) ctx.npcs.splice(idx, 1);
      }
      if (Array.isArray(ctx.shops)) {
        for (let i = ctx.shops.length - 1; i >= 0; i--) {
          const s = ctx.shops[i];
          if (s && s.type === "caravan") ctx.shops.splice(i, 1);
        }
      }
      // Mark any parked caravan at this town as no longer atTown so the overworld logic can move/retire it.
      try {
        const world = ctx.world;
        if (world && Array.isArray(world.caravans) && ctx.worldReturnPos) {
          const wx = ctx.worldReturnPos.x | 0;
          const wy = ctx.worldReturnPos.y | 0;
          for (const cv of world.caravans) {
            if (!cv) continue;
            if ((cv.x | 0) === wx && (cv.y | 0) === wy && cv.atTown) {
              cv.atTown = false;
              cv.dwellUntil = 0;
              cv.ambushed = true;
            }
          }
        }
      } catch (_) {}
      try { rebuildOccupancy(ctx); } catch (_) {}
    } catch (_) {}

    const template = {
      id: "caravan_ambush",
      name: "Caravan Ambush",
      map: { w: 26, h: 16, generator: "caravan_road" },
      groups: [
        { faction: "guard", count: { min: 3, max: 4 }, type: "guard" },
        { faction: "guard", count: { min: 2, max: 3 }, type: "guard_elite" }
      ],
      objective: { type: "reachExit" },
      difficulty: 4
    };

    const biome = "GRASS";
    let ok = false;
    try {
      const GA = ctx.GameAPI || getMod(ctx, "GameAPI") || (typeof window !== "undefined" ? window.GameAPI : null);
      if (GA && typeof GA.enterEncounter === "function") {
        ok = !!GA.enterEncounter(template, biome, template.difficulty);
      } else if (typeof ctx.enterEncounter === "function") {
        ok = !!ctx.enterEncounter(template, biome);
      }
    } catch (_) {}

    if (!ok && ctx.log) {
      ctx.log("Failed to start caravan ambush encounter.", "warn");
    } else if (ok && ctx.log) {
      ctx.log("You ambush the caravan outside the town!", "notice");
    }
  } catch (_) {}
}

/**
 * Spawn a bandit group just inside the town gate and mark a lightweight town combat event.
 * Guards will be steered towards bandits by TownAI; bandits may attack guards and other NPCs.
 */
export function startBanditsAtGateEvent(ctx) {
  if (!ctx || ctx.mode !== "town") {
    if (ctx && ctx.log) ctx.log("Bandits at the gate event requires town mode.", "warn");
    return false;
  }
  try {
    // Ensure we have a gate anchor; older saved towns may not have townExitAt persisted.
    let gate = ctx.townExitAt;
    const map = ctx.map;
    const rows = Array.isArray(map) ? map.length : 0;
    const cols = rows && Array.isArray(map[0]) ? map[0].length : 0;

    if (!gate || typeof gate.x !== "number" || typeof gate.y !== "number") {
      const T = ctx.TILES || {};
      let gx = null;
      let gy = null;

      // Try to infer gate from a perimeter DOOR and pick the adjacent interior floor tile.
      if (rows && cols && T.DOOR != null) {
        // Top row
        for (let x = 0; x < cols && gx == null; x++) {
          if (map[0][x] === T.DOOR && rows > 1) { gx = x; gy = 1; }
        }
        // Bottom row
        if (gx == null) {
          for (let x = 0; x < cols && gx == null; x++) {
            if (map[rows - 1][x] === T.DOOR && rows > 1) { gx = x; gy = rows - 2; }
          }
        }
        // Left column
        if (gx == null) {
          for (let y = 0; y < rows && gx == null; y++) {
            if (map[y][0] === T.DOOR && cols > 1) { gx = 1; gy = y; }
          }
        }
        // Right column
        if (gx == null) {
          for (let y = 0; y < rows && gx == null; y++) {
            if (map[y][cols - 1] === T.DOOR && cols > 1) { gx = cols - 2; gy = y; }
          }
        }
      }

      if (gx != null && gy != null) {
        gate = { x: gx, y: gy };
        ctx.townExitAt = gate;
        try {
          ctx.log && ctx.log(
            `[TownRuntime] BanditsAtGate: reconstructed missing townExitAt at (${gate.x},${gate.y}).`,
            "info"
          );
        } catch (_) {}
      } else {
        // Final fallback: treat the player's current tile as the \"gate\" anchor so the event still works.
        gate = { x: ctx.player.x | 0, y: ctx.player.y | 0 };
        ctx.townExitAt = gate;
        try {
          ctx.log && ctx.log(
            "[TownRuntime] BanditsAtGate: could not find a gate; using player position as gate anchor.",
            "warn"
          );
        } catch (_) {}
      }
    }

    const maxBandits = 10;
    const minBandits = 5;
    const rng = typeof ctx.rng === "function" ? ctx.rng : (() => 0.5);
    const count = Math.max(
      minBandits,
      Math.min(maxBandits, Math.floor(minBandits + rng() * (maxBandits - minBandits + 1)))
    );
    try {
      ctx.log &&
        ctx.log(
          `[TownRuntime] BanditsAtGate: gate at (${gate.x},${gate.y}), planning to spawn ${count} bandits.`,
          "info"
        );
    } catch (_) {}

    const spots = [];
    const radiusX = 4;
    const radiusY = 3;
    for (let dy = -radiusY; dy <= radiusY; dy++) {
      for (let dx = -radiusX; dx <= radiusX; dx++) {
        const x = gate.x + dx;
        const y = gate.y + dy;
        if (x < 1 || y < 1 || y >= rows - 1 || x >= cols - 1) continue;
        if (!isFreeTownFloor(ctx, x, y)) continue;
        // Prefer tiles just inside the gate (same row or slightly inward)
        const inwardBias = dy >= 0 ? 0 : Math.abs(dy);
        spots.push({ x, y, score: Math.abs(dx) + inwardBias });
      }
    }
    if (!spots.length) {
      ctx.log &&
        ctx.log(
          "[TownRuntime] BanditsAtGate: no free space near the gate to spawn bandits.",
          "warn"
        );
      return false;
    }
    spots.sort((a, b) => a.score - b.score);
    try {
      ctx.log &&
        ctx.log(
          `[TownRuntime] BanditsAtGate: found ${spots.length} candidate tiles for spawns.`,
          "info"
        );
    } catch (_) {}

    const bandits = [];
    const used = new Set();
    // Approximate combat stats for town bandits/guards using the same damage model helpers
    const playerLevel =
      ctx.player && typeof ctx.player.level === "number" ? ctx.player.level : 1;

    function takeSpot() {
      for (let i = 0; i < spots.length; i++) {
        const k = spots[i].x + "," + spots[i].y;
        if (!used.has(k)) {
          used.add(k);
          return { x: spots[i].x, y: spots[i].y };
        }
      }
      return null;
    }

    ctx.npcs = Array.isArray(ctx.npcs) ? ctx.npcs : [];
    // Spawn bandits
    for (let i = 0; i < count; i++) {
      const pos = takeSpot();
      if (!pos) break;
      const hp = 18 + Math.floor(rng() * 8); // 18-25 hp
      const name = i === 0 ? "Bandit captain" : "Bandit";
      const lines =
        i === 0
          ? ["Take what you can!", "No one passes this gate!"]
          : ["Grab the loot!", "For the gang!"];
      const level = Math.max(1, playerLevel + (i === 0 ? 1 : 0));
      const atk = i === 0 ? 3 : 2;
      const b = {
        x: pos.x,
        y: pos.y,
        name,
        lines,
        isBandit: true,
        hostile: true,
        faction: "bandit",
        type: "bandit",
        level,
        atk,
        hp,
        maxHp: hp,
        _banditEvent: true,
      };
      ctx.npcs.push(b);
      bandits.push(b);
    }

    if (!bandits.length) {
      ctx.log &&
        ctx.log(
          "[TownRuntime] BanditsAtGate: failed to place any bandits near the gate.",
          "warn"
        );
      return false;
    }

    // Spawn a few town guards near the gate to respond to the attack.
    const guards = [];
    const guardCount = Math.max(2, Math.min(4, Math.floor(bandits.length / 2)));
    for (let i = 0; i < guardCount; i++) {
      const pos = takeSpot();
      if (!pos) break;
      const eliteChance = 0.3;
      const isEliteGuard = rng() < eliteChance;
      const guardType = isEliteGuard ? "guard_elite" : "guard";
      const name = isEliteGuard ? `Guard captain ${i + 1}` : `Guard ${i + 1}`;
      // Slightly weaker guards for town bandit event compared to dungeon/encounter guards
      const baseHp = isEliteGuard ? 24 : 18;
      const hp = baseHp + Math.floor(rng() * 6); // small jitter
      const level = Math.max(1, playerLevel + (isEliteGuard ? 2 : 1));
      const atk = isEliteGuard ? 3 : 2;
      const g = {
        x: pos.x,
        y: pos.y,
        name,
        lines: [
          "To arms!",
          "Protect the townsfolk!",
          "Hold the gate!"
        ],
        isGuard: true,
        guard: true,
        guardType,
        type: guardType,
        level,
        faction: "guard",
        atk,
        hp,
        maxHp: hp,
        _guardPost: { x: pos.x, y: pos.y }
      };
      ctx.npcs.push(g);
      guards.push(g);
    }

    try {
      rebuildOccupancy(ctx);
    } catch (_) {}

    const turn =
      ctx.time && typeof ctx.time.turnCounter === "number"
        ? ctx.time.turnCounter | 0
        : 0;
    ctx._townBanditEvent = {
      active: true,
      startedTurn: turn,
      totalBandits: bandits.length,
      guardsSpawned: guards.length,
    };
    try {
      ctx.log &&
        ctx.log(
          `[TownRuntime] BanditsAtGate: spawned ${bandits.length} bandits and ${guards.length} guard(s) near gate at (${gate.x},${gate.y}).`,
          "info"
        );
    } catch (_) {}
    ctx.log &&
      ctx.log(
        "Bandits rush the town gate! Guards shout and civilians scramble for safety.",
        "notice"
      );
    return true;
  } catch (e) {
    try {
      console.error(e);
    } catch (_) {}
    if (ctx && ctx.log) ctx.log("Failed to start Bandits at the Gate event.", "warn");
    return false;
  }
}

if (typeof window !== "undefined") {
  window.TownRuntime = {
    generate,
    ensureSpawnClear,
    spawnGateGreeters,
    isFreeTownFloor,
    talk,
    tryMoveTown,
    tick,
    returnToWorldIfAtGate,
    applyLeaveSync,
    rebuildOccupancy,
    startBanditsAtGateEvent,
    spawnInnFollowerHires,
  };
}

// Back-compat: tick implementation (retained)
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

  // Simple follower NPC behavior: stay near the player in town, unless set to wait.
  try {
    const p = ctx.player;
    if (p && Array.isArray(ctx.npcs)) {
      const followers = p && Array.isArray(p.followers) ? p.followers : null;
      for (const n of ctx.npcs) {
        if (!n || !n._isFollower) continue;

        // Resolve follower mode from the record (or NPC override) so town followers
        // can obey simple follow / wait commands.
        let mode = "follow";
        try {
          if (n._followerMode === "wait" || n._followerMode === "follow") {
            mode = n._followerMode;
          } else if (followers && n._followerId != null) {
            const rec = followers.find(f => f && f.id === n._followerId) || null;
            if (rec && (rec.mode === "wait" || rec.mode === "follow")) {
              mode = rec.mode;
            }
          }
        } catch (_) {}
        if (mode === "wait") continue;

        const dx = p.x - n.x;
        const dy = p.y - n.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        const followRange = 2;
        if (dist <= followRange) continue;

        const sx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
        const sy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
        const primary = Math.abs(dx) > Math.abs(dy)
          ? [{ x: sx, y: 0 }, { x: 0, y: sy }]
          : [{ x: 0, y: sy }, { x: sx, y: 0 }];

        let moved = false;
        for (const d of primary) {
          const nx = n.x + d.x;
          const ny = n.y + d.y;
          if (isFreeTownFloor(ctx, nx, ny)) {
            if (ctx.occupancy && typeof ctx.occupancy.clearNPC === "function") {
              ctx.occupancy.clearNPC(n.x, n.y);
            }
            n.x = nx;
            n.y = ny;
            if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
              ctx.occupancy.setNPC(n.x, n.y);
            }
            moved = true;
            break;
          }
        }
        if (!moved) {
          const ALT_DIRS = [
            { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
          ];
          for (const d of ALT_DIRS) {
            const nx = n.x + d.x;
            const ny = n.y + d.y;
            if (isFreeTownFloor(ctx, nx, ny)) {
              if (ctx.occupancy && typeof ctx.occupancy.clearNPC === "function") {
                ctx.occupancy.clearNPC(n.x, n.y);
              }
              n.x = nx;
              n.y = ny;
              if (ctx.occupancy && typeof ctx.occupancy.setNPC === "function") {
                ctx.occupancy.setNPC(n.x, n.y);
              }
              break;
            }
          }
        }
      }
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

  // Visual: fade blood decals over time in town mode, matching dungeon/region behavior
  try {
    const DC =
      (ctx && ctx.Decals) ||
      getMod(ctx, "Decals") ||
      (typeof window !== "undefined" ? window.Decals : null);
    if (DC && typeof DC.tick === "function") {
      DC.tick(ctx);
    } else if (Array.isArray(ctx.decals) && ctx.decals.length) {
      for (let i = 0; i < ctx.decals.length; i++) {
        ctx.decals[i].a *= 0.92;
      }
      ctx.decals = ctx.decals.filter(d => d.a > 0.04);
    }
  } catch (_) {}

  // Clamp corpse list length similar to dungeon tick so town combat can't grow it unbounded
  try {
    if (Array.isArray(ctx.corpses) && ctx.corpses.length > 50) {
      ctx.corpses = ctx.corpses.slice(-50);
    }
  } catch (_) {}

  return true;
}