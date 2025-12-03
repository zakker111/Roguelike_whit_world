World generation

Purpose
- Utilities for generating towns, roads, and prefab buildings on the overworld. Ensures deterministic placement and connectivity consistent with infinite world streaming.

Key modules
- town_gen.js — town layout generation (plaza, inn, shops, Guard Barracks) with schedule-aware shops and dedup rules (one of each type).
- roads.js — town road connectivity inside the local town map; builds ROAD tiles between gate, plaza, and buildings using townOutdoorMask.
- prefabs.js — prefab stamping (buildings/shops/inns/plazas) with slip attempts to fit terrain; reads prefab definitions from data/worldgen/prefabs.json via GameData.prefabs.

Prefabs module API (stamp/trySlip)
- The prefabs module provides helpers to place buildings and shops as prefabs.

Return shape:
- stampPrefab(ctx, prefab, bx, by, buildings)
- trySlipStamp(ctx, prefab, bx, by, maxSlip = 2, buildings)
Both return an object:
  { ok: boolean, rect: { x, y, w, h }, shop?: { type, name, door: { x, y }, scheduleOverride?, signWanted? } }

Notes
- ok indicates placement success. Callers should check res && res.ok.
- rect is the placed building rectangle for bookkeeping (e.g., dedup, windows, props).
- shop is present only when the prefab declares a shop; it includes door position and optional schedule/sign metadata.
- Older code paths used boolean returns; if you migrate any callers, do not assume boolean — inspect res.ok and properties instead.
- Prefabs are authored in data/worldgen/prefabs.json (houses/shops/inns/plazas, including Guard Barracks) and loaded into GameData.prefabs; worldgen/prefabs.js only stamps them into ctx.map.
- Towns whose overworld tile is adjacent to water/river/beach become “shoreline” towns: outer walls are skipped on those sides so water acts as a natural boundary, while landward sides still use walls and a gate.

How to add a new town prefab (by hand)
1) Define the prefab in data/worldgen/prefabs.json:
   - Include dimensions, interior layout (walls/doors/windows), and optional shop metadata:
     {
       id: "bakery_small",
       category: "shop",
       size: { w: 7, h: 5 },
       tiles: [...], // tile codes (WALL/DOOR/WINDOW/FLOOR/STAIRS/BED/etc.)
       shop: { type: "Bakery", name: "Bakery", sign: true }
     }
   - Follow existing prefab patterns for layout encoding.

2) Preview/edit with the Prefab Editor (recommended):
   - Open tools/prefab_editor.html in your browser (or via node server.js).
   - Use “Load existing prefab” to inspect an existing prefab, or start from an empty grid.
   - Export the JSON block from the editor and paste it into data/worldgen/prefabs.json under the appropriate category.

3) Place the prefab via town_gen.js:
   - Use stampPrefab(ctx, prefab, bx, by, buildings) or trySlipStamp(ctx, prefab, bx, by, maxSlip, buildings) to attempt placement.
   - Add logic to include your prefab under appropriate town sizes/biomes if needed (e.g., guard barracks only in big/city towns).

4) Add signage/schedule overrides if applicable:
   - Set shop.schedule or shop.sign/signText in the prefab shop block; town_gen and services/shop_service.js will honor these.

5) Test in-game:
   - Run node server.js and visit a town; use the GOD panel “Check Prefabs” to confirm your new prefab is loaded and used, and “Check Signs” to verify signage and schedules.