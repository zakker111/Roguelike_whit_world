import * as World from "../world/world.js";
import { getUIOrchestration, getMod, getRNGUtils } from "../utils/access.js";
import { saveRegionState, addRegionCut } from "./region_map_persistence.js";

function getIntAttribute(ctx) {
  try {
    const p = ctx && ctx.player ? ctx.player : null;
    const attrs = p && p.attributes ? p.attributes : null;
    const intVal = attrs && typeof attrs.int === "number" ? attrs.int : 0;
    const n = intVal | 0;
    return n < 0 ? 0 : n;
  } catch (_) {
    return 0;
  }
}

function chanceIntBonus(ctx, prob) {
  try {
    if (!(prob > 0)) return false;
    const RU = getRNGUtils(ctx);
    if (RU && typeof RU.chance === "function") {
      let rng = null;
      try {
        if (typeof ctx.rng === "function") rng = ctx.rng;
      } catch (_) {}
      return RU.chance(prob, rng);
    }
  } catch (_) {}
  // If RNG helpers are unavailable, skip bonus for determinism.
  return false;
}

// Handle all non-exit Region Map context actions (loot, harvest, fishing).
export function handleRegionAction(ctx) {
  if (!ctx || ctx.mode !== "region" || !ctx.region) return false;
  const { cursor } = ctx.region;

  // 1) Loot corpse/chest underfoot — mirror dungeon flavor (cause-of-death) while using shared Loot for items
  try {
    const list = Array.isArray(ctx.corpses) ? ctx.corpses : [];
    const underfoot = list.filter(c => c && c.x === cursor.x && c.y === cursor.y);
    if (underfoot.length) {
      // Show corpse flavor consistently (victim, wound, killer, weapon/likely cause) before looting.
      try {
        const FS = (typeof window !== "undefined" ? window.FlavorService : null);
        if (FS && typeof FS.describeCorpse === "function") {
          for (const c of underfoot) {
            const meta = c && c.meta;
            if (meta && (meta.killedBy || meta.wound || meta.via || meta.likely)) {
              const line = FS.describeCorpse(meta);
              if (line) ctx.log && ctx.log(line, "flavor", { category: "Combat", side: "enemy", tone: "injury" });
            }
          }
        }
      } catch (_) {}

      // Determine whether there is any remaining loot underfoot
      const containersWithLoot = underfoot.filter(c => Array.isArray(c.loot) && c.loot.length > 0);

      if (containersWithLoot.length === 0) {
        // No items left: behave like dungeon lootHere for empty corpses/chests, but persist via Region state.
        let newlyExamined = 0;
        let examinedChestCount = 0;
        let examinedCorpseCount = 0;
        for (const c of underfoot) {
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
            line = examinedChestCount === 1
              ? "You search the chest but find nothing."
              : "You search the chests but find nothing.";
          } else if (examinedCorpseCount > 0 && examinedChestCount === 0) {
            line = examinedCorpseCount === 1
              ? "You search the corpse but find nothing."
              : "You search the corpses but find nothing.";
          } else {
            line = "You search the area but find nothing.";
          }
          ctx.log && ctx.log(line);
        }
        // Persist emptied containers in Region Map state and advance time
        try { saveRegionState(ctx); } catch (_) {}
        if (typeof ctx.updateUI === "function") ctx.updateUI();
        if (typeof ctx.turn === "function") ctx.turn();
        return true;
      }

      // There is real loot underfoot: delegate to Loot subsystem for transfer/UI.
      const L = ctx.Loot || getMod(ctx, "Loot");
      if (!L || typeof L.lootHere !== "function") {
        throw new Error("Loot.lootHere missing; loot system cannot proceed in Region Map");
      }
      L.lootHere(ctx);
      // Persist region state immediately so looted containers remain emptied on reopen
      try { saveRegionState(ctx); } catch (_) {}
      return true;
    }
  } catch (_) {}

  // 2) Harvest berry bush or chop tree if standing on those tiles
  try {
    const WT = World.TILES;
    const t = (ctx.region.map[cursor.y] && ctx.region.map[cursor.y][cursor.x]);

    if (t === WT.BERRY_BUSH) {
      // Pick berries and remove bush (convert to forest)
      try {
        const inv = ctx.player.inventory || (ctx.player.inventory = []);
        let existing = inv.find(it => it && it.kind === "material" && (String(it.name || it.type || "").toLowerCase() === "berries"));
        if (!existing) {
          existing = { kind: "material", type: "berries", name: "berries", amount: 0 };
          inv.push(existing);
        }
        if (typeof existing.amount === "number") existing.amount += 1;
        else if (typeof existing.count === "number") existing.count += 1;
        else existing.amount = 1;

        // INT: small chance to find an extra handful of berries.
        try {
          const intVal = getIntAttribute(ctx);
          if (intVal > 0) {
            const capped = intVal > 40 ? 40 : intVal;
            const pBonus = Math.min(0.25, capped * 0.006); // up to +25%
            if (chanceIntBonus(ctx, pBonus)) {
              const extra = 1;
              if (typeof existing.amount === "number") existing.amount += extra;
              else if (typeof existing.count === "number") existing.count += extra;
              else existing.amount = (existing.amount | 0) + extra;
            }
          }
        } catch (_) {}

        // Foraging skill gain
        try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.foraging = (ctx.player.skills.foraging || 0) + 1; } catch (_) {}
        if (ctx.log) ctx.log("You pick berries.", "info");
        // Remove the bush so it can't be farmed repeatedly
        ctx.region.map[cursor.y][cursor.x] = World.TILES.FOREST;
        // Persist removal
        try {
          if (ctx.region && typeof ctx.region._cutKey === "string" && ctx.region._cutKey) {
            addRegionCut(ctx.region._cutKey, cursor.x | 0, cursor.y | 0);
          }
        } catch (_) {}
        if (typeof ctx.updateUI === "function") ctx.updateUI();
        try {
          const SS = ctx.StateSync || getMod(ctx, "StateSync");
          if (SS && typeof SS.applyAndRefresh === "function") {
            SS.applyAndRefresh(ctx, {});
          }
        } catch (_) {}
      } catch (_) {}
      return true;
    }

    if (t === WT.TREE) {
      // Log and convert this spot back to forest for visualization
      if (ctx.log) ctx.log("You cut the tree.", "info");
      try {
        // Foraging skill gain
        try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.foraging = (ctx.player.skills.foraging || 0) + 1; } catch (_) {}
        ctx.region.map[cursor.y][cursor.x] = World.TILES.FOREST;
        // Reflect change via orchestrator refresh
        try {
          const SS = ctx.StateSync || getMod(ctx, "StateSync");
          if (SS && typeof SS.applyAndRefresh === "function") {
            SS.applyAndRefresh(ctx, {});
          }
        } catch (_) {}
      } catch (_) {}

      // Grant planks material in inventory (stacking)
      try {
        const inv = ctx.player.inventory || (ctx.player.inventory = []);
        let existing = inv.find(it => it && it.kind === "material" && (it.type === "wood" || it.material === "wood") && (String(it.name || "").toLowerCase() === "planks"));
        if (!existing) {
          existing = { kind: "material", type: "wood", name: "planks", amount: 0 };
          inv.push(existing);
        }
        if (typeof existing.amount === "number") existing.amount += 10;
        else if (typeof existing.count === "number") existing.count += 10;
        else existing.amount = 10;

        // INT: small chance to harvest a few extra planks from each tree.
        try {
          const intVal = getIntAttribute(ctx);
          if (intVal > 0) {
            const capped = intVal > 40 ? 40 : intVal;
            const pBonus = Math.min(0.20, capped * 0.005); // up to +20%
            if (chanceIntBonus(ctx, pBonus)) {
              const extra = 5;
              if (typeof existing.amount === "number") existing.amount += extra;
              else if (typeof existing.count === "number") existing.count += extra;
              else existing.amount = (existing.amount | 0) + extra;
            }
          }
        } catch (_) {}

        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}

      // Persist cut so this tree does not respawn next time for this region
      try {
        if (ctx.region && typeof ctx.region._cutKey === "string" && ctx.region._cutKey) {
          addRegionCut(ctx.region._cutKey, cursor.x | 0, cursor.y | 0);
        }
      } catch (_) {}

      return true;
    }
  } catch (_) {}

  // 3) Fishing: if adjacent to water/river and player has a fishing pole, prompt to start mini-game
  try {
    const WT = World.TILES;
    const inBounds = (x, y) => {
      const h = ctx.region.map.length;
      const w = ctx.region.map[0] ? ctx.region.map[0].length : 0;
      return x >= 0 && y >= 0 && x < w && y < h;
    };
    const isWater = (x, y) => {
      if (!inBounds(x, y)) return false;
      try {
        const tt = ctx.region.map[y][x];
        return (tt === WT.WATER || tt === WT.RIVER);
      } catch (_) { return false; }
    };
    const nearWater = (
      isWater(cursor.x + 1, cursor.y) ||
      isWater(cursor.x - 1, cursor.y) ||
      isWater(cursor.x, cursor.y + 1) ||
      isWater(cursor.x, cursor.y - 1) ||
      isWater(cursor.x + 1, cursor.y + 1) ||
      isWater(cursor.x - 1, cursor.y + 1) ||
      isWater(cursor.x + 1, cursor.y - 1) ||
      isWater(cursor.x - 1, cursor.y - 1)
    );

    const hasPole = (function () {
      try {
        const inv = ctx.player.inventory || [];
        return inv.some(it => {
          if (!it) return false;
          const nm = String(it.name || it.type || "").toLowerCase();
          if (it.kind === "tool" && nm.includes("fishing pole")) return true;
          if (it.kind !== "tool" && nm.includes("fishing pole")) return true;
          return false;
        });
      } catch (_) { return false; }
    })();

    if (nearWater && hasPole) {
      const UIO = getUIOrchestration(ctx);
      const UB = ctx.UIBridge || getMod(ctx, "UIBridge");
      const onOk = () => {
        if (UB && typeof UB.showFishing === "function") {
          UB.showFishing(ctx, { minutesPerAttempt: 15, difficulty: 0.55 });
        } else {
          const FM = getMod(ctx, "FishingModal");
          if (FM && typeof FM.show === "function") {
            FM.show(ctx, { minutesPerAttempt: 15, difficulty: 0.55 });
          } else {
            try { ctx.log && ctx.log("Fishing UI not available.", "warn"); } catch (_) {}
          }
        }
      };
      const onCancel = () => {};
      if (UIO && typeof UIO.showConfirm === "function") {
        UIO.showConfirm(ctx, "Fish here? (15 min)", null, onOk, onCancel);
      } else {
        // No confirm UI; start immediately
        onOk();
      }
      return true;
    } else if (nearWater && !hasPole) {
      try { ctx.log && ctx.log("You need a fishing pole to fish here.", "info"); } catch (_) {}
      return true;
    }
  } catch (_) {}

  if (ctx.log) ctx.log("Move to an orange edge tile and press G to close the Region map.", "info");
  return true;
}
