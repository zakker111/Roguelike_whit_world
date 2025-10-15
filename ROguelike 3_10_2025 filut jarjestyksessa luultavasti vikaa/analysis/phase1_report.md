# Phase 1 Report: Size and Duplication (initial snapshot)

This report summarizes file sizes and approximate duplicated 3-line code shingles across JavaScript files.

You can regenerate this report locally by running:
- `node scripts/analyze.js`

Highlights (measured snapshots)
- Largest file: core/game.js — 2574 lines
- ui/render_dungeon.js — 183 lines
- data/items.json — 186 lines
- data/enemies.json — 57 lines

Immediate duplication observations
- Repeated “sync and refresh” blocks after ctx mutations (now centralized with applyCtxSyncAndRefresh).
- Multiple fallback paths in core/game.js for Combat/Player/Items/Enemies/World/FOV modules — candidates to move into a small core/fallbacks.js.
- Mode transition patterns (enter/leave town/dungeon/world) each manually recompute FOV, update camera/UI, and draw — now partially DRY’d.
- Rendering branches in ui/render_dungeon.js for tiles and decals — candidates for helper extraction.

Next steps
- Run `node scripts/analyze.js` to produce a detailed Top Files and Duplication list for the entire repo.
- Use the “Detected duplicated snippets” section to prioritize DRY refactors.
- Proceed with Phase 2 to extract GOD and fallback responsibilities out of core/game.js into cohesive modules.