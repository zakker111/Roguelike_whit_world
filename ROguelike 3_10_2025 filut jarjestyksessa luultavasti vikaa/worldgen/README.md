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