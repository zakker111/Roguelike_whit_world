/**
 * EncounterInteractions: context-sensitive interactions inside encounter maps.
 * - Standing on an encounter prop (campfire, crate, barrel, bench, merchant, captive)
 * - Uses GameData.crafting for campfire recipes and GameData.materials for names.
 *
 * Exports (ESM + window.EncounterInteractions):
 * - interactHere(ctx) -> handled:boolean
 */

import { getMod } from "../utils/access.js";

function log(ctx, msg, type = "info") {
  try { if (ctx && typeof ctx.log === "function") ctx.log(msg, type); } catch (_) {}
}

function matNameFromData(ctx, id) {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const mats = GD && GD.materials && (Array.isArray(GD.materials.materials) ? GD.materials.materials : GD.materials.list);
    const iid = String(id || "").toLowerCase();
    if (Array.isArray(mats)) {
      const entry = mats.find(m => m && (String(m.id || "").toLowerCase() === iid || String(m.name || "").toLowerCase() === iid));
      return entry && entry.name ? entry.name : String(id).replace(/_/g, " ");
    }
  } catch (_) {}
  return String(id || "").replace(/_/g, " ");
}

function findCampfireRecipe(ctx, inputId) {
  // Try JSON recipes first; otherwise provide a safe default for meat/fish
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const recipes = GD && GD.crafting && Array.isArray(GD.crafting.recipes) ? GD.crafting.recipes : [];
    const iid = String(inputId || "").toLowerCase();
    const fromJson = recipes.find(r =>
      r && String(r.station || "").toLowerCase() === "campfire" &&
      Array.isArray(r.inputs) &&
      r.inputs.some(inp => String(inp.id || "").toLowerCase() === iid)
    );
    if (fromJson) return fromJson;
    // Fallback defaults when crafting JSON is missing
    if (iid === "meat") return { id: "cook_meat_default", station: "campfire", inputs: [{ id: "meat", amount: 1 }], outputs: [{ id: "meat_cooked", amount: 1 }] };
    if (iid === "fish") return { id: "cook_fish_default", station: "campfire", inputs: [{ id: "fish", amount: 1 }], outputs: [{ id: "fish_cooked", amount: 1 }] };
    return null;
  } catch (_) { 
    const iid = String(inputId || "").toLowerCase();
    if (iid === "meat") return { id: "cook_meat_default", station: "campfire", inputs: [{ id: "meat", amount: 1 }], outputs: [{ id: "meat_cooked", amount: 1 }] };
    if (iid === "fish") return { id: "cook_fish_default", station: "campfire", inputs: [{ id: "fish", amount: 1 }], outputs: [{ id: "fish_cooked", amount: 1 }] };
    return null; 
  }
}

function collectMaterial(ctx, inputId) {
  const inv = (ctx && ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : [];
  const iid = String(inputId || "").toLowerCase();
  const idxs = [];
  let total = 0;
  for (let i = 0; i < inv.length; i++) {
    const it = inv[i];
    if (!it || it.kind !== "material") continue;
    const id = String(it.type || it.name || "").toLowerCase();
    if (id === iid) {
      const amt = (it.amount | 0) || (it.count | 0) || 1;
      total += amt;
      idxs.push(i);
    }
  }
  return { idxs, total };
}

function applyCooking(ctx, inputId, bundle) {
  const rec = findCampfireRecipe(ctx, inputId);
  if (!rec || !Array.isArray(rec.outputs) || rec.outputs.length === 0) {
    log(ctx, "You stand by a campfire.", "info");
    return;
  }
  const inv = ctx.player.inventory || (ctx.player.inventory = []);
  const outId = String(rec.outputs[0].id || "");
  const outName = matNameFromData(ctx, outId);
  const inName = matNameFromData(ctx, inputId);

  // Remove raw entries (largest stacks first)
  let remaining = bundle.total;
  bundle.idxs.sort((a, b) => {
    const aa = ((inv[a]?.amount | 0) || (inv[a]?.count | 0) || 1);
    const bb = ((inv[b]?.amount | 0) || (inv[b]?.count | 0) || 1);
    return bb - aa;
  });
  for (const idx of bundle.idxs) {
    if (remaining <= 0) break;
    const it = inv[idx];
    if (!it) continue;
    const amt = (it.amount | 0) || (it.count | 0) || 1;
    const take = Math.min(amt, remaining);
    const left = amt - take;
    if (typeof it.amount === "number") it.amount = left;
    else if (typeof it.count === "number") it.count = left;
    if (((it.amount | 0) || (it.count | 0) || 0) <= 0) {
      inv.splice(idx, 1);
    }
    remaining -= take;
  }
  // Add cooked stack
  const existing = inv.find(x => x && x.kind === "material" && String(x.type || x.name || "").toLowerCase() === outId.toLowerCase());
  if (existing) {
    if (typeof existing.amount === "number") existing.amount += bundle.total;
    else if (typeof existing.count === "number") existing.count += bundle.total;
    else existing.amount = bundle.total;
  } else {
    inv.push({ kind: "material", type: outId, name: outName, amount: bundle.total });
  }
  // Cooking skill gain scales with items cooked
  try { ctx.player.skills = ctx.player.skills || {}; ctx.player.skills.cooking = (ctx.player.skills.cooking || 0) + Math.max(1, bundle.total); } catch (_) {}
  log(ctx, `You cook ${bundle.total} ${inName} into ${bundle.total} ${outName}.`, "good");
  try {
    if (typeof ctx.updateUI === "function") ctx.updateUI();
    const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
    if (UIO && typeof UIO.renderInventory === "function") UIO.renderInventory(ctx);
  } catch (_) {}
}

function interactCampfire(ctx) {
  try {
    const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
    const meat = collectMaterial(ctx, "meat");
    const fish = collectMaterial(ctx, "fish");
    const canMeat = meat.total > 0 && !!findCampfireRecipe(ctx, "meat");
    const canFish = fish.total > 0 && !!findCampfireRecipe(ctx, "fish");

    if (!canFish && !canMeat) {
      log(ctx, "You stand by a campfire.", "info");
      return true;
    } else if (canFish && !canMeat) {
      const prompt = `You stand by a campfire. Cook ${fish.total} ${matNameFromData(ctx, "fish")}?`;
      const onOk = () => applyCooking(ctx, "fish", fish);
      const onCancel = () => log(ctx, "You warm your hands by the fire.", "info");
      if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      else onOk();
      return true;
    } else if (canMeat && !canFish) {
      const prompt = `You stand by a campfire. Cook ${meat.total} ${matNameFromData(ctx, "meat")}?`;
      const onOk = () => applyCooking(ctx, "meat", meat);
      const onCancel = () => log(ctx, "You warm your hands by the fire.", "info");
      if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      else onOk();
      return true;
    } else {
      const askMeat = () => {
        const promptM = `Cook ${meat.total} ${matNameFromData(ctx, "meat")}?`;
        const onOkM = () => applyCooking(ctx, "meat", meat);
        const onCancelM = () => log(ctx, "You warm your hands by the fire.", "info");
        if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, promptM, null, onOkM, onCancelM);
        else onOkM();
      };
      const promptF = `You stand by a campfire. Cook ${fish.total} ${matNameFromData(ctx, "fish")}? (Cancel for meat)`;
      const onOkF = () => applyCooking(ctx, "fish", fish);
      const onCancelF = () => askMeat();
      if (UIO && typeof UIO.showConfirm === "function") UIO.showConfirm(ctx, promptF, null, onOkF, onCancelF);
      else onOkF();
      return true;
    }
  } catch (_) {
    log(ctx, "You stand by a campfire.", "info");
    return true;
  }
}

function interactProp(ctx, p) {
  const type = String(p.type || "").toLowerCase();
  if (type === "campfire") return interactCampfire(ctx);
  if (type === "merchant") {
    try {
      const tplId = String(ctx.encounterInfo && ctx.encounterInfo.id || "").toLowerCase();
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : (ctx.UIOrchestration || null));
      const isCaravanEncounter = tplId === "caravan_ambush";
      const isCaravanMaster = isCaravanEncounter || String(p.vendor || "").toLowerCase() === "caravan";

      if (isCaravanMaster && UIO && typeof UIO.showConfirm === "function") {
        // After a caravan ambush event (or any caravan-road encounter), allow choosing whether to continue escorting.
        const world = ctx.world;
        const esc = world && world.caravanEscort;
        const stillActive = esc && esc.active;
        const prompt = stillActive
          ? "Caravan master: \"Do you want to continue guarding the caravan?\""
          : "Caravan master: \"Thank you for your help. Do you want to resume your journey with us?\"";

        const onOk = () => {
          try {
            if (world) {
              world.caravanEscort = world.caravanEscort || { id: null, reward: 0, active: false };
              world.caravanEscort.active = true;
            }
            log(ctx, "You agree to continue guarding the caravan.", "info");

            // Immediately return to the overworld after accepting, so travel can resume.
            try {
              const GA = ctx.GameAPI || getMod(ctx, "GameAPI") || (typeof window !== "undefined" ? window.GameAPI : null);
              if (GA && typeof GA.completeEncounter === "function") {
                GA.completeEncounter("victory");
              } else {
                const ER = ctx.EncounterRuntime || getMod(ctx, "EncounterRuntime") || (typeof window !== "undefined" ? window.EncounterRuntime : null);
                if (ER && typeof ER.complete === "function") {
                  ER.complete(ctx, "victory");
                }
              }
            } catch (_) {}
          } catch (_) {}
        };
        const onCancel = () => {
          try {
            if (world && world.caravanEscort) {
              world.caravanEscort.active = false;
            }
            log(ctx, "You decide to stop guarding the caravan.", "info");
          } catch (_) {}
        };
        UIO.showConfirm(ctx, prompt, null, onOk, onCancel);
      } else if (UIO && typeof UIO.showShop === "function") {
        UIO.showShop(ctx, { name: p.name || "Merchant", vendor: p.vendor || "merchant" });
      } else {
        log(ctx, "The merchant nods. (Trading UI not available)", "warn");
      }
    } catch (_) {}
    return true;
  }
  if (type === "captive") {
    try {
      // Remove this captive prop so it cannot be freed multiple times.
      try {
        const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : null;
        if (props) {
          const idx = props.indexOf(p);
          if (idx >= 0) props.splice(idx, 1);
        }
      } catch (_) {}

      if (ctx.encounterObjective && ctx.encounterObjective.type === "rescueTarget" && !ctx.encounterObjective.rescued) {
        ctx.encounterObjective.rescued = true;
        log(ctx, "You free the captive! Now reach an exit (>) to leave.", "good");
      } else {
        log(ctx, "You help the captive to their feet.", "info");
      }

      // In any rescue-target encounter (Rescue Captive and any future variants),
      // freeing the captive should also free a capable ally who can be recruited
      // as a follower, mirroring the tower captive behavior.
      if (ctx.encounterObjective && ctx.encounterObjective.type === "rescueTarget") {
        try {
          const rows = Array.isArray(ctx.map) ? ctx.map.length : 0;
          const cols = rows && Array.isArray(ctx.map[0]) ? ctx.map[0].length : 0;
          if (rows && cols) {
            const T = ctx.TILES;
            const px = ctx.player && typeof ctx.player.x === "number" ? (ctx.player.x | 0) : (p.x | 0);
            const py = ctx.player && typeof ctx.player.y === "number" ? (ctx.player.y | 0) : (p.y | 0);

            const dirs = [
              { x: 1, y: 0 },
              { x: -1, y: 0 },
              { x: 0, y: 1 },
              { x: 0, y: -1 },
            ];
            const inBounds = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols;
            const hasEnemyAt = (x, y) =>
              Array.isArray(ctx.enemies) && ctx.enemies.some(e => e && e.x === x && e.y === y);
            const hasCorpseAt = (x, y) =>
              Array.isArray(ctx.corpses) && ctx.corpses.some(c => c && c.x === x && c.y === y);
            const hasPropAt = (x, y) =>
              Array.isArray(ctx.encounterProps) && ctx.encounterProps.some(pr => pr && pr.x === x && pr.y === y);

            let sx = null;
            let sy = null;
            for (let i = 0; i < dirs.length; i++) {
              const nx = px + dirs[i].x;
              const ny = py + dirs[i].y;
              if (!inBounds(nx, ny)) continue;
              const tile = ctx.map[ny][nx];
              if (tile !== T.FLOOR && tile !== T.DOOR && tile !== T.STAIRS) continue;
              if (hasEnemyAt(nx, ny)) continue;
              if (hasCorpseAt(nx, ny)) continue;
              if (hasPropAt(nx, ny)) continue;
              sx = nx;
              sy = ny;
              break;
            }

            if (sx == null || sy == null) {
              log(ctx, "You free the captive, but there's no room for them to stand and fight here.", "info");
            } else {
              // Use the same enemy registry as tower captives to build a capable ally.
              const EM = ctx.Enemies || (typeof window !== "undefined" ? window.Enemies : null);
              let ally = null;
              if (EM && typeof EM.getTypeDef === "function") {
                let type = "guard";
                let def = EM.getTypeDef(type);
                if (!def) {
                  type = "bandit";
                  def = EM.getTypeDef(type);
                }
                if (def) {
                  const depth = 1;
                  let rfn = ctx.rng;
                  try {
                    const RU = ctx.RNGUtils || (typeof window !== "undefined" ? window.RNGUtils : null);
                    if (RU && typeof RU.getRng === "function") {
                      rfn = RU.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
                    }
                  } catch (_) {}
                  if (typeof rfn !== "function") rfn = () => 0.5;
                  const level =
                    EM.levelFor && typeof EM.levelFor === "function"
                      ? EM.levelFor(type, depth, rfn)
                      : depth;
                  const glyph =
                    (def.glyph && def.glyph.length) ? def.glyph : (type && type.length ? type.charAt(0) : "?");
                  const hp = def.hp ? def.hp(depth) : 16;
                  const atk = def.atk ? def.atk(depth) : 3;
                  const xp = def.xp ? def.xp(depth) : 0;

                  ally = {
                    x: sx,
                    y: sy,
                    type,
                    glyph,
                    hp,
                    maxHp: hp,
                    atk,
                    xp,
                    level,
                    faction: def.faction || "guard",
                    announced: false,
                    // Do not consider the player as a target; only fight hostile factions.
                    _ignorePlayer: true,
                    // Mark as a recruit candidate so bumping them can open a hire prompt.
                    _recruitCandidate: true,
                    _recruitFollowerId: "guard_follower",
                  };
                }
              }

              if (!ally) {
                // Fallback: simple generic ally if enemy registry is missing.
                ally = {
                  x: sx,
                  y: sy,
                  type: "rescued_guard",
                  glyph: "G",
                  hp: 18,
                  maxHp: 18,
                  atk: 3,
                  xp: 0,
                  level: 1,
                  faction: "guard",
                  announced: false,
                  _ignorePlayer: true,
                  _recruitCandidate: true,
                  _recruitFollowerId: "guard_follower",
                };
              }

              if (!Array.isArray(ctx.enemies)) ctx.enemies = [];
              ctx.enemies.push(ally);

              try {
                if (ctx.occupancy && typeof ctx.occupancy.setEnemy === "function") {
                  ctx.occupancy.setEnemy(ally.x, ally.y);
                }
              } catch (_) {}

              log(ctx, "The freed captive arms themselves and is ready to fight beside you.", "good");
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
    return true;
  }
  if (type === "barrel") { log(ctx, "You stand next to a barrel.", "info"); return true; }
  if (type === "crate")  { log(ctx, "You stand next to a crate.", "info");  return true; }
  if (type === "bench")  { log(ctx, "You stand next to a bench.", "info");  return true; }
  log(ctx, `You stand on ${p.name || p.type || "a prop"}.`, "info");
  return true;
}

export function interactHere(ctx) {
  if (!ctx || ctx.mode !== "encounter") return false;
  try {
    const props = Array.isArray(ctx.encounterProps) ? ctx.encounterProps : [];
    // Underfoot first
    let p = props.find(pr => pr && pr.x === ctx.player.x && pr.y === ctx.player.y);
    // If none underfoot, allow adjacent (4-neighborhood)
    if (!p) {
      const near = [
        { x: ctx.player.x + 1, y: ctx.player.y },
        { x: ctx.player.x - 1, y: ctx.player.y },
        { x: ctx.player.x, y: ctx.player.y + 1 },
        { x: ctx.player.x, y: ctx.player.y - 1 }
      ];
      p = props.find(pr => pr && near.some(n => n.x === pr.x && n.y === pr.y));
    }
    if (!p) return false;
    const handled = !!interactProp(ctx, p);
    if (handled) {
      try {
        const SS = ctx.StateSync || getMod(ctx, "StateSync");
        if (SS && typeof SS.applyAndRefresh === "function") SS.applyAndRefresh(ctx, {});
      } catch (_) {}
      return true;
    }
  } catch (_) {}
  return false;
}

// Back-compat: attach to window
if (typeof window !== "undefined") {
  window.EncounterInteractions = { interactHere };
}