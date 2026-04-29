World systems

Purpose
- Infinite deterministic overworld generation, world tile data, and visibility (LOS/FOV). Responsible for chunk streaming, fog-of-war, rivers, bridges, and POI placement.

Key modules
- infinite_gen.js — streaming infinite world in 32‑tile chunks; deterministic by seed.
- world.js — world map model, walkability, POI (town/dungeon/ruins) placement hooks, markers, biome tinting.
- los.js — line-of-sight helpers used by renderers and FOV.
- fov.js — field-of-view computation and seen/fog arrays.

Notes
- Overworld road overlays have been removed; connectivity between towns/dungeons is still guaranteed by carving walkable corridors in the underlying map, but only bridges are drawn as explicit overlays.
- Bridges carve fully across narrow rivers/lakes (river-width spans) and are rendered as stronger plank-like markers to indicate crossing points.
- Dungeon markers are color-coded by difficulty; mountain-edge dungeons (adjacent to MOUNTAIN tiles) are highlighted with a distinct palette color so mountain passes are easy to spot. The minimap reflects fog-of-war and expands as the map grows.
- Infinite world generation includes extremely rare castle settlements (CASTLE tiles). Castles behave like large towns flagged kind="castle" and are rendered with a distinct 'C' glyph and castle palette color on both the main map and minimap.
- A snowy forest biome (SNOW_FOREST) has been added as a dense cold variant of snow; it has its own tint in overworld/region/town base layers but is treated as snow for walkability and town/dungeon heuristics.
- Travelling caravans are tracked in world.caravans and moved each world tick; they travel between towns and castles and are rendered as "c" glyphs in the overworld renderer. Town entry hooks use caravan positions to decide when to spawn caravan merchants inside towns.
- Visual weather (clear/cloudy/foggy/light/heavy rain) is driven by services/weather_service.js and data/config/weather.json via core/game.js; renderers for overworld, towns, and Region Map read ctx.weather to draw subtle overlays and HUD labels without affecting gameplay.