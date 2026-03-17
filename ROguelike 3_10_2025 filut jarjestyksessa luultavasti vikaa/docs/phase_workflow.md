# Engineering Workflow: Phased Development (“Slices”)

This repo is healthiest when we ship changes in **small, reversible, end-to-end slices**.

A **slice** is a scoped change that:
- is small enough to review quickly,
- keeps the game runnable at every commit,
- passes the standard QA gates,
- can be deployed independently,
- can be rolled back cleanly.

---

## 1) Choosing a slice

A good slice is a **vertical** unit of work: it creates a real improvement while keeping the rest of the system stable.

### Slice selection checklist

Pick a slice that:

- **Has a crisp goal** (one sentence).
- **Has a clear seam/boundary** you can cut along.
  - Prefer stable entrypoints and wrapper layers.
  - For refactors, preserve the old module as a delegator until call sites migrate.
- **Has explicit acceptance criteria**.
  - What must remain true? What should change (if anything)?
- **Is shippable on its own**.
  - Avoid slices that require a follow-up to restore correctness.

### Slice anti-patterns

Avoid slices that:
- mix refactor + gameplay changes + UI changes,
- touch many call sites across unrelated areas,
- leave the codebase “half migrated” without a back-compat path.

---

## 2) Max scope (files / LOC)

A slice should be intentionally small.

**Default max scope (aim):**
- **≤ 5 files touched**
- **≤ 250 LOC changed** (added + removed + modified)

**Hard max scope (requires explicit justification in the PR description):**
- **≤ 10 files touched**
- **≤ 500 LOC changed**

If you exceed the default scope:
- split into multiple slices, or
- do a preparatory slice first (add wrappers/entrypoints), then do the migration slice.

---

## 3) Required QA gates (local + CI)

Every slice must keep the standard gates green.

### Required commands

Run these locally before merging (CI is the source of truth, but local runs shorten feedback loops):

```bash
npm run lint:strict
npm run check:docs-catalog
npm run build
npm run acceptance:phase6
npm run acceptance:phase0
```

Shortcut:
- `npm run ci` (runs `lint:strict`, `check:docs-catalog`, and `build`)
- `npm run ci:gm` (runs `ci` + `acceptance:phase6` + `acceptance:phase0`)

Pass criteria:
- `lint:strict`: **0 warnings**, 0 errors
- `check:docs-catalog`: no missing paths in `docs/index.html` catalog
- `build`: no bundling errors (import cycles / missing exports surface here)
- `acceptance:*`: both acceptance scripts pass

### Browser smoketest runner (recommended for runtime/UI slices)

If a slice changes any of:
- runtime boot/module wiring (`src/boot/*`, `src/main.js`, `core/engine/*`),
- mode transitions (world/town/dungeon/region/encounter),
- input/modals/panels, or rendering,

run the in-browser smoke runner:
- `index.html?smoketest=1` (see `smoketest.md`)

---

## 4) Versioning + changelog rules

This repo tracks changes via:
- the workspace version in `package.json`, and
- `VERSIONS.md` as the canonical changelog.

### 4.1 Version bumps

- **Default:** each merged slice increments **patch**.
  - Example: `1.50.41` → `1.50.42`
- **Minor bump:** when the slice adds a clear player-facing feature or changes core loops.
- **Major bump:** reserved for explicit breaking changes (rare; call it out in advance).

Docs-only changes may skip a version bump.

### 4.2 Changelog entries (`VERSIONS.md`)

When the slice is user-visible (feature, behavior change, meaningful fix):
- add a new top entry using the existing format:
  - `vX.Y.Z — Short title`
  - bullet list of concrete changes
- if you deploy, append a `Deployment:` URL line (matches existing convention).

---

## 5) Deploy workflow + manual browser smoke checklist

### 5.1 Deploy workflow

1. Ensure QA gates are green (Section 3).
2. Build release artifacts:

   ```bash
   npm run build
   ```

3. Deploy the produced `dist/` output to the hosting target.
4. Record the deploy link (if applicable) in `VERSIONS.md`.

### 5.2 Manual browser smoke checklist (post-deploy)

Run this in a **fresh session** (Incognito / private window) to avoid stale localStorage:

- **Load / boot**
  - [ ] The page loads without a blank screen
  - [ ] Browser console has **no new red errors** on load

- **Core input + modals**
  - [ ] Movement works (arrow keys / WASD)
  - [ ] Open/close GOD panel
  - [ ] Open/close Inventory
  - [ ] Open/close Help / Character Sheet
  - [ ] Escape closes the topmost modal correctly

- **World / transitions**
  - [ ] Enter a town (stand on town tile, press G)
  - [ ] Bump an NPC and see dialogue/log output
  - [ ] Enter a dungeon (stand on dungeon tile, press G)
  - [ ] Exit the dungeon on `>` and confirm return to overworld

- **Gameplay sanity**
  - [ ] Spawn an enemy via GOD (or find one) and perform a few attacks
  - [ ] Loot underfoot via G (corpse/chest)
  - [ ] No obvious FOV/LOS anomalies (enemies not visible through walls)

- **Automated smoke runner (recommended)**
  - [ ] Open `index.html?smoketest=1` and confirm **PASS**

---

## 6) Rollback

Rollbacks should be fast, boring, and safe.

### 6.1 When to rollback

Rollback when:
- the app fails to boot (blank screen, broken imports),
- there are new, repeatable runtime errors in the console,
- the smoke runner fails in a non-flaky way,
- core transitions (enter/exit) are broken.

### 6.2 Rollback procedure

1. Identify the **last known-good version** (usually the previous `vX.Y.Z` in `VERSIONS.md`).
2. Redeploy that version.
   - If your deploy pipeline is git-based: revert the merge commit and redeploy.
   - If your deploy pipeline is artifact-based: redeploy the previously archived artifact.
3. Re-run the manual smoke checklist (Section 5.2).
4. Record the rollback reason in `VERSIONS.md`.

### 6.3 Storage compatibility note

Some slices change saved state. After rollback, clients may have newer localStorage data.

Mitigations:
- Validate rollback behavior in an incognito window.
- If needed, instruct testers to clear site storage or use the repo’s “fresh session” URL flags (commonly `?fresh=1`, `?reset=1`, `?nolocalstorage=1`).
