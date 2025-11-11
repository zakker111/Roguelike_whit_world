World generation

Purpose
- Utilities for generating towns, roads, and prefab buildings on the overworld. Ensures deterministic placement and connectivity consistent with infinite world streaming.

Key modules
- town_gen.js — town layout generation (plaza, inn, shops) with schedule-aware shops and dedup rules (one of each type).
- roads.js — road connectivity between nearby towns within current streamed window; bridges tie into world rivers.
- prefabs.js — prefab stamping (buildings/shops) with slip attempts to fit terrain.

Prefabs module API (stamp/trySlip)
- The prefabs module provides helpers to place buildings and shops as prefabs.

Return shape:
- stampPrefab(ctx, prefab, bx, by, buildings)
- trySlipStamp(ctx, prefab, bx, by, maxSlip = 2, buildings)
Both return an object:
  { ok: boolean, rect: { x, y, w, h }, shop?: { type, name, door: { x, y }, scheduleOverride?, signWanted? } }

Notes:
- ok indicates placement success. Callers should check res && res.ok.
- rect is the placed building rectangle for bookkeeping (e.g., dedup, windows, props).
- shop is present only when the prefab declares a shop; it includes door position and optional schedule/sign metadata.
- Older code paths used boolean returns; if you migrate any callers, do not assume boolean — inspect res.ok and properties instead.

How to add a new town prefab (by hand)
1) Define the prefab in worldgen/prefabs.js:
   - Include dimensions, interior layout (walls/doors/windows), and optional shop metadata:
     {
       id: "bakery_small",
       w: 7, h: 5,
       layout: [...], // tile/glyph plan
       shop: { type: "Bakery", name: "Bakery", signWanted: true }
     }
   - Follow existing prefab patterns for layout encoding.

2) Place the prefab via town_gen.js:
   - Use stampPrefab(ctx, prefab, bx, by, buildings) or trySlipStamp(ctx, prefab, bx, by, maxSlip, buildings) to attempt placement.
   - Add logic to include your prefab under appropriate town sizes/biomes if needed.

3) Add signage/schedule overrides if applicable:
   - Set shop.scheduleOverride or signWanted in the prefab shop block; town_gen and services/shop_service.js will honor these.

4) Test in-game:
   - Run node server.js and visit a town; use the GOD panel “Check Prefabs” to confirm your new prefab is loaded and used.