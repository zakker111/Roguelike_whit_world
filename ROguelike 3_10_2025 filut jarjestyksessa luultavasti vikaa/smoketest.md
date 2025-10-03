# Tiny Roguelike Smoke Test

Purpose: Quickly verify the core game loop, UI, combat, FOV/LOS, RNG determinism, and modular helpers after changes.

Run setup
- Open index.html in a local web server or directly:
  - Easiest: use a simple local server (e.g., `python3 -m http.server`) and navigate to http://localhost:8000/index.html
  - Alternatively open index.html directly in a modern browser (Chrome/Firefox)
- Confirm no errors or warnings in the browser console on load.

Seed and DEV flags
- Optional DEV mode:
  - Open http://localhost:8000/index.html?dev=1
  - Expect a notice log like “[DEV] Enemies spawned: …, visible now: …” after floor gen.
- Seed determinism:
  - GOD panel (P), set a seed (e.g., 12345) and click “Apply Seed”.
  - Confirm log: “GOD: Applied seed 12345. Regenerating floor …”
  - Move, fight, and descend; repeat with the same seed and the same actions should produce identical outcomes.

FOV and LOS
- Player tile visibility:
  - On new floor, confirm the player’s tile is visible (highlighted floorLit).
  - If not visible, game logs a sanity-recompute message and fixes it.
- Visibility behavior:
  - Move around rooms and corridors; tiles become seen and remain dim when not currently visible.
  - Confirm enemies are only drawn when their tile is visible.
- LOS consistency:
  - With mime_ghost behavior (rare but present early), confirm it uses ctx.los for visibility decisions.
  - In towns, window tiles allow light to pass (see-through for FOV) but still block movement.
  - No console errors related to LOS functions.

Movement and basic combat
- Movement:
  - Use arrow keys or numpad to move. Confirm bumping into enemies triggers attacks.
- Bump-to-attack:
  - On attack, confirm logs of hit location, damage, and “Critical!” when applicable.
  - Confirm blood decals appear on hit tiles and fade over turns.
- Blocks:
  - Expect occasional block logs (player and enemies) with flavor lines (“block”, “flavor”, “info”).
- Status effects:
  - On enemy head crit: player may be dazed; expect “You are dazed …” (warn).
  - On crits (you or enemy), bleed may apply; verify bleed ticks log and decals.

Inventory and equipment
- Inventory panel (I):
  - Confirm stats line (Attack/Defense) and equipment slots show item names and decay in title tooltips.
  - Click equippable items:
    - Hand items: if both hands occupied, chooser appears; if one is empty, equips to that hand automatically.
    - Two-handed: equips to both; unequip from either hand removes both.
  - Drink potions: click potion entries; verify HP change logs and inventory updates.
- Decay behavior:
  - Attacking and blocking increases decay (hands and active equipment).
  - On breakage (decay ≥ 100), confirm removal log and slot clears.

Looting
- Corpses:
  - Kill enemies; move onto corpse; press G to loot.
  - Confirm newly acquired items are auto-equipped if strictly better (and logs reflect it).
  - Loot panel lists names; clicking closes it; any key also closes.
- Chest in start room:
  - On floor 1, confirm a chest can spawn near start; “You notice a chest nearby.” then open it for loot.

Dungeon generation and exploration (single-level dungeons)
- Entrance/exit:
  - Look for the brown stairs glyph (>) marking the entrance/exit tile (or tileset stairs if configured).
  - In dungeons, press G while standing on '>' to return to the overworld. Descending is disabled.
  - Ensure at least one staircase tile exists per floor (fallback logic).
- Rooms:
  - Rooms and corridors connect; explore to ensure no unreachable areas in typical runs.

GOD panel and toggles (P)
- Heal: Fully heals and logs current HP.
- Spawn Items: Adds items to inventory; names and stats show.
- Spawn Enemy Nearby: Creates enemies around player; logs location and level.
- Spawn Stairs Here: Puts stairs under the player; use G on '>' to leave the dungeon.
- FOV slider: Adjusts FOV (clamped 3..14) and logs changes; visible area updates.
- Side Log toggle: Turns right-side log mirror on/off; persists in localStorage.
- Always Crit toggle:
  - Toggles and optionally prompts for forced location (torso/head/hands/legs).
  - Confirm player attacks always crit; location forced if set.
- RNG controls:
  - Apply Seed: sets deterministic rng; Reroll: uses current time.
  - Seed UI reflects current seed state.

Renderer and tileset
- Baseline:
  - Tiles render with colors; optional subtle grid toggled in GOD panel.
- Tileset (if provided):
  - Confirm floors, walls, stairs, chest, corpse, player, enemy sprites draw via tileset; decals fallback works.

Flavor and logs
- Block flavor:
  - Flavor.onBlock is present; blocks may log additional flavor lines (if implemented).
- Player hit flavor:
  - Occasional lines for torso and head crits.
- Floor enemy count:
  - At floor start, notice shows “You sense N enemies on this floor.”

Deterministic items module (items.js)
- With a seed set (e.g., 12345), generate equipment via GOD “Spawn Random Items”.
  - Note the names and stats; re-apply same seed and spawn again — results should match (given same tier context).

Known edge cases
- If UI modules are absent, fallback DOM updates should still work without console errors.
- MIME ghost behavior is rarer; multiple floors may be needed to observe.

Pass criteria
- No console errors during:
  - Load, level generation, movement, combat (including crits/blocks/status), inventory actions, looting, descent, GOD actions.
- Logs appear with appropriate types (info/good/warn/crit/block/notice/flavor).
- Determinism verified via seed for generation and items.
- LOS/FOV behave consistently (no enemies seen through walls; seen-but-not-visible tiles dimmed).
- Decals appear on damage and fade over time; capped count prevents memory growth.

Quick regression checklist
- [ ] Load index.html: console clean
- [ ] Generate floor: player tile visible, enemies announced
- [ ] Move/attack: hit/crit/decals logs correct
- [ ] Block occurs: logs and decay applied
- [ ] Status effects apply/tick (dazed/bleed)
- [ ] Inventory: equip/unequip, two-handed behavior correct
- [ ] Loot corpses/chest: auto-equip better items and log summary
- [ ] Return to overworld at entrance ('>') by pressing G: state transitions OK
- [ ] GOD panel: all actions work as expected
- [ ] FOV slider: changes radius and re-renders
- [ ] Seed determinism: repeatable outcomes
- [ ] Tileset fallback: renders even if atlas missing