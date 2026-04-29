Region Map

Purpose
- Local tactical overlay for a single overworld tile. Shows props, animals, ruins, and lootables when opened from the overworld.
- Designed for quick, small-scale interactions (foraging, looting, fishing, ruins skirmishes) without entering a full dungeon.

Key modules
- region_map_runtime.js — runtime/controller for entering/exiting the Region Map, interaction logic, and persistence.
  - Integrates with core/ modes and UIBridge, and respects modal gating (ESC to close).
  - Uses ui/render_region.js for drawing and HUD; LOS/FOV rules are region-specific.

Behavior
- Open from the overworld by pressing G on a walkable tile (or on RUINS tiles directly); M is disabled.
- Movement:
  - Movement uses region tile definitions plus World.isWalkable to decide where you can stand.
  - WATER, RIVER, MOUNTAIN and non-walkable RUIN_WALL tiles cannot be entered.
- Weather overlays:
  - Region renderer reuses the same visual weather overlays as the overworld/towns (fog, rain streaks, cloudy tint) by reading ctx.weather from core/game.js.
  - Weather is cosmetic only and follows the global day/night cycle and weather_service.js state.
- Looting and corpses:
  - Pressing G on a corpse or chest opens the same loot panel used in dungeons; multiple containers underfoot are consolidated.
  - Dead animals show exactly what you looted via the panel.
  - In Ruins, corpses/chests log detailed cause-of-death flavor via FlavorService.describeCorpse (wound, killer, weapon/likely cause) before the loot or “nothing” lines.
  - Empty corpses/chests underfoot log “You search the corpse/chest but find nothing.” (or area variants) and are marked looted/examined; this state is saved per-region tile.
- Neutral animals:
  - Deer/fox/boar spawn rarely; at most one animal is spawned in sufficiently wild regions and many tiles have none.
  - If animals were seen here previously, future visits re‑spawn only with a low chance (seeded).
  - Clearing animals marks the tile as cleared; future spawns on that tile are skipped.
- Blood decals:
  - Blood stains created by combat in Region Map (ruins fights, animals, etc.) are stored in ctx.decals and fade over time each turn via Decals.tick(ctx), mirroring dungeon behavior.
- Fishing:
  - If the cursor/player stands next to WATER or RIVER, and the player has a fishing pole, pressing G can start the fishing mini-game.
  - Each attempt advances in-game time and decays the pole; successes yield fish or, rarely, other items.
  - The fishing modal has no visible Cancel button; use Escape to close it early.