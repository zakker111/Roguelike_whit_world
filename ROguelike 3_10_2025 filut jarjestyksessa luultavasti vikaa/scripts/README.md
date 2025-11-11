Scripts

Purpose
- Node-based helper scripts for maintenance, analysis, and manifest generation.

Key scripts
- analyze.js — generates duplication and size report (analysis/phase1_report.md). Scans JS files for top N largest and approximate duplicated 3-line shingles.
- gen_manifest.js — produces a manifest of assets/modules for deployment or tooling.
- gen_smoke_manifest.js — generates smoke test scenario manifests and ensures index.html injection lists are consistent.

Usage
- node scripts/analyze.js
- node scripts/gen_manifest.js
- node scripts/gen_smoke_manifest.js

Notes
- Run lint and formatter before committing (npm run lint / npm run format).
- See top-level README.md for more details on analysis workflow and pre-merge checklist.