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
- balance/, crafting/, encounters/, entities/, loot/, quests/, shops/, world/, worldgen/, i18n/ — domain registries consumed by entities/, services/, and worldgen/.

Notes
- In strict mode, tiles/props must come from world_assets.json; without it, minimal defaults keep the game playable but visuals are limited.
- Use the local dev server (server.js) or Vite dev server to serve JSON reliably instead of file://.