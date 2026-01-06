# TODO / Planned Work

This file collects planned features, ideas, and technical cleanups that were previously scattered in `VERSIONS.md` and `todo.txt`.

## Gameplay / Features

- [ ] Bridge/ford generation across rivers
- [ ] Named towns and persistent inventories/NPCs across visits
- [ ] Shop UI (buy/sell) and currency
- [ ] District themes (market / residential / temple) and signage
- [ ] Movement costs or effects per biome (swamp slow, snow visibility, desert hazard)
- [ ] If there are not enough beds at home for an NPC, let them sleep on the floor
- [ ] Move flavor text into JSON data (data-driven flavor)
- [ ] Mouse-hover enemy inspect system tied to Perception skill
  - When hovering over a visible enemy tile (dungeon/encounter), show an inspect tooltip describing its relative threat and gear.
  - Low Perception → vague text (“looks weak / dangerous”, “lightly/heavily armored”).
  - Higher Perception → approximate or exact level and stats (Attack/Defense), gear quality (tier), and whether it looks well equipped.
  - Implemented via a lightweight mousemove → tile → enemy lookup and a small DOM tooltip/HUD overlay, with no impact when modals are open or tiles are unseen.
- [ ] Player skill tree and skill points
  - Perception skill that affects how far the player sees other creatures/enemies, and how early encounters/animals are sensed.
  - “Campman” / survival skill affecting animal sensing and how often the player can safely flee from encounters.
- [ ] Passive combat skills
  - One-handed, two-handed, shield use, and striking skills that grow with use up to a cap and affect combat stats.
- [ ] Friendly followers / party system
  - Allow the player to have friendly characters that follow them (party members/henchmen).
  - Followers can fight alongside the player and can die permanently.
  - Acquisition paths:
    - Hire/buy allies from inns or taverns (gold sink, limited slots, different archetypes).
    - Rescue potential followers from special encounters or dungeons (e.g., captives who choose to join).
  - Needs:
    - Data-driven follower archetypes (stats, AI behavior, gear, personality) in JSON.
    - Simple follower AI that:
      - Trails the player in overworld/dungeons without blocking entrances.
      - Prioritizes nearby threats, avoids stepping on traps when possible.
    - UI hooks:
      - Basic party status display (HP, name, maybe one trait icon).
      - Simple command hooks (e.g., “wait here”, “follow”, maybe “hold position”).
    - Balance and persistence:
      - Limited party size.
      - Persist follower state across mode switches and saves (gear, HP, location).

- [ ] GOD Arena mode for combat/AI testing
  - Add a GOD panel entry that teleports the player to a special “arena” test map:
    - A fairly large, open map (big enough to host any prefab layout from towers/towns and generic dungeon rooms).
    - Simple, mostly empty base (flat floor) with optional walls/props the user can place or stamp via prefabs.
    - Uses a dedicated HUD layout with tools for spawning enemies/props/creatures/NPCs and tweaking parameters.
  - Enemy/creature/NPC spawning:
    - List all enemy, creature, and town NPC archetypes used in the game (from data/entities/enemies.json, wildlife/creature registries, and town NPC definitions) in a scrollable/filtered list.
    - Allow spawning one or many instances of the selected type at/around a cursor or the player.
    - Allow batch spawns (“spawn 10 of this type at random positions”).
  - Prefab spawning:
    - Allow stamping any prefab used in towers or towns (JSON room/layouts) into the arena at a chosen anchor:
      - Tower room prefabs (barracks, storage, prison cells, boss arenas, etc.).
      - Town building/interior prefabs, plaza/town props groups, and other reusable layouts.
    - Ensure arena bounds are large enough to accommodate full prefab footprints without clipping.
  - Tweaks and controls:
    - Sliders/inputs for:
      - Enemy level, HP multiplier, damage multiplier, and optional randomization ranges.
      - Global enemy aggression (e.g., shorter/longer detection ranges).
    - Toggles:
      - Player invincible on/off.
      - Enemies see player on/off (stealth/visibility toggle).
      - Freeze/unfreeze enemy AI (debug single-step behavior).
  - Props and walls:
    - Allow placing/removing walls and basic props (crates, barrels, campfires, doors) to simulate different tactical situations.
    - Optionally place simple line-of-sight obstacles to test FOV/cover behavior.
  - Behavior requirements:
    - Enemies in arena mode should behave exactly as in real game contexts (same AI, FOV, pathing, abilities).
    - Arena should not alter core AI logic; it only provides a sandbox and parameter overrides.
  - Safety / exit:
    - Provide a clear “Return from Arena” button that restores the player to their previous mode/position.
    - Ensure arena mode does not affect normal save data (or is clearly tagged as non-persistent) except for intentional tests.

## Technical / Cleanup

- [ ] Mountain-pass dungeons: design and implement a complete rework of A/B linked mountain-pass dungeon behavior (portal logic, overworld exit targets, and persistence); current implementation is experimental and unreliable.
- [ ] Some files are really big; consider splitting into smaller modules when it makes sense (following existing patterns).
- [ ] Smoketest runner:
  - Remove positional “nudge” for dungeon entry, town entry, dungeon exit, and town exit.
  - Make smoketest positions exact in tiles; only use nudge around NPC interaction or enemy interaction.