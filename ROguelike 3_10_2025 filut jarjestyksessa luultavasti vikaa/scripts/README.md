Scripts

Purpose
- Node-based helper scripts for maintenance, analysis, and manifest generation.

Key scripts
- analyze.js — generates duplication and size report (analysis/phase1_report.md). Scans JS files for top N largest and approximate duplicated 3-line shingles.
- gen_manifest.js — produces a manifest of assets/modules for deployment or tooling.
- gen_smoke_manifest.js — generates smoke test scenario manifests and ensures index.html injection lists are consistent.
- run_phase6_acceptance.js — headless Phase 6 smoketest harness (Playwright Chromium); see `npm run acceptance:phase6`.
- run_phase0_acceptance.js — headless Phase 0 baseline smoketest harness (Playwright Chromium); see `npm run acceptance:phase0`.
- qa_phase6.sh / qa_phase6.ps1 — local helper to run install + lint/build + phase6 acceptance and write logs to artifacts/qa.
- qa_full.sh / qa_full.ps1 — local helper to run the full QA gates (including Playwright install + acceptance phase6 + phase0).

Usage
- node scripts/analyze.js
- node scripts/gen_manifest.js
- node scripts/gen_smoke_manifest.js
- npm run acceptance:phase6
- npm run acceptance:phase0
- ./scripts/qa_full.sh

Notes
- Run lint and formatter before committing (npm run lint / npm run format).
- See top-level README.md for more details on analysis workflow and pre-merge checklist.