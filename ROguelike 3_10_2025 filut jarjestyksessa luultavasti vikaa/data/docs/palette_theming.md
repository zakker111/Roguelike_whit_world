# Palette Theming Guide

This project supports palette-driven theming across overworld, town, region, and dungeon rendering. You can switch palettes at runtime and author new ones.

## Switching palettes

- GOD panel
  - Open GOD (top bar or press P).
  - Theme section: choose a palette from the dropdown and click Apply.
  - The dropdown is auto-populated from `data/world/palettes.json`. If the file is missing, it falls back to “default” and “alt”.
- URL param
  - Append `?palette=alt` to the URL to force the alternate theme.
  - You can also provide a custom JSON path, e.g. `?palette=/data/world/palette_custom.json`.

The current selection persists in `localStorage.PALETTE`. On boot, the loader applies `?palette=` or the persisted selection.

## Authoring a palette

- Location: `data/world/palette.json` (default), and optional alternates like `data/world/palette_alt.json`.
- Structure:
  - `tiles`: defaults for wall/floor colors (used as fallbacks in dungeon/town).
  - `entities`: default colors for player, enemies, corpses.
  - `overlays`: UI and overlay colors (exit highlights, vignette, grid, routes, HUD panels, POIs, etc.).
  - `encounterBiome` and `townBiome`: outdoor ground tints per biome.

See `data/docs/palette_schema.md` for the full list of overlay keys and examples.

## Adding palettes to the GOD dropdown

- Create a palette JSON file with the same schema, for example: `data/world/palette_mytheme.json`.
- Add it to the manifest `data/world/palettes.json`:

```json
{
  "palettes": [
    { "id": "default", "name": "Default", "path": "data/world/palette.json" },
    { "id": "alt", "name": "Alt", "path": "data/world/palette_alt.json" },
    { "id": "mytheme", "name": "My Theme", "path": "data/world/palette_mytheme.json" }
  ]
}
```

- Reload; the GOD panel dropdown will include “My Theme”.
- You can still pass a direct path via `?palette=/data/world/palette_mytheme.json` even without adding to the manifest.

## Notes on caching

All JSON fetches are versioned via `?v=<app-version>` from the `<meta name="app-version">`, which reduces CDN/browser cache issues. If your changes don’t show up, try a hard refresh (Ctrl/Cmd+Shift+R).

## What becomes palette-driven

- Routes, alerts, grid, exit highlights, vignette, minimap background/border.
- HUD panels borders/backgrounds, player tile backdrops, sleeping “Z”, shopkeeper accents.
- Town and dungeon prop fallback colors (crate/barrel/bench/sign/lamp/fireplace/plant, etc.).
- Glow alphas for lamps/torches using numeric keys `glowStartA`, `glowMidA`, `glowEndA`.
- Blood decal color (`overlays.blood`) for region and dungeon.
- Town debug overlays (building highlight/labels) when enabled.

If you see hardcoded colors in the UI, we can expose them behind palette keys — most major overlays already are.

## Troubleshooting

- Use `?dev=1&smoketest=1` to surface palette overlay warnings directly in the in-game Logger and console, including missing keys and invalid alpha values.
- Check `window.ValidationLog.warnings` and `.notices` for structured messages.