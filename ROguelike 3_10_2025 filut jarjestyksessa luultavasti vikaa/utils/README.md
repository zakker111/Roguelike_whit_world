Utilities

Purpose
- General-purpose helper modules used across the engine, world, dungeon, combat, and UI.

Key modules
- utils.js — small helpers and DOM-safe utilities used widely.
- bounds.js — rectangle math, clamping, intersection helpers.
- grid.js — grid helpers (indexing, neighbor scans).
- number.js — numeric helpers (clamp, random ranges when needed).
- rng.js — mulberry32 fallback and simple RNG utilities.
- item_describe.js — human-readable item strings and summaries.
- global.js — small shared constants/globals.
- fallback.js — compatibility helpers for legacy paths.

Notes
- Prefer core/rng_service.js for deterministic game RNG; utils/rng.js remains for isolated utilities/tests.