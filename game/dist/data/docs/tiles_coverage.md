# Tiles Coverage: Understanding Smoketest Warnings

The smoketest validates that each mode (overworld, town, region, dungeon) only references tile IDs that have corresponding `tiles.json` definitions for that mode.

## Typical warning

```
Tiles.json coverage: mode=overworld references 3 unknown or non-overworld ids: 7, 12, 13
```

This means the renderer encountered numeric tile IDs that don’t have `appearsIn: ["overworld"]` entries in `data/world/world_assets.json`.

## Why this happens

- Numeric tile IDs are reused across modes (e.g., id=0 may be `WATER` in overworld and `WALL` in dungeon).
- If `getTileDef(mode, id)` can’t find a matching definition for that mode, the smoketest flags it.

## How to fix

1) Open `data/world/world_assets.json` and locate the `tiles.tiles` array.
2) Add or correct entries so each ID used in that mode includes that mode in `appearsIn`.

Example stub for a missing overworld tile:

```json
{
  "id": 42,
  "key": "FOO",
  "glyph": "",
  "colors": { "fill": "#0b0c10", "fg": null },
  "properties": { "walkable": true, "blocksFOV": false },
  "appearsIn": ["overworld", "region"]
}
```

Notes:
- `id` must match the numeric value used by your map generation for that mode.
- `key` is optional but recommended for symbolic lookup.
- `colors.fill` is used for tile background; `colors.fg` is used if a glyph is present.
- `properties` may include `walkable`, `blocksFOV`, `emitsLight`, etc.
- `appearsIn` is a list of modes this tile participates in.

## Verifying fixes

- Run the app with `?dev=1&smoketest=1`.
- Move around each mode (overworld/town/region/dungeon) to record maps.
- Check the in-game Logger or console for coverage warnings. No messages means coverage is good.

## Additional checks

The smoketest also warns about:
- Missing palette overlay keys (UI colors and optional alpha keys).
- Props lacking any color sources:
  - JSON (`GameData.props`), `tiles.json` (`getTileDefByKey`), or palette fallback (`PropPalette.propColor`).
  - It shows a sample location (mode and x,y) where the prop appeared.