/**
 * Dungeon loot helpers (Phase 3 extraction): generateLoot and lootHere.
 */
import { getMod } from "../../utils/access.js";
import { save } from "./state.js";

export function generateLoot(ctx, source) {
  try {
    if (ctx && ctx.Loot && typeof ctx.Loot.generate === "function") {
      return ctx.Loot.generate(ctx, source) || [];
    }
    if (typeof window !== "undefined" && window.Loot && typeof window.Loot.generate === "function") {
      return window.Loot.generate(ctx, source) || [];
    }
  } catch (_) {}
  return [];
}

export function lootHere(ctx) {
  if (!ctx || (ctx.mode !== "dungeon" && ctx.mode !== "encounter")) return false;

  // Exact-tile only: do not auto-step onto adjacent corpses/chests. Looting and flavor apply only if standing on the body tile.

  // Minimal unified handling: determine what's underfoot first, then delegate when there is actual loot
  try {
    const list = Array.isArray(ctx.corpses) ? ctx.corpses.filter(c => c && c.x === ctx.player.x && c.y === ctx.player.y) : [];
    if (list.length === 0) {
      ctx.log && ctx.log("There is no corpse here to loot.");
      return true;
    }

    // Determine if there is any loot underfoot first
    const container = list.find(c => Array.isArray(c.loot) && c.loot.length > 0);
    if (!container) {
      // No loot left underfoot; show death description each time (re-checkable)
      try {
        for (const c of list) {
          const meta = c && c.meta;
          if (meta && (meta.killedBy || meta.wound)) {
            const FS = (typeof window !== "undefined" ? window.FlavorService : null);
            const line = (FS && typeof FS.describeCorpse === "function")
              ? FS.describeCorpse(meta)
              : (() => {
                  const killerStr = meta.killedBy ? `Killed by ${meta.killedBy}.` : "";
                  const woundStr = meta.wound ? `Wound: ${meta.wound}.` : "";
                  const viaStr = meta.via ? `(${meta.via})` : "";
                  const parts = [woundStr, killerStr].filter(Boolean).join(" ");
                  return `${parts} ${viaStr}`.trim();
                })();
            if (line) ctx.log && ctx.log(line, "info");
          }
        }
      } catch (_) {}

      // Mark examined to control the "search...nothing" feedback and counts
      let newlyExamined = 0;
      let examinedChestCount = 0;
      let examinedCorpseCount = 0;
      for (const c of list) {
        c.looted = true;
        if (!c._examined) {
          c._examined = true;
          newlyExamined++;
          if (String(c.kind || "").toLowerCase() === "chest") examinedChestCount++;
          else examinedCorpseCount++;
        }
      }
      if (newlyExamined > 0) {
        let line = "";
        if (examinedChestCount > 0 && examinedCorpseCount === 0) {
          line = examinedChestCount === 1 ? "You search the chest but find nothing."
                                          : "You search the chests but find nothing.";
        } else if (examinedCorpseCount > 0 && examinedChestCount === 0) {
          line = newlyExamined === 1 ? "You search the corpse but find nothing."
                                     : "You search the corpses but find nothing.";
        } else {
          // Mixed containers underfoot
          line = "You search the area but find nothing.";
        }
        ctx.log && ctx.log(line);
      }
      try { save(ctx, false); } catch (_) {}
      ctx.updateUI && ctx.updateUI();
      ctx.turn && ctx.turn();
      return true;
    }

    // Show corpse description (re-checkable on each examine)
    try {
      for (const c of list) {
        const meta = c && c.meta;
        if (meta && (meta.killedBy || meta.wound)) {
          const FS = (typeof window !== "undefined" ? window.FlavorService : null);
          const line = (FS && typeof FS.describeCorpse === "function")
            ? FS.describeCorpse(meta)
            : (() => {
                const killerStr = meta.killedBy ? `Killed by ${meta.killedBy}.` : "";
                const woundStr = meta.wound ? `Wound: ${meta.wound}.` : "";
                const viaStr = meta.via ? `(${meta.via})` : "";
                const parts = [woundStr, killerStr].filter(Boolean).join(" ");
                return `${parts} ${viaStr}`.trim();
              })();
          if (line) ctx.log && ctx.log(line, "flavor", { category: "Combat", side: "enemy", tone: "injury" });
        }
      }
    } catch (_) {}

    // Delegate to Loot.lootHere for actual loot transfer if available
    try {
      if (ctx.Loot && typeof ctx.Loot.lootHere === "function") {
        ctx.Loot.lootHere(ctx);
        return true;
      }
      if (typeof window !== "undefined" && window.Loot && typeof window.Loot.lootHere === "function") {
        window.Loot.lootHere(ctx);
        return true;
      }
    } catch (_) {}
    const acquired = [];
    for (const item of container.loot) {
      if (!item) continue;
      if (item.kind === "equip" && typeof ctx.equipIfBetter === "function") {
        const equipped = ctx.equipIfBetter(item);
        const desc = ctx.describeItem ? ctx.describeItem(item) : (item.name || "equipment");
        acquired.push(equipped ? `equipped ${desc}` : desc);
        if (!equipped) (ctx.player.inventory || (ctx.player.inventory = [])).push(item);
      } else if (item.kind === "gold") {
        const gold = (ctx.player.inventory || (ctx.player.inventory = [])).find(i => i && i.kind === "gold");
        if (gold) gold.amount += item.amount;
        else ctx.player.inventory.push({ kind: "gold", amount: item.amount, name: "gold" });
        acquired.push(item.name || `${item.amount} gold`);
      } else {
        (ctx.player.inventory || (ctx.player.inventory = [])).push(item);
        acquired.push(item.name || (item.kind || "item"));
      }
    }
    container.loot = [];
    container.looted = true;
    ctx.updateUI && ctx.updateUI();
    ctx.log && ctx.log(`You loot: ${acquired.join(", ")}.`);
    try { save(ctx, false); } catch (_) {}
    ctx.turn && ctx.turn();
    return true;
  } catch (_) {}

  // Not handled
  return false;
}