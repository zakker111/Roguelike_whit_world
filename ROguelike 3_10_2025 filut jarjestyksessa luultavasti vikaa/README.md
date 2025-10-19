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
  - Help: F1 (or Help button in the HUD)
  - Region Map: M (toggle overview map/modal)
  - Wait: Numpad5
  - Brace: B (dungeon only; raises block chance this turn if holding a defensive hand item)

Data-driven configuration
- JSON files under data/ drive most content:
  - items.json: equipment types and stat ranges
  - enemies.json: enemy types, glyphs/colors, spawn weights, stat formulas
  - npcs.json: names and flavor lines
  - consumables.json: potions/consumables
  - shops.json: shop names/types and open/close schedules
  - town.json: map size, plaza size, roads, buildings, props
- These are loaded by data/loader.js and adapted at runtime; missing fields fall back safely.
- When running via file://, the loader provides built-in defaults so the game remains playable without HTTP.

Determinism and seeds
- RNG is centralized; apply seeds in the GOD panel.
- With the same seed and context, generation and item rolls are repeatable.

Encounters
- While traveling on the overworld, you may be prompted with a random encounter. Accept to enter a small tactical map themed by the current biome.
- Exit: stand on the '>' tile and press G to return to the overworld (no auto-exit).
- Props: pressing G while standing on a prop logs a context message (barrel/crate/bench/campfire, etc.). Lootable containers (chests/corpses) use G to open loot.
- Merchants: some encounters feature a wandering merchant (e.g., Seppo). Bumping into the merchant opens the Shop UI; premium stock is available.
- Encounter rate: adjustable in the GOD panel via the “Encounter rate” slider (0–100). Setting persists per-browser.

Smoketest (optional)
- Orchestrator default: append ?smoketest=1 to the URL; add &dev=1 for diagnostics.
- Scenario filter: &scenarios=world,dungeon,inventory,combat,town,overlays,determinism (legacy style &smoke= also supported).
- Multiple runs: &smokecount=N.
- Legacy thin shim: &legacy=1 (orchestrator skips auto‑run; shim delegates to orchestrator).
- DEV-only JSON validation injection: &validatebad=1 (or &badjson=1) + &dev=1.
- The GOD panel shows:
  - Step Details (OK/FAIL/SKIP)
  - Key Checklist (entered dungeon, chest/persistence, enemy spawn/types/glyphs, town/NPC/shop checks)
  - Full JSON report with download buttons (JSON/TXT)

Local dev server
- To serve JSON reliably (instead of file://), use the included static server:
  - node server.js
  - Open http://localhost:8080/?dev=1
- You can change the port with PORT=9000 node server.js

Bundling (optional, Vite)
- This project supports optional bundling for production using Vite. Native ESM still works without bundling.
- Setup:
  - npm install
  - npm run dev         # start Vite dev server (imports are resolved automatically)
  - npm run build       # builds to dist/ with optimized assets
  - npm run preview     # serves the built dist/ on http://localhost:8080
- Deploy:
  - You can deploy either the raw repo (native ESM) or the dist/ folder produced by Vite.

Key features at a glance
- Single-floor dungeons with connected rooms, guaranteed stairs, and data-driven enemies.
- Interaction-first gameplay: bump-to-attack, G to loot/interact/enter/exit.
- HUD perf overlay: shows last turn and draw timings (ms) next to the clock for optimization visibility.
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
- ui/: logger, renderer, tileset
- smoketest/: modular test runner (helpers, capabilities, reporting, runner, scenarios) + legacy thin shim
- services/: RNG, time, shop helpers
- data/: JSON registries and loader
- worldgen/: town generation utilities

Development
- Lint: npx eslint .
- Format: npx prettier -c . / -w .
- See VERSIONS.md for a concise changelog and recent improvements.

Cleanup and pre‑merge checklist (Phase 5)
- Duplicate/dead code policy:
  - Prefer ctx.* handles over window.*; facades centralize UI (UIBridge) and mode lifecycles (WorldRuntime/TownRuntime/DungeonRuntime).
  - Draw scheduling is centralized; individual modules avoid requestDraw, relying on orchestrator paths.
  - Inventory rendering occurs only when the panel is open; DOM work is coalesced across actions.
- How to generate the duplication/size report:
  - node scripts/analyze.js
  - Output written to analysis/phase1_report.md (top 20 largest files and approximate duplicated 3‑line shingles across JS).
- Recommended pre‑merge steps:
  - Run lint and formatter (see above).
  - Regenerate analysis/phase1_report.md and skim duplicates for potential DRY refactors.
  - Run smoketest (?smoketest=1) and confirm 0 FAIL steps; small SKIPs are acceptable.
  - Verify GOD toggles for Grid/Perf/Minimap and debug overlays behave as expected.
- Known cleanup outcomes from Phase 5:
  - Removed redundant requestDraw calls in Actions/Town/GOD/UI; draw orchestration consolidated.
  - Removed direct ShopUI/DOM fallbacks in core; UIBridge is the single UI path.
  - World-mode FOV recompute guard avoids re-filling arrays on movement.
  - Renderer hot paths cache base layers and glyph lookups; minimap uses an offscreen cache and responsive sizing.

Notes
- Prefer ctx.* over window.* in modules.
- Use UIBridge (core/ui_bridge.js) for UI interactions (inventory, loot, game over, confirm, town exit button) instead of calling window.UI directly.
- Dungeon/town lifecycles are centralized via DungeonRuntime and TownRuntime; Modes delegates transitions and persistence through these facades.
- UI panels are ESC-to-close; input prioritizes closing modals before movement.