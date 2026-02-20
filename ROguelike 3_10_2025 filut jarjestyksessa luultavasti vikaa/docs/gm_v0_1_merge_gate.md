# GM v0.1 Merge Gate (Policy A)

This is a **pre-merge, phase-based checklist** for shipping **GM v0.1** as an *observability + low-frequency hints* system.

**Policy A (selected):** GM v0.1 may merge even if unrelated items in `BUGS.md` remain open, as long as GM is deterministic, non-crashing, and the test gates below are green.

---

## Phase 0 — Freeze scope + confirm assumptions (5–10 min)

**Goal:** prevent last-minute scope creep and clarify what counts as a blocker.

- [ ] Confirm GM v0.1 is **non-orchestrating**:
  - no changes to world/encounter selection
  - no changes to rewards/AI/spawns
  - no RNG consumption
  - only `ctx.gm` mutations + logging + dev tooling
- [ ] Confirm the only intended behavior change queued post-v0.1 is **partial boredom relief** (town/world entry, NPC talk, follower hire, shop buy/sell). (Implementation can be after merge if desired, but the *direction* should be in the PR description.)
- [ ] Confirm `tavern` is a **future mode** (supported by GM code paths; not required to fire today).
- [ ] Confirm shipping dev hooks is acceptable:
  - `GMRuntime.__getRawState/__setRawState` remain in mainline as *internal/test helpers*.

**Merge-blocker definition for v0.1**
- Any runtime error originating from GM integration paths (GM runtime, gmEvent, GM panel, GM sim)
- Any determinism regression (seeded runs diverge)
- Any input/UX break where GM panel/GOD tools block gameplay unexpectedly
- GM sim corrupts the live run’s GM state

---

## Phase 1 — Automated gates (must be green)

### 1.1 GM Emission Sim (GOD panel)

**Goal:** validate the deterministic emission gates and reason codes.

Steps:
- [ ] Open GOD panel (`P`)
- [ ] Scroll to **GM Emission Sim**
- [ ] Click **Run GM Emission Sim**

Pass criteria:
- [ ] Report shows `"ok": true`
- [ ] All scenarios `S1..S6` show `ok: true`
- [ ] Report is present at `window.__GM_EMISSION_SIM_RESULT__`

Artifacts to attach to PR:
- [ ] Copy JSON from the output area (or click **Copy JSON**) and paste into PR description as a collapsible block.

### 1.2 Smoke tests (built-in runner)

**Goal:** catch regressions outside GM (movement/combat/town/determinism) plus GM-specific scenarios.

Run (deployed or local):

- Baseline:
  - `index.html?smoketest=1&dev=1`
- Multi-run quick stress:
  - `index.html?smoketest=1&dev=1&smokecount=3&skipokafter=1`

GM-focused subset:
- `index.html?smoketest=1&dev=1&scenarios=gm_mechanic_hints,gm_intent_decisions,determinism`

Pass criteria:
- [ ] Determinism scenario PASS
- [ ] GM scenarios PASS
- [ ] No game-origin console errors during the run (ignore blocked trackers)

Artifacts to attach to PR:
- [ ] Download smoketest JSON from GOD panel (Download JSON)
- [ ] Attach summary/checklist outputs if available

---

## Phase 2 — Manual sanity checks (10–15 min)

**Goal:** validate UX / correctness in ways automation may miss.

### 2.1 GM panel sanity
- [ ] Toggle GM panel with `O` in **world**, **town**, **dungeon**.
- [ ] Confirm panel is draggable and scrollable.
- [ ] Confirm it does not break movement / does not behave like a modal.
- [ ] Confirm it refreshes and shows:
  - boredom level changing over time
  - last event updates on transitions
  - intent history populated with reasons (`kind:none` entries included)

### 2.2 Log visibility sanity
- [ ] In GOD panel logs/categories, confirm `gm` and `gm-npc` are visible.
- [ ] Confirm GM lines are not hidden when “General” logs are disabled.

### 2.3 “No corruption after running sim” sanity
- [ ] Start a run, accumulate some GM stats (move/enter town)
- [ ] Run GM Emission Sim from GOD panel
- [ ] Confirm GM panel still shows reasonable stats (no obvious reset/jump that looks like broken restore)

---

## Phase 3 — PR packaging (what reviewers need)

**Goal:** make the merge easy to review and defend.

- [ ] PR title: `GM v0.1: Observability + low-frequency hints (deterministic)`
- [ ] PR description includes:
  - [ ] v0.1 scope statement: “no gameplay orchestration, no RNG usage, only ctx.gm state + logging”
  - [ ] Known limitations: “GM is intentionally quiet; most town entries emit none; reason codes explain why”
  - [ ] GM Emission Sim JSON (collapsed)
  - [ ] Smoketest JSON link / attachment
- [ ] Reviewer checklist (copy/paste):
  - [ ] Run GM Emission Sim
  - [ ] Run smoketest determinism + GM scenarios
  - [ ] Confirm GM panel doesn’t block input

---

## Phase 4 — Post-merge follow-up tracking (non-blocking)

**Goal:** keep forward work visible without blocking the v0.1 merge.

- [ ] Open a follow-up ticket: “Partial boredom relief for routine town/world + NPC/shop interactions”
- [ ] Open a follow-up ticket: “Refactor `core/gm/runtime.js` into modules + add unit tests”
- [ ] Keep `tavern` as future mode milestone (when actual mode exists, validate GM scope and gating)
