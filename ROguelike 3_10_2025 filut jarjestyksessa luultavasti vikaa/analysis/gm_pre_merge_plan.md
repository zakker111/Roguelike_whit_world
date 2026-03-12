# GM v0.3 — Pre-merge plan (updated)

This is the checklist we complete **before merging GM work**.

## Merge gates (must be green)

### Policy: no fallbacks (GM)

Before merging, we keep GM behavior **strictly data-driven**:
- No fallback encounter templates inside GM code paths.
- If encounter templates are not loaded yet, GM entry points should defer (tests should wait).

Quick check:
- `gm_bridge_effects.js` should not contain hard-coded fallback GM encounter templates.
- Phase 6 smoketests must pass without relying on timing luck (they should wait for templates).

### Gate A — Phase 6 smoketest stability

**What this proves:** the GM integration is stable enough to iterate on safely.

Run one of:

- **CI/local headless (preferred, deterministic):**
  - `npm run acceptance:phase6`
  - This runs the Phase 6 acceptance set 3 times (Playwright Chromium) and prints a JSON summary.

- **Browser (manual run, still valid):**
  - `index.html?smoketest=1&dev=1&gmphase6=1&smokecount=3&skipokafter=1`
  - Shortcut `gmphase6=1` expands to:
    - `gm_seed_reset`
    - `gm_boredom_interest`
    - `gm_bridge_faction_travel`
    - `gm_bridge_markers`
    - `gm_bottle_map`
    - `gm_survey_cache`

**Pass criteria:**
- No hard failures.
- No unexpected scenario skips due to missing readiness (data/mode).

### Gate B — Phase 2 ctx-first + sync-boundary closure

**What this proves:** GM-driven mode transitions never desync ctx/mode/camera (“teleport” artifacts).

**Required manual check (quick):**
1. Use GOD to force each travel event:
   - guard fine
   - bandit bounty
   - troll hunt
2. Take exactly one overworld step to trigger delivery.
3. For each:
   - Decline path: confirm closes, you remain in overworld, no state corruption.
   - Accept path: clean transition to encounter, then withdraw to overworld; no camera/position desync.

**Pass criteria:** no visible desync; no console errors.

## Build / hygiene gates (must be green)

- `npm run lint:strict`
- `npm run build`

## Optional-but-recommended validations

These are not formal merge gates, but catch regressions early:

- GM RNG determinism across soft reload:
  - `?smoketest=1&dev=1&scenarios=gm_rng_persistence`
- Scheduler arbitration remains RNG-free:
  - `?smoketest=1&dev=1&scenarios=gm_scheduler_arbitration`

## What is considered “in scope” for this merge

- GMRuntime persisted state (`GM_STATE_V1`) and reset semantics (seed/newgame/death).
- Pacing state (`gm.pacing.*`) + cooldown draws using GM RNG only.
- Deterministic scheduler-backed travel events.
- Bottle Map + Survey Cache threads and marker integrity.
- Confirm-first UX for interventions (decline-safe).
- Smoketest coverage for the above.

## Evidence to attach to the merge

- Phase 6 acceptance output:
  - Headless: the JSON printed by `npm run acceptance:phase6`, OR
  - Browser: exported smoketest JSON (`smoke-json-token`).
- Note that Gate B manual check was performed (brief bullet list, no screenshots required).
