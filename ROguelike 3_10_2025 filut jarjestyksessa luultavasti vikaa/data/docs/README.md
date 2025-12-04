Data and configuration

Purpose
- Source-of-truth JSON/JS registries and loaders for tiles/props, items, enemies, NPCs, shops, town config, encounters, quests, crafting, balance, and i18n. Also contains the GOD panel config and flavor text.

Key modules
- loader.js — loads and exposes GameData.*; strict mode requires combined assets file for tiles/props.
- tile_lookup.js — lookup helpers for tiles/props/glyphs.
- flavor.js — flavor strings and narrative text.
- god.js — GOD panel configuration, toggles, and storage clear helpers.

JSON registries (by folder)
- data/world_assets.json — combined assets file (strict mode). Required for full visuals: tiles (structural/terrain) and props (furniture/decor).
- config/ — game-level config (e.g., config.json, weather.json, encounter/seed defaults).
- world/ — world/town configuration (e.g., data/world/town.json for town sizes, plaza sizes, building density, population targets, inn/keep sizes).
- worldgen/ — prefab registries (e.g., data/worldgen/prefabs.json for houses/shops/inns/plazas/caravans).
- balance/, crafting/, encounters/, entities/, loot/, quests/, shops/, i18n/ — domain registries consumed by entities/, services/, and worldgen/.

Notes
- In strict mode, tiles/props must come from world_assets.json; without it, minimal defaults keep the game playable but visuals are limited.
- Use the local dev server (server.js) or Vite dev server to serve JSON reliably instead of file://.

How to add flavor text (by hand)
1) Edit data/i18n/flavor.json:
   - Add lines under appropriate categories (default, sharp, blunt, piercing, burn, freeze, animal, undead, giant) and parts (head, torso, legs, hands).
   - Each part supports { normal, crit } with either a string, an array of strings, or a keyed object of strings.

2) Flavor usage:
   - data/flavor.js logs flavor lines during hits and deaths; it infers category by enemy type and player weapon.

How to add messages or damage text (by hand)
1) Edit data/i18n/messages.json:
   - Add keys under domains like "combat", "dungeon", "world", etc. Example:
     "combat": { "hit": "You hit {target} for {dmg} damage.", "crit": "Critical hit!" }
   - Use placeholders like {dmg}, {target}, {n}. MessagesService will substitute variables.

2) Logging:
   - services/messages.js exposes Messages.get(key, vars) and Messages.log(ctx, key, vars, tone).
   - Prefer message keys rather than hardcoding strings in code.

How to add a new item/NPC/entity (by hand)
1) Edit the appropriate registry under data/entities/:
   - items.json, enemies.json, npcs.json, materials.json, tools.json, animals.json.
   - Follow the schema used by existing entries (name, glyph, stats, tags, lootTable, etc.).

2) Ensure cross-references exist:
   - If you reference a loot table or shop stock, update data/loot/ or data/shops/ accordingly.

3) Test:
   - Serve with node server.js; use GOD diagnostics to verify registries loaded.

Per-enemy damage scaling (enemies.json)
- Enemies are defined in data/entities/enemies.json using depth-based curves:
  - hp, atk, xp: arrays of [minDepth, base, slope], e.g. "atk": [[0, 2, 0.5]].
  - weightByDepth: spawn weights per dungeon depth.
  - Optional "damageScale": numeric multiplier (default 1.0) that scales this enemy type's damage relative to others.
- Runtime enemy damage is derived from:
  - atk(depth) from enemies.json
  - Global scaling from data/balance/combat.json (enemyDamageMultiplier(level))
  - Per-enemy "damageScale"
  - Hit-location multipliers and armor reduction from combat systems.
- To make a specific type hit harder or softer without changing its base atk curve:
  - Increase or decrease its "damageScale" in enemies.json (e.g. an elite type might use "damageScale": 1.4).