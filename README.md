# Roguelike with World

A browser-based roguelike with a data-driven content model featuring procedural world generation, towns, dungeons, and encounters.

## 🎮 Play Online

**[Play in Browser](https://zakker111.github.io/Roguelike_whit_world/game/)** ← Click here to play!

Or open `game/index.html` locally in your browser.

## About

Another roguelike implementation with an improved file structure and comprehensive world-building systems.

### Key Features
- **Infinite Procedural World:** Deterministic overworld generation with chunk streaming and fog-of-war
- **Single-Floor Dungeons:** Connected room layouts with enemy scaling and persistent state
- **Towns & NPCs:** Shops, schedules, residents, and dynamic interactions
- **Combat System:** Turn-based with status effects, equipment decay, and difficulty scaling
- **Encounters:** Random overworld encounters with multi-faction battles
- **Followers:** Hire NPCs to join your party with their own inventory and progression
- **Region Map:** Local tactical overlay for exploration and ruins
- **Deterministic Seeds:** Repeatable runs with the same seed

## 🚀 Quick Start

### Play Online
Simply visit the deployed version (link above) and start playing!

### Local Development

#### Option A: Static Server
```bash
node server.js
# Open http://localhost:8080/?dev=1
```

#### Option B: With Vite (ESM bundling)
```bash
npm install
npm run dev        # Start dev server
npm run build      # Build for production
npm run preview    # Preview built version
```

#### Option C: Direct File
Open `game/index.html` directly in your browser (limited JSON support).

## 📖 Controls

| Action | Key |
|--------|-----|
| Move | Arrow Keys or Numpad |
| Interact / Loot / Enter | G |
| Inventory | I |
| Local Region Map | G (on walkable overworld tiles) |
| GOD Panel (Debug) | P |
| Help | F1 or Help button |
| Brace (Dungeon) | B |
| Wait | Numpad 5 |

## 📚 Documentation

- **[Authoring Guide](game/docs/data_driven_authoring.md)** — Add content to the game
- **[Phase Workflow](game/docs/phase_workflow.md)** — Development methodology
- **[Smoketest Guide](game/smoketest/runner/README.md)** — Testing framework
- **[In-Game Docs](game/docs/index.html)** — Access via the "Docs" button in the HUD

## 🏗️ Project Structure

```
game/
├── core/           — Engine, loop, input, modes
├── world/          — Overworld generation
├── dungeon/        — Dungeon generation and persistence
├── entities/       — Items, enemies, NPCs
├── ui/             — Rendering, logger, tileset
├── combat/         — Combat mechanics and status effects
├── services/       — RNG, time, shops, encounters
├── ai/             — NPC behavior and pathfinding
├── worldgen/       — Town and prefab generation
├── region_map/     — Local tactical overlay
├── smoketest/      — Test framework
├── data/           — JSON registries (items, enemies, shops, etc.)
├── docs/           — Developer documentation
├── tools/          — Editor tools
└── index.html      — Entry point
```

## 🛠️ Development

**Lint:**
```bash
npx eslint .
```

**Format:**
```bash
npx prettier -c .    # Check
npx prettier -w .    # Write
```

**Smoketest:**
```bash
open "http://localhost:8080/game/?smoketest=1&dev=1"
# or
npm run acceptance:phase6  # Headless (requires Playwright)
```

## 📊 Language Composition

- JavaScript: 98%
- HTML: 1.4%
- Other: 0.6%

## 📝 License

Check LICENSE file for details (if present).

## 🐛 Troubleshooting

- **JSON not loading:** Use the static server (`node server.js`) instead of file://
- **Seed issues:** Configure via GOD panel (P key) → "Apply Seed"
- **Modal stuck:** Press Escape to close

## 🔗 Links

- **[Latest Changelog](game/VERSIONS.md)**
- **[GitHub Repository](https://github.com/zakker111/Roguelike_whit_world)**

---

*Last updated: 2026-05-05*
