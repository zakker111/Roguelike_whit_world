import { getMod } from "../../utils/access.js";

/**
 * Town talk / NPC interaction logic extracted from core/town/runtime.js.
 *
 * Exported as talk(ctx, bumpAtX?, bumpAtY?) and used by TownRuntime.
 */
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
        const rfn =
          typeof rng === "function"
            ? rng
            : typeof ctx.rng === "function"
            ? ctx.rng
            : undefined;
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

      if (
        FR &&
        typeof FR.canHireFollower === "function" &&
        typeof FR.hireFollowerFromArchetype === "function"
      ) {
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
            const inv = ctx.player && Array.isArray(ctx.player.inventory)
              ? ctx.player.inventory
              : [];
            for (let i = 0; i < inv.length; i++) {
              const it = inv[i];
              if (it && it.kind === "gold") {
                goldObj = it;
                goldAmt =
                  typeof it.amount === "number" ? (it.amount | 0) : 0;
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
                if (ctx.log && freshCheck && freshCheck.reason) {
                  ctx.log(freshCheck.reason, "info");
                }
                return;
              }
              // Ensure a gold stack exists.
              if (!goldObj) {
                const inv = ctx.player && Array.isArray(ctx.player.inventory)
                  ? ctx.player.inventory
                  : (ctx.player.inventory = []);
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
                  if (
                    ctx.occupancy &&
                    typeof ctx.occupancy.clearNPC === "function"
                  ) {
                    ctx.occupancy.clearNPC(npc.x | 0, npc.y | 0);
                  }
                } catch (_) {}
                if (ctx.log) {
                  ctx.log(
                    `${label} agrees to join you for ${priceStr}.`,
                    "good"
                  );
                }
              } else if (ctx.log) {
                ctx.log("They cannot join you right now.", "info");
              }
              try {
                if (typeof ctx.updateUI === "function") ctx.updateUI();
              } catch (_) {}
            } catch (_) {}
          };
          const onCancel = () => {
            try {
              if (ctx.log) {
                ctx.log(`${label}: "Maybe another time."`, "info");
              }
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
      const UIO =
        ctx.UIOrchestration ||
        getMod(ctx, "UIOrchestration") ||
        (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.showFollower === "function") {
        // Build a minimal runtime follower stub; UIOrchestration will enrich it using
        // player.followers and followers.json.
        const followers =
          ctx.player && Array.isArray(ctx.player.followers)
            ? ctx.player.followers
            : [];
        const rec =
          followers.find(f => f && f.id === npc._followerId) || null;
        const runtime = {
          _isFollower: true,
          _followerId: npc._followerId,
          id: npc._followerId,
          type: npc._followerId,
          name: npc.name || (rec && rec.name) || "Follower",
          faction: "guard",
          level:
            rec && typeof rec.level === "number" ? rec.level : 1,
          hp: rec && typeof rec.hp === "number" ? rec.hp : undefined,
          maxHp:
            rec && typeof rec.maxHp === "number" ? rec.maxHp : undefined,
        };
        UIO.showFollower(ctx, runtime);
      } else if (ctx.log) {
        ctx.log(
          `${npc.name || "Follower"}: ${
            Array.isArray(npc.lines) && npc.lines[0]
              ? npc.lines[0]
              : "I'm with you."
          }`,
          "info"
        );
      }
      return true;
    }
  } catch (_) {}

  const lines =
    Array.isArray(npc.lines) && npc.lines.length
      ? npc.lines
      : ["Hey!", "Watch it!", "Careful there."];
  let line = pick(lines, ctx.rng);
  // Normalize keeper lines for Inn: always open, avoid misleading schedule phrases
  try {
    const shopRef = npc && (npc._shopRef || null);
    if (
      shopRef &&
      String(shopRef.type || "").toLowerCase() === "inn" &&
      !!shopRef.alwaysOpen
    ) {
      const s = String(line || "").toLowerCase();
      if (
        s.includes("open") ||
        s.includes("closed") ||
        s.includes("schedule") ||
        s.includes("dawn") ||
        s.includes("dusk")
      ) {
        line = "We're open day and night.";
      }
    }
  } catch (_) {}
  ctx.log &&
    ctx.log(`${npc.name || "Villager"}: ${line}`, "info");

  // Market Day flag: weekly by default, with GOD override (ctx._forceMarketDay).
  // Forced Market Day lifetime is managed centrally by TownRuntime; this check is read-only.
  let isMarketDay = false;
  try {
    const t = ctx && ctx.time ? ctx.time : null;
    let dayIdx = null;
    if (t && typeof t.turnCounter === "number" && typeof t.cycleTurns === "number") {
      const tc = t.turnCounter | 0;
      let cyc = t.cycleTurns | 0;
      if (!cyc || cyc <= 0) cyc = 360;
      dayIdx = Math.floor(tc / Math.max(1, cyc));
    }
    if (ctx && ctx._forceMarketDay === true) {
      isMarketDay = true;
    }
    if (!isMarketDay && dayIdx != null) {
      isMarketDay = (dayIdx % 7) === 0;
    }
  } catch (_) {}

  // Only shopkeepers can open shops; villagers should not trigger trading.
  const isKeeper = !!(npc && (npc.isShopkeeper || npc._shopRef));

  // Determine if keeper is at their shop:
  // - on the door tile
  // - adjacent to the door (preferred spawn avoids blocking the door itself)
  // - inside the building
  function isKeeperAtShop(n, shop) {
    if (!n || !shop) return false;
    const atDoor = n.x === shop.x && n.y === shop.y;
    let inside = false;
    try {
      const b = shop.building || null;
      if (b) {
        inside =
          n.x > b.x &&
          n.x < b.x + b.w - 1 &&
          n.y > b.y &&
          n.y < b.y + b.h - 1;
      }
    } catch (_) {}
    // Adjacent to door (outside or just inside) counts as being "at" the shop for interaction.
    // Accept both cardinal and diagonal adjacency to the door (Chebyshev distance <= 1).
    const dx = Math.abs(n.x - shop.x),
      dy = Math.abs(n.y - shop.y);
    const nearDoor = dx + dy === 1 || Math.max(dx, dy) === 1;
    return atDoor || inside || nearDoor;
  }

  // On Market Day we relocate shopkeepers to market stalls in the plaza. For
  // interaction purposes, if the player is close enough to bump the NPC (the
  // 'near' check at the top of this function), we treat that as being \"at\" the
  // stall and allow trading without extra positional checks.
  function isPlayerAtMarketStall(ctxLocal, n) { // retained for potential future use
    if (!ctxLocal || !n || !n._marketStall) return false;
    const stall = n._marketStall;
    const px =
      ctxLocal.player && typeof ctxLocal.player.x === "number"
        ? ctxLocal.player.x
        : null;
    const py =
      ctxLocal.player && typeof ctxLocal.player.y === "number"
        ? ctxLocal.player.y
        : null;
    if (px == null || py == null) return false;
    const dx = Math.abs(px - stall.x);
    const dy = Math.abs(py - stall.y);
    return dx + dy === 0 || dx + dy === 1 || Math.max(dx, dy) === 1;
  }

  // Helper to open a shop reference (if open), showing schedule when closed
  function tryOpenShopRef(shopRef, sourceNpc) {
    try {
      const SS =
        ctx.ShopService ||
        (typeof window !== "undefined" ? window.ShopService : null);
      const openNow =
        SS && typeof SS.isShopOpenNow === "function"
          ? SS.isShopOpenNow(ctx, shopRef)
          : false;
      const sched =
        SS && typeof SS.shopScheduleStr === "function"
          ? SS.shopScheduleStr(shopRef)
          : "";
      if (openNow) {
        try {
          const UIO =
            ctx.UIOrchestration ||
            (typeof window !== "undefined"
              ? window.UIOrchestration
              : null);
          if (UIO && typeof UIO.showShop === "function") {
            UIO.showShop(ctx, sourceNpc || npc);
          }
        } catch (_) {}
        // UIOrchestration.showShop schedules draw when opening; no manual draw needed
        return true;
      } else {
        ctx.log &&
          ctx.log(
            `The ${shopRef.name || "shop"} is closed. ${sched}`,
            "warn"
          );
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
            if (b) {
              inside =
                npc.x > b.x &&
                npc.x < b.x + b.w - 1 &&
                npc.y > b.y &&
                npc.y < b.y + b.h - 1;
            }
          } catch (_) {}
          const dx = Math.abs(npc.x - s.x),
            dy = Math.abs(npc.y - s.y);
          const nearDoor = dx + dy === 1 || Math.max(dx, dy) <= 1;
          const close = dx + dy <= 2;
          if (inside || nearDoor || close) {
            const score = inside ? 0 : nearDoor ? 1 : dx + dy;
            if (score < bestScore) {
              bestScore = score;
              best = s;
            }
          }
        }
        if (best) {
          npc._shopRef = best;
          shopRef = best;
        }
      }

      if (shopRef) {
        // Inn: always open and interactable anywhere inside. Market Day does not
        // move inn trading to the plaza; the inn continues to function normally.
        const isInn = String(shopRef.type || "").toLowerCase() === "inn";
        if (isInn) {
          tryOpenShopRef(shopRef, npc);
          return true;
        }

        // Market Day: if this keeper has a market stall (either a relocated
        // town shopkeeper or a special Market Day vendor), allow trading any
        // time the player is close enough to talk to them.
        if (isMarketDay && npc._marketStall) {
          tryOpenShopRef(shopRef, npc);
        } else if (isKeeperAtShop(npc, shopRef)) {
          // Normal day, or keepers without market stalls: keeper at or near the
          // shop door (or inside) — open directly if hours allow.
          tryOpenShopRef(shopRef, npc);
        } else {
          // Away from shop/stall: do not open trading UI; show schedule/info only.
          const SS =
            ctx.ShopService ||
            (typeof window !== "undefined" ? window.ShopService : null);
          const sched =
            SS && typeof SS.shopScheduleStr === "function"
              ? SS.shopScheduleStr(shopRef)
              : "";
          ctx.log &&
            ctx.log(
              `${npc.name || "Shopkeeper"} is away from the ${
                shopRef.name || "shop"
              }. ${sched ? "(" + sched + ")" : ""}`,
              "info"
            );
        }
      } else {
        // No shop resolved; log and return
        ctx.log &&
          ctx.log(
            `${npc.name || "Shopkeeper"}: shop not found nearby.`,
            "warn"
          );
      }
    } catch (_) {}
    return true;
  }

  // Do not auto-open shops when bumping non-keepers, even if near a door.
  return true;
}