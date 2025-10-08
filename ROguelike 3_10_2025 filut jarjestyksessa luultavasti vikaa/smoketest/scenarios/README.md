# smoketest/steps

Scenario steps split by domain. Each module exports functions consumed by the core runner.

Suggested files:
- world.js — routing to dungeon/town, world tile scans.
- dungeon.js — chest loot, exit/re-enter persistence, combat burst, decay/breakage tests.
- town.js — NPC interactions, home routes, decorations/props, shops and schedules.
- inventory.js — open/close behavior, equip/unequip flows, potions.
- combat.js — spawn enemies, hit/block spread, crit status variations.
- overlays.js — grid/town overlays toggles and perf checks.