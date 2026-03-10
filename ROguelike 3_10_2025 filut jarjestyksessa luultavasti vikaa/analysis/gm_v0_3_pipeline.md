# GM v0.3 Pipeline (Next Steps)

This document translates the GM v0.3 contract (rare pacing, choices-only authority, reset-on-run-boundary persistence) into a practical implementation pipeline.

## Current baseline (already in place)

- GMRuntime exists and is ticked every turn; state persists to `GM_STATE_V1`.
- Two marker threads exist (Bottle Map, Survey Cache) + guard fine confirm travel event.
- Seed/apply/restart flows clear GM state.
- A boredom/interest smoketest exists: `gm_boredom_interest`.
- Seed reset smoketest exists: `gm_seed_reset`.

## Next in pipeline (recommended order)

### 1) Phase 6 — Smoketest stability + false-negative removal (fast confidence)
**Goal:** make the GM smoketest suite reliable so later behavior work doesn’t regress silently.

**Work items**
- Ensure GM scenarios are all in `smoketest/scenarios.json` (now includes `gm_seed_reset` + `gm_boredom_interest`).
- Fix any brittle assertions (e.g., intentHistory length checks if capped).
- Ensure scenarios that start encounters wait for encounter templates to be ready.

**Acceptance checks**
- Run (explicit list): `?smoketest=1&dev=1&scenarios=gm_seed_reset,gm_boredom_interest,gm_bridge_faction_travel,gm_bridge_markers,gm_bottle_map,gm_survey_cache`
- Run (shortcut): `?smoketest=1&dev=1&gmphase6=1`
- No SKIPs due to missing mode/data unless intentionally gated.

---

### 2) Phase 2 — Ctx-first + sync-boundary closure for non-marker GM starts
**Goal:** eliminate mode/position desync by enforcing a single rule:
- GM-driven mode transitions are ctx-first, and callers sync exactly once after mode changes.

**Work items**
- Audit travel-event encounter start paths (`travel.banditBounty`, `travel.trollHunt`, `travel.guardFine`).
- Ensure they do not reacquire ctx mid-action.
- Ensure world-step callers apply the sync boundary after `GMBridge.maybeHandleWorldStep(ctx)` when it changes `ctx.mode`.

**Acceptance checks**
- Manual: force each travel event via GOD, take one world step, confirm the intended prompt/encounter happens with no “teleport” artifacts.
- Smoketest: `gm_bridge_faction_travel` passes reliably.

---

### 3) Phase 3 — Emitter hygiene + interest tier defaults (make boredom usable)
**Goal:** support the v0.3 pacing rule “rare only when bored” by preventing boredom from hard-resetting during routine play.

**Work items**
- Mark routine, high-frequency emitters as NOT major-interest by default.
  - Example: `combat.kill` should not hard reset boredom per kill.
  - Example: `type:"mechanic"` telemetry should not hard reset boredom.
- Decide one default rule for events that omit interest fields:
  - recommended: treat as `interestTier:"minor"` (or `interesting:false`) rather than full reset.

**Acceptance checks**
- `gm_boredom_interest` stays green.
- Manual: boredom level is not pinned near 0 during normal combat/menus.

---

### 4) Phase 4 — Rare pacing gate (boredom + deterministic random cooldown)
**Goal:** implement the v0.3 pacing budget.

**Work items**
- Add pacing fields to GM state:
  - `lastInterventionTurn`
  - `nextEligibleTurn`
- When a choice prompt is shown (an intervention), compute next cooldown:
  - `cooldownTurns = uniformInt(400, 600)` using GM RNG
  - `nextEligibleTurn = turn + cooldownTurns`
- Require boredom threshold gate before proposing any intervention.

**Acceptance checks**
- Reload determinism: the next eligible turn is stable after reload.
- Interventions do not trigger when boredom is below threshold.

---

### 5) Phase 5 — Choices-first UX alignment
**Goal:** convert GM content into explicit opt-in prompts (choices), and ensure only those prompts spend pacing budget.

**Work items**
- Convert marker interactions to prompts:
  - `G` on `gm.surveyCache` → confirm “Investigate?”
  - `G` on `gm.bottleMap` marker → confirm “Investigate?”
- Convert auto travel encounters to prompts (or disable them until prompt-based).

**Acceptance checks**
- Decline path produces no punishment and no forced encounter.
- Accept path enters encounter cleanly.

## Suggested immediate next action

Start with **Phase 6 then Phase 2** (test reliability + transition correctness), because pacing work is hard to validate until tests and transitions are stable.
