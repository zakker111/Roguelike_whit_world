# smoketest/scenarios

Scenario steps split by domain. Each module exports functions consumed by the orchestrator (runner.js).

Files
- world.js — routing to dungeon/town, world tile scans.
- dungeon.js — enter dungeon from overworld; basic verification.
- dungeon_persistence.js — chest loot, exit/re‑enter persistence, non‑stair guard.
- dungeon_stairs_transitions.js — tower→dungeon transition regression checks (stairs/exit state).
- town.js — town entry and basic interactions from overworld.
- town_flows.js — NPC bump, home routes, props, late‑night checks.
- town_diagnostics.js — shops, schedules, bump‑buy, gold operations, shop UI.
- inventory.js — open/close behavior, equip/unequip flows, potions, two‑handed and hand chooser tests.
- combat.js — spawn enemies, routing and bump‑attacks, decay snapshot.
- overlays.js — grid/town overlays toggles and perf checks.
- ui_layout.js — verifies canvas position is stable as log output grows.
- determinism.js — seed re‑apply and anchor checks (nearest town/dungeon).
- gm_disable_switch.js — verifies `gm.enabled=false` suppresses GMBridge side effects (no gm.* markers, no confirms/encounters).
- gm_panel_smoke.js — basic GM panel open + output sanity checks.
- quest_board_gm_markers.js — verifies gm.* markers render in the Quest Board UI.
- See `smoketest/scenarios.json` for the full scenario list.

Notes
- The orchestrator runs scenarios in a pipeline by default; you can filter with `&scenarios=world,dungeon,combat` (or legacy `&smoke=`).
- Scenario context (`ctx`) includes: key(), sleep(), makeBudget(), ensureAllModalsClosed(), CONFIG, caps, record(), recordSkip().