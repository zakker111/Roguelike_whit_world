/**
 * Smoketest: validate critical JSON registries and surface warnings early.
 * Usage: included in dev builds; runs once on load.
 * Checks: items, enemies, materials, crafting recipes, tiles/palette, props.
 */
(function runSmoketest() {
  try {
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const Log = (typeof window !== "undefined" && window.Logger && typeof window.Logger.log === "function")
      ? (msg, type = "warn") => window.Logger.log(msg, type)
      : (msg, _type = "warn") => { try { console.warn("[Smoketest] " + msg); } catch (_) {} };

    window.ValidationLog = window.ValidationLog || { warnings: [], notices: [] };
    const V = window.ValidationLog;

    if (!GD) {
      V.warnings.push("GameData not present.");
      Log("GameData not present.");
      return;
    }

    // Items
    if (!Array.isArray(GD.items) || GD.items.length === 0) {
      V.warnings.push("Items JSON missing or empty.");
      Log("Items JSON missing or empty.");
    } else {
      // Basic schema check
      let bad = 0;
      for (const row of GD.items) {
        if (!row || !row.id || !row.slot) bad++;
      }
      if (bad > 0) {
        V.warnings.push(`Items: ${bad} entries missing id/slot.`);
        Log(`Items: ${bad} entries missing id/slot.`);
      }
    }

    // Enemies
    if (!Array.isArray(GD.enemies) || GD.enemies.length === 0) {
      V.warnings.push("Enemies JSON missing or empty.");
      Log("Enemies JSON missing or empty.");
    } else {
      let bad = 0;
      for (const e of GD.enemies) {
        if (!e || !e.id || (!e.hp && !e.atk)) bad++;
      }
      if (bad > 0) {
        V.warnings.push(`Enemies: ${bad} entries missing id or stats.`);
        Log(`Enemies: ${bad} entries missing id or stats.`);
      }
    }

    // Materials and crafting
    const mats = GD.materials && (Array.isArray(GD.materials.materials) ? GD.materials.materials : GD.materials.list);
    if (!Array.isArray(mats) || mats.length === 0) {
      V.warnings.push("Materials JSON missing or empty.");
      Log("Materials JSON missing or empty.");
    }
    const recipes = GD.crafting && Array.isArray(GD.crafting.recipes) ? GD.crafting.recipes : [];
    if (recipes.length === 0) {
      V.notices.push("Crafting recipes JSON missing or empty (campfire cooking will use defaults).");
      Log("Crafting recipes JSON missing or empty.", "notice");
    }

    // Tiles and palette
    if (!GD.tiles || !GD.tiles.tiles || !Array.isArray(GD.tiles.tiles)) {
      V.warnings.push("Combined assets tiles missing or invalid (data/world/world_assets.json).");
      Log("Combined assets tiles missing or invalid.");
    } else {
      // Mode coverage check: ensure each mode references only tiles that appearIn that mode
      // Use TileLookup.getTileDef(mode, id) to avoid id collisions across modes (e.g., id=0 used by WATER and WALL).
      try {
        const TileLookup = (typeof window !== "undefined" ? window.TileLookup : null);
        const TV = (typeof window !== "undefined" ? window.TilesValidation : null);
        const recorded = TV && typeof TV.getRecorded === "function" ? TV.getRecorded() : null;
        const missingByMode = { overworld: new Set(), region: new Set(), town: new Set(), dungeon: new Set() };
        function hasDef(mode, id) {
          try {
            if (TileLookup && typeof TileLookup.getTileDef === "function") {
              return !!TileLookup.getTileDef(mode, id);
            }
          } catch (_) {}
          return false;
        }
        if (recorded && Array.isArray(recorded)) {
          for (const rec of recorded) {
            const mode = String(rec.mode || "");
            const map = Array.isArray(rec.map) ? rec.map : [];
            for (let y = 0; y < map.length; y++) {
              const row = map[y] || [];
              for (let x = 0; x < row.length; x++) {
                const id = row[x] | 0;
                if (!hasDef(mode, id)) {
                  if (missingByMode[mode]) missingByMode[mode].add(String(id));
                }
              }
            }
          }
        }
        // If any missing coverage detected, warn with a summary per mode
        for (const m of Object.keys(missingByMode)) {
          const set = missingByMode[m];
          if (set && set.size > 0) {
            const list = Array.from(set.values()).join(", ");
            V.warnings.push(`Tiles.json coverage: mode=${m} references ${set.size} unknown or non-${m} ids: ${list}`);
            Log(`Tiles.json coverage: mode=${m} references unknown or non-${m} ids: ${list}`);
          }
        }
      } catch (_) {}
    }
    if (!GD.palette || typeof GD.palette !== "object") {
      V.notices.push("Palette JSON missing; using hardcoded color fallbacks.");
      Log("Palette JSON missing; using hardcoded color fallbacks.", "notice");
    } else {
      // DEV overlay palette keys check (dim, night, dusk, dawn + UI overlays)
      try {
        const ov = GD.palette.overlays || null;
        const expectBasic = ["dim", "night", "dusk", "dawn"];
        const expectUI = ["grid", "route", "routeAlt", "alert", "exitTown", "exitRegionFill", "exitRegionStroke", "vignetteStart", "vignetteEnd", "minimapBg", "minimapBorder"];
        if (!ov || typeof ov !== "object") {
          V.warnings.push("Palette overlays missing; expected keys: dim, night, dusk, dawn.");
          Log("Palette overlays missing; expected keys: dim, night, dusk, dawn.");
        } else {
          const missingBasic = [];
          for (const k of expectBasic) {
            const v = ov[k];
            if (typeof v !== "string" || v.trim().length === 0) missingBasic.push(k);
          }
          if (missingBasic.length) {
            V.warnings.push("Palette overlays missing keys: " + missingBasic.join(", ") + ".");
            Log("Palette overlays missing keys: " + missingBasic.join(", ") + ".");
          } else {
            V.notices.push("Palette overlays present: dim, night, dusk, dawn.");
            Log("Palette overlays present: dim, night, dusk, dawn.", "notice");
          }
          // UI overlay keys (warn only; gameplay unaffected)
          const missingUI = [];
          // Extended UI overlays (grid, route, alerts, exit highlights, vignette, minimap, panel, POIs, misc)
          const expectUIExt = expectUI.concat([
            "panelBg", "panelBorder",
            "poiTown", "poiDungeonEasy", "poiDungeonMed", "poiDungeonHard",
            "questMarker",
            "sleepingZ", "playerBackdropFill", "playerBackdropStroke",
            "regionAnimal", "shopkeeper",
            "regionAnimalsCleared", "regionAnimalsKnown"
          ]);
          for (const k of expectUIExt) {
            const v = ov[k];
            if (typeof v !== "string" || v.trim().length === 0) missingUI.push(k);
          }
          if (missingUI.length) {
            V.warnings.push("Palette overlays: missing UI keys: " + missingUI.join(", ") + ".");
            Log("Palette overlays: missing UI keys: " + missingUI.join(", ") + ".");
          } else {
            V.notices.push("Palette overlays UI keys present.");
            Log("Palette overlays UI keys present.", "notice");
          }
        }
      } catch (_) {}
    }

    // Props
    if (!GD.props || !GD.props.props || !Array.isArray(GD.props.props)) {
      V.notices.push("Props registry missing; decor glyphs may use fallbacks.");
      Log("Props registry missing; decor glyphs may use fallbacks.", "notice");
    }

    try { if (window.DEV) console.debug("[Smoketest] ValidationLog", V); } catch (_) {}
  } catch (e) {
    try { console.warn("[Smoketest] error", e); } catch (_) {}
  }
})();