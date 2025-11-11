World systems

Purpose
- Infinite deterministic overworld generation, world tile data, and visibility (LOS/FOV). Responsible for chunk streaming, fog-of-war, roads, rivers, bridges, and POI placement.

Key modules
- infinite_gen.js — streaming infinite world in 32‑tile chunks; deterministic by seed.
- world.js — world map model, walkability, POI (town/dungeon) placement hooks, markers, biome tinting.
- los.js — line-of-sight helpers used by renderers and FOV.
- fov.js — field-of-view computation and seen/fog arrays.

Notes
- Roads connect towns within the currently streamed window; bridges carve fully across rivers (1–3 tiles wide).
- Dungeon markers are color-coded by difficulty; minimap reflects fog-of-war and expands as the map grows.