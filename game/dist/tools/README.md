Tools

Purpose
- Browser tools and developer utilities used during content creation and debugging.

Key files
- prefab_editor.html — in-browser prefab editor (DEV). Lets you preview and tweak town/shop prefab stamps and edit existing prefabs from data/worldgen/prefabs.json.

Notes
- Open prefab_editor.html directly in the browser or via a static server (node server.js).
- The editor loads prefab definitions from data/worldgen/prefabs.json via GameData.prefabs; use the “Load existing prefab” dropdown to inspect or modify existing entries (houses/shops/inns/plazas, including Guard Barracks).
- Prefab exports should be pasted back into data/worldgen/prefabs.json; worldgen/prefabs.js stamps these prefabs into town maps at generation time. See worldgen/README.md for schema and integration details.