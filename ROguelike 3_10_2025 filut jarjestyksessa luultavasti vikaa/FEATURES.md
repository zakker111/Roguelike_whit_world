# FEATURES

High-level snapshot of what the game currently supports and what the player can do.

- For **history / detailed change logs**, see `VERSIONS.md`.
- For **planned work**, see `TODO.md`.
- For **known issues and unstable systems**, see `BUGS.md`.

This file should describe the **current state**, not the future; update it whenever we add or significantly change features.

---

## 1. Controls & Keybindings

### 1.1 Movement and Waiting

- Move:
  - Arrow keys: `↑`, `↓`, `←`, `→` (4-directional).
  - Numpad:
    - `Numpad8` (up), `Numpad2` (down), `Numpad4` (left), `Numpad6` (right).
    - Diagonals: `Numpad7`, `Numpad9`, `Numpad1`, `Numpad3`.
- Wait / pass a turn:
  - `Numpad5`.

### 1.2 Interaction and Actions

- Interact / loot / use context action:
  - `G`
    - In world/town/dungeon:
      - Talk to NPCs.
      - Open doors.
      - Enter/exit towns and dungeons when standing on the relevant tile (town gate, dungeon entrance/exit).
      - Interact with props (benches, beds, campfires, chests, etc.).
      - Open loot when standing on items/corpses.
- Defensive stance (dungeon combat):
  - `B`
    - Brace for one turn, increasing block chance for this turn.

### 1.3 Inventory, Character, and Help

- Inventory:
  - `I` — open inventory panel.
  - `I` or `Esc` — close inventory when open.
- Character sheet:
  - `C` — open/close character sheet panel.
- Help / controls overlay:
  - `F1` — toggle in-game help/controls panel.
  - While help is open:
    - `Esc` — closes help panel; other keys are blocked.

### 1.4 GOD Panel and Debug

- GOD panel:
  - `P` — open GOD panel (debug/developer controls).
  - While GOD is open:
    - `Esc` — closes GOD panel.
    - Other keys are consumed and do not affect gameplay.
- FOV adjust:
  - Decrease FOV:
    - `[`, `-`, `NumpadSubtract` (depending on keyboard layout).
  - Increase FOV:
    - `]`, `=`, `NumpadAdd`.

### 1.5 Region Map and Exits

- Region Map:
  - No direct key; **M is intentionally disabled**.
  - Open the Region Map by pressing `G` on:
    - Suitable overworld tiles (walkable terrain).
    - RUINS tiles (for ruins/region-map encounters).
- Exiting towns and dungeons:
  - Stand on the gate tile (town) or exit stairs (dungeon) and press `G`.

### 1.6 Modals and Menus

- Modal priority:
  - If a modal is open, `Esc` closes the top-most one and blocks other gameplay keys.
  - Modal order includes:
    - GOD panel.
    - Shop UI.
    - Smoketest UI (if open).
    - Sleep panel (inn beds).
    - Character sheet.
    - Help panel.
    - Inventory.
    - Confirm dialog.
- Loot:
  - `G` or most other keys will close loot when it is open (after applying action).

### 1.7 Death Screen

- Restart after death:
  - `R` — restart run (Enter is intentionally disabled).

> Implementation reference: `core/input.js`.

---

## 2. Run Structure & Progression

### 2.1 Basic run model

- Per-run progression:
  - You start with a fixed or lightly randomized character and inventory.
  - You explore the overworld, towns, dungeons, ruins, and encounters.
  - Death is permanent for a run (no in-run resurrection UI; restart only).
- No meta-progression (for now):
  - After death, you start a new run; there are no permanent unlocks or trait trees that persist between runs (beyond what’s explicitly added in data).

### 2.2 Difficulty and scaling

- Difficulty scaling factors:
  - Overworld position and biome.
  - Dungeon depth (floor / level).
  - Tower floor index and tower-level settings.
  - Encounter-specific difficulty parameters (e.g., Full Moon ritual).
- “Spikes” to be aware of:
  - Multi-floor towers with bosses.
  - Special encounters (e.g., Full Moon rituals) that are intentionally harder than routine fights.

---

## 3. Core Roguelike Gameplay

### 3.1 Dungeon exploration

- Procedural dungeon generation:
  - Rooms and corridors with guaranteed connectivity.
  - Entrance/exit stairs for returning to the overworld.
  - Tiles: walls, floors, doors, stairs, decor props.
- Fog of war and LOS:
  - Unseen tiles hidden.
  - Seen-but-not-currently-visible tiles dimmed.
  - Same LOS logic used for player and enemies (subject to bugs noted in `BUGS.md`).

### 3.2 Combat and status

- Turn-based combat:
  - Bump-to-attack.
  - Critical hits and blocks.
  - Damage based on attacker’s stats, defender’s defense, and equipment.
- Status effects:
  - Daze: may cause the player to lose actions.
  - Bleed: ongoing HP loss per turn.
  - Burn: ongoing HP loss per turn.
- Logging:
  - Status applications and ticks (bleed, burn, dazed, etc.) log at **info** level so they are always visible in normal play.

### 3.3 Items, inventory, and equipment

- Inventory:
  - Carry multiple items; use potions and consumables.
- Equipment:
  - Weapons (one-handed, two-handed).
  - Armor and other defensive gear.
  - Equipment decay: wear/tear over time and use.
- Named/cursed items:
  - Example: Seppo’s True Blade:
    - Strong two-handed named sword with a rare “love” effect that can immobilize enemies.
    - Cursed behavior: once equipped, the blade cannot be unequipped or replaced until broken (decay).
    - Specific price behavior in Seppo’s shop.

---

## 4. Overworld and Biomes

### 4.1 World map

- Large overworld:
  - Multiple biomes:
    - Grassland, forest, desert, swamp, snow, mountain ridges.
  - Rivers and water:
    - Non-walkable except at bridges/fords or special tiles.
- Walkability rules:
  - Water and river tiles are typically non-walkable.
  - Mountains usually non-walkable except where worldgen carves passes.
  - Bridges/fords across rivers allow traversal.

### 4.2 Points of interest

- Towns and castles:
  - Overworld markers for settlements.
- Dungeons:
  - Standard dungeon entrances (DUNGEON tiles).
- Ruins:
  - RUINS tiles leading to region/ruins encounter maps.
- Towers:
  - Multi-floor dungeons (bandit towers).
- Caravans:
  - Mobile entities traveling between towns/castles.
  - Interact via encounters and town caravan stalls.

### 4.3 HUD and minimap

- Minimap:
  - Shows the surrounding overworld with biomes, POIs, and player location.
- HUD elements:
  - Current biome name.
  - Time-of-day (HH:MM).
  - Moon phase name.

---

## 5. Time, Day/Night, and Moon Phases

- Global time:
  - Turn-based; each turn advances time by a fixed number of minutes.
  - Day segments:
    - Dawn, day, dusk, night.
- Visual tints:
  - Overworld and towns tinted according to time-of-day.
  - Nights darkest; Full Moon nights somewhat brighter; New Moon nights darker.
- Moon phase system:
  - 8-phase cycle (New, Waxing/Waning Crescent, First/Last Quarter, Gibbous, Full).
  - Moon phase shown in HUD.
- Gameplay influence:
  - Night brightness depends on moon phase.
  - Encounter selection:
    - Some encounters more likely during specific phases (e.g., Full Moon ritual, New Moon bandit bias).

---

## 6. Towns and Civilians

### 6.1 Town generation and structure

- Structured town layouts:
  - Walled perimeter with a proper gate aligned to the overworld entry point.
  - Main road from gate to central plaza.
  - Secondary road grid forming blocks.
- Buildings:
  - Houses, shops, tavern/inn, and other special buildings.
  - Interiors:
    - Furnished with fireplaces, beds, tables, chairs, chests, and decor.

### 6.2 Town NPCs and routines

- NPC roles:
  - Residents with assigned homes/beds.
  - Shopkeepers assigned to shops.
  - Tavern/inn staff (barkeepers, innkeepers).
  - Guards and special roles (e.g., corpse cleaners).
  - Pets and minor flavor NPCs.
- Daily schedules:
  - Residents:
    - Morning/evening/night: at or near home.
    - Day: work, plaza, or tavern (depending on role).
  - Shopkeepers:
    - At shop during opening hours.
    - Home outside work hours.
  - Corpse cleaners:
    - Patrol; remove corpses and move on.
- Pathfinding:
  - NPCs navigate around obstacles and other NPCs.
  - Home routing and inn upstairs routing:
    - Dedicated modules handle pathing into buildings and to beds/seats.

### 6.3 Town interactions

- Shops:
  - Buy/sell UI with currency.
  - Shops have opening hours; closed at night with appropriate messages.
- Tavern/Inn:
  - Player can rest (sleep) to heal and advance time.
  - Inn upstairs beds used by NPCs and sometimes player interactions.
- Town gate and transitions:
  - Press `G` at gate tile to exit to overworld.
- General interactions:
  - Talking to NPCs, inspecting props, using benches/beds, etc.

---

## 7. Dungeons, Towers, Ruins, and Encounters

### 7.1 Standard dungeons

- Entry:
  - Enter from overworld DUNGEON tiles via `G`.
- Persistence:
  - Each entrance has a persistent dungeon:
    - Map, seen/visible, enemies, corpses, props, decals.
  - Re-entering restores state as you left it.
- Exit:
  - From floor 1:
    - Stand on exit stairs and press `G` to return to the overworld at the dungeon’s entrance tile.

### 7.2 Tower dungeons (bandit towers)

- Multi-floor towers:
  - Managed via `towerRun` metadata.
  - Floors assembled from JSON room prefabs:
    - Barracks, storage rooms, prison cells, cross halls, boss arenas, etc.
- Per-floor metadata:
  - Map, seen/visible, enemies, corpses, decals, dungeonProps, chest spots.
  - `exitToWorldPos`, `stairsUpPos`, `stairsDownPos`.
- Enemies and bosses:
  - Floors filled with bandit-themed enemies.
  - Difficulty scaled by floor and configuration.
  - Final floor has a dedicated boss from theme configuration (e.g., bandit captain).
- Chests and loot:
  - Lower floors: occasional chests based on JSON chest spots and configuration.
  - Top floor: guaranteed high-tier boss chest near boss/arena.
- Captives and allies:
  - CAPTIVE props placed in certain rooms.
  - Player can free captives (G):
    - Spawns an allied guard who fights bandits but never attacks player.
    - Allies are saved with dungeon state and towerRun.

### 7.3 Ruins and Region Map

- Ruins:
  - Overworld RUINS tiles lead to region maps or special encounters.
- Region Map:
  - Larger-scale tactical map:
    - Wildlife and creature spawns.
    - Specific encounter layouts.
  - Connected back to overworld via exits and state sync.

### 7.4 Encounters

- Encounter templates:
  - Defined in JSON with constraints:
    - Biome, time-of-day, moon phase, global share, difficulty.
  - Examples:
    - Forest ambushes.
    - Bandit camps.
    - Caravan-related encounters.
    - Full Moon ritual encounters with moon wraiths and enhanced undead.
- Triggering:
  - Attempted when moving in certain overworld tiles, based on probabilities and constraints.
  - Can override normal encounter flow (e.g., Full Moon ritual with bump to difficulty).

---

## 8. Caravans and Shops

- Overworld caravans:
  - Travel between settlements.
  - Affect encounters and town presence.
- Town caravan stalls:
  - When a caravan is present, a caravan stall prefab may be placed near the plaza.
  - Placement logic:
    - Avoid blocking the gate.
    - Ensure stall fits on FLOOR/ROAD tiles.
  - Signage:
    - Deduplicated so the stall has a single Caravan sign.

- Shops:
  - Stock items based on JSON-defined shop pools.
  - Pricing and rarity logic (including special-cased items like Seppo’s True Blade).
  - Shop UI allows buying and selling items with gold.

---

## 9. UI, UX, and Accessibility

- HUD:
  - Player status (HP, often status effects via log).
  - Biome name, time-of-day, moon phase.
- Minimap:
  - Overworld minimap showing terrain and POIs.
- Logs:
  - Message log with severity levels; info-level used for most status/combat feedback.
- Help:
  - `F1` brings up a help/controls overlay.
- FOV controls:
  - Keyboard-based FOV radius adjustment (dev and player-facing).

(Additional accessibility features like colorblind-friendly palettes can be added and documented here when implemented.)

---

## 10. GOD Panel and Developer Tools (Dev-only)

These are primarily for debugging and development, not normal gameplay.

### 10.1 GOD panel sections

- GOD controls are grouped into sections:
  - Quick Actions (heal, invulnerability, teleport, new game).
  - World & Encounters (FOV, encounter controls, region map helpers).
  - Render & HUD (layers, overlays).
  - Town Debug (home routing, inn/plaza diagnostics).
  - Combat & Status (apply status, always crit, etc.).
  - Logs & Tracing (log categories, download logs, fallback logs).
  - RNG & Theme (seed control, palette selection).
  - Tools & Analysis (run analyses/validators).
  - Smoke Tests (run smoketest scenarios).

### 10.2 Teleport tools

- Teleport destination dropdown:
  - Nearest tower.
  - Nearest town/castle.
  - Nearest dungeon.
  - Nearest ruins.
  - Nearest castle.
  - Nearest mountain dungeon (experimental, affected by mountain-pass issues).
- Teleports delegate to core game APIs and worldgen/POI data.

### 10.3 Diagnostics

- Logging / fallback logging:
  - Centralized fallback logger for robust behavior when primary facilities are missing.
- Smoke tests:
  - Automated smoketest runner to exercise core flows (entry/exit, movement, basic combat, etc.).

---

## 11. Persistence & Saving

### 11.1 What is persisted

- Player:
  - Stats, HP, inventory, equipped items.
- Towns:
  - Layout, props, shops and inventories, NPC positions and some state.
- Dungeons:
  - For each overworld entrance:
    - Map, seen/visible arrays.
    - Enemies and their state.
    - Corpses, decals.
    - Props (campfires, captives, furniture).
- Towers:
  - Multi-floor state via towerRun:
    - Per-floor map, props, enemies, chests, etc.

### 11.2 Mode transitions

- Town ↔ overworld:
  - `worldReturnPos` and `townExitAt` used to track entry/exit.
  - Fog-of-war for town and world saved/restored.
- Dungeon ↔ overworld:
  - `worldReturnPos` and `dungeonExitAt` anchor transitions.
  - Dungeons keyed by world coordinates of entrance.

### 11.3 Non-persistent / dev-only

- GOD tools:
  - Some GOD actions may not persist across reloads and are meant for testing.
- Future Arena mode:
  - Intended to be non-persistent or clearly flagged as such (see Experimental / WIP).

---

## 12. Experimental / WIP Features

These exist partially in code or design but are **known unstable** or not yet implemented. See `TODO.md` and `BUGS.md` for full details.

### 12.1 Mountain-pass dungeons (A/B pairs)

- Intent:
  - Dungeons biased to spawn near mountain edges, linked across ridges:
    - Enter A, use pass stairs, appear in B across the mountains, and vice versa.
- Current status:
  - Several iterations in `core/dungeon/transitions.js`.
  - Behavior is **explicitly marked unreliable**:
    - Portal + exit behavior does not consistently place the player on the intended far-side overworld tile.
  - Tracked as broken in `BUGS.md`.
  - Full rework planned in `TODO.md`.

### 12.2 Followers / party system (EXPERIMENTAL)

- Intent:
  - Friendly characters that follow the player and fight alongside them.
  - Followers with inventories, basic commands, morale, and persistence.

- Current status (experimental, first-pass implementation):
  - Data-driven archetypes and names:
    - Guard-style follower archetype (“Guard Ally”) and a thief-style archetype are defined in `data/entities/followers.json` with glyph, color, base stats, faction, tags, and equipment hints.
    - Each follower generated from these archetypes receives a unique name from a per-archetype `namePool` (e.g., “Arne the Guard”), persisted in `player.followers` so the same named ally appears across all modes until death.
    - `GameData.followers` is the single source of truth for follower visuals/stats.
  - Player follower slot:
    - Player defaults include a single follower record in `player.followers`, normalized and persisted on the save.
  - Spawning and modes:
    - Dungeons / towers / encounters / region-map:
      - An allied guard-style follower is spawned near the player as an enemy-style actor with `_isFollower` and `_followerId` set.
      - Follower AI never targets the player, only hostile factions, and uses LOS-based targeting for enemies; when no hostile is visible, they move to stay near the player.
    - Towns / castles:
      - A follower NPC is spawned near the gate/player with roles `["follower"]` and `_isFollower/_followerId` markers.
      - Town tick logic keeps the follower NPC within a short distance of the player as they move through town.
  - Persistence and death:
    - Dungeon/town/region save snapshots explicitly exclude follower actors/NPCs so followers are always derived from `player.followers` on entry.
    - Follower HP/level from dungeon/encounter/region runs are synced back into `player.followers` on exit.
    - When a follower dies in combat, their corresponding record is removed from `player.followers`, and they will not respawn anywhere (permanent death for that run).
    - When a follower dies, all of their equipped gear and inventory items (with their current decay/wear) are added to their corpse loot so the player can recover their follower’s equipment.
  - Visual consistency and logging:
    - Follower glyph/color are taken from `followers.json` and rendered consistently in all modes (town, dungeon, region) with a distinct background to differentiate them from normal enemies/NPCs.
    - Combat logs, corpse flavor, and kill attributions use follower display names and (where possible) their actual equipped weapon names instead of raw type IDs.
  - Follower inspect panel:
    - Bumping into a follower in dungeons/encounters/region-map, or talking/bumping them in towns/castles, opens a follower inspect panel instead of attacking or generic chatter.
    - The panel shows follower name, level, HP/max HP, Attack, Defense, faction/roles, tags, personality, temperament, and an archetype `hint`.
  - Equipment and inventory:
    - The follower panel includes:
      - A full equipment view for follower slots (left/right hand, head, torso, legs, hands).
      - A follower inventory list.
      - A truncated player inventory list for item transfer.
    - Supported interactions:
      - `[Equip]` items from follower inventory into appropriate slots (hands/head/torso/legs/hands).
      - `[Unequip]` slot items back into follower inventory.
      - `[Give]` items from player inventory to follower inventory (or directly into a slot when a slot is specified).
      - `[Take]` items from follower inventory back into the player’s inventory.
    - After each change, follower Attack/Defense are recomputed from base stats + gear and immediately reflected in the panel.
    - Potions and other non-equipment items cannot be equipped into follower slots; followers use potions directly from their inventory when low on HP instead of attacking.
  - Equipment parity, decay, curses, and preferences:
    - Followers use the same style of Attack/Defense aggregation as the player (base stats plus all equipped gear) via shared helpers.
    - Follower weapons and armor decay when they attack, are blocked, or are hit; when an equipped item breaks, the follower automatically equips the best replacement from their own inventory, based on total atk+def and simple class preferences.
    - Seppo’s True Blade (cursed two-handed sword) behaves for followers like for the player:
      - Equipping it occupies both hands and moves any existing hand items to inventory.
      - While it is equipped, followers cannot unequip it or equip other hand weapons; curse lifts when it breaks.
    - Follower archetypes carry soft preferences (e.g., guards favor sword+shield and heavy armor; thieves favor daggers/light weapons and light armor) that slightly bias auto-equip choices without forbidding non-preferred gear.

- Not yet implemented (planned; see `TODO.md`):
  - Multiple followers / true party system and party size limits, with command UI (Attack / Follow / Wait here).
  - Follower injuries and scars (persistent follower wounds and scars similar to the player’s, visible in the follower panel and treatable by healers).
  - Follower experience and leveling (followers gain XP and levels, but do not receive a full heal when leveling).
  - Fully data-driven special item effects (curses and on-hit/on-break behaviors) instead of bespoke Seppo-specific code.

### 12.3 GOD Arena mode

- Intent:
  - Special large test map reachable via GOD:
    - Spawn any enemy/creature/NPC.
    - Stamp tower/town prefabs.
    - Tweak levels, HP/damage multipliers, aggression.
    - Place walls/props, toggle invincibility, freeze AI, etc.
- Current status:
  - Not implemented; detailed design in `TODO.md`.

### 12.4 GOD enemy FOV visualization

- Intent:
  - GOD toggle to show enemy FOV/vision cones and detection ranges.
- Current status:
  - Not implemented; planned in `TODO.md`.

### 12.5 Infinite overworld performance

- Intent:
  - Infinite-style overworld where the player can explore large regions without hard map bounds.
- Current status:
  - Implemented, but **performance degrades** after exploring large portions of the world:
    - World generation and expansion can become slow/sluggish as more chunks are visited.
  - Tracked as a bug in `BUGS.md` and targeted for future performance work in world/infinite_gen + world_runtime.

---

## 13. Platform & Input

- Platform:
  - Intended for modern desktop browsers.
- Input:
  - Keyboard-focused controls (no mouse required).
  - Numpad recommended for diagonal movement; arrow keys supported for 4-directional movement.

---

## 14. Where to Look Next

- `VERSIONS.md` — detailed change history and version notes.
- `TODO.md` — planned features, refactors, and technical debt.
- `BUGS.md` — known issues, including mountain-pass dungeon problems and other bugs.

Keep `FEATURES.md` in sync with the actual game:

- When a planned feature becomes real and stable → move it out of Experimental and into the main sections.
- When features are removed or heavily changed → update or remove their descriptions here.