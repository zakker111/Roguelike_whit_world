/**
 * GMBridge: central wrapper for GMRuntime-driven side effects.
 *
 * Exports (ESM + window.GMBridge):
 * - maybeHandleWorldStep(ctx): boolean
 * - handleMarkerAction(ctx): boolean
 * - useInventoryItem(ctx, item, idx): boolean
 * - onEncounterComplete(ctx, { encounterId, outcome }): void
 */

import { getMod } from "../../utils/access.js";
import { attachGlobal } from "../../utils/global.js";
import { gmRngFloat } from "../gm/runtime/rng.js";

export function maybeHandleWorldStep(ctx) {
  if (!ctx) return false;

  try {
    const GM = getMod(ctx, "GMRuntime");
    if (!GM || typeof GM.getFactionTravelEvent !== "function") return false;

    const intent = GM.getFactionTravelEvent(ctx) || { kind: "none" };
    if (!intent || intent.kind === "none") return false;

    if (intent.kind === "guard_fine") {
      return handleGuardFineTravelEvent(ctx, GM);
    }

    if (intent.kind === "encounter") {
      const encId = intent.encounterId || intent.id || null;
      if (!encId) return false;
      return startGmFactionEncounter(ctx, encId);
    }

    // Unknown intent kinds are ignored for forward compatibility.
    return false;
  } catch (_) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Failed to process faction travel event intent.", "warn");
      }
    } catch (_) {}
    return false;
  }
}

export function handleMarkerAction(ctx) {
  if (!ctx) return false;

  try {
    const MS = getMod(ctx, "MarkerService");
    if (!MS || typeof MS.findAtPlayer !== "function") return false;

    const at = MS.findAtPlayer(ctx);
    const markers = Array.isArray(at) ? at : (at ? [at] : []);

    // We only handle gm.* markers here. Quest markers are handled by QuestService.
    const gmMarker = markers.find((m) => m && typeof m.kind === "string" && m.kind.startsWith("gm.")) || null;
    if (!gmMarker) return false;

    const kind = String(gmMarker.kind || "");

    if (kind === "gm.bottleMap") {
      return handleBottleMapMarker(ctx, gmMarker);
    }

    // Unknown gm.* markers are consumed for forward compatibility.
    try {
      if (typeof ctx.log === "function") {
        const k = String(gmMarker.kind || "gm.?");
        ctx.log(`[GM] Marker '${k}' action not implemented yet.`, "notice");
      }
    } catch (_) {}

    return true;
  } catch (_) {
    return false;
  }
}

function handleBottleMapMarker(ctx, marker) {
  try {
    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS) return true;

    const gm = GM.getState(ctx);
    const thread = ensureBottleMapThread(gm);
    if (!thread || thread.active !== true) {
      try { if (typeof ctx.log === "function") ctx.log("The map's ink has faded.", "warn"); } catch (_) {}
      // Clean up orphaned marker.
      try {
        const inst = marker && marker.instanceId != null ? String(marker.instanceId) : "";
        if (inst) MS.remove(ctx, { instanceId: inst });
      } catch (_) {}
      return true;
    }

    // Only start encounter if this marker matches the active thread target.
    const inst = marker && marker.instanceId != null ? String(marker.instanceId) : "";
    if (thread.instanceId && inst && String(thread.instanceId) !== inst) {
      return true;
    }

    if (thread.status === "claimed") {
      try { if (typeof ctx.log === "function") ctx.log("You've already claimed what's buried here.", "info"); } catch (_) {}
      return true;
    }

    if (thread.status !== "inEncounter") {
      thread.status = "inEncounter";
      thread.attempts = (thread.attempts | 0) + 1;
      try {
        GM.onEvent(ctx, { type: "gm.bottleMap.encounterStart", interesting: false, payload: { instanceId: thread.instanceId } });
      } catch (_) {}
    }

    // Start the dedicated Bottle Map encounter.
    return startGmBottleMapEncounter(ctx);
  } catch (_) {
    return true;
  }
}

function startGmBottleMapEncounter(ctx) {
  // Reuse startGmFactionEncounter to enter the encounter template.
  return startGmFactionEncounter(ctx, "gm_bottle_map_scene");
}

function ensureBottleMapThread(gm) {
  if (!gm || typeof gm !== "object") return null;
  if (!gm.threads || typeof gm.threads !== "object") gm.threads = {};
  if (!gm.threads.bottleMap || typeof gm.threads.bottleMap !== "object") gm.threads.bottleMap = { active: false };
  return gm.threads.bottleMap;
}

function isBottleMapItem(it) {
  try {
    if (!it) return false;
    if (it.usable !== true) return false;
    const k = String(it.kind || "").toLowerCase();
    if (k !== "tool" && k !== "item" && k !== "use") {
      // Allow custom kinds, but keep it narrow.
    }
    const id = String(it.type || it.id || it.key || it.name || "").toLowerCase();
    return id === "bottle_map" || id === "bottle map" || id.includes("bottle map") || id.includes("bottle_map");
  } catch (_) {
    return false;
  }
}

function pickBottleMapTarget(ctx, gm) {
  const w = (ctx && ctx.world) ? ctx.world : null;
  const map = w && Array.isArray(w.map) ? w.map : null;
  if (!map || !map.length || !map[0]) return null;

  const H = map.length | 0;
  const W = map[0].length | 0;

  const ox = (w && typeof w.originX === "number") ? (w.originX | 0) : 0;
  const oy = (w && typeof w.originY === "number") ? (w.originY | 0) : 0;

  const px = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
  const py = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
  const pAbsX = ox + px;
  const pAbsY = oy + py;

  const T = (typeof window !== "undefined" && window.World && window.World.TILES) ? window.World.TILES : null;

  const tries = 60;
  for (let n = 0; n < tries; n++) {
    // Distance 12..32, biased a bit farther.
    const r = 12 + Math.floor(Math.pow(gmRngFloat(gm), 0.65) * 20);
    const ang = gmRngFloat(gm) * Math.PI * 2;
    const dx = Math.round(Math.cos(ang) * r);
    const dy = Math.round(Math.sin(ang) * r);

    const absX = (pAbsX + dx) | 0;
    const absY = (pAbsY + dy) | 0;

    const lx = absX - ox;
    const ly = absY - oy;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;

    const tile = map[ly] ? map[ly][lx] : null;
    if (tile == null) continue;

    // Avoid towns/dungeons.
    try {
      if (T && (tile === T.TOWN || tile === T.DUNGEON)) continue;
    } catch (_) {}

    // Prefer engine walkability if available.
    try {
      if (typeof ctx.isWalkable === "function" && !ctx.isWalkable(lx, ly)) continue;
    } catch (_) {
      // Fallback: if World.isWalkable exists.
      try {
        if (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function") {
          if (!window.World.isWalkable(tile)) continue;
        }
      } catch (_) {}
    }

    return { absX, absY };
  }

  return { absX: pAbsX, absY: pAbsY };
}

function ensureUniqueGranted(gm) {
  if (!gm || typeof gm !== "object") return null;

  const runSeed = (typeof gm.runSeed === "number" && Number.isFinite(gm.runSeed)) ? (gm.runSeed >>> 0) : 0;

  if (!gm.uniqueGranted || typeof gm.uniqueGranted !== "object" || gm.uniqueGrantedRunSeed !== runSeed) {
    gm.uniqueGranted = {};
    gm.uniqueGrantedRunSeed = runSeed;
  }

  return gm.uniqueGranted;
}

function rollBottleMapReward(ctx, gm) {
  // NOTE: This roll should be deterministic and stable across retries.
  // It is computed once at Bottle Map activation and stored on the thread.

  // Gold: uniform 60..80 inclusive.
  const gold = 60 + Math.floor(gmRngFloat(gm) * 21);
  const grants = [{ kind: "gold", amount: gold }];

  // Always grant exactly 1 tier-2 equipment item.
  try {
    const Items = (typeof window !== "undefined" ? window.Items : null) || (ctx && ctx.Items ? ctx.Items : null);
    if (Items && typeof Items.createEquipment === "function") {
      const it = Items.createEquipment(2, () => gmRngFloat(gm));
      if (it) grants.push({ kind: "item", item: it });
    } else {
      // Fallback: create a minimal equip-shaped item so inventory/equip code can handle it.
      grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
    }
  } catch (_) {
    grants.push({ kind: "item", item: { kind: "equip", slot: "hand", name: "iron gear", tier: 2, atk: 0, def: 0, decay: 0 } });
  }

  // Unique drop: 2–3% per Bottle Map resolution. Enforced unique per-run via gm.uniqueGranted.
  try {
    const uniqueChance = 0.02 + (gmRngFloat(gm) * 0.01);
    const roll = gmRngFloat(gm);
    if (roll < uniqueChance) {
      const granted = ensureUniqueGranted(gm) || {};
      const pool = ["skeleton_key"]; // Expandable.
      const available = pool.filter((id) => !granted[String(id)]);

      if (available.length) {
        const pick = available[Math.floor(gmRngFloat(gm) * available.length)] || available[0];
        granted[String(pick)] = true;

        if (pick === "skeleton_key") {
          grants.push({
            kind: "tool",
            tool: {
              kind: "tool",
              type: "skeleton_key",
              id: "skeleton_key",
              name: "skeleton key",
              uses: 1,
              unique: true,
              decay: 0,
              usable: false,
            },
          });
        }
      }
    }
  } catch (_) {}

  return { grants };
}

function grantBottleMapRewards(ctx, reward) {
  if (!ctx || !ctx.player || !reward) return;
  const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);

  for (const g of (reward.grants || [])) {
    if (!g) continue;
    if (g.kind === "gold") {
      const amount = (typeof g.amount === "number" ? (g.amount | 0) : 0);
      if (amount <= 0) continue;
      let goldObj = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
      if (!goldObj) {
        goldObj = { kind: "gold", amount: 0, name: "gold" };
        inv.push(goldObj);
      }
      goldObj.amount = (typeof goldObj.amount === "number" ? goldObj.amount : 0) + amount;
      continue;
    }
    if (g.kind === "item" && g.item) {
      inv.push(g.item);
      continue;
    }
    if (g.kind === "tool" && g.tool) {
      inv.push(g.tool);
      continue;
    }
  }

  try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
}

/**
 * GMBridge hook: called by encounter completion flow.
 */
export function onEncounterComplete(ctx, info) {
  try {
    const id = info && info.encounterId != null ? String(info.encounterId) : "";
    if (!id) return;

    if (id !== "gm_bottle_map_scene") return;

    const GM = getMod(ctx, "GMRuntime");
    const MS = getMod(ctx, "MarkerService");
    if (!GM || !MS) return;

    const gm = GM.getState(ctx);
    const thread = ensureBottleMapThread(gm);
    if (!thread || thread.active !== true) return;

    const outcome = info && info.outcome ? String(info.outcome) : "";
    if (outcome !== "victory") {
      thread.status = "active";
      try { GM.onEvent(ctx, { type: "gm.bottleMap.encounterExit", interesting: false, payload: { outcome } }); } catch (_) {}
      return;
    }

    // Victory: pay out and clear marker.
    const reward = thread.reward || null;
    try { grantBottleMapRewards(ctx, reward); } catch (_) {}

    try {
      if (thread.instanceId != null) {
        MS.remove(ctx, { instanceId: String(thread.instanceId) });
      }
    } catch (_) {}

    thread.status = "claimed";
    thread.active = false;
    thread.claimedTurn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;

    try {
      if (typeof ctx.log === "function") ctx.log("You unearth a hidden cache from the Bottle Map.", "good");
    } catch (_) {}

    try {
      GM.onEvent(ctx, { type: "gm.bottleMap.claimed", interesting: true, payload: { instanceId: thread.instanceId } });
    } catch (_) {}

    // Ensure UI refresh after granting rewards.
    try {
      const UIO = getMod(ctx, "UIOrchestration");
      if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
    } catch (_) {}
  } catch (_) {}
}

/**
 * Inventory "use" hook: called from InventoryFlow.useItemByIndex.
 */
export function useInventoryItem(ctx, item, idx) {
  if (!ctx || !item) return false;
  if (!isBottleMapItem(item)) return false;

  if (ctx.mode !== "world") {
    try { if (typeof ctx.log === "function") ctx.log("The map can only be used in the overworld.", "warn"); } catch (_) {}
    return true;
  }

  const GM = getMod(ctx, "GMRuntime");
  const MS = getMod(ctx, "MarkerService");
  if (!GM || !MS) {
    try { if (typeof ctx.log === "function") ctx.log("Nothing happens.", "warn"); } catch (_) {}
    return true;
  }

  const gm = GM.getState(ctx);
  const thread = ensureBottleMapThread(gm);

  // Disallow stacking multiple active Bottle Maps.
  if (thread.active === true && thread.status !== "claimed") {
    try { if (typeof ctx.log === "function") ctx.log("The Bottle Map already points to a location.", "info"); } catch (_) {}
    return true;
  }

  // Consume the item.
  try {
    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    const i = (idx | 0);
    if (i >= 0 && i < inv.length) inv.splice(i, 1);
  } catch (_) {}

  // Roll deterministic target + reward using GM RNG.
  const target = pickBottleMapTarget(ctx, gm);
  const reward = rollBottleMapReward(ctx, gm);

  const turn = (ctx && ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0;
  const id = `bottleMap:${turn}:${(gm && gm.rng ? (gm.rng.calls | 0) : 0)}`;

  thread.active = true;
  thread.instanceId = id;
  thread.createdTurn = turn;
  thread.status = "active";
  thread.attempts = 0;
  thread.target = target;
  thread.reward = reward;

  if (target && typeof target.absX === "number" && typeof target.absY === "number") {
    try {
      MS.add(ctx, {
        x: target.absX,
        y: target.absY,
        kind: "gm.bottleMap",
        glyph: "X",
        paletteKey: "gmMarker",
        instanceId: id,
        createdTurn: turn,
      });
    } catch (_) {}
  }

  try {
    GM.onEvent(ctx, { type: "gm.bottleMap.activated", interesting: true, payload: { instanceId: id } });
  } catch (_) {}

  try {
    if (typeof ctx.log === "function") {
      ctx.log("You study the Bottle Map. An X appears on your world map.", "notice");
    }
  } catch (_) {}

  try {
    if (typeof ctx.updateUI === "function") ctx.updateUI();
  } catch (_) {}

  return true;
}

function handleGuardFineTravelEvent(ctx, GM) {
  if (!ctx || !ctx.player) return false;

  try {
    const MZ = getMod(ctx, "Messages");
    const UIO = getMod(ctx, "UIOrchestration");

    if (!GM || typeof GM.onEvent !== "function") return false;

    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : (ctx.player.inventory = []);
    let goldObj = inv.find(it => it && String(it.kind || it.type || "").toLowerCase() === "gold");
    if (!goldObj) {
      goldObj = { kind: "gold", amount: 0, name: "gold" };
      inv.push(goldObj);
    }

    const currentGold = (typeof goldObj.amount === "number" ? goldObj.amount : 0) | 0;

    const level = (typeof ctx.player.level === "number" ? (ctx.player.level | 0) : 1);
    let fine = level * 10;
    if (fine < 30) fine = 30;
    if (fine > 300) fine = 300;

    if (currentGold < fine) {
      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.noMoney", null, "warn");
        } else if (typeof ctx.log === "function") {
          ctx.log("A patrol of guards demands a fine you cannot afford. They let you go with a warning this time.", "warn");
        }
      } catch (_) {}

      try {
        GM.onEvent(ctx, { type: "gm.guardFine.refuse" });
      } catch (_) {}

      return true;
    }

    const vars = { amount: fine };
    let prompt = "";
    try {
      if (MZ && typeof MZ.get === "function") {
        prompt = MZ.get("gm.guardFine.prompt", vars) || "";
      }
    } catch (_) {}
    if (!prompt) {
      prompt = `A patrol of guards demands a fine of ${fine} gold for your crimes.\nPay?`;
    }

    const onPay = () => {
      try {
        let next = currentGold - fine;
        if (next < 0) next = 0;
        goldObj.amount = next;
      } catch (_) {}

      try {
        GM.onEvent(ctx, { type: "gm.guardFine.pay" });
      } catch (_) {}

      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.paid", { amount: fine }, "good");
        } else if (typeof ctx.log === "function") {
          ctx.log(`You pay ${fine} gold to settle your fines with the guards.`, "info");
        }
      } catch (_) {}

      try {
        if (typeof ctx.updateUI === "function") ctx.updateUI();
      } catch (_) {}
    };

    const onRefuse = () => {
      try {
        GM.onEvent(ctx, { type: "gm.guardFine.refuse" });
      } catch (_) {}

      try {
        if (MZ && typeof MZ.log === "function") {
          MZ.log(ctx, "gm.guardFine.refused", null, "warn");
        } else if (typeof ctx.log === "function") {
          ctx.log("You refuse to pay the fine. The guards will remember this.", "warn");
        }
      } catch (_) {}
    };

    if (UIO && typeof UIO.showConfirm === "function") {
      UIO.showConfirm(ctx, prompt, null, onPay, onRefuse);
    } else {
      onPay();
    }

    return true;
  } catch (_) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Error handling guard fine travel event.", "warn");
      }
    } catch (_) {}
    return false;
  }
}

function startGmFactionEncounter(ctx, encounterId) {
  if (!ctx) return false;

  const idRaw = encounterId != null ? String(encounterId) : "";
  const id = idRaw.trim();
  if (!id) return false;

  let tmpl = null;
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : [];
    const key = id.toLowerCase();
    tmpl = reg.find(t => t && String(t.id || "").toLowerCase() === key) || null;
  } catch (_) {}

  if (!tmpl) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log(`[GM] Faction encounter template '${id}' not found.`, "warn");
      }
    } catch (_) {}
    return false;
  }

  let biome = "GRASS";
  try {
    const W = getMod(ctx, "World");
    const wmap = ctx.world && ctx.world.map ? ctx.world.map : null;
    const y = (ctx.player && typeof ctx.player.y === "number") ? (ctx.player.y | 0) : 0;
    const x = (ctx.player && typeof ctx.player.x === "number") ? (ctx.player.x | 0) : 0;
    const tile = wmap && wmap[y] ? wmap[y][x] : null;
    if (W && typeof W.biomeName === "function") {
      const name = W.biomeName(tile) || "";
      if (name) biome = String(name).toUpperCase();
    }
  } catch (_) {}

  let difficulty = 1;
  try {
    const ES = getMod(ctx, "EncounterService");
    if (ES && typeof ES.computeDifficulty === "function") {
      difficulty = ES.computeDifficulty(ctx, biome);
    }
  } catch (_) {}
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) difficulty = 1;
  if (difficulty < 1) difficulty = 1;
  if (difficulty > 5) difficulty = 5;

  let ok = false;

  try {
    const GA = getMod(ctx, "GameAPI");
    if (GA && typeof GA.enterEncounter === "function") {
      ok = !!GA.enterEncounter(tmpl, biome, difficulty);
    }
  } catch (_) {}

  if (!ok) {
    try {
      const ER = getMod(ctx, "EncounterRuntime");
      if (ER && typeof ER.enter === "function") {
        ok = !!ER.enter(ctx, { template: tmpl, biome, difficulty });
      }
    } catch (_) {}
  }

  if (!ok) {
    try {
      if (ctx && typeof ctx.log === "function") {
        ctx.log("[GM] Failed to start faction encounter.", "warn");
      }
    } catch (_) {}
    return false;
  }

  try {
    if (ctx && typeof ctx.log === "function") {
      const name = tmpl && tmpl.name ? tmpl.name : id;
      ctx.log(`[GM] A special encounter begins: ${name}.`, "notice");
    }
  } catch (_) {}

  return true;
}

attachGlobal("GMBridge", {
  maybeHandleWorldStep,
  handleMarkerAction,
  onEncounterComplete,
  useInventoryItem,
});
