# GM v0.1 Merge Gate (Policy A)

This document defines the minimal **pre-merge gate** for the GM v0.1 system.

Policy A means: **do not merge** unless the automated checks pass and the manual sanity checks are green.

## Required automated artifacts

### 1) GM Emission Sim report (GOD panel)

Run the GM Emission Sim (via the GOD panel).

The report must end with:

- `ok: true`
- All scenarios pass (S1..S6)
- `unknownReasons: []`

Keep the full report JSON in the PR description (or attach it as a file) so it can be re-checked later.

### 2) Smoketest multirun report

Run smoketest with multiple runs (recommended: 3) and include the GM scenarios.

Requirements:

- `runs >= 3`
- Includes scenarios:
  - `gm_mechanic_hints`
  - `gm_intent_decisions`
  - `determinism`

Keep the full report JSON in the PR description (or attach it as a file).

Notes:

- The runner can sometimes report `pass: N / fail: 0` even when `failingSteps` contains FAIL entries. Treat that as a runner/reporting bug; investigate and do not assume green.

## Manual sanity checklist (Phase 2)

### GM panel UX

- Toggle GM panel with `O`.
- Verify it is **non-modal**: player movement and actions still work while the panel is open.
- Verify panel is draggable and scrollable.
- Verify the panel survives mode switches (world <-> town <-> dungeon) without errors.

### Logging visibility

- In the GOD log category toggles, disable **General**.
- Verify GM logs still appear under `gm` / `gm-npc` categories (they must not be suppressed by the General toggle).

## When the gate fails

Policy A: fix the failure before merging.

Common outcomes:

- **Unknown GM reason codes**: update `reasonCatalog` (or the canonical GM reason registry) and re-run Emission Sim.
- **Non-deterministic hints**: fix RNG usage / ordering so GM decisions do not consume or depend on non-deterministic sources.
- **Smoketest inconsistencies**: reproduce locally, attach failing report JSON, and fix runner/reporting or the underlying gameplay flow.
