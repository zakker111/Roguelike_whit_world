Combat system

Purpose
- Turn-based combat mechanics: bump-to-attack, damage calculation, status effects, equipment decay/breakage, and player/enemy stats.

Key modules
- combat.js — main combat loop and attack resolution.
- combat_utils.js — common combat helpers (hit/crit/block rolls, positioning).
- stats.js — stats model and derived calculations.
- status_effects.js — Bleed, Dazed, and other status effects with turn timers.
- equipment_decay.js — decay progression, breakage conditions, and snapshots for tests.

Notes
- GOD panel exposes testing toggles (Always Crit, spawn enemy nearby).
- Equipment supports two-handed occupancy and hand-specific equipping via entities/player_equip.js.