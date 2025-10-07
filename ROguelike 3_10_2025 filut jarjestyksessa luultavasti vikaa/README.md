Tiny Roguelike — README

What this is
- A small browser-based roguelike with a data-driven content model (items, enemies, NPCs, shops, town layout).
- Deterministic seeds for repeatable runs, simple UI, single-floor dungeons, and a built-in smoketest runner.

Play it
- Open index.html in a browser (or the deployed URL).
- Controls:
  - Move: Arrow keys or Numpad
  - Action (G): interact, loot, enter/exit
  - Inventory: I
  - GOD panel: P
  - Wait: Numpad5

Data-driven configuration
- JSON files under data/ drive most content:
  - items.json: equipment types and stat ranges
  - enemies.json: enemy types, glyphs/colors, spawn weights, stat formulas
  - npcs.json: names and flavor lines
  - consumables.json: potions/consumables
  - shops.json: shop names/types and open/close schedules
  - town.json: map size, plaza size, roads, buildings, props
- These are loaded by data/loader.js and adapted at runtime; missing fields fall back safely.

Determinism and seeds
- RNG is centralized; apply seeds in the GOD panel.
- With the same seed and context, generation and item rolls are repeatable.

Smoketest (optional)
- Auto-run: append ?smoketest=1 to the URL; add &dev=1 for diagnostics.
- Multiple runs: &smokecount=N.
- DEV-only JSON validation injection: &validatebad=1 (or &badjson=1) + &dev=1.
- The GOD panel shows:
  - Step Details (OK/FAIL/SKIP)
  - Key Checklist (entered dungeon, chest/persistence, enemy spawn/types/glyphs, town/NPC/shop checks)
  - Full JSON report with download buttons (JSON/TXT)

Key features at a glance
- Single-floor dungeons with connected rooms, guaranteed stairs, and data-driven enemies.
- Interaction-first gameplay: bump-to-attack, G to loot/interact/enter/exit.
- Inventory/equipment:
  - Two-handed items occupy both hands; unequipping one removes both.
  - One-handed items auto-equip to the empty hand or can be equipped explicitly left/right.
  - Decay increases through combat; breakage is supported.
- Towns with shops and NPCs:
  - Shops, schedules, and greeters; basic bump-buy test hooks (if enabled).
  - NPC bump dialogue; home/prop checks; ESC closes the Shop panel.
- UI/UX:
  - FOV and LOS consistent; seen tiles dim when not visible.
  - Escape closes modals; movement is ignored while any modal is open.

Useful flags and persistence
- dev=1: enable DEV mode (extra logs); dev=0 disables.
- mirror=1|0: side log mirror on/off (persists in localStorage).
- Seed persists in localStorage SEED and is shown in the GOD panel.

Project layout (brief)
- core/: engine, loop, ctx, input, modes
- world/: overworld generation and walkability
- dungeon/: generation, items, state persistence
- entities/: items and enemies adapters over JSON
- ui/: logger, renderer, tileset, smoketest runner
- services/: RNG, time, shop helpers
- data/: JSON registries and loader
- worldgen/: town generation utilities

Development
- Lint: npx eslint .
- Format: npx prettier -c . / -w .
- See VERSIONS.md for a concise changelog and recent improvements.

Notes
- Prefer ctx.* over window.* in modules.
- UI panels are ESC-to-close; input prioritizes closing modals before movement.