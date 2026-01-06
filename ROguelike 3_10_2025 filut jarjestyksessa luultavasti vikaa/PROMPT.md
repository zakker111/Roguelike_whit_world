# PROMPT.md — AI Coding Guidelines and Project Prompt

This document is a persistent prompt for AI-assisted development on this project.  
Any time the AI edits code here, it should follow these rules.

---

## 1. High-Level Principles

- **Match the project’s style and architecture.**
  - Follow existing module layout, naming, and directory structure.
  - Extend established patterns instead of inventing new ones.

- **Prefer modular, composable code.**
  - Split big files into focused modules when it makes sense.
  - Extract reusable helpers; avoid copy-paste logic.

- **Be explicit, deterministic, and data-driven.**
  - Use `ctx.rng` or RNG utilities from `utils/access.js` — never `Math.random` in core gameplay.
  - Prefer JSON-driven data for content (NPC types, enemies, items, encounters, town config, etc.) so it’s easy to edit by hand in one place.
  - Avoid hidden behavior and silent failures.

- **Code should be easy to read.**
  - Use descriptive names for important concepts (`isCorpseCleaner`, `_homePlan`, `nearestFreeAdjacent`, etc.).
  - Keep functions small and focused; use helpers for complex steps.
  - Avoid clever but confusing tricks; prefer clarity over micro-optimizations.

- **Document the “why”, not just the “what”.**
  - Use JSDoc-style headers and comments where they add real information.
  - In responses to the user, say what you changed, why, and how you tested it.

- **Test changes in-game.**
  - Use smoketests and manual testing (towns, dungeons, Region Map, encounters).
  - Don’t claim something is “fixed” without describing the testing path.

---

## 2. Module Boundaries and Where to Put Code

When adding or changing code, first decide where it belongs:

- `ai/` — **Behavior**:
  - How NPCs and enemies behave (town AI, combat AI).
  - Examples: `town_runtime`, `town_population`, `town_combat`, `town_inn_upstairs`, `town_helpers`, `town_diagnostics`.

- `core/` — **Engine / runtime orchestration**:
  - Game loop, mode switching, FOV, StateSync, facades (`perf`, `rng`, `log`, `config`, etc.).
  - Handles how the game runs, not what content exists.

- `ui/` — **Rendering and UI**:
  - HUD, modals, GOD panel, renderers (`render_town`, `render_dungeon`, `render_overworld`, etc.).
  - No game rules here; just display and input.

- `data/` — **Content**:
  - JSON definitions: enemies, NPC archetypes, items, tools, consumables, encounters, palettes, town config, prefabs, etc.

- `worldgen/` — **Generation**:
  - Map/town generation, prefab stamping, roads, building placement.

**Rule of thumb:**

- If it’s “what the player sees and clicks” → `ui/`.
- If it’s “how the game runs” → `core/`.
- If it’s “what exists in the world” → `data/` (and maybe `worldgen/`).
- If it’s “how actors behave” → `ai/`.

---

## 3. Data-First, Code-Second Design

**Goal:** Make the game easy to edit and mod, especially via JSON.

### 3.1. Use JSON for content

Whenever you add or change content, ask: *Is this content or behavior?*

**Content (put in JSON under `data/`):**

- Enemy / NPC archetypes:
  - ids, names, glyphs, colors, stats, tiers, base weights, faction, roles.
- Items, tools, consumables:
  - names, slots, stat changes, decay, heal, pricing hints.
- Encounters:
  - templates, biome/time/moon constraints, enemy groups, difficulty bands, weights.
- Town / world config:
  - building density, population targets, role weights, inn/castle sizing, roads/prefabs.
- Flavor text:
  - NPC lines, prop messages, death descriptions.

**Behavior (keep in JS):**

- AI logic (`townNPCsAct`, combat routines, pathfinding, scheduling).
- Engine (modes, FOV, StateSync, RNG wiring).
- UI rendering and panel behavior.

JS should *consume* `GameData` (from JSON) and implement mechanics. JSON should define “what exists” and “with what stats”.

### 3.2. Use roles/tags for behavior opt-in

For modding and clean behavior:

- Prefer a `roles` or `tags` array in JSON over adding new booleans everywhere.

  Example:

  ```json
  {
    "id": "caretaker",
    "name": "Caretaker",
    "roles": ["corpse_cleaner"],
    "glyph": "c",
    "color": "#aaaaaa"
  }
  ```

- AI code can check `n.roles` to decide:
  - Is this guard? Is this corpse cleaner? Is this shopkeeper, etc.?

This makes it easy to create new NPC types by editing JSON only, without changing JS.

---

## 4. Coding Style for Readability

When writing or refactoring code:

- **Descriptive naming:**
  - Use names that clearly describe purpose (`ensureHomePlan`, `routeIntoBuilding`, `initPathBudget`, `isCorpseCleaner`).
  - Avoid cryptic one-letter names in core logic.

- **Small, focused helpers:**
  - If a function grows large or does several things, split into helpers.
  - In big loops (like `townNPCsAct`), keep per-role blocks small and understandable.

- **Clear control flow:**
  - Prefer early returns over deep nesting.
  - Use straightforward `if/else` and small helper functions instead of dense inline logic.

- **Comments and JSDoc:**
  - Module-level JSDoc: explain what the module does and which other modules it depends on.
  - Function-level JSDoc: for exported or complex helpers.
  - Avoid comments that just restate code.

---

## 5. JSON Usage Guidelines

When adding new content:

1. **Pick the right JSON file:**
   - Enemies → `data/entities/enemies.json`
   - Items/equipment → `data/entities/items.json`
   - Tools → `data/entities/tools.json`
   - Consumables/potions → `data/entities/consumables.json`
   - Encounters → `data/encounters/encounters.json`
   - Town/world config → `data/world/town.json`, `data/world/world_*.json`

2. **Wire it via GameData:**
   - Use `getGameData(ctx)` and `GameData.*` to access these definitions.
   - Do not hard-code new enemies/items inline in AI or combat code if they can live in JSON.

3. **Think about what should stay in code:**
   - Complex behavior/rules stay in JS.
   - Numbers and “content knobs” (HP, damage, weights, thresholds) should lean toward JSON.

---

## 6. Testing and Smoketests

For any change that affects behavior, AI, or engine:

- **Run smoketests where possible:**
  - Towns: population, schedules, inn usage, guards, cleaners.
  - Dungeons: movement, combat, loot, stairs, exits.
  - Region Map: movement, ruins, encounters, fishing.

- **Manual test recipe:**
  - Describe in the response:
    - “To test: do X, then Y, expected behavior is Z.”

- **Be honest about certainty:**
  - Use “this should address the issue; tested by …” unless it’s heavily verified.

---

## 7. Logging, Debug, and GOD Tools

- Use `ctx.log` with appropriate levels (`info`, `good`, `bad`, `notice`, `flavor`).
- Keep GOD tools explicit. Don’t hide gameplay changes behind silent debug flags.
- Debug features (e.g. path overlays):
  - Controlled by explicit flags (`DEBUG_TOWN_HOME_PATHS`, etc.).
  - Default off, minimal overhead when disabled.

---

## 8. How the AI Should “Think” While Coding

Before and during coding:

1. **Locate the relevant code and data.**
   - Use file navigation to find existing modules and JSON.

2. **Check for existing patterns & helpers.**
   - Prefer reusing helpers from `town_helpers`, `town_population`, `town_combat`, etc.

3. **Plan the change briefly:**
   - Which files?
   - Any new helpers or modules?
   - Any new JSON or `GameData` entries?

4. **Implement minimal, clear changes first.**
   - Don’t over-abstract on first pass.
   - Keep behavior changes explicit and understandable.

5. **Summarize clearly in the response:**
   - What was implemented.
   - Why that design was chosen.
   - How to test it (steps and what to look for).

---

## 9. Performance in Hot Paths

Some parts of the code run every turn or every frame (e.g. `townNPCsAct`, FOV, renderers). When editing these:

- Avoid heavy per-tick allocations:
  - Don’t create large arrays/Maps/Sets inside inner loops if you can reuse or precompute.
  - Prefer reusing small scratch structures where reasonable.
- Keep complexity under control:
  - New logic inside hot loops should be roughly O(n) in NPCs or tiles, not nested in a way that explodes.
- Make features cheap when disabled:
  - Gate expensive debug logic behind flags (e.g. `if (!DEBUG_FLAG) return;`) early.
- If you must add heavier work:
  - Consider budgeting or throttling (like pathfinding budgets, stride-based updates).
  - Mention any performance considerations in your explanation.

---

## 10. Versioning, Docs, and Housekeeping

To keep the project’s history and docs useful:

- **VERSIONS.md:**
  - When you make a user-visible change (new feature, significant bug fix), add a short entry under the latest version or a new version tag, following the existing style.
- **FEATURES.md:**
  - Keep this file in sync with the current, stable feature set and controls.
  - When you add or materially change a player-facing feature, update the relevant section (e.g. Controls, Towns, Dungeons, GOD tools) and move items out of the “Experimental / WIP” section once they are reliable.
- **BUGS.md:**
  - For known issues that are not immediately fixed, add a brief bug description and repro steps.
- **TODO.md:**
  - For future work or ideas, add items here instead of leaving many inline `TODO` comments in hot code.
- **Style tools:**
  - Respect existing ESLint/Prettier settings and formatting patterns; don’t introduce ad-hoc style changes.

---

This PROMPT is the “contract” for how to write, refactor, and extend code in this repo with AI assistance: **data-first, modular, readable, JSON-friendly, performance-aware, and well-tested.**