Dungeon systems

Purpose
- Single-floor dungeon generation, occupancy, persistence, lighting, item placement, and stair handling for returns to overworld.

Key modules
- dungeon.js — generation of rooms/corridors with connected layout and guaranteed stairs; integration with ED scaling.
- dungeon_state.js — persisted dungeon state across visits (looted containers, cleared enemies).
- occupancy_grid.js — tile occupancy model for pathing and AI/block checks.
- dungeon_items.js — item/adapters specific to dungeon spawn/loot tables.

Notes
- Stairs (G to exit) return to overworld; mountain-pass dungeons may place a deeper portal and any STAIRS returns you to the overworld.
- Wall torches emit light; renderer applies subtle glow overlays.