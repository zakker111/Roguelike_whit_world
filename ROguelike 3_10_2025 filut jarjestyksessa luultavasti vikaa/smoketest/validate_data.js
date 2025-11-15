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
    }
    if (!GD.palette || typeof GD.palette !== "object") {
      V.notices.push("Palette JSON missing; using hardcoded color fallbacks.");
      Log("Palette JSON missing; using hardcoded color fallbacks.", "notice");
    } else {
      // DEV overlay palette keys check (dim, night, dusk, dawn)
      try {
        const ov = GD.palette.overlays || null;
        const expect = ["dim", "night", "dusk", "dawn"];
        if (!ov || typeof ov !== "object") {
          V.warnings.push("Palette overlays missing; expected keys: dim, night, dusk, dawn.");
          Log("Palette overlays missing; expected keys: dim, night, dusk, dawn.");
        } else {
          const missing = [];
          for (const k of expect) {
            const v = ov[k];
            if (typeof v !== "string" || v.trim().length === 0) missing.push(k);
          }
          if (missing.length) {
            V.warnings.push("Palette overlays missing keys: " + missing.join(", ") + ".");
            Log("Palette overlays missing keys: " + missing.join(", ") + ".");
          } else {
            V.notices.push("Palette overlays present: dim, night, dusk, dawn.");
            Log("Palette overlays present: dim, night, dusk, dawn.", "notice");
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