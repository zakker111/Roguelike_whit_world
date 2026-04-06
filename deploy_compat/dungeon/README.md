Dungeon systems

Purpose
- Single-floor dungeon generation, occupancy, persistence, lighting, item placement, and stair handling for returns to overworld.
- Tower dungeons (kind: "tower") are implemented as multi-floor variants that use the same persistence layer but a different generator.

Key modules
- dungeon.js — generation of rooms/corridors with connected layout and guaranteed stairs; integration with ED scaling.
- dungeon_state.js — persisted dungeon state across visits (looted containers, cleared enemies).
- occupancy_grid.js — tile occupancy model for pathing and AI/block checks.
- dungeon_items.js — item/adapters specific to dungeon spawn/loot tables.
- core/dungeon/runtime.js — high-level dungeon/tower runtime (enter/exit, state load/save, towerRun multi-floor towers, stair navigation).
- core/dungeon/tower_prefabs.js — JSON-driven tower room stamping (barracks/storage/prison/boss arenas) using data/dungeon/tower_prefabs.json.

Notes
- Generic dungeons:
  - Single-floor; stand on STAIRS (>) and press G to return to the overworld.
  - Mountain-pass dungeons may place a deeper portal and any STAIRS returns you to the overworld.
- Towers:
  - Overworld towers (TOWER tiles) open tower dungeons with 3–5 floors managed via ctx.towerRun.
  - Each tower floor is assembled from JSON prefabs plus corridors and then populated with bandit enemies, props, and chests.
  - Floors persist fully (map, enemies, corpses, props, chest state) across floor changes and overworld exits; revisiting restores exactly what you left.
  - Some tower rooms contain CAPTIVE props; standing on a captive in a tower and pressing G frees the captive and spawns a guard-faction ally next to the player. These allies never target the player (they are marked _ignorePlayer) and fight bandits inside the tower.
- Wall torches emit light; renderer applies subtle glow overlays.