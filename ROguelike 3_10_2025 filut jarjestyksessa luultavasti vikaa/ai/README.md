AI systems

Purpose
- Implements non-player character behavior, routing, and decision-making in overworld, towns, dungeons, and encounters.

Key modules
- ai.js — base AI utilities and behavior primitives shared across modes.
- town_ai.js — town resident scheduling, path planning, home/inn/plaza routing, bump interactions.
- pathfinding.js — grid/pathfinding helpers used by AI to navigate obstacles and roads.

Notes
- Town AI integrates with World/Town runtimes via capabilities in core/, and uses services/time_service.js for schedules.
- Pathfinding expects occupancy information via core/occupancy_facade.js and dungeon/occupancy_grid.js (for dungeon-like maps).