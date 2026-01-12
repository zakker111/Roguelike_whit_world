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
- Experimental permanent buffs (Seen Life):
  - Certain equipment pieces can awaken and gain a small, permanent stat bonus after heavy use.
  - Weapons:
    - Each time you successfully hit an enemy with a weapon, that weapon’s internal “uses” counter increases.
    - Once a weapon has landed around 100 hits, it gains a small one-time chance to awaken with the **Seen Life** buff, granting a permanent **attack** bonus.
  - Armor and shields:
    - Each time you are hit while wearing armor (head/torso/legs/hands), that armor piece’s internal “uses” counter increases.
    - Once a piece of armor or a shield has absorbed around 100 hits, it gains a small one-time chance to awaken with **Seen Life**, granting a permanent **defense** bonus.
  - Per-item rules:
    - Each item gets at most **one roll** for Seen Life when its usage threshold is reached; if it fails, that item will never gain Seen Life.
    - An item can only have Seen Life once; the buff does not stack on the same item.
  - UI:
    - When Seen Life triggers, a golden log line informs the player (“Your [item] has Seen Life and grows stronger.”).
    - In the inventory/equipment UI, buffed items are marked with a subtle gold indicator, and detailed buff info is shown on hover.
  - Status:
    - This system is **experimental** and currently limited to the Seen Life buff; it is intended as a foundation for future equipment buffs.

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
- Quest Board:
  - Many towns place a Quest Board prop near the plaza or inn. Press `G` on it to open the quest board panel.
  - The board lists available quests for that town, currently including:
    - Gather quests (e.g., deliver 10 planks or 10 berries) that check your inventory and consume items on turn-in.
    - Encounter quests (e.g., “Bandits near the farm”) that place an `E` marker near the town; press `G` on the marker to start the special encounter.
  - Rewards (typically gold) are claimed by returning to the Quest Board after completing the objective; some gather quests can be accepted and immediately turned in if you already carry the required items.
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
  - Followers with inventories, basic commands, lasting injuries, and persistence.

- Current status (experimental, first-pass implementation):
  - Data-driven archetypes and names:
    - Guard-style follower archetype (“Guard Ally”) and a thief-style archetype are defined in `data/entities/followers.json` with glyph, color, base stats, faction, tags, temperament, and equipment hints.
    - Each follower generated from these archetypes receives a unique name from a per-archetype `namePool` (e.g., “Arne the Guard”, “Sade the Thief”), persisted in `player.followers` so the same named ally appears across all modes until death.
    - `GameData.followers` is the single source of truth for follower visuals/stats.
  - Player follower records:
    - Followers are stored on `player.followers` with:
      - Identity: `id`, `name`, `archetypeId`, basic stats, and simple role tags.
      - Equipment and inventory: per-follower `equipment` object and `inventory` array.
      - Health and durability: `hp`, `maxHp`, and `injuries` mirroring the player’s injury system.
      - Progression: `level`, `xp`, and `xpNext` so followers can gain levels independently.
      - Behavior: a simple `mode` flag (`follow` / `wait`) for basic commands.
  - Spawning and modes:
    - Dungeons / towers / encounters / Region Map:
      - Allied follower actors spawn near the player (within a small radius) as enemy-style actors with `_isFollower` and `_followerId` set; they never target the player and use LOS-based targeting for hostiles.
      - Followers are not spawned if no nearby walkable tile is free; this prevents off-screen or corner spawns.
    - Towns / castles:
      - Follower NPCs spawn near the gate/player with roles `[\"follower\"]` and `_isFollower/_followerId` markers and follow the player through town in `follow` mode.
      - In `wait` mode they hold position but remain interactable.
  - Inn hiring and party caps:
    - Town inns can occasionally host recruitable followers-for-hire:
      - On town generation, there is a modest chance to spawn a follower candidate inside the inn if the player is below the follower cap.
      - On town re-entry, a smaller chance is applied to spawn new candidates when conditions allow.
    - Interacting with an inn candidate offers to hire them for gold (e.g., 80g):
      - On acceptance, gold is deducted, the follower is added to `player.followers`, and the candidate NPC is removed.
      - On rejection or insufficient gold, clear feedback is logged; no hire occurs.
    - The Character Sheet shows a “Party: N/3 followers” line, reflecting the current number of active followers and the configured cap.
  - Persistence and death:
    - Dungeon/town/region save snapshots exclude follower actors/NPCs; followers are always re-derived from `player.followers` on entry to avoid duplication.
    - Follower HP/level and injuries from dungeon/encounter/Region runs are synced back into `player.followers` on exit.
    - When a follower dies in combat, their record is removed from `player.followers`, and they will not respawn (permanent death for that run).
    - On follower death, all of their equipped items and inventory items (with current decay) are added to their corpse loot so the player can recover gear.
  - Visual consistency and logging:
    - Follower glyph/color are taken from `followers.json` and rendered consistently in all modes (town, dungeon, region) with a distinct background to differentiate them from normal enemies/NPCs.
    - Combat logs, follower barks, and corpse flavor use follower display names and, where possible, their actual equipped weapon names instead of raw type IDs (no more “guard_follower#1” in corpse lines).
  - Follower inspect panel:
    - Bumping into a follower in dungeons/encounters/Region Map, or talking/bumping them in towns/castles, opens a follower inspect panel instead of attacking or generic chatter.
    - The panel shows follower name, level, HP/max HP, Attack, Defense, faction/roles, tags, personality, temperament, injuries/scars, a short archetype `hint`, equipment slots, and inventory.
  - Equipment, inventory, and decay:
    - The follower panel includes:
      - A full equipment view for follower slots (left/right hand, head, torso, legs, hands).
      - A follower inventory list and a truncated player inventory list for transfers.
    - Supported interactions:
      - `[Equip]` items from follower inventory into appropriate slots.
      - `[Unequip]` slot items back into follower inventory.
      - `[Give]` items from player inventory to follower inventory (or directly into a slot when a slot is specified).
      - `[Take]` items from follower inventory back into the player’s inventory.
    - After each change, follower Attack/Defense are recomputed from base stats + gear and immediately reflected in the panel.
    - Potions and other non-equipment items cannot be equipped; followers use potions directly from their inventory when low on HP instead of attacking.
    - Followers use shared equipment aggregation and decay logic:
      - Weapons and armor decay when they attack, are blocked, or are hit.
      - When an equipped item breaks, they automatically equip the best replacement from their own inventory based on atk+def and simple class preferences.
      - Seppo’s True Blade behaves as a cursed two-handed weapon for followers just like for the player (occupies both hands, cannot be unequipped until broken).
  - Simple commands (follow/wait):
    - Each follower has a basic `mode` flag stored on their record:
      - `follow` (default): trail the player and pursue visible hostiles using LOS-based targeting.
      - `wait`: hold position, only attacking enemies that move adjacent.
    - Mode can be toggled from the follower panel (opened by bumping/talking to the follower).
  - Injuries and scars:
    - Followers share the player’s injury model:
      - `injuries` is an array of `{ name, healable, durationTurns }`.
      - Healable injuries tick down and disappear after their duration; permanent scars remain.
    - Followers can gain injuries and scars on significant hits and crits (e.g., “bruised leg”, “sprained ankle”, “facial scar”, “deep scar”), both in dungeons and town combat.
    - The follower panel displays an Injuries section:
      - Healable injuries in amber with “heals in N turns”.
      - Permanent scars in red with a “(scar)” label.
  - Experience and leveling:
    - Followers gain XP and levels independently of the player:
      - Only when a follower lands the killing blow on an enemy.
      - XP is stored on the follower record (`xp`, `xpNext`); the player’s XP is unaffected by follower kills.
      - On follower level-up, `level` and `maxHp` increase and HP is restored to the new max; `xpNext` scales by a light curve.
    - The follower panel shows `XP: current / next`, updating as they earn kills.
  - Combat barks and flavor:
    - Followers have archetype-specific flavor pools defined in `followers.json`:
      - Guard and thief followers can emit short lines when:
        - They land critical hits (`critDealt`).
        - They take critical hits (`critTaken`).
        - They panic/flee at low HP (`flee`).
    - Flavor helpers pick a line from these pools with chance gating and per-follower cooldowns, logging them as `"info"` so they appear in the main log without spamming.

- Not yet implemented (planned; see `TODO.md`):
  - Multiple followers / true party system and party size limits, with richer party command UI (e.g., Attack / Guard / Follow / Wait here, global “All follow/all wait”, formations, and “focus my target”).
  - Follower–healer integration (treating follower injuries and scars for gold, with UI to pick which follower/injury to treat and clear costs/effects).
  - More nuanced follower AI (positional tactics, archetype-based behavior such as flanking thieves and chokepoint guards, morale and retreat logic).
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