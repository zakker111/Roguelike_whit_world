# Slice 1 — Baseline execution (PR notes)

## What changed
<!-- 1–3 bullets. Link issues/tickets if applicable. -->

- 

## Baseline execution evidence

### CI
- CI run link: <paste the GitHub Actions run URL here>
  - Workflow: **Tiny Roguelike CI**
  - Job: **build-lint-acceptance**
  - Artifact (logs): **tiny-roguelike-qa-logs**

CI result:
- [ ] PASS
- [ ] FAIL

### Local (if applicable)
Environment (optional): <OS / runtime versions>

Commands run:
```sh
npm install
npm run ci:gm
```

Local result:
- [ ] PASS
- [ ] FAIL

## Reports

### Phase0 report summary
Paste the Phase0 report summary here:

```text
<Phase0 summary output>
```

Phase0:
- [ ] PASS
- [ ] FAIL

### Phase6 JSON report output
Paste the **full Phase6 JSON** output here:

```json
{
  "paste": "Phase6 JSON report output here"
}
```

Phase6:
- [ ] PASS
- [ ] FAIL

## Final verification
- [ ] Baseline execution completed (Slice 1)
- [ ] Phase0 + Phase6 attached above
- [ ] All failures (if any) documented with links/log snippets

## Running the GitHub Actions workflow manually (workflow_dispatch)
1. Go to **Actions** in GitHub.
2. Select the workflow: **Tiny Roguelike CI**.
3. Click **Run workflow**.
4. Choose the branch (usually the PR branch).
5. Click **Run workflow** and paste the resulting run link above.

(Optional via GitHub CLI)
```sh
# gh workflow list
# gh workflow run "Tiny Roguelike CI" --ref <branch>
```
