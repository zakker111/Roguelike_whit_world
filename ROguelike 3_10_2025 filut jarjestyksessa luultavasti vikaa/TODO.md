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

## Technical / Cleanup

- [ ] Some files are really big; consider splitting into smaller modules when it makes sense (following existing patterns).
- [ ] Smoketest runner:
  - Remove positional “nudge” for dungeon entry, town entry, dungeon exit, and town exit.
  - Make smoketest positions exact in tiles; only use nudge around NPC interaction or enemy interaction.