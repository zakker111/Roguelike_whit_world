# GM v0.3 Pipeline (Status + Remaining Work)

This document tracks GM v0.3 progress against the contract in `analysis/gm_v0_3_contract.md`.

## v0.3 status (already implemented)

The repo already contains the core v0.3 pillars:

- **Persistence (per-run):** GM state persists to `GM_STATE_V1` and is treated as per-run.
- **Reset semantics:** GM state resets on Apply Seed / Start New Game / Death restart.
- **Boredom model + hygiene:** boredom is smoothed and high-frequency telemetry is prevented from pinning it at 0.
- **Rare pacing gate:** interventions are boredom-gated and cooldown-gated via `gm.pacing.nextEligibleTurn` with cooldown draws consuming **GM RNG only**.
- **Choices-first authority:** interventions that affect the player are delivered via confirm prompts (decline-safe).
- **Ctx-first transitions:** GM-driven mode transitions are ctx-first and apply a single sync boundary after mode changes.

Fast deployment-level sanity checks (no full bootstrap):
- `gm_sim.html` (unit-style GM assertions)
- `gm_emission_sim.html` (deterministic emission-rate simulation)

## What remains (recommended order)

### Phase 6 — Smoketest stability hardening (flake + false-negative removal)

**Goal:** Phase 6 should fail when GM regressions happen, and should not pass due to SKIPs or timing luck.

**Work items (keep PRs small):**
- Standardize per-scenario waits (prefer shared helpers over ad-hoc sleeps).
- Reduce brittle assertions that fail on tuning changes (e.g., fixed gold ranges).
- Convert “silent SKIP” paths in Phase 6 scenarios into either retries or real FAILs.

**Acceptance checks**
- Headless (preferred): `npm run acceptance:phase6`
- Browser: `index.html?smoketest=1&dev=1&gmphase6=1&smokecount=3&skipokafter=0`

---

### Phase 6+ (optional) — Broader nightly GM suite

**Goal:** keep the Phase 6 gate tight, but have an easy “run more GM tests” selector for nightly/flake-hunting.

**Suggested suite:**
- `gm_disable_switch,gm_rng_persistence,gm_scheduler_arbitration,gm_panel_smoke,gm_survey_cache_spawn_gate,gm_bottle_map_fishing_pity`

---

### UX/QA ergonomics (optional)

- Add a small non-dev “smoke status” page that renders the last `smoke-json-token` summary without opening DevTools.

## Merge readiness checklist

Use `analysis/gm_pre_merge_plan.md` as the authoritative merge gate list.
