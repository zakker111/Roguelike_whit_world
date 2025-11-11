UI and rendering

Purpose
- Presentation layer for the game: rendering tiles, overlays, HUD, panels, and mouse input. Pure browser-native UI components.

Key modules
- render_core.js — core canvas drawing primitives and batching.
- render_overworld.js — overworld renderer (tiles, fog-of-war, minimap integration).
- render_town.js — town renderer (biome tinting, roads, buildings, props).
- render_dungeon.js — dungeon renderer (rooms, walls, torches, stairs).
- render_overlays.js — diagnostic overlays (grid, paths, perf, minimap toggle).
- render_region.js — local tactical Region Map overlay renderer.
- render.js — orchestration and common glue across mode renderers.
- tileset.js — glyph/char/color lookup, caching, and tileset utilities.
- decals.js — decorative decals and subtle glow overlays (lighting, props).
- logger.js — in-game HUD logger, perf banner and panels.
- ui.js — UI panel composition (Inventory, GOD, Loot, Shop, Smoke, Help).
- components/fishing_modal.js — example modal component inclusion.
- input_mouse.js — mouse interactions, clicks, hover helpers.
- style.css — visual styles for HUD and panels.

Notes
- ESC closes open panels; input gating prevents movement while modals are open.
- GOD panel provides toggles (grid/perf/minimap/overlays) and tools; UIBridge in core/ coordinates panel lifecycle.