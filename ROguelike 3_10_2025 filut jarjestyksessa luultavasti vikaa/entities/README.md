Entities

Purpose
- Player, enemies, items, loot adapters, and equipment logic. Bridges JSON registries to runtime objects and combat/inventory systems.

Key modules
- player.js — player model and stats.
- player_equip.js — equipment slots, hand chooser, two-handed occupancy rules.
- player_utils.js — helpers for player state and inventory flows.
- items.js — item adapters over data registries; equip/use rules.
- enemies.js — enemy adapters over data registries; type loading hardened to avoid fallbacks.
- loot.js — loot transfer and consolidation (multi-container underfoot).

Notes
- Data loaders live under data/; entities bridge those registries with runtime behavior.
- Equipment decay/breakage mechanics are implemented in combat/equipment_decay.js, with snapshots used by tests.