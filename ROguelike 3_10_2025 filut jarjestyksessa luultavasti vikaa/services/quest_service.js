/**
 * QuestService: lightweight per-town quest board with simple gather and encounter quests.
 *
 * Exports (ESM + window.QuestService):
 * - listForCurrentTown(ctx) -> { townKey, available: [...], active: [...], completed: [...] }
 * - accept(ctx, templateId) -> boolean
 * - getTurnIns(ctx) -> [{ instanceId, title, gold }]
 * - claim(ctx, instanceId) -> boolean
 * - maybeTriggerOnWorldStep(ctx) -> void   // legacy: previously auto-triggered on step (no longer used)
 * - triggerAtMarkerIfHere(ctx) -> boolean  // start encounter only when pressing G on 'E' tile
 * - onEncounterComplete(ctx, payload) -> void  // called from EncounterRuntime.complete
 */
(function initQuestService() {
  function _gd() {
    try { return (typeof window !== "undefined" ? window.GameData : null); } catch (_) { return null; }
  }
  function _rng(ctx) {
    try {
      if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
        return window.RNGUtils.getRng(typeof ctx.rng === "function" ? ctx.rng : undefined);
      }
    } catch (_) {}
    return (typeof ctx.rng === "function") ? ctx.rng : Math.random;
  }
  function _nowTurn(ctx) {
    try { return (ctx.time && typeof ctx.time.turnCounter === "number") ? (ctx.time.turnCounter | 0) : 0; } catch (_) { return 0; }
  }
  function _cycleTurns(ctx) {
    try { return (ctx.time && typeof ctx.time.cycleTurns === "number") ? (ctx.time.cycleTurns | 0) : 360; } catch (_) { return 360; }
  }
  function _goldObj(ctx) {
    const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : (ctx.player.inventory = []);
    let g = inv.find(it => it && it.kind === "gold");
    if (!g) { g = { kind: "gold", amount: 0, name: "gold" }; inv.push(g); }
    return g;
  }
  function _absPlayerPos(ctx) {
    const wx = (ctx.world && typeof ctx.world.originX === "number") ? (ctx.world.originX | 0) : 0;
    const wy = (ctx.world && typeof ctx.world.originY === "number") ? (ctx.world.originY | 0) : 0;
    return { x: wx + (ctx.player.x | 0), y: wy + (ctx.player.y | 0) };
  }
  function _townKeyForWorldPos(ctx, wx, wy) {
    return `${wx | 0},${wy | 0}`;
  }
  function _findTownByWorldPos(ctx, wx, wy) {
    try {
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      return towns.find(t => (t && (t.x | 0) === (wx | 0) && (t.y | 0) === (wy | 0))) || null;
    } catch (_) { return null; }
  }
  function _currentTownEntry(ctx) {
    // In town mode, worldReturnPos points to the town's world tile
    try {
      if (ctx.mode === "town" && ctx.worldReturnPos && typeof ctx.worldReturnPos.x === "number") {
        const wx = ctx.worldReturnPos.x | 0, wy = ctx.worldReturnPos.y | 0;
        return _findTownByWorldPos(ctx, wx, wy);
      }
    } catch (_) {}
    return null;
  }
  function _ensureTownQuestState(ctx, town) {
    if (!town) return null;
    town.quests = town.quests || { available: [], active: [], completed: [], lastRerollTurn: 0 };
    town.quests.available = Array.isArray(town.quests.available) ? town.quests.available : [];
    town.quests.active = Array.isArray(town.quests.active) ? town.quests.active : [];
    town.quests.completed = Array.isArray(town.quests.completed) ? town.quests.completed : [];
    return town.quests;
  }
  function _chooseN(rng, arr, n, avoidIdsSet) {
    const pool = arr.filter(t => !avoidIdsSet.has(t.id));
    const out = [];
    const used = new Set();
    while (out.length < n && pool.length > 0) {
      const i = Math.floor(rng() * pool.length) % pool.length;
      const t = pool[i];
      if (!used.has(t.id)) {
        out.push(t);
        used.add(t.id);
      }
      if (used.size >= pool.length) break;
    }
    return out;
  }
  function _cleanExpired(ctx, townQ) {
    const now = _nowTurn(ctx);
    // Available: drop expired
    townQ.available = townQ.available.filter(q => (q && typeof q.expiresAtTurn === "number") ? (now < q.expiresAtTurn) : true);
    // Active: if expired -> mark failed and drop marker
    const still = [];
    for (const qi of townQ.active) {
      if (!qi) continue;
      if (typeof qi.expiresAtTurn === "number" && now >= qi.expiresAtTurn) {
        qi.status = "failed";
        // Remove marker if any
        try { if (qi.marker) _removeMarker(ctx, qi.marker.x, qi.marker.y, qi.instanceId); } catch (_) {}
        townQ.completed.push({ ...qi, completedAtTurn: now, finalStatus: "failed" });
        continue;
      }
      still.push(qi);
    }
    townQ.active = still;
  }
  function _isNearestTownToPlayer(ctx, town) {
    try {
      const pos = _absPlayerPos(ctx);
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      if (!towns.length || !town) return false;
      // Manhattan distance
      let best = null, bestD = Infinity;
      for (const t of towns) {
        if (!t) continue;
        const d = Math.abs((t.x | 0) - (pos.x | 0)) + Math.abs((t.y | 0) - (pos.y | 0));
        if (d < bestD) { bestD = d; best = t; }
      }
      return !!(best && (best.x | 0) === (town.x | 0) && (best.y | 0) === (town.y | 0));
    } catch (_) { return false; }
  }

  function _ensureEncounterOfferForTown(ctx, town, townQ) {
    try {
      const GD = _gd();
      const templates = (GD && GD.quests && Array.isArray(GD.quests.templates)) ? GD.quests.templates : [];
      const encTemplates = templates.filter(t => t && String(t.kind || "").toLowerCase() === "encounter");
      if (!encTemplates.length) return;
      const hasAvailEnc = Array.isArray(townQ.available) && townQ.available.some(q => q && String(q.kind || "").toLowerCase() === "encounter");
      const hasActiveEnc = Array.isArray(townQ.active) && townQ.active.some(q => q && String(q.kind || "").toLowerCase() === "encounter");
      if (hasAvailEnc || hasActiveEnc) return;

      // Pick first encounter (fallback: id "bandits_farm" if present)
      let tmpl = encTemplates.find(t => t.id === "bandits_farm") || encTemplates[0];
      if (!tmpl) return;

      // Ownership check: skip if owned by a different town
      if (!_ownerMatchesTown(ctx, tmpl.id, town)) return;

      const now = _nowTurn(ctx);
      const ttl = (typeof tmpl.expiresTurns === "number") ? (tmpl.expiresTurns | 0) : 360;
      // Avoid duplicates by templateId across active/completed
      try {
        const avoidId = tmpl.id;
        const dupAct = Array.isArray(townQ.active) && townQ.active.some(q => q && q.templateId === avoidId);
        const dupComp = Array.isArray(townQ.completed) && townQ.completed.some(q => q && q.templateId === avoidId);
        if (dupAct || dupComp) return;
      } catch (_) {}

      const offer = {
        templateId: tmpl.id,
        kind: tmpl.kind,
        title: tmpl.title || tmpl.id,
        desc: tmpl.desc || "",
        offerAtTurn: now,
        expiresAtTurn: now + Math.max(60, ttl),
      };
      townQ.available = Array.isArray(townQ.available) ? townQ.available.concat([offer]) : [offer];

      // Claim ownership for this town (on offer)
      _setOwnerIfUnset(ctx, tmpl.id, town);
    } catch (_) {}
  }

  // Ensure standard gather offers (wood planks, berries) exist for a town's board if not already active/available/completed.
  // Enforce ownership: if a template is owned by another town, do not add it here.
  function _ensureGatherOffersForTown(ctx, town, townQ) {
    try {
      const GD = _gd();
      const templates = (GD && GD.quests && Array.isArray(GD.quests.templates)) ? GD.quests.templates : [];
      const gatherTemplates = templates.filter(t => t && String(t.kind || "").toLowerCase() === "gather");

      // Helper: does town have templateId already (in available/active/completed)
      function _exists(templateId) {
        const inAvail = Array.isArray(townQ.available) && townQ.available.some(q => q && q.templateId === templateId);
        const inActive = Array.isArray(townQ.active) && townQ.active.some(q => q && q.templateId === templateId);
        const inComp = Array.isArray(townQ.completed) && townQ.completed.some(q => q && q.templateId === templateId);
        return inAvail || inActive || inComp;
      }

      const idsWanted = new Set();
      // Prefer explicit template IDs when present
      const tPlanks = gatherTemplates.find(t => t.id === "gather_planks_10")
                       || gatherTemplates.find(t => t.material && String(t.material.name || "").toLowerCase() === "planks");
      const tBerries = gatherTemplates.find(t => t.id === "gather_berries_10")
                        || gatherTemplates.find(t => t.material && String(t.material.name || "").toLowerCase() === "berries");
      if (tPlanks) idsWanted.add(tPlanks.id);
      if (tBerries) idsWanted.add(tBerries.id);

      const now = _nowTurn(ctx);
      for (const id of idsWanted) {
        if (!id) continue;
        if (_exists(id)) continue;
        const tmpl = gatherTemplates.find(t => t.id === id);
        if (!tmpl) continue;
        // Ownership check: skip if owned by a different town
        if (!_ownerMatchesTown(ctx, tmpl.id, town)) continue;

        const ttl = (typeof tmpl.expiresTurns === "number") ? (tmpl.expiresTurns | 0) : 360;
        const offer = {
          templateId: tmpl.id,
          kind: tmpl.kind,
          title: tmpl.title || tmpl.id,
          desc: tmpl.desc || "",
          offerAtTurn: now,
          expiresAtTurn: now + Math.max(60, ttl),
        };
        townQ.available = Array.isArray(townQ.available) ? townQ.available.concat([offer]) : [offer];

        // Claim ownership for this town (on offer)
        _setOwnerIfUnset(ctx, tmpl.id, town);
      }
    } catch (_) {}
  }

  // Global set of templateIds currently active in any town
  function _globalActiveTemplateSet(ctx) {
    const out = new Set();
    try {
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      for (const t of towns) {
        const qs = t && t.quests ? t.quests : null;
        if (!qs) continue;
        for (const a of (qs.active || [])) {
          if (a && a.templateId) out.add(a.templateId);
        }
      }
    } catch (_) {}
    return out;
  }

  // Is the template active in a different town?
  function _isTemplateActiveInOtherTown(ctx, templateId, town) {
    try {
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      const curKey = _townKeyForWorldPos(ctx, town.x, town.y);
      for (const t of towns) {
        if (!t) continue;
        const key = _townKeyForWorldPos(ctx, t.x, t.y);
        if (key === curKey) continue;
        const qs = t.quests || null;
        if (!qs) continue;
        const found = (qs.active || []).some(a => a && a.templateId === templateId);
        if (found) return true;
      }
    } catch (_) {}
    return false;
  }

  // ----- Ownership mapping: templateId -> townKey -----
  function _owners(ctx) {
    try {
      ctx.world._questOwners = ctx.world._questOwners || Object.create(null);
      return ctx.world._questOwners;
    } catch (_) { return Object.create(null); }
  }
  function _ownerTownOf(ctx, templateId) {
    try { const own = _owners(ctx); return own[templateId] || null; } catch (_) { return null; }
  }
  function _setOwnerIfUnset(ctx, templateId, town) {
    try {
      const own = _owners(ctx);
      const key = _townKeyForWorldPos(ctx, town.x, town.y);
      if (!own[templateId]) own[templateId] = key;
    } catch (_) {}
  }
  function _ownerMatchesTown(ctx, templateId, town) {
    try {
      const key = _townKeyForWorldPos(ctx, town.x, town.y);
      const ownKey = _ownerTownOf(ctx, templateId);
      return !ownKey || ownKey === key;
    } catch (_) { return true; }
  }

  // One-time seeding: nearest-to-player town gets all three starter quests (planks, berries, bandits)
  function _seedStartTownAllThree(ctx, town, townQ) {
    try {
      if (!ctx || !ctx.world || !Array.isArray(ctx.world.towns) || !town) return;
      if (ctx.world._questsSeeded) return;
      if (!_isNearestTownToPlayer(ctx, town)) return;
      const GD = _gd();
      const templates = (GD && GD.quests && Array.isArray(GD.quests.templates)) ? GD.quests.templates : [];
      const ids = [];
      const tPlanks = templates.find(t => t.id === "gather_planks_10");
      const tBerries = templates.find(t => t.id === "gather_berries_10");
      const tBandits = templates.find(t => t.id === "bandits_farm");
      if (tPlanks) ids.push(tPlanks.id);
      if (tBerries) ids.push(tBerries.id);
      if (tBandits) ids.push(tBandits.id);

      // Helper: check existence in this town
      const existsHere = (tid) => {
        const inAvail = Array.isArray(townQ.available) && townQ.available.some(q => q && q.templateId === tid);
        const inActive = Array.isArray(townQ.active) && townQ.active.some(q => q && q.templateId === tid);
        const inComp = Array.isArray(townQ.completed) && townQ.completed.some(q => q && q.templateId === tid);
        return inAvail || inActive || inComp;
      };

      const now = _nowTurn(ctx);
      for (const id of ids) {
        const tmpl = templates.find(t => t.id === id);
        if (!tmpl || existsHere(id)) continue;
        const ttl = (typeof tmpl.expiresTurns === "number") ? (tmpl.expiresTurns | 0) : 360;
        townQ.available.push({
          templateId: tmpl.id,
          kind: tmpl.kind,
          title: tmpl.title || tmpl.id,
          desc: tmpl.desc || "",
          offerAtTurn: now,
          expiresAtTurn: now + Math.max(60, ttl),
        });
        // Claim ownership to the starting town for seeded templates
        _setOwnerIfUnset(ctx, tmpl.id, town);
      }
      ctx.world._questsSeeded = true;
      ctx.world._questSeedTownKey = _townKeyForWorldPos(ctx, town.x, town.y);
    } catch (_) {}
  }

  function _rerollAvailableIfNeeded(ctx, town, townQ) {
    const GD = _gd();
    const templates = (GD && GD.quests && Array.isArray(GD.quests.templates)) ? GD.quests.templates : [];
    if (!templates.length) return;
    _cleanExpired(ctx, townQ);

    // Global uniqueness: avoid offering templates that are already active in other towns
    const globalActive = _globalActiveTemplateSet(ctx);

    // If we already have 1-3 available, keep them until they expire; otherwise roll new ones.
    const avail = townQ.available || [];
    const validAvail = avail.filter(q => q && typeof q.expiresAtTurn === "number" ? (_nowTurn(ctx) < q.expiresAtTurn) : true);
    if (validAvail.length >= 1) {
      // Filter out ones that became active elsewhere or owned by other towns to avoid confusing offers
      const validAvail2 = validAvail.filter(q => {
        if (!q) return false;
        if (globalActive.has(q.templateId)) return false;
        return _ownerMatchesTown(ctx, q.templateId, town);
      });
      townQ.available = validAvail2;
      return;
    }

    // Generate 1-3 fresh offers
    const rng = _rng(ctx);
    const count = 1 + ((rng() * 3) | 0); // 1..3
    const avoid = new Set();
    try {
      for (const a of townQ.active) if (a) avoid.add(a.templateId);
      for (const c of townQ.completed) if (c) avoid.add(c.templateId);
      // Also avoid templates active in other towns
      for (const id of globalActive) avoid.add(id);
    } catch (_) {}

    // Filter template pool by ownership: only pick templates unowned or owned by this town
    const pool = templates.filter(t => _ownerMatchesTown(ctx, t.id, town) && !avoid.has(t.id));

    const picked = _chooseN(rng, pool, count, new Set()); // already filtered by avoid
    const now = _nowTurn(ctx);
    const newAvail = picked.map(t => {
      const ttl = (typeof t.expiresTurns === "number") ? (t.expiresTurns | 0) : 360;
      return {
        templateId: t.id,
        kind: t.kind,
        title: t.title || t.id,
        desc: t.desc || "",
        offerAtTurn: now,
        expiresAtTurn: now + Math.max(60, ttl), // minimum 60 turns to avoid too-snappy expiry
      };
    });
    townQ.available = newAvail;

    // Claim ownership for newly offered templates (so other towns won't also offer them)
    try {
      for (const av of newAvail) {
        const tmplId = av && av.templateId;
        if (tmplId) _setOwnerIfUnset(ctx, tmplId, town);
      }
    } catch (_) {}

    // Seeding of starter quests is handled separately in _seedStartTownAllThree (once only)
    townQ.lastRerollTurn = now;
  }
  function _ensureWorldMarkers(ctx) {
    ctx.world.questMarkers = Array.isArray(ctx.world.questMarkers) ? ctx.world.questMarkers : [];
    ctx.world._questMarkerSet = ctx.world._questMarkerSet || new Set();
  }
  function _markerKey(x, y, instanceId) { return `${x | 0},${y | 0}:${instanceId || ""}`; }
  function _addMarker(ctx, x, y, instanceId) {
    _ensureWorldMarkers(ctx);
    const key = _markerKey(x, y, instanceId);
    if (ctx.world._questMarkerSet.has(key)) return;
    ctx.world.questMarkers.push({ x: x | 0, y: y | 0, instanceId });
    ctx.world._questMarkerSet.add(key);
  }
  function _removeMarker(ctx, x, y, instanceId) {
    _ensureWorldMarkers(ctx);
    const key = _markerKey(x, y, instanceId);
    if (ctx.world._questMarkerSet.has(key)) ctx.world._questMarkerSet.delete(key);
    const arr = ctx.world.questMarkers;
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (m && (m.x | 0) === (x | 0) && (m.y | 0) === (y | 0) && (!instanceId || m.instanceId === instanceId)) {
        arr.splice(i, 1);
      }
    }
  }
  function _randInt(rng, a, b) {
    const lo = Math.min(a | 0, b | 0), hi = Math.max(a | 0, b | 0);
    return lo + ((rng() * (hi - lo + 1)) | 0);
  }
  function _placeEncounterMarkerNearTown(ctx, town, tmpl) {
    const rng = _rng(ctx);
    const minR = Math.max(3, (tmpl.radiusMin | 0) || 6);
    const maxR = Math.max(minR, (tmpl.radiusMax | 0) || 14);
    const tries = 120;
    const gen = ctx.world && ctx.world.gen;
    const isWalkable = function(wx, wy) {
      try {
        if (gen && typeof gen.isWalkable === "function") return !!gen.isWalkable(gen.tileAt(wx, wy));
      } catch (_) {}
      try {
        if (typeof window !== "undefined" && window.World && typeof window.World.isWalkable === "function") {
          const t = gen ? gen.tileAt(wx, wy) : ctx.world.map[wy - ctx.world.originY][wx - ctx.world.originX];
          return !!window.World.isWalkable(t);
        }
      } catch (_) {}
      return true;
    };
    for (let t = 0; t < tries; t++) {
      const r = _randInt(rng, minR, maxR);
      const dx = _randInt(rng, -r, r);
      const dySign = (rng() < 0.5) ? -1 : 1;
      const dy = dySign * (r - Math.abs(dx));
      const wx = (town.x | 0) + dx;
      const wy = (town.y | 0) + dy;
      if (isWalkable(wx, wy)) return { x: wx, y: wy };
    }
    // Fallback: shell around town
    for (let r = minR; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        const dy = r - Math.abs(dx);
        const candidates = [ { x: town.x + dx, y: town.y + dy }, { x: town.x + dx, y: town.y - dy } ];
        for (const c of candidates) {
          if (isWalkable(c.x, c.y)) return { x: c.x | 0, y: c.y | 0 };
        }
      }
    }
    // As a last resort use east tile
    return { x: (town.x | 0) + 6, y: (town.y | 0) };
  }
  function _templateById(id) {
    const GD = _gd();
    const arr = GD && GD.quests && Array.isArray(GD.quests.templates) ? GD.quests.templates : [];
    return arr.find(t => t && t.id === id) || null;
  }
  function _uuid(ctx) {
    const now = _nowTurn(ctx);
    const r = Math.floor((_rng(ctx)()) * 1e6) | 0;
    return `q_${now}_${r}`;
  }
  function _applyAndRefresh(ctx) {
    try {
      const SS = ctx.StateSync || (typeof window !== "undefined" ? window.StateSync : null);
      if (SS && typeof SS.applyAndRefresh === "function") SS.applyAndRefresh(ctx, {});
    } catch (_) {}
  }

  function listForCurrentTown(ctx) {
    const town = _currentTownEntry(ctx);
    if (!town) return { townKey: "", available: [], active: [], completed: [] };
    const st = _ensureTownQuestState(ctx, town);
    // Seed all three starter quests once for the nearest town to the player
    _seedStartTownAllThree(ctx, town, st);
    _rerollAvailableIfNeeded(ctx, town, st);
    const key = _townKeyForWorldPos(ctx, town.x, town.y);
    return { townKey: key, available: st.available.slice(0), active: st.active.slice(0), completed: st.completed.slice(0) };
  }

  function accept(ctx, templateId) {
    const town = _currentTownEntry(ctx);
    if (!town) { try { ctx.log && ctx.log("No town context for quest acceptance.", "warn"); } catch (_) {} return false; }
    const st = _ensureTownQuestState(ctx, town);
    const idx = st.available.findIndex(q => q && q.templateId === templateId);
    if (idx === -1) { try { ctx.log && ctx.log("This quest is no longer available.", "warn"); } catch (_) {} return false; }
    const offer = st.available[idx];
    const tmpl = _templateById(templateId);
    if (!tmpl) { try { ctx.log && ctx.log("Quest template missing.", "bad"); } catch (_) {} return false; }

    // Global uniqueness: block acceptance if this template is active in any other town
    try {
      if (_isTemplateActiveInOtherTown(ctx, templateId, town)) {
        try { ctx.log && ctx.log("This quest has already been accepted in another town.", "warn"); } catch (_) {}
        return false;
      }
      // Ownership uniqueness: if owned by a different town, block acceptance here
      if (!_ownerMatchesTown(ctx, templateId, town)) {
        try { ctx.log && ctx.log("This quest belongs to a different town.", "warn"); } catch (_) {}
        return false;
      }
    } catch (_) {}

    st.available.splice(idx, 1);
    const now = _nowTurn(ctx);
    const inst = {
      instanceId: _uuid(ctx),
      templateId: tmpl.id,
      kind: tmpl.kind,
      title: tmpl.title || tmpl.id,
      desc: tmpl.desc || "",
      acceptedAtTurn: now,
      expiresAtTurn: offer.expiresAtTurn || (now + ((tmpl.expiresTurns | 0) || 360)),
      status: "active",
      rewardGoldMin: (tmpl.rewardGoldMin | 0) || 5,
      rewardGoldMax: (tmpl.rewardGoldMax | 0) || 10,
      townKey: _townKeyForWorldPos(ctx, town.x, town.y)
    };

    if (inst.kind === "gather") {
      const mat = tmpl.material || {};
      inst.material = { type: mat.type || "", name: mat.name || "" };
      inst.amount = (tmpl.amount | 0) || 5;
    } else if (inst.kind === "encounter") {
      const marker = _placeEncounterMarkerNearTown(ctx, town, tmpl);
      inst.marker = marker;
      _addMarker(ctx, marker.x, marker.y, inst.instanceId);
    }

    // Claim ownership for this town (on acceptance)
    _setOwnerIfUnset(ctx, tmpl.id, town);

    st.active.push(inst);
    try { ctx.log && ctx.log(`Accepted quest: ${inst.title}`, "good"); } catch (_) {}
    _applyAndRefresh(ctx);
    return true;
  }

  function _materialCountInInventory(inv, type, name) {
    let total = 0;
    for (const it of inv) {
      if (!it) continue;
      if (it.kind === "material") {
        const matchType = String(it.type || it.material || "").toLowerCase() === String(type || "").toLowerCase();
        const matchName = String(it.name || "").toLowerCase() === String(name || "").toLowerCase();
        if (matchType && matchName) {
          if (typeof it.amount === "number") total += (it.amount | 0);
          else if (typeof it.count === "number") total += (it.count | 0);
          else total += 1;
        }
      }
    }
    return total;
  }
  function _removeMaterialFromInventory(inv, type, name, amount) {
    let need = amount | 0;
    for (let i = inv.length - 1; i >= 0 && need > 0; i--) {
      const it = inv[i];
      if (!it) continue;
      if (it.kind !== "material") continue;
      const matchType = String(it.type || it.material || "").toLowerCase() === String(type || "").toLowerCase();
      const matchName = String(it.name || "").toLowerCase() === String(name || "").toLowerCase();
      if (!matchType || !matchName) continue;
      if (typeof it.amount === "number") {
        const take = Math.min(it.amount | 0, need);
        it.amount -= take;
        need -= take;
        if ((it.amount | 0) <= 0) inv.splice(i, 1);
      } else if (typeof it.count === "number") {
        const take = Math.min(it.count | 0, need);
        it.count -= take;
        need -= take;
        if ((it.count | 0) <= 0) inv.splice(i, 1);
      } else {
        // Treat as 1
        need -= 1;
        inv.splice(i, 1);
      }
    }
    return need <= 0;
  }

  function getTurnIns(ctx) {
    // Turn-in candidates:
    // - Active gather quests with sufficient items in inventory
    // - Active encounter quests with status completedPendingTurnIn
    // - Available gather quests in the CURRENT town when inventory already satisfies requirements (requiresAccept=true)
    const out = [];
    try {
      const rng = _rng(ctx);
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      for (const t of towns) {
        const qs = t && t.quests ? t.quests : null;
        if (!qs) continue;
        // Active quests
        for (const a of (qs.active || [])) {
          if (!a) continue;
          if (a.kind === "gather") {
            const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
            const have = _materialCountInInventory(inv, a.material?.type, a.material?.name);
            if (have >= (a.amount | 0)) {
              const gold = _randInt(rng, a.rewardGoldMin | 0, a.rewardGoldMax | 0);
              out.push({ instanceId: a.instanceId, title: a.title, gold, requiresAccept: false });
            }
          } else if (a.kind === "encounter" && a.status === "completedPendingTurnIn") {
            const gold = _randInt(rng, a.rewardGoldMin | 0, a.rewardGoldMax | 0);
            out.push({ instanceId: a.instanceId, title: a.title, gold, requiresAccept: false });
          }
        }
      }
      // Available gather (current town only): allow immediate claim from the board
      const curTown = _currentTownEntry(ctx);
      if (curTown && curTown.quests) {
        for (const av of (curTown.quests.available || [])) {
          if (!av || av.kind !== "gather") continue;
          const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : [];
          // Resolve template for material and reward ranges
          const tmpl = _templateById(av.templateId) || {};
          const mat = tmpl.material || {};
          const amt = (tmpl.amount | 0) || (av.amount | 0) || 1;
          const have = _materialCountInInventory(inv, mat.type || av.material?.type, mat.name || av.material?.name);
          if (have >= amt) {
            const goldMin = (tmpl.rewardGoldMin | 0) || (av.rewardGoldMin | 0) || 5;
            const goldMax = (tmpl.rewardGoldMax | 0) || (av.rewardGoldMax | 0) || 10;
            const gold = _randInt(rng, goldMin, goldMax);
            out.push({ templateId: av.templateId, title: av.title || tmpl.title || av.templateId, gold, requiresAccept: true });
          }
        }
      }
    } catch (_) {}
    return out;
  }

  function claim(ctx, instanceId) {
    // Find the quest by instance id among all towns
    const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
    let found = null, townRef = null, idx = -1;
    for (const t of towns) {
      const qs = t && t.quests ? t.quests : null;
      if (!qs) continue;
      idx = (qs.active || []).findIndex(q => q && q.instanceId === instanceId);
      if (idx !== -1) { found = qs.active[idx]; townRef = t; break; }
    }
    if (!found || !townRef) { try { ctx.log && ctx.log("Quest not found.", "warn"); } catch (_) {} return false; }

    // Validate completion criteria
    if (found.kind === "gather") {
      const inv = ctx.player && ctx.player.inventory ? ctx.player.inventory : (ctx.player.inventory = []);
      const have = _materialCountInInventory(inv, found.material?.type, found.material?.name);
      if (have < (found.amount | 0)) { try { ctx.log && ctx.log("You don't have the required items.", "warn"); } catch (_) {} return false; }
      _removeMaterialFromInventory(inv, found.material?.type, found.material?.name, found.amount | 0);
    } else if (found.kind === "encounter") {
      if (found.status !== "completedPendingTurnIn") { try { ctx.log && ctx.log("This task is not complete yet.", "warn"); } catch (_) {} return false; }
    }

    // Pay gold
    const g = _goldObj(ctx);
    const pay = _randInt(_rng(ctx), found.rewardGoldMin | 0, found.rewardGoldMax | 0);
    g.amount = (g.amount | 0) + Math.max(1, pay);

    // Move to completed and remove marker if any
    try { if (found.marker) _removeMarker(ctx, found.marker.x, found.marker.y, found.instanceId); } catch (_) {}
    try {
      const qs = townRef.quests;
      qs.active.splice(idx, 1);
      qs.completed.push({ ...found, completedAtTurn: _nowTurn(ctx), finalStatus: "completed" });
    } catch (_) {}

    try { ctx.log && ctx.log(`Quest complete: ${found.title}. You receive ${pay} gold.`, "good"); } catch (_) {}
    _applyAndRefresh(ctx);
    return true;
  }

  // Accept a gather quest by template in the current town and immediately claim it if inventory satisfies.
  function claimTemplate(ctx, templateId) {
    const town = _currentTownEntry(ctx);
    if (!town) { try { ctx.log && ctx.log("No town context to claim the quest.", "warn"); } catch (_) {} return false; }
    const st = _ensureTownQuestState(ctx, town);
    // Is it already active?
    let inst = (st.active || []).find(a => a && a.templateId === templateId);
    if (!inst) {
      // Accept now
      const ok = !!accept(ctx, templateId);
      if (!ok) return false;
      inst = (st.active || []).find(a => a && a.templateId === templateId);
    }
    if (!inst) return false;
    return claim(ctx, inst.instanceId);
  }

  // Claim all eligible quests (including auto-accept gather quests in the current town)
  function claimAllEligible(ctx) {
    const list = getTurnIns(ctx);
    let any = false;
    for (const row of list) {
      if (!row) continue;
      if (row.requiresAccept && row.templateId) {
        any = claimTemplate(ctx, row.templateId) || any;
      } else if (row.instanceId) {
        any = claim(ctx, row.instanceId) || any;
      }
    }
    return any;
  }

  function maybeTriggerOnWorldStep(ctx) {
    if (!ctx || ctx.mode !== "world" || !ctx.world) return;
    _ensureWorldMarkers(ctx);
    const pos = _absPlayerPos(ctx);
    const markers = ctx.world.questMarkers || [];
    const here = markers.find(m => m && (m.x | 0) === (pos.x | 0) && (m.y | 0) === (pos.y | 0));
    if (!here) return;
    // Find the quest instance for this marker
    let quest = null;
    let townRef = null;
    try {
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      for (const t of towns) {
        const qs = t && t.quests ? t.quests : null;
        if (!qs) continue;
        const q = (qs.active || []).find(a => a && a.instanceId === here.instanceId);
        if (q) { quest = q; townRef = t; break; }
      }
    } catch (_) {}
    if (!quest || !townRef) { _removeMarker(ctx, pos.x, pos.y, here.instanceId); return; }
    if (quest.kind !== "encounter") { _removeMarker(ctx, pos.x, pos.y, here.instanceId); return; }

    // Start the special encounter; prefer EncounterRuntime.enter directly to pass questInstanceId
    const GD = _gd();
    const tmpl = _templateById(quest.templateId) || {};
    const encT = tmpl.encounter || {};
    const biome = (function guessBiome() {
      try {
        if (typeof window !== "undefined" && window.World && window.World.TILES) {
          const WT = window.World.TILES;
          const t = ctx.world.map[ctx.player.y][ctx.player.x];
          // Not strictly used; EncounterRuntime chooses generator by biome only when generator==='auto'
          if (t === WT.FOREST) return "FOREST";
          if (t === WT.GRASS) return "GRASS";
          if (t === WT.DESERT) return "DESERT";
          if (t === WT.SWAMP) return "SWAMP";
          if (t === WT.SNOW) return "SNOW";
          if (t === WT.BEACH) return "BEACH";
        }
      } catch (_) {}
      return "GRASS";
    })();

    try {
      const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
      if (ER && typeof ER.enter === "function") {
        ER.enter(ctx, {
          template: {
            id: "quest_bandits_farm",
            name: tmpl.title || "Quest Encounter",
            map: { generator: (encT.map && encT.map.generator) ? encT.map.generator : "camp", w: (encT.map && encT.map.w) || 26, h: (encT.map && encT.map.h) || 18 },
            groups: Array.isArray(encT.groups) && encT.groups.length ? encT.groups : [{ type: "bandit", count: { min: 3, max: 5 } }]
          },
          biome,
          difficulty: (encT.difficulty | 0) || 2,
          questInstanceId: quest.instanceId
        });
        // One-time marker removal upon entering
        _removeMarker(ctx, pos.x, pos.y, quest.instanceId);
      }
    } catch (_) {}
  }

  function onEncounterComplete(ctx, payload) {
    // Decide outcome based on enemies remaining at time of pressing G on exit tile
    try {
      const qid = (payload && payload.questInstanceId) || ctx._questInstanceId || null;
      if (!qid) return;
      const enemiesRemaining = (payload && typeof payload.enemiesRemaining === "number") ? (payload.enemiesRemaining | 0) : 0;
      const victory = enemiesRemaining <= 0;
      // Find the quest instance
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      for (const t of towns) {
        const qs = t && t.quests ? t.quests : null;
        if (!qs) continue;
        for (let i = 0; i < (qs.active || []).length; i++) {
          const a = qs.active[i];
          if (!a || a.instanceId !== qid) continue;
          if (a.kind !== "encounter") return;
          // Clear any lingering marker reference (world marker is already removed on entry)
          try { a.marker = null; } catch (_) {}
          if (victory) {
            a.status = "completedPendingTurnIn";
            try { ctx.log && ctx.log("Quest objective complete. Return to the Quest Board to claim your reward.", "good"); } catch (_) {}
          } else {
            // Withdraw early -> fail
            a.status = "failed";
            (qs.completed || (qs.completed = [])).push({ ...a, completedAtTurn: _nowTurn(ctx), finalStatus: "failed" });
            qs.active.splice(i, 1);
            try { ctx.log && ctx.log("You withdrew early. The quest has failed.", "warn"); } catch (_) {}
          }
          _applyAndRefresh(ctx);
          return;
        }
      }
    } catch (_) {}
  }

  // New: trigger quest encounter only when the player presses G on an 'E' marker tile
  function triggerAtMarkerIfHere(ctx) {
    if (!ctx || ctx.mode !== "world" || !ctx.world) return false;
    const pos = _absPlayerPos(ctx);
    const markers = Array.isArray(ctx.world.questMarkers) ? ctx.world.questMarkers : [];
    const here = markers.find(m => m && (m.x | 0) === (pos.x | 0) && (m.y | 0) === (pos.y | 0));
    if (!here) return false;

    // Resolve quest instance for this marker
    let quest = null;
    let townRef = null;
    try {
      const towns = Array.isArray(ctx.world?.towns) ? ctx.world.towns : [];
      for (const t of towns) {
        const qs = t && t.quests ? t.quests : null;
        if (!qs) continue;
        const q = (qs.active || []).find(a => a && a.instanceId === here.instanceId);
        if (q) { quest = q; townRef = t; break; }
      }
    } catch (_) {}
    if (!quest || !townRef) { _removeMarker(ctx, pos.x, pos.y, here.instanceId); return false; }
    if (quest.kind !== "encounter") { _removeMarker(ctx, pos.x, pos.y, here.instanceId); return false; }

    // Start the special encounter; pass questInstanceId through
    const GD = _gd();
    const tmpl = _templateById(quest.templateId) || {};
    const encT = tmpl.encounter || {};
    const biome = (function guessBiome() {
      try {
        if (typeof window !== "undefined" && window.World && window.World.TILES) {
          const WT = window.World.TILES;
          const t = ctx.world.map[ctx.player.y][ctx.player.x];
          if (t === WT.FOREST) return "FOREST";
          if (t === WT.GRASS) return "GRASS";
          if (t === WT.DESERT) return "DESERT";
          if (t === WT.SWAMP) return "SWAMP";
          if (t === WT.SNOW) return "SNOW";
          if (t === WT.BEACH) return "BEACH";
        }
      } catch (_) {}
      return "GRASS";
    })();

    try {
      const ER = ctx.EncounterRuntime || (typeof window !== "undefined" ? window.EncounterRuntime : null);
      if (ER && typeof ER.enter === "function") {
        ER.enter(ctx, {
          template: {
            id: "quest_bandits_farm",
            name: tmpl.title || "Quest Encounter",
            map: { generator: (encT.map && encT.map.generator) ? encT.map.generator : "camp", w: (encT.map && encT.map.w) || 26, h: (encT.map && encT.map.h) || 18 },
            groups: Array.isArray(encT.groups) && encT.groups.length ? encT.groups : [{ type: "bandit", count: { min: 3, max: 5 } }]
          },
          biome,
          difficulty: (encT.difficulty | 0) || 2,
          questInstanceId: quest.instanceId
        });
        // One-time marker removal upon entering
        _removeMarker(ctx, pos.x, pos.y, quest.instanceId);
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Expose API
  const api = {
    listForCurrentTown,
    accept,
    getTurnIns,
    claim,
    claimTemplate,
    claimAllEligible,
    maybeTriggerOnWorldStep, // legacy (no longer called automatically on step)
    triggerAtMarkerIfHere,
    onEncounterComplete
  };

  if (typeof window !== "undefined") window.QuestService = api;
})();