# GM v0.3 Contract (Locked)

This document is the **source of truth** for the GM v0.3 direction.

It is intentionally short and stable: implementation phases (Phase 1–6) should conform to this contract.

## Decisions (locked)

- **Pacing:** rare
  - GM interventions are allowed only occasionally and only when the player is bored.
- **Authority:** choices
  - GM must not force “gotcha” outcomes.
  - Interventions are delivered via player-facing **confirm/choice prompts**.
- **Persistence:** reset
  - GM state is per-run only (no meta progression).
  - GM state must reset on these run boundaries:
    - **Apply Seed**
    - **Start New Game / Restart**
    - **Game Over → Restart**

## What counts as an intervention

An intervention is any GM action that shows a player-facing **confirm/choice prompt**.

- **Counts (spends the rare pacing budget):** confirm/choice UI (e.g. “Investigate?”, “Engage?”).
- **Does not count:** narrative logs, entrance flavor, mechanic hints, telemetry.

## Pacing rules (high-level)

- Interventions are only eligible when:
  - the player is bored enough (boredom threshold gate), and
  - a deterministic cooldown has elapsed.

Cooldown and boredom threshold values are implementation details, but must be:
- deterministic (GM RNG only; no `Math.random`), and
- persisted mid-run so reloads do not change the schedule.

## Safety requirements

- Interventions must be **declinable** with no punishment.
- GM must not break mode transitions or desync ctx; all GM-driven transitions are **ctx-first**.
- Smoketests must remain stable and deterministic.
