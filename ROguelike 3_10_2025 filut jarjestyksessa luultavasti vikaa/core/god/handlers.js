/**
 * GodHandlers: installs GOD panel handlers on UI.setHandlers.
 *
 * Usage:
 *   import { install } from "./god/handlers.js";
 *   install(() => getCtx());
 *
 * Exports (ESM + window.GodHandlers):
 * - install(getCtx): returns true if handlers were installed
 */
export function install(getCtx) {
  const ctx = getCtx();
  const UIH = (ctx && ctx.UI) || (typeof window !== "undefined" ? window.UI : null);
  if (!UIH || typeof UIH.setHandlers !== "function") return false;

  const GC = (ctx && ctx.GodControls) || (typeof window !== "undefined" ? window.GodControls : null);
  const G = (ctx && ctx.God) || (typeof window !== "undefined" ? window.God : null);

  function mod(name) {
    try {
      const c = getCtx();
      if (c && c[name]) return c[name];
    } catch (_) {}
    try {
      const w = (typeof window !== "undefined") ? window : {};
      return w[name] || null;
    } catch (_) { return null; }
  }

  UIH.setHandlers({
    // Core GOD actions
    onGodHeal: () => {
      if (GC && typeof GC.heal === "function") { GC.heal(() => getCtx()); return; }
      if (G && typeof G.heal === "function") { G.heal(getCtx()); return; }
      const c = getCtx(); c.log("GOD: heal not available.", "warn");
    },
    onGodSpawn: () => {
      if (GC && typeof GC.spawnItems === "function") { GC.spawnItems(() => getCtx(), 3); return; }
      if (G && typeof G.spawnItems === "function") { G.spawnItems(getCtx(), 3); return; }
      const c = getCtx(); c.log("GOD: spawnItems not available.", "warn");
    },
    onGodSpawnEnemy: () => {
      if (GC && typeof GC.spawnEnemyNearby === "function") { GC.spawnEnemyNearby(() => getCtx(), 1); return; }
      if (G && typeof G.spawnEnemyNearby === "function") { G.spawnEnemyNearby(getCtx(), 1); return; }
      const c = getCtx(); c.log("GOD: spawnEnemyNearby not available.", "warn");
    },
    onGodSpawnStairs: () => {
      if (GC && typeof GC.spawnStairsHere === "function") { GC.spawnStairsHere(() => getCtx()); return; }
      if (G && typeof G.spawnStairsHere === "function") { G.spawnStairsHere(getCtx()); return; }
      const c = getCtx(); c.log("GOD: spawnStairsHere not available.", "warn");
    },
    // FOV/Grid
    onGodSetFov: (v) => {
      try {
        const c = getCtx();
        if (typeof c.setFovRadius === "function") c.setFovRadius(v);
      } catch (_) {}
    },
    onGodToggleGrid: (_v) => {
      // UI updates window.DRAW_GRID and triggers redraw; ensure a draw via UIOrchestration when available.
      try {
        const c = getCtx();
        const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
        if (UIO && typeof UIO.requestDraw === "function") {
          UIO.requestDraw(c);
        }
      } catch (_) {}
    },
    // Always Crit toggles
    onGodSetAlwaysCrit: (enabled) => {
      if (GC && typeof GC.setAlwaysCrit === "function") { GC.setAlwaysCrit(() => getCtx(), !!enabled); return; }
      if (G && typeof G.setAlwaysCrit === "function") { G.setAlwaysCrit(getCtx(), !!enabled); return; }
      const c = getCtx(); c.log("GOD: setAlwaysCrit not available.", "warn");
    },
    onGodSetCritPart: (part) => {
      if (GC && typeof GC.setCritPart === "function") { GC.setCritPart(() => getCtx(), part); return; }
      if (G && typeof G.setCritPart === "function") { G.setCritPart(getCtx(), part); return; }
      const c = getCtx(); c.log("GOD: setCritPart not available.", "warn");
    },
    // RNG controls
    onGodApplySeed: (seed) => {
      if (GC && typeof GC.applySeed === "function") { GC.applySeed(() => getCtx(), seed >>> 0); return; }
      if (G && typeof G.applySeed === "function") { G.applySeed(getCtx(), seed >>> 0); return; }
      const c = getCtx(); c.log("GOD: applySeed not available.", "warn");
    },
    onGodRerollSeed: () => {
      if (GC && typeof GC.rerollSeed === "function") { GC.rerollSeed(() => getCtx()); return; }
      if (G && typeof G.rerollSeed === "function") { G.rerollSeed(getCtx()); return; }
      const c = getCtx(); c.log("GOD: rerollSeed not available.", "warn");
    },
    // Encounter debug helpers
    onGodStartEncounterNow: (encId) => {
      try {
        const id = String(encId || "").toLowerCase();
        const c = getCtx();
        const GD = (typeof window !== "undefined" ? window.GameData : null);
        const reg = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : [];
        const t = reg.find(t => String(t.id || "").toLowerCase() === id) || null;
        if (!t) {
          if (id) c.log(`GOD: Encounter '${id}' not found.`, "warn");
          return;
        }
        if (c.mode !== "world") {
          c.log("GOD: Start Now works in overworld only.", "warn");
          return;
        }
        const tile = c.world && c.world.map ? c.world.map[c.player.y][c.player.x] : null;
        const biome = (function () {
          try {
            const W = (typeof window !== "undefined" && window.World) ? window.World : null;
            return (W && typeof W.biomeName === "function") ? (W.biomeName(tile) || "").toUpperCase() : "";
          } catch (_) { return ""; }
        })();
        const diff = 1;
        const ok = (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.enterEncounter === "function")
          ? window.GameAPI.enterEncounter(t, biome, diff)
          : false;
        if (!ok) {
          const ER = mod("EncounterRuntime");
          if (ER && typeof ER.enter === "function") {
            const ctxMod = getCtx();
            if (ER.enter(ctxMod, { template: t, biome, difficulty: diff })) {
              // Push state and refresh
              if (typeof ctxMod.requestDraw === "function") ctxMod.requestDraw();
            }
          }
        }
      } catch (_) {}
    },
    onGodArmEncounterNextMove: (encId) => {
      try {
        const id = String(encId || "");
        const c = getCtx();
        if (!id) { c.log("GOD: Select an encounter first.", "warn"); return; }
        window.DEBUG_ENCOUNTER_ARM = id;
        c.log(`GOD: Armed '${id}' — will trigger on next overworld move.`, "notice");
      } catch (_) {}
    },
    // Status effects
    onGodApplyBleed: (dur = 3) => {
      if (GC && typeof GC.applyBleedToPlayer === "function") {
        GC.applyBleedToPlayer(() => getCtx(), dur);
      } else {
        const ST = mod("Status");
        const c = getCtx();
        if (ST && typeof ST.applyBleedToPlayer === "function") {
          ST.applyBleedToPlayer(c, dur);
        } else {
          c.player.bleedTurns = Math.max(c.player.bleedTurns || 0, (dur | 0));
          c.log(`You are bleeding (${c.player.bleedTurns}).`, "warn");
        }
        c.updateUI && c.updateUI();
      }
    },
    onGodApplyDazed: (dur = 2) => {
      if (GC && typeof GC.applyDazedToPlayer === "function") {
        GC.applyDazedToPlayer(() => getCtx(), dur);
      } else {
        const ST = mod("Status");
        const c = getCtx();
        if (ST && typeof ST.applyDazedToPlayer === "function") {
          ST.applyDazedToPlayer(c, dur);
        } else {
          c.player.dazedTurns = Math.max(c.player.dazedTurns || 0, (dur | 0));
          c.log(`You are dazed and might lose your next action${dur > 1 ? "s" : ""}.`, "warn");
        }
        c.updateUI && c.updateUI();
      }
    },
    onGodClearEffects: () => {
      if (GC && typeof GC.clearPlayerEffects === "function") {
        GC.clearPlayerEffects(() => getCtx());
      } else {
        const c = getCtx();
        c.player.bleedTurns = 0;
        c.player.dazedTurns = 0;
        c.updateUI && c.updateUI();
        c.log("Status effects cleared (Bleed, Dazed).", "info");
      }
    },

    // Apply status effect: next player hit applies the chosen status to the target enemy.
    // effectId is a short string from the GOD panel chooser, e.g. "bleed", "limp", "fire".
    onGodApplyStatusEffect: (effectId) => {
      const c = getCtx();
      try {
        let id = String(effectId || "").toLowerCase();
        if (!id) id = "fire";
        const valid = { bleed: "Bleeding", limp: "Limp", fire: "Burning" };
        if (!Object.prototype.hasOwnProperty.call(valid, id)) {
          c.log(`GOD: Unknown status effect '${effectId}', defaulting to Burning.`, "warn");
          id = "fire";
        }
        // Store on context, player, and a global so it survives ctx wrapper churn.
        c._godStatusOnNextHit = id;
        if (c.player) {
          try {
            c.player.godNextStatusEffect = id;
            c.player._godStatusOnNextHit = id;
          } catch (_) {}
        }
        try {
          if (typeof window !== "undefined") {
            window.GOD_NEXT_STATUS_EFFECT = id;
          }
        } catch (_) {}
        c.log(`GOD: Next hit will apply ${valid[id]} status to the target.`, "notice");
      } catch (_) {}
    },
    // Town events
    onGodTownBandits: () => {
      const c = getCtx();
      try {
        if (c.mode !== "town") {
          c.log("Bandits at the gate event is available in town mode only. Enter a town first.", "warn");
          return;
        }
        const TR = c.TownRuntime || (typeof window !== "undefined" ? window.TownRuntime : null);
        if (TR && typeof TR.startBanditsAtGateEvent === "function") {
          const ok = TR.startBanditsAtGateEvent(c);
          if (!ok) {
            // startBanditsAtGateEvent logs its own warnings.
          }
          return;
        }
        c.log("GOD: TownRuntime.startBanditsAtGateEvent not available.", "warn");
      } catch (_) {}
    },

    // Town diagnostics
    onGodCheckHomes: () => {
      const c = getCtx();
      if (c.mode !== "town") {
        c.log("Home route check is available in town mode only.", "warn");
        try {
          const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
          if (UIO && typeof UIO.requestDraw === "function") {
            UIO.requestDraw(c);
          }
        } catch (_) {}
        return;
      }
      // Ensure town NPCs are populated before running the check
      try {
        const TAI = c.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
        if ((!Array.isArray(c.npcs) || c.npcs.length === 0) && TAI && typeof TAI.populateTown === "function") {
          TAI.populateTown(c);
          // Rebuild occupancy using unified facade
          try {
            const OF = (c.OccupancyFacade || (typeof window !== "undefined" ? window.OccupancyFacade : null));
            if (OF && typeof OF.rebuild === "function") OF.rebuild(c);
          } catch (_) {}
        }
      } catch (_) {}

      const TAI = c.TownAI || (typeof window !== "undefined" ? window.TownAI : null);
      if (TAI && typeof TAI.checkHomeRoutes === "function") {
        const res = TAI.checkHomeRoutes(c) || {};
        const totalChecked = (typeof res.total === "number")
          ? res.total
          : ((res.reachable || 0) + (res.unreachable || 0));
        const skippedCount = (typeof res.skipped === "number") ? res.skipped : 0;
        const skippedStr = skippedCount ? `, ${skippedCount} skipped` : "";
        const reachableCount = (typeof res.reachable === "number") ? res.reachable : 0;
        const unreachableCount = (typeof res.unreachable === "number") ? res.unreachable : 0;
        const summaryLine = `Home route check: ${reachableCount}/${totalChecked} reachable, ${unreachableCount} unreachable${skippedStr}.`;
        c.log(summaryLine, unreachableCount ? "warn" : "good");

        const extraLines = [];
        try {
          const counts = res.counts || null;
          if (counts) {
            const npcTotalAll = (typeof counts.npcTotal === "number") ? counts.npcTotal : (totalChecked + skippedCount);
            const pets = (typeof counts.pets === "number") ? counts.pets : skippedCount;
            const shopTotal = (typeof counts.shopkeepersTotal === "number") ? counts.shopkeepersTotal : 0;
            const greetTotal = (typeof counts.greetersTotal === "number") ? counts.greetersTotal : 0;
            const guardTotal = (typeof counts.guardsTotal === "number") ? counts.guardsTotal : 0;
            const resTotal = (res.residents && typeof res.residents.total === "number") ? res.residents.total
                             : ((typeof counts.residentsTotal === "number") ? counts.residentsTotal : 0);
            const roamersTotal = (typeof counts.roamersTotal === "number")
              ? counts.roamersTotal
              : Math.max(0, totalChecked - resTotal - shopTotal - greetTotal - guardTotal);
            extraLines.push(`NPCs: ${totalChecked} checked (excluding pets), ${pets} pet(s) skipped. Total in town: ${npcTotalAll}.`);
            extraLines.push(`By type: residents ${resTotal}, shopkeepers ${shopTotal}, greeters ${greetTotal}, guards ${guardTotal}, roamers ${roamersTotal}.`);
          } else {
            const npcTotalAll = totalChecked + skippedCount;
            extraLines.push(`NPCs: ${totalChecked} checked (excluding pets). Total in town: ${npcTotalAll}.`);
          }
        } catch (_) {}

        if (res.residents && typeof res.residents.total === "number") {
          const r = res.residents;
          const atHome = (typeof r.atHome === "number") ? r.atHome : 0;
          const atInn = (typeof r.atTavern === "number") ? r.atTavern : 0;
          extraLines.push(`Residents: ${atHome}/${r.total} at home, ${atInn}/${r.total} at inn.`);
        } else {
          extraLines.push("No residents were counted; ensure town NPCs are populated.");
        }
        if (res.tavern && (typeof res.tavern.any === "number")) {
          const innAny = res.tavern.any | 0;
          const innSleep = (typeof res.tavern.sleeping === "number") ? res.tavern.sleeping | 0 : 0;
          const resTotalInn = (res.residents && typeof res.residents.total === "number") ? (res.residents.total | 0) : 0;
          const resAtInn = (res.residents && typeof res.residents.atTavern === "number") ? (res.residents.atTavern | 0) : 0;
          extraLines.push(`Inn (any NPCs): ${innAny}; residents at inn: ${resAtInn}/${resTotalInn}; sleeping: ${innSleep}.`);
        }
        if (Array.isArray(res.sleepersAtTavern) && res.sleepersAtTavern.length) {
          res.sleepersAtTavern.slice(0, 8).forEach(d => {
            const nm = (typeof d.name === "string" && d.name) ? d.name : `NPC ${String((d.index | 0) + 1)}`;
            extraLines.push(`- Sleeping: ${nm} at (${d.x},${d.y})`);
          });
          if (res.sleepersAtTavern.length > 8) extraLines.push(`...and ${res.sleepersAtTavern.length - 8} more.`);
        }
        if (Array.isArray(res.residentsAwayLate) && res.residentsAwayLate.length) {
          extraLines.push(`Late-night (02:00–05:00): ${res.residentsAwayLate.length} resident(s) away from home and inn:`);
          res.residentsAwayLate.slice(0, 10).forEach(d => {
            const name = (typeof d.name === "string" && d.name) ? d.name : "Resident";
            extraLines.push(`- ${name} at (${d.x},${d.y})`);
          });
          if (res.residentsAwayLate.length > 10) {
            extraLines.push(`...and ${res.residentsAwayLate.length - 10} more.`);
          }
        }
        if (skippedCount) {
          extraLines.push(`Skipped ${skippedCount} NPCs not expected to have homes (e.g., pets).`);
        }
        if (unreachableCount && Array.isArray(res.details)) {
          res.details.slice(0, 8).forEach(d => {
            const name = (typeof d.name === "string" && d.name) ? d.name : `NPC ${String((d.index | 0) + 1)}`;
            extraLines.push(`- ${name}: ${d.reason}`);
          });
          if (res.details.length > 8) extraLines.push(`...and ${res.details.length - 8} more.`);
        }

        try {
          const el = document.getElementById("god-check-output");
          if (el) {
            const html = [summaryLine].concat(extraLines).map(s => `<div>${s}</div>`).join("");
            el.innerHTML = html;
          }
        } catch (_) {}
        extraLines.forEach(line => getCtx().log(line, "info"));
        try {
          const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
          if (UIO && typeof UIO.requestDraw === "function") {
            UIO.requestDraw(c);
          }
        } catch (_) {}
      } else {
        getCtx().log("TownAI.checkHomeRoutes not available.", "warn");
      }
    },
    onGodCheckInnTavern: () => {
      const c = getCtx();
      if (c.mode !== "town") {
        c.log("Inn/Plaza check is available in town mode only.", "warn");
        c.requestDraw && c.requestDraw();
        return;
      }
      const list = Array.isArray(c.shops) ? c.shops : [];
      const inns = list.filter(s => (s.name || "").toLowerCase().includes("inn"));
      const plaza = c.townPlaza || null;

      const header = `Inn/Plaza: ${inns.length} inn(s).`;
      c.log(header, inns.length ? "info" : "warn");

      const lines = [];

      if (plaza && typeof plaza.x === "number" && typeof plaza.y === "number") {
        lines.push(`Plaza/Square center: (${plaza.x},${plaza.y})`);
      } else {
        lines.push("Plaza/Square: (unknown)");
      }

      function rectOverlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
        const sepX = (ax1 < bx0) || (bx1 < ax0);
        const sepY = (ay1 < by0) || (by1 < ay0);
        return !(sepX || sepY);
      }
      const pRect = (c.townPlazaRect && typeof c.townPlazaRect.x0 === "number")
        ? c.townPlazaRect
        : null;

      inns.slice(0, 8).forEach((s, i) => {
        const b = s && s.building ? s.building : null;
        const doorStr = `door (${s.x},${s.y})`;
        if (b && typeof b.x === "number" && typeof b.y === "number" && typeof b.w === "number" && typeof b.h === "number") {
          const bx0 = b.x, by0 = b.y, bx1 = b.x + b.w - 1, by1 = b.y + b.h - 1;
          const overlapStr = (pRect ? (rectOverlap(bx0, by0, bx1, by1, pRect.x0, pRect.y0, pRect.x1, pRect.y1) ? "OVERLAPS plaza" : "no overlap") : "");
          lines.push(`Inn ${i + 1}: ${doorStr}, building (${b.x},${b.y}) size ${b.w}x${b.h}${overlapStr ? ` — ${overlapStr}` : ""}`);
        } else {
          lines.push(`Inn ${i + 1}: ${doorStr}`);
        }
      });

      try {
        const el = document.getElementById("god-check-output");
        if (el) {
          const html = [header].concat(lines).map(s => `<div>${s}</div>`).join("");
          el.innerHTML = html;
        }
      } catch (_) {}

      lines.forEach(l => c.log(l, "info"));
      try {
        const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
        if (UIO && typeof UIO.requestDraw === "function") {
          UIO.requestDraw(c);
        }
      } catch (_) {}
    },

    onGodCheckSigns: () => {
      const c = getCtx();
      if (c.mode !== "town") {
        c.log("Signs check is available in town mode only.", "warn");
        c.requestDraw && c.requestDraw();
        return;
      }
      const shops = Array.isArray(c.shops) ? c.shops : [];
      const props = Array.isArray(c.townProps) ? c.townProps : [];
      const lines = [];

      // Summary: list unique sign texts from props so you can quickly see which shops are present
      const signProps = props.filter(p => p && String(p.type || "").toLowerCase() === "sign");
      const nameCounts = new Map();
      for (const p of signProps) {
        const nm = String(p.name || "").trim();
        if (!nm) continue;
        nameCounts.set(nm, (nameCounts.get(nm) || 0) + 1);
      }
      const uniqueNames = Array.from(nameCounts.keys()).sort((a, b) => a.localeCompare(b));
      const header = `Signs: ${shops.length} shop(s). Sign texts (${uniqueNames.length}): ${uniqueNames.join(", ") || "(none)"}`;

      function isInside(b, x, y) {
        return !!(b && x > b.x && x < b.x + b.w - 1 && y > b.y && y < b.y + b.h - 1);
      }

      for (let i = 0; i < shops.length; i++) {
        const s = shops[i];
        const shopLabel = String(s.name || s.type || "Shop");
        const door = (s.building && s.building.door) ? s.building.door : { x: s.x, y: s.y };
        const wants = (s && Object.prototype.hasOwnProperty.call(s, "signWanted")) ? !!s.signWanted : true;

        // Find signs with matching text and collect their exact texts and positions
        const matches = [];
        for (let pi = 0; pi < props.length; pi++) {
          const p = props[pi];
          if (!p || String(p.type || "").toLowerCase() !== "sign") continue;
          if (String(p.name || "") === shopLabel) {
            matches.push(p);
          }
        }

        let outside = 0, insideC = 0;
        let nearest = null, bestD = Infinity;
        for (const p of matches) {
          const inside = isInside(s.building, p.x, p.y);
          if (inside) insideC++; else outside++;
          const d = Math.abs(p.x - door.x) + Math.abs(p.y - door.y);
          if (d < bestD) { bestD = d; nearest = { x: p.x, y: p.y, d }; }
        }
        const count = matches.length;
        const base = `• ${shopLabel}: signWanted=${wants ? "true" : "false"}  signs=${count} (outside=${outside}, inside=${insideC})`;
        const tail = nearest ? `, nearest at (${nearest.x},${nearest.y}) d=${nearest.d}` : (count ? ", nearest: (unknown)" : "");
        lines.push(base + tail);

        // Also list the exact sign texts and positions for this shop
        if (matches.length) {
          const details = matches.slice(0, 6).map(p => {
            const where = isInside(s.building, p.x, p.y) ? "inside" : "outside";
            const label = String(p.name || "");
            return `'${label}' @ (${p.x},${p.y}, ${where})`;
          });
          lines.push(`   signs: ${details.join("; ")}${matches.length > 6 ? " …" : ""}`);
        }

        if (!wants && count > 0) {
          c.log(`Sign '${shopLabel}' present but signWanted=false — consider removing prefab or data-driven sign.`, "warn");
        }
      }

      // Show any sign props that do not match a known shop label (could be welcome signs or mismatched names)
      const shopLabels = new Set(shops.map(s => String(s.name || s.type || "Shop")));
      const extras = signProps.filter(p => !shopLabels.has(String(p.name || "")));
      if (extras.length) {
        lines.push(`Other signs (${extras.length}):`);
        extras.slice(0, 12).forEach(p => {
          lines.push(`   '${String(p.name || "")}' @ (${p.x},${p.y})`);
        });
        if (extras.length > 12) lines.push(`   …and ${extras.length - 12} more`);
      }

      try {
        const el = document.getElementById("god-check-output");
        if (el) {
          const html = [header].concat(lines).map(s => `<div>${s}</div>`).join("");
          el.innerHTML = html;
        }
      } catch (_) {}

      c.log(header, shops.length ? "info" : "warn");
      lines.forEach(l => c.log(l, "info"));
      try {
        const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
        if (UIO && typeof UIO.requestDraw === "function") {
          UIO.requestDraw(c);
        }
      } catch (_) {}
    },

    onGodCheckPrefabs: () => {
      const c = getCtx();
      if (c.mode !== "town") {
        c.log("Prefab check is available in town mode only.", "warn");
        c.requestDraw && c.requestDraw();
        return;
      }

      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const PFB = GD && GD.prefabs ? GD.prefabs : null;
      const usage = c.townPrefabUsage || {};

      const categories = ["houses", "shops", "inns", "plazas", "caravans"];
      const lines = [];

      let header;
      if (!PFB) {
        header = "Prefabs: GameData.prefabs not available (no prefab registry loaded).";
      } else {
        const totalCats = categories.reduce((acc, cat) => {
          const list = Array.isArray(PFB[cat]) ? PFB[cat] : [];
          return acc + (list.length ? 1 : 0);
        }, 0);
        header = `Prefabs: registry loaded for ${totalCats} category(ies).`;
      }

      for (const cat of categories) {
        const list = PFB && Array.isArray(PFB[cat]) ? PFB[cat] : [];
        const loadedIds = list
          .map(p => (p && p.id != null ? String(p.id) : ""))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        const usedRaw = Array.isArray(usage[cat]) ? usage[cat] : [];
        const usedSet = new Set(usedRaw.map(id => String(id || "")));
        const usedIds = Array.from(usedSet).filter(Boolean).sort((a, b) => a.localeCompare(b));

        const loadedCount = loadedIds.length;
        const usedCount = usedIds.length;

        // Derived sets
        const loadedSet = new Set(loadedIds);
        const unusedLoaded = loadedIds.filter(id => !usedSet.has(id));
        const usedUnknown = usedIds.filter(id => !loadedSet.has(id));

        const label = cat.charAt(0).toUpperCase() + cat.slice(1);

        const usedStr = usedIds.length ? usedIds.join(", ") : "(none)";
        const unusedStr = unusedLoaded.length ? unusedLoaded.join(", ") : "(none)";

        lines.push(
          `${label}: loaded=${loadedCount}, used=${usedCount}; used IDs: ${usedStr}; unused loaded IDs: ${unusedStr}`
        );

        if (usedUnknown.length) {
          lines.push(
            `  Warning: category '${cat}' has used prefab IDs not in registry: ${usedUnknown.join(", ")}`
          );
        }
      }

      try {
        const el = document.getElementById("god-check-output");
        if (el) {
          const html = [header].concat(lines).map(s => `<div>${s}</div>`).join("");
          el.innerHTML = html;
        }
      } catch (_) {}

      c.log(header, PFB ? "info" : "warn");
      lines.forEach(l => c.log(l, "info"));
      try {
        const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
        if (UIO && typeof UIO.requestDraw === "function") {
          UIO.requestDraw(c);
        }
      } catch (_) {}
    },

    

    onGodDiagnostics: () => {
      const c = getCtx();
      const mods = {
        Enemies: !!c.Enemies, Items: !!c.Items, Player: !!c.Player,
        UI: !!c.UI, Logger: !!c.Logger, Loot: !!c.Loot,
        Dungeon: !!c.Dungeon, DungeonItems: !!c.DungeonItems,
        FOV: !!c.FOV, AI: !!c.AI, Input: !!c.Input,
        Render: !!c.Render, Tileset: !!c.Tileset, Flavor: !!c.Flavor,
        World: !!c.World, Town: !!c.Town, TownAI: !!c.TownAI,
        DungeonState: !!c.DungeonState
      };
      let rngSrc = "mulberry32.fallback";
      try { if (typeof window !== "undefined" && window.RNG && typeof window.RNG.rng === "function") rngSrc = "RNG.service"; } catch (_) {}
      let seedStr = "(random)";
      try {
        if (typeof window !== "undefined" && window.RNG && typeof window.RNG.getSeed === "function") {
          const s = window.RNG.getSeed();
          if (s != null) seedStr = String((Number(s) >>> 0));
        } else {
          const sRaw = localStorage.getItem("SEED");
          if (sRaw != null) seedStr = String((Number(sRaw) >>> 0));
        }
      } catch (_) {}
      c.log("Diagnostics:", "notice");
      c.log(`- Determinism: ${rngSrc}  Seed: ${seedStr}`, "info");
      c.log(`- Mode: ${c.mode}  Floor: ${c.floor}  FOV: ${c.fovRadius}`, "info");
      const rows = Array.isArray(c.map) ? c.map.length : 0;
      const cols = rows && Array.isArray(c.map[0]) ? c.map[0].length : 0;
      c.log(`- Map: ${rows}x${cols}`, "info");
      c.log(`- Entities: enemies=${(Array.isArray(c.enemies) ? c.enemies.length : 0)} corpses=${(Array.isArray(c.corpses) ? c.corpses.length : 0)} npcs=${(Array.isArray(c.npcs) ? c.npcs.length : 0)}`, "info");
      c.log(`- Modules: ${Object.keys(mods).filter(k=>mods[k]).join(", ")}`, "info");
      try {
        const perf = c.getPerfStats ? c.getPerfStats() : {};
        c.log(`- PERF last turn: ${Number(perf.lastTurnMs || 0).toFixed(2)}ms, last draw: ${Number(perf.lastDrawMs || 0).toFixed(2)}ms`, "info");
      } catch (_) {}
      try {
        const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
        if (UIO && typeof UIO.requestDraw === "function") {
          UIO.requestDraw(c);
        }
      } catch (_) {}
    },

    onGodRunValidation: () => {
      try {
        const c = getCtx();
        const VR = (typeof window !== "undefined" ? window.ValidationRunner : null);
        if (VR && typeof VR.run === "function") {
          VR.run(c);
          if (typeof VR.logSummary === "function") VR.logSummary(c);
          else c.log("Validation summary available in console/Logger.", "notice");
        } else {
          c.log("ValidationRunner not available.", "warn");
        }
      } catch (_) {}
    },
    onGodRunSmokeTest: () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("smoketest", "1");
        if (window.DEV || localStorage.getItem("DEV") === "1") {
          url.searchParams.set("dev", "1");
        }
        const c = getCtx();
        c.log("GOD: Reloading with smoketest=1…", "notice");
        window.location.href = url.toString();
      } catch (e) {
        try { console.error(e); } catch (_) {}
        try {
          const c = getCtx();
          c.log("GOD: Failed to construct URL; reloading with ?smoketest=1", "warn");
        } catch (_) {}
        window.location.search = "?smoketest=1";
      }
    },
  });

  return true;
}

import { attachGlobal } from "../../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("GodHandlers", { install });