# Palette schema overview

This document summarizes the palette keys used across renderers and how to customize visuals safely via `data/world/palette.json`.

## Sections

- tiles: baseline colors for dungeon/town walls/floors
- entities: player/enemy/item/corpse colors
- overlays: UI and effect colors

## Overlays keys (UI/effects)

Core tints:
- dim: rgba for explored-but-not-visible fog
- night: rgba tint for night phase
- dusk: rgba tint for dusk phase
- dawn: rgba tint for dawn phase

Grid and routes:
- grid: grid overlay color
- route: primary path/route overlay color
- routeAlt: alternate route color
- alert: attention markers (used in overlays)

Exits and vignette:
- exitTown: bright outline color for town gate
- exitRegionFill: fill color for region edge tiles
- exitRegionStroke: stroke color for region edge tiles
- vignetteStart: radial vignette inner color
- vignetteEnd: radial vignette outer color

Minimap and panels:
- minimapBg: background behind minimap
- minimapBorder: border around minimap
- panelBg: HUD/panel background fill
- panelBorder: HUD/panel border stroke

POIs:
- poiTown: town marker color (overworld + minimap)
- poiDungeonEasy: dungeon marker color for easy dungeons (level ≤ 2)
- poiDungeonMed: dungeon marker color for medium (level = 3)
- poiDungeonHard: dungeon marker color for hard (level ≥ 4)
- questMarker: active quest markers (overworld + minimap)

Player/NPC and region extras:
- sleepingZ: animated Z above sleeping NPCs
- playerBackdropFill: player tile backdrop fill
- playerBackdropStroke: player tile backdrop stroke
- regionAnimal: neutral animal marker color (region map)
- shopkeeper: shopkeeper glyph color (town view)
- regionAnimalsCleared: label color for “Animals cleared here”
- regionAnimalsKnown: label color for “Animals known in this area”

Optional alpha controls for overlays:
- exitOverlayFillA: shared fill alpha (0..1) used as fallback
- exitOverlayStrokeA: shared stroke alpha (0..1) used as fallback
- exitEncounterFillA / exitEncounterStrokeA: overrides for encounter exit overlay
- exitDungeonFillA / exitDungeonStrokeA: overrides for dungeon exit overlay
- glowStartA / glowMidA / glowEndA: lamp/torch glow alpha stops (town+dungeon); per-phase multiplier applies (night/dusk/dawn)

Misc:
- blood: color for blood decals (region + dungeon fallback)

Notes:
- All alpha keys are numbers in the range [0, 1].
- If a specific per-mode alpha is missing, the shared `exitOverlayFillA` and `exitOverlayStrokeA` will be used if present; otherwise defaults apply.

## Example

```json
{
  "overlays": {
    "dim": "rgba(0,0,0,0.70)",
    "night": "rgba(0,0,0,0.35)",
    "dusk": "rgba(255,120,40,0.12)",
    "dawn": "rgba(120,180,255,0.10)",

    "grid": "rgba(122,162,247,0.08)",
    "route": "rgba(80, 140, 255, 0.9)",
    "routeAlt": "rgba(0, 200, 255, 0.85)",
    "alert": "rgba(255, 80, 80, 0.95)",

    "exitTown": "#9ece6a",
    "exitRegionFill": "rgba(241,153,40,0.28)",
    "exitRegionStroke": "rgba(241,153,40,0.80)",
    "vignetteStart": "rgba(0,0,0,0.00)",
    "vignetteEnd": "rgba(0,0,0,0.12)",

    "minimapBg": "rgba(13,16,24,0.70)",
    "minimapBorder": "rgba(122,162,247,0.35)",
    "panelBg": "rgba(13,16,24,0.80)",
    "panelBorder": "rgba(122,162,247,0.35)",

    "poiTown": "#ffd166",
    "poiDungeonEasy": "#9ece6a",
    "poiDungeonMed": "#f4bf75",
    "poiDungeonHard": "#f7768e",
    "questMarker": "#fbbf24",

    "sleepingZ": "#a3be8c",
    "playerBackdropFill": "rgba(255,255,255,0.16)",
    "playerBackdropStroke": "rgba(255,255,255,0.35)",
    "regionAnimal": "#e9d5a1",
    "shopkeeper": "#ffd166",
    "regionAnimalsCleared": "#86efac",
    "regionAnimalsKnown": "#f0abfc",

    "exitOverlayFillA": 0.30,
    "exitOverlayStrokeA": 0.85
  }
}
```

## Tips

- Prefer hex colors for static fills and glyphs (e.g., "#9ece6a"), and rgba for tints with transparency.
- Keep alpha values low for overlays to avoid obscuring tiles (typical ranges: fill 0.20–0.35, stroke 0.70–0.95).
- Overworld/region/dungeon/town renderers will fall back to sensible defaults if keys are missing.