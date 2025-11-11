Region Map

Purpose
- Local tactical overlay for a single overworld tile. Shows props, animals, and lootables when opened from the overworld.
- Designed for quick, small-scale interactions without entering a dungeon.

Key modules
- region_map_runtime.js — runtime/controller for entering/exiting the Region Map, rendering, and interaction gating.
  - Integrates with core/ modes and UIBridge, and respects modal gating (ESC to close).
  - Uses ui/render_region.js for drawing.

Notes
- Open from the overworld by pressing G on a walkable tile (or on RUINS tiles).
- Loot panel behaves like dungeons: pressing G on corpses/chests opens loot; animals show exact loot via the panel.
- Neutral animals spawn rarely and re-spawn with low chance when revisiting; cleared tiles skip future spawns (seeded).