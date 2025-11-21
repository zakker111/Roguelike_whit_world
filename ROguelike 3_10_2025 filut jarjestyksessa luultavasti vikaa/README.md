Tiny Roguelike — README

What this is
- A small browser-based roguelike with a data-driven content model (items, enemies, NPCs, shops, town layout).
- Deterministic seeds for repeatable runs, simple UI, single-floor dungeons, and a built-in smoketest runner.

Play it
- Open index.html in a browser (or the deployed URL).
- Controls:
  - Move: Arrow keys or Numpad
  - Action (G): interact, loot, enter/exit
  - Local Region Map: G (open local overlay on walkable overworld tiles; M is disabled)
  - Inventory: I
  - GOD panel: P
  - Help: F1 (or Help button in the HUD)
  - Wait: Numpad5
  - Brace: B (dungeon only; raises block chance this turn if holding a defensive hand item)

Overworld and exploration (infinite world)
- Infinite, deterministic overworld streaming in 32-tile chunks as you explore beyond the current edges.
- Real FOV/LOS on the overworld: only tiles you’ve seen are revealed; unseen tiles are fogged.
- Minimap reflects fog-of-war and grows as the map expands. Toggle in the GOD panel (persists).
- Bridges:
  - Overworld road overlays have been removed; connectivity is still guaranteed via carved walkable corridors, but roads are no longer drawn as separate tiles on the main map.
  - Bridges carve fully across narrow river spans for complete crossings and are drawn as more opaque overlays.
- POIs (towns/dungeons) are placed sparsely and deterministically; density slightly increased (~1–2%).
- Dungeon markers:
  - Color-coded by dungeon level on the main map and minimap:
    - Level 1–2: green
    - Level 3: amber
    - Level 4–5: red
  - Mountain-edge dungeons (adjacent to MOUNTAIN tiles) are highlighted with a distinct cyan/blue marker to make mountain passes easier to spot.
  - Numeric labels removed; markers render above fog for visibility.
- Mountain pass dungeons:
  - If a dungeon entrance is on/adjacent to a Mountain tile, a special portal is placed deeper inside.
  - Stepping on that portal tunnels to a new dungeon “across” the mountain.
  - Any regular STAIRS tile returns you to the overworld (press G).

Encounters
- While traveling on the overworld, you may be prompted with a random encounter. Accept to enter a small tactical map themed by the current biome.
- Default encounter rate is 5% (tunable via the GOD panel “Encounter rate” slider; persists).
- Exit: stand on the '>' tile and press G to return to the overworld (no auto-exit).
- Props: pressing G while standing on a prop logs a context message (barrel/crate/bench/campfire, etc.). Lootable containers (chests/corpses) use G to open loot.
- Merchants: some encounters feature a wandering merchant. Bumping into the merchant opens the Shop UI; premium stock is available.

Dungeons and difficulty scaling
- Single-floor dungeons; stand on any STAIRS tile to return to the overworld (G).
- Enemy difficulty scales with Effective Difficulty (ED):
  - ED = dungeon level + floor(player.level / 2) + 1
  - Entry log shows “You explore the dungeon (Level X, Effective Y).”
- Enemy registry loading hardened to avoid fallback enemies; proper types are used when JSON is available.

Towns and Wild Seppo
- Shops, schedules, plaza, greeters; bump-shop at the door to trade when open.
- Shop types include: Inn (always), Blacksmith, Armorer, Apothecary, Trader, Carpenter, Bakery (06:00–15:00).
  - Shop presence is probabilistic by town size; at most one of each type per town/city (deduplicated).
- Residents who like the Inn will sometimes stop by the Inn in the early evening before going home (~33% of days), with short sits and seating cap to avoid crowding.
- Wild Seppo (wandering merchant) may arrive at the plaza rarely during day/dusk.
  - Only one Seppo can be in town at a time; no duplicates will spawn.
- Town guards and barracks:
  - Towns spawn a small number of guard NPCs (blue-tinted “n” glyphs) who patrol around the gate, plaza, and roads instead of wandering randomly.
  - Many towns also place a Guard Barracks prefab near the plaza/gate; some guards sleep in barracks beds at night while others stay on duty.
- Outdoor ground tint: towns tint outdoor floors and roads by biome; road overlays are semi‑transparent so the biome tint remains visible.

Region Map (local tactical overlay)
- Open with G on a walkable overworld tile (or on RUINS tiles); M key is disabled. Movement respects region tile walkability: you cannot step onto WATER/RIVER/MOUNTAIN or non-walkable RUIN_WALL tiles.
- Looting: pressing G on a corpse or chest opens the loot panel (like in dungeons); dead animals show exactly what you looted via the panel. In ruins, corpses/chests also log detailed cause-of-death flavor (who/what killed them, wound, weapon/likely cause) before the loot or “nothing” lines.
- Neutral animals (deer/fox/boar) are rare:
  - At most one spawns in sufficiently wild areas; many tiles have none.
  - If animals were seen here previously, future visits re‑spawn only with a low chance (seeded).
  - Clearing animals marks the tile as cleared; future spawns are skipped.
- Blood decals placed in Region Map (ruins fights, animals, etc.) fade over time each turn, mirroring dungeon behavior so stains do not accumulate permanently.
- Fishing: if you stand next to WATER/RIVER, have a fishing pole, and press G, you can start a short fishing mini-game. Each attempt advances time and wears the pole; success yields fish or, rarely, other items. The mini-game has no on-screen Cancel button; use Escape to cancel.

Data-driven configuration
- Combined assets (strict): data/world_assets.json contains tiles and props and is required in strict mode.
  - tiles: structural and terrain entries (e.g., FLOOR, WALL, DOOR, STAIRS, WINDOW).
  - props: furniture/decor entries (e.g., lamp, bench, chest) with unified fields:
    - glyph, colors.fg
    - properties: walkable, blocksFOV, emitsLight
    - appearsIn, tags
    - light: castRadius, glowTiles, color (optional)
- Other JSON registries under data/:
  - data/entities/{items.json, enemies.json, npcs.json, consumables.json}
  - data/shops/shops.json, data/world/town.json
- Loader: data/loader.js loads and exposes GameData.*; logs a warning if world_assets.json is missing/invalid; tiles/props are not loaded in strict mode without it.
- file://: you can still open index.html directly; minimal defaults keep the game playable, but tiles/props require the combined assets file for full visuals.

Determinism and seeds
- RNG is centralized; apply seeds in the GOD panel (persisted to localStorage as SEED).
- With the same seed and context, generation and item rolls are repeatable.

Smoketest (optional)
- Orchestrator default: append ?smoketest=1 to the URL; add &dev=1 for diagnostics.
- Scenario filter: &scenarios=world,dungeon,inventory,combat,town,overlays,determinism (legacy style &smoke= also supported).
- Multiple runs: &smokecount=N.
- Legacy thin shim: &legacy=1 (orchestrator skips auto‑run; shim delegates to orchestrator).
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
  - Tip: bump meta[name="app-version"] in index.html (often aligned with package.json version) to force clearing saved states on deploy.

Key features at a glance
- Infinite, deterministic overworld with chunk streaming and fog-of-war.
- Single-floor dungeons with connected rooms, guaranteed stairs, and data-driven enemies.
- Interaction-first gameplay: bump-to-attack, G to loot/interact/enter/exit.
- HUD perf overlay: shows last turn and draw timings (ms) next to the clock for optimization visibility.
- Inventory/equipment:
  - Two-handed items occupy both hands; unequipping one removes both.
  - One-handed items auto-equip to the empty hand or can be equipped explicitly left/right.
  - Decay increases through combat; breakage is supported.
- Towns with shops and NPCs; Seppo spawns at most once at a time.
- Lighting from props:
  - Town: lamps and fireplaces emit light at night/dawn/dusk; small warm glow overlay.
  - Dungeon: wall torches spawn sparsely on walls, always emit light; subtle glow overlay.
- UI/UX:
  - FOV and LOS consistent; seen tiles dim when not visible.
  - Escape closes modals; movement is ignored while any modal is open.

Useful flags and persistence
- dev=1: enable DEV mode (extra logs); dev=0 disables.
- mirror=1|0: side log mirror on/off (persists in localStorage).
- Seed persists in localStorage SEED and is shown in the GOD panel.
- Version-based storage clearing: on each deploy, the app compares meta[name="app-version"] with the stored version. If changed, it clears saved town/dungeon/region state and resets in‑memory mirrors to guarantee a clean start (preferences like seed/toggles remain).

HUD visibility (dev toggles)
- Overworld HUD (biome + clock):
  - Toggle via GOD → Render → “Overworld HUD: On/Off”
  - Programmatic: set window.SHOW_OVERWORLD_HUD = true|false (persists to localStorage "SHOW_OVERWORLD_HUD")
- Region Map HUD (title + clock + animals status):
  - Toggle via GOD → Render → “Region HUD: On/Off”
  - Programmatic: set window.SHOW_REGION_HUD = true|false (persists to localStorage "SHOW_REGION_HUD")
- Encounter HUD (biome + clock):
  - Toggle via GOD → Render → “Encounter HUD: On/Off”
  - Programmatic: set window.SHOW_ENCOUNTER_HUD = true|false (persists to localStorage "SHOW_ENCOUNTER_HUD")

Logging system (UI + Dev API)
- Overview
  - In-DOM log overlay with optional right-side mirror.
  - Severity filtering and category filtering at runtime (persisted to localStorage).
  - Structured payloads with inline “details” toggles.
  - Export logs to text or JSON; clear overlay/history; dedup repeated lines.

- UI controls (GOD panel → Logs)
  - Side Log toggle: shows/hides right-side mirror.
  - Level selector: info, notice, warn, error, fatal, all.
    - Strict info: only player-facing info-style messages (info, good, block, flavor) are shown at “info”.
    - “all” allows everything regardless of severity threshold (categories still apply).
  - Reset Logs: restores default threshold and category set.
  - Clear Logs: clears on-screen overlay and in-memory history.
  - Download Logs: saves a text file; each line: [ISO timestamp] [level] [category] message {JSON details if present}.
  - Download JSON: saves structured history with message, type, category, timestamp, details, and dedup count.
  - Categories grid: enable/disable common categories (persisted). Includes General, Prefabs, WorldGen, TownGen, TownState, DungeonState, Encounter, Palette, Render, Shop, AI, Combat, Items, Services, Smoketest, RNG, Occupancy, Movement, Region.
  - Trace toggles: granular tracing for Movement, Encounters, Shops (also respected by DEV mode).
    - LocalStorage keys: LOG_TRACE_MOVEMENT, LOG_TRACE_ENCOUNTERS, LOG_TRACE_SHOPS set to “1” to enable.

- Severity, synonyms, and styles (ui/style.css)
  - info: neutral light grey (#cbd5e1)
  - notice: olive (#718918)
  - warn: amber (#eab308)
  - error/bad: orange (#ff9e64) with subtle glow
  - fatal/crit/death: bright red (#ff4c4c) with stronger glow
  - good: green (var(--success))
  - block: accent blue (var(--accent))
  - flavor: teal (#b4f9f8)
  - Combat side-aware coloring: player hits green, enemy hits amber; player crit green glow, enemy crit red glow.
  - Status tones: bleed (red), injury flavor (orange italic).
  - Info-level category accents: subtle left border per category (e.g., WorldGen teal, Town green, Dungeon purple, Encounter magenta, Combat red tint, Shop gold, Prefabs orange, Palette blue).

- Category inference
  - Heuristics guess categories from message prefixes/keywords (e.g., [WorldGen], [Prefabs], “DungeonState.applyState…”).
  - Messages without explicit prefixes fall under General.

- Developer APIs
  - Emit:
    - window.Logger.log(message, type = "info", details?)
      - details is optional (object or string); renders a “details” toggle when present.
    - window.Logger.logOnce(key, message, type = "info", details?)
    - window.Logger.warnOnce(key, message, details?)
  - History:
    - window.Logger.getHistory() → array of structured entries { ts, type, cat, msg, details, count }.
    - window.Logger.clear() → clears overlay and history.
    - window.Logger.download(filename = "game_logs.txt")
    - window.Logger.downloadJSON(filename = "game_logs.json")
  - Runtime config (filters):
    - window.LogConfig.setThreshold(name) → "info" | "notice" | "warn" | "error" | "fatal" | "all"
    - window.LogConfig.getThresholdName()
    - window.LogConfig.setCategory(id, enabled)
    - window.LogConfig.getCategories() → [{ id, enabled }]
    - window.LogConfig.reset()
  - Examples (in DevTools):
    - window.LogConfig.setThreshold('warn')          // warnings and above
    - window.LogConfig.setCategory('palette', false) // mute palette logs
    - window.Logger.log('[Shop] Restock', 'notice', { category: 'Shop', rows: 12 })

- Instrumented emitters (examples)
  - World expansion (category WorldGen): side expanded, tiles added, origin shifts.
  - Occupancy rebuild (category Occupancy): counts of enemies/NPCs/props and grid dimensions.
  - Encounter tracing (category Encounter): cooldown, chance computations, template selection (gated).
  - Movement tracing (category Movement, world mode): blocked reasons and tile details (gated).
  - Shop lifecycle (category Shop): phase changes and restock summaries; row details when tracing enabled.
  - Prefab/Town/Dungeon state notices and errors under their respective categories.

- Gameplay-specific logging refinements
  - Weapon/equipment breakage now logs at info level (neutral styling) instead of error/bad.
  - Combat “crit” messages pass the threshold at info-level (styled red for distinction).

Notes
- Most runtime modules log via ctx.log(...), which the engine routes to window.Logger.log(...) when available.
- DEV mode enables some additional traces automatically; toggles are persisted and can be switched in the GOD panel.

Project layout and docs
- core/ — engine, loop, ctx, input, modes — see core/README.md
- world/ — overworld generation and walkability — see world/README.md
- dungeon/ — generation, items, state persistence — see dungeon/README.md
- entities/ — items and enemies adapters over JSON — see entities/README.md
- ui/ — logger, renderer, tileset — see ui/README.md
- combat/ — combat loop, status effects, decay — see combat/README.md
- services/ — RNG, time, shops, encounters — see services/README.md
- utils/ — shared helpers (bounds/grid/rng/etc.) — see utils/README.md
- ai/ — NPC behavior, town scheduling, pathfinding — see ai/README.md
- worldgen/ — town/roads/prefabs — see worldgen/README.md
- region_map/ — local tactical overlay runtime — see region_map/README.md
- smoketest/ — modular test runner (helpers, capabilities, reporting, runner, scenarios) + legacy thin shim — see smoketest/README.md
- data/ — JSON registries and loader — see data/docs/README.md
- scripts/ — Node helper scripts — see scripts/README.md
- tools/ — developer tools (prefab editor) — see tools/README.md

Docs viewer
- Access via the “Docs” button in the HUD; opens /docs/index.html.
- Click a title to expand/collapse its contents inline. A caret (▶) indicates state and rotates when expanded.
- Hover over a title to see a brief description of the document.
- Filter by title and use Expand All / Collapse All to manage sections quickly.
- Fresh content: the viewer fetches the latest file content when the Docs page opens and when you expand a title (no periodic auto-refresh). Requests use cache-busting with no-cache to avoid stale data.
- “Open raw” links open the source file directly in a new tab for copy/paste or download.

Development
- Lint: npx eslint .
- Format: npx prettier -c . / -w .
- See VERSIONS.md for a concise changelog and recent improvements.

CI and Validation
- Validation (GOD → Run Validation): runs data checks for items, enemies, shops, tiles/props, palette, encounters.
  - Download JSON: use “Download Validation” to export validation_report.json (warnings/notices + per-category counts).
- Smoketest (browser-run):
  - Auto-run: open /index.html?smoketest=1 to run the orchestrator runner.
  - Filter: &scenarios=world,dungeon,overlays (reduced set for CI); &smokecount=N for multi-run.
  - Outputs:
    - PASS/FAIL tokens in DOM (#smoke-pass-token) and localStorage ('smoke-pass-token').
    - JSON report in DOM (#smoke-json-token) and localStorage ('smoke-json-token').
    - Download buttons in the GOD panel (Report JSON, Summary TXT, Checklist TXT).
  - Tip: for headless CI, launch a headless browser (Playwright/Puppeteer) against the deployed URL with ?smoketest=1&scenarios=world,dungeon,overlays, wait for #smoke-pass-token, and download #smoke-json-token payload.

Roadmap (Upcoming Phases)
- Phase 4 — Theming completeness and validation
  - Prefab Editor theming: drive grid background/lines and hint/status panels from palette overlays (panelBg/panelBorder/panelShadow), use overlays.grid for editor grid lines.
  - UI color sweep (cosmetic): expose remaining button/text colors behind palette keys (e.g., overlays.panelText, overlays.buttonBg, overlays.buttonBorder, overlays.buttonText) for Quest Board, Confirm modal, Sleep panel, and smoketest banner.
  - Alpha range checks: smoketest warns when numeric alpha keys nightA/duskA/dawnA/vignetteA and glowStartA/glowMidA/glowEndA are outside [0,1].
  - Props/tile coverage validation: smoketest flags props missing color sources (JSON/tiles/palette) and tiles with missing mode coverage; add minimal stubs or palette fallbacks as needed.
  - Palette presets: add high-contrast/retro/warm/cool to data/world/palettes.json; GOD dropdown auto-populates from the manifest.
  - Documentation: expand palette_schema.md and palette_theming.md with the new keys and editor theming notes.

- Phase 5 — Stability, validation, and CI
  - JSON schema validation: add lightweight validators for critical registries (tiles/props, items/enemies/materials/recipes/palette) with clear in-game warnings.
  - CI smoketest: run a reduced scenario set on every build (world/town/dungeon/inventory/overlays) and fail the pipeline on hard errors or missing data.
  - Crash-free policy: unify module guards and remove legacy try/catch duplications in hot paths; prefer Capabilities.safeCall for optional modules.

- Phase 6 — Optional gameplay and UX expansions
  - Multi-floor dungeons and portal variants; scale ED and loot appropriately.
  - Quest board extensions: multi-step quests, rewards from palette-driven POI markers.
  - Overworld hazards/biome effects (swamp slow, snow visibility); palette-configurable.
  - Merchant/encounter improvements: shopkeeper themes, Seppo inventory in encounters.
  - Theme packs: curated palettes in palettes.json for quick switching via GOD.

To proceed on any phase, say “continue” and specify which items you want implemented next. Spot-check guides and deployments will follow each step.

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

Troubleshooting
- Infinite world generator required: the game expects InfiniteGen to be available. If missing or not initialized, startup will log an error and fail. Use the included server (node server.js) or Vite dev server to ensure modules and JSON assets load.
- Seeds: configure via the GOD panel (“Apply Seed” / “Reroll Seed”). The current seed is shown and persists to localStorage (SEED) for deterministic runs.
- Modal gating: movement and actions are blocked while a modal is open (Inventory, Loot, GOD, Shop, Smoke, Help, Region Map, Confirm). Press Escape to close the top-most modal; Confirm dialogs block all keys except Escape.