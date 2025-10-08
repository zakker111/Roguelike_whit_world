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
- Example: `index.html?smoketest=1&dev=1&smokecount=2`

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
  - Stair guard: pressing G on a non‑stair tile remains in dungeon.

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
  - Routes adjacent to nearest NPC and bumps to trigger dialogue.
- NPC home/props:
  - Routes to NPC home door; tests reaching interior and interacting with a prop.
- Shop:
  - Route to shop; open with G; Escape closes shop panel.

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
- Live Matchup scoreboard (GOD panel):
  - Sticky/pinned header at the top of the output.
  - FAIL items listed first, then SKIPs, then OKs; up to 20 items by default; Expand to show everything.
- Aggregation across runs (union of success):
  - Final aggregated report appended at the end; steps marked OK if any run passed, SKIP if only skipped, FAIL otherwise.
- Seed per run + world-mode guard:
  - Runner ensures “world” mode before seeding and applies a fresh 32-bit seed for each run in a series.
- Entry hardening:
  - Town/Dungeon scenarios close modals, route to target or adjacent tile with larger budgets, then nudge and enter via API.