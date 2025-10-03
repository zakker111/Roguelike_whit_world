# Tiny Roguelike Smoke Test

Purpose: Quickly verify core gameplay, UI, combat, FOV/LOS, RNG determinism, occupancy, and recent performance/diagnostics improvements.

Run setup
- Open index.html in a local web server or directly:
  - Easiest: `python3 -m http.server` then http://localhost:8000/index.html
  - Or open the file directly in Chrome/Firefox.
- Confirm no errors/warnings in the browser console on load (third‑party tracker blocks can be ignored).

Seed and DEV flags
- DEV mode:
  - http://localhost:8000/index.html?dev=1
  - Expect DEV perf logs (turn/draw timings) and occasional DEV notices after generation.
- Seed determinism:
  - Open GOD panel (P), enter a seed (e.g., 12345), click “Apply Seed”.
  - Confirm: “GOD: Applied seed 12345. Regenerating floor …”
  - Repeat same actions with same seed; outcomes should match.

FOV and LOS
- Player tile visibility:
  - On new floor, player tile is visible; tiles seen remain dim when not visible.
  - If not visible, a sanity message appears and visibility is corrected.
- FOV recompute guard:
  - Movement should not stutter; visibility updates only when needed (position/mode/map/FOV changed).
- LOS consistency:
  - Enemies are not drawn through walls; towns’ windows allow light but block movement.

Movement and combat
- Movement:
  - Arrow keys/numpad move; bump enemy to attack.
- Attack logs:
  - Hit location, damage, and “Critical!” when applicable.
  - Blood decals appear and fade over turns; capped to avoid runaway memory.
- Block and statuses:
  - Occasional “block” logs; dazed/bleed apply and tick with logs and visuals.

Inventory and equipment
- Inventory panel (I):
  - Stats line shows Attack/Defense; equipment slots show names with decay in tooltip.
  - Hand items:
    - If one hand empty: auto‑equip to that hand.
    - If both occupied: chooser appears (Left/Right).
    - Two‑handed: equips both; unequipping from either removes both.
  - Potions: click to drink; HP and counts update; logs reflect changes.
- Item labels:
  - Potions show stack count (e.g., “x3”).
  - Gold shows amount.
  - Equipment summaries include atk/def where available.

Looting
- Corpses:
  - Kill an enemy; move onto the corpse; press G to loot.
  - Player should be able to step onto corpse tiles immediately (no blocking).
  - Confirm auto‑equip of strictly better items with logs.
- Chest in start room:
  - On floor 1, a chest may spawn near start; open for loot and verify logs.

Dungeon generation and exploration (single‑level)
- Entrance/exit:
  - Brown stairs glyph (>) marks entrance/exit; press G on '>' to return to overworld.
  - At least one staircase per floor (fallback ensures).
- Rooms and corridors connect; typical runs do not have unreachable areas.

GOD panel and toggles (P)
- Heal: fully heals; log shows current HP.
- Spawn Items/Enemy/Stairs: logs appropriate actions; inventory/enemy placement verified.
- FOV slider: clamps 3..14; logs change; visibility updates.
- Side Log toggle: right‑side log mirror on/off; persists in localStorage.
- Always Crit:
  - Toggle and choose forced location (torso/head/hands/legs); attacks always crit with chosen location.
- RNG controls:
  - Apply Seed and Reroll; seed UI reflects current seed state.
- Diagnostics:
  - Click “Diagnostics”; logs determinism source, seed, mode/floor/FOV, map size, entity counts, loaded modules, and latest turn/draw timings.

Renderer, overlays, tileset
- Baseline:
  - Tiles render with colors; optional grid toggled in GOD panel.
- Overlays:
  - Town overlays (occupied houses/targets) and path overlays default OFF; toggles work and render on demand.
- Tileset (if present):
  - Floors/walls/stairs/chest/corpse/player/enemy sprites render; decals fallback works.

Flavor and logs
- Flavor lines may appear on blocks and notable hits; logs include info/good/warn/crit/block/notice/flavor types.
- Start‑of‑floor notice about enemy presence may appear (depending on flavor settings).

Deterministic items (items.js)
- With a seed set (e.g., 12345), spawn random items; note names/stats.
- Re‑apply seed and spawn again — results should match given same tier context.

Known edge cases
- If UI modules are absent, fallback DOM updates should not error.
- Tracker/telemetry errors from external domains can be ignored; they are environmental.

Pass criteria
- No console errors during:
  - Load, level generation, movement, combat (crits/blocks/status), inventory actions, looting, exit to overworld, GOD actions, Diagnostics.
- Determinism verified via seed for generation and items.
- LOS/FOV consistent (no enemies through walls; dim seen tiles).
- Decals appear and fade; capped count maintained.
- Corpses do not block; player can step onto and loot them immediately.
- Performance feels smooth; DEV perf counters show reasonable turn/draw times.

Quick regression checklist
- [ ] Load index.html: console clean (ignore blocked third‑party trackers)
- [ ] Generate floor: player tile visible; no FOV anomalies
- [ ] Move/attack: logs correct; decals appear/fade
- [ ] Block occurs: logs + decay applied
- [ ] Status effects: dazed/bleed apply and tick
- [ ] Inventory: equip/unequip; two‑handed behavior correct; labels show counts/stats
- [ ] Loot corpses/chest: can step on corpse; auto‑equip better items; loot panel OK
- [ ] Exit to overworld on '>': state transition OK
- [ ] GOD panel: all actions + Diagnostics function correctly
- [ ] FOV slider: changes radius and re‑renders; guard prevents redundant recomputes
- [ ] Seed determinism: repeatable outcomes
- [ ] Overlays: toggles work; default OFF for heavy overlays
- [ ] Tileset fallback: renders even if atlas missing