# Tiny Roguelike Smoke Test

Purpose: Verify core gameplay, UI, combat, FOV/LOS, RNG determinism, occupancy, persistence, and diagnostics. Includes a runner with an on‑screen report and downloadable summary/checklist.

How to run
- Local: `python3 -m http.server` then open http://localhost:8000/index.html
- Deployed site: append query parameters as needed.

Runner options (URL params)
- Run smoketest (orchestrator default): `?smoketest=1`
- Legacy thin shim: `&legacy=1` (orchestrator skips auto‑run; shim delegates to orchestrator)
- Scenario filter: `&scenarios=world,dungeon,inventory,combat,town,overlays,determinism` (legacy style `&smoke=` also supported)
- Enable DEV logs and diagnostics: `&dev=1`
- Inject malformed JSON for validator checks (DEV only): `&validatebad=1` (or `&badjson=1`)
- Multiple runs: `&smokecount=N` (e.g., `&smokecount=3`)
- Skip stable scenarios after N runs: `&skipokafter=N`
- Dungeon persistence frequency: `&persistence=once|always|never`
- Base RNG seed (per‑run derivation): `&seed=BASE`
- Abort current run on immobile: `&abortonimmobile=1` (default continues and records)
- Example: `index.html?smoketest=1&dev=1&smokecount=2&skipokafter=1&persistence=once&seed=12345`

Report and checklist
- GOD panel shows:
  - Step Details: color‑coded cards for OK/FAIL/SKIP.
  - Key Checklist: per‑run high‑level outcomes (entered dungeon, chest/persistence, enemy spawn/types/glyphs, town/NPC/shop checks).
  - Full JSON report embedded (collapsible).
  - Download buttons: JSON (full report), Summary (TXT), Checklist (TXT).

Automation tokens
- DOM: hidden `#smoke-pass-token` (PASS/FAIL), `#smoke-json-token` (compact JSON)
- Storage: `localStorage["smoke-pass-token"]`, `localStorage["smoke-json-token"]`

Seed and determinism
- DEV mode: `?dev=1` shows perf logs and extra notices.
- Apply seed in GOD panel; actions with the same seed should be repeatable.
- Runner performs a duplicate determinism run of the first seed and compares:
  - First enemy type
  - Chest loot list

Modal behavior (inventory, GOD, shop, loot)
- Movement is ignored while any modal is open.
- Escape closes GOD first, then Inventory; Shop/Loot panels also close on Escape.
- Runner ensures modals are closed before routing to avoid false movement failures; timing‑sensitive checks may record SKIP.

Dungeon entry and persistence
- Entry:
  - Runner attempts multiple strategies and watches for transient dungeon mode (up to several seconds).
  - Accepts success if log shows “enter the dungeon”/“re‑enter the dungeon”.
- Chest/persistence:
  - Loots chest if present, exits on '>' to overworld, re‑enters immediately.
  - Verifies chest remains empty (looted persists), corpses/decals counts not less, and corpse key overlap.
- Exit:
  - Uses Teleport helpers to land exactly on the stairs tile ('>'), presses 'g', calls returnToWorldIfAtExit(), and confirms “world” mode.
  - If exact placement or key handling fails, final fallback calls GameAPI.forceWorld() to guarantee overworld for the next steps.

Enemies and combat
- GOD spawn:
  - Spawns enemies via the GOD button; runner asserts count increase.
  - Enemy glyphs now resolve via registry/JSON; fallback uses first letter of type id (not “?”).
- Routing/attack:
  - Routes to nearest enemy, bumps to attack several times.
  - Records kill by corpse count change; decay increases on equipped hands if present.
- Crit/status:
  - Compares non‑crit vs head‑crit damage; legs‑crit applies immobilization and verifies ticks.

FOV and LOS
- Player tile visible; seen tiles dim when not currently visible.
- FOV recompute guard avoids redundant recomputation (changes only when needed).
- LOS: enemies are not drawn through walls.

Inventory and equipment
- Two‑handed items equip both hands; unequipping one removes both.
- One‑hand items auto‑equip to empty hand or allow explicit left/right choice.
- Potions: drinking reflects HP delta and stack counts.
- Gold: visible; basic buy/sell tests run if shop APIs are present.

Town generation and interactions
- Town entry; NPC presence:
  - Runner routes to town; if empty, attempts home routes and greeter spawn, then asserts NPC presence.
- NPC bump:
  - Teleports safely near target when appropriate, routes adjacent to nearest NPC, then bumps toward them to trigger dialogue (no 'G' required).
- NPC home/props:
  - Routes to NPC home door; tests reaching interior and interacting with a prop.
- Shop:
  - Teleport to a safe adjacent tile near the shop, then route to the shop tile.
  - Bump toward the shopkeeper (no G). If the menu doesn’t open but the keeper is present and adjacency/route succeeded, log “Shop present; route to shopkeeper: OK”.
  - Escape closes the Shop panel when open.
  - Teleport safely near the shop (avoids walls/NPC occupancy), route to the exact shop tile, then bump near the shopkeeper (no 'G').
  - If the shop UI opens via bump, Escape closes the panel and records result.
  - If the shop UI does not open but the shopkeeper is present and routing adjacency is confirmed, logs “Shop present; route to shopkeeper: OK”.

Performance and overlays
- Grid overlay and path/home overlays toggle from GOD panel; overlays default OFF.
- Runner records perf snapshots (turn/draw) and warns if budgets are exceeded.

Data registries and validation
- Loader brings JSON for items, enemies, npcs, shops, town.
- DEV + `&validatebad=1` injects malformed entries; runner waits for ValidationLog.warnings and records the count.

Known edge cases
- Environmental console noise (blocked trackers, editor websockets) is filtered or ignored.
- Timing differences can cause SKIP on modal priority or specific interactions; runner continues.

Pass criteria
- No game‑origin console errors during:
  - Load, level generation, movement, combat (crits/blocks/status), inventory actions, looting, enter/exit, GOD actions, Diagnostics.
- Determinism verified via seed for generation and items.
- LOS/FOV consistent (no enemies through walls; dim seen tiles).
- Decals appear/fade; capped count maintained.
- Corpses do not block; player can step onto and loot immediately.
- Dungeon chest/decals/corpses persist on re‑entry.
- Town/NPC/shop checks succeed (or SKIP where not applicable).
- Performance within reasonable bounds.

Quick regression checklist
- [ ] Load index.html: console clean (ignore blocked third‑party trackers)
- [ ] Generate floor: player tile visible; no FOV anomalies
- [ ] Enter dungeon: detected (mode or log) and proceed
- [ ] Loot chest + persistence: chest empty on re‑enter; corpses/decals OK
- [ ] GOD spawn enemy: count increases; types present; glyphs not “?”
- [ ] Move/attack: logs correct; kill recorded by corpses; decay increases
- [ ] Stair guard: G on non‑stair does not exit
- [ ] Exit to overworld on '>': transition OK
- [ ] Town entry: entered; NPC presence asserted (greeters/home routes if needed)
- [ ] NPC bump: dialogue logged
- [ ] NPC home/props: reached/interacted
- [ ] Shop: opened via G; Esc closes panel
- [ ] Inventory: equip/unequip; two‑handed behavior correct; labels show counts/stats
- [ ] Potions: drink reflects HP delta; stacks update
- [ ] FOV slider: changes radius; guard prevents redundant recomputes
- [ ] Seed determinism: repeatable outcomes
- [ ] Overlays: toggles work; default OFF for heavy overlays
- [ ] Tileset fallback: renders even if atlas missing

Recent updates
- Shop UI + GameAPI modularization:
  - ShopUI extracted to ui/shop_panel.js; core/game.js delegates open/hide/buy; GameAPI moved to core/game_api.js.
  - New GameAPI.forceWorld() for smoketest hard fallback to overworld.
- Mouse input module:
  - ui/input_mouse.js now handles click-to-move/loot/talk; loaded before core/game.js.
- Teleport helpers made exact and safe:
  - Town/Dungeon exit helpers teleport near, nudge, then force-teleport to exact tile if needed; confirm “world”; final fallback uses GameAPI.forceWorld().
- Runner hardening:
  - Consolidated readiness guard waitUntilRunnerReady(); GOD kept closed during exit/seeding; reopened only after overworld + seed confirmed.
  - Post-“town_diagnostics” hook robustly closes GOD (Escape + UI.hideGod + DOM hidden check).
- Town diagnostics and shop flows:
  - Teleport near shop, route to exact tile, bump near shopkeeper (no 'G'); Escape closes if UI opens.
  - If menu fails to open but keeper present and route adjacency confirmed, logs “Shop present; route to shopkeeper: OK”.