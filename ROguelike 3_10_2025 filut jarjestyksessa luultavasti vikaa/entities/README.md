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

How to add a new enemy (by hand)
1) Define the enemy in data/entities/enemies.json:
   - Add an object with fields such as:
     {
       "id": "wolf",
       "name": "Wolf",
       "glyph": "w",
       "colors": { "fg": "#c4d7ff" },
       "level": 2,
       "hp": 8,
       "attack": { "min": 1, "max": 3, "critChance": 0.08 },
       "defense": 1,
       "speed": 1,
       "lootTable": "beast_low",
       "tags": ["beast","animal"]
     }
   - Keep fields consistent with existing entries for compatibility.

2) Ensure item/loot references exist:
   - If you referenced a lootTable, define it under data/loot/ as needed.

3) Use the enemy in encounters/dungeons:
   - For encounters: update data/quests/quests.json or data/encounters/templates.json groups entries with "type": "wolf".
   - For dungeon spawns: ensure dungeon generation/adapters can pick the new type (enemies.js reads the registry).

4) Optional: add flavor/messaging:
   - Add flavor lines keyed by category in data/i18n/flavor.json (e.g., category "animal" already covers wolves).
   - Add messages in data/i18n/messages.json if you need specific log strings.