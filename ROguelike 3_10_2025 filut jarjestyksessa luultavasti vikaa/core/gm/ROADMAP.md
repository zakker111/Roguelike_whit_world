# GM (Game Master) Roadmap / Target Architecture

This document is an **actionable plan** for evolving the GM system into a stable, deterministic, and testable subsystem.

## Goals

1. **Determinism by default**
   - All GM *decisions* (arbitration, eligibility) must be RNG-free.
   - Any GM *randomness* must come only from the persisted GM RNG stream (`gm.rng`).
2. **Separation of concerns**
   - Pure-ish state updates (no IO, no DOM) live in `core/gm/runtime/*`.
   - Side effects (start encounter, place marker, show confirm) live in `core/bridge/gm_bridge.js`.
   - UI surfaces (GM panel, GOD tools) live in `ui/*`.
3. **A narrow public façade**
   - Other systems talk to GM through a small set of functions (no direct state poking outside normalization helpers).
4. **Good observability**
   - Every GM decision should be debuggable via intent history + reason codes.
5. **Testable in Node**
   - A CI-safe test entrypoint must validate GM behavior without a browser.

---

## Current State (as of this repo)

- **State + normalization:** `core/gm/runtime/state_ensure.js`
- **Deterministic scheduler ops:** `core/gm/runtime/scheduler/ops.js`
- **Event updates:** `core/gm/runtime/events/updates.js`
- **Runtime façade:** `core/gm/runtime.js`
- **Bridge (side effects):** `core/bridge/gm_bridge.js`
- **Mode integration hook:** `core/modes/modes.js` → private hook `Modes.__gmEvent`
- **Debug UI:** `ui/components/gm_panel.js`
- **Sims / assertions:** `gm_sim.html`, `gm_emission_sim.html` (and Node test harness via `scripts/test_gm.js`)

---

## Phase Plan

### P0 (now): Lock determinism + invariants (1–2 days)

**Objective:** Make it impossible for ordering bugs and RNG leaks to regress silently.

- **Scheduler queue invariants**
  - Queue dedupe must preserve *first* occurrence (insertion order).
  - Queue must contain every `actions[id]` at least once.
  - Add regression tests (Node + sim pages).

- **Codify counter semantics**
  - Document `positive/negative` semantics for families/factions (slayer vs ally evidence).
  - Keep the metric formula stable: `score = (pos - neg) / (pos + neg)`.

- **Acceptance criteria**
  - `npm test` passes (Node sims).
  - `gm_sim.html` and `gm_emission_sim.html` show PASS.

### P1: Formalize schemas (events → intents → actions) (2–4 days)

**Objective:** Standardize payload shape so debug tooling and bridges can be generic.

- **Event schema** (`GMRuntime.onEvent(ctx, event)`)
  - `event.type` (string)
  - `event.scope` (mode)
  - `event.turn` (int)
  - `event.interesting` (boolean)
  - `event.tags` (string[])
  - Optional `event.payload` (object)

- **Intent schema** (decision output)
  - `intent.channel` ("entrance" | "mechanicHint" | "factionTravel" | "quest" | ...)
  - `intent.kind` ("flavor" | "nudge" | "encounter" | "guard_fine" | "marker" | "none")
  - `intent.reason` (short code, required for `kind: "none"`)

- **Action schema** (scheduler)
  - `action.id` (stable string)
  - `action.kind` (catalog key)
  - `action.status` (planned/scheduled/ready/consumed/expired/cancelled)
  - `action.delivery` (auto/confirm/marker)
  - `action.priority`, `createdTurn`, `earliestTurn`, `latestTurn`
  - `action.payload` (object)

- **Acceptance criteria**
  - Debug output (`gm_panel.js`) can render any intent/action without custom per-action string glue.

### P2: Public façade + dependency inversion (3–6 days)

**Objective:** Stop GM from being an implicit global and make it a clean dependency.

- Introduce `core/gm/index.js` (or similar) that exports:
  - `getState(ctx)`
  - `tick(ctx)`
  - `onEvent(ctx, event)`
  - `getEntranceIntent(ctx, scope)`
  - `getMechanicHint(ctx)`
  - `getFactionTravelEvent(ctx)`

- Everything else imports through the façade.

- **Acceptance criteria**
  - No non-GM module imports from deep paths like `core/gm/runtime/*` except via explicitly allowed helpers.

### P3: Scheduler-backed GM v0.2 content completion (1–2 weeks)

**Objective:** Finish the promised v0.2 action catalog with robust rails.

- Safety rails (enforced in scheduler ops / runtime):
  - max actions per rolling window
  - min spacing between auto events
  - one action per turn unless `allowMultiplePerTurn`

- Complete delivery modes:
  - `travel.guardFine` (confirm)
  - `travel.banditBounty` (auto)
  - `quest.bottleMap` (marker)

- **Acceptance criteria**
  - Full Bottle Map lifecycle smoke test passes (acquire → activate → marker → resolve → cleanup).
  - `gm.enabled=false` suppresses *all* GM side effects.

### P4: Persistence & versioning (3–5 days)

**Objective:** Stable save/load behavior and upgrade strategy.

- Store GM state under a versioned key (e.g. `GM_STATE_V1`).
- Clear on new game / death restart / seed reroll / app version change.
- Provide explicit migration steps when bumping GM state format.

- **Acceptance criteria**
  - Save → reload → deterministic continuation (GM RNG stream + scheduler state preserved).

---

## Debugging & Profiling hooks

- `gm.debug.intentHistory` always includes `reason` on `kind: "none"`.
- `gm.debug.lastEvents` ring buffer captures event types and turns.
- Optional perf counters (already partially present): ticks, events, intent decisions.

---

## Where to implement what

- Pure state updates: `core/gm/runtime/*`
- Deterministic scheduling utilities: `core/gm/runtime/scheduler/*`
- Side effects (UI/markers/encounters): `core/bridge/gm_bridge.js`
- Mode integration hook: `core/modes/modes.js` (`gmEvent` and `Modes.__gmEvent`)
- UI surfaces: `ui/components/gm_panel.js`, GOD panel integration

---

## Testing

- Node tests (CI): `npm test` → `scripts/test_gm.js`
- Browser sims (manual/dev):
  - `gm_sim.html` (unit-style)
  - `gm_emission_sim.html` (integration-style)

The goal is for *both* Node and browser sims to exercise the same code paths.
