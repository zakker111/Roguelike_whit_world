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
- [ ] Start/continue any run (world/town/dungeon is fine).
- [ ] Open GOD panel (`P`)
- [ ] Scroll to **GM Emission Sim**
- [ ] Click **Run GM Emission Sim** (the in-game button; not the standalone `gm_emission_sim.html` page)

Pass criteria:
- [ ] Report shows `"ok": true`
- [ ] All scenarios `S1..S6` show `ok: true`
- [ ] Report is present at `window.__GM_EMISSION_SIM_RESULT__`

Artifacts to attach to PR:
- [ ] Copy JSON from the output area (or click **Copy JSON**) and paste into PR description as a collapsible block.

### 1.2 Smoke tests (built-in runner)

**Goal:** catch regressions outside GM (movement/combat/town/determinism) plus GM-specific scenarios.

Run (deployed or local):

- You can either enter the URL directly, or click **Run Smoke Test** in the GOD panel (it reloads with `?smoketest=1`, preserving `&dev=1` when enabled).

- Required (covers determinism + GM scenarios by default):
  - `index.html?smoketest=1&dev=1&smokecount=3&skipokafter=1`
  - Note: `skipokafter=1` means scenarios that PASS in run 1 will be skipped in runs 2..N (so this is primarily a quick flake check, not full 3× coverage).
- Optional single-run baseline:
  - `index.html?smoketest=1&dev=1`

Optional GM-only rerun (faster iteration when debugging GM):
- `index.html?smoketest=1&dev=1&scenarios=gm_mechanic_hints,gm_intent_decisions,determinism`

Pass criteria (Policy A):
- [ ] Determinism scenario PASS (verify in the report JSON under `scenarioResults` that `determinism.passed === true` at least once)
- [ ] GM scenarios PASS (verify `gm_mechanic_hints.passed === true` and `gm_intent_decisions.passed === true`)
- [ ] No GM-origin console errors during the run (ignore blocked trackers)
- [ ] If other non-GM scenarios fail (town/dungeon/region/encounters/overlays), they are treated as **non-blocking** for GM v0.1, but should be noted in the PR as existing issues.

Artifacts to attach to PR:
- [ ] In the GOD panel smoketest output, use:
  - **Download Report (JSON)**
  - **Download Summary (TXT)**
  - **Download Checklist (TXT)**

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
- [ ] After generating at least one GM log line (e.g. enter town/dungeon or run the GM sim), in GOD panel logs/categories confirm `gm` and `gm-npc` are visible.
- [ ] Confirm GM lines are not hidden when “General” logs are disabled.

### 2.3 “No corruption after running sim” sanity
- [ ] Start a run, accumulate some GM stats (move/enter town)
- [ ] Run GM Emission Sim from GOD panel
- [ ] Confirm GM panel still shows reasonable stats (no obvious reset/jump that looks like broken restore)

### 2.4 Confirm modal sanity (GM/world event safety)
This is important because some GM-driven world events can open confirms or start encounters.
- [ ] Verify confirm modals (if any) can be dismissed cleanly (Esc cancels), and do not leave the game in a stuck input state.

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
